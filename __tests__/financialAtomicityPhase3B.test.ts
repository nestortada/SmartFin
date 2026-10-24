import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState, requireIntegralRollback } from './helpers/financialState';
import { saveCreditCardFromForm, deleteCreditCard } from '../src/modules/creditCards/useCases/manageCreditCards';
import { saveCreditCardWithAssociations, closeCreditCardWithReconciliation } from '../src/modules/creditCards/useCases/creditCardManagementCommands';
import { associatePendingTransactionsForCreditCard, reconcileCreditCardTransactions, registerCreditCardPayment, ensureUnclassifiedCreditCardAccount } from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import * as oldManagement from './helpers/phase3BManageCreditCards';
import * as oldRelations from './helpers/phase3BCreditCardRelations';
import { createSqliteCreditCardAlertRepository } from '../src/modules/creditCards/repositories/sqliteCreditCardAlertRepository';
import { createSqliteCreditCardRepository } from '../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { SQLiteCommandFailure, runSharedSQLiteTransaction } from '../src/database/atomicSQLite';
import type { CreditCardFormInput } from '../src/modules/creditCards/types';
import type { SQLiteFault } from './helpers/realSQLite';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());
type Fixture = Awaited<ReturnType<typeof financialIntegrityFixture>>;
const input: CreditCardFormInput = { accountId: 'new-card', name: 'Ghost', creditLimit: 3000000,
  annualEffectiveInterestRate: 0.25, closingDay: 20, paymentDay: 25, lastFourDigits: '1234', managementFee: 1000 };
const matrix: unknown[] = [];
const timings: unknown[] = [];
afterAll(() => {
  const { env } = require('node:process') as { env: Record<string, string | undefined> };
  if (env.SMARTFIN_PHASE3B_REPORT) {
    const fs = require('node:fs') as { writeFileSync: (file: string, value: string) => void };
    fs.writeFileSync(env.SMARTFIN_PHASE3B_REPORT, JSON.stringify({ database: 'node:sqlite :memory:', matrix, timings }, null, 2));
  }
});

async function setup() {
  const f = await financialIntegrityFixture({ managed: true });
  await ensureUnclassifiedCreditCardAccount(f.accountRepository);
  // Includes old, pending and cancelled rows. Association historically does not filter status/date.
  for (const [index, status] of ['posted', 'pending', 'cancelled'].entries()) {
    const saved = await f.save({ accountId: 'account-credit-card-unclassified', creditCardHint: 'Ghost',
      merchantName: 'Ghost', operationType: 'Crédito', amount: 120000 + index,
      installmentCountInput: '3', transactionDate: `2024-01-0${index + 1}` });
    f.native.exec(`UPDATE transactions SET status='${status}' WHERE id='${saved.transaction.id}'`);
  }
  f.native.exec('UPDATE installment_purchases SET paid_installments=1');
  await f.save({ accountId: 'card', operationType: 'Crédito', amount: 90000 });
  await createSqliteCreditCardAlertRepository(f.database).saveMissingCreditCardAlert({ creditCardHint: 'Ghost' });
  return f;
}

