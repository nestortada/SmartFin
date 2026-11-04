// Derived for 1a.4B by scripts/phase1a4b/derive-probes.cjs (D6 guard outcome; version 4 flows incompatible).
// DERIVED by scripts/phase1a4a/derive-probes.cjs from scripts/phase1a3b/probes.ts (sha256 6182dd9859a2c9be39157963cf1eec0768feb8298c35c34afc6cdd51264ca35b).
// Only the integrity preparation and the purchaseRecreation scenario differ (revision 0 now comes from the use case).
// Do not edit by hand.
// Phase 1a.3B probes: migration 5 (installment allocations, plan revisions, billing metadata) on the real SQLite
// driver. The same synthetic scenarios run in Node (node:sqlite, __tests__/phase1a3bAndroidEquivalence.test.ts) and in
// the isolated Android APK (com.smartfin.snapshot5b2.tests), through the unchanged production migration, use cases
// and repositories. Every use case runs with the JS clock pinned. A "version 4" database is produced in place by
// dropping exactly the migration 5 objects, as on an installation that still runs the previous schema.
import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import { runSharedSQLiteTransaction } from '../../src/database/atomicSQLite';
import { applyVersionedMigrations } from '../../src/database/migrations';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteInstallmentHistoryRepository } from '../../src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository';
import { createSqliteFinancialDataRepository } from '../../src/modules/settings/repositories/sqliteFinancialDataRepository';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import {
  deleteManualTransactionSafely,
  saveManualTransaction,
  type SaveManualTransactionParams,
} from '../../src/modules/transactions/useCases/saveManualTransaction';
import { registerCreditCardPayment } from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { serializeCreditCardVisualMetadata } from '../../src/modules/creditCards/useCases/manageCreditCards';
import { selectEffectivePlanRevision } from '../../src/modules/creditCards/useCases/installmentPlanRevisions';
import { parseCivilDate } from '../../src/modules/creditCards/useCases/installmentPlan';
import { INSTALLMENT_HISTORY_TABLE_NAMES } from '../../src/modules/creditCards/database/installmentHistorySchema';
import type { Transaction } from '../../src/modules/transactions/types/Transaction';
import { centsText, resetSyntheticData, textCents } from '../phase6b/probes';
import { bogotaNoon, withPhase1A2Clock } from '../phase1a2/probes';

export const PHASE1A3B_INTEGRITY_PROBES = [
  'constraints', 'revisionSequence', 'allocations', 'commandIdempotency', 'activeAllocationGuards',
  'purchaseEditAndRemoval', 'purchaseRecreation', 'billingMetadata', 'repositoryScope', 'financialWipe',
] as const;
export type Phase1A3BIntegrityProbe = (typeof PHASE1A3B_INTEGRITY_PROBES)[number];

/** The 15 migration statements of the Node atomicity suite; each fails before and after it runs (30 points). */
export const PHASE1A3B_MIGRATION_FAULTS = [
  'CREATE TABLE IF NOT EXISTS installment_allocations',
  'CREATE TABLE IF NOT EXISTS installment_plan_revisions',
  'CREATE TABLE IF NOT EXISTS credit_card_billing_rules',
  'CREATE TABLE IF NOT EXISTS installment_first_cycles',
  'CREATE INDEX IF NOT EXISTS idx_installment_allocations_purchase',
  'CREATE INDEX IF NOT EXISTS idx_installment_allocations_payment',
  'CREATE TRIGGER IF NOT EXISTS installment_allocations_validate_insert',
  'CREATE TRIGGER IF NOT EXISTS installment_plan_revisions_no_update',
  'FROM installment_purchases p',
  'INSERT INTO installment_plan_revisions',
  'CREATE TRIGGER IF NOT EXISTS installment_allocations_guard_payment_delete',
  'CREATE TRIGGER IF NOT EXISTS installment_plan_revisions_purchase_removal',
  'CREATE TRIGGER IF NOT EXISTS backup_revision_installment_allocations_insert',
  'CREATE TRIGGER IF NOT EXISTS backup_revision_installment_first_cycles_delete',
  'INSERT INTO schema_migrations VALUES (5',
] as const;

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
const NEW_TABLES: readonly string[] = INSTALLMENT_HISTORY_TABLE_NAMES;
const MARKER = 'synthetic_phase1a3b_marker';

/**
 * Error classes compared between engines. Messages differ textually between SQLite 3.9.2 and 3.53 ("CHECK constraint
 * failed: <table>" vs "...: <expression>"); the class and our own RAISE texts do not. ASCII fragments only.
 */
const RAISES = ['debe estar activa', 'imputada no existe', 'no corresponde a la tarjeta', 'otro pago', 'activa a revertida',
  'fuera de secuencia', 'cuotas de la revisi', 'admite una revisi', 'reiniciarse con una revisi', 'solo inserci',
  'antes de eliminarlo', 'antes de modificarlo', 'antes de eliminarla', 'cambiar de identificador'];
function errorClass(error: unknown): string {
  if (error === undefined) return 'accepted';
  const text = errorText(error);
  const raise = RAISES.find(fragment => text.includes(fragment));
  if (raise) return 'raise:' + raise;
  if (/CHECK constraint/i.test(text)) return 'check';
  if (/UNIQUE constraint|PRIMARY KEY/i.test(text)) return 'unique';
  if (/FOREIGN KEY/i.test(text)) return 'foreignKey';
  if (/NOT NULL constraint/i.test(text)) return 'notNull';
  return 'other: ' + text;
}
async function attempt(operation: () => Promise<unknown>): Promise<string> {
  try { await operation(); return 'accepted'; } catch (error) { return errorClass(error); }
}

const dependencies = (database: Database) => ({
  accountRepository: createSqliteAccountRepository(database),
  transactionRepository: createSqliteTransactionRepository(database),
  creditCardRepository: createSqliteCreditCardRepository(database),
});

// ---------------------------------------------------------------------------------------------------------------
// Schema states

async function migrationVersions(database: Database) {
  return (await query(database, 'SELECT version FROM schema_migrations ORDER BY version')).map(row => Number(row.version));
}
/**
 * Every schema object; the SQL text only for the migration 5 objects, which SmartFin writes verbatim. android_metadata
 * is created by the Android framework, not by SmartFin (r1 on API 24 listed it: one extra row, no data difference).
 */
async function schemaObjects(database: Database) {
  const rows = await query(database, `SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'synthetic_%' AND name <> 'android_metadata' ORDER BY type, name`);
  return rows.map(row => {
    const sql = String(row.sql ?? '');
    const migration5 = NEW_TABLES.includes(String(row.tbl_name)) || NEW_TABLES.some(table => sql.includes(table));
    return migration5 ? [row.type, row.name, row.tbl_name, sql] : [row.type, row.name, row.tbl_name];
  });
}
async function migration5Objects(database: Database) {
  return (await schemaObjects(database)).filter(row => row.length === 4).map(row => row[1]);
}

/** Drops exactly the migration 5 objects and its version row: the synthetic database is then at schema version 4. */
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
  check(json(await migrationVersions(database)) === json([1, 2, 3, 4]), 'Version 4 expected');
  check((await migration5Objects(database)).length === 0, 'Migration 5 objects left');
}

// ---------------------------------------------------------------------------------------------------------------
// Synthetic financial data

