jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
jest.mock('react-native-config', () => ({}));

const { mkdtempSync, rmSync, writeFileSync } = require('node:fs') as { mkdtempSync: (prefix: string) => string; rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void; writeFileSync: (path: string, text: string) => void };
const { tmpdir } = require('node:os') as { tmpdir: () => string };
const { join } = require('node:path') as { join: (...parts: string[]) => string };
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState, requireIntegralRollback, type FinancialState } from './helpers/financialState';
import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { executeAiCommandPlan } from '../src/modules/transactions/useCases/executeAiCommandPlan';
import { executeAiCommandPlan as previousExecute } from './helpers/phase4ExecuteAiCommandPlan';
import { createSqliteAiDraftRepository, saveAiDraftForReview } from '../src/modules/transactions/repositories/sqliteAiDraftRepository';
import { createSqliteSubscriptionRepository } from '../src/modules/subscriptions/repositories/sqliteSubscriptionRepository';
import { createSubscriptionApi } from '../src/modules/subscriptions/useCases/createSubscriptionApi';
import { getFinancialDataRevision } from '../src/database/sqliteDatabase';
import { manageSQLiteDatabase, sqliteConnectionState } from '../src/database/managedSQLite';
import { SQLiteCommandFailure } from '../src/database/atomicSQLite';
import type { AiCommandPlan, AiCommandDraft, AiCommandAction } from '../src/modules/transactions/types';
import type { SubscriptionReminderService } from '../src/modules/subscriptions/services/SubscriptionReminderService';

const subscriptionFields = { name: 'Netflix', amount: 44900, accountId: 'bank', anchorDate: '2026-10-15', periodicity: 'monthly' as const, remindersEnabled: false };
const matrixEvidence = { discoveredWrites: 0, verifiedPositions: 0, historicalFinalBatchPositions: 0 };
afterAll(() => writeFileSync('docs/atomicidad-fase4/node-ia-matrix.json', JSON.stringify({ ...matrixEvidence, complete: matrixEvidence.discoveredWrites > 0 && matrixEvidence.verifiedPositions === matrixEvidence.discoveredWrites * 2 }, null, 2)));
const mixed = (): AiCommandPlan => ({ version: 1, answeredFields: [], summary: 'Gasto, transferencia y compromiso', actions: [
  { id: 'expense', entity: 'transaction', operation: 'create', fields: { accountId: 'bank', amount: 44900, description: 'Netflix pagado', transactionType: 'expense', date: '2026-10-11' } },
  { id: 'transfer', entity: 'transaction', operation: 'create', fields: { accountId: 'bank', targetAccountId: 'target', amount: 100000, description: 'Ahorro', transactionType: 'internalTransfer', transferTaxCharged: true, date: '2026-10-11' } },
  { id: 'netflix', entity: 'subscription', operation: 'create', fields: subscriptionFields },
] });
function service(): SubscriptionReminderService {
  return { getStatus: jest.fn(async () => ({ available: true, permission: 'granted' as const })), requestPermission: jest.fn(async () => ({ available: true, permission: 'granted' as const })), schedule: jest.fn(async () => undefined), cancel: jest.fn(async () => undefined), cancelAll: jest.fn(async () => undefined), ensureMaintenance: jest.fn(async () => undefined) };
}
function draft(plan = mixed(), id = 'intent'): AiCommandDraft {
  return { id, plan, phase: 'review', rawInput: plan.summary, messages: [], clarificationHistory: [], createdAt: FINANCIAL_TEST_DATE.toISOString(), updatedAt: FINANCIAL_TEST_DATE.toISOString() };
}
async function fixture() {
  const f = await financialIntegrityFixture({ managed: true });
  const reminders = service();
  const drafts = createSqliteAiDraftRepository(f.database);
  const api = createSubscriptionApi({ repository: createSqliteSubscriptionRepository(f.database), reminderService: reminders, createId: () => 'contract' });
  return { ...f, reminders, drafts, api };
}
beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] }); jest.setSystemTime(FINANCIAL_TEST_DATE); });
afterEach(() => jest.useRealTimers());

