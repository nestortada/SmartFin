jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
jest.mock('react-native-config', () => ({}));

import { realSQLite, type SQLiteFault } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { manageSQLiteDatabase } from '../src/database/managedSQLite';
import { runSharedSQLiteTransaction } from '../src/database/atomicSQLite';
import { buildIntegratedScenario, integratedFixture, inspectIntegrated, DATE } from '../scripts/phase5e/integration';
import type { SubscriptionReminderService } from '../src/modules/subscriptions/services/SubscriptionReminderService';
import { createSqliteFinancialDataRepository } from '../src/modules/settings/repositories/sqliteFinancialDataRepository';
import { saveAiDraftForReview } from '../src/modules/transactions/repositories/sqliteAiDraftRepository';
import { executeAiCommandPlan } from '../src/modules/transactions/useCases/executeAiCommandPlan';
import type { AiCommandPlan } from '../src/modules/transactions/types';
import { getDashboardSummaryFromDb } from '../src/modules/dashboard/useCases/getDashboardSummary';

const fs = require('node:fs') as { mkdirSync: (path: string, options: { recursive: boolean }) => void; writeFileSync: (path: string, value: string) => void; mkdtempSync: (prefix: string) => string; unlinkSync: (path: string) => void; rmdirSync: (path: string) => void };
const { tmpdir } = require('node:os') as { tmpdir: () => string };
const { join } = require('node:path') as { join: (...parts: string[]) => string };
const evidence: Record<string, unknown> = {};
const inventory = { reminderIds: [], workIds: [], backupJobIds: [], snapshotIds: [] };
const deletionId = '55555555-5555-4555-8555-555555555555';
function reminders(): SubscriptionReminderService {
  return { getStatus: async () => ({ available: true, permission: 'granted' }), requestPermission: async () => ({ available: true, permission: 'granted' }),
    schedule: jest.fn(async () => undefined), cancel: jest.fn(async () => undefined), cancelAll: jest.fn(async () => undefined), ensureMaintenance: jest.fn(async () => undefined) };
}
async function fixture(full = true, syntheticPath?: string) {
  const sql = realSQLite({ fixedSqlDate: DATE, syntheticPath });
  sql.native.exec('PRAGMA foreign_keys=ON');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  const database = manageSQLiteDatabase(sql.database);
  const service = reminders();
  const f = await integratedFixture(database, service);
  const states = full ? await buildIntegratedScenario(f) : [];
  return { ...sql, ...f, service, states };
}
beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] }); jest.setSystemTime(DATE); });
afterEach(() => jest.useRealTimers());
afterAll(() => {
  fs.mkdirSync('docs/atomicidad-fase5e/node', { recursive: true });
  fs.writeFileSync('docs/atomicidad-fase5e/node/integration.json', JSON.stringify(evidence, null, 2));
});

test('one financial history: real commands preserve exact metrics, references, audit, obligations and receipts', async () => {
  const f = await fixture();
  try {
    const final = await inspectIntegrated(f.database);
    expect(Object.keys(final.tables)).toEqual(Object.keys(final.columns));
    expect(Object.keys(final.tables).length).toBeGreaterThanOrEqual(39);
    expect(final.metrics).toEqual({ available: 1148700, wealth: 1088700, debt: 60000, income: 200000, expense: 151300 });
    evidence.scenario = f.states;
  } finally { f.native.close(); }
});

test('acceptance reports must exclude managed database handles from capture evidence', async () => {
  const f = await fixture(false);
  try {
    expect(() => JSON.stringify({ captured: { database: f.database } })).toThrow('Unsupported managed SQLite member: toJSON');
    evidence.harnessSerialization = { reproduced: true, fix: 'Record snapshot and timings only; never serialize a managed connection', productionChanged: false };
  } finally { f.native.close(); }
});

