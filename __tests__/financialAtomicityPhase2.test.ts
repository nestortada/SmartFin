import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState, requireIntegralRollback } from './helpers/financialState';
import { financialAtomicityScenarios, runFinancialScenario } from './helpers/financialAtomicityScenarios';
import { deleteManualTransactionSafely, saveManualTransaction, type SaveManualTransactionParams } from '../src/modules/transactions/useCases/saveManualTransaction';
import { updateTransactionQuickly } from '../src/modules/transactions/useCases/updateTransactionQuickly';
import { SQLiteCommandFailure, runSharedSQLiteTransaction } from '../src/database/atomicSQLite';
import { createSqliteAccountRepository } from '../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { ManualTransactionConflict } from '../src/modules/transactions/useCases/manualTransactionScope';
import { createSqliteSubscriptionRepository } from '../src/modules/subscriptions/repositories/sqliteSubscriptionRepository';
import { createSubscriptionApi } from '../src/modules/subscriptions/useCases/createSubscriptionApi';
import type { SQLiteFault } from './helpers/realSQLite';

const faultMatrix: { name: string; writes: number; rollbackPoints: number }[] = [];
afterAll(() => {
  const { env } = require('node:process') as { env: Record<string, string | undefined> };
  if (env.SMARTFIN_PHASE2_REPORT) {
    const fs = require('node:fs') as { writeFileSync: (path: string, value: string) => void };
    fs.writeFileSync(env.SMARTFIN_PHASE2_REPORT, JSON.stringify({
      database: 'node:sqlite :memory:', matrix: faultMatrix,
      rollbackPoints: faultMatrix.reduce((sum, value) => sum + value.rollbackPoints, 0),
    }, null, 2));
  }
});

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());
type Fixture = Awaited<ReturnType<typeof financialIntegrityFixture>>;
type Operation = () => Promise<unknown>;
type Scenario = { name: string; prepare: (f: Fixture) => Promise<Operation> };
const remove = async (f: Fixture, transaction: Parameters<typeof deleteManualTransactionSafely>[0]['transaction']) =>
  deleteManualTransactionSafely({ ...f, accounts: [], transaction });

