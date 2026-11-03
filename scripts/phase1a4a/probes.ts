// Phase 1a.4A probes: revision 0 of installment purchases registered after migration 5, on the real SQLite driver. The
// same synthetic scenarios run in Node (node:sqlite, __tests__/phase1a4aAndroidEquivalence.test.ts) and in the isolated
// Android APK (com.smartfin.snapshot5b2.tests), through the unchanged production use cases and repositories. Every use
// case runs with the JS clock pinned. A "version 4" database is produced in place by dropping exactly the migration 5
// objects (same procedure as 1a.3B). Only synthetic data; no extraordinary payment and no allocation is created.
import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import { runSharedSQLiteTransaction, SQLiteCommandFailure } from '../../src/database/atomicSQLite';
import { applyVersionedMigrations } from '../../src/database/migrations';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteInstallmentHistoryRepository } from '../../src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import {
  deleteManualTransactionSafely,
  saveManualTransaction,
  type SaveManualTransactionParams,
} from '../../src/modules/transactions/useCases/saveManualTransaction';
import { updateTransactionQuickly } from '../../src/modules/transactions/useCases/updateTransactionQuickly';
import { registerCreditCardPayment } from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { serializeCreditCardVisualMetadata } from '../../src/modules/creditCards/useCases/manageCreditCards';
import {
  buildInitialInstallmentRevision,
  recordInitialInstallmentRevision,
} from '../../src/modules/creditCards/useCases/initialInstallmentRevision';
import { selectEffectivePlanRevision } from '../../src/modules/creditCards/useCases/installmentPlanRevisions';
import type { Transaction } from '../../src/modules/transactions/types/Transaction';
import { centsText, resetSyntheticData, textCents } from '../phase6b/probes';
import { bogotaNoon, withPhase1A2Clock } from '../phase1a2/probes';

export const PHASE1A4A_CREATION_CASES = [
  'exact', 'cents', 'noClosingDay', 'closingDayWithoutPolicy', 'closingDayClosingCycle', 'closingDayNextCycle',
  'inexactAmount', 'zeroCentInstallments', 'tooManyInstallments', 'confirmedFirstCycle', 'secondOriginalRejected',
] as const;
export type Phase1A4ACreationCase = (typeof PHASE1A4A_CREATION_CASES)[number];
/** Operations whose writes are failed one by one: a new plan and a plan recreated with the same id. */
export const PHASE1A4A_MATRICES = ['creation', 'recreation'] as const;
export type Phase1A4AMatrix = (typeof PHASE1A4A_MATRICES)[number];

type Row = Record<string, unknown>;
type Database = SmartFinSQLiteDatabase;
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
const rowsOf = (result: { rows: { length: number; item: (index: number) => unknown } }) =>
  Array.from({ length: result.rows.length }, (_, index) => result.rows.item(index) as Row);
const json = (value: unknown) => JSON.stringify(value);
// node:sqlite and the Android driver reject with message objects that are not always Error instances.
const errorText = (error: unknown) => error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
  ? String((error as { message: string }).message) : json(error);
const query = async (database: Database, sql: string, values: (string | number | null)[] = []) =>
  rowsOf((await database.executeSql(sql, values))[0]);
const at = (date: string) => bogotaNoon(date).toISOString();
const MARKER = 'synthetic_phase1a4a_marker';

const dependencies = (database: Database) => ({
  accountRepository: createSqliteAccountRepository(database),
  transactionRepository: createSqliteTransactionRepository(database),
  creditCardRepository: createSqliteCreditCardRepository(database),
});

