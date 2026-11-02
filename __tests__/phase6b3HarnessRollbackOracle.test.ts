jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
jest.mock('react-native-config', () => ({}));

import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { runSharedSQLiteTransaction, SQLiteCommandFailure } from '../src/database/atomicSQLite';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import { createSqliteAccountRepository } from '../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { saveManualTransaction } from '../src/modules/transactions/useCases/saveManualTransaction';
import { registerCreditCardPayment } from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { getDashboardSummaryFromDb } from '../src/modules/dashboard/useCases/getDashboardSummary';
import { PHASE6B3_DATE } from '../scripts/phase6b3/probes';
import { withPhase1A2Clock } from '../scripts/phase1a2/probes';
import { resetSyntheticData } from '../scripts/phase6b/probes';

// 6B.3.1 r3: the Android phase6b3-atomicity oracle. The previous assertion demanded a SQLiteCommandFailure
// with status 'rolledBack', which creditCardPaymentScope never throws (a confirmed ROLLBACK rethrows the
// original error). The shipped oracle is evaluated here from the exact bytes of androidHarness.js and checked
// against the Node trace (one ROLLBACK ok, no COMMIT) on the same matrix and the same fault semantics as the
// prepared managedSQLite of the synthetic APK (count INSERT/UPDATE/DELETE/REPLACE, throw before/after).
const fs = require('node:fs') as { readFileSync: (f: string, e: string) => string };
const vm = require('node:vm') as { Script: new (code: string) => { runInThisContext: () => unknown } };

type Verdict = (evidence: Record<string, unknown>) => Promise<string>;
function shippedOracle(): Verdict {
  const source = fs.readFileSync('scripts/phase6b3/androidHarness.js', 'utf8');
  // From the line after the opening marker (its own line is a comment) to the closing marker.
  const opening = source.split('// <rollback-oracle>')[1];
  const block = opening?.slice(opening.indexOf('\n')).split('// </rollback-oracle>')[0];
  if (!block) throw new Error('rollback oracle markers not found');
  // Jest runs each suite in its own realm: hand the oracle this realm's Error and String.
  const factory = new vm.Script(`(function (Error, String) {${block}\nreturn confirmedRollbackVerdict;})`).runInThisContext();
  return (factory as (error: ErrorConstructor, string: StringConstructor) => Verdict)(Error, String);
}
const verdict = shippedOracle();

/** Same diagnostic as the harness: first differing path, keys sorted. */
function firstDifference(a: unknown, b: unknown, at = '$'): string | undefined {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const difference = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${at}.${key}`);
      if (difference) return difference;
    }
    return undefined;
  }
  return JSON.stringify(a) === JSON.stringify(b) ? undefined : `${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}

let deletionFault: { write: number; count: number; phase: string; sql?: string[] } | undefined;

async function open() {
  const sql = realSQLite({ fixedSqlDate: PHASE6B3_DATE });
  sql.native.exec('PRAGMA foreign_keys = ON;');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  const executeSql = sql.database.executeSql.bind(sql.database);
  (sql.database as unknown as { executeSql: unknown }).executeSql = async (query: string, values?: unknown[]) => {
    const fault = deletionFault;
    const counted = fault && /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query);
    if (counted) fault.sql?.push(query);
    const selected = counted && ++fault.count === fault.write;
    if (selected && fault.phase === 'before') throw new Error('Injected before deletion write');
    const rows = await executeSql(query, values as never);
    if (selected && fault.phase === 'after') throw new Error('Injected after deletion write');
    return rows;
  };
  return sql;
}
type Sql = Awaited<ReturnType<typeof open>>;
const deps = (database: SmartFinSQLiteDatabase) => ({ accountRepository: createSqliteAccountRepository(database),
  creditCardRepository: createSqliteCreditCardRepository(database), transactionRepository: createSqliteTransactionRepository(database) });