const flows = ['create', 'edit', 'associate', 'create-and-associate', 'edit-and-associate', 'close', 'reconcile-and-close', 'reconcile'] as const;
type Flow = typeof flows[number];
async function prepare(flow: Flow) {
  const f = await setup();
  if (['edit', 'associate', 'edit-and-associate'].includes(flow)) {
    await saveCreditCardFromForm(f.creditCardRepository, input);
  }
  if (flow.includes('close')) {
    f.native.exec("UPDATE transactions SET status='cancelled' WHERE account_id='card'; UPDATE accounts SET debt_balance_amount=0 WHERE id='card'; UPDATE credit_card_statements SET total_amount=0,status='paid' WHERE account_id='card'");
  }
  return f;
}
async function execute(f: Fixture, flow: Flow, historical = false) {
  const management = historical ? oldManagement : { saveCreditCardFromForm, deleteCreditCard };
  const relations = historical ? oldRelations : { associatePendingTransactionsForCreditCard, reconcileCreditCardTransactions };
  const account = (await f.accountRepository.getAccounts()).find(card => card.id === 'new-card');
  if (flow === 'create' || flow === 'edit') return management.saveCreditCardFromForm(f.creditCardRepository, input, account);
  if (flow === 'associate') return relations.associatePendingTransactionsForCreditCard({ ...f, account: account! });
  if (flow.endsWith('and-associate')) {
    if (!historical) return saveCreditCardWithAssociations({ repository: f.creditCardRepository, input, existingAccount: account });
    const saved = await management.saveCreditCardFromForm(f.creditCardRepository, input, account);
    const count = await relations.associatePendingTransactionsForCreditCard({ ...f, account: saved });
    if (count) await createSqliteCreditCardAlertRepository(f.database).resolveMissingCreditCardAlert(saved.name);
    return { account: saved, associatedCount: count };
  }
  if (flow === 'close') return management.deleteCreditCard(f.creditCardRepository, 'card');
  if (flow === 'reconcile-and-close') {
    if (!historical) return closeCreditCardWithReconciliation({ repository: f.creditCardRepository, accountId: 'card' });
    await relations.reconcileCreditCardTransactions(f);
    return management.deleteCreditCard(f.creditCardRepository, 'card');
  }
  return relations.reconcileCreditCardTransactions(f);
}
async function run(flow: Flow, fault?: SQLiteFault, historical = false) {
  const f = await prepare(flow);
  try {
    const before = await financialState(f); f.resetTrace(); f.injectFault(fault);
    let error: unknown;
    try { await execute(f, flow, historical); } catch (caught) { error = caught; }
    const trace = f.trace.map(entry => ({ ...entry })); f.injectFault();
    return { before, after: await financialState(f), trace, error };
  } finally { f.native.close(); }
}

test.each(flows)('%s: successful historical equivalence and every write before/after rolls back exactly', async flow => {
  const success = await run(flow);
  expect(success.error).toBeUndefined();
  const historical = await run(flow, undefined, true);
  expect(historical.error).toBeUndefined();
  const normalizeGeneratedIds = (state: typeof success.after) => {
    let serialized = JSON.stringify(state);
    for (const row of state.tables.transactions!) {
      serialized = serialized.split(String(row.id)).join(`fixture-${row.date}-${row.amount}-${row.type}`);
    }
    return JSON.parse(serialized) as unknown;
  };
  expect(normalizeGeneratedIds(success.before)).toEqual(normalizeGeneratedIds(historical.before));
  expect(normalizeGeneratedIds(success.after)).toEqual(normalizeGeneratedIds(historical.after));
  expect(success.trace.filter(entry => entry.sql.startsWith('BEGIN'))).toHaveLength(1);
  expect(success.trace.filter(entry => entry.sql.startsWith('COMMIT'))).toHaveLength(1);
  const writes = success.trace.filter(entry => entry.write !== undefined);
  expect(writes.length).toBeGreaterThan(0);
  for (const entry of writes) for (const phase of ['before', 'after'] as const) {
    const failed = await run(flow, { write: entry.write, phase });
    expect(failed.error).toBeDefined();
    expect(failed.error).not.toBeInstanceOf(SQLiteCommandFailure);
    expect(failed.trace.some(value => value.write === entry.write && value.outcome === `injected-${phase}`)).toBe(true);
    expect(failed.trace.filter(value => value.sql.startsWith('ROLLBACK') && value.outcome === 'ok')).toHaveLength(1);
    expect(failed.trace.some(value => value.sql.startsWith('COMMIT'))).toBe(false);
    requireIntegralRollback(failed.before, failed.after);
  }
  matrix.push({ flow, writes: writes.length, points: writes.length * 2, historicalExact: true,
    positions: writes.map(entry => ({ write: entry.write, sql: entry.sql })), before: success.before, after: success.after });
}, 60000);