/** Bank 1.000.000 and a Visa with a 2.000.000 limit; closing day 20 unless stated (null = no closing day). */
async function seed(database: Database, closingDay: number | null = 20) {
  await database.executeSql(`DROP TABLE IF EXISTS ${MARKER}`);
  await resetSyntheticData(database);
  // resetSyntheticData also empties financial_data_revision; without its row the triggers count nothing.
  await database.executeSql("INSERT INTO financial_data_revision (id, revision, updated_at) VALUES (1, 0, '2026-01-01')");
  await database.executeSql(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,credit_limit_amount,
    description,created_at,updated_at) VALUES
    ('bank','Banco','bankAccount','active','COP',1000000,NULL,NULL,NULL,'2026-01-01','2026-01-01'),
    ('card','Visa','creditCard','active','COP',0,0,2000000,?,'2026-01-01','2026-01-01')`,
  [closingDay === null ? null : serializeCreditCardVisualMetadata({ closingDay, paymentDay: 5 })]);
}

type Accounts = Awaited<ReturnType<ReturnType<typeof dependencies>['accountRepository']['getAccounts']>>;
function purchaseParams(database: Database, accounts: Accounts, date: string, amount: number, installments: number,
  extra: Partial<SaveManualTransactionParams> = {}): SaveManualTransactionParams {
  return {
    ...dependencies(database), accounts, accountId: 'card', amount, merchantName: 'Sintetico 1a.4A',
    operationType: 'Crédito', transactionType: 'expense', hasInterestFreeInstallments: false,
    installmentCountInput: String(installments), interestFreeInstallmentCountInput: '', occurrence: { kind: 'date', date },
    currentDate: bogotaNoon(date), now: bogotaNoon(date), ...extra,
  };
}
const accountsAt = (database: Database, date: string) =>
  withPhase1A2Clock(bogotaNoon(date), () => dependencies(database).accountRepository.getAccounts());
async function newPurchaseParams(database: Database, date: string, amount: number, installments: number, merchantName = 'Sintetico 1a.4A') {
  return purchaseParams(database, await accountsAt(database, date), date, amount, installments, { merchantName });
}
async function purchase(database: Database, date: string, amount: number, installments: number, merchantName?: string) {
  const params = await newPurchaseParams(database, date, amount, installments, merchantName);
  return withPhase1A2Clock(bogotaNoon(date), async () => (await saveManualTransaction(params)).transaction);
}
async function currentTransaction(database: Database, id: string): Promise<Transaction> {
  const transaction = (await dependencies(database).transactionRepository.getTransactions()).find(row => row.id === id);
  check(transaction, 'Movement missing: ' + id);
  return transaction;
}
/** Edit on `when`, keeping the civil date and amount unless stated. The params object is the request identity. */
async function editParams(database: Database, id: string, when: string, changes: Partial<SaveManualTransactionParams>) {
  const original = await currentTransaction(database, id);
  const accounts = await accountsAt(database, when);
  return purchaseParams(database, accounts, original.civilDate ?? original.date.slice(0, 10), original.amount,
    Number(changes.installmentCountInput ?? '1'),
    { editingTransaction: original, merchantName: original.merchantName, currentDate: bogotaNoon(when), now: bogotaNoon(when), ...changes });
}
async function edit(database: Database, id: string, when: string, changes: Partial<SaveManualTransactionParams>) {
  const params = await editParams(database, id, when, changes);
  return withPhase1A2Clock(bogotaNoon(when), async () => (await saveManualTransaction(params)).transaction);
}
const pay = (database: Database, date: string, amount: number) => withPhase1A2Clock(bogotaNoon(date), async () =>
  (await registerCreditCardPayment({ ...dependencies(database), accountId: 'card', sourceAccountId: 'bank', amount,
    currentDate: bogotaNoon(date), settlement: 'partial' })).transaction);
async function deleteMovement(database: Database, id: string, when: string) {
  const transaction = await currentTransaction(database, id);
  const accounts = await accountsAt(database, when);
  await withPhase1A2Clock(bogotaNoon(when), () => deleteManualTransactionSafely({ ...dependencies(database), accounts, transaction }));
}

// ---------------------------------------------------------------------------------------------------------------
// Observation

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Trigger revisions carry SQLite's own clock (host time): checked, then never compared. Revision 0 uses the JS clock. */
function sqlClock(row: Row): Row {
  if (row.source !== 'purchaseEdit' && row.source !== 'purchaseRemoval') return row;
  check(typeof row.created_at === 'string' && ISO_INSTANT.test(row.created_at), 'SQLite clock format');
  return { ...row, created_at: '<sqlite-clock>' };
}
async function revisions(database: Database) {
  // Ordered by the purchase's rowid (ids embed a per-process sequence); removed purchases last, by id.
  return (await query(database, `SELECT r.* FROM installment_plan_revisions r
    LEFT JOIN installment_purchases p ON p.id = r.installment_purchase_id
    ORDER BY p.rowid IS NULL, p.rowid, r.installment_purchase_id, r.revision_number`)).map(sqlClock);
}
const revisionCounter = async (database: Database) =>
  Number((await query(database, 'SELECT revision FROM financial_data_revision WHERE id = 1'))[0]?.revision);

/** Accounts and available credit (BigInt cents), dashboard, movements, plans, statements with rowid, history, counter. */
async function observe(database: Database, date: string) {
  const accounts = await query(database, `SELECT rowid AS row_id, id, balance_amount, debt_balance_amount, credit_limit_amount,
    created_at, updated_at FROM accounts ORDER BY id`);
  const card = accounts.find(account => account.id === 'card');
  const summary = await getDashboardSummaryFromDb(database, bogotaNoon(date));
  const integrityRows = await query(database, 'PRAGMA integrity_check');
  const foreignKeys = await query(database, 'PRAGMA foreign_key_check');
  check(integrityRows[0]?.integrity_check === 'ok' && foreignKeys.length === 0, 'SQLite integrity / foreign keys');
  const availableCredit = card && typeof card.debt_balance_amount === 'number' && Number.isInteger(card.debt_balance_amount * 100)
    ? centsText(textCents(String(card.credit_limit_amount)) - textCents(String(card.debt_balance_amount))) : null;
  return {
    accounts, availableCredit,
    summary: { availableBalance: summary.availableBalance, totalDebt: summary.totalDebt, netWorth: summary.netWorth,
      monthlyIncome: summary.monthlyIncome, monthlyExpenses: summary.monthlyExpenses, monthlySavings: summary.monthlySavings },
    transactions: await query(database, 'SELECT rowid AS row_id, * FROM transactions ORDER BY created_at, rowid'),
    installmentPurchases: await query(database, 'SELECT rowid AS row_id, * FROM installment_purchases ORDER BY rowid'),
    statements: await query(database, 'SELECT rowid AS row_id, * FROM credit_card_statements ORDER BY statement_start_date, rowid'),
    revisions: await revisions(database),
    allocations: await query(database, 'SELECT * FROM installment_allocations ORDER BY id'),
    backupRevision: await revisionCounter(database),
    integrity: { integrityCheck: 'ok', foreignKeyViolations: 0 },
  };
}
type Observation = Awaited<ReturnType<typeof observe>>;

/** Every table with rowids (synthetic marker excluded) and the full schema: the exact rollback oracle. */
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

/** Movement ids embed the pinned clock and a per-process sequence: renamed M1.. / P1.. in order of first appearance. */
function canonical<T>(value: T): T {
  const text = json(value);
  const ids = [...new Set(text.match(/tx_manual_\d+(?:_\d+)?|tx-credit-card-payment-card-\d+-\d+/g) ?? [])];
  let manual = 0;
  let payment = 0;
  const labels = new Map(ids.map(id => [id, id.startsWith('tx_manual_') ? `M${++manual}` : `P${++payment}`] as const));
  const ordered = [...labels.entries()].sort((a, b) => b[0].length - a[0].length);
  return JSON.parse(ordered.reduce((current, [id, label]) => current.split(id).join(label), text)) as T;
}

/** Compact history line per revision: number, source, verification, reasons, principal, count, installment, cycle. */
const shape = (row: Row) => [row.revision_number, row.source, row.verification, row.pending_reasons, row.remaining_principal_cents,
  row.remaining_installments, row.installment_amount_cents, row.effective_cycle_end];
const historyOf = (observation: Observation, purchaseId: string) =>
  observation.revisions.filter(row => row.installment_purchase_id === purchaseId).map(shape);
function expectMoney(observation: Observation, bank: string, debt: string, expense: string) {
  const amount = (id: string, column: string) => String(observation.accounts.find(row => row.id === id)?.[column]);
  check(textCents(amount('bank', 'balance_amount')) === textCents(bank), `Bank ${bank}`);
  check(textCents(amount('card', 'debt_balance_amount')) === textCents(debt), `Debt ${debt}`);
  check(observation.availableCredit === centsText(textCents('2000000') - textCents(debt)), 'Available credit');
  check(textCents(String(observation.summary.netWorth)) === textCents(bank) - textCents(debt), 'Net worth');
  check(textCents(String(observation.summary.monthlyExpenses)) === textCents(expense), `Expense ${expense}`);
  check(textCents(String(observation.summary.monthlyIncome)) === 0n, 'Income');
}
function expectOneOriginal(observation: Observation, purchaseId: string) {
  const history = observation.revisions.filter(row => row.installment_purchase_id === purchaseId);
  check(history.length === 1 && history[0]!.revision_number === 0 && history[0]!.source === 'original' &&
    history[0]!.id === `${purchaseId}:revision:0`, 'Exactly one revision 0: ' + purchaseId);
  return history[0]!;
}

async function downgradeToVersion4(database: Database) {
  const triggers = await query(database, `SELECT name FROM sqlite_master WHERE type = 'trigger'
    AND (sql LIKE '%installment_allocations%' OR sql LIKE '%installment_plan_revisions%'
      OR sql LIKE '%credit_card_billing_rules%' OR sql LIKE '%installment_first_cycles%') ORDER BY name`);
  for (const { name } of triggers) {
    check(typeof name === 'string' && /^[a-z0-9_]+$/.test(name), 'Unexpected trigger name');
    await database.executeSql(`DROP TRIGGER ${name}`);
  }
  for (const table of ['installment_plan_revisions', 'installment_allocations', 'installment_first_cycles', 'credit_card_billing_rules'])
    await database.executeSql(`DROP TABLE IF EXISTS ${table}`);
  await database.executeSql('DELETE FROM schema_migrations WHERE version = 5');
}
const versions = async (database: Database) =>
  (await query(database, 'SELECT version FROM schema_migrations ORDER BY version')).map(row => Number(row.version));

/** Plans whose current incarnation has no revision: they need the lazy revision 0 before a future allocation (1a.4B). */
async function plansWithoutHistory(database: Database) {
  return (await query(database, `SELECT p.id FROM installment_purchases p WHERE COALESCE((SELECT r.source
    FROM installment_plan_revisions r WHERE r.installment_purchase_id = p.id ORDER BY r.revision_number DESC LIMIT 1),
    'purchaseRemoval') = 'purchaseRemoval' ORDER BY p.rowid`)).map(row => String(row.id));
}

// ---------------------------------------------------------------------------------------------------------------
// A. Creation: revision 0 per scenario

export async function runPhase1A4ACreation(database: Database, name: Phase1A4ACreationCase) {
  const closingDay = name === 'noClosingDay' ? null : name.startsWith('closingDay') ? 11 : 20;
  await seed(database, closingDay);
  const history = createSqliteInstallmentHistoryRepository(database);
  if (name === 'closingDayClosingCycle' || name === 'closingDayNextCycle')
    await history.saveBillingRules({ accountId: 'card', closingDayPurchasePolicy: name === 'closingDayClosingCycle' ? 'closingCycle' : 'nextCycle',
      createdAt: at('2026-10-01'), updatedAt: at('2026-10-01') });
  const [amount, installments] = ({ cents: [1234.57, 6], inexactAmount: [0.1 + 0.2, 3], zeroCentInstallments: [0.02, 3],
    tooManyInstallments: [400000, 400] } as Partial<Record<Phase1A4ACreationCase, [number, number]>>)[name] ?? [300000, 3];
  const before = await revisionCounter(database);
  const created = await purchase(database, '2026-10-11', amount, installments);
  const purchaseId = `installment-${created.id}`;
  let extra: Row = {};
  if (name === 'confirmedFirstCycle') {
    // A plan without history (left by the intermediate 1a.3B code) with a confirmed first cycle: the use case honours it.
    await database.executeSql(`INSERT INTO installment_purchases SELECT 'synthetic-gap', transaction_id, account_id, merchant_name,
      total_amount, currency, installment_count, paid_installments, monthly_amount, first_due_date, status, created_at, updated_at
      FROM installment_purchases WHERE id = ?`, [purchaseId]);
    await history.saveFirstCycle({ installmentPurchaseId: 'synthetic-gap', cycleEnd: '2026-11-20', source: 'statement',
      createdAt: at('2026-10-12'), updatedAt: at('2026-10-12') });
    const [plan] = await dependencies(database).creditCardRepository.getInstallmentPurchases(['card'])
      .then(rows => rows.filter(row => row.id === 'synthetic-gap'));
    check(plan, 'Gap plan readable');
    const result = await runSharedSQLiteTransaction(database, participant => recordInitialInstallmentRevision({
      creditCardRepository: createSqliteCreditCardRepository(participant), purchase: plan, purchaseDate: '2026-10-11',
      createdAt: at('2026-10-12') }));
    check(result.status === 'confirmed' && result.value?.verification === 'confirmed', 'Confirmed revision 0');
    extra = { gapRevision: result.value };
  }
  if (name === 'secondOriginalRejected') {
    const stateBefore = json(await fullState(database, '2026-10-11'));
    const [plan] = (await dependencies(database).creditCardRepository.getInstallmentPurchases(['card'])).filter(row => row.id === purchaseId);
    check(plan, 'Plan readable');
    let error: unknown;
    try {
      await history.appendPlanRevision(buildInitialInstallmentRevision({ purchase: plan, purchaseDate: '2026-10-11', billing: {},
        createdAt: at('2026-10-12') }));
    } catch (caught) { error = caught; }
    check(errorText(error).includes('revisión original vigente'), 'Second original must be rejected: ' + errorText(error));
    // Repeating the use case is a no-op that returns the stored revision.
    const repeated = await runSharedSQLiteTransaction(database, participant => recordInitialInstallmentRevision({
      creditCardRepository: createSqliteCreditCardRepository(participant), purchase: plan, purchaseDate: '2026-10-11',
      createdAt: at('2026-10-12') }));
    check(repeated.status === 'confirmed' && repeated.value?.revisionNumber === 0, 'Repeated revision 0 is a no-op');
    check(json(await fullState(database, '2026-10-11')) === stateBefore, 'Rejected or repeated revision left changes');
    extra = { rejected: 'La compra ya tiene una revisión original vigente.', repeatedRevisionNumber: 0 };
  }
  const observation = await observe(database, '2026-10-11');
  const revision = expectOneOriginal(observation, purchaseId);
  check(revision.created_at === at('2026-10-11'), 'Revision 0 uses the JS clock of the save');
  check(revision.basis_total_amount === observation.installmentPurchases[0]!.total_amount &&
    revision.basis_monthly_amount === observation.installmentPurchases[0]!.monthly_amount &&
    revision.basis_installment_count === observation.installmentPurchases[0]!.installment_count, 'Legacy values kept in basis');
  check((revision.verification === 'pendingVerification') === (revision.pending_reasons !== null), 'Reasons only when pending');
  check(observation.installmentPurchases[0]!.paid_installments === 0, 'paid_installments untouched');
  return canonical({ revision: shape(revision), backupRevisionDelta: (await revisionCounter(database)) - before, ...extra, observation });
}

// ---------------------------------------------------------------------------------------------------------------
// B. Lifecycle: ordinary edits, term changes, removal, recreation, quick action, deletion; write counts per step

export type Phase1A4AWriteCounter = (run: () => Promise<unknown>) => Promise<number>;

/** `checkHistory: false` only for the Node comparison of write counts with the revision 0 step neutralized. */
export async function runPhase1A4ALifecycle(database: Database, countWrites: Phase1A4AWriteCounter, checkHistory = true) {
  await seed(database);
  const steps: Row = {};
  let id = '';
  const step = async (label: string, when: string, run: () => Promise<unknown>, expected: unknown[][]) => {
    const writes = await countWrites(run);
    const observation = await observe(database, when);
    const history = historyOf(observation, `installment-${id}`);
    check(!checkHistory || json(history.map(row => row.slice(0, 2))) === json(expected), `${label}: history ${json(history)}`);
    steps[label] = { writes, history, observation };
  };
  await step('create', '2026-10-11', async () => { id = (await purchase(database, '2026-10-11', 300000, 3)).id; }, [[0, 'original']]);
  const identity = json((await query(database, 'SELECT rowid, id, created_at FROM installment_purchases'))[0]);
  await step('renameOnly', '2026-10-12', () => edit(database, id, '2026-10-12', { installmentCountInput: '3', merchantName: 'Otro nombre' }), [[0, 'original']]);
  await step('renameAgain', '2026-10-12', () => edit(database, id, '2026-10-12', { installmentCountInput: '3', merchantName: 'Otro nombre' }), [[0, 'original']]);
  await step('threeToSix', '2026-10-13', () => edit(database, id, '2026-10-13', { installmentCountInput: '6' }),
    [[0, 'original'], [1, 'purchaseEdit']]);
  check(json((await query(database, 'SELECT rowid, id, created_at FROM installment_purchases'))[0]) === identity, 'Plan identity kept');
  await step('toSingle', '2026-10-14', () => edit(database, id, '2026-10-14', { installmentCountInput: '1' }),
    [[0, 'original'], [1, 'purchaseEdit'], [2, 'purchaseRemoval']]);
  await step('recreateFour', '2026-10-15', () => edit(database, id, '2026-10-15', { installmentCountInput: '4' }),
    [[0, 'original'], [1, 'purchaseEdit'], [2, 'purchaseRemoval'], [3, 'original']]);
  await step('toDebit', '2026-10-16', () => edit(database, id, '2026-10-16', { installmentCountInput: '1', operationType: 'Débito', accountId: 'bank' }),
    [[0, 'original'], [1, 'purchaseEdit'], [2, 'purchaseRemoval'], [3, 'original'], [4, 'purchaseRemoval']]);
  await step('backToCredit', '2026-10-17', () => edit(database, id, '2026-10-17', { installmentCountInput: '2', operationType: 'Crédito', accountId: 'card' }),
    [[0, 'original'], [1, 'purchaseEdit'], [2, 'purchaseRemoval'], [3, 'original'], [4, 'purchaseRemoval'], [5, 'original']]);
  const quick = (count: number) => withPhase1A2Clock(bogotaNoon('2026-10-18'), () =>
    updateTransactionQuickly(dependencies(database), id, { kind: 'installments', installmentCount: count, interestFreeCount: 0 }));
  await step('quickSameTerms', '2026-10-18', () => quick(2),
    [[0, 'original'], [1, 'purchaseEdit'], [2, 'purchaseRemoval'], [3, 'original'], [4, 'purchaseRemoval'], [5, 'original']]);
  await step('quickToSingle', '2026-10-18', () => quick(1),
    [[0, 'original'], [1, 'purchaseEdit'], [2, 'purchaseRemoval'], [3, 'original'], [4, 'purchaseRemoval'], [5, 'original'], [6, 'purchaseRemoval']]);
  await step('quickToThree', '2026-10-18', () => quick(3),
    [[0, 'original'], [1, 'purchaseEdit'], [2, 'purchaseRemoval'], [3, 'original'], [4, 'purchaseRemoval'], [5, 'original'], [6, 'purchaseRemoval'], [7, 'original']]);
  await step('delete', '2026-10-19', () => deleteMovement(database, id, '2026-10-19'),
    [[0, 'original'], [1, 'purchaseEdit'], [2, 'purchaseRemoval'], [3, 'original'], [4, 'purchaseRemoval'], [5, 'original'], [6, 'purchaseRemoval'], [7, 'original'], [8, 'purchaseRemoval']]);
  const final = steps.delete as { observation: Observation };
  check(final.observation.transactions.length === 0 && final.observation.installmentPurchases.length === 0, 'Purchase deleted');
  const repository = createSqliteInstallmentHistoryRepository(database);
  check(!checkHistory || selectEffectivePlanRevision(await repository.getPlanRevisions(`installment-${id}`)).status === 'removed',
    'History ends removed');
  return canonical(steps);
}

// ---------------------------------------------------------------------------------------------------------------
// C. Compatibility: migrated purchase, purchase without history from the intermediate version, new purchase

export async function runPhase1A4ACompatibility(database: Database) {
  await seed(database);
  const migrated = await purchase(database, '2026-10-11', 1234.56, 6, 'Migrada');
  await downgradeToVersion4(database);
  check(json(await versions(database)) === json([1, 2, 3, 4]), 'Version 4 expected');
  await applyVersionedMigrations(database);
  check(json(await versions(database)) === json([1, 2, 3, 4, 5]), 'Version 5 expected');
  const migratedId = `installment-${migrated.id}`;
  const fresh = await purchase(database, '2026-10-12', 300000, 3, 'Nueva');
  const freshId = `installment-${fresh.id}`;
  // Intermediate version (1a.3B code after migration 5): plan row saved without revision 0.
  const single = await purchase(database, '2026-10-12', 90000, 1, 'Intermedia');
  await database.executeSql(`INSERT INTO installment_purchases (id, transaction_id, account_id, merchant_name, total_amount, currency,
    installment_count, paid_installments, monthly_amount, first_due_date, status, created_at, updated_at)
    VALUES (?, ?, 'card', 'Intermedia', 90000, 'COP', 3, 0, 30000, '2026-11-12', 'active', ?, ?)`,
  [`installment-${single.id}`, single.id, at('2026-10-12'), at('2026-10-12')]);
  const gapId = `installment-${single.id}`;
  const afterSetup = await observe(database, '2026-10-12');
  const migratedRevision = expectOneOriginal(afterSetup, migratedId);
  check(migratedRevision.verification === 'pendingVerification' && migratedRevision.effective_cycle_end === null, 'Migration revision 0 kept');
  check(expectOneOriginal(afterSetup, freshId).verification === 'projected', 'New purchase projected');
  const pending = await plansWithoutHistory(database);
  check(json(pending) === json([gapId]), 'Only the intermediate plan needs a lazy revision 0');
  // Ordinary edits of all three: nothing appended, nothing invented; repeated migration is a no-op.
  await edit(database, migrated.id, '2026-10-13', { installmentCountInput: '6', merchantName: 'Migrada renombrada' });
  await edit(database, fresh.id, '2026-10-13', { installmentCountInput: '3', merchantName: 'Nueva renombrada' });
  const gapEdit = await countRevisionsAround(database, () =>
    edit(database, single.id, '2026-10-13', { installmentCountInput: '3', merchantName: 'Intermedia renombrada' }));
  await applyVersionedMigrations(database);
  const afterEdits = await observe(database, '2026-10-13');
  check(json(afterEdits.revisions.map(row => [row.installment_purchase_id, row.revision_number])) ===
    json(afterSetup.revisions.map(row => [row.installment_purchase_id, row.revision_number])), 'Ordinary edits appended revisions');
  check(json(await plansWithoutHistory(database)) === json([gapId]), 'Lazy initialization still pending');
  return canonical({ pendingLazyInitialization: pending, gapEditRevisionDelta: gapEdit,
    afterSetup: migrationClock(afterSetup, migratedId), afterEdits: migrationClock(afterEdits, migratedId) });
}
/** Revision 0 written by migration 5 carries SQLite's clock (host time): checked, then never compared. */
function migrationClock(observation: Observation, purchaseId: string): Observation {
  return { ...observation, revisions: observation.revisions.map(row => {
    if (row.installment_purchase_id !== purchaseId || row.revision_number !== 0) return row;
    check(typeof row.created_at === 'string' && ISO_INSTANT.test(row.created_at), 'SQLite clock format');
    return { ...row, created_at: '<sqlite-clock>' };
  }) };
}
async function countRevisionsAround(database: Database, run: () => Promise<unknown>) {
  const before = (await query(database, 'SELECT COUNT(*) AS n FROM installment_plan_revisions'))[0]?.n;
  await run();
  return Number((await query(database, 'SELECT COUNT(*) AS n FROM installment_plan_revisions'))[0]?.n) - Number(before);
}

// ---------------------------------------------------------------------------------------------------------------
// D. Financial invariants: exact money after every step; history only adds revision rows

export async function runPhase1A4AInvariants(database: Database) {
  await seed(database);
  const steps: Row = {};
  const record = async (label: string, when: string, bank: string, debt: string, expense: string) => {
    const observation = await observe(database, when);
    expectMoney(observation, bank, debt, expense);
    check(observation.allocations.length === 0, 'No allocation is ever created');
    check(observation.installmentPurchases.every(plan => plan.paid_installments === 0), 'paid_installments untouched');
    steps[label] = observation;
  };
  const first = await purchase(database, '2026-10-11', 300000, 3, 'Exacta');
  await record('createExact', '2026-10-11', '1000000', '300000', '300000');
  const cents = await purchase(database, '2026-10-11', 1234.57, 6, 'Centavos');
  await record('createCents', '2026-10-11', '1000000', '301234.57', '301234.57');
  await edit(database, first.id, '2026-10-12', { installmentCountInput: '3', merchantName: 'Renombrada' });
  await record('rename', '2026-10-12', '1000000', '301234.57', '301234.57');
  await edit(database, first.id, '2026-10-12', { installmentCountInput: '6', merchantName: 'Renombrada' });
  await record('threeToSix', '2026-10-12', '1000000', '301234.57', '301234.57');
  const payment = await pay(database, '2026-10-13', 100000);
  await record('payment', '2026-10-13', '900000', '201234.57', '301234.57');
  await edit(database, cents.id, '2026-10-14', { installmentCountInput: '1' });
  await record('centsToSingle', '2026-10-14', '900000', '201234.57', '301234.57');
  await edit(database, cents.id, '2026-10-15', { installmentCountInput: '2' });
  await record('centsRecreated', '2026-10-15', '900000', '201234.57', '301234.57');
  await deleteMovement(database, payment.id, '2026-10-16');
  await record('deletePayment', '2026-10-16', '1000000', '301234.57', '301234.57');
  await deleteMovement(database, first.id, '2026-10-17');
  await record('deleteExact', '2026-10-17', '1000000', '1234.57', '1234.57');
  return canonical(steps);
}

// ---------------------------------------------------------------------------------------------------------------
// E. Atomicity of the new write: every write of a creation and of a recreation, before and after

export type Phase1A4AFaults = {
  countWrites: Phase1A4AWriteCounter;
  arm: (write: number, phase: 'before' | 'after') => { fired: () => boolean; isInjected: (error: unknown) => boolean };
  disarm: () => void;
};

async function prepareMatrix(database: Database, name: Phase1A4AMatrix) {
  await seed(database);
  if (name === 'creation') {
    const params = await newPurchaseParams(database, '2026-10-11', 300000, 3);
    return { date: '2026-10-11', params, run: () => withPhase1A2Clock(bogotaNoon('2026-10-11'), () => saveManualTransaction(params)) };
  }
  const original = await purchase(database, '2026-10-11', 300000, 3);
  await edit(database, original.id, '2026-10-12', { installmentCountInput: '1' });
  const params = await editParams(database, original.id, '2026-10-13', { installmentCountInput: '4' });
  return { date: '2026-10-13', params, run: () => withPhase1A2Clock(bogotaNoon('2026-10-13'), () => saveManualTransaction(params)) };
}

/**
 * Write count of a successful run (compared with Node), then every write before/after: the injected error propagates,
 * rollback is confirmed (not unknown), the connection stays usable, a new owner confirms a transaction and every
 * table, rowid, schema object, revision row, backup counter and dashboard figure equals the state before.
 */
export async function runPhase1A4AMatrix(database: Database, name: Phase1A4AMatrix, faults: Phase1A4AFaults,
  record: (label: string, operation: () => Promise<unknown>) => Promise<unknown>) {
  let writes = 0;
  await record(`${name}-success`, async () => {
    const { date, run } = await prepareMatrix(database, name);
    const before = await observe(database, date);
    writes = await faults.countWrites(run);
    const after = await observe(database, date);
    const plan = after.installmentPurchases[0];
    check(plan && after.installmentPurchases.length === 1, 'One plan');
    const current = after.revisions.filter(row => row.installment_purchase_id === plan.id);
    check(current.length === before.revisions.length + 1 && current[current.length - 1]!.source === 'original', 'Revision 0 committed with the plan');
    check(writes > 0, 'Write instrumentation missing');
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
      check(json(after) === json(before), 'Rollback changed tables, rowids, revisions, counter or figures');
      return { write, phase, status: 'rolledBack', exactStateRestored: true, nextOwnerConfirmed: true };
    });
  }
  return writes;
}

// ---------------------------------------------------------------------------------------------------------------
// F. Unknown outcome of the creation and restart

/** Lost COMMIT response on a new plan: `unknown`, the same request is never executed again, the connection retires. */
export async function runPhase1A4AUnknown(database: Database, loseCommit: (lost: boolean) => void) {
  const { run } = await prepareMatrix(database, 'creation');
  await database.executeSql(`CREATE TABLE ${MARKER} (scenario TEXT NOT NULL)`);
  await database.executeSql(`INSERT INTO ${MARKER} VALUES ('creation-unknown')`);
  loseCommit(true);
  let failure: unknown;
  try { await run(); } catch (error) { failure = error; } finally { loseCommit(false); }
  check(failure instanceof SQLiteCommandFailure && failure.result.status === 'unknown', 'COMMIT must stay unknown');
  let second: unknown;
  // Same request object: the production guard (WeakMap) must hand back the same outcome instead of re-executing.
  try { await run(); } catch (error) { second = error; }
  check(second === failure, 'Unknown request was retried');
  let retired = false;
  try { await dependencies(database).accountRepository.getAccounts(); } catch { retired = true; }
  check(retired, 'Unknown connection not retired');
  return { status: 'unknown', sameFailure: true, connectionRetired: true };
}

/** After reopening: the purchase committed exactly once with exactly one revision 0, money exact, integrity ok. */
export async function checkPhase1A4AAfterRestart(database: Database) {
  const [marker] = await query(database, `SELECT * FROM ${MARKER}`);
  check(marker?.scenario === 'creation-unknown', 'Restart marker missing');
  const after = await observe(database, '2026-10-11');
  check(after.transactions.length === 1 && after.installmentPurchases.length === 1, 'Purchase duplicated or missing');
  const revision = expectOneOriginal(after, String(after.installmentPurchases[0]!.id));
  check(revision.verification === 'projected' && revision.effective_cycle_end === '2026-10-20', 'Revision 0 content after restart');
  expectMoney(after, '1000000', '300000', '300000');
  check(json(await plansWithoutHistory(database)) === json([]), 'Committed plan without revision 0');
  return canonical({ marker, after });
}

