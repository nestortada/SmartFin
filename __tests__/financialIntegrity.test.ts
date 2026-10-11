import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { deleteManualTransactionSafely } from '../src/modules/transactions/useCases/saveManualTransaction';
import { registerCreditCardPayment } from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { updateTransactionQuickly } from '../src/modules/transactions/useCases/updateTransactionQuickly';
import { deleteManualTransactionSafely as phase0Delete } from './helpers/phase0ManualTransactions';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

async function paidCard(f: Awaited<ReturnType<typeof financialIntegrityFixture>>) {
  await f.save({ accountId: 'card', operationType: 'Crédito' });
  return registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount: 100000, currentDate: FINANCIAL_TEST_DATE });
}

test('manual debit -> credit -> debit reverses the bank balance, preserves wealth and counts the expense once', async () => {
  const f = await financialIntegrityFixture();
  try {
    const debit = await f.save();
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 750000 }, debt: 0, wealth: 750000, income: 0, expense: 250000, savings: -250000 });
    const credit = await f.save({ editingTransaction: debit.transaction, accountId: 'card', operationType: 'Crédito' });
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 1000000 }, debt: 250000, wealth: 750000, income: 0, expense: 250000 });
    await f.save({ editingTransaction: credit.transaction });
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 750000 }, debt: 0, wealth: 750000, income: 0, expense: 250000 });
    expect(await f.transactionRepository.getTransactions()).toHaveLength(1);
  } finally { f.native.close(); }
});

test('deleting a debit-method credit card payment restores bank, debt and statement without changing expenses', async () => {
  const f = await financialIntegrityFixture();
  try {
    const payment = await paidCard(f);
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 900000 }, debt: 150000, wealth: 750000, income: 0, expense: 250000 });
    await deleteManualTransactionSafely({ ...f, accounts: await f.accountRepository.getAccounts(), transaction: payment.transaction });
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 1000000 }, debt: 250000, wealth: 750000, income: 0, expense: 250000 });
    expect((await f.creditCardRepository.getStatements(['card']))[0]?.totalAmount).toBe(250000);
  } finally { f.native.close(); }
});

test('editing a debit-method card payment preserves its target and identity and recomputes debt', async () => {
  const f = await financialIntegrityFixture();
  try {
    const payment = await paidCard(f);
    const result = await f.save({ editingTransaction: payment.transaction, transactionType: 'creditCardPayment', amount: 50000, targetAccountId: 'card' });
    expect(result.transaction).toMatchObject({ id: payment.transaction.id, createdAt: payment.transaction.createdAt, date: payment.transaction.date, currency: 'COP', type: 'creditCardPayment', targetAccountId: 'card', paymentMethod: 'debit' });
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 950000 }, debt: 200000, wealth: 750000, income: 0, expense: 250000 });
    expect((await f.creditCardRepository.getStatements(['card']))[0]?.totalAmount).toBe(200000);
  } finally { f.native.close(); }
});

test.each([Infinity, -Infinity, NaN])('manual amount %s rejects before changing financial state', async amount => {
  const f = await financialIntegrityFixture();
  try {
    const before = await f.snapshot();
    await expect(f.save({ amount })).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    expect(await f.transactionRepository.getTransactions()).toEqual([]);
  } finally { f.native.close(); }
});

test.each([Infinity, -Infinity, NaN])('card payment amount %s rejects before changing financial state', async amount => {
  const f = await financialIntegrityFixture();
  try {
    await f.save({ accountId: 'card', operationType: 'Crédito' });
    const before = await f.snapshot();
    await expect(registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount })).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  } finally { f.native.close(); }
});

test('taxed transfer edit and deletion reverse both legs and the tax without duplicate companions', async () => {
  const f = await financialIntegrityFixture();
  try {
    const original = await f.save({ transactionType: 'internalTransfer', targetAccountId: 'target', amount: 100000, transferTaxCharged: true });
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 899600, target: 100000 }, available: 999600, debt: 0, wealth: 999600, income: 0, expense: 400 });
    const edited = await f.save({ editingTransaction: original.transaction, transactionType: 'internalTransfer', targetAccountId: 'target', amount: 200000, transferTaxCharged: true });
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 799200, target: 200000 }, available: 999200, wealth: 999200, income: 0, expense: 800 });
    expect((await f.transactionRepository.getTransactions()).map(tx => tx.id).sort()).toEqual([original.transaction.id, `${original.transaction.id}-4x1000`, `${original.transaction.id}-in`].sort());
    await deleteManualTransactionSafely({ ...f, accounts: await f.accountRepository.getAccounts(), transaction: edited.transaction });
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 1000000, target: 0 }, wealth: 1000000, income: 0, expense: 0 });
    expect(await f.transactionRepository.getTransactions()).toEqual([]);
  } finally { f.native.close(); }
});

