// Phase 1a.4B: extraordinary payments «No sé» (`unspecified`), allocations, lazy revision 0 and D6 reversals.
// Synthetic SQLite only, deterministic civil dates.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState, requireIntegralRollback, type FinancialState } from './helpers/financialState';
import { realSQLite, type SQLiteFault } from './helpers/realSQLite';
import { applyVersionedMigrations } from '../src/database/migrations';
import { SQLiteCommandFailure } from '../src/database/atomicSQLite';
import { manageSQLiteDatabase } from '../src/database/managedSQLite';
import { createSqliteAccountRepository } from '../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteInstallmentHistoryRepository } from '../src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository';
import { serializeCreditCardVisualMetadata } from '../src/modules/creditCards/useCases/manageCreditCards';
import * as initialRevisionModule from '../src/modules/creditCards/useCases/initialInstallmentRevision';
import {
  allocateCreditCardPaymentToPurchase,
  extraordinaryPaymentTransactionId,
  registerExtraordinaryInstallmentPayment,
  type ExtraordinaryInstallmentPaymentParams,
  type InstallmentAllocationOutcome,
} from '../src/modules/creditCards/useCases/extraordinaryInstallmentPayment';
import * as reversalModule from '../src/modules/creditCards/useCases/installmentAllocationReversal';
import { ActiveInstallmentAllocationError } from '../src/modules/creditCards/useCases/installmentAllocationReversal';
import {
  associatePendingTransactionsForCreditCard,
  registerCreditCardPayment,
} from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import {
  deleteManualTransactionSafely,
  saveManualTransaction,
  type SaveManualTransactionParams,
} from '../src/modules/transactions/useCases/saveManualTransaction';
import { updateTransactionQuickly } from '../src/modules/transactions/useCases/updateTransactionQuickly';
import { createSqliteCategoryRepository } from '../src/modules/categories/repositories/sqliteCategoryRepository';
import type { Transaction } from '../src/modules/transactions/types';
import type { SQLitePrimitive } from '../src/database/sqliteRows';

type Fixture = Awaited<ReturnType<typeof financialIntegrityFixture>>;
type Rows = Record<string, SQLitePrimitive>[];
const fs = require('node:fs') as {
  mkdtempSync: (prefix: string) => string; rmSync: (path: string, options: object) => void; readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string, options: { recursive: boolean }) => string[];
};
const { join } = require('node:path') as { join: (...parts: string[]) => string };
const { tmpdir } = require('node:os') as { tmpdir: () => string };

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

const NOW = FINANCIAL_TEST_DATE.toISOString();
const LATER = new Date(FINANCIAL_TEST_DATE.getTime() + 3_600_000);
const rows = (f: { query: Fixture['query'] }, sql: string, values: SQLitePrimitive[] = []): Rows => f.query(sql, values).rows.raw();
const allocations = (f: { query: Fixture['query'] }) => rows(f, 'SELECT * FROM installment_allocations ORDER BY created_at, id');
const revisions = (f: { query: Fixture['query'] }, purchaseId?: string) => purchaseId
  ? rows(f, 'SELECT * FROM installment_plan_revisions WHERE installment_purchase_id = ? ORDER BY revision_number', [purchaseId])
  : rows(f, 'SELECT * FROM installment_plan_revisions ORDER BY installment_purchase_id, revision_number');
const shape = (row: Record<string, SQLitePrimitive>) => [row.revision_number, row.source, row.verification, row.pending_reasons,
  row.remaining_principal_cents, row.remaining_installments, row.installment_amount_cents, row.effective_cycle_end];
const counter = (f: { query: Fixture['query'] }) => Number(rows(f, 'SELECT revision FROM financial_data_revision')[0]!.revision);
const writesOf = (f: Fixture) => f.trace.filter(entry => entry.write !== undefined);
const controlOf = (f: Fixture) => f.trace.filter(entry => /^(BEGIN|COMMIT|ROLLBACK)/.test(entry.sql)).map(entry => /^[A-Z]+/.exec(entry.sql)![0]);
const failure = async (promise: Promise<unknown>) => promise.then(() => undefined, (error: Error) => error);

