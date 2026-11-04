// Phase 1a.4B probes: extraordinary «No sé» payments, allocations, lazy revision 0, D6 reversals and the protection of
// purchases with active allocations, on the real SQLite driver. The same synthetic scenarios run in Node (node:sqlite,
// __tests__/phase1a4bAndroidEquivalence.test.ts) and in the isolated Android APK (com.smartfin.snapshot5b2.tests),
// through the REAL production use cases (nothing neutralized). The JS clock is pinned for every use case. The use case
// is internal: these probes import it by path, exactly as the Node tests do. Only synthetic data.
import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import { runSharedSQLiteTransaction, SQLiteCommandFailure } from '../../src/database/atomicSQLite';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteInstallmentHistoryRepository } from '../../src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository';
import { createSqliteCategoryRepository } from '../../src/modules/categories/repositories/sqliteCategoryRepository';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import {
  deleteManualTransactionSafely,
  saveManualTransaction,
  type SaveManualTransactionParams,
} from '../../src/modules/transactions/useCases/saveManualTransaction';
import { updateTransactionQuickly } from '../../src/modules/transactions/useCases/updateTransactionQuickly';
import {
  associatePendingTransactionsForCreditCard,
  registerCreditCardPayment,
} from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import {
  allocateCreditCardPaymentToPurchase,
  extraordinaryPaymentTransactionId,
  registerExtraordinaryInstallmentPayment,
  type ExtraordinaryInstallmentPaymentParams,
} from '../../src/modules/creditCards/useCases/extraordinaryInstallmentPayment';
import { ActiveInstallmentAllocationError } from '../../src/modules/creditCards/useCases/installmentAllocationReversal';
import { serializeCreditCardVisualMetadata } from '../../src/modules/creditCards/useCases/manageCreditCards';
import type { Transaction } from '../../src/modules/transactions/types/Transaction';
import { resetSyntheticData, textCents } from '../phase6b/probes';
import { bogotaNoon, withPhase1A2Clock } from '../phase1a2/probes';

export const PHASE1A4B_REGISTER_CASES = ['simple', 'twoPayments', 'surplusAndZero', 'cents', 'lazy', 'rejections'] as const;
export const PHASE1A4B_REVERSAL_CASES = [
  'editAmount', 'editSource', 'editCard', 'editDate', 'editType', 'editMixed', 'descriptiveEdits', 'deletePayment',
  'laterPending', 'laterConfirmed',
] as const;
export const PHASE1A4B_GUARD_CASES = [
  'deletePurchase', 'toDebitQuick', 'toSingleQuick', 'toSingleForm', 'otherCount', 'otherAmount', 'otherCard', 'otherDate',
  'debitForm', 'rawCascade', 'reassignment', 'afterReversal',
] as const;
/** Operations whose writes are failed one by one. */
export const PHASE1A4B_MATRICES = ['register', 'registerLazy', 'editReversal', 'deleteReversal'] as const;
export type Phase1A4BRegisterCase = (typeof PHASE1A4B_REGISTER_CASES)[number];
export type Phase1A4BReversalCase = (typeof PHASE1A4B_REVERSAL_CASES)[number];
export type Phase1A4BGuardCase = (typeof PHASE1A4B_GUARD_CASES)[number];
export type Phase1A4BMatrix = (typeof PHASE1A4B_MATRICES)[number];

type Row = Record<string, unknown>;
type Database = SmartFinSQLiteDatabase;
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
const rowsOf = (result: { rows: { length: number; item: (index: number) => unknown } }) =>
  Array.from({ length: result.rows.length }, (_, index) => result.rows.item(index) as Row);
const json = (value: unknown) => JSON.stringify(value);
const errorText = (error: unknown) => error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
  ? String((error as { message: string }).message) : json(error);
const query = async (database: Database, sql: string, values: (string | number | null)[] = []) =>
  rowsOf((await database.executeSql(sql, values))[0]);
const at = (date: string) => bogotaNoon(date).toISOString();
const MARKER = 'synthetic_phase1a4b_marker';
const UNCLASSIFIED = 'account-credit-card-unclassified';
/** Fragments of the SQLite RAISE messages (identical on every driver) and the use case guard. */
const RAISES = ['imputaciones activas', 'historial de cuotas'];
function outcomeOf(error: unknown): string {
  if (error === undefined) return 'accepted';
  if (error instanceof ActiveInstallmentAllocationError) return 'rejected:activeAllocation';
  const text = errorText(error);
  const raise = RAISES.find(fragment => text.includes(fragment));
  return raise ? 'raise:' + raise : 'rejected: ' + text;
}
async function attempt(operation: () => Promise<unknown>): Promise<string> {
  try { await operation(); return 'accepted'; } catch (error) { return outcomeOf(error); }
}

const dependencies = (database: Database) => ({
  accountRepository: createSqliteAccountRepository(database),
  transactionRepository: createSqliteTransactionRepository(database),
  creditCardRepository: createSqliteCreditCardRepository(database),
});