async function seed(database: SmartFinSQLiteDatabase, purchases: readonly number[]) {
  await resetSyntheticData(database);
  await database.executeSql(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES
    ('bank','Banco sintetico','bankAccount','active','COP',1000000,NULL,'2026-01-01','2026-01-01'),
    ('card','Visa sintetica','creditCard','active','COP',0,0,'2026-01-01','2026-01-01')`);
  for (const amount of purchases) {
    const d = deps(database);
    await saveManualTransaction({ ...d, accounts: await d.accountRepository.getAccounts(), accountId: 'card', amount,
      merchantName: 'Sintetico 6B.3.1', operationType: 'Crédito', transactionType: 'expense', hasInterestFreeInstallments: false,
      installmentCountInput: '1', interestFreeInstallmentCountInput: '', currentDate: PHASE6B3_DATE });
  }
}
/** Every table, the dashboard metrics and integrity, as the harness state(). */
async function state(sql: Sql) {
  const names = sql.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").rows.raw();
  const tables: Record<string, unknown[]> = {};
  for (const { name } of names as Array<{ name: string }>) tables[name] = sql.query(`SELECT * FROM "${name}" ORDER BY rowid`).rows.raw();
  const integrity = sql.query('PRAGMA integrity_check').rows.raw();
  const foreignKeys = sql.query('PRAGMA foreign_key_check').rows.raw();
  if (integrity[0]?.integrity_check !== 'ok' || foreignKeys.length) throw new Error('SQLite integrity/foreign keys');
  return { tables, metrics: await getDashboardSummaryFromDb(sql.database, PHASE6B3_DATE) };
}
const request = (database: SmartFinSQLiteDatabase, amount: number) => ({ ...deps(database), accountId: 'card', sourceAccountId: 'bank',
  amount, settlement: 'fullDebt' as const, currentDate: PHASE6B3_DATE });

/** One harness case: seed, fault, payment, then the shipped oracle. Returns the trace of that payment. */
async function rollbackCase(sql: Sql, purchases: readonly number[], debt: number, write: number, phase: 'before' | 'after',
  tamper?: { afterFailure?: () => void; rollbackFails?: boolean; nextOwner?: string; clock?: Date }) {
  // 1a.2: optional pinned JS clock for the seed and the payment, as the harness matrix does.
  const at = <T,>(run: () => Promise<T>) => (tamper?.clock ? withPhase1A2Clock(tamper.clock, run) : run());
  await at(() => seed(sql.database, purchases));
  const before = await state(sql);
  sql.resetTrace();
  if (tamper?.rollbackFails) sql.injectFault({ sql: 'ROLLBACK', phase: 'before' });
  const fault = { write, count: 0, phase, sql: [] as string[] };
  deletionFault = fault;
  let failure: unknown;
  try { await at(() => registerCreditCardPayment(request(sql.database, debt))); } catch (error) { failure = error; } finally { deletionFault = undefined; }
  const paymentTrace = sql.trace.map(entry => ({ sql: entry.sql, outcome: entry.outcome }));
  tamper?.afterFailure?.();
  const legacyAssertion = failure instanceof SQLiteCommandFailure && failure.result.status === 'rolledBack';
  const outcome = verdict({
    failure, faultFired: fault.count >= write, injected: `Injected ${phase} deletion write`, before,
    readState: () => state(sql),
    openNextOwner: async () => tamper?.nextOwner ?? (await runSharedSQLiteTransaction(sql.database, async () => 'closed')).status,
    difference: firstDifference, CommandFailure: SQLiteCommandFailure,
  });
  return { failure, legacyAssertion, outcome, paymentTrace, faultedSql: fault.sql[write - 1] };
}
const controls = (trace: Array<{ sql: string; outcome: string }>, statement: string) =>
  trace.filter(entry => entry.sql.startsWith(statement));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(PHASE6B3_DATE);
});
afterEach(() => { deletionFault = undefined; jest.useRealTimers(); });

const MATRIX = [[[0.4], 0.4], [[10000.4], 10000.4], [[4229.9, 89392.54, 939.56], 94562]] as const;

test.each(MATRIX)('purchases %p: every Android fault point is a confirmed rollback for the shipped oracle, not for the old one',
  async (purchases, debt) => {
    const sql = await open();
    try {
      await seed(sql.database, purchases);
      deletionFault = { write: Number.MAX_SAFE_INTEGER, count: 0, phase: 'before' };
      await registerCreditCardPayment(request(sql.database, debt));
      const writes = deletionFault.count;
      deletionFault = undefined;
      expect(writes).toBe(10); // write-count-<debt> on API 24 and API 35
      let points = 0;
      for (let write = 1; write <= writes; write++) for (const phase of ['before', 'after'] as const) {
        const result = await rollbackCase(sql, purchases, debt, write, phase);
        expect(result.legacyAssertion).toBe(false); // the 6B.3.1 Android failure, at every point
        expect(result.failure).toBeInstanceOf(Error);
        expect(result.failure).not.toBeInstanceOf(SQLiteCommandFailure);
        await expect(result.outcome).resolves.toBe('rolledBack');
        expect(controls(result.paymentTrace, 'BEGIN')).toEqual([{ sql: 'BEGIN IMMEDIATE;', outcome: 'ok' }]);
        expect(controls(result.paymentTrace, 'ROLLBACK')).toEqual([{ sql: 'ROLLBACK;', outcome: 'ok' }]);
        expect(controls(result.paymentTrace, 'COMMIT')).toEqual([]);
        points++;
      }
      expect(points).toBe(20);
    } finally { sql.native.close(); }
  });

describe('a defective rollback still fails the shipped oracle', () => {
  test('ROLLBACK fails: unknown, rejected, and the payment is not retried', async () => {
    const sql = await open();
    try {
      const result = await rollbackCase(sql, [0.4], 0.4, 3, 'before', { rollbackFails: true });
      expect(result.failure).toBeInstanceOf(SQLiteCommandFailure);
      expect((result.failure as SQLiteCommandFailure).result.status).toBe('unknown');
      await expect(result.outcome).rejects.toThrow('Rollback not confirmed: unknown');
      expect(controls(result.paymentTrace, 'BEGIN')).toHaveLength(1);
      expect(controls(result.paymentTrace, 'ROLLBACK')).toEqual([{ sql: 'ROLLBACK;', outcome: 'injected-before' }]);
    } catch (error) { sql.native.close(); throw error; }
    // The runner retired the uncertain connection; nothing else ran on it.
    expect(() => sql.native.close()).toThrow('database is not open');
  });

  test('a partial write that survives the failure is rejected', async () => {
    const sql = await open();
    try {
      const result = await rollbackCase(sql, [10000.4], 10000.4, 5, 'after', {
        afterFailure: () => sql.native.exec("UPDATE accounts SET balance_amount = balance_amount - 10000.4 WHERE id = 'bank'"),
      });
      await expect(result.outcome).rejects.toThrow(/^Rollback changed tables, audit, revision or metrics: \$\.(metrics|tables)\./);
    } finally { sql.native.close(); }
  });

  test('a transaction left open is rejected', async () => {
    const sql = await open();
    try {
      const result = await rollbackCase(sql, [0.4], 0.4, 1, 'before', { nextOwner: 'unknown' });
      await expect(result.outcome).rejects.toThrow('Transaction left open after the failure: unknown');
    } finally { sql.native.close(); }
  });
});

describe('the oracle never accepts an unexpected outcome', () => {
  const base = { faultFired: true, injected: 'Injected before deletion write', before: {}, readState: async () => ({}),
    openNextOwner: async () => 'confirmed', difference: firstDifference, CommandFailure: SQLiteCommandFailure };
  test.each([
    ['no failure', { failure: undefined }, 'The injected fault did not make the payment fail'],
    ['fault not reached', { failure: new Error('Injected before deletion write'), faultFired: false }, 'The injected write was not reached'],
    ['domain error', { failure: new Error('La deuda de la tarjeta cambio') }, 'Unexpected payment error: La deuda de la tarjeta cambio'],
    ['non-Error value', { failure: 'Injected before deletion write' }, 'Unexpected payment error: Injected before deletion write'],
    ['unknown', { failure: new SQLiteCommandFailure({ status: 'unknown', error: new Error('lost') }) }, 'Rollback not confirmed: unknown'],
    ['wrapped rolledBack', { failure: new SQLiteCommandFailure({ status: 'rolledBack', error: new Error('x') }) }, 'Rollback not confirmed: rolledBack'],
    ['connection retired', { failure: new Error('Injected before deletion write'), readState: async () => { throw new Error('retired'); } },
      'Connection retired: rollback not confirmed'],
  ])('%s', async (_label, evidence, message) => {
    await expect(verdict({ ...base, ...evidence })).rejects.toThrow(message);
  });
});

// 1a.2 matrix clock. The harness seeded with saveManualTransaction, which reconciles with Date.now(): on a device
// (1 Nov 2026 in Bogota) it stored the November statement, and the payment dated 11 Oct then found its cycle
// superseded (1a.2 historical protection): no statement write, 8 writes (scenario A, observed on API 24 and 35).
// The harness now pins seed and payment to PHASE6B3_DATE (scenario B): 10 writes, two of them statement writes.
// Scenario A stays as a deterministic historical-protection matrix with a pinned misaligned clock.
describe('1a.2: matrix clock (historical protection vs aligned cycle)', () => {
  const DEVICE_CLOCK = new Date('2026-11-02T04:38:46.000Z');
  beforeEach(() => jest.setSystemTime(DEVICE_CLOCK));
  const statements = (sql: Sql) => sql.query('SELECT * FROM credit_card_statements ORDER BY id').rows.raw();
  const accounts = (sql: Sql) => sql.query('SELECT id,balance_amount,debt_balance_amount FROM accounts ORDER BY id').rows.raw();

  async function successfulRun(sql: Sql, purchases: readonly number[], debt: number, clock: Date) {
    await withPhase1A2Clock(clock, () => seed(sql.database, purchases));
    const before = statements(sql);
    deletionFault = { write: Number.MAX_SAFE_INTEGER, count: 0, phase: 'before', sql: [] };
    const result = await withPhase1A2Clock(clock, () => registerCreditCardPayment(request(sql.database, debt)));
    const writes = deletionFault.sql!;
    deletionFault = undefined;
    return { result, writes, before, after: statements(sql), accounts: accounts(sql) };
  }
  const statementPositions = (writes: string[]) =>
    writes.flatMap((query, index) => (query.includes('credit_card_statements') ? [index + 1] : []));

  test.each(MATRIX)('purchases %p: misaligned clock = 8 writes, no statement write, history untouched; aligned = 10',
    async (purchases, debt) => {
      const sql = await open();
      try {
        const historical = await successfulRun(sql, purchases, debt, DEVICE_CLOCK);
        expect(historical.writes).toHaveLength(8);
        expect(statementPositions(historical.writes)).toEqual([]);
        expect(historical.after).toEqual(historical.before); // only the November row, unchanged
        expect(historical.before.map(row => row.statement_end_date)).toEqual(['2026-11-30']);
        const aligned = await successfulRun(sql, purchases, debt, PHASE6B3_DATE);
        expect(aligned.writes).toHaveLength(10);
        // Order: reconcile (card upsert 1-2, statement 3), source debit 4-5, payment 6-7, reconcile (card 8-9, statement 10).
        expect(statementPositions(aligned.writes)).toEqual([3, 10]);
        expect(aligned.before.map(row => [row.statement_end_date, row.status])).toEqual([['2026-10-31', 'pending']]);
        expect(aligned.after.map(row => [row.statement_end_date, row.total_amount, row.status])).toEqual([['2026-10-31', 0, 'paid']]);
        // Same financial result either way: debt settled exactly, bank debited by the debt.
        expect(historical.accounts).toEqual(aligned.accounts);
        expect(aligned.accounts.find(row => row.id === 'card')?.debt_balance_amount).toBe(0);
        expect(aligned.result.remainingDebt).toBe(0);
      } finally { sql.native.close(); }
    });

  test.each([['aligned', PHASE6B3_DATE, 10], ['historical', DEVICE_CLOCK, 8]] as const)(
    '%s clock: every fault point (statement writes included) is a confirmed rollback with the exact state restored',
    async (_name, clock, writes) => {
      const sql = await open();
      try {
        for (const [purchases, debt] of MATRIX) {
          let statementPoints = 0;
          for (let write = 1; write <= writes; write++) for (const phase of ['before', 'after'] as const) {
            const result = await rollbackCase(sql, purchases, debt, write, phase, { clock });
            await expect(result.outcome).resolves.toBe('rolledBack');
            expect(result.failure).toBeInstanceOf(Error);
            expect(result.failure).not.toBeInstanceOf(SQLiteCommandFailure);
            expect(controls(result.paymentTrace, 'BEGIN')).toEqual([{ sql: 'BEGIN IMMEDIATE;', outcome: 'ok' }]);
            expect(controls(result.paymentTrace, 'ROLLBACK')).toEqual([{ sql: 'ROLLBACK;', outcome: 'ok' }]);
            expect(controls(result.paymentTrace, 'COMMIT')).toEqual([]);
            if (result.faultedSql?.includes('credit_card_statements')) statementPoints++;
          }
          // The two statement writes are really faulted, before and after, only with the aligned clock.
          expect(statementPoints).toBe(writes === 10 ? 4 : 0);
        }
      } finally { sql.native.close(); }
    });
});
