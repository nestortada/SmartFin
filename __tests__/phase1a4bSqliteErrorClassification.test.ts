// Phase 1a.4B r4: the same missing-table error written differently by node:sqlite and by the Android driver.
// Part 1 reproduces the r3 stop (phase1a3b-flows / v4-v5-flows) with the real Node run and the real Android message
// recorded in docs/validacion-fase1a4b/r3/android/api24/phase1a3b-flows/result.json.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { manageSQLiteDatabase } from '../src/database/managedSQLite';
import { SHARED_LOSS_SCHEMA } from '../src/modules/transactions/database/sharedLossSchema';
import {
  SHARED_EXPENSE_INDEXES,
  SHARED_EXPENSE_SCHEMA,
  SHARED_EXPENSE_TRIGGERS,
} from '../src/modules/transactions/database/sharedExpenseSchema';
import { INSTALLMENT_HISTORY_SCHEMA } from '../src/modules/creditCards/database/installmentHistorySchema';
import { errorClass, missingTableName, runPhase1A3BFlows } from '../scripts/phase1a4b/phase1a3bProbes';

const fs = require('node:fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
const DEFERRED = [...SHARED_LOSS_SCHEMA, ...SHARED_EXPENSE_SCHEMA, ...SHARED_EXPENSE_INDEXES, ...SHARED_EXPENSE_TRIGGERS,
  ...INSTALLMENT_HISTORY_SCHEMA];
const R3_FLOWS = 'docs/validacion-fase1a4b/r3/android/api24/phase1a3b-flows/result.json';
const GUARD_QUERY = /^SELECT 1 AS found FROM installment_allocations a\s+JOIN installment_purchases p ON p\.id = a\.installment_purchase_id\s+WHERE p\.transaction_id = \? AND a\.status = 'active' LIMIT 1;$/;
/** Branches of errorClass() evaluated before its 'other: ' fallback (scripts/phase1a4b/phase1a3bProbes.ts, r3). */
const EARLIER_BRANCHES = [/debe estar activa|imputada no existe|no corresponde a la tarjeta|otro pago|activa a revertida|fuera de secuencia|cuotas de la revisi|admite una revisi|reiniciarse con una revisi|solo inserci|antes de eliminarlo|antes de modificarlo|antes de eliminarla|cambiar de identificador/,
  /CHECK constraint/i, /UNIQUE constraint|PRIMARY KEY/i, /FOREIGN KEY/i, /NOT NULL constraint/i];
const r3Classification = (text: string) => 'other: ' + text; // the r3 result for messages that reach the fallback

/** The real Android message of the r3 stop. */
function androidMessage() {
  const report = JSON.parse(fs.readFileSync(R3_FLOWS, 'utf8')) as { failure: string; config: { api: number } };
  const prefix = 'Error: Version 4 guarded step: other: ';
  expect(report.config.api).toBe(24);
  expect(report.failure.startsWith(prefix)).toBe(true);
  return report.failure.slice(prefix.length);
}

/** Real Node run of the derived flows with every SQL error and statement recorded at the raw adapter. */
async function nodeFlows() {
  const sql = realSQLite();
  sql.native.exec('PRAGMA foreign_keys = ON;');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) if (!DEFERRED.includes(statement)) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  const errors: { order: number; sql: string; message: string }[] = [];
  const original = sql.database.executeSql.bind(sql.database);
  (sql.database as unknown as { executeSql: typeof original }).executeSql = (async (text: string, values?: unknown[]) => {
    try { return await original(text, values as never); } catch (error) {
      errors.push({ order: sql.trace.length, sql: text, message: String((error as { message?: unknown }).message) });
      throw error;
    }
  }) as typeof original;
  const database = manageSQLiteDatabase(sql.database);
  sql.resetTrace();
  try {
    const result = await runPhase1A3BFlows(database, async run => {
      const start = sql.trace.length; await run(); return sql.trace.slice(start).filter(entry => entry.write !== undefined).length;
    });
    return { result, errors, trace: [...sql.trace] };
  } finally { sql.native.close(); }
}