/** Bank 1.000.000, an empty target account, Visa (closing day 20, limit 2.000.000), Master and two label categories. */
async function seed(database: Database) {
  await database.executeSql(`DROP TABLE IF EXISTS ${MARKER}`);
  await resetSyntheticData(database);
  await database.executeSql("INSERT INTO financial_data_revision (id, revision, updated_at) VALUES (1, 0, '2026-01-01')");
  const metadata = serializeCreditCardVisualMetadata({ closingDay: 20, paymentDay: 5 });
  await database.executeSql(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,credit_limit_amount,
    description,created_at,updated_at) VALUES
    ('bank','Banco','bankAccount','active','COP',1000000,NULL,NULL,NULL,'2026-01-01','2026-01-01'),
    ('target','Destino','bankAccount','active','COP',0,NULL,NULL,NULL,'2026-01-01','2026-01-01'),
    ('card','Visa','creditCard','active','COP',0,0,2000000,?,'2026-01-01','2026-01-01'),
    ('card2','Master','creditCard','active','COP',0,0,2000000,?,'2026-01-01','2026-01-01')`, [metadata, metadata]);
  await database.executeSql(`INSERT OR IGNORE INTO categories (id,name,type,macro_category,color) VALUES
    ('cat-label','Etiqueta sintetica','expense','other','#000000'), ('cat-other','Otra etiqueta','expense','other','#111111')`);
}

const accountsAt = (database: Database, date: string) =>
  withPhase1A2Clock(bogotaNoon(date), () => dependencies(database).accountRepository.getAccounts());
async function purchase(database: Database, date: string, amount: number, installments: number,
  extra: Partial<SaveManualTransactionParams> = {}) {
  const params: SaveManualTransactionParams = {
    ...dependencies(database), accounts: await accountsAt(database, date), accountId: 'card', amount, merchantName: `Compra ${amount}`,
    operationType: 'Crédito', transactionType: 'expense', hasInterestFreeInstallments: false,
    installmentCountInput: String(installments), interestFreeInstallmentCountInput: '', occurrence: { kind: 'date', date },
    currentDate: bogotaNoon(date), now: bogotaNoon(date), ...extra,
  };
  const transaction = await withPhase1A2Clock(bogotaNoon(date), async () => (await saveManualTransaction(params)).transaction);
  return { transaction, id: `installment-${transaction.id}` };
}
async function currentTransaction(database: Database, id: string): Promise<Transaction> {
  const transaction = (await dependencies(database).transactionRepository.getTransactions()).find(row => row.id === id);
  check(transaction, 'Movement missing: ' + id);
  return transaction;
}

function extraordinaryParams(database: Database, purchaseId: string, date: string,
  changes: Partial<ExtraordinaryInstallmentPaymentParams> = {}): ExtraordinaryInstallmentPaymentParams {
  return { ...dependencies(database), cardAccountId: 'card', installmentPurchaseId: purchaseId, sourceAccountId: 'bank',
    paymentAmount: 100000, allocatedAmount: 100000, mode: 'unspecified', commandId: 'cmd-1', currentDate: bogotaNoon(date), ...changes };
}
const extraordinary = (database: Database, purchaseId: string, date: string, changes: Partial<ExtraordinaryInstallmentPaymentParams> = {}) => {
  const params = extraordinaryParams(database, purchaseId, date, changes);
  return withPhase1A2Clock(bogotaNoon(date), () => registerExtraordinaryInstallmentPayment(params));
};
const ordinaryPayment = (database: Database, date: string, amount: number) => withPhase1A2Clock(bogotaNoon(date), async () =>
  (await registerCreditCardPayment({ ...dependencies(database), accountId: 'card', sourceAccountId: 'bank', amount,
    currentDate: bogotaNoon(date), settlement: 'partial' })).transaction);

async function editPaymentParams(database: Database, id: string, when: string, changes: Partial<SaveManualTransactionParams>) {
  const payment = await currentTransaction(database, id);
  return {
    ...dependencies(database), accounts: await accountsAt(database, when), accountId: payment.accountId, amount: payment.amount,
    merchantName: payment.merchantName ?? payment.description, notes: 'Pago de tarjeta', operationType: 'Débito' as const,
    transactionType: 'creditCardPayment' as const, targetAccountId: payment.targetAccountId, editingTransaction: payment,
    hasInterestFreeInstallments: false, installmentCountInput: '1', interestFreeInstallmentCountInput: '',
    currentDate: bogotaNoon(when), now: bogotaNoon(when), ...changes,
  } satisfies SaveManualTransactionParams;
}
async function editPayment(database: Database, id: string, when: string, changes: Partial<SaveManualTransactionParams>) {
  const params = await editPaymentParams(database, id, when, changes);
  return withPhase1A2Clock(bogotaNoon(when), () => saveManualTransaction(params));
}
async function editPurchase(database: Database, id: string, when: string, changes: Partial<SaveManualTransactionParams>) {
  const original = await currentTransaction(database, id);
  const params: SaveManualTransactionParams = {
    ...dependencies(database), accounts: await accountsAt(database, when), accountId: original.accountId, amount: original.amount,
    merchantName: original.merchantName ?? original.description, operationType: 'Crédito', transactionType: 'expense',
    editingTransaction: original, hasInterestFreeInstallments: false, installmentCountInput: '6', interestFreeInstallmentCountInput: '',
    currentDate: bogotaNoon(when), now: bogotaNoon(when), ...changes,
  };
  return withPhase1A2Clock(bogotaNoon(when), () => saveManualTransaction(params));
}
async function deleteMovementParams(database: Database, id: string, when: string) {
  return { ...dependencies(database), accounts: await accountsAt(database, when), transaction: await currentTransaction(database, id) };
}
async function deleteMovement(database: Database, id: string, when: string) {
  const params = await deleteMovementParams(database, id, when);
  await withPhase1A2Clock(bogotaNoon(when), () => deleteManualTransactionSafely(params));
}
/** Synthetic confirmed statement revision (probe helper only: no production route confirms statements yet). */
const confirmStatement = (database: Database, purchaseId: string, principalCents: number, installments: number, cycleEnd: string) =>
  createSqliteInstallmentHistoryRepository(database).appendPlanRevision({
    installmentPurchaseId: purchaseId, source: 'statement', remainingPrincipalCents: principalCents, remainingInstallments: installments,
    installmentAmountCents: Math.floor(principalCents / installments), effectiveCycleEnd: cycleEnd, verification: 'confirmed',
    pendingReasons: [], createdAt: at('2026-10-20'),
  });
/** A plan without history, as left by the intermediate 1a.3B code: the movement and its plan row, no revision 0. */
async function intermediatePlan(database: Database, date: string, amount: number, installments: number) {
  const { transaction } = await purchase(database, date, amount, 1, { merchantName: 'Intermedia' });
  const id = `installment-${transaction.id}`;
  await database.executeSql(`INSERT INTO installment_purchases (id, transaction_id, account_id, merchant_name, total_amount, currency,
    installment_count, paid_installments, monthly_amount, first_due_date, status, created_at, updated_at)
    VALUES (?, ?, 'card', 'Intermedia', ?, 'COP', ?, 0, ?, '2026-11-11', 'active', ?, ?)`,
  [id, transaction.id, amount, installments, Math.round(amount / installments), at(date), at(date)]);
  return { transaction, id };
}

// ---------------------------------------------------------------------------------------------------------------
// Observation

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Trigger revisions carry SQLite's own clock (host time): checked, then never compared. Use case rows use the JS clock. */
function sqlClock(row: Row): Row {
  if (row.source !== 'purchaseEdit' && row.source !== 'purchaseRemoval') return row;
  check(typeof row.created_at === 'string' && ISO_INSTANT.test(row.created_at), 'SQLite clock format');
  return { ...row, created_at: '<sqlite-clock>' };
}
const revisionCounter = async (database: Database) =>
  Number((await query(database, 'SELECT revision FROM financial_data_revision WHERE id = 1'))[0]?.revision);

/** Full rows of every financial table touched by 1a.4B, the dashboard, integrity and the backup counter. */
async function observe(database: Database, date: string) {
  const accounts = await query(database, `SELECT rowid AS row_id, id, balance_amount, debt_balance_amount, credit_limit_amount,
    created_at, updated_at FROM accounts ORDER BY id`);
  const summary = await getDashboardSummaryFromDb(database, bogotaNoon(date));
  const integrityRows = await query(database, 'PRAGMA integrity_check');
  const foreignKeys = await query(database, 'PRAGMA foreign_key_check');
  check(integrityRows[0]?.integrity_check === 'ok' && foreignKeys.length === 0, 'SQLite integrity / foreign keys');
  return {
    accounts,
    summary: { availableBalance: summary.availableBalance, totalDebt: summary.totalDebt, netWorth: summary.netWorth,
      monthlyIncome: summary.monthlyIncome, monthlyExpenses: summary.monthlyExpenses, monthlySavings: summary.monthlySavings },
    transactions: await query(database, 'SELECT rowid AS row_id, * FROM transactions ORDER BY created_at, rowid'),
    installmentPurchases: await query(database, 'SELECT rowid AS row_id, * FROM installment_purchases ORDER BY rowid'),
    statements: await query(database, 'SELECT rowid AS row_id, * FROM credit_card_statements ORDER BY account_id, statement_start_date, rowid'),
    allocations: await query(database, 'SELECT rowid AS row_id, * FROM installment_allocations ORDER BY rowid'),
    revisions: (await query(database, `SELECT r.* FROM installment_plan_revisions r
      LEFT JOIN installment_purchases p ON p.id = r.installment_purchase_id
      ORDER BY p.rowid IS NULL, p.rowid, r.installment_purchase_id, r.revision_number`)).map(sqlClock),
    backupRevision: await revisionCounter(database),
    integrity: { integrityCheck: 'ok', foreignKeyViolations: 0 },
  };
}
type Observation = Awaited<ReturnType<typeof observe>>;

/** Every table with rowids and the full schema: the exact rollback oracle. */
async function fullState(database: Database, date: string) {
  const tables: Record<string, Row[]> = {};
  for (const { name } of await query(database, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE 'synthetic_%' AND name <> 'android_metadata' ORDER BY name`)) {
    check(typeof name === 'string' && /^[a-z0-9_]+$/.test(name), 'Unexpected table name');
    tables[name] = await query(database, `SELECT rowid AS row_id, * FROM ${name} ORDER BY rowid`);
  }
  const summary = await getDashboardSummaryFromDb(database, bogotaNoon(date));
  const schema = await query(database, `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'synthetic_%'
    AND name <> 'android_metadata' ORDER BY type, name`);
  return { tables, schema, summary, integrity: await query(database, 'PRAGMA integrity_check'),
    foreignKeys: await query(database, 'PRAGMA foreign_key_check') };
}