test('payment and dashboard + manual write and subscription maintenance serialize without partial reads', async () => {
  const f = await fixture();
  try {
    f.resetTrace();
    const barrier = f.pauseNextExecuteSql('UPDATE accounts', 'after');
    const payment = f.payment(10000);
    await barrier.reached;
    let read = false;
    const dashboard = getDashboardSummaryFromDb(f.database, DATE).then(value => { read = true; return value; });
    await Promise.resolve(); await Promise.resolve();
    expect(read).toBe(false);
    barrier.release();
    await payment;
    const summary = await dashboard;
    expect(summary.totalDebt).toBe(50000);
    expect(summary.netWorth).toBe(1088700);
    await Promise.all([f.save({ amount: 500 }), f.subscriptions.syncSubscriptions(), f.subscriptions.syncSubscriptions()]);
    const after = await inspectIntegrated(f.database);
    expect(after.metrics).toEqual({ available: 1138200, wealth: 1088200, debt: 50000, income: 200000, expense: 151800 });
    const controls = f.trace.filter(e => /^(BEGIN|COMMIT|ROLLBACK)/.test(e.sql));
    let depth = 0;
    for (const entry of controls) { if (entry.sql.startsWith('BEGIN')) expect(++depth).toBe(1); else expect(--depth).toBe(0); }
    expect(depth).toBe(0);
    evidence.concurrent = { controls, after };
  } finally { f.native.close(); }
});

test('reviewed AI plan queued behind manual write rejects stale revision without a second financial action', async () => {
  const f = await fixture();
  try {
    const plan: AiCommandPlan = { version: 1, summary: 'Stale integration', answeredFields: [], actions: [
      { id: 'x', entity: 'transaction', operation: 'create', fields: { accountId: 'bank', amount: 1000, transactionType: 'expense', description: 'stale', date: '2026-10-24' } },
    ] };
    await saveAiDraftForReview(f.database, { id: 'stale-ai', plan, phase: 'review', rawInput: 'synthetic', messages: [], clarificationHistory: [], createdAt: DATE.toISOString(), updatedAt: DATE.toISOString() });
    const barrier = f.pauseNextExecuteSql('UPDATE accounts', 'after');
    const manual = f.save({ amount: 500 });
    await barrier.reached;
    const ai = executeAiCommandPlan(f.database, 'stale-ai', plan).catch((error: unknown) => error);
    barrier.release(); await manual;
    const before = await inspectIntegrated(f.database);
    expect(await ai).toBeInstanceOf(Error);
    expect(await inspectIntegrated(f.database)).toEqual(before);
    evidence.stalePlan = before.metrics;
  } finally { f.native.close(); }
});

test('every deletion write rolls back the entire mixed financial history, including lifecycle and AI receipt', async () => {
  const discover = await fixture();
  let writes = 0;
  try {
    discover.resetTrace();
    expect((await createSqliteFinancialDataRepository(discover.database).deleteFinancialData(deletionId, inventory)).status).toBe('confirmed');
    expect(discover.trace.filter(e => /^DELETE FROM/.test(e.sql))).toHaveLength(36);
    writes = discover.trace.filter(e => e.write).length;
    expect(writes).toBe(38);
  } finally { discover.native.close(); }
  const positions = [];
  for (let write = 1; write <= writes; write++) for (const phase of ['before', 'after'] as const) {
    const f = await fixture();
    try {
      const before = await inspectIntegrated(f.database); f.resetTrace(); f.injectFault({ write, phase });
      const result = await createSqliteFinancialDataRepository(f.database).deleteFinancialData(deletionId, inventory);
      expect(result.status).toBe('rolledBack');
      expect(await inspectIntegrated(f.database)).toEqual(before);
      expect(f.service.cancelAll).not.toHaveBeenCalled();
      positions.push({ write, phase, status: result.status });
    } finally { f.native.close(); }
  }
  evidence.deletion = { writes, positions };
}, 60000);