describe('phase 1a.4B r4 — reproduction of the r3 stop (no such table)', () => {
  let node: Awaited<ReturnType<typeof nodeFlows>>;
  beforeAll(async () => { node = await nodeFlows(); }, 300000);

  test('Node and Android report the same missing table, but the r3 classification differs', () => {
    const android = androidMessage();
    const [error] = node.errors;
    expect(error!.message).toBe('no such table: installment_allocations');
    expect(android.startsWith('no such table: installment_allocations (code 1): , while compiling: ')).toBe(true);
    for (const text of [error!.message, android]) for (const branch of EARLIER_BRANCHES) expect([text, branch.test(text)]).toEqual([text, false]);
    expect(r3Classification(error!.message)).toBe('other: no such table: installment_allocations');
    expect(r3Classification(android)).not.toBe(r3Classification(error!.message));
  });

  test('the error comes from the expected guard query, on version 4, and has no second cause', () => {
    const android = androidMessage();
    // Two SQL errors in the whole Node run, both recorded: the 1a.4B guard of the edit on the version 4 database, and the
    // first-round FOREIGN KEY refusal of resetSyntheticData (DELETE FROM "accounts", caught and retried by design) when
    // the version 5 half re-seeds. No other error.
    expect(node.errors.map(error => [error.sql.trim().split(/\s+/).slice(0, 3).join(' '), error.message])).toEqual([
      ['SELECT 1 AS', 'no such table: installment_allocations'],
      ['DELETE FROM "accounts"', 'FOREIGN KEY constraint failed'],
    ]);
    expect(node.errors[0]!.sql.trim()).toMatch(GUARD_QUERY);
    // The Android driver names the same statement after "while compiling:".
    expect(android.slice(android.indexOf('while compiling: ') + 'while compiling: '.length).trim()).toMatch(GUARD_QUERY);
    // The table really is absent: the version 4 downgrade dropped it before the attempt.
    const index = node.trace.findIndex(entry => entry.outcome === 'sql-error');
    const drop = node.trace.slice(0, index).map(entry => entry.sql.trim()).lastIndexOf('DROP TABLE IF EXISTS installment_allocations');
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(node.trace.slice(drop + 1, index).some(entry => /CREATE TABLE[^(]*installment_allocations/i.test(entry.sql))).toBe(false);
  });

  test('writes before the guard happen inside the edit transaction and are rolled back; nothing is committed', () => {
    const index = node.trace.findIndex(entry => entry.outcome === 'sql-error');
    const begin = node.trace.slice(0, index).map(entry => entry.sql.trim()).lastIndexOf('BEGIN IMMEDIATE;');
    const inside = node.trace.slice(begin + 1, index);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(inside.some(entry => /^(COMMIT|ROLLBACK)/.test(entry.sql.trim()))).toBe(false);
    // Recorded as found: saveManualTransaction upserts the movement before saveTransactionInstallments runs the guard.
    expect(inside.filter(entry => entry.write !== undefined).map(entry => entry.sql.trim().split(/\s+/).slice(0, 3).join(' ')))
      .toEqual(['UPDATE transactions SET', 'INSERT INTO transactions']);
    expect(node.trace[index + 1]!.sql.trim()).toBe('ROLLBACK;');
    expect(node.trace.slice(index + 1).find(entry => /^(COMMIT|ROLLBACK)/.test(entry.sql.trim()))!.sql.trim()).toBe('ROLLBACK;');
    // The probe compared the complete state before and after the failed step (every table, rowids, schema).
    expect((node.result as { version4Incompatible: unknown }).version4Incompatible)
      .toEqual({ firstGuardedStep: 'editTerms', outcome: 'other: no such table: installment_allocations', stateUnchanged: true });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Part 2 (r4 correction, scripts/phase1a4b/derive-probes.cjs): stable class for "no such table", nothing else changes.

const message = (text: string) => ({ message: text }); // driver rejections are message objects, not always Errors
const ANDROID_SUFFIX = ' (code 1): , while compiling: SELECT 1 AS found FROM installment_allocations a';

describe('phase 1a.4B r4 — missing-table classification', () => {
  test('Node and Android (real r3 message) give exactly the same class', () => {
    const android = androidMessage();
    expect(errorClass(message('no such table: installment_allocations'))).toBe('other: no such table: installment_allocations');
    expect(errorClass(message(android))).toBe('other: no such table: installment_allocations');
    expect(missingTableName(android)).toBe('installment_allocations');
    // r5: only the observed spellings are recognized (phase1a4bSqliteErrorClassificationR5.test.ts). These two r4
    // spellings were never observed and the statement is not the guard query: no longer recognized, full text kept.
    for (const code of ['(code 1 SQLITE_ERROR)', '(code 1 SQLITE_ERROR[1])']) {
      const text = `no such table: installment_allocations ${code}: , while compiling: SELECT * FROM installment_allocations`;
      expect(errorClass(message(text))).toBe('other: ' + text);
    }
  });

  test.each([
    ['another missing table (Node)', 'no such table: installment_plan_revisions', 'other: no such table: installment_plan_revisions'],
    // r5: a statement that is not listed for that table is not recognized; the full text is kept (still a distinct class).
    ['another missing table (Android)', 'no such table: installment_plan_revisions (code 1): , while compiling: SELECT * FROM installment_plan_revisions',
      'other: no such table: installment_plan_revisions (code 1): , while compiling: SELECT * FROM installment_plan_revisions'],
    ['FOREIGN KEY (Node)', 'FOREIGN KEY constraint failed', 'foreignKey'],
    ['FOREIGN KEY (Android)', 'FOREIGN KEY constraint failed (code 787)', 'foreignKey'],
    ['CHECK', 'CHECK constraint failed: installment_allocations', 'check'],
    ['UNIQUE', 'UNIQUE constraint failed: installment_allocations.id', 'unique'],
    ['syntax', 'near "SELEC": syntax error', 'other: near "SELEC": syntax error'],
    ['transaction', 'cannot start a transaction within a transaction', 'other: cannot start a transaction within a transaction'],
    ['unknown', 'database is locked', 'other: database is locked'],
    ['own RAISE', 'El pago tiene imputaciones activas: reviértelas antes de eliminarlo', 'raise:antes de eliminarlo'],
  ])('%s keeps its own class', (_label, text, expected) => {
    expect(errorClass(message(text))).toBe(expected);
    expect(errorClass(message(text))).not.toBe('other: no such table: installment_allocations');
  });

  test.each([
    ['no table name', 'no such table: '],
    ['no space', 'no such table:installment_allocations'],
    ['trailing text', 'no such table: installment_allocations; something else'],
    ['prefixed', 'Error: no such table: installment_allocations'],
    ['schema-qualified', 'no such table: main.installment_allocations'],
    ['other result code', 'no such table: installment_allocations (code 11): , while compiling: SELECT * FROM installment_allocations'],
    ['statement names another table', 'no such table: installment_allocations (code 1): , while compiling: SELECT * FROM installment_purchases'],
    ['statement only contains the name as a prefix', 'no such table: installment_allocations (code 1): , while compiling: SELECT * FROM installment_allocations_old'],
    ['suffix without a statement', 'no such table: installment_allocations' + ANDROID_SUFFIX.split(' while compiling:')[0]],
  ])('malformed or different message (%s) is not recognized and keeps its full text', (_label, text) => {
    expect(missingTableName(text)).toBeUndefined();
    expect(errorClass(message(text))).toBe('other: ' + text);
  });

  test('non-message rejections and success keep their previous classes', () => {
    expect(errorClass(undefined)).toBe('accepted');
    expect(errorClass({ code: 5 })).toBe('other: {"code":5}');
  });
});

describe('phase 1a.4B r4 — v4-v5-flows on Node with the corrected class', () => {
  let node: Awaited<ReturnType<typeof nodeFlows>>;
  beforeAll(async () => { node = await nodeFlows(); }, 300000);

  test('the whole flows result equals the current 1a.4B reference (version 4 and version 5)', () => {
    const reference = JSON.parse(fs.readFileSync('docs/validacion-fase1a4b/node/results.json', 'utf8')) as { phase1a3b: { flows: unknown } };
    expect(JSON.parse(JSON.stringify(node.result))).toEqual(reference.phase1a3b.flows);
  });

  test('version 4: the stable error, rolled back, no transaction left open, state compared by the probe', () => {
    const v4 = (node.result as { version4Incompatible: Record<string, unknown> }).version4Incompatible;
    expect(v4).toEqual({ firstGuardedStep: 'editTerms', outcome: 'other: no such table: installment_allocations', stateUnchanged: true });
    const index = node.trace.findIndex(entry => entry.outcome === 'sql-error');
    expect(node.trace[index + 1]!.sql.trim()).toBe('ROLLBACK;');
    // The next transaction (migration 5 re-applied) starts and commits on the same connection.
    const next = node.trace.slice(index + 2);
    expect(next.find(entry => /^(BEGIN|COMMIT|ROLLBACK)/.test(entry.sql.trim()))!.sql.trim()).toMatch(/^BEGIN( IMMEDIATE)?;$/);
    expect(next.some(entry => entry.sql.trim() === 'COMMIT;')).toBe(true);
  });

  test('version 5: the tables exist and no missing-table error is accepted there', () => {
    const migrated = node.trace.findIndex((entry, i) => i > node.trace.findIndex(e => e.outcome === 'sql-error') &&
      /^INSERT INTO schema_migrations VALUES \(5/.test(entry.sql.trim()));
    expect(migrated).toBeGreaterThan(0);
    expect(node.errors.filter(error => error.order > migrated && /no such table/.test(error.message))).toEqual([]);
    const v5 = (node.result as { version5: { steps: Record<string, unknown> } }).version5;
    expect(Object.keys(v5.steps).length).toBeGreaterThan(0);
  });
});