/**
 * Movement ids embed the pinned clock and a per-process sequence: renamed M1.. (manual) / P1.. (ordinary payments) in
 * order of first appearance. Extraordinary payment ids derive from the command and are kept verbatim.
 */
function canonical<T>(value: T): T {
  const text = json(value);
  const ids = [...new Set(text.match(/tx_manual_\d+(?:_\d+)?|tx-credit-card-payment-card-\d+-\d+/g) ?? [])];
  let manual = 0;
  let payment = 0;
  const labels = new Map(ids.map(id => [id, id.startsWith('tx_manual_') ? `M${++manual}` : `P${++payment}`] as const));
  const ordered = [...labels.entries()].sort((a, b) => b[0].length - a[0].length);
  return JSON.parse(ordered.reduce((current, [id, label]) => current.split(id).join(label), text)) as T;
}
const shape = (row: Row) => [row.revision_number, row.source, row.verification, row.pending_reasons, row.remaining_principal_cents,
  row.remaining_installments, row.installment_amount_cents, row.effective_cycle_end];
const historyOf = (observation: Observation, purchaseId: string) =>
  observation.revisions.filter(row => row.installment_purchase_id === purchaseId).map(shape);
const statuses = (observation: Observation) => observation.allocations.map(row => row.status);
function money(observation: Observation, id: string, column: 'balance_amount' | 'debt_balance_amount') {
  return textCents(String(observation.accounts.find(row => row.id === id)?.[column]));
}
function expectMoney(observation: Observation, bank: string, debt: string) {
  check(money(observation, 'bank', 'balance_amount') === textCents(bank), `Bank ${bank}`);
  check(money(observation, 'card', 'debt_balance_amount') === textCents(debt), `Debt ${debt}`);
  check(textCents(String(observation.summary.monthlyIncome)) === 0n, 'Income');
}
/** The new revision reasons are never confirmations and purchase rows never change status or paid installments. */
function expectNoInventedFacts(observation: Observation, paidOnPurpose: readonly unknown[] = []) {
  const NEW = ['allocationUnconfirmed', 'estimatedPrincipalZero', 'statementAdjustmentRequired', 'lazyInitialRevision'];
  for (const row of observation.revisions)
    if (NEW.some(reason => String(row.pending_reasons ?? '').split(',').includes(reason)))
      check(row.verification === 'pendingVerification', 'A 1a.4B reason on a non-pending revision');
  for (const plan of observation.installmentPurchases)
    check((plan.status === 'active' || paidOnPurpose.includes(plan.id)) && plan.paid_installments === 0,
      'Purchase status or paid installments changed');
}
const outcomeSummary = (result: unknown) => {
  const value = result as Row;
  return Object.fromEntries(['status', 'paymentCents', 'requestedCents', 'allocatedCents', 'unallocatedPaymentCents',
    'estimatedPrincipalBeforeCents', 'estimatedPrincipalAfterCents'].map(key => [key, value[key] ?? null]));
};