async function linkedExpense(f: Fixture) {
  const expense = await f.save({ transactionDate: '2026-01-10T12:00:00.000Z' });
  let id = 0;
  const api = createSubscriptionApi({
    repository: createSqliteSubscriptionRepository(f.database),
    clock: { now: () => FINANCIAL_TEST_DATE }, createId: () => `subscription-test-${++id}`,
    reminderService: {
      getStatus: async () => ({ available: false, permission: 'unsupported' }),
      requestPermission: async () => ({ available: false, permission: 'unsupported' }),
      schedule: async () => undefined, cancel: async () => undefined,
      cancelAll: async () => undefined, ensureMaintenance: async () => undefined,
    },
  });
  const subscription = await api.createSubscription({ name: 'Synthetic', amount: 250000,
    anchorDate: '2026-01-10', recurrence: { periodicity: 'monthly' }, accountId: 'bank' });
  const history = await api.getSubscriptionHistory(subscription.value.id, { limit: 500 });
  const occurrence = history.find(value => value.expectedDate === '2026-01-10');
  if (!occurrence) throw new Error('Missing historical charge');
  await api.confirmSubscriptionPayment({ occurrenceId: occurrence.id, transactionId: expense.transaction.id });
  f.native.prepare('INSERT INTO transaction_splits(id,transaction_id,split_type,amount,currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run('split', expense.transaction.id, 'synthetic', 250000, 'COP', '2026-01-10', '2026-01-10');
  return expense.transaction;
}

const scenarios: Scenario[] = [
  { name: 'taxed transfer', prepare: financialAtomicityScenarios[0]!.prepare },
  { name: 'manual existing payment edit', prepare: financialAtomicityScenarios[3]!.prepare },
  { name: 'expense deletion', prepare: async f => { const tx = await f.save(); return () => remove(f, tx.transaction); } },
  { name: 'existing payment deletion', prepare: async f => {
    await financialAtomicityScenarios[3]!.prepare(f);
    const tx = (await f.transactionRepository.getTransactions()).find(value => value.type === 'creditCardPayment')!;
    return () => remove(f, tx);
  } },
  { name: 'credit purchase with installments', prepare: async f => () => f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3' }) },
  { name: 'unclassified credit preparation', prepare: async f => () => f.save({ accountId: undefined, operationType: 'Crédito', merchantName: 'Unknown card' }) },
  { name: 'quick debit to credit', prepare: async f => {
    const tx = await f.save(); return () => updateTransactionQuickly(f, tx.transaction.id, { kind: 'paymentMethod', operationType: 'Crédito' });
  } },
  { name: 'quick credit to debit', prepare: async f => {
    const tx = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3' });
    return () => updateTransactionQuickly(f, tx.transaction.id, { kind: 'paymentMethod', operationType: 'Débito' });
  } },
  { name: 'quick installment update', prepare: async f => {
    const tx = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3' });
    f.native.prepare('UPDATE installment_purchases SET paid_installments=1 WHERE transaction_id=?').run(tx.transaction.id);
    return () => updateTransactionQuickly(f, tx.transaction.id, { kind: 'installments', installmentCount: 3, interestFreeCount: 1 });
  } },
  { name: 'historical subscription expense edit', prepare: async f => {
    const transaction = await linkedExpense(f); return () => f.save({ editingTransaction: transaction, amount: 240000 });
  } },
  { name: 'historical subscription expense deletion', prepare: async f => {
    const transaction = await linkedExpense(f); return () => remove(f, transaction);
  } },
  { name: 'transfer converted to expense', prepare: async f => {
    const tx = await f.save({ transactionType: 'internalTransfer', targetAccountId: 'target', amount: 100000, transferTaxCharged: true });
    return () => f.save({ editingTransaction: tx.transaction, amount: 90000 });
  } },
  { name: 'transfer destination change and tax removal', prepare: async f => {
    f.native.exec("INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES('savings','Savings','savingsAccount','active','COP',0,'2026-01-01','2026-01-01')");
    const tx = await f.save({ transactionType: 'internalTransfer', targetAccountId: 'target', amount: 100000, transferTaxCharged: true });
    return () => f.save({ editingTransaction: tx.transaction, transactionType: 'internalTransfer', targetAccountId: 'savings', amount: 200000 });
  } },
  { name: 'income creation', prepare: async f => () => f.save({ transactionType: 'income', amount: 100000.25 }) },
  { name: 'historical account and date change', prepare: async f => {
    const tx = await f.save(); return () => f.save({ editingTransaction: tx.transaction, accountId: 'target', amount: 100000.25, transactionDate: '2026-08-10T12:00:00.000Z' });
  } },
];

async function run(scenario: Scenario, fault?: SQLiteFault) {
  const f = await financialIntegrityFixture({ managed: true });
  try {
    const operation = await scenario.prepare(f);
    const before = await financialState(f);
    f.resetTrace(); f.injectFault(fault);
    let error: unknown;
    try { await operation(); } catch (caught) { error = caught; }
    const trace = f.trace.map(entry => ({ ...entry }));
    f.injectFault();
    const after = await financialState(f);
    return { before, after, trace, error };
  } finally { f.native.close(); }
}

test.each(scenarios)('$name: every SQL write before/after restores all tables and revision', async scenario => {
  const success = await run(scenario);
  expect(success.error).toBeUndefined();
  expect(success.trace.filter(entry => entry.sql.startsWith('BEGIN'))).toHaveLength(1);
  expect(success.trace.filter(entry => entry.sql.startsWith('COMMIT'))).toHaveLength(1);
  const writes = success.trace.filter(entry => entry.write !== undefined);
  expect(writes.length).toBeGreaterThan(0);
  for (const entry of writes) {
    for (const phase of ['before', 'after'] as const) {
      const failed = await run(scenario, { phase, write: entry.write });
      expect(failed.error).toBeDefined();
      expect(failed.error).not.toBeInstanceOf(SQLiteCommandFailure);
      expect(failed.trace.some(value => value.outcome === `injected-${phase}` && value.write === entry.write)).toBe(true);
      expect(failed.trace.filter(value => value.sql.startsWith('ROLLBACK') && value.outcome === 'ok')).toHaveLength(1);
      expect(failed.trace.some(value => value.sql.startsWith('COMMIT'))).toBe(false);
      requireIntegralRollback(failed.before, failed.after);
    }
  }
  faultMatrix.push({ name: scenario.name, writes: writes.length, rollbackPoints: writes.length * 2 });
});

test('the independent card payment registration remains phase 3 with its historic partial result', async () => {
  const result = await runFinancialScenario(financialAtomicityScenarios[1]!, { phase: 'before', sql: 'INSERT INTO transactions' });
  expect(result.after.metrics).toMatchObject({ balances: { bank: 900000 }, debt: 250000, wealth: 650000 });
});

test.each([0, 2, 3])('successful phase 2 scenario %s matches every historical row and metric', async index => {
  const historical = await runFinancialScenario(financialAtomicityScenarios[index]!);
  const current = await run(scenarios[index === 2 ? 2 : index === 3 ? 1 : 0]!);
  // Only newly generated IDs differ; preserve every relationship and audit field.
  const normalize = (state: typeof current.after) => {
    const ids = state.tables.transactions!.map(row => String(row.id)).filter(id => !id.endsWith('-in') && !id.endsWith('-4x1000'));
    let serialized = JSON.stringify(state);
    ids.forEach((id, position) => { serialized = serialized.split(id).join(`generated-${position}`); });
    return JSON.parse(serialized) as unknown;
  };
  expect(normalize(current.after)).toEqual(normalize(historical.after));
});

test('concurrent edit and delete serialize, reject stale edit/delete and never reverse twice', async () => {
  const f = await financialIntegrityFixture({ managed: true });
  try {
    const original = await f.save();
    const staleAccounts = await f.accountRepository.getAccounts();
    const barrier = f.pauseNextExecuteSql('UPDATE accounts', 'after');
    const edit = f.save({ editingTransaction: original.transaction, amount: 200000 });
    await barrier.reached;
    const deletion = deleteManualTransactionSafely({ ...f, accounts: staleAccounts, transaction: original.transaction });
    const conflict = deletion.catch((error: unknown) => error);
    const reader = f.accountRepository.getAccounts();
    barrier.release();
    const edited = await edit;
    expect(await conflict).toBeInstanceOf(ManualTransactionConflict);
    expect((await reader).find(account => account.id === 'bank')?.balance.amount).toBe(800000);
    await expect(f.save({ editingTransaction: original.transaction, amount: 300000 })).rejects.toBeInstanceOf(ManualTransactionConflict);
    await remove(f, edited.transaction); await remove(f, edited.transaction);
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 1000000 }, expense: 0 });
    await expect(f.save({ editingTransaction: edited.transaction })).rejects.toBeInstanceOf(ManualTransactionConflict);
  } finally { f.native.close(); }
});