/** Bank 1.000.000, Visa closing on day 20 with a 2.000.000 limit, revision counter at 0, no synthetic tables. */
async function seedAccounts(database: Database) {
  await database.executeSql(`DROP TABLE IF EXISTS ${MARKER}`);
  await resetSyntheticData(database);
  // resetSyntheticData also empties financial_data_revision; without its row the triggers count nothing.
  await database.executeSql("INSERT INTO financial_data_revision (id, revision, updated_at) VALUES (1, 0, '2026-01-01')");
  await database.executeSql(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,credit_limit_amount,
    description,created_at,updated_at) VALUES
    ('bank','Banco','bankAccount','active','COP',1000000,NULL,NULL,NULL,'2026-01-01','2026-01-01'),
    ('card','Visa','creditCard','active','COP',0,0,2000000,?,'2026-01-01','2026-01-01')`,
  [serializeCreditCardVisualMetadata({ closingDay: 20, paymentDay: 5 })]);
}

function purchaseParams(database: Database, accounts: Awaited<ReturnType<ReturnType<typeof dependencies>['accountRepository']['getAccounts']>>,
  date: string, amount: number, installments: number, extra: Partial<SaveManualTransactionParams> = {}): SaveManualTransactionParams {
  return {
    ...dependencies(database), accounts, accountId: 'card', amount, merchantName: 'Sintetico 1a.3B',
    operationType: 'Crédito', transactionType: 'expense', hasInterestFreeInstallments: false,
    installmentCountInput: String(installments), interestFreeInstallmentCountInput: '', occurrence: { kind: 'date', date },
    currentDate: bogotaNoon(date), now: bogotaNoon(date), ...extra,
  };
}
const accountsAt = (database: Database, date: string) =>
  withPhase1A2Clock(bogotaNoon(date), () => dependencies(database).accountRepository.getAccounts());
async function purchase(database: Database, date: string, amount: number, installments: number, merchantName = 'Sintetico 1a.3B') {
  const accounts = await accountsAt(database, date);
  return withPhase1A2Clock(bogotaNoon(date), async () =>
    (await saveManualTransaction(purchaseParams(database, accounts, date, amount, installments, { merchantName }))).transaction);
}
async function currentTransaction(database: Database, id: string): Promise<Transaction> {
  const transaction = (await dependencies(database).transactionRepository.getTransactions()).find(row => row.id === id);
  check(transaction, 'Movement missing: ' + id);
  return transaction;
}
/** Edit of the purchase on `when`, keeping its civil date and amount. */
async function editPurchase(database: Database, id: string, when: string, installments: number, merchantName = 'Sintetico editada') {
  const original = await currentTransaction(database, id);
  const accounts = await accountsAt(database, when);
  const params = purchaseParams(database, accounts, original.civilDate ?? original.date.slice(0, 10), original.amount, installments,
    { editingTransaction: original, merchantName, currentDate: bogotaNoon(when), now: bogotaNoon(when) });
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

/** Purchases saved by the production use cases, a card payment and legacy rows the use cases no longer produce. */
async function seedHistory(database: Database) {
  await seedAccounts(database);
  const exact = await purchase(database, '2026-10-11', 300000, 3, 'Exacta');
  await purchase(database, '2026-10-11', 1234.56, 6, 'Centavos');
  await purchase(database, '2026-10-11', 50000, 1, 'Una cuota');
  const payment = await pay(database, '2026-10-13', 100000);
  // Their movement exists; balances are not recomputed (legacy rows are only read by the migration).
  const legacy = [
    ['legacy-inexact', 0.1 + 0.2, 3, 1, 0.1, 'active'],
    ['legacy-zero-count', 90000, 0, 0, 90000, 'cancelled'],
    ['legacy-long', 1200000, 400, 400, 3000, 'paid'],
    ['legacy-huge', 2 ** 47, 2, 0, 2 ** 46, 'active'],
  ] as const;
  for (const [id, total, count, paid, monthly, status] of legacy)
    await database.executeSql(`INSERT INTO installment_purchases (id, transaction_id, account_id, merchant_name, total_amount,
      currency, installment_count, paid_installments, monthly_amount, first_due_date, status, created_at, updated_at)
      VALUES (?, ?, 'card', 'Legado', ?, 'COP', ?, ?, ?, NULL, ?, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
    [id, exact.id, total, count, paid, monthly, status]);
  return { exactId: exact.id, paymentId: payment.id };
}

// ---------------------------------------------------------------------------------------------------------------
// Observation

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Rows written with SQLite's own clock (migration revision 0 and trigger revisions): host time, never compared. */
function sqlClockRevision(row: Row): Row {
  const sqlClock = (row.source === 'original' && row.revision_number === 0) || row.source === 'purchaseEdit' || row.source === 'purchaseRemoval';
  if (!sqlClock) return row;
  check(typeof row.created_at === 'string' && ISO_INSTANT.test(row.created_at), 'SQLite clock format');
  return { ...row, created_at: '<sqlite-clock>' };
}
async function history(database: Database) {
  const present = new Set((await query(database, "SELECT name FROM sqlite_master WHERE type = 'table'")).map(row => String(row.name)));
  if (!NEW_TABLES.every(table => present.has(table))) return null;
  return {
    // Ordered by the purchase's rowid, not by id: ids embed a per-process sequence that differs between runtimes.
    revisions: (await query(database, `SELECT r.* FROM installment_plan_revisions r
      LEFT JOIN installment_purchases p ON p.id = r.installment_purchase_id
      ORDER BY p.rowid IS NULL, p.rowid, r.installment_purchase_id, r.revision_number`)).map(sqlClockRevision),
    allocations: await query(database, 'SELECT * FROM installment_allocations ORDER BY id'),
    billingRules: await query(database, 'SELECT rowid AS row_id, * FROM credit_card_billing_rules ORDER BY account_id'),
    firstCycles: await query(database, 'SELECT rowid AS row_id, * FROM installment_first_cycles ORDER BY installment_purchase_id'),
  };
}
const revisionCounter = async (database: Database) =>
  Number((await query(database, 'SELECT revision FROM financial_data_revision WHERE id = 1'))[0]?.revision);

/**
 * Financial observation compared field by field with Node: accounts and available credit (BigInt cents), dashboard
 * figures, movements, plans and statements with rowid, profiles, backup counter and SQLite integrity.
 */
async function financial(database: Database, date: string) {
  const accounts = await query(database, `SELECT rowid AS row_id, id, balance_amount, debt_balance_amount, credit_limit_amount,
    created_at, updated_at FROM accounts ORDER BY id`);
  const card = accounts.find(account => account.id === 'card');
  const summary = await getDashboardSummaryFromDb(database, bogotaNoon(date));
  const integrityRows = await query(database, 'PRAGMA integrity_check');
  const foreignKeys = await query(database, 'PRAGMA foreign_key_check');
  check(integrityRows[0]?.integrity_check === 'ok' && foreignKeys.length === 0, 'SQLite integrity / foreign keys');
  return {
    accounts,
    availableCredit: card ? centsText(textCents(String(card.credit_limit_amount)) - textCents(String(card.debt_balance_amount))) : null,
    summary: { availableBalance: summary.availableBalance, totalDebt: summary.totalDebt, netWorth: summary.netWorth,
      monthlyIncome: summary.monthlyIncome, monthlyExpenses: summary.monthlyExpenses, monthlySavings: summary.monthlySavings },
    transactions: await query(database, 'SELECT rowid AS row_id, * FROM transactions ORDER BY created_at, rowid'),
    installmentPurchases: await query(database, 'SELECT rowid AS row_id, * FROM installment_purchases ORDER BY rowid'),
    statements: await query(database, 'SELECT rowid AS row_id, * FROM credit_card_statements ORDER BY statement_start_date, rowid'),
    profiles: await query(database, 'SELECT rowid AS row_id, * FROM credit_card_profiles ORDER BY rowid'),
    backupRevision: await revisionCounter(database),
    integrity: { integrityCheck: 'ok', foreignKeyViolations: 0 },
  };
}
async function observe(database: Database, date: string) {
  return { financial: await financial(database, date), history: await history(database), versions: await migrationVersions(database) };
}

