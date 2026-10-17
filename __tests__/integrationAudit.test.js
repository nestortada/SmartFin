/* Synthetic integration audit. Never opens the installed application's database. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { performance } = require('node:perf_hooks');
const { sharedExpenseFixture } = require('./helpers/sharedExpenseFixture');
const {
  dashboardFixture,
  insertSyntheticHistory,
  DASHBOARD_DATE,
} = require('./helpers/dashboardFixture');
const {
  getDashboardSummaryFromDb,
} = require('../src/modules/dashboard/useCases/getDashboardSummary');

jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(),
}));
const repository = path.resolve(__dirname, '..');
const versionDatabase = new DatabaseSync(':memory:');
const evidence = {
  runtime: process.version,
  sqlite: versionDatabase.prepare('select sqlite_version() as version').get()
    .version,
  benchmarks: [],
};
versionDatabase.close();

// Load the actual preceding optimized implementation, rather than the much older
// unoptimized baseline used by the historical performance suite.
function loadPrevious(relative, overrides = {}) {
  const source = child.execFileSync('git', ['show', `HEAD:${relative}`], {
    cwd: repository,
    encoding: 'utf8',
  });
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleValue = { exports: {} };
  const resolve = name =>
    overrides[name] ||
    require(name.startsWith('.')
      ? path.resolve(repository, path.dirname(relative), name)
      : name);
  // Trusted local Git source is compiled only inside this audit test.
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', compiled)(
    resolve,
    moduleValue,
    moduleValue.exports,
  );
  return moduleValue.exports;
}

test('synthetic physical SQLite copy reopens with all rows, relationships and date metadata intact', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'smartfin-synthetic-audit-'),
  );
  const fixture = await sharedExpenseFixture();
  try {
    const expense = await fixture.purchase();
    await fixture.api.recordReceipt('partial', {
      contactId: fixture.contactId,
      accountId: 'target',
      amount: 5000,
      occurrence: { kind: 'date', date: '2026-11-03' },
      applications: [
        { participationId: expense.participationId, amount: 5000 },
      ],
    });
    const timed = await fixture.save({
      amount: 1,
      occurrence: {
        kind: 'dateTime',
        date: '2026-10-05',
        time: '23:00',
        timeZone: 'America/Bogota',
      },
    });
    await fixture.save({
      editingTransaction: timed.transaction,
      amount: 1,
      occurrence: { kind: 'date', date: '2026-10-05' },
    });
    await fixture.save({
      amount: 2,
      occurrence: {
        kind: 'dateTime',
        date: '2026-10-05',
        time: '23:00',
        timeZone: 'America/Bogota',
      },
    });
    const tables = fixture.native
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map(row => row.name);
    const snapshot = db =>
      Object.fromEntries(
        tables.map(table => [
          table,
          db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(),
        ]),
      );
    const expected = snapshot(fixture.native);
    const backup = path.join(directory, 'synthetic-backup.db');
    const restored = path.join(directory, 'synthetic-restored.db');
    fixture.native.prepare('VACUUM INTO ?').run(backup);
    fixture.native.close();
    fs.copyFileSync(backup, restored);
    for (let restart = 0; restart < 2; restart++) {
      const reopened = new DatabaseSync(restored);
      expect(snapshot(reopened)).toEqual(expected);
      expect(
        reopened.prepare('PRAGMA integrity_check').get().integrity_check,
      ).toBe('ok');
      expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(
        reopened
          .prepare('SELECT version FROM schema_migrations ORDER BY version')
          .all()
          .map(row => row.version),
      ).toEqual([1, 2, 3]);
      reopened.close();
    }
    evidence.physicalCopy = {
      tables: tables.length,
      reopenings: 2,
      integrity: 'ok',
      foreignKeyViolations: 0,
      identicalRows: true,
      method:
        'Node VACUUM INTO, closed file copy, reopen; not Android SAF restore',
    };
  } finally {
    // Only the directory created above, never a computed production path.
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('dashboard cost against preceding optimized HEAD on identical synthetic histories', async () => {
  evidence.previousCommit = child
    .execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    })
    .trim();
  const previousRepository = loadPrevious(
    'src/modules/transactions/repositories/sqliteTransactionRepository.ts',
  );
  const previous = loadPrevious(
    'src/modules/dashboard/useCases/getDashboardSummary.ts',
    {
      '../../transactions/repositories/sqliteTransactionRepository':
        previousRepository,
    },
  ).getDashboardSummaryFromDb;
  for (const size of [1000, 10000, 100000]) {
    const fixture = await dashboardFixture();
    insertSyntheticHistory(fixture, size);
    try {
      const expected = await previous(fixture.database, DASHBOARD_DATE);
      for (const [version, summarize] of [
        ['previousOptimized', previous],
        ['sharedIntegration', getDashboardSummaryFromDb],
      ]) {
        let queries = [];
        const database = new Proxy(fixture.database, {
          get(target, key) {
            if (key !== 'executeSql') return Reflect.get(target, key);
            return async (sql, values = []) => {
              const result = fixture.query(sql, values);
              queries.push({ sql, rows: result.rows.length });
              return [result];
            };
          },
        });
        for (let i = 0; i < 3; i++) await summarize(database, DASHBOARD_DATE);
        const milliseconds = [];
        for (let i = 0; i < 7; i++) {
          queries = [];
          const start = performance.now();
          const actual = await summarize(database, DASHBOARD_DATE);
          milliseconds.push(performance.now() - start);
          expect(actual).toEqual(expected);
        }
        evidence.benchmarks.push({
          size,
          version,
          medianMs: [...milliseconds].sort((a, b) => a - b)[3],
          queries: queries.length,
          returnedRows: queries.reduce((n, query) => n + query.rows, 0),
          milliseconds,
          statements: queries,
        });
      }
    } finally {
      fixture.native.close();
    }
  }
}, 120000);

test('dashboard shared-state volume is measured independently of bank history volume', async () => {
  evidence.sharedVolume = [];
  for (const size of [100, 1000, 5000]) {
    const fixture = await dashboardFixture();
    insertSyntheticHistory(fixture, 100000);
    try {
      fixture.native.exec('BEGIN');
      for (let person = 0; person < 50; person++)
        fixture.native
          .prepare('INSERT INTO shared_contacts VALUES(?,?,?,?)')
          .run(
            `person-${person}`,
            `Synthetic person ${person}`,
            '2026-01-01',
            '2026-01-01',
          );
      const movements = fixture.native
        .prepare(
          "SELECT id FROM transactions WHERE type='expense' AND status='posted' LIMIT ?",
        )
        .all(size);
      movements.forEach(({ id }, index) => {
        const expense = `expense-${index}`;
        const contact = `person-${index % 50}`;
        const snapshot = JSON.stringify([
          { id: `own-${index}`, amountMinor: 1500000 },
          { id: `part-${index}`, contactId: contact, amountMinor: 1500000 },
        ]);
        fixture.native
          .prepare('INSERT INTO shared_expenses VALUES(?,?,?,?,?,?,?,?,?)')
          .run(
            expense,
            id,
            3000000,
            '2026-10-05',
            'Synthetic shared expense',
            snapshot,
            'active',
            '2026-01-01',
            '2026-01-01',
          );
        for (const [split, person] of [
          [`own-${index}`, null],
          [`part-${index}`, contact],
        ])
          fixture.native
            .prepare(
              "INSERT INTO transaction_splits(id,transaction_id,amount,currency,created_at,updated_at,shared_expense_id,contact_id,amount_minor,shared_active,split_type) VALUES(?,?,15000,'COP','2026-01-01','2026-01-01',?,?,1500000,1,'shared_third_party')",
            )
            .run(split, id, expense, person);
        fixture.native
          .prepare('INSERT INTO shared_receipts VALUES(?,?,?,?,?,?,?,?)')
          .run(
            `receipt-${index}`,
            null,
            contact,
            750000,
            '2026-10-06',
            'active',
            '2026-01-01',
            '2026-01-01',
          );
        fixture.native
          .prepare('INSERT INTO shared_allocations VALUES(?,?,?,?,?,?,?,?)')
          .run(
            `allocation-${index}`,
            `receipt-${index}`,
            `part-${index}`,
            `part-${index}`,
            750000,
            1,
            '2026-01-01',
            '2026-01-01',
          );
      });
      fixture.native.exec('COMMIT');
      expect(fixture.native.prepare('PRAGMA foreign_key_check').all()).toEqual(
        [],
      );
      const milliseconds = [];
      let transferredRows = 0;
      const database = new Proxy(fixture.database, {
        get(target, key) {
          if (key !== 'executeSql') return Reflect.get(target, key);
          return async (sql, values = []) => {
            const result = fixture.query(sql, values);
            if (
              sql.startsWith('SELECT * FROM') &&
              (sql.includes('shared_') || sql.includes('transaction_splits'))
            )
              transferredRows += result.rows.length;
            return [result];
          };
        },
      });
      for (let i = 0; i < 4; i++) {
        transferredRows = 0;
        const start = performance.now();
        await getDashboardSummaryFromDb(database, DASHBOARD_DATE);
        if (i) milliseconds.push(performance.now() - start);
      }
      evidence.sharedVolume.push({
        sharedExpenses: size,
        contacts: 50,
        bankMovements: 100000,
        medianMs: [...milliseconds].sort((a, b) => a - b)[1],
        milliseconds,
        sharedQueryTransferredRows: transferredRows,
      });
    } finally {
      fixture.native.close();
    }
  }
}, 120000);

afterAll(() => {
  fs.mkdirSync(path.join(repository, 'docs/audit'), { recursive: true });
  fs.writeFileSync(
    path.join(repository, 'docs/audit/integration-node.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
});