function normalized(state: FinancialState) {
  const copy = JSON.parse(JSON.stringify(state)) as FinancialState;
  copy.tables.ai_command_drafts = []; // Authorized new durable receipt, no financial effect.
  const replacements = (copy.tables.transactions ?? []).filter(row => row.dedupe_key).map(row => [String(row.id), String(row.dedupe_key)]);
  let json = JSON.stringify(copy);
  for (const [id, key] of replacements) json = json.replaceAll(id!, key!);
  const result = JSON.parse(json) as FinancialState;
  for (const rows of Object.values(result.tables)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return result;
}

test('A/C: whole plan equals frozen successful executor; receipt survives clear/new draft and prevents all repeated impacts', async () => {
  const f = await fixture(); const old = await fixture();
  try {
    await f.drafts.saveActiveDraft(draft());
    const result = await executeAiCommandPlan(f.database, 'intent', mixed(), f.reminders);
    await previousExecute(old.database, 'intent', mixed(), old.reminders);
    const after = await financialState(f);
    expect(after.metrics).toMatchObject({ balances: { bank: 854700, target: 100000 }, available: 954700, wealth: 954700, expense: 45300, income: 0, savings: -45300 });
    expect(after.tables.transactions).toHaveLength(4);
    expect(after.tables.subscription_occurrences?.every(row => row.status === 'pending')).toBe(true);
    expect(normalized(after)).toEqual(normalized(await financialState(old)));
    expect(await f.drafts.loadActiveDraft()).toBeUndefined();
    f.resetTrace();
    expect(await executeAiCommandPlan(f.database, 'intent', mixed(), f.reminders)).toEqual(result);
    expect(f.trace.filter(entry => entry.write)).toHaveLength(0);
    expect(await financialState(f)).toEqual(after);
    await f.drafts.clearActiveDraft();
    await f.drafts.saveActiveDraft(draft(mixed(), 'different'));
    await f.drafts.clearActiveDraft();
    await expect(f.drafts.saveActiveDraft(draft())).rejects.toThrow('confirmado');
    const changed = mixed(); changed.actions[0]!.fields = { amount: 1 };
    await expect(executeAiCommandPlan(f.database, 'intent', changed)).rejects.toThrow('otro contenido');
    expect(await financialState(f)).toEqual(after);
  } finally { f.native.close(); old.native.close(); }
});

test('historical subscription backlog preserves the previous final bounded batch inside the single plan commit', async () => {
  const current = await fixture(); const previous = await fixture();
  const plan: AiCommandPlan = { version: 1, summary: 'Histórica', answeredFields: [], actions: [{ id: 'old', entity: 'subscription', operation: 'create', fields: { ...subscriptionFields, anchorDate: '1500-01-15', periodicity: 'yearly' } }] };
  try {
    current.resetTrace();
    await executeAiCommandPlan(current.database, 'historical', plan, current.reminders);
    await previousExecute(previous.database, 'historical', plan, previous.reminders);
    const state = await financialState(current);
    expect(state.tables.subscription_occurrences!.length).toBeGreaterThan(500);
    expect(normalized(state)).toEqual(normalized(await financialState(previous)));
    expect(current.trace.filter(entry => /^BEGIN/.test(entry.sql))).toHaveLength(1);
    expect(current.trace.filter(entry => /^COMMIT/.test(entry.sql))).toHaveLength(1);
    const reads = current.trace.filter(entry => entry.sql === 'SELECT * FROM recurring_subscriptions;');
    const finalStart = current.trace.indexOf(reads[1]!);
    const finalWrites = current.trace.slice(finalStart).filter(entry => entry.write && !entry.sql.includes('ai_command_drafts'));
    expect(finalWrites.length).toBeGreaterThan(0);
    for (const position of [finalWrites[0]!.write!, finalWrites[finalWrites.length - 1]!.write!]) for (const phase of ['before', 'after'] as const) {
      const failed = await fixture();
      try {
        const before = await financialState(failed); failed.resetTrace(); failed.injectFault({ write: position, phase });
        await expect(executeAiCommandPlan(failed.database, 'historical', plan, failed.reminders)).rejects.toThrow('Injected');
        requireIntegralRollback(before, await financialState(failed));
        matrixEvidence.historicalFinalBatchPositions += 1;
      } finally { failed.native.close(); }
    }
  } finally { current.native.close(); previous.native.close(); }
});

test('B: every discovered write before/after restores every table, audit, revision and metrics, including active draft', async () => {
  const discovery = await fixture();
  let count: number;
  try {
    await discovery.drafts.saveActiveDraft(draft()); discovery.resetTrace();
    await executeAiCommandPlan(discovery.database, 'intent', mixed(), discovery.reminders);
    count = discovery.trace.filter(entry => entry.write).length;
    matrixEvidence.discoveredWrites = count;
    expect(count).toBeGreaterThan(10);
    expect(discovery.trace.filter(entry => /^BEGIN/.test(entry.sql))).toHaveLength(1);
    expect(discovery.trace.filter(entry => /^COMMIT/.test(entry.sql))).toHaveLength(1);
  } finally { discovery.native.close(); }
  for (let write = 1; write <= count; write += 1) for (const phase of ['before', 'after'] as const) {
    const f = await fixture();
    try {
      await f.drafts.saveActiveDraft(draft());
      const before = await financialState(f); f.resetTrace(); f.injectFault({ write, phase });
      await expect(executeAiCommandPlan(f.database, 'intent', mixed(), f.reminders)).rejects.toThrow('Injected SQLite failure');
      expect(f.trace.some(entry => entry.outcome === `injected-${phase}`)).toBe(true);
      expect(f.trace.filter(entry => /^ROLLBACK/.test(entry.sql))).toHaveLength(1);
      requireIntegralRollback(before, await financialState(f));
      expect(f.reminders.schedule).not.toHaveBeenCalled();
      expect((await f.drafts.loadActiveDraft())?.id).toBe('intent');
      matrixEvidence.verifiedPositions += 1;
    } finally { f.native.close(); }
  }
});

test.each(['account', 'transaction', 'subscription'] as const)('catalog conflict after draft generation (%s) rejects before writes', async kind => {
  const f = await fixture();
  try {
    const revision = await getFinancialDataRevision(f.database);
    if (kind === 'account') f.native.exec("UPDATE accounts SET balance_amount=1 WHERE id='bank'");
    if (kind === 'transaction') await f.save();
    if (kind === 'subscription') await f.api.createSubscription({ name: 'Otra', amount: 1000, recurrence: { periodicity: 'monthly' }, anchorDate: '2026-10-15', reminders: { enabled: false } });
    await saveAiDraftForReview(f.database, draft(), revision); // Catalog was read BEFORE interpretation.
    const before = await financialState(f); f.resetTrace();
    await expect(executeAiCommandPlan(f.database, 'intent', mixed())).rejects.toThrow('datos cambiaron');
    expect(f.trace.filter(entry => entry.write)).toHaveLength(0);
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

test('legacy draft without review evidence cannot be silently upgraded or executed', async () => {
  const f = await fixture();
  try {
    await f.drafts.saveActiveDraft(draft());
    f.native.prepare("UPDATE ai_command_drafts SET plan_json=? WHERE id='intent'").run(JSON.stringify(mixed()));
    const before = await financialState(f); f.resetTrace();
    await expect(f.drafts.saveActiveDraft(draft())).rejects.toThrow('borrador antiguo');
    await expect(executeAiCommandPlan(f.database, 'intent', mixed())).rejects.toThrow('datos cambiaron');
    expect(f.trace.filter(entry => entry.write)).toHaveLength(0);
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

test.each([Infinity, -Infinity, NaN])('all modified numeric entry paths reject %s before writes', async amount => {
  const f = await fixture();
  try {
    const actions: AiCommandAction[] = [
      { id: 'bad', operation: 'create', entity: 'transaction', fields: { amount } },
      { id: 'bad', operation: 'create', entity: 'subscription', fields: { amount } },
      { id: 'bad', operation: 'create', entity: 'debitAccount', fields: { initialBalance: amount } },
      { id: 'bad', operation: 'create', entity: 'creditCard', fields: { creditLimit: amount } },
    ];
    for (const action of actions) {
      const plan: AiCommandPlan = { ...mixed(), actions: [action] };
      f.resetTrace();
      await expect(executeAiCommandPlan(f.database, 'bad', plan)).rejects.toThrow('no finito');
      expect(f.trace.filter(entry => entry.write)).toHaveLength(0);
      await expect(f.drafts.saveActiveDraft(draft(plan))).rejects.toThrow('no finito');
      expect(f.trace.filter(entry => entry.write)).toHaveLength(0);
    }
  } finally { f.native.close(); }
});

test('references reread dependent accounts and duplicate/forward references cannot survive rollback', async () => {
  const f = await fixture();
  try {
    const p = mixed();
    p.actions.unshift({ id: 'close', entity: 'debitAccount', operation: 'delete', targetId: 'bank', fields: {} });
    const before = await financialState(f);
    await expect(executeAiCommandPlan(f.database, 'closed', p)).rejects.toThrow();
    requireIntegralRollback(before, await financialState(f));
    p.actions = [{ id: 'ref', entity: 'transaction', operation: 'create', fields: { ...mixed().actions[0]!.fields, accountId: undefined, accountRef: 'future' } }, { id: 'account', clientRef: 'future', entity: 'debitAccount', operation: 'create', fields: { name: 'Nueva', initialBalance: 100 } }];
    await expect(executeAiCommandPlan(f.database, 'ref', p)).rejects.toThrow('referencia');
    p.actions = [mixed().actions[0]!, mixed().actions[0]!];
    await expect(executeAiCommandPlan(f.database, 'duplicate', p)).rejects.toThrow('duplicados');
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

test.each(['before', 'after'] as const)('D: COMMIT response lost %s, no retry, reopened receipt is evidence only when present', async phase => {
  const directory = mkdtempSync(join(tmpdir(), 'smartfin-phase4-')); const path = join(directory, 'synthetic.db');
  const sql = realSQLite({ syntheticPath: path, fixedSqlDate: FINANCIAL_TEST_DATE });
  for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  sql.native.exec("INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('bank','Banco','bankAccount','active','COP',1000000,'2026-01-01','2026-01-01'),('target','Destino','bankAccount','active','COP',0,'2026-01-01','2026-01-01')");
  const database = manageSQLiteDatabase(sql.database);
  await createSqliteAiDraftRepository(database).saveActiveDraft(draft());
  sql.resetTrace(); sql.injectFault({ sql: 'COMMIT', phase });
  await expect(executeAiCommandPlan(database, 'intent', mixed(), service())).rejects.toMatchObject({ result: { status: 'unknown' } });
  expect(sqliteConnectionState(database)?.status).toBe('closed');
  expect(sql.trace.filter(entry => /^BEGIN/.test(entry.sql))).toHaveLength(1);
  const reopened = realSQLite({ syntheticPath: path, fixedSqlDate: FINANCIAL_TEST_DATE });
  try {
    reopened.native.exec('PRAGMA foreign_keys=ON');
    const row = reopened.query("SELECT phase FROM ai_command_drafts WHERE id='intent'").rows.item(0);
    expect(row?.phase).toBe(phase === 'after' ? 'confirmed' : 'review');
    const balance = reopened.query("SELECT balance_amount FROM accounts WHERE id='bank'").rows.item(0)?.balance_amount;
    expect(balance).toBe(phase === 'after' ? 854700 : 1000000);
    if (phase === 'after') {
      reopened.resetTrace();
      await executeAiCommandPlan(reopened.database, 'intent', mixed(), service());
      expect(reopened.trace.filter(entry => entry.write)).toHaveLength(0);
    }
    expect(reopened.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
    expect(reopened.query('PRAGMA integrity_check').rows.item(0)).toMatchObject({ integrity_check: 'ok' });
  } finally { reopened.native.close(); rmSync(directory, { recursive: true, force: true }); }
});

test.each(['update', 'delete'] as const)('E: AI %s of linked expense reconciles historical obligation and its derived rows atomically', async operation => {
  const f = await fixture();
  try {
    const contract = await f.api.createSubscription({ name: 'Netflix', amount: 44900, accountId: 'bank', anchorDate: '2026-09-15', recurrence: { periodicity: 'monthly' }, reminders: { enabled: true } });
    const charge = (await f.api.getSubscriptionHistory(contract.value.id)).find(item => item.expectedDate === '2026-09-15')!;
    const expense = await f.save({ amount: 44900, merchantName: 'Netflix', occurrence: { kind: 'date', date: '2026-09-15' } });
    await f.api.confirmSubscriptionPayment({ occurrenceId: charge.id, transactionId: expense.transaction.id });
    const p: AiCommandPlan = { version: 1, summary: operation, answeredFields: [], actions: [{ id: 'edit', entity: 'transaction', operation, targetId: expense.transaction.id, fields: operation === 'update' ? { amount: 45900 } : {} }] };
    const before = await financialState(f);
    f.resetTrace(); f.injectFault({ sql: 'UPDATE subscription_occurrences', phase: 'after' });
    await expect(executeAiCommandPlan(f.database, 'edit', p, f.reminders)).rejects.toThrow('Injected');
    requireIntegralRollback(before, await financialState(f));
    await executeAiCommandPlan(f.database, 'edit', p, f.reminders);
    const history = (await f.api.getSubscriptionHistory(contract.value.id)).find(item => item.id === charge.id)!;
    expect(history.expectedAmount).toBe(44900);
    expect(history).toMatchObject(operation === 'update' ? { status: 'paid', actualAmount: 45900, transactionId: expense.transaction.id } : { status: 'overdue', actualAmount: undefined, transactionId: undefined, paidAt: undefined });
    expect((await f.snapshot()).balances.bank).toBe(operation === 'update' ? 954100 : 1000000);
    expect(f.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
  } finally { f.native.close(); }
});

test('F/G: concurrent identical confirmation executes once; notification failure preserves committed result and persisted retry', async () => {
  const f = await fixture();
  try {
    const p = mixed(); const sub = p.actions[2]!;
    sub.fields = { ...subscriptionFields, remindersEnabled: true, reminderOffsets: '3,1,0', reminderHour: 9, reminderMinute: 0 };
    f.reminders.schedule = jest.fn(async () => { throw new Error('platform unavailable'); });
    const results = await Promise.all([executeAiCommandPlan(f.database, 'same', p, f.reminders), executeAiCommandPlan(f.database, 'same', p, f.reminders)]);
    expect(results[0]?.completed.join(' ')).toContain('recordatorios pendientes');
    expect((await f.snapshot()).balances.bank).toBe(854700);
    expect(f.query("SELECT * FROM subscription_reminders WHERE delivery_status='failed'").rows.length).toBeGreaterThan(0);
    expect(f.query('SELECT * FROM transactions').rows.length).toBe(4);
    f.reminders.schedule = jest.fn(async () => undefined);
    await Promise.all([f.api.syncSubscriptions(), f.api.syncSubscriptions()]);
    const keys = f.query('SELECT subscription_id,expected_date,count(*) AS count FROM subscription_occurrences GROUP BY subscription_id,expected_date').rows.raw();
    expect(keys.every(row => row.count === 1)).toBe(true);
    expect(f.query("SELECT * FROM subscription_reminders WHERE delivery_status='failed'").rows.length).toBe(0);
  } finally { f.native.close(); }
});

test('rollback failure remains unknown with original error and never attempts another body', async () => {
  const f = await fixture();
  f.resetTrace();
  f.injectFault({ sql: 'ROLLBACK', phase: 'before' });
  const p = mixed(); p.actions.push({ id: 'invalid', entity: 'subscription', operation: 'create', fields: { ...subscriptionFields, amount: 0 } });
  const error = await executeAiCommandPlan(f.database, 'unknown', p).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(SQLiteCommandFailure);
  expect(error).toMatchObject({ result: { status: 'unknown', rollbackError: expect.any(Error) } });
  expect(f.trace.filter(entry => /^BEGIN/.test(entry.sql))).toHaveLength(1);
});