export type Phase1A4BWriteCounter = (run: () => Promise<unknown>) => Promise<number>;

// ---------------------------------------------------------------------------------------------------------------
// A. Registration

export async function runPhase1A4BRegister(database: Database, name: Phase1A4BRegisterCase, countWrites: Phase1A4BWriteCounter) {
  await seed(database);
  const result: Row = {};
  if (name === 'simple') {
    const { id } = await purchase(database, '2026-10-11', 600000, 6);
    result.outcome = outcomeSummary(await extraordinary(database, id, '2026-10-12'));
    const observation = await observe(database, '2026-10-12');
    expectMoney(observation, '900000', '500000');
    check(json(historyOf(observation, id)) === json([
      [0, 'original', 'projected', null, 60000000, 6, 10000000, '2026-10-20'],
      [1, 'allocation', 'pendingVerification', 'allocationUnconfirmed', 50000000, 6, null, null]]), 'Simple history');
    result.observation = observation;
  } else if (name === 'twoPayments') {
    const { id } = await purchase(database, '2026-10-11', 600000, 6);
    result.first = outcomeSummary(await extraordinary(database, id, '2026-10-12'));
    result.second = outcomeSummary(await extraordinary(database, id, '2026-10-13', { commandId: 'cmd-2', paymentAmount: 150000, allocatedAmount: 150000 }));
    const observation = await observe(database, '2026-10-13');
    expectMoney(observation, '750000', '350000');
    check(json(statuses(observation)) === json(['active', 'active']), 'Two active allocations');
    result.observation = observation;
  } else if (name === 'surplusAndZero') {
    const small = await purchase(database, '2026-10-11', 80000, 2);
    await purchase(database, '2026-10-11', 200000, 4);
    result.outcome = outcomeSummary(await extraordinary(database, small.id, '2026-10-12', { paymentAmount: 120000, allocatedAmount: 120000 }));
    const before = json(await fullState(database, '2026-10-12'));
    let zero = '';
    result.zeroWrites = await countWrites(async () => {
      zero = await attempt(() => extraordinary(database, small.id, '2026-10-13', { commandId: 'cmd-2', paymentAmount: 10000, allocatedAmount: 10000 }));
    });
    check(zero.includes('no tiene capital pendiente') && result.zeroWrites === 0, 'Zero principal rejected before writes');
    check(json(await fullState(database, '2026-10-12')) === before, 'Zero principal rejection changed state');
    result.zero = zero;
    const observation = await observe(database, '2026-10-13');
    expectMoney(observation, '880000', '160000');
    result.observation = observation;
  } else if (name === 'cents') {
    const { id } = await purchase(database, '2026-10-11', 1234.56, 6);
    result.first = outcomeSummary(await extraordinary(database, id, '2026-10-12', { paymentAmount: 1000, allocatedAmount: 1000 }));
    result.second = outcomeSummary(await extraordinary(database, id, '2026-10-13', { commandId: 'cmd-2', paymentAmount: 234, allocatedAmount: 233.5 }));
    result.observation = await observe(database, '2026-10-13');
  } else if (name === 'lazy') {
    const { id } = await intermediatePlan(database, '2026-10-11', 600000, 6);
    check((await query(database, 'SELECT COUNT(*) AS n FROM installment_plan_revisions')).at(0)?.n === 0, 'No history before');
    result.outcome = outcomeSummary(await extraordinary(database, id, '2026-10-12'));
    result.again = outcomeSummary(await extraordinary(database, id, '2026-10-13', { commandId: 'cmd-2', paymentAmount: 50000, allocatedAmount: 50000 }));
    const observation = await observe(database, '2026-10-13');
    const history = historyOf(observation, id);
    check(json(history[0]) === json([0, 'original', 'pendingVerification', 'lazyInitialRevision', 60000000, 6, 10000000, '2026-10-20']) &&
      history.filter(row => row[1] === 'original').length === 1, 'Lazy revision 0 written once');
    result.observation = observation;
  } else {
    const { id } = await purchase(database, '2026-10-11', 80000, 2);
    const other = await purchase(database, '2026-10-11', 300000, 3, { accountId: 'card2' });
    const inexact = await purchase(database, '2026-10-11', 1000.005, 3);
    const paid = await purchase(database, '2026-10-11', 90000, 3);
    await database.executeSql("UPDATE installment_purchases SET status = 'paid' WHERE id = ?", [paid.id]);
    const cases: [string, string, Partial<ExtraordinaryInstallmentPaymentParams>][] = [
      ['payment040', id, { paymentAmount: 0.4, allocatedAmount: 0.4 }],
      ['payment160', id, { paymentAmount: 1.6, allocatedAmount: 1 }],
      ['allocatedSubCent', id, { allocatedAmount: 0.004 }],
      ['allocatedAbovePayment', id, { paymentAmount: 1000, allocatedAmount: 1000.01 }],
      ['otherCard', other.id, {}],
      ['missing', 'installment-missing', {}],
      ['paid', paid.id, {}],
      ['inexactPrincipal', inexact.id, { paymentAmount: 100, allocatedAmount: 10 }],
      ['paymentAboveDebt', id, { paymentAmount: 2000000, allocatedAmount: 80000 }],
    ];
    const rejections: Row = {};
    for (const [label, purchaseId, changes] of cases) {
      const before = json(await fullState(database, '2026-10-12'));
      let outcome = '';
      const writes = await countWrites(async () => {
        outcome = await attempt(() => extraordinary(database, purchaseId, '2026-10-12', { commandId: `reject-${label}`, ...changes }));
      });
      check(outcome.startsWith('rejected: '), `${label} must be rejected: ${outcome}`);
      check(json(await fullState(database, '2026-10-12')) === before, `${label} left changes`);
      // Only the debt check needs the ordinary payment flow; it is rolled back.
      check(label === 'paymentAboveDebt' ? writes > 0 : writes === 0, `${label}: ${writes} writes before the rejection`);
      rejections[label] = { outcome, writes };
    }
    // The ordinary partial payment keeps its own contract (rounded to whole pesos, capped at the debt): unchanged.
    rejections.ordinaryPayment160 = { paid: (await ordinaryPayment(database, '2026-10-12', 1.6)).amount };
    result.rejections = rejections;
    result.observation = await observe(database, '2026-10-12');
    result.paidOnPurpose = paid.id;
  }
  expectNoInventedFacts(result.observation as Observation, [result.paidOnPurpose]);
  return canonical(result);
}