// Frozen characterizations of the phase 0 commit boundary, not current acceptance.
test('manual transfer failure leaves committed balances but rolls back the movement batch', async () => {
  const f = await financialIntegrityFixture({ historical: true });
  try {
    f.failOn('INSERT INTO transactions');
    await expect(f.save({ transactionType: 'internalTransfer', targetAccountId: 'target', amount: 100000, transferTaxCharged: true })).rejects.toThrow();
    f.failOn();
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 899600, target: 100000 }, wealth: 999600, income: 0, expense: 0 });
    expect(await f.transactionRepository.getTransactions()).toEqual([]);
  } finally { f.native.close(); }
});

test('card payment failure can commit bank debit before the payment movement', async () => {
  const f = await financialIntegrityFixture();
  try {
    await f.save({ accountId: 'card', operationType: 'Crédito' });
    f.failOn('INSERT INTO transactions');
    await expect(registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount: 100000, currentDate: FINANCIAL_TEST_DATE })).rejects.toThrow();
    f.failOn();
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 900000 }, debt: 250000, wealth: 650000, expense: 250000 });
    expect(await f.transactionRepository.getTransactions()).toHaveLength(1);
  } finally { f.native.close(); }
});

test('manual deletion failure can commit balance reversal while the original expense survives', async () => {
  const f = await financialIntegrityFixture({ historical: true });
  try {
    const original = await f.save();
    f.failOn('DELETE FROM transactions');
    await expect(phase0Delete({ ...f, accounts: await f.accountRepository.getAccounts(), transaction: original.transaction })).rejects.toThrow();
    f.failOn();
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 1000000 }, debt: 0, wealth: 1000000, expense: 250000 });
    expect(await f.transactionRepository.getTransactions()).toHaveLength(1);
  } finally { f.native.close(); }
});

test('repeated quick changes use persisted state, keep historical identity and never debit twice', async () => {
  const f = await financialIntegrityFixture();
  try {
    const original = await f.save({ transactionDate: '2026-08-10T12:00:00.000Z' });
    await updateTransactionQuickly(f, original.transaction.id, { kind: 'paymentMethod', operationType: 'Crédito' });
    const first = await f.snapshot();
    await updateTransactionQuickly(f, original.transaction.id, { kind: 'paymentMethod', operationType: 'Crédito' });
    expect(await f.snapshot()).toEqual(first);
    expect(first).toMatchObject({ balances: { bank: 1000000 }, debt: 250000, wealth: 750000, income: 0, expense: 0, savings: 0 });
    await updateTransactionQuickly(f, original.transaction.id, { kind: 'paymentMethod', operationType: 'Débito' });
    await updateTransactionQuickly(f, original.transaction.id, { kind: 'paymentMethod', operationType: 'Débito' });
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 750000 }, debt: 0, wealth: 750000, income: 0, expense: 0 });
    expect(await f.transactionRepository.getTransactions()).toEqual([expect.objectContaining({ id: original.transaction.id, date: original.transaction.date, createdAt: original.transaction.createdAt, amount: 250000, currency: 'COP' })]);
  } finally { f.native.close(); }
});

test('unchanged credit edits preserve installment history and reference identity', async () => {
  const f = await financialIntegrityFixture();
  try {
    const original = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3' });
    f.native.prepare('UPDATE installment_purchases SET paid_installments=1,first_due_date=? WHERE transaction_id=?').run('2026-11-25', original.transaction.id);
    const before = await f.snapshot();
    await updateTransactionQuickly(f, original.transaction.id, { kind: 'paymentMethod', operationType: 'Crédito' });
    expect(await f.snapshot()).toEqual(before);
    expect((await f.creditCardRepository.getInstallmentPurchases(['card']))[0]).toMatchObject({ id: `installment-${original.transaction.id}`, paidInstallments: 1, firstDueDate: '2026-11-25', transactionId: original.transaction.id, accountId: 'card', totalAmount: 250000, installmentCount: 3 });
  } finally { f.native.close(); }
});

test('statement write failure leaves confirmed payment and debt with a stale statement', async () => {
  const f = await financialIntegrityFixture({ historical: true });
  try {
    const payment = await paidCard(f);
    f.failOn('INSERT OR REPLACE INTO credit_card_statements');
    await expect(f.save({ editingTransaction: payment.transaction, transactionType: 'creditCardPayment', amount: 50000 })).rejects.toThrow();
    f.failOn();
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 950000 }, debt: 200000, wealth: 750000, expense: 250000 });
    expect((await f.creditCardRepository.getStatements(['card']))[0]?.totalAmount).toBe(150000);
    expect((await f.transactionRepository.getTransactions()).find(tx => tx.id === payment.transaction.id)?.amount).toBe(50000);
  } finally { f.native.close(); }
});