test('new commands reread stale account balances; equal timestamps cannot overwrite another edit', async () => {
  const f = await financialIntegrityFixture({ managed: true });
  try {
    const first = await f.save();
    await f.save({ amount: 100000 });
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 650000 }, expense: 350000 });
    await f.save({ editingTransaction: first.transaction, amount: 200000 });
    await expect(f.save({ editingTransaction: first.transaction, amount: 100000 })).rejects.toBeInstanceOf(ManualTransactionConflict);
  } finally { f.native.close(); }
});

test.each([Infinity, -Infinity, NaN])('quick installment amount %s rejects without writes', async installmentCount => {
  const f = await financialIntegrityFixture({ managed: true });
  try {
    const tx = await f.save({ accountId: 'card', operationType: 'Crédito' });
    const before = await financialState(f); f.resetTrace();
    await expect(updateTransactionQuickly(f, tx.transaction.id,
      { kind: 'installments', installmentCount, interestFreeCount: 0 })).rejects.toThrow();
    expect(f.trace.some(entry => entry.write)).toBe(false);
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

test('repeated quick changes and deletion preserve impacts and installment progress', async () => {
  const f = await financialIntegrityFixture({ managed: true });
  try {
    const tx = await f.save();
    await Promise.all([1, 2].map(() => updateTransactionQuickly(f, tx.transaction.id, { kind: 'paymentMethod', operationType: 'Crédito' })));
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 1000000 }, debt: 250000, expense: 250000 });
    await Promise.all([1, 2].map(() => updateTransactionQuickly(f, tx.transaction.id, { kind: 'paymentMethod', operationType: 'Débito' })));
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 750000 }, debt: 0, expense: 250000 });
  } finally { f.native.close(); }
});