async function fixture(options: { closingDay?: number; syntheticPath?: string } = {}) {
  const f = await financialIntegrityFixture({ managed: true, syntheticPath: options.syntheticPath });
  f.native.exec(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at)
    VALUES ('card2','Master','creditCard','active','COP',0,0,'2026-01-01','2026-01-01')`);
  if (options.closingDay)
    f.native.prepare("UPDATE accounts SET description = ? WHERE id = 'card'").run(serializeCreditCardVisualMetadata({ closingDay: options.closingDay }));
  return f;
}

async function purchase(f: Fixture, amount = 600000, installments = 6, changes: Partial<SaveManualTransactionParams> = {}) {
  const saved = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: String(installments), amount,
    merchantName: `Compra ${amount}`, ...changes });
  return { transaction: saved.transaction, id: `installment-${saved.transaction.id}` };
}

const deps = (f: Fixture) => ({ accountRepository: f.accountRepository, creditCardRepository: f.creditCardRepository,
  transactionRepository: f.transactionRepository });

function pay(f: Fixture, purchaseId: string, changes: Partial<ExtraordinaryInstallmentPaymentParams> = {}) {
  return registerExtraordinaryInstallmentPayment({
    ...deps(f), cardAccountId: 'card', installmentPurchaseId: purchaseId, sourceAccountId: 'bank',
    paymentAmount: 100000, allocatedAmount: 100000, mode: 'unspecified', commandId: 'cmd-1', currentDate: FINANCIAL_TEST_DATE,
    ...changes,
  });
}

const registered = async (promise: Promise<unknown>) => {
  const result = await promise;
  if ((result as InstallmentAllocationOutcome).status !== 'registered') throw new Error('expected a registered allocation');
  return result as InstallmentAllocationOutcome;
};

async function current(f: Fixture, id: string): Promise<Transaction> {
  const found = (await f.transactionRepository.getTransactions()).find(row => row.id === id);
  if (!found) throw new Error(`missing transaction ${id}`);
  return found;
}

async function editPayment(f: Fixture, paymentId: string, changes: Partial<SaveManualTransactionParams> = {}) {
  const payment = await current(f, paymentId);
  return saveManualTransaction({
    ...deps(f), accounts: await f.accountRepository.getAccounts(), accountId: payment.accountId, amount: payment.amount,
    merchantName: payment.merchantName ?? payment.description, notes: 'Pago de tarjeta', operationType: 'Débito',
    transactionType: 'creditCardPayment', targetAccountId: payment.targetAccountId, editingTransaction: payment,
    hasInterestFreeInstallments: false, installmentCountInput: '1', interestFreeInstallmentCountInput: '', currentDate: LATER, now: LATER,
    ...changes,
  });
}

async function deleteMovement(f: Fixture, id: string) {
  return deleteManualTransactionSafely({ ...deps(f), accounts: await f.accountRepository.getAccounts(), transaction: await current(f, id) });
}

async function editPurchase(f: Fixture, transactionId: string, changes: Partial<SaveManualTransactionParams> = {}) {
  const transaction = await current(f, transactionId);
  return saveManualTransaction({
    ...deps(f), accounts: await f.accountRepository.getAccounts(), accountId: transaction.accountId, amount: transaction.amount,
    merchantName: transaction.merchantName ?? transaction.description, operationType: 'Crédito', transactionType: 'expense',
    editingTransaction: transaction, hasInterestFreeInstallments: false, installmentCountInput: '6',
    interestFreeInstallmentCountInput: '', currentDate: LATER, now: LATER, ...changes,
  });
}

/** Synthetic confirmed statement revision (test helper only: there is no production path to confirm statements). */
async function confirmStatement(f: Fixture, purchaseId: string, principalCents: number, installments: number, cycleEnd: string) {
  return createSqliteInstallmentHistoryRepository(f.database).appendPlanRevision({
    installmentPurchaseId: purchaseId, source: 'statement', remainingPrincipalCents: principalCents, remainingInstallments: installments,
    installmentAmountCents: Math.floor(principalCents / installments), effectiveCycleEnd: cycleEnd, verification: 'confirmed',
    pendingReasons: [], createdAt: LATER.toISOString(),
  });
}

const withoutTables = (state: FinancialState, names: string[]) => ({
  ...state, tables: Object.fromEntries(Object.entries(state.tables).filter(([name]) => !names.includes(name))),
});

describe('current behaviour reproduced before the change (synthetic data)', () => {
  test('an ordinary payment moves the money once; the guards block deleting or materially editing an allocated payment', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f);
      const before = await f.snapshot();
      const payment = await registerCreditCardPayment({ ...deps(f), accountId: 'card', sourceAccountId: 'bank', amount: 100000, currentDate: FINANCIAL_TEST_DATE });
      const after = await f.snapshot();
      expect([before.balances.bank, after.balances.bank, before.debt, after.debt]).toEqual([1000000, 900000, 600000, 500000]);
      expect(after.wealth).toBe(before.wealth);
      // A raw allocation, without the use case: the SQLite guards are the last line of defence.
      f.native.exec(`INSERT INTO installment_allocations VALUES ('raw','${payment.transaction.id}','${id}',100,'unspecified','active','raw','${NOW}',NULL)`);
      expect(() => f.native.exec(`DELETE FROM transactions WHERE id = '${payment.transaction.id}'`)).toThrow('imputaciones activas');
      expect(() => f.native.exec(`UPDATE transactions SET amount = 1 WHERE id = '${payment.transaction.id}'`)).toThrow('imputaciones activas');
      // The date is not guarded by SQLite: only the use case can make that edit reverse the allocation.
      f.native.exec(`UPDATE transactions SET date = '2026-10-01T12:00:00.000Z' WHERE id = '${payment.transaction.id}'`);
      expect(allocations(f)[0]!.status).toBe('active');
    } finally { f.native.close(); }
  });

  test('partial payments below $1 are rejected; the extraordinary payment never rounds', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f);
      await expect(registerCreditCardPayment({ ...deps(f), accountId: 'card', sourceAccountId: 'bank', amount: 0.4 }))
        .rejects.toThrow('al menos $1');
      const before = await financialState(f);
      for (const paymentAmount of [0.4, 1.6, 0, -5, Number.NaN])
        await expect(pay(f, id, { paymentAmount, allocatedAmount: 0.4, commandId: `small-${paymentAmount}` })).rejects.toThrow('pesos enteros');
      for (const allocatedAmount of [0.004, 0, -1, Number.POSITIVE_INFINITY])
        await expect(pay(f, id, { allocatedAmount, commandId: `alloc-${allocatedAmount}` })).rejects.toThrow('dos decimales');
      await expect(pay(f, id, { allocatedAmount: 100000.01, commandId: 'over' })).rejects.toThrow('no puede superar el pago');
      expect(await financialState(f)).toEqual(before);
    } finally { f.native.close(); }
  });
});

describe('scenario A: a simple «No sé» payment', () => {
  test('one payment, one debit, one debt reduction, one active allocation and a pending revision; the calendar is untouched', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f);
      const before = await f.snapshot();
      const counterBefore = counter(f);
      const plan = rows(f, 'SELECT * FROM installment_purchases');
      f.resetTrace();
      const result = await registered(pay(f, id));
      expect(controlOf(f)).toEqual(['BEGIN', 'COMMIT']);
      const after = await f.snapshot();
      expect(after.balances.bank).toBe(before.balances.bank! - 100000);
      expect(after.debt).toBe(before.debt! - 100000);
      expect([after.wealth, after.income, after.expense]).toEqual([before.wealth, before.income, before.expense]);
      expect(result).toMatchObject({ paymentCents: 10000000, requestedCents: 10000000, allocatedCents: 10000000,
        unallocatedPaymentCents: 0, estimatedPrincipalBeforeCents: 60000000, estimatedPrincipalAfterCents: 50000000 });
      expect(result.payment.id).toBe(extraordinaryPaymentTransactionId('card', 'cmd-1'));
      expect(rows(f, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'creditCardPayment'")).toEqual([{ n: 1 }]);
      expect(allocations(f)).toEqual([{ id: 'installment-allocation-cmd-1', payment_transaction_id: result.payment.id,
        installment_purchase_id: id, amount_cents: 10000000, mode: 'unspecified', status: 'active', command_id: 'cmd-1',
        created_at: NOW, reversed_at: null }]);
      expect(revisions(f).map(shape)).toEqual([
        [0, 'original', 'pendingVerification', 'firstCycleUnconfirmed', 60000000, 6, 10000000, null],
        // Scheduled count kept, no installment amount, no cycle: nothing is inferred about the bank's application.
        [1, 'allocation', 'pendingVerification', 'allocationUnconfirmed', 50000000, 6, null, null],
      ]);
      expect(revisions(f)[1]).toMatchObject({ allocation_id: 'installment-allocation-cmd-1', created_at: NOW,
        basis_total_amount: null, basis_monthly_amount: null, basis_installment_count: null });
      // Plan row, paid_installments and status are unchanged; the allocation adds 2 history rows to the counter.
      expect(rows(f, 'SELECT * FROM installment_purchases')).toEqual(plan);
      expect(counter(f) - counterBefore).toBeGreaterThan(2);
      expect(rows(f, 'PRAGMA foreign_key_check')).toEqual([]);
    } finally { f.native.close(); }
  });

  test('the allocation is not a movement: the same payment without allocation leaves identical finances and tables', async () => {
    const run = async (extraordinary: boolean) => {
      jest.setSystemTime(FINANCIAL_TEST_DATE);
      const f = await fixture();
      try {
        const { id } = await purchase(f);
        const base = counter(f);
        if (extraordinary) await pay(f, id);
        else await registerCreditCardPayment({ ...deps(f), accountId: 'card', sourceAccountId: 'bank', amount: 100000, currentDate: FINANCIAL_TEST_DATE });
        // Only identities differ: the payment id (command instead of clock) and the module-wide manual id sequence.
        const state = JSON.parse(JSON.stringify(await financialState(f))
          .replace(/tx-credit-card-payment-card-[^"]+/g, 'payment').replace(/tx_manual_\d+_\d+/g, 'manual')) as FinancialState;
        return { state, delta: counter(f) - base };
      } finally { f.native.close(); }
    };
    const ordinary = await run(false);
    const extraordinary = await run(true);
    const history = ['installment_allocations', 'installment_plan_revisions', 'financial_data_revision'];
    expect(withoutTables(extraordinary.state, history)).toEqual(withoutTables(ordinary.state, history));
    expect(extraordinary.state.metrics).toEqual(ordinary.state.metrics);
    // Exactly the allocation and its revision move the backup counter on top of the ordinary payment.
    expect(extraordinary.delta - ordinary.delta).toBe(2);
  });
});

describe('scenario B: two payments to the same purchase', () => {
  test('allocations and estimate accumulate, without duplicates', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f);
      const first = await registered(pay(f, id));
      const second = await registered(pay(f, id, { commandId: 'cmd-2', paymentAmount: 150000, allocatedAmount: 150000 }));
      expect(second.payment.id).not.toBe(first.payment.id);
      expect([first.estimatedPrincipalAfterCents, second.estimatedPrincipalBeforeCents, second.estimatedPrincipalAfterCents])
        .toEqual([50000000, 50000000, 35000000]);
      expect(allocations(f).map(row => [row.command_id, row.amount_cents, row.status])).toEqual([
        ['cmd-1', 10000000, 'active'], ['cmd-2', 15000000, 'active']]);
      expect(revisions(f).map(row => [row.revision_number, row.source, row.remaining_principal_cents])).toEqual([
        [0, 'original', 60000000], [1, 'allocation', 50000000], [2, 'allocation', 35000000]]);
      expect((await f.snapshot()).debt).toBe(350000);
    } finally { f.native.close(); }
  });
});

describe('scenario C: one active allocation per payment', () => {
  test('a second allocation of the same payment is rejected and changes nothing', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f);
      const other = await purchase(f, 300000, 3);
      const first = await registered(pay(f, id, { allocatedAmount: 40000 }));
      const before = await financialState(f);
      for (const target of [other.id, id]) {
        await expect(allocateCreditCardPaymentToPurchase({ ...deps(f), paymentTransactionId: first.payment.id,
          installmentPurchaseId: target, allocatedAmount: 10000, mode: 'unspecified', commandId: `second-${target}`, currentDate: LATER }))
          .rejects.toThrow('ya está imputado');
      }
      expect(await financialState(f)).toEqual(before);
    } finally { f.native.close(); }
  });

  test('after a reversal the payment can be allocated again only with a new explicit command', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f);
      const first = await registered(pay(f, id));
      await editPayment(f, first.payment.id, { transactionDate: '2026-10-10T12:00:00.000Z' });
      expect(allocations(f).map(row => row.status)).toEqual(['reversed']);
      // The original command replays the reversed allocation: never reactivated.
      const replay = await pay(f, id);
      expect(replay).toMatchObject({ status: 'replayed', allocation: { status: 'reversed' } });
      const again = await registered(allocateCreditCardPaymentToPurchase({ ...deps(f), paymentTransactionId: first.payment.id,
        installmentPurchaseId: id, allocatedAmount: 100000, mode: 'unspecified', commandId: 'reallocate', currentDate: LATER }));
      expect(again.estimatedPrincipalBeforeCents).toBe(60000000);
      expect(allocations(f).map(row => [row.command_id, row.status])).toEqual([['cmd-1', 'reversed'], ['reallocate', 'active']]);
      expect(rows(f, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'creditCardPayment'")).toEqual([{ n: 1 }]);
    } finally { f.native.close(); }
  });
});

describe('scenario D: editing an allocated payment reverses all its allocations (D6)', () => {
  const editCases: [string, Partial<SaveManualTransactionParams>][] = [
    ['amount', { amount: 90000 }],
    ['source account', { accountId: 'target' }],
    ['target card', { targetAccountId: 'card2' }],
    ['date', { transactionDate: '2026-10-09T12:00:00.000Z' }],
  ];
  test.each(editCases)('%s: reversal, corrective revision restoring the plan, the edit, one transaction, no re-imputation', async (_label, changes) => {
    const f = await fixture();
    try {
      const { id } = await purchase(f);
      const result = await registered(pay(f, id));
      f.resetTrace();
      await editPayment(f, result.payment.id, changes);
      expect(controlOf(f)).toEqual(['BEGIN', 'COMMIT']);
      const writes = writesOf(f).map(entry => entry.sql.trim().split(/\s+/).slice(0, 3).join(' '));
      // Reversal first (allocation, corrective revision), then the edit of the payment row.
      expect(writes.slice(0, 2)).toEqual(['UPDATE installment_allocations SET', 'INSERT INTO installment_plan_revisions']);
      expect(allocations(f)).toEqual([expect.objectContaining({ status: 'reversed', reversed_at: LATER.toISOString() })]);
      expect(revisions(f).map(shape)).toEqual([
        [0, 'original', 'pendingVerification', 'firstCycleUnconfirmed', 60000000, 6, 10000000, null],
        [1, 'allocation', 'pendingVerification', 'allocationUnconfirmed', 50000000, 6, null, null],
        [2, 'allocationReversal', 'pendingVerification', 'allocationReversed,firstCycleUnconfirmed', 60000000, 6, 10000000, null],
      ]);
      const payment = await current(f, result.payment.id);
      expect({ amount: payment.amount, accountId: payment.accountId, targetAccountId: payment.targetAccountId })
        .toMatchObject({ amount: changes.amount ?? 100000, accountId: changes.accountId ?? 'bank', targetAccountId: changes.targetAccountId ?? 'card' });
      expect(rows(f, "SELECT COUNT(*) AS n FROM installment_allocations WHERE status = 'active'")).toEqual([{ n: 0 }]);
      expect(rows(f, 'PRAGMA foreign_key_check')).toEqual([]);
    } finally { f.native.close(); }
  });

  test('deleting the payment reverses first, keeps the allocation as history and restores the money once', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f);
      const before = await f.snapshot();
      const result = await registered(pay(f, id));
      await deleteMovement(f, result.payment.id);
      expect(await f.snapshot()).toEqual(before);
      expect(allocations(f)).toEqual([expect.objectContaining({ payment_transaction_id: result.payment.id, status: 'reversed' })]);
      expect(revisions(f).map(row => row.source)).toEqual(['original', 'allocation', 'allocationReversal']);
      expect(rows(f, 'SELECT id FROM transactions WHERE id = ?', [result.payment.id])).toEqual([]);
    } finally { f.native.close(); }
  });

  test('a description-only edit is not a financial edit: the allocation stays active', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f);
      const result = await registered(pay(f, id));
      await editPayment(f, result.payment.id, { merchantName: 'Abono a la compra del televisor' });
      expect(allocations(f).map(row => row.status)).toEqual(['active']);
      expect(revisions(f)).toHaveLength(2);
    } finally { f.native.close(); }
  });
});

describe('scenarios E1/E2: reversal with later revisions', () => {
  test('E1: a later pending revision (another allocation) is kept; the estimate adds back only the reversed amount', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f);
      const first = await registered(pay(f, id));
      await registered(pay(f, id, { commandId: 'cmd-2', paymentAmount: 150000, allocatedAmount: 150000 }));
      await deleteMovement(f, first.payment.id);
      expect(revisions(f).map(shape)).toEqual([
        [0, 'original', 'pendingVerification', 'firstCycleUnconfirmed', 60000000, 6, 10000000, null],
        [1, 'allocation', 'pendingVerification', 'allocationUnconfirmed', 50000000, 6, null, null],
        [2, 'allocation', 'pendingVerification', 'allocationUnconfirmed', 35000000, 6, null, null],
        // 600,000 − 150,000 still allocated: the projection stays unknown while an allocation is unconfirmed.
        [3, 'allocationReversal', 'pendingVerification', 'allocationReversed,allocationUnconfirmed', 45000000, 6, null, null],
      ]);
      expect(allocations(f).map(row => [row.command_id, row.status])).toEqual([['cmd-1', 'reversed'], ['cmd-2', 'active']]);
    } finally { f.native.close(); }
  });

  test('E2: a later confirmed revision is never rewritten nor undone; the corrective revision starts from it and stays pending', async () => {
    const f = await fixture({ closingDay: 20 });
    try {
      const { id } = await purchase(f);
      const result = await registered(pay(f, id));
      const confirmed = await confirmStatement(f, id, 45000000, 5, '2026-11-20');
      const confirmedRow = revisions(f, id)[2];
      await editPayment(f, result.payment.id, { amount: 80000 });
      const history = revisions(f, id);
      expect(history[2]).toEqual(confirmedRow);
      expect(confirmed.verification).toBe('confirmed');
      expect(shape(history[3]!)).toEqual([3, 'allocationReversal', 'pendingVerification',
        'allocationReversed,statementAdjustmentRequired', 45000000, 5, 9000000, '2026-11-20']);
      // The plan from before the allocation (rev. 0: 600,000 in 6) is not restored automatically.
      expect(history[3]!.remaining_principal_cents).not.toBe(60000000);
      expect(allocations(f).map(row => row.status)).toEqual(['reversed']);
      // Until a statement adjusts the plan, a new allocation has no reliable limit.
      await expect(pay(f, id, { commandId: 'after-adjustment' })).rejects.toThrow('extracto bancario');
    } finally { f.native.close(); }
  });

  test('an unconfirmed statement revision never anchors the estimate, but never blocks a reversal either', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f);
      const result = await registered(pay(f, id));
      await createSqliteInstallmentHistoryRepository(f.database).appendPlanRevision({ installmentPurchaseId: id, source: 'statement',
        remainingPrincipalCents: 40000000, remainingInstallments: 4, installmentAmountCents: 10000000, effectiveCycleEnd: '2026-11-20',
        verification: 'pendingVerification', pendingReasons: ['manualReview'], createdAt: LATER.toISOString() });
      await expect(pay(f, id, { commandId: 'cmd-2' })).rejects.toThrow('extracto sin confirmar');
      await deleteMovement(f, result.payment.id);
      expect(shape(revisions(f, id).at(-1)!)).toEqual([3, 'allocationReversal', 'pendingVerification', 'allocationReversed,manualReview',
        null, null, null, null]);
    } finally { f.native.close(); }
  });
});

describe('scenario F: lazy revision 0 for plans of the intermediate 1a.3B code', () => {
  async function intermediatePurchase(f: Fixture) {
    const spy = jest.spyOn(initialRevisionModule, 'recordInitialInstallmentRevision').mockResolvedValue(undefined);
    try { return await purchase(f); } finally { spy.mockRestore(); }
  }

  test.each([[undefined, 'firstCycleUnconfirmed,lazyInitialRevision', null], [20, 'lazyInitialRevision', '2026-10-20']] as const)(
    'closing day %s: revision 0 is written once, marked lazy and pending, from the stored terms; nothing else is invented',
    async (closingDay, reasons, cycle) => {
      const f = await fixture(closingDay ? { closingDay } : {});
      try {
        const { id } = await intermediatePurchase(f);
        expect(revisions(f)).toEqual([]);
        const plan = rows(f, 'SELECT * FROM installment_purchases');
        const movements = rows(f, "SELECT * FROM transactions WHERE type <> 'creditCardPayment'");
        const result = await registered(pay(f, id, { currentDate: LATER }));
        expect(result.lazyInitialRevision).toMatchObject({ revisionNumber: 0, source: 'original', verification: 'pendingVerification' });
        expect(revisions(f).map(shape)).toEqual([
          [0, 'original', 'pendingVerification', reasons, 60000000, 6, 10000000, cycle],
          [1, 'allocation', 'pendingVerification', 'allocationUnconfirmed', 50000000, 6, null, null],
        ]);
        // Provenance: written when the allocation was made, not on the purchase date.
        expect(revisions(f)[0]).toMatchObject({ created_at: LATER.toISOString(), basis_total_amount: 600000, basis_installment_count: 6 });
        expect(rows(f, 'SELECT * FROM installment_purchases')).toEqual(plan);
        expect(rows(f, "SELECT * FROM transactions WHERE type <> 'creditCardPayment'")).toEqual(movements);
        await registered(pay(f, id, { commandId: 'cmd-2', currentDate: LATER }));
        expect(revisions(f).filter(row => row.source === 'original')).toHaveLength(1);
      } finally { f.native.close(); }
    });

  test('a regular revision 0 is reused; a lazy one is distinguishable from the purchase-time and migration ones', async () => {
    const f = await fixture({ closingDay: 20 });
    try {
      const regular = await purchase(f);
      const result = await registered(pay(f, regular.id));
      expect(result.lazyInitialRevision).toBeUndefined();
      expect(shape(revisions(f, regular.id)[0]!)).toEqual([0, 'original', 'projected', null, 60000000, 6, 10000000, '2026-10-20']);
    } finally { f.native.close(); }
  });

  test('a failure after the lazy revision rolls it back with the payment', async () => {
    const f = await fixture();
    try {
      const { id } = await intermediatePurchase(f);
      const before = await financialState(f);
      f.resetTrace(); f.injectFault({ phase: 'before', sql: 'INSERT INTO installment_allocations' });
      await expect(pay(f, id)).rejects.toThrow();
      f.injectFault();
      requireIntegralRollback(before, await financialState(f));
      expect(revisions(f)).toEqual([]);
    } finally { f.native.close(); }
  });
});

describe('scenario H: cents', () => {
  test('principal and limit come from exact cents, never from the legacy rounded monthly amount', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f, 1234.56, 6);
      expect(rows(f, 'SELECT monthly_amount FROM installment_purchases')).toEqual([{ monthly_amount: 206 }]);
      const first = await registered(pay(f, id, { paymentAmount: 1000, allocatedAmount: 1000 }));
      expect([first.estimatedPrincipalBeforeCents, first.estimatedPrincipalAfterCents]).toEqual([123456, 23456]);
      const second = await registered(pay(f, id, { commandId: 'cmd-2', paymentAmount: 234, allocatedAmount: 233.5 }));
      // 206 × 6 = 1,236 pesos would allow 23,600 cents; the exact principal leaves 23,456.
      expect([second.requestedCents, second.allocatedCents, second.unallocatedPaymentCents, second.estimatedPrincipalAfterCents])
        .toEqual([23350, 23350, 50, 106]);
    } finally { f.native.close(); }
  });

  test('an inexact principal has no reliable limit: rejected, nothing written', async () => {
    const f = await fixture();
    try {
      // 1,000.005 has no exact two-decimal value: revision 0 keeps a NULL principal.
      const { id } = await purchase(f, 1000.005, 3);
      const before = await financialState(f);
      await expect(pay(f, id, { paymentAmount: 100, allocatedAmount: 10 })).rejects.toThrow('no se conoce con exactitud');
      expect(await financialState(f)).toEqual(before);
    } finally { f.native.close(); }
  });
});

describe('scenario I: payment above the estimated principal; zero estimate', () => {
  test('only the pending principal is allocated, the surplus stays a general payment, the purchase is not marked paid', async () => {
    const f = await fixture();
    try {
      const small = await purchase(f, 80000, 2);
      const other = await purchase(f, 200000, 4);
      const before = await f.snapshot();
      const result = await registered(pay(f, small.id, { paymentAmount: 120000, allocatedAmount: 120000 }));
      expect(result).toMatchObject({ paymentCents: 12000000, requestedCents: 12000000, allocatedCents: 8000000,
        unallocatedPaymentCents: 4000000, estimatedPrincipalBeforeCents: 8000000, estimatedPrincipalAfterCents: 0 });
      const after = await f.snapshot();
      expect([after.debt, after.balances.bank]).toEqual([before.debt! - 120000, before.balances.bank! - 120000]);
      expect(rows(f, 'SELECT status, paid_installments FROM installment_purchases ORDER BY total_amount'))
        .toEqual([{ status: 'active', paid_installments: 0 }, { status: 'active', paid_installments: 0 }]);
      expect(shape(revisions(f, small.id)[1]!)).toEqual([1, 'allocation', 'pendingVerification',
        'allocationUnconfirmed,estimatedPrincipalZero', 0, 2, null, null]);
      // The 40,000 surplus is assigned to no other purchase.
      expect(allocations(f)).toHaveLength(1);
      expect(revisions(f, other.id).map(row => row.source)).toEqual(['original']);
      const zero = await failure(pay(f, small.id, { commandId: 'cmd-2', paymentAmount: 10000, allocatedAmount: 10000 }));
      expect(zero?.message).toContain('no tiene capital pendiente estimado');
      expect((await f.snapshot()).debt).toBe(after.debt);
    } finally { f.native.close(); }
  });

  test('the payment is never reduced to the debt silently', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f, 80000, 2);
      const before = await financialState(f);
      await expect(pay(f, id, { paymentAmount: 90000, allocatedAmount: 80000 })).rejects.toThrow('supera la deuda');
      requireIntegralRollback(before, await financialState(f));
    } finally { f.native.close(); }
  });
});

describe('eligibility', () => {
  test('paid, cancelled, other card, missing, other currency or deleted purchases are rejected before any write', async () => {
    const f = await fixture();
    try {
      const target = await purchase(f);
      const onOtherCard = await purchase(f, 300000, 3, { accountId: 'card2' });
      const rejectsWithoutChanges = async (changes: Partial<ExtraordinaryInstallmentPaymentParams>, message: string, purchaseId = target.id) => {
        const before = await financialState(f);
        expect((await failure(pay(f, purchaseId, changes)))?.message).toContain(message);
        expect(await financialState(f)).toEqual(before);
      };
      await rejectsWithoutChanges({ commandId: 'other' }, 'otra tarjeta', onOtherCard.id);
      await rejectsWithoutChanges({ commandId: 'missing' }, 'no existe', 'installment-missing');
      await rejectsWithoutChanges({ cardAccountId: 'card2', commandId: 'wrong-card' }, 'otra tarjeta');
      for (const [change, message] of [["status = 'paid'", 'pagada'], ["status = 'cancelled'", 'cancelada'],
        ["currency = 'USD'", 'moneda']] as const) {
        f.native.exec(`UPDATE installment_purchases SET ${change} WHERE id = '${target.id}'`);
        await rejectsWithoutChanges({ commandId: change }, message);
        f.native.exec(`UPDATE installment_purchases SET status = 'active', currency = 'COP' WHERE id = '${target.id}'`);
      }
      // A deleted purchase (its movement removed without allocations) is simply gone.
      await deleteMovement(f, target.transaction.id);
      await rejectsWithoutChanges({ commandId: 'deleted' }, 'no existe');
    } finally { f.native.close(); }
  });
});

describe('idempotency', () => {
  test('a confirmed command writes once; identical replays write nothing; different content is rejected', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f);
      const params = { ...deps(f), cardAccountId: 'card', installmentPurchaseId: id, sourceAccountId: 'bank', paymentAmount: 100000,
        allocatedAmount: 100000, mode: 'unspecified' as const, commandId: 'idem', currentDate: FINANCIAL_TEST_DATE };
      // The same request object runs once, even when submitted twice concurrently.
      const [first, again] = await Promise.all([registerExtraordinaryInstallmentPayment(params), registerExtraordinaryInstallmentPayment(params)]);
      expect(again).toBe(first);
      expect(rows(f, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'creditCardPayment'")).toEqual([{ n: 1 }]);
      const state = await financialState(f);
      f.resetTrace();
      const replay = await registerExtraordinaryInstallmentPayment({ ...params });
      expect(replay).toMatchObject({ status: 'replayed', allocation: { commandId: 'idem', status: 'active' } });
      expect(writesOf(f)).toEqual([]);
      expect(await financialState(f)).toEqual(state);
      for (const changes of [{ paymentAmount: 100001 }, { allocatedAmount: 50000 }, { sourceAccountId: 'target' }]) {
        await expect(registerExtraordinaryInstallmentPayment({ ...params, ...changes })).rejects.toThrow('datos distintos');
      }
      expect(await financialState(f)).toEqual(state);
    } finally { f.native.close(); }
  });

  test('a capped command replays as identical; a reversed one is reported, never reactivated', async () => {
    const f = await fixture();
    try {
      const { id } = await purchase(f, 80000, 2);
      await purchase(f, 200000, 4);
      await pay(f, id, { paymentAmount: 120000, allocatedAmount: 120000 });
      expect(await pay(f, id, { paymentAmount: 120000, allocatedAmount: 120000 })).toMatchObject({ status: 'replayed' });
      await deleteMovement(f, extraordinaryPaymentTransactionId('card', 'cmd-1'));
      const replay = await pay(f, id, { paymentAmount: 120000, allocatedAmount: 120000 });
      expect(replay).toMatchObject({ status: 'replayed', allocation: { status: 'reversed' } });
      expect((replay as { payment?: unknown }).payment).toBeUndefined();
      expect(rows(f, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'creditCardPayment'")).toEqual([{ n: 0 }]);
    } finally { f.native.close(); }
  });
});

describe('scenario J: the original purchase movement under an active allocation', () => {
  async function allocated() {
    const f = await fixture();
    const target = await purchase(f);
    await registered(pay(f, target.id));
    return { f, target, before: await financialState(f) };
  }
  const destructive: [string, (f: Fixture, transactionId: string) => Promise<unknown>][] = [
    ['delete through the use case', (f, id) => deleteMovement(f, id)],
    ['convert to debit', (f, id) => updateTransactionQuickly(deps(f), id, { kind: 'paymentMethod', operationType: 'Débito' })],
    ['one installment (quick action)', (f, id) => updateTransactionQuickly(deps(f), id, { kind: 'installments', installmentCount: 1, interestFreeCount: 0 })],
    ['one installment (form)', (f, id) => editPurchase(f, id, { installmentCountInput: '1' })],
    ['other installment count', (f, id) => editPurchase(f, id, { installmentCountInput: '3' })],
    ['other amount', (f, id) => editPurchase(f, id, { amount: 500000 })],
    ['other card', (f, id) => editPurchase(f, id, { accountId: 'card2' })],
    ['other date', (f, id) => editPurchase(f, id, { transactionDate: '2026-09-11T12:00:00.000Z' })],
    ['debit through the form', (f, id) => editPurchase(f, id, { operationType: 'Débito', accountId: 'bank' })],
  ];
  test.each(destructive)('%s: rejected with an understandable error, nothing changed, no cascade', async (_label, operation) => {
    const { f, target, before } = await allocated();
    try {
      const error = await failure(operation(f, target.transaction.id));
      expect(error).toBeInstanceOf(ActiveInstallmentAllocationError);
      expect(await financialState(f)).toEqual(before);
    } finally { f.native.close(); }
  });

  test('a raw cascade from the original movement is aborted by SQLite; history and allocation survive', async () => {
    const { f, target, before } = await allocated();
    try {
      expect(() => f.native.exec(`DELETE FROM transactions WHERE id = '${target.transaction.id}'`)).toThrow('imputaciones activas');
      expect(() => f.native.exec(`DELETE FROM installment_purchases WHERE id = '${target.id}'`)).toThrow('imputaciones activas');
      expect(await financialState(f)).toEqual(before);
    } finally { f.native.close(); }
  });

  test('a name-only edit is allowed; after reversing the payment the purchase can be deleted and history stays', async () => {
    const { f, target } = await allocated();
    try {
      await editPurchase(f, target.transaction.id, { merchantName: 'Televisor' });
      expect(revisions(f, target.id)).toHaveLength(2);
      await deleteMovement(f, extraordinaryPaymentTransactionId('card', 'cmd-1'));
      await deleteMovement(f, target.transaction.id);
      expect(revisions(f, target.id).map(row => row.source)).toEqual(['original', 'allocation', 'allocationReversal', 'purchaseRemoval']);
      expect(allocations(f).map(row => row.status)).toEqual(['reversed']);
      expect(rows(f, 'PRAGMA foreign_key_check')).toEqual([]);
    } finally { f.native.close(); }
  });

  test('reassigning a pending purchase between cards is rejected while it has an active allocation', async () => {
    const f = await fixture();
    try {
      const pending = await f.save({ accountId: 'bank', operationType: 'Crédito', installmentCountInput: '3', amount: 300000,
        merchantName: 'Compra sin tarjeta', creditCardHint: 'Amex 9999' });
      const purchaseRow = rows(f, 'SELECT id, account_id FROM installment_purchases')[0]!;
      expect(purchaseRow.account_id).toBe('account-credit-card-unclassified');
      f.native.exec(`INSERT INTO transactions (id,account_id,amount,currency,date,description,type,direction,status,target_account_id,payment_method,created_at,updated_at)
        VALUES ('raw-payment','bank',1000,'COP','${NOW}','Pago','creditCardPayment','outflow','posted','account-credit-card-unclassified','debit','${NOW}','${NOW}')`);
      f.native.exec(`INSERT INTO installment_allocations VALUES ('raw','raw-payment','${String(purchaseRow.id)}',100,'unspecified','active','raw','${NOW}',NULL)`);
      f.native.exec(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at)
        VALUES ('amex','Amex','creditCard','active','COP',0,0,'2026-01-01','2026-01-01')`);
      const before = await financialState(f);
      const amex = (await f.accountRepository.getAccounts()).find(account => account.id === 'amex')!;
      await expect(associatePendingTransactionsForCreditCard({ ...deps(f), account: amex })).rejects.toBeInstanceOf(ActiveInstallmentAllocationError);
      expect(await financialState(f)).toEqual(before);
      expect(pending.transaction.accountId).toBe('account-credit-card-unclassified');
    } finally { f.native.close(); }
  });
});

