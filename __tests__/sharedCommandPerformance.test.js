const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { realSQLite } = require('./helpers/realSQLite');
const { exactDigest } = require('../scripts/sharedCommands/exactDigest');
const { SQLITE_SCHEMA_STATEMENTS } = require('../src/database/sqliteSchema');
const { applyVersionedMigrations } = require('../src/database/migrations');
const {
  campaign,
  seedStatements,
} = require('../scripts/sharedCommands/campaign');
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const benchmark = process.env.SMARTFIN_COMMAND_PERF === '1' ? test : test.skip;
benchmark(
  'synthetic command latency and persisted financial oracle',
  async () => {
    jest.useFakeTimers({
      doNotFake: [
        'performance',
        'nextTick',
        'queueMicrotask',
        'setImmediate',
        'setTimeout',
      ],
    });
    jest.setSystemTime(new Date('2026-10-12T12:00:00Z'));
    const version = process.env.SMARTFIN_COMMAND_VERSION || 'after';
    const root =
      version === 'before'
        ? process.env.SMARTFIN_COMMAND_BASELINE_PATH ||
          'C:/sf-shared-commands-baseline-20261012'
        : path.resolve('src');
    const { createSharedExpenseApi } = require(root +
      '/modules/transactions/useCases/createSharedExpenseApi');
    const { createSqliteSharedExpenseRepository } = require(root +
      '/modules/transactions/repositories/sqliteSharedExpenseRepository');
    const { getDashboardSummaryFromDb } = require(root +
      '/modules/dashboard/useCases/getDashboardSummary');
    let report = {
      runtime: process.version,
      version,
      financialClock: new Date().toISOString(),
      samples: [],
      financial: [],
    };
    const output = `docs/performance/shared-commands/node-${version}.json`;
    if (process.env.SMARTFIN_COMMAND_RESUME === '1') {
      report = JSON.parse(fs.readFileSync(output, 'utf8'));
      const complete = new Set(
        report.financial
          .filter(s => s.operation === 'idempotentReplay')
          .map(s => `${s.size}/${s.shared}`),
      );
      report.financial = report.financial.filter(s =>
        complete.has(`${s.size}/${s.shared}`),
      );
      report.samples = report.samples.filter(s =>
        complete.has(`${s.size}/${s.shared}`),
      );
    }
    report.samplingPolicy =
      '3 independent fresh fixtures; before 100k uses 1 complete campaign because of quadratic latency';
    report.fingerprints = Object.fromEntries(
      [
        'modules/transactions/useCases/createSharedExpenseApi.ts',
        'modules/transactions/useCases/sharedCommandEffects.ts',
        'modules/transactions/useCases/sharedExpenseDomain.ts',
        'modules/transactions/repositories/sqliteSharedExpenseRepository.ts',
        'modules/transactions/repositories/sqliteSharedCommandReads.ts',
        'modules/transactions/repositories/sharedTransactionIntegrity.ts',
        'modules/transactions/repositories/SharedExpenseRepository.ts',
        'modules/transactions/useCases/saveManualTransaction.ts',
      ]
        .filter(file => fs.existsSync(path.join(root, file)))
        .map(file => [
          file,
          createHash('sha256')
            .update(fs.readFileSync(path.join(root, file)))
            .digest('hex'),
        ]),
    );
    for (const [size, shared] of [
      [1000, 10],
      [10000, 100],
      [100000, 100],
      [100000, 1000],
    ]) {
      if (
        report.financial.some(
          s =>
            s.size === size &&
            s.shared === shared &&
            s.operation === 'idempotentReplay',
        )
      )
        continue;
      for (
        let iteration = 0;
        iteration < (version === 'before' && size === 100000 ? 1 : 3);
        iteration++
      ) {
        const f = realSQLite();
        try {
          report.sqlite = f.native
            .prepare('SELECT sqlite_version() AS version')
            .get().version;
          for (const sql of SQLITE_SCHEMA_STATEMENTS) f.native.exec(sql);
          await applyVersionedMigrations(f.database);
          f.native.exec('BEGIN');
          for (const sql of seedStatements(size, shared)) f.native.exec(sql);
          f.native.exec('COMMIT');
          const api = createSharedExpenseApi(
            createSqliteSharedExpenseRepository(f.database),
          );
          await campaign(api, async (operation, command) => {
            const queries = [];
            const execute = f.database.executeSql;
            let begin, end;
            f.database.executeSql = async (sql, values = []) => {
              const start = performance.now();
              const result = await execute(sql, values);
              const rows = result[0].rows;
              queries.push({
                sql,
                rows: rows.length,
                characters: JSON.stringify(rows.raw()).length,
                ms: performance.now() - start,
              });
              if (sql.startsWith('BEGIN')) begin = start;
              if (sql.startsWith('COMMIT')) end = performance.now();
              return result;
            };
            let result;
            const start = performance.now();
            try {
              result = await command();
            } finally {
              f.database.executeSql = execute;
            }
            const milliseconds = performance.now() - start;
            report.samples.push({
              size,
              shared,
              iteration,
              operation,
              milliseconds,
              transactionMs: begin === undefined ? null : end - begin,
              reads: queries.filter(q =>
                /^\s*(SELECT|WITH|PRAGMA)/i.test(q.sql),
              ).length,
              rows: queries.reduce((n, q) => n + q.rows, 0),
              characters: queries.reduce((n, q) => n + q.characters, 0),
            });
            if (iteration === 0) {
              if (operation === 'idempotentReplay') {
                report.exactBinary = report.exactBinary || [];
                report.exactBinary.push({
                  size,
                  shared,
                  state: exactDigest(f.native),
                });
              }
              const summary = await getDashboardSummaryFromDb(
                f.database,
                new Date('2026-10-12T12:00:00Z'),
              );
              // Generated purchase IDs are normalized by dedupe_key; all relationships are retained.
              const generated = f.native
                .prepare(
                  'SELECT id,dedupe_key FROM transactions WHERE dedupe_key IS NOT NULL',
                )
                .all();
              const normalize = text =>
                generated
                  .reduce((s, r) => s.split(r.id).join(r.dedupe_key), text)
                  .replace(/tx_manual_\d+(?:_\d+)?/g, 'generated-purchase');
              const tables = [
                'accounts',
                'transactions',
                'shared_contacts',
                'shared_expenses',
                'transaction_splits',
                'shared_receipts',
                'shared_allocations',
                'shared_returns',
                'shared_loss_events',
                'shared_commands',
                'installment_purchases',
                'credit_card_statements',
              ];
              const state = {};
              for (const table of tables) {
                const rows = f.native
                  .prepare(`SELECT * FROM ${table} ORDER BY id`)
                  .all()
                  .map(row =>
                    Object.fromEntries(
                      Object.entries(row).filter(
                        ([key]) => !['created_at', 'updated_at'].includes(key),
                      ),
                    ),
                  );
                state[table] = {
                  count: rows.length,
                  sha256: createHash('sha256')
                    .update(normalize(JSON.stringify(rows)))
                    .digest('hex'),
                };
              }
              report.financial.push({
                size,
                shared,
                operation,
                summary,
                result: JSON.parse(normalize(JSON.stringify(result))),
                state: JSON.parse(normalize(JSON.stringify(state))),
              });
            }
            fs.writeFileSync(output, JSON.stringify(report));
            console.log(
              version,
              size,
              shared,
              iteration,
              operation,
              Math.round(milliseconds),
              'ms',
            );
            return result;
          });
          expect(f.native.prepare('PRAGMA foreign_key_check').all()).toEqual(
            [],
          );
        } finally {
          f.native.close();
        }
      }
      fs.writeFileSync(
        `docs/performance/shared-commands/node-${version}.json`,
        JSON.stringify(report),
      );
      console.log(version, size, shared, 'complete');
    }
    if (version === 'after') {
      const before = JSON.parse(
        fs.readFileSync(
          'docs/performance/shared-commands/node-before.json',
          'utf8',
        ),
      );
      // Independent measurements can finish while the original quadratic campaign runs.
      // Every available original checkpoint is compared now; final completeness is enforced by summarize.js.
      expect(
        report.financial.filter(s =>
          before.financial.some(
            b =>
              b.size === s.size &&
              b.shared === s.shared &&
              b.operation === s.operation,
          ),
        ),
      ).toEqual(before.financial);
      report.comparedOriginalCheckpoints = before.financial.length;
      report.financialComparisonComplete = before.financial.length === 72;
      fs.writeFileSync(output, JSON.stringify(report));
    }
    jest.useRealTimers();
  },
  3600000,
);