test.each((['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK'] as const).flatMap(sql => (['before', 'after'] as const).map(phase => ({ sql, phase }))))(
  '$sql response loss $phase native action stays unknown and never retries the mixed command', async ({ sql, phase }) => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'smartfin-5e-unknown-'));
    const syntheticPath = join(directory, 'synthetic.db');
    const f = await fixture(true, syntheticPath);
    try {
      const before = await inspectIntegrated(f.database); f.resetTrace();
      f.injectFault({ sql, phase } satisfies SQLiteFault);
      let calls = 0;
      const result = await runSharedSQLiteTransaction(f.database, async scope => {
        calls++;
        await scope.executeSql("UPDATE accounts SET balance_amount=balance_amount-123 WHERE id='bank'");
        if (sql === 'ROLLBACK') throw new Error('Synthetic abort');
      });
      expect(result.status).toBe('unknown');
      expect(calls).toBe(sql === 'BEGIN IMMEDIATE' ? 0 : 1);
      expect(() => f.query('SELECT 1')).toThrow('database is not open');
      // Explicit forensic reopen of a synthetic FILE, never a recovered command receipt.
      const forensic = realSQLite({ syntheticPath });
      const bank = forensic.query("SELECT balance_amount FROM accounts WHERE id='bank'").rows.item(0)?.balance_amount;
      expect(forensic.query('PRAGMA integrity_check').rows.item(0)?.integrity_check).toBe('ok');
      expect(forensic.query('PRAGMA foreign_key_check').rows.length).toBe(0);
      forensic.native.close();
      const previousBank = before.tables.accounts!.find(a => a.id === 'bank')!.balance_amount;
      expect(bank).toBe(sql === 'COMMIT' && phase === 'after' ? Number(previousBank) - 123 : previousBank);
      evidence['unknown-' + sql + '-' + phase] = { status: result.status, calls, bank };
    } finally { fs.unlinkSync(syntheticPath); fs.rmdirSync(directory); }
  },
);

test('mixed-history payment failure after a linked write reports rolledBack without replay', async () => {
  const f = await fixture();
  try {
    const before = await inspectIntegrated(f.database); f.resetTrace();
    f.injectFault({ write: 2, phase: 'after' });
    await expect(f.payment(10000)).rejects.toThrow('Injected SQLite failure');
    expect(f.trace.some(e => e.sql.startsWith('ROLLBACK') && e.executed)).toBe(true);
    expect(await inspectIntegrated(f.database)).toEqual(before);
  } finally { f.native.close(); }
});

test.each(['transfer', 'cardPayment', 'ai'] as const)('every linked write of %s rolls back on the common financial history', async kind => {
  type F = Awaited<ReturnType<typeof fixture>>;
  const plan: AiCommandPlan = { version: 1, summary: 'Integrated receipt fault', answeredFields: [], actions: [
    { id: 'transfer', entity: 'transaction', operation: 'create', fields: { accountId: 'bank', targetAccountId: 'target', amount: 10000, transactionType: 'internalTransfer', transferTaxCharged: true, description: 'Synthetic', date: '2026-10-24' } },
  ] };
  const command = (f: F) => kind === 'transfer'
    ? f.save({ amount: 10000, transactionType: 'internalTransfer', targetAccountId: 'target', transferTaxCharged: true })
    : kind === 'cardPayment' ? f.payment(10000) : executeAiCommandPlan(f.database, 'fault-ai', plan);
  const prepare = async () => {
    const f = await fixture();
    if (kind === 'ai') await saveAiDraftForReview(f.database, { id: 'fault-ai', plan, phase: 'review', rawInput: 'synthetic', messages: [], clarificationHistory: [], createdAt: DATE.toISOString(), updatedAt: DATE.toISOString() });
    return f;
  };
  const discover = await prepare();
  let writes: { write: number; sql: string }[];
  try {
    discover.resetTrace(); await command(discover);
    writes = discover.trace.filter(e => e.write !== undefined).map(e => ({ write: e.write!, sql: e.sql }));
    expect(writes.length).toBeGreaterThan(0);
  } finally { discover.native.close(); }
  const positions = [];
  for (const write of writes!) for (const phase of ['before', 'after'] as const) {
    const f = await prepare();
    try {
      const before = await inspectIntegrated(f.database); f.resetTrace();
      f.injectFault({ write: write.write, phase });
      await expect(command(f)).rejects.toThrow();
      expect(f.trace.some(e => e.sql.startsWith('ROLLBACK') && e.executed)).toBe(true);
      expect(await inspectIntegrated(f.database)).toEqual(before);
      positions.push({ ...write, phase, status: 'rolledBack' });
    } finally { f.native.close(); }
  }
  evidence['linked-' + kind] = { writes: writes!, positions };
}, 60000);
