import { registerCreditCardPayment, reconcileCreditCardTransactions, type RegisterCreditCardPaymentParams } from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { registerCreditCardPayment as historicalPayment } from './helpers/phase0CreditCardPayment';
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState, requireIntegralRollback, type FinancialState } from './helpers/financialState';
import { SQLiteCommandFailure, runSharedSQLiteTransaction } from '../src/database/atomicSQLite';
import { createSqliteAccountRepository } from '../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteCreditCardRepository } from '../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import type { SQLiteFault } from './helpers/realSQLite';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());
type Fixture = Awaited<ReturnType<typeof financialIntegrityFixture>>;
const matrix: { cards: number; writes: number; points: number }[] = [];
const evidence: Record<string, unknown> = {};
const rollbackPoints: unknown[] = [];
afterAll(() => {
  const { env } = require('node:process') as { env: Record<string, string | undefined> };
  if (env.SMARTFIN_PHASE3A_REPORT) {
    const fs = require('node:fs') as { writeFileSync: (path: string, value: string) => void };
    fs.writeFileSync(env.SMARTFIN_PHASE3A_REPORT, JSON.stringify({ database: 'node:sqlite :memory:', matrix, rollbackPoints, evidence }, null, 2));
  }
});
function request(f: Fixture, changes: Partial<RegisterCreditCardPaymentParams> = {}): RegisterCreditCardPaymentParams {
  return { ...f, accountId: 'card', sourceAccountId: 'bank', amount: 100000, currentDate: FINANCIAL_TEST_DATE, ...changes };
}
async function setup(cards = 1) {
  const f = await financialIntegrityFixture({ managed: true });
  await f.save({ accountId: 'card', operationType: 'Crédito' });
  if (cards === 2) {
    const card = (await f.accountRepository.getAccounts()).find(value => value.id === 'card')!;
    await f.accountRepository.saveAccounts([{ ...card, id: 'card2', name: 'Mastercard' }]);
    await f.save({ accountId: 'card2', operationType: 'Crédito', amount: 120000, installmentCountInput: '3' });
  }
  return f;
}
async function run(cards: number, fault?: SQLiteFault, historical = false) {
  const f = await setup(cards);
  try {
    const before = await financialState(f); f.resetTrace(); f.injectFault(fault);
    let error: unknown;
    let value;
    try { value = await (historical ? historicalPayment : registerCreditCardPayment)(request(f)); }
    catch (caught) { error = caught; }
    const trace = f.trace.map(entry => ({ ...entry })); f.injectFault();
    return { before, after: await financialState(f), trace, error, value };
  } finally { f.native.close(); }
}
test.each([1, 2])('%s cards: before/after every write restores all rows, audit and revision', async cards => {
  const success = await run(cards);
  expect(success.error).toBeUndefined();
  expect(success.trace.filter(entry => entry.sql.startsWith('BEGIN'))).toHaveLength(1);
  expect(success.trace.filter(entry => entry.sql.startsWith('COMMIT'))).toHaveLength(1);
  const writes = success.trace.filter(entry => entry.write !== undefined);
  expect(writes).toHaveLength(cards === 1 ? 10 : 16);
  for (const entry of writes) for (const phase of ['before', 'after'] as const) {
    const failed = await run(cards, { write: entry.write, phase });
    expect(failed.error).toBeDefined();
    expect(failed.error).not.toBeInstanceOf(SQLiteCommandFailure);
    expect(failed.trace.some(value => value.write === entry.write && value.outcome === `injected-${phase}`)).toBe(true);
    expect(failed.trace.filter(value => value.sql.startsWith('ROLLBACK') && value.outcome === 'ok')).toHaveLength(1);
    expect(failed.trace.some(value => value.sql.startsWith('COMMIT'))).toBe(false);
    requireIntegralRollback(failed.before, failed.after);
    rollbackPoints.push({ cards, write: entry.write, sql: entry.sql, phase, status: 'rolledBack', completeSnapshotEqual: true });
  }
  matrix.push({ cards, writes: writes.length, points: writes.length * 2 });
});
test('mandatory financial scenario and full successful historical equivalence', async () => {
  const current = await run(1); const historical = await run(1, undefined, true);
  expect(current.before.metrics).toMatchObject({ balances: { bank: 1000000 }, debt: 250000, expense: 250000, wealth: 750000 });
  expect(current.after.metrics).toMatchObject({ balances: { bank: 900000 }, debt: 150000, expense: 250000, wealth: 750000 });
  expect(current.after.tables.credit_card_statements?.[0]?.total_amount).toBe(150000);
  expect(current.value?.transaction).toMatchObject({ type: 'creditCardPayment', direction: 'outflow', status: 'posted', amount: 100000, currency: 'COP', accountId: 'bank', targetAccountId: 'card', paymentMethod: 'debit' });
  const normalize = (state: FinancialState) => {
    let serialized = JSON.stringify(state);
    for (const row of state.tables.transactions!) serialized = serialized.split(String(row.id)).join(`generated-${row.type}`);
    return JSON.parse(serialized) as unknown;
  };
  expect(normalize(current.after)).toEqual(normalize(historical.after));
  evidence.mandatoryScenario = { before: current.before, after: current.after, value: current.value, historicalEquivalence: true };
});
test('reproduced old debit without payment now rolls back completely', async () => {
  const historical = await run(1, { sql: 'INSERT INTO transactions', phase: 'before' }, true);
  expect(historical.after.metrics).toMatchObject({ balances: { bank: 900000 }, debt: 250000, wealth: 650000 });
  expect(() => requireIntegralRollback(historical.before, historical.after)).toThrow();
  const current = await run(1, { sql: 'INSERT INTO transactions', phase: 'before' });
  requireIntegralRollback(current.before, current.after);
  evidence.originalFailure = historical;
  evidence.correctedFailure = current;
});
test.each([Infinity, -Infinity, NaN, 0, -1])('invalid amount %s rejects before any SQL write', async amount => {
  const f = await setup();
  try {
    const before = await financialState(f); f.resetTrace();
    await expect(registerCreditCardPayment(request(f, { amount }))).rejects.toThrow();
    expect(f.trace.some(entry => entry.write !== undefined)).toBe(false);
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});
test.each(['missing card', 'closed card', 'missing source', 'closed source', 'source type', 'funds', 'no debt'])('%s rejects including initial reconciliation changes', async kind => {
  const f = await setup(2);
  try {
    if (kind === 'closed card') f.native.exec("UPDATE accounts SET status='closed' WHERE id='card'");
    if (kind === 'closed source') f.native.exec("UPDATE accounts SET status='closed' WHERE id='bank'");
    if (kind === 'source type') f.native.exec("UPDATE accounts SET type='investment' WHERE id='bank'");
    if (kind === 'funds') f.native.exec("UPDATE accounts SET balance_amount=1 WHERE id='bank'");
    if (kind === 'no debt') f.native.exec("UPDATE transactions SET status='cancelled'");
    // Make initial reconciliation observable even with the fixed clock.
    f.native.exec("UPDATE accounts SET debt_balance_amount=999 WHERE type='creditCard'; UPDATE credit_card_statements SET total_amount=999");
    const before = await financialState(f); f.resetTrace();
    await expect(registerCreditCardPayment(request(f, { accountId: kind === 'missing card' ? 'missing' : 'card', sourceAccountId: kind === 'missing source' ? 'missing' : 'bank' }))).rejects.toThrow();
    expect(f.trace.filter(entry => entry.sql.startsWith('ROLLBACK'))).toHaveLength(1);
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});
test.each([[100000.6, 100001], [900000, 250000]])('amount %s preserves round/cap rule (%s)', async (amount, paidAmount) => {
  const f = await setup();
  try {
    const result = await registerCreditCardPayment(request(f, { amount }));
    expect(result.paidAmount).toBe(paidAmount);
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 1000000 - paidAmount }, debt: 250000 - paidAmount, expense: 250000, wealth: 750000 });
  } finally { f.native.close(); }
});
test('same intention executes once; different simultaneous intentions use current debt and unique IDs', async () => {
  const f = await setup();
  try {
    const command = request(f);
    const [first, repeat] = await Promise.all([registerCreditCardPayment(command), registerCreditCardPayment(command)]);
    expect(repeat).toBe(first); expect(await registerCreditCardPayment(command)).toBe(first);
    const next = await registerCreditCardPayment(request(f, { amount: 200000 }));
    expect(next.paidAmount).toBe(150000); expect(next.transaction.id).not.toBe(first.transaction.id);
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 750000 }, debt: 0, wealth: 750000, expense: 250000 });
    expect((await f.transactionRepository.getTransactions()).filter(tx => tx.type === 'creditCardPayment')).toHaveLength(2);
  } finally { f.native.close(); }
});
test('payment identity collision rejects before initial reconciliation or debit', async () => {
  const f = await setup();
  try {
    const first = await registerCreditCardPayment(request(f));
    const sequence = Number(first.transaction.id.split('-').pop());
    const id = `tx-credit-card-payment-card-${Date.now()}-${sequence + 1}`;
    await f.transactionRepository.saveTransactions([{ ...first.transaction, id, amount: 0, status: 'cancelled' }]);
    const before = await financialState(f); f.resetTrace();
    await expect(registerCreditCardPayment(request(f))).rejects.toThrow('identidad');
    expect(f.trace.some(entry => entry.write !== undefined)).toBe(false);
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});
test.each(['debt', 'funds'])('concurrent payments reread %s; external reader waits for owner', async kind => {
  const f = await setup();
  try {
    if (kind === 'funds') f.native.exec("UPDATE accounts SET balance_amount=100000 WHERE id='bank'");
    const barrier = f.pauseNextExecuteSql('INSERT INTO transactions', 'after');
    const first = registerCreditCardPayment(request(f, { amount: kind === 'debt' ? 200000 : 100000 }));
    await barrier.reached;
    const second = registerCreditCardPayment(request(f, { amount: 200000 })).catch((error: unknown) => error);
    let read = false;
    const reader = f.accountRepository.getAccounts().then(value => { read = true; return value; });
    await Promise.resolve(); expect(read).toBe(false);
    barrier.release(); await first;
    const result = await second;
    if (kind === 'debt') {
      expect(result).toMatchObject({ paidAmount: 50000, previousDebt: 50000 });
      expect(await f.snapshot()).toMatchObject({ balances: { bank: 750000 }, debt: 0 });
    } else {
      expect(result).toBeInstanceOf(Error);
      expect(await f.snapshot()).toMatchObject({ balances: { bank: 0 }, debt: 150000 });
    }
    expect((await reader).find(value => value.id === 'bank')?.balance.amount).toBe(kind === 'debt' ? 750000 : 0);
  } finally { f.native.close(); }
});
test('a queued reader sees restored balances after a failed final statement write', async () => {
  const f = await setup();
  try {
    const before = await financialState(f);
    const barrier = f.pauseNextExecuteSql('INSERT INTO transactions', 'after');
    const payment = registerCreditCardPayment(request(f)).catch((error: unknown) => error);
    await barrier.reached;
    f.injectFault({ sql: 'INSERT OR REPLACE INTO credit_card_statements', phase: 'after' });
    let observed = false;
    const reader = f.accountRepository.getAccounts().then(value => { observed = true; return value; });
    await Promise.resolve(); expect(observed).toBe(false);
    barrier.release(); expect(await payment).toBeInstanceOf(Error);
    expect((await reader).find(value => value.id === 'bank')?.balance.amount).toBe(1000000);
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});
test('pending purchases/payments count, cancelled do not; other cards and installment progress preserved', async () => {
  const f = await setup(2);
  try {
    const original = (await f.transactionRepository.getTransactions()).find(tx => tx.accountId === 'card')!;
    await f.transactionRepository.saveTransactions([
      { ...original, status: 'pending' },
      { ...original, id: 'cancelled-purchase', amount: 999999, status: 'cancelled' },
      { ...original, id: 'pending-payment', accountId: 'bank', targetAccountId: 'card', amount: 10000, type: 'creditCardPayment', status: 'pending', paymentMethod: 'debit' },
      { ...original, id: 'cancelled-payment', accountId: 'bank', targetAccountId: 'card', amount: 999999, type: 'creditCardPayment', status: 'cancelled' },
    ]);
    f.native.exec("UPDATE installment_purchases SET paid_installments=1");
    await reconcileCreditCardTransactions({ ...f, currentDate: FINANCIAL_TEST_DATE });
    const before = await financialState(f);
    const result = await registerCreditCardPayment(request(f));
    expect(result.previousDebt).toBe(240000); expect(result.remainingDebt).toBe(140000);
    const after = await financialState(f);
    expect(after.tables.installment_purchases).toEqual(before.tables.installment_purchases);
    expect(after.tables.credit_card_statements?.find(row => row.account_id === 'card2')).toEqual(before.tables.credit_card_statements?.find(row => row.account_id === 'card2'));
    expect(after.tables.accounts?.find(row => row.id === 'card2')).toEqual(before.tables.accounts?.find(row => row.id === 'card2'));
    expect(after.metrics.expense).toBe(120000);
  } finally { f.native.close(); }
});
test('mixed connection repositories reject before BEGIN', async () => {
  const f = await setup(); const other = await setup();
  try {
    const before = await financialState(f); const otherBefore = await financialState(other); f.resetTrace();
    await expect(registerCreditCardPayment(request(f, { creditCardRepository: other.creditCardRepository }))).rejects.toThrow('mismo ámbito');
    expect(f.trace).toHaveLength(0);
    requireIntegralRollback(before, await financialState(f)); requireIntegralRollback(otherBefore, await financialState(other));
  } finally { f.native.close(); other.native.close(); }
});
test('participant shares one outer transaction, cannot reuse provisional result after rollback', async () => {
  const f = await setup(); let command: RegisterCreditCardPaymentParams | undefined;
  try {
    const before = await financialState(f); f.resetTrace();
    const result = await runSharedSQLiteTransaction(f.database, async participant => {
      command = request(f, { accountRepository: createSqliteAccountRepository(participant), creditCardRepository: createSqliteCreditCardRepository(participant), transactionRepository: createSqliteTransactionRepository(participant) });
      await registerCreditCardPayment(command); throw new Error('Outer failure');
    });
    expect(result.status).toBe('rolledBack');
    expect(f.trace.filter(entry => entry.sql.startsWith('BEGIN'))).toHaveLength(1);
    requireIntegralRollback(before, await financialState(f));
    await expect(registerCreditCardPayment(command!)).rejects.toThrow('expired');
  } finally { f.native.close(); }
});
test.each(['before', 'after'] as const)('COMMIT %s: unknown result never retries same intention', async phase => {
  const f = await setup(); const command = request(f); f.resetTrace(); f.injectFault({ sql: 'COMMIT', phase });
  let failure: unknown;
  try { await registerCreditCardPayment(command); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(SQLiteCommandFailure);
  expect((failure as SQLiteCommandFailure).result.status).toBe('unknown');
  const count = f.trace.length;
  await expect(registerCreditCardPayment(command)).rejects.toBe(failure);
  expect(f.trace).toHaveLength(count);
  expect(f.trace.filter(entry => entry.sql.startsWith('COMMIT'))).toHaveLength(1);
  expect(f.trace.some(entry => entry.sql.startsWith('ROLLBACK'))).toBe(false);
  await expect(f.accountRepository.getAccounts()).rejects.toThrow('not usable');
});
test.each(['before', 'after'] as const)('ROLLBACK %s: unknown preserves original and rollback errors, no retry', async phase => {
  const f = await setup(); const command = request(f, { sourceAccountId: 'missing' });
  f.resetTrace(); f.injectFault({ sql: 'ROLLBACK', phase });
  let failure: unknown;
  try { await registerCreditCardPayment(command); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(SQLiteCommandFailure);
  expect((failure as SQLiteCommandFailure).result).toMatchObject({ status: 'unknown', error: expect.any(Error), rollbackError: expect.any(Error) });
  const count = f.trace.length; await expect(registerCreditCardPayment(command)).rejects.toBe(failure);
  expect(f.trace).toHaveLength(count);
  await expect(f.accountRepository.getAccounts()).rejects.toThrow('not usable');
});