describe('scenario G: atomicity and recovery', () => {
  type Operation = (f: Fixture) => Promise<unknown>;
  async function run(prepare: Operation, operation: Operation, fault?: SQLiteFault) {
    jest.setSystemTime(FINANCIAL_TEST_DATE);
    const f = await fixture();
    try {
      await prepare(f);
      const before = await financialState(f);
      f.resetTrace(); f.injectFault(fault);
      const error = await failure(operation(f));
      const trace = f.trace.map(entry => ({ ...entry }));
      f.injectFault();
      return { before, after: await financialState(f), trace, error };
    } finally { try { f.native.close(); } catch { /* retired */ } }
  }
  const flows: [string, Operation, Operation][] = [
    ['register (with lazy revision 0)', async f => {
      const spy = jest.spyOn(initialRevisionModule, 'recordInitialInstallmentRevision').mockResolvedValue(undefined);
      try { await purchase(f); } finally { spy.mockRestore(); }
    }, f => pay(f, rows(f, 'SELECT id FROM installment_purchases')[0]!.id as string)],
    ['edit an allocated payment', async f => { await pay(f, (await purchase(f)).id); },
      f => editPayment(f, extraordinaryPaymentTransactionId('card', 'cmd-1'), { amount: 90000 })],
    ['delete an allocated payment', async f => { await pay(f, (await purchase(f)).id); },
      f => deleteMovement(f, extraordinaryPaymentTransactionId('card', 'cmd-1'))],
  ];

  test.each(flows)('%s: a failure before or after every write rolls back everything', async (_label, prepare, operation) => {
    const success = await run(prepare, operation);
    expect(success.error).toBeUndefined();
    const writes = success.trace.filter(entry => entry.write !== undefined);
    expect(writes.length).toBeGreaterThan(4);
    for (const entry of writes) {
      for (const phase of ['before', 'after'] as const) {
        const failed = await run(prepare, operation, { phase, write: entry.write });
        expect(failed.error).toBeDefined();
        expect(failed.error).not.toBeInstanceOf(SQLiteCommandFailure);
        expect(failed.trace.filter(value => value.sql.startsWith('BEGIN'))).toHaveLength(1);
        expect(failed.trace.filter(value => value.sql.startsWith('ROLLBACK') && value.outcome === 'ok')).toHaveLength(1);
        expect(failed.trace.some(value => value.sql.startsWith('COMMIT'))).toBe(false);
        requireIntegralRollback(failed.before, failed.after);
      }
    }
  });

  test.each(['before', 'after'] as const)('COMMIT %s: unknown, no retry; reopening finds all or nothing and the command replays safely', async phase => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'smartfin-1a4b-unknown-'));
    const syntheticPath = join(directory, 'synthetic.db');
    try {
      const f = await fixture({ syntheticPath });
      const { id } = await purchase(f);
      f.resetTrace(); f.injectFault({ phase, sql: 'COMMIT' });
      const error = await failure(pay(f, id));
      expect(error).toBeInstanceOf(SQLiteCommandFailure);
      expect((error as SQLiteCommandFailure).result.status).toBe('unknown');
      expect(f.trace.filter(entry => entry.sql.startsWith('BEGIN'))).toHaveLength(1);
      expect(f.trace.filter(entry => entry.sql.startsWith('COMMIT'))).toHaveLength(1);
      expect(f.trace.filter(entry => entry.sql.trim().startsWith('INSERT INTO installment_allocations'))).toHaveLength(1);
      expect(() => f.query('SELECT 1')).toThrow('database is not open');
      const reopened = realSQLite({ syntheticPath, fixedSqlDate: FINANCIAL_TEST_DATE });
      reopened.native.exec('PRAGMA foreign_keys = ON;');
      await applyVersionedMigrations(reopened.database);
      const database = manageSQLiteDatabase(reopened.database);
      const repositories = { accountRepository: createSqliteAccountRepository(database), creditCardRepository: createSqliteCreditCardRepository(database),
        transactionRepository: createSqliteTransactionRepository(database) };
      const payments = rows(reopened, "SELECT id FROM transactions WHERE type = 'creditCardPayment'");
      expect(payments).toHaveLength(phase === 'after' ? 1 : 0);
      expect(allocations(reopened)).toHaveLength(payments.length);
      expect(rows(reopened, 'PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      // A deliberate new attempt of the same command: replayed if it committed, registered once otherwise.
      const again = await registerExtraordinaryInstallmentPayment({ ...repositories, cardAccountId: 'card', installmentPurchaseId: id,
        sourceAccountId: 'bank', paymentAmount: 100000, allocatedAmount: 100000, mode: 'unspecified', commandId: 'cmd-1', currentDate: FINANCIAL_TEST_DATE });
      expect(again.status).toBe(phase === 'after' ? 'replayed' : 'registered');
      expect(rows(reopened, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'creditCardPayment'")).toEqual([{ n: 1 }]);
      expect(allocations(reopened)).toHaveLength(1);
      reopened.native.close();
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('final review: approved decisions', () => {
  const historyWrites = (f: Fixture) => writesOf(f).filter(entry => /installment_allocations|installment_plan_revisions/.test(entry.sql));
  async function allocatedPayment(f: Fixture) {
    f.native.exec(`INSERT INTO categories (id,name,type,macro_category,color) VALUES
      ('cat-label','Etiqueta','expense','other','#000000'), ('cat-other','Otra etiqueta','expense','other','#111111')`);
    const target = await purchase(f);
    return { target, paymentId: (await registered(pay(f, target.id))).payment.id };
  }

  // A. Only descriptive fields (description, merchant, notes, category as a label) keep the allocation.
  const descriptive: [string, Partial<SaveManualTransactionParams>][] = [
    ['merchant / description', { merchantName: 'Abono televisor' }],
    ['notes', { notes: 'Nota distinta' }],
    ['category (label only)', { categoryId: 'cat-label' }],
    ['all descriptive fields together', { merchantName: 'Abono', notes: 'Otra nota', categoryId: 'cat-label' }],
  ];
  test.each(descriptive)('A, descriptive edit (%s): the allocation stays active and history is untouched', async (_label, changes) => {
    const f = await fixture();
    try {
      const { paymentId } = await allocatedPayment(f);
      const history = revisions(f);
      f.resetTrace();
      await editPayment(f, paymentId, changes);
      expect(historyWrites(f)).toEqual([]);
      expect(allocations(f).map(row => row.status)).toEqual(['active']);
      expect(revisions(f)).toEqual(history);
      const payment = await current(f, paymentId);
      expect([payment.amount, payment.accountId, payment.targetAccountId, payment.type]).toEqual([100000, 'bank', 'card', 'creditCardPayment']);
    } finally { f.native.close(); }
  });

  const financial: [string, Partial<SaveManualTransactionParams>][] = [
    ['amount', { amount: 90000 }],
    ['source account', { accountId: 'target' }],
    ['target card', { targetAccountId: 'card2' }],
    ['date', { transactionDate: '2026-10-09T12:00:00.000Z' }],
    ['movement type', { transactionType: 'expense', targetAccountId: undefined }],
    ['mixed: merchant + amount', { merchantName: 'Abono', amount: 90000 }],
    ['mixed: category + date', { categoryId: 'cat-label', transactionDate: '2026-10-09T12:00:00.000Z' }],
    ['mixed: notes + target card', { notes: 'Nota', targetAccountId: 'card2' }],
  ];
  test.each(financial)('A, financial edit (%s): D6 reverses before the edit, in the same transaction', async (_label, changes) => {
    const f = await fixture();
    try {
      const { paymentId } = await allocatedPayment(f);
      f.resetTrace();
      await editPayment(f, paymentId, changes);
      expect(controlOf(f)).toEqual(['BEGIN', 'COMMIT']);
      expect(historyWrites(f).map(entry => entry.sql.trim().split(/\s+/).slice(0, 3).join(' ')))
        .toEqual(['UPDATE installment_allocations SET', 'INSERT INTO installment_plan_revisions']);
      expect(allocations(f).map(row => row.status)).toEqual(['reversed']);
      expect(revisions(f).at(-1)).toMatchObject({ source: 'allocationReversal', verification: 'pendingVerification' });
    } finally { f.native.close(); }
  });

  test('A, category routes outside the form only relabel: no reversal, no financial field changes', async () => {
    const f = await fixture();
    try {
      const { paymentId } = await allocatedPayment(f);
      const before = await current(f, paymentId);
      const money = await f.snapshot();
      const statements = rows(f, 'SELECT * FROM credit_card_statements');
      await f.transactionRepository.updateTransactionCategory(paymentId, 'cat-label');
      await createSqliteCategoryRepository(f.database).deleteCategoryAndReassign('cat-label', 'cat-other');
      const after = await current(f, paymentId);
      expect(after.categoryId).toBe('cat-other');
      expect([after.amount, after.accountId, after.targetAccountId, after.type, after.date])
        .toEqual([before.amount, before.accountId, before.targetAccountId, before.type, before.date]);
      expect(allocations(f).map(row => row.status)).toEqual(['active']);
      // No category changes the treatment of a card payment today: money, dashboard and statements stay equal.
      expect(await f.snapshot()).toEqual(money);
      expect(rows(f, 'SELECT * FROM credit_card_statements')).toEqual(statements);
    } finally { f.native.close(); }
  });

  test('B, the four new reasons are stored with the current contract, read back unchanged and never confirmed', async () => {
    const f = await fixture({ closingDay: 20 });
    try {
      const spy = jest.spyOn(initialRevisionModule, 'recordInitialInstallmentRevision').mockResolvedValue(undefined);
      let lazy: Awaited<ReturnType<typeof purchase>>;
      try { lazy = await purchase(f, 80000, 2); } finally { spy.mockRestore(); }
      await purchase(f, 600000, 6);
      const first = await registered(pay(f, lazy.id, { paymentAmount: 90000, allocatedAmount: 90000 }));
      await confirmStatement(f, lazy.id, 0, 2, '2026-11-20');
      await editPayment(f, first.payment.id, { amount: 80000 });
      const stored = revisions(f, lazy.id);
      expect(stored.map(row => [row.revision_number, row.source, row.verification, row.pending_reasons])).toEqual([
        [0, 'original', 'pendingVerification', 'lazyInitialRevision'],
        [1, 'allocation', 'pendingVerification', 'allocationUnconfirmed,estimatedPrincipalZero'],
        [2, 'statement', 'confirmed', null],
        [3, 'allocationReversal', 'pendingVerification', 'allocationReversed,statementAdjustmentRequired'],
      ]);
      const read = await createSqliteInstallmentHistoryRepository(f.database).getPlanRevisions(lazy.id);
      expect(read.map(revision => revision.pendingReasons.join(','))).toEqual(stored.map(row => row.pending_reasons ?? ''));
      const NEW = ['allocationUnconfirmed', 'estimatedPrincipalZero', 'statementAdjustmentRequired', 'lazyInitialRevision'];
      const carrying = rows(f, 'SELECT * FROM installment_plan_revisions').filter(row => NEW.some(reason => String(row.pending_reasons).includes(reason)));
      expect(new Set(carrying.flatMap(row => String(row.pending_reasons).split(','))).size).toBeGreaterThanOrEqual(4);
      expect(carrying.every(row => row.verification === 'pendingVerification')).toBe(true);
      // Purchase rows and calendars are never changed by these revisions; descriptive edits leave history unchanged.
      const plans = rows(f, 'SELECT * FROM installment_purchases ORDER BY id');
      expect(plans.every(plan => plan.status === 'active' && plan.paid_installments === 0)).toBe(true);
      const history = revisions(f);
      await editPurchase(f, lazy.transaction.id, { installmentCountInput: '2', merchantName: 'Solo nombre' });
      await editPayment(f, first.payment.id, { merchantName: 'Solo descripción' });
      expect(revisions(f)).toEqual(history);
    } finally { f.native.close(); }
  });

  test('C, after a reversal against a later confirmed revision, a new allocation is rejected before any write', async () => {
    const f = await fixture({ closingDay: 20 });
    try {
      const { id } = await purchase(f);
      const first = await registered(pay(f, id));
      await confirmStatement(f, id, 45000000, 5, '2026-11-20');
      const confirmedRow = revisions(f, id)[2];
      await deleteMovement(f, first.payment.id);
      const ordinary = await registerCreditCardPayment({ ...deps(f), accountId: 'card', sourceAccountId: 'bank', amount: 50000, currentDate: LATER });
      const before = await financialState(f);
      for (const attempt of [
        () => pay(f, id, { commandId: 'after-confirmation' }),
        () => allocateCreditCardPaymentToPurchase({ ...deps(f), paymentTransactionId: ordinary.transaction.id, installmentPurchaseId: id,
          allocatedAmount: 50000, mode: 'unspecified', commandId: 'existing-after-confirmation', currentDate: LATER }),
      ]) {
        f.resetTrace();
        expect((await failure(attempt()))?.message).toContain('extracto bancario');
        expect(writesOf(f)).toEqual([]);
      }
      expect(await financialState(f)).toEqual(before);
      expect(revisions(f, id)[2]).toEqual(confirmedRow);
      expect(shape(revisions(f, id)[3]!)).toEqual([3, 'allocationReversal', 'pendingVerification',
        'allocationReversed,statementAdjustmentRequired', 45000000, 5, 9000000, '2026-11-20']);
      expect(allocations(f).map(row => row.status)).toEqual(['reversed']);
    } finally { f.native.close(); }
  });

  test('ineligible purchases (zero or unknown principal) are also rejected before any write', async () => {
    const f = await fixture();
    try {
      const small = await purchase(f, 80000, 2);
      await purchase(f, 200000, 4);
      const inexact = await purchase(f, 1000.005, 3);
      await pay(f, small.id, { paymentAmount: 80000, allocatedAmount: 80000 });
      for (const [purchaseId, message] of [[small.id, 'no tiene capital pendiente'], [inexact.id, 'no se conoce con exactitud']] as const) {
        f.resetTrace();
        expect((await failure(pay(f, purchaseId, { commandId: `reject-${purchaseId}`, paymentAmount: 100, allocatedAmount: 100 }))))
          .toMatchObject({ message: expect.stringContaining(message) });
        expect(writesOf(f)).toEqual([]);
      }
    } finally { f.native.close(); }
  });
});

describe('final review: command_id after edit, deletion and restart', () => {
  test('the command never recreates a deleted payment nor reactivates a reversed allocation; evidence survives the payment', async () => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'smartfin-1a4b-idempotency-'));
    const syntheticPath = join(directory, 'synthetic.db');
    try {
      const f = await fixture({ syntheticPath });
      const { id } = await purchase(f);
      const { id: other } = await purchase(f, 300000, 3);
      const paymentId = extraordinaryPaymentTransactionId('card', 'cmd-1');
      const paymentRows = (db: { query: Fixture['query'] }) => rows(db, "SELECT id, amount FROM transactions WHERE type = 'creditCardPayment'");
      // 1-2. Create, then repeat: replayed, no writes.
      await registered(pay(f, id));
      f.resetTrace();
      expect(await pay(f, id)).toMatchObject({ status: 'replayed', allocation: { status: 'active' } });
      expect(writesOf(f)).toEqual([]);
      // 3-4. Edit (reverses), then repeat: the edited payment is reported as it is now, nothing reactivated.
      await editPayment(f, paymentId, { amount: 90000 });
      f.resetTrace();
      expect(await pay(f, id)).toMatchObject({ status: 'replayed', allocation: { status: 'reversed' }, payment: { amount: 90000 } });
      expect(writesOf(f)).toEqual([]);
      // 5-6. Delete, then repeat: the payment is not recreated; the allocation row keeps the command.
      await deleteMovement(f, paymentId);
      f.resetTrace();
      const afterDeletion = await pay(f, id);
      expect(afterDeletion).toMatchObject({ status: 'replayed', allocation: { status: 'reversed', paymentTransactionId: paymentId } });
      expect((afterDeletion as { payment?: unknown }).payment).toBeUndefined();
      expect(writesOf(f)).toEqual([]);
      expect(paymentRows(f)).toEqual([]);
      const evidence = allocations(f);
      f.native.close();
      // 7. Restart: the same evidence answers the command; still nothing is written.
      const reopened = realSQLite({ syntheticPath, fixedSqlDate: FINANCIAL_TEST_DATE });
      reopened.native.exec('PRAGMA foreign_keys = ON;');
      await applyVersionedMigrations(reopened.database);
      const database = manageSQLiteDatabase(reopened.database);
      const repositories = { accountRepository: createSqliteAccountRepository(database), creditCardRepository: createSqliteCreditCardRepository(database),
        transactionRepository: createSqliteTransactionRepository(database) };
      const request = (changes: Partial<ExtraordinaryInstallmentPaymentParams> = {}) => registerExtraordinaryInstallmentPayment({
        ...repositories, cardAccountId: 'card', installmentPurchaseId: id, sourceAccountId: 'bank', paymentAmount: 100000,
        allocatedAmount: 100000, mode: 'unspecified', commandId: 'cmd-1', currentDate: FINANCIAL_TEST_DATE, ...changes });
      reopened.resetTrace();
      expect(await request()).toMatchObject({ status: 'replayed', allocation: { status: 'reversed' } });
      expect(reopened.trace.filter(entry => entry.write !== undefined)).toEqual([]);
      expect(allocations(reopened)).toEqual(evidence);
      // 8. Same command with other data. Verifiable fields (purchase, card, mode, amount allocated) are rejected; the
      // payment amount and source account cannot be verified once the payment was edited or deleted (no column keeps
      // them): those requests are answered from the evidence and never write.
      reopened.resetTrace();
      for (const changes of [{ installmentPurchaseId: other }, { cardAccountId: 'card2' }, { allocatedAmount: 50000 }])
        expect((await failure(request(changes)))?.message).toMatch(/datos distintos|otra tarjeta/);
      for (const changes of [{ paymentAmount: 120000 }, { sourceAccountId: 'target' }])
        expect(await request(changes)).toMatchObject({ status: 'replayed', allocation: { status: 'reversed' } });
      expect(reopened.trace.filter(entry => entry.write !== undefined)).toEqual([]);
      expect(rows(reopened, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'creditCardPayment'")).toEqual([{ n: 0 }]);
      expect(allocations(reopened)).toEqual(evidence);
      reopened.native.close();
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('existing flows without active allocations', () => {
  test('the same SQL writes and the same state with and without the 1a.4B steps', async () => {
    const run = async (neutralized: boolean) => {
      jest.setSystemTime(FINANCIAL_TEST_DATE);
      const spies = neutralized ? [
        jest.spyOn(reversalModule, 'reverseActivePaymentAllocations').mockResolvedValue([]),
        jest.spyOn(reversalModule, 'requireNoActiveInstallmentAllocations').mockResolvedValue(undefined),
      ] : [];
      const f = await fixture();
      try {
        f.resetTrace();
        const created = await purchase(f, 300000, 3);
        await editPurchase(f, created.transaction.id, { installmentCountInput: '6' });
        const payment = await registerCreditCardPayment({ ...deps(f), accountId: 'card', sourceAccountId: 'bank', amount: 100000, currentDate: FINANCIAL_TEST_DATE });
        await editPayment(f, payment.transaction.id, { amount: 90000 });
        await updateTransactionQuickly(deps(f), created.transaction.id, { kind: 'installments', installmentCount: 1, interestFreeCount: 0 });
        await deleteMovement(f, payment.transaction.id);
        await deleteMovement(f, created.transaction.id);
        // The neutralized run really bypassed both steps (payment edit/delete and purchase changes).
        for (const spy of spies) expect(spy).toHaveBeenCalled();
        const writes = writesOf(f).map(entry => [entry.sql, entry.values]);
        const state = JSON.parse(JSON.stringify(await financialState(f)).replace(/tx_manual_\d+_\d+/g, 'manual')
          .replace(/tx-credit-card-payment-card-[^"]+/g, 'payment')) as FinancialState;
        return { writes: JSON.parse(JSON.stringify(writes).replace(/tx_manual_\d+_\d+/g, 'manual')
          .replace(/tx-credit-card-payment-card-[^"]+/g, 'payment')) as unknown, state };
      } finally { spies.forEach(spy => spy.mockRestore()); f.native.close(); }
    };
    const withSteps = await run(false);
    const previous = await run(true);
    expect(withSteps.writes).toEqual(previous.writes);
    expect(withSteps.state).toEqual(previous.state);
  });
});

describe('exposure', () => {
  test('the use case is internal: not exported by the module index nor imported by screens, hooks or AI commands', () => {
    const root = join((require('node:process') as { cwd: () => string }).cwd(), 'src');
    for (const index of ['modules/creditCards/index.ts', 'modules/creditCards/useCases/index.ts'])
      expect(fs.readFileSync(join(root, index), 'utf8')).not.toMatch(/extraordinaryInstallmentPayment|registerExtraordinaryInstallmentPayment/);
    const own = 'modules/creditCards/useCases/extraordinaryInstallmentPayment.ts';
    const sources = fs.readdirSync(root, { recursive: true }).map(path => path.replace(/\\/g, '/')).filter(path => /\.(ts|tsx)$/.test(path));
    expect(sources).toContain(own);
    const importers = sources.filter(path => path !== own &&
      /extraordinaryInstallmentPayment|ExtraordinaryInstallmentPayment|allocateCreditCardPaymentToPurchase/.test(fs.readFileSync(join(root, path), 'utf8')));
    expect(importers).toEqual([]);
  });
});