/** Every table with rowids (synthetic marker excluded) and the full schema: the exact rollback oracle. */
async function fullState(database: Database) {
  const tables: Record<string, Row[]> = {};
  for (const { name } of await query(database, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE 'synthetic_%' AND name <> 'android_metadata' ORDER BY name`)) {
    check(typeof name === 'string' && /^[a-z0-9_]+$/.test(name), 'Unexpected table name');
    tables[name] = await query(database, `SELECT rowid AS row_id, * FROM ${name} ORDER BY rowid`);
  }
  const all = await query(database, `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'synthetic_%'
    AND name <> 'android_metadata' ORDER BY type, name`);
  return { tables, schema: all, integrity: await query(database, 'PRAGMA integrity_check'), foreignKeys: await query(database, 'PRAGMA foreign_key_check') };
}

/** Trigger revisions read through the repository also carry SQLite's clock. */
function sqliteClock(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sqliteClock);
  if (!value || typeof value !== 'object') return value;
  const row = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sqliteClock(item)])) as Row;
  if ((row.source === 'purchaseEdit' || row.source === 'purchaseRemoval') && typeof row.createdAt === 'string') {
    check(ISO_INSTANT.test(row.createdAt), 'SQLite clock format');
    return { ...row, createdAt: '<sqlite-clock>' };
  }
  return row;
}

/**
 * Movement ids embed the pinned clock and a per-process sequence: renamed M1.. (manual) and P1.. (payments) in order
 * of first appearance, everywhere they are referenced (purchase, revision and allocation ids included).
 */
function canonical<T>(value: T): T {
  const text = json(sqliteClock(value));
  const ids = [...new Set(text.match(/tx_manual_\d+(?:_\d+)?|tx-credit-card-payment-card-\d+-\d+/g) ?? [])];
  let manual = 0;
  let payment = 0;
  const labels = new Map(ids.map(id => [id, id.startsWith('tx_manual_') ? `M${++manual}` : `P${++payment}`] as const));
  const ordered = [...labels.entries()].sort((a, b) => b[0].length - a[0].length);
  return JSON.parse(ordered.reduce((current, [id, label]) => current.split(id).join(label), text)) as T;
}

function withoutHistory(observation: Awaited<ReturnType<typeof observe>>) {
  return json(observation.financial);
}

function expectOriginalRevisions(observation: Awaited<ReturnType<typeof observe>>) {
  const revisions = observation.history?.revisions ?? [];
  const purchases = observation.financial.installmentPurchases;
  check(revisions.length === purchases.length, 'One revision 0 per purchase');
  for (const plan of purchases) {
    const revision = revisions.find(row => row.installment_purchase_id === plan.id);
    check(revision && revision.revision_number === 0 && revision.source === 'original' && revision.verification === 'pendingVerification' &&
      revision.effective_cycle_end === null && revision.id === `${String(plan.id)}:revision:0` &&
      revision.basis_total_amount === plan.total_amount && revision.basis_installment_count === plan.installment_count,
    'Revision 0 of ' + String(plan.id));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A. Upgrade in process

/** Version 4 database with history, then the production migration: only the four new tables and version 5 change. */
export async function runPhase1A3BUpgrade(database: Database) {
  await seedHistory(database);
  await downgradeToVersion4(database);
  const before = await observe(database, '2026-10-14');
  const stateBefore = await fullState(database);
  check(before.history === null, 'Version 4 has no history tables');
  await applyVersionedMigrations(database);
  const after = await observe(database, '2026-10-14');
  check(json(after.versions) === json([1, 2, 3, 4, 5]), 'Version 5 recorded');
  check(withoutHistory(after) === withoutHistory(before), 'Migration changed financial data');
  check(after.financial.backupRevision === before.financial.backupRevision, 'Backup counter changed');
  expectOriginalRevisions(after);
  check(after.history!.allocations.length === 0 && after.history!.billingRules.length === 0 && after.history!.firstCycles.length === 0,
    'Only revisions are created');
  // Existing tables (rows and rowids) untouched; schema = version 4 objects plus the migration 5 objects.
  const stateAfter = await fullState(database);
  for (const [name, rows] of Object.entries(stateBefore.tables))
    if (name !== 'schema_migrations') check(json(stateAfter.tables[name]) === json(rows), 'Existing table changed: ' + name);
  const migration5 = await migration5Objects(database);
  check(NEW_TABLES.every(table => migration5.includes(table)), 'Four new tables');
  const repeated = await runRepeatedMigration(database);
  return canonical({ before, after, migration5Objects: migration5, schema: await schemaObjects(database), repeated });
}

/** A second and third run write nothing and change nothing (version 5 already recorded). */
async function runRepeatedMigration(database: Database) {
  const state = json(await fullState(database));
  const appliedAt = await query(database, 'SELECT version, applied_at FROM schema_migrations ORDER BY version');
  await applyVersionedMigrations(database);
  await applyVersionedMigrations(database);
  check(json(await fullState(database)) === state, 'Repeated migration changed the database');
  check(json(await query(database, 'SELECT version, applied_at FROM schema_migrations ORDER BY version')) === json(appliedAt), 'Version rows rewritten');
  return { unchanged: true, runs: 2 };
}

// ---------------------------------------------------------------------------------------------------------------
// B. Upgrade at application start, across process restarts

/** Leaves a version 4 database with history for the next process; stores the expected financial state. */
export async function seedPhase1A3BStartupUpgrade(database: Database) {
  await seedHistory(database);
  await downgradeToVersion4(database);
  const before = await observe(database, '2026-10-14');
  await database.executeSql(`CREATE TABLE ${MARKER} (step TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL)`);
  await database.executeSql(`INSERT INTO ${MARKER} VALUES ('version4', ?)`, [json(before)]);
  return canonical({ before, schemaVersion4: await schemaObjects(database) });
}

async function marker(database: Database, step: string) {
  const [row] = await query(database, `SELECT payload FROM ${MARKER} WHERE step = ?`, [step]);
  check(row && typeof row.payload === 'string', 'Restart marker missing: ' + step);
  return JSON.parse(row.payload) as Awaited<ReturnType<typeof observe>>;
}

/** First open in a new process ran the migration at start-up (openSmartFinDatabase on the APK). */
export async function checkPhase1A3BStartupUpgrade(database: Database) {
  const before = await marker(database, 'version4');
  const after = await observe(database, '2026-10-14');
  check(json(after.versions) === json([1, 2, 3, 4, 5]), 'Start-up did not migrate to version 5');
  check(withoutHistory(after) === json(before.financial), 'Start-up migration changed financial data');
  expectOriginalRevisions(after);
  const appliedAt = await query(database, 'SELECT version, applied_at FROM schema_migrations ORDER BY version');
  const rawRevisions = await query(database, 'SELECT id, created_at FROM installment_plan_revisions ORDER BY id');
  await database.executeSql(`INSERT INTO ${MARKER} VALUES ('version5', ?)`, [json({ appliedAt, rawRevisions, state: await fullState(database) })]);
  return canonical({ after, schema: await schemaObjects(database) });
}

/** Second restart: no migration repeated, no duplicate revision, exactly the same state (SQLite clock values included). */
export async function checkPhase1A3BAfterRestart(database: Database) {
  const [row] = await query(database, `SELECT payload FROM ${MARKER} WHERE step = 'version5'`);
  check(row && typeof row.payload === 'string', 'Version 5 marker missing');
  const recorded = JSON.parse(row.payload) as { appliedAt: Row[]; rawRevisions: Row[]; state: unknown };
  check(json(await query(database, 'SELECT version, applied_at FROM schema_migrations ORDER BY version')) === json(recorded.appliedAt),
    'Migration repeated after restart');
  check(json(await query(database, 'SELECT id, created_at FROM installment_plan_revisions ORDER BY id')) === json(recorded.rawRevisions),
    'Revisions duplicated or rewritten after restart');
  check(json(await fullState(database)) === json(recorded.state), 'State changed after restart');
  const after = await observe(database, '2026-10-14');
  return canonical({ after, migrationRepeated: false, duplicateRevisions: 0, stateIdentical: true });
}

// ---------------------------------------------------------------------------------------------------------------
// C. Migration atomicity

/**
 * Fails one migration statement through the callback transaction the migration runs in: before it (the statement is
 * replaced) or after it (it ran). Either way the next statement is a missing-table SELECT, the same abort the
 * production runner issues, so the driver rolls the whole migration back. Nothing in production code is changed.
 */
export function migrationFault(database: Database, target: string, phase: 'before' | 'after') {
  let fired = false;
  const abort = 'SELECT * FROM smartfin_phase1a3b_fault_missing_table';
  type CallbackTransaction = { executeSql: (sql: string, values?: unknown[], success?: (tx: unknown, result: unknown) => void,
    failure?: (tx: unknown, error: unknown) => unknown) => void };
  const wrapped = {
    executeSql: (sql: string, values?: (string | number | null)[]) => database.executeSql(sql, values),
    transaction: (operation: (tx: CallbackTransaction) => void) => (database.transaction as unknown as (
      callback: (tx: CallbackTransaction) => void) => Promise<unknown>)(tx => {
      const guarded: CallbackTransaction = {
        executeSql: (sql, values, success, failure) => {
          if (fired || !sql.includes(target)) return tx.executeSql(sql, values, success, failure);
          fired = true;
          if (phase === 'before') return tx.executeSql(abort, []);
          return tx.executeSql(sql, values, () => tx.executeSql(abort, []), failure);
        },
      };
      operation(guarded);
    }),
  } as unknown as Database;
  return { database: wrapped, fired: () => fired };
}

export async function runPhase1A3BMigrationFault(database: Database, target: string, phase: 'before' | 'after') {
  await seedHistory(database);
  await downgradeToVersion4(database);
  const before = await fullState(database);
  const fault = migrationFault(database, target, phase);
  let failure: unknown;
  try { await applyVersionedMigrations(fault.database); } catch (error) { failure = error; }
  check(fault.fired(), 'The faulted statement was not reached: ' + target);
  check(failure !== undefined, 'The migration did not fail');
  check(/smartfin_phase1a3b_fault_missing_table|no such table/i.test(errorText(failure)), 'Unexpected error: ' + errorText(failure));
  let after;
  try { after = await fullState(database); } catch (error) { throw Error('Connection retired: ' + errorText(error)); }
  check(json(after) === json(before), 'Rollback left DDL or data changes');
  check(json(await migrationVersions(database)) === json([1, 2, 3, 4]), 'Version 5 recorded by a failed migration');
  check((await migration5Objects(database)).length === 0, 'Partial migration 5 objects');
  const nextOwner = (await runSharedSQLiteTransaction(database, async () => 'closed')).status;
  check(nextOwner === 'confirmed', 'Transaction left open: ' + nextOwner);
  // Next start: the same migration completes.
  await applyVersionedMigrations(database);
  const recovered = await observe(database, '2026-10-14');
  check(json(recovered.versions) === json([1, 2, 3, 4, 5]), 'Recovery did not record version 5');
  expectOriginalRevisions(recovered);
  return canonical({ target, phase, rolledBack: true, exactVersion4Restored: true, nextOwnerConfirmed: true,
    recovered: { revisions: recovered.history!.revisions, schema: await schemaObjects(database) } });
}

// ---------------------------------------------------------------------------------------------------------------
// D. Integrity on the current (version 5) schema

const ALLOCATION_INSERT = `INSERT INTO installment_allocations (id, payment_transaction_id, installment_purchase_id, amount_cents,
  mode, status, command_id, created_at, reversed_at) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10-14T17:00:00.000Z', ?)`;
const REVISION_INSERT = `INSERT INTO installment_plan_revisions (id, installment_purchase_id, revision_number, source, allocation_id,
  remaining_principal_cents, remaining_installments, installment_amount_cents, effective_cycle_end, verification, pending_reasons,
  basis_total_amount, basis_monthly_amount, basis_installment_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function prepareIntegrity(database: Database) {
  const versions = await migrationVersions(database);
  check(json(versions) === json([1, 2, 3, 4, 5]), 'Integrity probes need version 5');
  await seedAccounts(database);
  const exact = await purchase(database, '2026-10-11', 300000, 3, 'Exacta');
  const second = await purchase(database, '2026-10-11', 600000, 6, 'Segunda');
  const payment = await pay(database, '2026-10-13', 100000);
  const purchaseId = `installment-${exact.id}`;
  const secondPurchaseId = `installment-${second.id}`;
  // 1a.4A: the use case created revision 0 with each purchase (Visa closes on the 20th: projected, first cycle 2026-10-20).
  const repository = createSqliteInstallmentHistoryRepository(database);
  for (const [id, count] of [[purchaseId, 3], [secondPurchaseId, 6]] as const) {
    const plan = await repository.getPlanRevisions(id);
    check(plan.length === 1 && plan[0]!.revisionNumber === 0 && plan[0]!.source === 'original' &&
      plan[0]!.verification === 'projected' && plan[0]!.effectiveCycleEnd === '2026-10-20' &&
      plan[0]!.remainingPrincipalCents === count * 10000000 && plan[0]!.remainingInstallments === count &&
      plan[0]!.installmentAmountCents === 10000000 && plan[0]!.createdAt === at('2026-10-11'), 'Revision 0 created with ' + id);
  }
  return { exactId: exact.id, purchaseId, secondPurchaseId, paymentId: payment.id, repository };
}

export async function runPhase1A3BIntegrityProbe(database: Database, name: Phase1A3BIntegrityProbe) {
  const context = await prepareIntegrity(database);
  const { engineObserved, ...result } = (await integrity(database, name, context)) as Row;
  return canonical({ result, observation: await observe(database, '2026-10-14'),
    ...(engineObserved !== undefined ? { engineObserved } : {}) });
}

/**
 * r3: the only engine-dependent case accepted. Numeric text '100' bound to amount_cents is safe if it is either rejected
 * by a constraint (no row) or stored as exactly the INTEGER 100. Anything else (text kept, a real, another value, a row
 * left behind by a rejection, an unexpected error) fails. Observed in r2: SQLite 3.53 accepts, SQLite 3.9.2 rejects.
 */
export type NumericTextInsert = { errorClass: string; rows: { type: unknown; value: unknown }[] };
export function classifyNumericTextInsert(insert: NumericTextInsert): 'rejected' | 'acceptedExactInteger' {
  if (insert.errorClass !== 'accepted') {
    check(insert.errorClass === 'check' && insert.rows.length === 0, 'Unsafe numeric text rejection: ' + json(insert));
    return 'rejected';
  }
  check(insert.rows.length === 1 && insert.rows[0]!.type === 'integer' && insert.rows[0]!.value === 100,
    'Unsafe numeric text storage: ' + json(insert));
  return 'acceptedExactInteger';
}

/** Runs inside a shared scope that is always rolled back, so both outcomes leave the same database (and counter). */
async function numericTextAmount(database: Database, paymentId: string, purchaseId: string) {
  const rollback = Error('numeric text probe rollback');
  let insert: NumericTextInsert | undefined;
  const result = await runSharedSQLiteTransaction(database, async participant => {
    const outcome = await attempt(() => participant.executeSql(ALLOCATION_INSERT,
      ['amount-numeric-text', paymentId, purchaseId, '100', 'unspecified', 'active', 'numeric-text', null]));
    const rows = (await query(participant, "SELECT typeof(amount_cents) AS type, amount_cents AS value FROM installment_allocations WHERE id = 'amount-numeric-text'"));
    insert = { errorClass: outcome, rows: rows.map(row => ({ type: row.type, value: row.value })) };
    throw rollback;
  });
  check(result.status === 'rolledBack' && result.error === rollback && insert, 'Numeric text probe not rolled back');
  const left = await query(database, "SELECT count(*) AS total FROM installment_allocations WHERE id = 'amount-numeric-text'");
  check(Number(left[0]?.total) === 0, 'Numeric text row left behind');
  const observed = classifyNumericTextInsert(insert);
  return { safe: true, observed: { outcome: observed, ...insert } };
}

/**
 * Where the difference comes from, demonstrated on synthetic tables with the same binding path (writes bind JS strings as
 * TEXT on both drivers) and with an SQL literal (no binding at all): storage affinity alone, a CHECK that requires an
 * integer, and a CHECK that requires text. If the last one accepts, that engine evaluates CHECK before affinity.
 */
async function affinityEvidence(database: Database) {
  const tables = {
    synthetic_affinity_plain: 'x INTEGER',
    synthetic_affinity_check_integer: "x INTEGER CHECK(typeof(x) = 'integer')",
    synthetic_affinity_check_text: "x INTEGER CHECK(typeof(x) = 'text')",
  };
  const evidence: Record<string, unknown> = {};
  for (const [table, column] of Object.entries(tables)) {
    await database.executeSql(`DROP TABLE IF EXISTS ${table}`);
    await database.executeSql(`CREATE TABLE ${table} (${column})`);
    const bound = await attempt(() => database.executeSql(`INSERT INTO ${table} (x) VALUES (?)`, ['100']));
    const literal = await attempt(() => database.executeSql(`INSERT INTO ${table} (x) VALUES ('100')`));
    evidence[table] = { bound, literal, stored: await query(database, `SELECT typeof(x) AS type, x FROM ${table}`) };
    await database.executeSql(`DROP TABLE ${table}`);
  }
  const [version] = await query(database, 'SELECT sqlite_version() AS version');
  return { sqliteVersion: version?.version, ...evidence };
}

/**
 * After r3: one attempt in a shared scope that is always rolled back. It starts from the current (known) state, records
 * the outcome class and leaves every table, the backup counter and the revision numbering exactly as before, so an
 * unexpected acceptance shows up as 'accepted' in its own case and cannot mask the following ones.
 */
async function isolated(database: Database, run: (participant: Database) => Promise<unknown>): Promise<string> {
  const before = json(await fullState(database));
  const rollback = Error('isolated attempt rollback');
  let outcome = 'unset';
  const result = await runSharedSQLiteTransaction(database, async participant => {
    outcome = await attempt(() => run(participant));
    throw rollback;
  });
  check(result.status === 'rolledBack' && result.error === rollback, 'Isolated attempt not rolled back: ' + result.status);
  check(json(await fullState(database)) === before, 'Isolated attempt left changes');
  return outcome;
}

/** Civil dates checked by migration 5 on both engines; expected outcome = parseCivilDate. */
const CIVIL_DATE_CASES = ['2026-04-30', '2026-04-31', '2026-01-31', '2026-12-31', '2026-02-28', '2026-02-29', '2026-02-30',
  '2024-02-29', '2024-02-30', '1900-02-29', '2000-02-29', '2100-02-29', '2400-02-29', '2026-00-10', '2026-13-10', '2026-10-00',
  '2026-10-32', '0000-01-01', '0001-01-01', '9999-12-31', '2026-2-01', '2026/02/01', '2026-0a-01', 'abcd-ef-gh',
  '2026-11-20T00:00:00Z', ' 2026-11-20', '20261120'];

async function integrity(database: Database, name: Phase1A3BIntegrityProbe, context: Awaited<ReturnType<typeof prepareIntegrity>>) {
  const { purchaseId, secondPurchaseId, paymentId, exactId, repository } = context;
  type AllocationValues = Partial<Record<'id' | 'payment' | 'purchase' | 'mode' | 'status' | 'command' | 'reversed', string | null>>
    & { amount?: string | number | null };
  const allocationSql = (db: Database, values: AllocationValues) => db.executeSql(ALLOCATION_INSERT, [values.id ?? 'a',
    values.payment ?? paymentId, values.purchase ?? purchaseId, values.amount === undefined ? 100 : values.amount,
    values.mode ?? 'unspecified', values.status ?? 'active', values.command ?? 'c', values.reversed ?? null]);
  const revisionSql = (db: Database, number: number, overrides: Partial<Record<string, string | number | null>> = {}) => {
    const row: Record<string, string | number | null> = { id: `${purchaseId}:revision:${number}`, installment_purchase_id: purchaseId,
      revision_number: number, source: 'statement', allocation_id: null, remaining_principal_cents: 20000000, remaining_installments: 2,
      installment_amount_cents: 10000000, effective_cycle_end: '2026-11-20', verification: 'confirmed', pending_reasons: null,
      basis_total_amount: null, basis_monthly_amount: null, basis_installment_count: null, created_at: at('2026-10-14'), ...overrides };
    return db.executeSql(REVISION_INSERT, Object.values(row));
  };
  // Rows meant to persist (valid cases) ...
  const allocation = (values: AllocationValues) => attempt(() => allocationSql(database, values));
  const revision = (number: number, overrides: Partial<Record<string, string | number | null>> = {}) =>
    attempt(() => revisionSql(database, number, overrides));
  // ... and attempts expected to fail, each isolated.
  const invalidAllocation = (values: AllocationValues) => isolated(database, db => allocationSql(db, values));
  const invalidRevision = (number: number, overrides: Partial<Record<string, string | number | null>> = {}) =>
    isolated(database, db => revisionSql(db, number, overrides));
  const invalidSql = (sql: string, values: (string | number | null)[] = []) => isolated(database, db => db.executeSql(sql, values));
  switch (name) {
    // CHECK constraints and cents on the real engine. Civil dates no longer use date() (r3: SQLite 3.9.2 accepted
    // 2026-02-30); every expected-invalid attempt is isolated.
    case 'constraints': {
      const outcomes: Record<string, string> = {};
      for (const [label, amount] of [['zero', 0], ['negative', -1], ['fraction', 1.5], ['fractionText', '1.5'], ['text', 'cien'],
        ['null', null], ['beyondSafe', 9007199254740992]] as const) outcomes[`amount.${label}`] = await invalidAllocation({ id: `amount-${label}`, amount });
      outcomes['mode.invalid'] = await invalidAllocation({ id: 'mode', mode: 'other' });
      outcomes['status.invalid'] = await invalidAllocation({ id: 'status', status: 'pending' });
      outcomes.reversedWithoutDate = await invalidAllocation({ id: 'reversed-a', status: 'reversed' });
      outcomes.activeWithDate = await invalidAllocation({ id: 'reversed-b', reversed: 'x' });
      outcomes.emptyCommand = await invalidAllocation({ id: 'empty-command', command: '' });
      outcomes['revision.impossibleDate'] = await invalidRevision(1, { effective_cycle_end: '2026-02-30' });
      outcomes['revision.timestampAsDate'] = await invalidRevision(1, { effective_cycle_end: '2026-11-20T00:00:00Z' });
      outcomes['revision.confirmedIncomplete'] = await invalidRevision(1, { remaining_installments: null });
      outcomes['revision.projectedWithoutCycle'] = await invalidRevision(1, { verification: 'projected', effective_cycle_end: null, source: 'allocation' });
      outcomes['revision.pendingWithoutReason'] = await invalidRevision(1, { verification: 'pendingVerification' });
      outcomes['revision.reasonWhenConfirmed'] = await invalidRevision(1, { pending_reasons: 'manualReview' });
      outcomes['revision.wrongId'] = await invalidRevision(1, { id: 'wrong' });
      outcomes['revision.fractionCents'] = await invalidRevision(1, { remaining_principal_cents: 1.5 });
      outcomes['revision.tooManyInstallments'] = await invalidRevision(1, { remaining_installments: 361 });
      outcomes['revision.allocationSourceWithoutAllocation'] = await invalidRevision(1, { source: 'allocation' });
      outcomes['revision.statementWithoutCycle'] = await invalidRevision(1, { verification: 'estimated', effective_cycle_end: null });
      outcomes['revision.originalWithoutBasis'] = await invalidRevision(1, { source: 'original', verification: 'pendingVerification',
        pending_reasons: 'manualReview' });
      outcomes['billing.invalidPolicy'] = await invalidSql("INSERT INTO credit_card_billing_rules VALUES ('card', 'sameDay', 'x', 'x')");
      outcomes['firstCycle.invalidSource'] = await invalidSql("INSERT INTO installment_first_cycles VALUES (?, '2026-10-20', 'bank', 'x', 'x')", [purchaseId]);
      outcomes['firstCycle.impossibleDate'] = await invalidSql("INSERT INTO installment_first_cycles VALUES (?, '2026-02-29', 'user', 'x', 'x')", [purchaseId]);
      outcomes['amount.integer'] = await allocation({ id: 'amount-integer', amount: 100, command: 'integer' });
      outcomes['revision.valid'] = await revision(1);
      check(outcomes['revision.valid'] === 'accepted' && outcomes['amount.integer'] === 'accepted', 'Valid rows accepted');
      check(Object.entries(outcomes).filter(([key]) => !['revision.valid', 'amount.integer'].includes(key)).every(([, outcome]) => outcome !== 'accepted'),
        'Invalid row accepted: ' + json(outcomes));
      const integerStored = await query(database, "SELECT typeof(amount_cents) AS type, amount_cents FROM installment_allocations WHERE id = 'amount-integer'");
      // r4: the Android driver returns each row as a native map whose key order is not guaranteed, so the fields are
      // checked one by one (never the serialization). The row itself stays in the result compared with Node.
      const allocationRows = await query(database, 'SELECT count(*) AS total FROM installment_allocations');
      check(integerStored.length === 1 && integerStored[0]!.type === 'integer' && integerStored[0]!.amount_cents === 100
        && Number(allocationRows[0]?.total) === 1,
      'Integer 100 stored exactly: ' + json({ integerStored, allocationRows }));
      const numericText = await numericTextAmount(database, paymentId, purchaseId);
      // No text, real or rounded value is ever stored in amount_cents.
      const nonInteger = await query(database, "SELECT count(*) AS total FROM installment_allocations WHERE typeof(amount_cents) <> 'integer'");
      check(Number(nonInteger[0]?.total) === 0, 'Non-integer amount stored');
      // Civil dates (after r3): every case isolated on revisions (insert), first cycles (insert) and first cycles (update).
      await database.executeSql("INSERT INTO installment_first_cycles VALUES (?, '2026-10-20', 'user', 'x', 'x')", [secondPurchaseId]);
      const civilDates: Record<string, { expected: string; revision: string; firstCycleInsert: string; firstCycleUpdate: string }> = {};
      for (const value of CIVIL_DATE_CASES) {
        civilDates[value] = {
          expected: parseCivilDate(value) ? 'accepted' : 'check',
          revision: await isolated(database, db => revisionSql(db, 2, { effective_cycle_end: value })),
          firstCycleInsert: await isolated(database, db => db.executeSql("INSERT INTO installment_first_cycles VALUES (?, ?, 'user', 'x', 'x')",
            [purchaseId, value])),
          firstCycleUpdate: await isolated(database, db => db.executeSql('UPDATE installment_first_cycles SET cycle_end = ? WHERE installment_purchase_id = ?',
            [value, secondPurchaseId])),
        };
      }
      const wrongDates = Object.entries(civilDates).filter(([, row]) => row.revision !== row.expected || row.firstCycleInsert !== row.expected
        || row.firstCycleUpdate !== row.expected);
      check(wrongDates.length === 0, 'Civil date CHECK differs from parseCivilDate: ' + json(wrongDates));
      // A pending revision keeps a NULL effective cycle; a NULL first cycle is refused.
      const nulls = {
        pendingOriginalWithoutCycle: await isolated(database, db => revisionSql(db, 2, { verification: 'pendingVerification',
          pending_reasons: 'manualReview', effective_cycle_end: null, source: 'original', basis_total_amount: 1, basis_monthly_amount: 1,
          basis_installment_count: 1 })),
        confirmedWithoutCycle: await isolated(database, db => revisionSql(db, 2, { effective_cycle_end: null })),
        firstCycleNull: await isolated(database, db => db.executeSql("INSERT INTO installment_first_cycles VALUES (?, NULL, 'user', 'x', 'x')",
          [purchaseId])),
      };
      check(nulls.pendingOriginalWithoutCycle === 'accepted' && nulls.confirmedWithoutCycle === 'check' && nulls.firstCycleNull === 'notNull',
        'NULL date rules: ' + json(nulls));
      return {
        outcomes, integerStored, nonIntegerAmountsStored: 0, civilDates, nulls,
        // Compared with Node: the common safety criterion only.
        numericText: { input: '100', criterion: 'rejectedOrExactInteger', safe: numericText.safe },
        // Engine-specific evidence, kept for audit and never compared (see the harness).
        engineObserved: { numericText: numericText.observed, affinity: await affinityEvidence(database) },
      };
    }
    // Append-only, contiguous and deterministic; REPLACE over an existing revision is rejected.
    case 'revisionSequence': {
      const outcomes = {
        duplicateNumber: await invalidRevision(0, { source: 'original', verification: 'pendingVerification', pending_reasons: 'manualReview',
          basis_total_amount: 1, basis_monthly_amount: 1, basis_installment_count: 1 }),
        gap: await invalidRevision(2),
        missingPurchase: await invalidRevision(0, { id: 'missing:revision:0', installment_purchase_id: 'missing', source: 'original',
          verification: 'pendingVerification', pending_reasons: 'manualReview', basis_total_amount: 1, basis_monthly_amount: 1, basis_installment_count: 1 }),
        removalOfExistingPurchase: await invalidRevision(1, { source: 'purchaseRemoval', verification: 'pendingVerification', pending_reasons: 'purchaseRemoved',
          remaining_principal_cents: null, remaining_installments: null, installment_amount_cents: null, effective_cycle_end: null }),
        replaceExisting: await invalidSql(REVISION_INSERT.replace('INSERT INTO', 'INSERT OR REPLACE INTO'),
          [`${purchaseId}:revision:0`, purchaseId, 0, 'original', null, 1, 1, 1, null, 'pendingVerification', 'manualReview', 1, 1, 1, 'x']),
        update: await invalidSql("UPDATE installment_plan_revisions SET verification = 'confirmed' WHERE installment_purchase_id = ?", [purchaseId]),
        next: await revision(1),
        afterNext: await revision(2, { effective_cycle_end: '2026-12-20', remaining_principal_cents: 10000000, remaining_installments: 1 }),
      };
      check(outcomes.next === 'accepted' && outcomes.afterNext === 'accepted', 'Sequential revisions accepted');
      const repositoryRevision = await repository.appendPlanRevision({ installmentPurchaseId: purchaseId, source: 'statement',
        remainingPrincipalCents: 0, remainingInstallments: 0, installmentAmountCents: 0, effectiveCycleEnd: '2027-01-20', verification: 'confirmed',
        pendingReasons: [], createdAt: at('2026-10-14') });
      const plan = await repository.getPlanRevisions(purchaseId);
      check(json(plan.map(row => row.revisionNumber)) === json([0, 1, 2, 3]) && repositoryRevision.revisionNumber === 3, 'Ordered history');
      const effective = {
        october: selectEffectivePlanRevision(plan, '2026-10-20'),
        november: selectEffectivePlanRevision(plan, '2026-11-20'),
        latest: await repository.getLatestPlanRevision(purchaseId),
      };
      return { outcomes, plan, effective };
    }
    // Several partial allocations of one payment; command uniqueness; the only transition is active -> reversed;
    // a revision cannot cite another purchase's allocation (composite FK with a nullable component).
    case 'allocations': {
      await database.executeSql("INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES ('other-card','Otra','creditCard','active','COP',0,0,'x','x')");
      await database.executeSql(`INSERT INTO transactions (id, amount, currency, description, date, account_id, type, direction, status,
        target_account_id, created_at, updated_at) VALUES ('other-card-payment', 1, 'COP', 'x', '2026-10-13', 'bank', 'creditCardPayment', 'outflow',
        'posted', 'other-card', '2026-10-13', '2026-10-13'), ('second-payment', 1, 'COP', 'x', '2026-10-13', 'bank', 'creditCardPayment', 'outflow',
        'posted', 'card', '2026-10-13', '2026-10-13')`);
      const outcomes = {
        missingPurchase: await invalidAllocation({ id: 'x1', purchase: 'missing' }),
        missingPayment: await invalidAllocation({ id: 'x2', payment: 'missing' }),
        purchaseIsNotAPayment: await invalidAllocation({ id: 'x3', payment: exactId }),
        paymentOfAnotherCard: await invalidAllocation({ id: 'x4', payment: 'other-card-payment' }),
        insertedReversed: await invalidAllocation({ id: 'x5', status: 'reversed', reversed: 'x' }),
        first: await allocation({ id: 'a1', command: 'c1' }),
        samePaymentOtherPurchase: await allocation({ id: 'a2', command: 'c2', purchase: secondPurchaseId }),
        samePaymentSamePurchaseOtherCommand: await allocation({ id: 'a3', command: 'c3' }),
        sameCommandSamePurchase: await invalidAllocation({ id: 'a4', command: 'c1' }),
        sameCommandOtherPayment: await invalidAllocation({ id: 'a5', command: 'c1', purchase: secondPurchaseId, payment: 'second-payment' }),
        duplicateId: await invalidAllocation({ id: 'a1', command: 'c9' }),
        changeAmount: await invalidSql("UPDATE installment_allocations SET amount_cents = 1 WHERE id = 'a1'"),
        reverse: await attempt(() => database.executeSql("UPDATE installment_allocations SET status = 'reversed', reversed_at = '2026-10-14T17:05:00.000Z' WHERE id = 'a1'")),
        reactivate: await invalidSql("UPDATE installment_allocations SET status = 'active', reversed_at = NULL WHERE id = 'a1'"),
        reverseWithoutDate: await invalidSql("UPDATE installment_allocations SET status = 'reversed' WHERE id = 'a3'"),
        revisionCitingOtherPurchaseAllocation: await invalidSql(REVISION_INSERT, [`${purchaseId}:revision:1`, purchaseId, 1,
          'allocation', 'a2', null, null, null, null, 'pendingVerification', 'manualReview', null, null, null, 'x']),
        revisionCitingOwnAllocation: await attempt(() => database.executeSql(REVISION_INSERT, [`${purchaseId}:revision:1`, purchaseId, 1,
          'allocation', 'a3', null, null, null, null, 'pendingVerification', 'manualReview', null, null, null, 'x'])),
        deleteCitedAllocation: await invalidSql("DELETE FROM installment_allocations WHERE id = 'a3'"),
      };
      check(outcomes.first === 'accepted' && outcomes.samePaymentOtherPurchase === 'accepted' && outcomes.samePaymentSamePurchaseOtherCommand === 'accepted' &&
        outcomes.reverse === 'accepted' && outcomes.revisionCitingOwnAllocation === 'accepted', 'Legitimate allocations accepted');
      return { outcomes, byPayment: await repository.getAllocationsByPayment(paymentId), byPurchase: await repository.getAllocationsByPurchase(purchaseId) };
    }
    case 'commandIdempotency': {
      const requested = [{ id: 'cmd-1:a', paymentTransactionId: paymentId, installmentPurchaseId: purchaseId, amountCents: 5000000,
        mode: 'unspecified' as const, createdAt: at('2026-10-14') }, { id: 'cmd-1:b', paymentTransactionId: paymentId,
        installmentPurchaseId: secondPurchaseId, amountCents: 2500000, mode: 'unspecified' as const, createdAt: at('2026-10-14') }];
      const first = await repository.saveAllocations('cmd-1', requested);
      const counter = await revisionCounter(database);
      const replay = await repository.saveAllocations('cmd-1', [...requested].reverse());
      check(replay.status === 'replayed' && (await revisionCounter(database)) === counter, 'Replay wrote');
      const conflict = await attempt(() => repository.saveAllocations('cmd-1', [{ ...requested[0]!, amountCents: 1 }]));
      const invalid = await attempt(() => repository.saveAllocations('cmd-2', [{ ...requested[0]!, id: 'cmd-2:a', amountCents: 0 }]));
      check(conflict.startsWith('other') && invalid.startsWith('other'), 'Conflicting command rejected before writing');
      return { first, replay, conflictRejected: true, invalidRejected: true, byCommand: await repository.getAllocationsByCommand('cmd-1') };
    }
    // An active allocation blocks deleting/changing its payment and deleting its purchase, through the production use
    // case too (rolled back, nothing changed); after an explicit reversal the deletion proceeds and history stays.
    case 'activeAllocationGuards': {
      await repository.saveAllocations('guard', [{ id: 'guard:a', paymentTransactionId: paymentId, installmentPurchaseId: purchaseId,
        amountCents: 5000000, mode: 'unspecified', createdAt: at('2026-10-14') }]);
      const before = json(await fullState(database));
      // 1a.4B (D6): every raw change is still blocked by SQLite and the purchase use case rejects its deletion before
      // writing. Deleting the payment through its use case is no longer blocked: it reverses the allocation first (below).
      const outcomes = {
        updatePaymentAmount: await attempt(() => database.executeSql('UPDATE transactions SET amount = 1 WHERE id = ?', [paymentId])),
        updatePaymentId: await attempt(() => database.executeSql("UPDATE transactions SET id = 'renamed' WHERE id = ?", [paymentId])),
        deletePurchaseRow: await attempt(() => database.executeSql('DELETE FROM installment_purchases WHERE id = ?', [purchaseId])),
        deletePurchaseUseCase: await attempt(() => deleteMovement(database, exactId, '2026-10-14')),
        renamePurchase: await attempt(() => database.executeSql("UPDATE installment_purchases SET id = 'renamed' WHERE id = ?", [purchaseId])),
      };
      check(json(await fullState(database)) === before, 'A blocked operation left changes');
      const description = await attempt(() => database.executeSql("UPDATE transactions SET description = 'Descripcion' WHERE id = ?", [paymentId]));
      const deletePaymentUseCase = await attempt(() => deleteMovement(database, paymentId, '2026-10-15'));
      check(deletePaymentUseCase === 'accepted', 'D6: deleting the payment reverses its allocation and proceeds');
      const reversed = await repository.getAllocationsByPayment(paymentId);
      check(reversed.length === 1 && reversed[0]!.status === 'reversed', 'D6 reversed the allocation in the deletion');
      await deleteMovement(database, exactId, '2026-10-15');
      const remaining = await repository.getAllocationsByPayment(paymentId);
      check(remaining.length === 1 && remaining[0]!.status === 'reversed', 'Reversed allocation kept after deleting its payment');
      const purchaseHistory = await repository.getPlanRevisions(purchaseId);
      check(json(purchaseHistory.map(row => row.source)) === json(['original', 'allocationReversal', 'purchaseRemoval']),
        'D6 corrective revision before the removal');
      return { outcomes, description, deletePaymentUseCase, afterReversal: { allocations: remaining, purchaseHistory } };
    }
    // Changing terms appends purchaseEdit (pending); a name-only edit appends nothing; deletion appends purchaseRemoval.
    case 'purchaseEditAndRemoval': {
      const counter0 = await revisionCounter(database);
      await editPurchase(database, exactId, '2026-10-12', 3, 'Solo nombre');
      const nameOnly = (await repository.getPlanRevisions(purchaseId)).length;
      const counter1 = await revisionCounter(database);
      await editPurchase(database, exactId, '2026-10-12', 6);
      const counter2 = await revisionCounter(database);
      await deleteMovement(database, exactId, '2026-10-14');
      const counter3 = await revisionCounter(database);
      const plan = await repository.getPlanRevisions(purchaseId);
      check(nameOnly === 1 && json(plan.map(row => row.source)) === json(['original', 'purchaseEdit', 'purchaseRemoval']), 'Trigger revisions');
      return { plan,
        counterDeltas: [counter1 - counter0, counter2 - counter1, counter3 - counter2], effective: selectEffectivePlanRevision(plan).status };
    }
    // cuotas -> 1 -> cuotas recreates the purchase with the same id: it never inherits the removed plan.
    case 'purchaseRecreation': {
      await editPurchase(database, exactId, '2026-10-12', 1);
      await editPurchase(database, exactId, '2026-10-12', 4);
      const recreated = selectEffectivePlanRevision(await repository.getPlanRevisions(purchaseId));
      check(recreated.status === 'current' && recreated.revision.source === 'original' && recreated.revision.revisionNumber === 2 &&
        recreated.revision.remainingInstallments === 4, 'The use case opened the new incarnation');
      const secondOriginal = await attempt(() => repository.appendPlanRevision({ installmentPurchaseId: purchaseId, source: 'original',
        remainingPrincipalCents: 30000000, remainingInstallments: 4, installmentAmountCents: 7500000, effectiveCycleEnd: null,
        verification: 'pendingVerification', pendingReasons: ['firstCycleUnconfirmed'],
        basis: { totalAmount: 300000, monthlyAmount: 75000, installmentCount: 4 }, createdAt: at('2026-10-15') }));
      // Same plan row recreated outside the use case: the removal trigger closes the incarnation, the row has no original.
      await database.executeSql(`CREATE TEMP TABLE synthetic_kept_plan AS SELECT * FROM installment_purchases WHERE id = ?`, [purchaseId]);
      await database.executeSql('DELETE FROM installment_purchases WHERE id = ?', [purchaseId]);
      await database.executeSql('INSERT INTO installment_purchases SELECT * FROM synthetic_kept_plan');
      await database.executeSql('DROP TABLE synthetic_kept_plan');
      const afterRecreation = selectEffectivePlanRevision(await repository.getPlanRevisions(purchaseId)).status;
      const nonOriginal = await attempt(() => repository.appendPlanRevision({ installmentPurchaseId: purchaseId, source: 'statement',
        remainingPrincipalCents: 1, remainingInstallments: 1, installmentAmountCents: 1, effectiveCycleEnd: '2026-10-20', verification: 'projected',
        pendingReasons: [], createdAt: at('2026-10-15') }));
      const original = await repository.appendPlanRevision({ installmentPurchaseId: purchaseId, source: 'original', remainingPrincipalCents: 30000000,
        remainingInstallments: 4, installmentAmountCents: 7500000, effectiveCycleEnd: null, verification: 'pendingVerification',
        pendingReasons: ['firstCycleUnconfirmed'], basis: { totalAmount: 300000, monthlyAmount: 75000, installmentCount: 4 }, createdAt: at('2026-10-15') });
      const plan = await repository.getPlanRevisions(purchaseId);
      check(afterRecreation === 'removed' && original.revisionNumber === 4, 'New incarnation');
      return { recreatedByUseCase: recreated.revision, secondOriginal, afterRecreation, nonOriginal, original,
        effective: selectEffectivePlanRevision(plan), sources: plan.map(row => row.source) };
    }
    case 'billingMetadata': {
      await repository.saveBillingRules({ accountId: 'card', createdAt: at('2026-10-11'), updatedAt: at('2026-10-11') });
      const undefinedPolicy = await repository.getBillingRules(['card']);
      await repository.saveBillingRules({ accountId: 'card', closingDayPurchasePolicy: 'nextCycle', createdAt: at('2026-10-12'), updatedAt: at('2026-10-12') });
      await repository.saveFirstCycle({ installmentPurchaseId: purchaseId, cycleEnd: '2026-10-20', source: 'user', createdAt: at('2026-10-11'), updatedAt: at('2026-10-11') });
      await repository.saveFirstCycle({ installmentPurchaseId: purchaseId, cycleEnd: '2026-11-20', source: 'statement', createdAt: at('2026-10-12'), updatedAt: at('2026-10-12') });
      const metadata = await history(database);
      await editPurchase(database, exactId, '2026-10-12', 3, 'Solo nombre');
      const keptAfterEdit = await repository.getFirstCycles([purchaseId]);
      await deleteMovement(database, exactId, '2026-10-14');
      const afterDeletion = await repository.getFirstCycles([purchaseId]);
      const outcomes = {
        missingCard: await attempt(() => repository.saveBillingRules({ accountId: 'missing', createdAt: 'x', updatedAt: 'x' })),
        missingPurchase: await attempt(() => repository.saveFirstCycle({ installmentPurchaseId: 'missing', cycleEnd: '2026-10-20', source: 'user', createdAt: 'x', updatedAt: 'x' })),
      };
      check(keptAfterEdit.length === 1 && afterDeletion.length === 0, 'First cycle follows the purchase lifecycle');
      return { undefinedPolicy, billingRules: await repository.getBillingRules(['card']), metadata, keptAfterEdit, afterDeletion, outcomes };
    }
    // Repositories join the owner: allocation and revision written, then a domain failure rolls everything back.
    case 'repositoryScope': {
      const before = json(await fullState(database));
      const result = await runSharedSQLiteTransaction(database, async participant => {
        const scoped = createSqliteInstallmentHistoryRepository(participant);
        await scoped.saveAllocations('scoped', [{ id: 'scoped:a', paymentTransactionId: paymentId, installmentPurchaseId: purchaseId,
          amountCents: 100, mode: 'unspecified', createdAt: at('2026-10-14') }]);
        await scoped.appendPlanRevision({ installmentPurchaseId: purchaseId, source: 'allocation', allocationId: 'scoped:a',
          remainingPrincipalCents: null, remainingInstallments: null, installmentAmountCents: null, effectiveCycleEnd: null,
          verification: 'pendingVerification', pendingReasons: ['manualReview'], createdAt: at('2026-10-14') });
        const inside = (await scoped.getAllocationsByCommand('scoped')).length;
        check(inside === 1, 'Participant sees its writes');
        throw Error('Synthetic domain failure');
      });
      check(result.status === 'rolledBack' && json(await fullState(database)) === before, 'Scope rolled back');
      const committed = await runSharedSQLiteTransaction(database, async participant =>
        (await createSqliteInstallmentHistoryRepository(participant).saveAllocations('scoped', [{ id: 'scoped:a', paymentTransactionId: paymentId,
          installmentPurchaseId: purchaseId, amountCents: 100, mode: 'unspecified', createdAt: at('2026-10-14') }])).status);
      return { rolledBack: result.status, committed };
    }
    // The wipe removes history in one commit; run last (it records a lifecycle intent in app_settings).
    case 'financialWipe': {
      await repository.saveAllocations('wipe', [{ id: 'wipe:a', paymentTransactionId: paymentId, installmentPurchaseId: purchaseId,
        amountCents: 100, mode: 'unspecified', createdAt: at('2026-10-14') }]);
      await repository.saveBillingRules({ accountId: 'card', closingDayPurchasePolicy: 'closingCycle', createdAt: 'x', updatedAt: 'x' });
      await repository.saveFirstCycle({ installmentPurchaseId: purchaseId, cycleEnd: '2026-10-20', source: 'user', createdAt: 'x', updatedAt: 'x' });
      const result = await createSqliteFinancialDataRepository(database).deleteFinancialData('33333333-3333-4333-8333-333333333333',
        { workIds: [], backupJobIds: [], snapshotIds: [] });
      check(result.status === 'confirmed', 'Wipe confirmed');
      const counts: Record<string, number> = {};
      for (const table of [...NEW_TABLES, 'installment_purchases', 'transactions', 'accounts'])
        counts[table] = Number((await query(database, `SELECT count(*) AS total FROM ${table}`))[0]?.total);
      check(Object.values(counts).every(count => count === 0), 'Wipe left rows');
      // Accounts are gone: re-seed so the common observation of the probe can still read the dashboard.
      await seedAccounts(database);
      return { status: result.status, counts };
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// E. Same operations on version 4 and version 5

/** Write counter provided by each runtime (node:sqlite trace / APK managed proxy). */
export type Phase1A3BWriteCounter = (run: () => Promise<unknown>) => Promise<number>;

/**
 * Create (3 installments) -> edit terms (6) -> pay -> delete payment -> delete purchase, on a version 4 database and on
 * the same database migrated to version 5 (purchase with revision 0). Finances and write counts must be identical;
 * the only expected differences are structural: the appended history rows and their backup-counter increments.
 */
export async function runPhase1A3BFlows(database: Database, countWrites: Phase1A3BWriteCounter) {
  const runs: Record<string, unknown> = {};
  // 1a.4B: on version 4 (no allocation tables) the first guarded step fails and changes nothing; the app never runs it,
  // because every start applies migration 5 first.
  {
    await seedAccounts(database);
    const created = await purchase(database, '2026-10-11', 300000, 3, 'Flujo');
    await downgradeToVersion4(database);
    const before = json(await fullState(database));
    const editTerms = await attempt(() => editPurchase(database, created.id, '2026-10-12', 6));
    check(editTerms === 'other: no such table: installment_allocations', 'Version 4 guarded step: ' + editTerms);
    check(json(await fullState(database)) === before, 'The failed version 4 step left changes');
    runs.version4Incompatible = { firstGuardedStep: 'editTerms', outcome: editTerms, stateUnchanged: true };
    await applyVersionedMigrations(database);
  }
  for (const version of [5] as const) {
    await seedAccounts(database);
    const created = await purchase(database, '2026-10-11', 300000, 3, 'Flujo');
    await downgradeToVersion4(database);
    await applyVersionedMigrations(database);
    const start = await observe(database, '2026-10-11');
    const steps: Record<string, { writes: number; observation: unknown }> = {};
    const step = async (label: string, date: string, run: () => Promise<unknown>) => {
      const writes = await countWrites(run);
      steps[label] = { writes, observation: await observe(database, date) };
    };
    let paymentId = '';
    await step('editTerms', '2026-10-12', () => editPurchase(database, created.id, '2026-10-12', 6));
    await step('payment', '2026-10-13', async () => { paymentId = (await pay(database, '2026-10-13', 100000)).id; });
    await step('deletePayment', '2026-10-14', () => deleteMovement(database, paymentId, '2026-10-14'));
    await step('deletePurchase', '2026-10-14', () => deleteMovement(database, created.id, '2026-10-14'));
    runs[`version${version}`] = { start, steps };
  }
  return canonical({ version4Incompatible: runs.version4Incompatible, version5: runs.version5 });
}