test('association preserves old identities, status, dates, progress and other cards; no automatic debt before association', async () => {
  const f = await prepare('associate');
  try {
    const before = await financialState(f);
    expect(before.tables.accounts!.find(row => row.id === 'new-card')?.debt_balance_amount).toBe(0);
    const saved = (await f.accountRepository.getAccounts()).find(card => card.id === 'new-card')!;
    expect(await associatePendingTransactionsForCreditCard({ ...f, account: saved })).toBe(3);
    const after = await financialState(f);
    expect(after.tables.accounts!.find(row => row.id === 'new-card')?.debt_balance_amount).toBe(240001);
    expect(after.tables.installment_purchases!.map(row => row.paid_installments)).toEqual([1, 1, 1]);
    expect(after.metrics.expense).toBe(before.metrics.expense);
    for (const row of before.tables.transactions!) {
      expect(after.tables.transactions!.find(current => current.id === row.id)).toEqual(row.account_id === 'account-credit-card-unclassified'
        ? { ...row, account_id: 'new-card', updated_at: FINANCIAL_TEST_DATE.toISOString() } : row);
    }
    const repeated = await financialState(f);
    expect(await associatePendingTransactionsForCreditCard({ ...f, account: saved })).toBe(0);
    requireIntegralRollback(repeated, await financialState(f));
  } finally { f.native.close(); }
});