test.each(['category', 'dedupe'])('SQLite %s constraint rolls back earlier balance writes', async kind => {
  const f = await financialIntegrityFixture({ managed: true });
  try {
    await f.save({ dedupeKey: 'existing' });
    const before = await financialState(f);
    await expect(f.save(kind === 'category' ? { categoryId: 'missing' } : { dedupeKey: 'existing' })).rejects.toThrow();
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

function request(f: Fixture): SaveManualTransactionParams {
  return { ...f, accounts: [], accountId: 'bank', amount: 100000, merchantName: 'Test',
    operationType: 'Débito', transactionType: 'expense', hasInterestFreeInstallments: false,
    installmentCountInput: '1', interestFreeInstallmentCountInput: '', currentDate: FINANCIAL_TEST_DATE };
}
test('same request object executes once and reuses the confirmed result', async () => {
  const f = await financialIntegrityFixture({ managed: true });
  try {
    const command = request(f);
    const [first, repeated] = await Promise.all([saveManualTransaction(command), saveManualTransaction(command)]);
    expect(repeated).toBe(first);
    await saveManualTransaction(command);
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 900000 }, expense: 100000 });
  } finally { f.native.close(); }
});

test('a generated identity collision rejects before any financial write', async () => {
  const f = await financialIntegrityFixture({ managed: true });
  try {
    const original = await f.save();
    const sequence = Number(original.transaction.id.split('_').pop());
    const collisionId = `tx_manual_${Date.now()}_${sequence + 1}`;
    await f.transactionRepository.saveTransactions([{ ...original.transaction, id: collisionId }]);
    const before = await financialState(f);
    f.resetTrace();
    await expect(f.save()).rejects.toThrow('identidad');
    expect(f.trace.some(entry => entry.write)).toBe(false);
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

test('repositories on different connections reject before acquiring a transaction', async () => {
  const f = await financialIntegrityFixture({ managed: true });
  const other = await financialIntegrityFixture({ managed: true });
  try {
    const before = await financialState(f); const otherBefore = await financialState(other);
    f.resetTrace();
    await expect(saveManualTransaction({ ...request(f), creditCardRepository: other.creditCardRepository })).rejects.toThrow('mismo ámbito');
    expect(f.trace.some(entry => entry.sql.startsWith('BEGIN'))).toBe(false);
    requireIntegralRollback(before, await financialState(f));
    requireIntegralRollback(otherBefore, await financialState(other));
  } finally { f.native.close(); other.native.close(); }
});

test('a participant result stays provisional and cannot be reused after outer rollback', async () => {
  const f = await financialIntegrityFixture({ managed: true });
  try {
    const before = await financialState(f);
    let command: SaveManualTransactionParams | undefined;
    const result = await runSharedSQLiteTransaction(f.database, async participant => {
      command = { ...request(f), accountRepository: createSqliteAccountRepository(participant),
        transactionRepository: createSqliteTransactionRepository(participant), creditCardRepository: createSqliteCreditCardRepository(participant) };
      await saveManualTransaction(command);
      throw new Error('Outer failure');
    });
    expect(result.status).toBe('rolledBack');
    requireIntegralRollback(before, await financialState(f));
    if (!command) throw new Error('Missing command');
    await expect(saveManualTransaction(command)).rejects.toThrow('expired');
  } finally { f.native.close(); }
});

test('lost COMMIT receipt is unknown, quarantines the handle and never repeats the command', async () => {
  const f = await financialIntegrityFixture({ managed: true });
  const command = request(f);
  f.resetTrace(); f.injectFault({ phase: 'after', sql: 'COMMIT' });
  await expect(saveManualTransaction(command)).rejects.toBeInstanceOf(SQLiteCommandFailure);
  const writes = f.trace.filter(entry => entry.write).length;
  await expect(saveManualTransaction(command)).rejects.toBeInstanceOf(SQLiteCommandFailure);
  expect(f.trace.filter(entry => entry.write)).toHaveLength(writes);
  expect(f.trace.filter(entry => entry.sql.startsWith('COMMIT'))).toHaveLength(1);
  expect(f.trace.some(entry => entry.sql.startsWith('ROLLBACK'))).toBe(false);
  await expect(f.accountRepository.getAccounts()).rejects.toThrow('not usable');
});

test('a transfer companion is rejected without treating its inflow as another principal', async () => {
  const f = await financialIntegrityFixture({ managed: true });
  try {
    const result = await f.save({ transactionType: 'internalTransfer', targetAccountId: 'target', amount: 100000 });
    const before = await financialState(f);
    await expect(remove(f, result.transactions[1]!)).rejects.toThrow('origen');
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});