// ---------------------------------------------------------------------------------------------------------------
// B. D6 reversals and descriptive edits

export async function runPhase1A4BReversal(database: Database, name: Phase1A4BReversalCase, countWrites: Phase1A4BWriteCounter) {
  await seed(database);
  const { id } = await purchase(database, '2026-10-11', 600000, 6);
  await extraordinary(database, id, '2026-10-12');
  const paymentId = extraordinaryPaymentTransactionId('card', 'cmd-1');
  const result: Row = {};
  const edits: Partial<Record<Phase1A4BReversalCase, Partial<SaveManualTransactionParams>>> = {
    editAmount: { amount: 90000 }, editSource: { accountId: 'target' }, editCard: { targetAccountId: 'card2' },
    editDate: { occurrence: { kind: 'date', date: '2026-10-09' } }, editType: { transactionType: 'expense', targetAccountId: undefined },
    editMixed: { merchantName: 'Abono', notes: 'Otra nota', categoryId: 'cat-label', amount: 90000 },
  };
  const restored = [2, 'allocationReversal', 'pendingVerification', 'allocationReversed', 60000000, 6, 10000000, '2026-10-20'];
  if (edits[name]) {
    result.writes = await countWrites(() => editPayment(database, paymentId, '2026-10-13', edits[name]!));
    const observation = await observe(database, '2026-10-13');
    check(json(statuses(observation)) === json(['reversed']), 'Reversed');
    check(json(historyOf(observation, id)[2]) === json(restored), 'Plan restored by the corrective revision');
    result.observation = observation;
  } else if (name === 'descriptiveEdits') {
    const history = json((await observe(database, '2026-10-12')).revisions);
    const steps: Row = {};
    for (const [label, changes] of [['merchant', { merchantName: 'Abono televisor' }], ['notes', { notes: 'Nota distinta' }],
      ['category', { categoryId: 'cat-label' }], ['all', { merchantName: 'Abono', notes: 'Otra', categoryId: 'cat-other' }]] as const) {
      steps[label] = await countWrites(() => editPayment(database, paymentId, '2026-10-13', changes));
      const observation = await observe(database, '2026-10-13');
      check(json(statuses(observation)) === json(['active']) && json(observation.revisions) === history, `${label} kept the allocation`);
    }
    // Both routes stamp updated_at with Date(): the clock is pinned like every use case.
    await withPhase1A2Clock(bogotaNoon('2026-10-13'), async () => {
      await dependencies(database).transactionRepository.updateTransactionCategory(paymentId, 'cat-label');
      await createSqliteCategoryRepository(database).deleteCategoryAndReassign('cat-label', 'cat-other');
    });
    const observation = await observe(database, '2026-10-13');
    check(json(statuses(observation)) === json(['active']) && json(observation.revisions) === history, 'Category routes kept the allocation');
    result.writes = steps;
    result.observation = observation;
  } else if (name === 'deletePayment') {
    result.writes = await countWrites(() => deleteMovement(database, paymentId, '2026-10-13'));
    const observation = await observe(database, '2026-10-13');
    expectMoney(observation, '1000000', '600000');
    check(json(statuses(observation)) === json(['reversed']) && !observation.transactions.some(row => row.id === paymentId), 'Deleted after reversal');
    check(json(historyOf(observation, id)[2]) === json(restored), 'Plan restored');
    result.observation = observation;
  } else if (name === 'laterPending') {
    await extraordinary(database, id, '2026-10-13', { commandId: 'cmd-2', paymentAmount: 150000, allocatedAmount: 150000 });
    result.writes = await countWrites(() => deleteMovement(database, paymentId, '2026-10-14'));
    const observation = await observe(database, '2026-10-14');
    check(json(historyOf(observation, id)[3]) === json([3, 'allocationReversal', 'pendingVerification',
      'allocationReversed,allocationUnconfirmed', 45000000, 6, null, null]), 'E1 corrective revision');
    check(json(statuses(observation)) === json(['reversed', 'active']), 'E1 statuses');
    result.observation = observation;
  } else {
    await confirmStatement(database, id, 45000000, 5, '2026-11-20');
    const confirmed = json((await observe(database, '2026-10-20')).revisions.find(row => row.revision_number === 2));
    result.writes = await countWrites(() => editPayment(database, paymentId, '2026-10-21', { amount: 80000 }));
    let after = await observe(database, '2026-10-21');
    check(json(after.revisions.find(row => row.revision_number === 2)) === confirmed, 'Confirmed revision untouched');
    check(json(historyOf(after, id)[3]) === json([3, 'allocationReversal', 'pendingVerification',
      'allocationReversed,statementAdjustmentRequired', 45000000, 5, 9000000, '2026-11-20']), 'E2 corrective revision');
    // Decision C: a new allocation is rejected before any write, by both entry points.
    const ordinary = await ordinaryPayment(database, '2026-10-21', 50000);
    const before = json(await fullState(database, '2026-10-21'));
    const rejections: Row = {};
    for (const [label, run] of [
      ['newExtraordinary', () => extraordinary(database, id, '2026-10-22', { commandId: 'after-confirmation' })],
      ['existingPayment', () => withPhase1A2Clock(bogotaNoon('2026-10-22'), () => allocateCreditCardPaymentToPurchase({
        ...dependencies(database), paymentTransactionId: ordinary.id, installmentPurchaseId: id, allocatedAmount: 50000,
        mode: 'unspecified', commandId: 'existing-after-confirmation', currentDate: bogotaNoon('2026-10-22') }))],
    ] as const) {
      let outcome = '';
      const writes = await countWrites(async () => { outcome = await attempt(run); });
      check(outcome.includes('extracto bancario') && writes === 0, `${label}: ${outcome}, ${writes} writes`);
      rejections[label] = { outcome, writes };
    }
    check(json(await fullState(database, '2026-10-21')) === before, 'Decision C rejection changed state');
    after = await observe(database, '2026-10-22');
    result.rejections = rejections;
    result.observation = after;
  }
  expectNoInventedFacts(result.observation as Observation);
  return canonical(result);
}