test.each([0.01, 0.40, 0.49, -1, 0, NaN, Infinity, -Infinity])('payment %s rejects with complete state unchanged', async amount => {
  const f = await setup();
  try {
    const before = await financialState(f); f.resetTrace();
    await expect(registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount })).rejects.toThrow();
    expect(f.trace.some(entry => entry.write !== undefined)).toBe(false);
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});
test.each([[0.5, 1], [1, 1], [100000, 90000], [1000.6, 1001]])('payment %s preserves valid round/cap: %s', async (amount, paidAmount) => {
  const f = await setup();
  try {
    const before = await f.snapshot();
    const result = await registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount });
    expect(result.paidAmount).toBe(paidAmount);
    expect(await f.snapshot()).toMatchObject({ wealth: before.wealth, expense: before.expense, balances: { bank: 1000000 - paidAmount } });
  } finally { f.native.close(); }
});
test.each([0.01, 0.4, 0.49, 0.5, 1.4, 90000.5, Number.MAX_SAFE_INTEGER + 1])('capped invalid effective amount/debt %s rolls back initial reconciliation', async debt => {
  const f = await setup();
  try {
    f.native.prepare("UPDATE transactions SET amount=? WHERE account_id='card'").run(debt);
    f.native.exec("UPDATE credit_card_statements SET total_amount=777; UPDATE accounts SET debt_balance_amount=888 WHERE id='card'");
    const before = await financialState(f); f.resetTrace();
    await expect(registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount: Number.MAX_SAFE_INTEGER + 2 })).rejects.toThrow('pesos enteros');
    expect(f.trace.filter(entry => entry.sql.startsWith('ROLLBACK') && entry.outcome === 'ok')).toHaveLength(1);
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

test('insufficient funds rejects after reconciliation without persisting any effect', async () => {
  const f = await setup();
  try {
    f.native.exec("UPDATE accounts SET balance_amount=0 WHERE id='bank'");
    const before = await financialState(f);
    await expect(registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount: 1 })).rejects.toThrow('saldo suficiente');
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

test('queued edits reread persisted state, reject even same-millisecond conflicts and exclude readers', async () => {
  const f = await prepare('edit');
  try {
    const expected = (await f.accountRepository.getAccounts()).find(card => card.id === 'new-card')!;
    const barrier = f.pauseNextExecuteSql('UPDATE accounts', 'after');
    const first = saveCreditCardWithAssociations({ repository: f.creditCardRepository, input: { ...input, creditLimit: 5000000 }, existingAccount: expected });
    await barrier.reached;
    const second = saveCreditCardWithAssociations({ repository: f.creditCardRepository, input, existingAccount: expected }).catch((error: unknown) => error);
    let read = false;
    const reader = f.accountRepository.getAccounts().then(accounts => { read = true; return accounts; });
    await Promise.resolve(); expect(read).toBe(false); barrier.release();
    await first; expect(await second).toBeInstanceOf(Error);
    expect((await reader).find(card => card.id === 'new-card')?.creditLimit?.amount).toBe(5000000);
    expect((await f.transactionRepository.getTransactions()).filter(tx => tx.accountId === 'new-card')).toHaveLength(3);
  } finally { f.native.close(); }
});

test.each(['closed', 'inactive', 'missing'] as const)('association to %s card rejects without effects', async status => {
  const f = await prepare('associate');
  try {
    const account = (await f.accountRepository.getAccounts()).find(card => card.id === 'new-card')!;
    if (status === 'missing') f.native.exec("DELETE FROM credit_card_profiles WHERE account_id='new-card'; DELETE FROM accounts WHERE id='new-card'");
    else f.native.prepare("UPDATE accounts SET status=? WHERE id='new-card'").run(status);
    const before = await financialState(f);
    await expect(associatePendingTransactionsForCreditCard({ ...f, account })).rejects.toThrow('activa');
    requireIntegralRollback(before, await financialState(f));
    await expect(saveCreditCardFromForm(f.creditCardRepository, input, account)).rejects.toThrow('cambió');
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

test('close with debt fails and rolls back the reconciliation of every active card', async () => {
  const f = await prepare('associate');
  try {
    f.native.exec("UPDATE accounts SET debt_balance_amount=17 WHERE type='creditCard'");
    const before = await financialState(f);
    await expect(closeCreditCardWithReconciliation({ repository: f.creditCardRepository, accountId: 'card' })).rejects.toThrow('uso del cupo');
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

test('outer participant keeps results provisional, shares one BEGIN and revokes after rollback', async () => {
  const f = await setup(); let escaped: Parameters<typeof saveCreditCardWithAssociations>[0] | undefined;
  try {
    const before = await financialState(f); f.resetTrace();
    const result = await runSharedSQLiteTransaction(f.database, async participant => {
      escaped = { repository: createSqliteCreditCardRepository(participant), input };
      await saveCreditCardWithAssociations(escaped);
      throw new Error('outer abort');
    });
    expect(result.status).toBe('rolledBack');
    expect(f.trace.filter(entry => entry.sql.startsWith('BEGIN'))).toHaveLength(1);
    requireIntegralRollback(before, await financialState(f));
    await expect(saveCreditCardWithAssociations(escaped!)).rejects.toThrow('expired');
  } finally { f.native.close(); }
});

test.each(['before', 'after'] as const)('COMMIT %s stays unknown and never repeats the same command', async phase => {
  const f = await setup();
  const command = { repository: f.creditCardRepository, input };
  f.resetTrace(); f.injectFault({ sql: 'COMMIT', phase });
  let failure: unknown;
  try { await saveCreditCardWithAssociations(command); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(SQLiteCommandFailure);
  expect((failure as SQLiteCommandFailure).result.status).toBe('unknown');
  const count = f.trace.length;
  await expect(saveCreditCardWithAssociations(command)).rejects.toBe(failure);
  expect(f.trace).toHaveLength(count);
  await expect(f.accountRepository.getAccounts()).rejects.toThrow('not usable');
});

test.each(['before', 'after'] as const)('ROLLBACK %s stays unknown, without automatic retry', async phase => {
  const f = await setup();
  const command = { repository: f.creditCardRepository, accountId: 'card' };
  f.resetTrace(); f.injectFault({ sql: 'ROLLBACK', phase });
  let failure: unknown;
  try { await closeCreditCardWithReconciliation(command); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(SQLiteCommandFailure);
  expect((failure as SQLiteCommandFailure).result.status).toBe('unknown');
  const count = f.trace.length;
  await expect(closeCreditCardWithReconciliation(command)).rejects.toBe(failure);
  expect(f.trace).toHaveLength(count);
  await expect(f.accountRepository.getAccounts()).rejects.toThrow('not usable');
});

test('same create intention runs once, including association and alert; another create with that ID conflicts', async () => {
  const f = await setup();
  try {
    const command = { repository: f.creditCardRepository, input };
    const [first, second] = await Promise.all([saveCreditCardWithAssociations(command), saveCreditCardWithAssociations(command)]);
    expect(first).toBe(second); expect(await saveCreditCardWithAssociations(command)).toBe(first);
    const before = await financialState(f);
    await expect(saveCreditCardWithAssociations({ ...command })).rejects.toThrow('identidad');
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

test.each(['success', 'before', 'after'] as const)('explicit alert with zero matching purchases: %s is part of the card command', async phase => {
  const f = await setup();
  try {
    const before = await financialState(f); f.resetTrace();
    if (phase !== 'success') f.injectFault({ sql: 'UPDATE smart_alerts', phase });
    const command = { repository: f.creditCardRepository, input: { ...input, name: 'Other' }, pendingAlertName: 'Ghost' };
    if (phase === 'success') {
      expect((await saveCreditCardWithAssociations(command)).associatedCount).toBe(0);
      const after = await financialState(f);
      expect(after.tables.smart_alerts![0]?.status).toBe('resolved');
      expect(after.tables.transactions).toEqual(before.tables.transactions);
      expect(after.tables.accounts!.find(row => row.id === 'new-card')?.debt_balance_amount).toBe(0);
    } else {
      await expect(saveCreditCardWithAssociations(command)).rejects.toThrow();
      expect(f.trace.some(entry => entry.outcome === `injected-${phase}`)).toBe(true);
      requireIntegralRollback(before, await financialState(f));
    }
  } finally { f.native.close(); }
});

test('a profile rate changed in the same millisecond rejects an obsolete form without changing the account', async () => {
  const f = await prepare('edit');
  try {
    const expected = (await f.accountRepository.getAccounts()).find(card => card.id === 'new-card')!;
    const [profile] = await f.creditCardRepository.getProfiles(['new-card']);
    await f.creditCardRepository.saveProfiles([{ ...profile!, monthlyInterestRate: 0.035 }]);
    const before = await financialState(f);
    await expect(saveCreditCardWithAssociations({ repository: f.creditCardRepository, input, existingAccount: expected,
      expectedMonthlyInterestRate: profile!.monthlyInterestRate })).rejects.toThrow('tasa');
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

test('a purchase committed while closing is queued blocks closure after rereading current debt', async () => {
  const f = await prepare('reconcile-and-close');
  try {
    const barrier = f.pauseNextExecuteSql('UPDATE accounts', 'after');
    const purchase = f.save({ accountId: 'card', operationType: 'Crédito' });
    await barrier.reached;
    const close = closeCreditCardWithReconciliation({ repository: f.creditCardRepository, accountId: 'card' }).catch((error: unknown) => error);
    barrier.release(); await purchase;
    expect(await close).toBeInstanceOf(Error);
    expect((await f.accountRepository.getAccounts()).find(card => card.id === 'card')).toMatchObject({ status: 'active', debtBalance: { amount: 250000 } });
  } finally { f.native.close(); }
});

test('mixed connections reject association and reconciliation before BEGIN', async () => {
  const f = await prepare('associate'); const other = await setup();
  try {
    const before = await financialState(f); const beforeOther = await financialState(other);
    const account = (await f.accountRepository.getAccounts()).find(card => card.id === 'new-card')!;
    f.resetTrace(); other.resetTrace();
    await expect(associatePendingTransactionsForCreditCard({ ...f, account, creditCardRepository: other.creditCardRepository })).rejects.toThrow('mismo ámbito');
    await expect(reconcileCreditCardTransactions({ ...f, creditCardRepository: other.creditCardRepository })).rejects.toThrow('mismo ámbito');
    expect(f.trace).toHaveLength(0); expect(other.trace).toHaveLength(0);
    requireIntegralRollback(before, await financialState(f)); requireIntegralRollback(beforeOther, await financialState(other));
  } finally { f.native.close(); other.native.close(); }
});

test.each([1000, 10000, 100000])('synthetic %s rows: new command duration and reader wait', async rows => {
  const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };
  for (const flow of ['create-and-associate', 'reconcile-and-close', 'reconcile'] as const) {
    const f = await prepare(flow);
    try {
      f.native.exec(`WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<${rows})
        INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at)
        SELECT 'noise-'||n,1,'COP','Synthetic','2020-01-01','bank','expense','outflow','posted','2020-01-01','2020-01-01' FROM sequence`);
      const start = performance.now(); const operation = execute(f, flow);
      const readerStart = performance.now(); let observed = false;
      const reader = f.accountRepository.getAccounts().then(accounts => { observed = true; return accounts; });
      await Promise.resolve(); expect(observed).toBe(false);
      await operation; const operationMs = performance.now() - start;
      const accounts = await reader; const readerMs = performance.now() - readerStart;
      expect(accounts.find(card => card.id === 'bank')?.balance.amount).toBe(1000000);
      // Narrow reads preserve complete relevant history, without materializing unrelated rows.
      expect(f.trace.some(entry => /^\s*SELECT[\s\S]*FROM transactions\s+ORDER BY/.test(entry.sql))).toBe(false);
      timings.push({ rows, flow, operationMs, readerMs });
    } finally { f.native.close(); }
  }
}, 60000);