// ---------------------------------------------------------------------------------------------------------------
// C. Purchases with an active allocation

export async function runPhase1A4BGuard(database: Database, name: Phase1A4BGuardCase) {
  await seed(database);
  if (name === 'reassignment') {
    const pending = await purchase(database, '2026-10-11', 300000, 3, { accountId: 'bank', creditCardHint: 'Amex 9999', merchantName: 'Sin tarjeta' });
    const plan = (await query(database, 'SELECT id, account_id FROM installment_purchases'))[0]!;
    check(plan.account_id === UNCLASSIFIED, 'Pending purchase on the unclassified card');
    await database.executeSql(`INSERT INTO transactions (id,account_id,amount,currency,date,description,type,direction,status,
      target_account_id,payment_method,created_at,updated_at) VALUES ('raw-payment','bank',1000,'COP',?,'Pago','creditCardPayment',
      'outflow','posted',?,'debit',?,?)`, [at('2026-10-12'), UNCLASSIFIED, at('2026-10-12'), at('2026-10-12')]);
    await database.executeSql(`INSERT INTO installment_allocations VALUES ('raw','raw-payment',?,100,'unspecified','active','raw',?,NULL)`,
      [String(plan.id), at('2026-10-12')]);
    await database.executeSql(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at)
      VALUES ('amex','Amex','creditCard','active','COP',0,0,'2026-01-01','2026-01-01')`);
    const before = json(await fullState(database, '2026-10-12'));
    const amex = (await dependencies(database).accountRepository.getAccounts()).find(account => account.id === 'amex')!;
    const outcome = await attempt(() => withPhase1A2Clock(bogotaNoon('2026-10-13'), () =>
      associatePendingTransactionsForCreditCard({ ...dependencies(database), account: amex })));
    check(outcome === 'rejected:activeAllocation' && json(await fullState(database, '2026-10-12')) === before, 'Reassignment rejected');
    return canonical({ outcome, pendingAccount: pending.transaction.accountId, observation: await observe(database, '2026-10-12') });
  }
  const target = await purchase(database, '2026-10-11', 600000, 6);
  await extraordinary(database, target.id, '2026-10-12');
  const paymentId = extraordinaryPaymentTransactionId('card', 'cmd-1');
  const tx = target.transaction.id;
  if (name === 'afterReversal') {
    await editPurchase(database, tx, '2026-10-13', { merchantName: 'Solo nombre' });
    await deleteMovement(database, paymentId, '2026-10-14');
    const outcome = await attempt(() => deleteMovement(database, tx, '2026-10-15'));
    const observation = await observe(database, '2026-10-15');
    check(outcome === 'accepted' && json(observation.revisions.map(row => row.source)) ===
      json(['original', 'allocation', 'allocationReversal', 'purchaseRemoval']), 'Deletion allowed after the reversal');
    return canonical({ outcome, observation });
  }
  const operations: Record<Exclude<Phase1A4BGuardCase, 'reassignment' | 'afterReversal'>, () => Promise<unknown>> = {
    deletePurchase: () => deleteMovement(database, tx, '2026-10-13'),
    toDebitQuick: () => withPhase1A2Clock(bogotaNoon('2026-10-13'), () =>
      updateTransactionQuickly(dependencies(database), tx, { kind: 'paymentMethod', operationType: 'Débito' })),
    toSingleQuick: () => withPhase1A2Clock(bogotaNoon('2026-10-13'), () =>
      updateTransactionQuickly(dependencies(database), tx, { kind: 'installments', installmentCount: 1, interestFreeCount: 0 })),
    toSingleForm: () => editPurchase(database, tx, '2026-10-13', { installmentCountInput: '1' }),
    otherCount: () => editPurchase(database, tx, '2026-10-13', { installmentCountInput: '3' }),
    otherAmount: () => editPurchase(database, tx, '2026-10-13', { amount: 500000 }),
    otherCard: () => editPurchase(database, tx, '2026-10-13', { accountId: 'card2' }),
    otherDate: () => editPurchase(database, tx, '2026-10-13', { occurrence: { kind: 'date', date: '2026-09-11' } }),
    debitForm: () => editPurchase(database, tx, '2026-10-13', { operationType: 'Débito', accountId: 'bank' }),
    // Both raw deletions are aborted by the SQLite guards (the FK cascade fires the purchase guard).
    rawCascade: async () => {
      await database.executeSql('DELETE FROM transactions WHERE id = ?', [tx]);
    },
  };
  const before = json(await fullState(database, '2026-10-12'));
  const outcome = await attempt(operations[name]);
  const rowOutcome = name === 'rawCascade'
    ? await attempt(() => database.executeSql('DELETE FROM installment_purchases WHERE id = ?', [target.id])) : undefined;
  check(name === 'rawCascade' ? outcome === 'raise:imputaciones activas' && rowOutcome === outcome
    : outcome === 'rejected:activeAllocation', `${name}: ${outcome}`);
  check(json(await fullState(database, '2026-10-12')) === before, `${name} left changes`);
  return canonical({ outcome, ...(rowOutcome ? { rowOutcome } : {}), observation: await observe(database, '2026-10-12') });
}

// ---------------------------------------------------------------------------------------------------------------
// D. command_id after repetition, edit and deletion (in process; the restart is phase1a4b-unknown-restart)

export async function runPhase1A4BIdempotency(database: Database, countWrites: Phase1A4BWriteCounter) {
  await seed(database);
  const { id } = await purchase(database, '2026-10-11', 600000, 6);
  const other = await purchase(database, '2026-10-11', 300000, 3);
  const paymentId = extraordinaryPaymentTransactionId('card', 'cmd-1');
  const steps: Row = {};
  const step = async (label: string, run: () => Promise<unknown>) => {
    let value: unknown;
    const writes = await countWrites(async () => { value = await run(); });
    const result = value as Row | undefined;
    steps[label] = { writes, status: result?.status ?? null,
      allocationStatus: (result?.allocation as Row | undefined)?.status ?? null,
      paymentAmount: (result?.payment as Row | undefined)?.amount ?? null };
    return writes;
  };
  const same = () => extraordinary(database, id, '2026-10-12');
  check((await step('create', same)) > 0, 'Created');
  check((await step('repeat', same)) === 0, 'Repeat wrote');
  await step('editPayment', () => editPayment(database, paymentId, '2026-10-13', { amount: 90000 }));
  check((await step('repeatAfterEdit', same)) === 0, 'Repeat after edit wrote');
  await step('deletePayment', () => deleteMovement(database, paymentId, '2026-10-14'));
  check((await step('repeatAfterDeletion', same)) === 0, 'Repeat after deletion wrote');
  const rejected: Row = {};
  for (const [label, changes] of [['otherPurchase', { installmentPurchaseId: other.id }], ['otherCard', { cardAccountId: 'card2' }],
    ['otherAllocatedAmount', { allocatedAmount: 50000 }]] as const) {
    let outcome = '';
    const writes = await countWrites(async () => { outcome = await attempt(() => extraordinary(database, id, '2026-10-15', changes)); });
    check(outcome.startsWith('rejected: ') && writes === 0, `${label}: ${outcome}`);
    rejected[label] = { outcome, writes };
  }
  // Not verifiable once the payment was edited or deleted (no column keeps them): answered from the evidence, no writes.
  const unverifiable: Row = {};
  for (const [label, changes] of [['otherPaymentAmount', { paymentAmount: 120000 }], ['otherSource', { sourceAccountId: 'target' }]] as const) {
    let status: unknown;
    const writes = await countWrites(async () => { status = ((await extraordinary(database, id, '2026-10-15', changes)) as Row).status; });
    check(status === 'replayed' && writes === 0, `${label}: ${String(status)}`);
    unverifiable[label] = { status, writes };
  }
  const observation = await observe(database, '2026-10-15');
  check(!observation.transactions.some(row => row.type === 'creditCardPayment'), 'A deleted payment was recreated');
  check(json(statuses(observation)) === json(['reversed']), 'The reversed allocation was reactivated');
  return canonical({ steps, rejected, unverifiable, observation });
}

// ---------------------------------------------------------------------------------------------------------------
// E. Atomicity: every write of the four operations, before and after

export type Phase1A4BFaults = {
  countWrites: Phase1A4BWriteCounter;
  arm: (write: number, phase: 'before' | 'after') => { fired: () => boolean; isInjected: (error: unknown) => boolean };
  disarm: () => void;
};

async function prepareMatrix(database: Database, name: Phase1A4BMatrix) {
  await seed(database);
  if (name === 'register' || name === 'registerLazy') {
    const { id } = name === 'register' ? await purchase(database, '2026-10-11', 600000, 6) : await intermediatePlan(database, '2026-10-11', 600000, 6);
    const params = extraordinaryParams(database, id, '2026-10-12');
    return { date: '2026-10-12', run: () => withPhase1A2Clock(bogotaNoon('2026-10-12'), () => registerExtraordinaryInstallmentPayment(params)) };
  }
  const { id } = await purchase(database, '2026-10-11', 600000, 6);
  await extraordinary(database, id, '2026-10-12');
  const paymentId = extraordinaryPaymentTransactionId('card', 'cmd-1');
  if (name === 'editReversal') {
    const params = await editPaymentParams(database, paymentId, '2026-10-13', { amount: 90000 });
    return { date: '2026-10-13', run: () => withPhase1A2Clock(bogotaNoon('2026-10-13'), () => saveManualTransaction(params)) };
  }
  const params = await deleteMovementParams(database, paymentId, '2026-10-13');
  return { date: '2026-10-13', run: () => withPhase1A2Clock(bogotaNoon('2026-10-13'), () => deleteManualTransactionSafely(params)) };
}

/**
 * Write count of a successful run (compared with Node), then every write before/after: the injected error propagates,
 * rollback is confirmed (never unknown), the connection stays usable, a new owner confirms a transaction and every table,
 * rowid, schema object, allocation, revision, backup counter and dashboard figure equals the state before.
 */
export async function runPhase1A4BMatrix(database: Database, name: Phase1A4BMatrix, faults: Phase1A4BFaults,
  record: (label: string, operation: () => Promise<unknown>) => Promise<unknown>) {
  let writes = 0;
  await record(`${name}-success`, async () => {
    const { date, run } = await prepareMatrix(database, name);
    writes = await faults.countWrites(run);
    const after = await observe(database, date);
    check(writes > 0, 'Write instrumentation missing');
    check(after.allocations.length === 1, 'One allocation');
    check(json(statuses(after)) === json([name === 'register' || name === 'registerLazy' ? 'active' : 'reversed']), 'Allocation status');
    expectNoInventedFacts(after);
    return canonical({ writes, points: writes * 2, after });
  });
  for (let write = 1; write <= writes; write++) for (const phase of ['before', 'after'] as const) {
    await record(`${name}-rollback-${write}-${phase}`, async () => {
      const { date, run } = await prepareMatrix(database, name);
      const before = await fullState(database, date);
      const fault = faults.arm(write, phase);
      let failure: unknown;
      try { await run(); } catch (error) { failure = error; } finally { faults.disarm(); }
      check(failure !== undefined, 'The injected fault did not make the operation fail');
      check(fault.fired(), 'The injected write was not reached');
      check(!(failure instanceof SQLiteCommandFailure), 'Rollback not confirmed');
      check(fault.isInjected(failure), 'Unexpected error: ' + errorText(failure));
      let after;
      try { after = await fullState(database, date); } catch (error) { throw Error('Connection retired: ' + errorText(error)); }
      const nextOwner = (await runSharedSQLiteTransaction(database, async () => 'closed')).status;
      check(nextOwner === 'confirmed', 'Transaction left open: ' + nextOwner);
      check(json(after) === json(before), 'Rollback changed tables, rowids, allocations, revisions, counter or figures');
      return { write, phase, status: 'rolledBack', exactStateRestored: true, nextOwnerConfirmed: true };
    });
  }
  return writes;
}

// ---------------------------------------------------------------------------------------------------------------
// F. Unknown outcome of a registration and restart

/** Lost COMMIT response of a registration: `unknown`, never executed again, the connection retires (data kept). */
export async function runPhase1A4BUnknown(database: Database, loseCommit: (lost: boolean) => void) {
  const { run } = await prepareMatrix(database, 'register');
  await database.executeSql(`CREATE TABLE ${MARKER} (scenario TEXT NOT NULL)`);
  await database.executeSql(`INSERT INTO ${MARKER} VALUES ('register-unknown')`);
  loseCommit(true);
  let failure: unknown;
  try { await run(); } catch (error) { failure = error; } finally { loseCommit(false); }
  check(failure instanceof SQLiteCommandFailure && failure.result.status === 'unknown', 'COMMIT must stay unknown');
  let second: unknown;
  // Same request object: the runtime guard hands back the same outcome instead of re-executing.
  try { await run(); } catch (error) { second = error; }
  check(second === failure, 'Unknown request was retried');
  let retired = false;
  try { await dependencies(database).accountRepository.getAccounts(); } catch { retired = true; }
  check(retired, 'Unknown connection not retired');
  return { status: 'unknown', sameFailure: true, connectionRetired: true };
}

/** After reopening: one payment and one allocation; a deliberate repetition of the command replays without writing. */
export async function checkPhase1A4BAfterRestart(database: Database, countWrites: Phase1A4BWriteCounter) {
  const [marker] = await query(database, `SELECT * FROM ${MARKER}`);
  check(marker?.scenario === 'register-unknown', 'Restart marker missing');
  const after = await observe(database, '2026-10-12');
  const payments = after.transactions.filter(row => row.type === 'creditCardPayment');
  check(payments.length === 1 && after.allocations.length === 1 && json(statuses(after)) === json(['active']), 'Payment duplicated or missing');
  expectMoney(after, '900000', '500000');
  const purchaseId = String(after.installmentPurchases[0]!.id);
  let replay: unknown;
  const replayWrites = await countWrites(async () => { replay = ((await extraordinary(database, purchaseId, '2026-10-13')) as Row).status; });
  check(replay === 'replayed' && replayWrites === 0, 'Command repeated after restart wrote');
  let different = '';
  const differentWrites = await countWrites(async () => {
    different = await attempt(() => extraordinary(database, purchaseId, '2026-10-13', { paymentAmount: 120000 }));
  });
  check(different.includes('datos distintos') && differentWrites === 0, 'Different data under the same command');
  const final = await observe(database, '2026-10-13');
  check(json(final.allocations) === json(after.allocations) && final.transactions.length === after.transactions.length, 'Restart replay changed data');
  return canonical({ marker, replay, replayWrites, different, differentWrites, after });
}
