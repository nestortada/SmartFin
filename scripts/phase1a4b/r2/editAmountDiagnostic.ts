// Phase 1a.4B r2: DIAGNOSTIC ONLY (no correction). Reproduces `phase1a4b-reversal / editAmount` with the REAL production
// use cases and the same synthetic fixture, dates and pinned clock as scripts/phase1a4b/probes.ts (which stays untouched:
// the helpers below are copied from it, not imported, so the original oracle keeps its hash). Runs identically in Node
// (__tests__/phase1a4bR2Diagnostic.test.ts) and in the isolated APK (com.smartfin.snapshot5b2.tests).
//
// The SQL trace is collected by the ENVIRONMENT at the raw driver boundary (Node: realSQLite adapter; Android: the
// react-native-sqlite-storage native batch), with read-only counter reads on the same connection between statements.
// This module adds no writes, commits, rollbacks or nested transactions: it only marks stages and reads state at stage
// boundaries, while the trace is paused. Only synthetic data.
import type { SmartFinSQLiteDatabase } from '../../../src/database/sqliteDatabase';
import { createSqliteAccountRepository } from '../../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { getDashboardSummaryFromDb } from '../../../src/modules/dashboard/useCases/getDashboardSummary';
import {
  saveManualTransaction,
  type SaveManualTransactionParams,
} from '../../../src/modules/transactions/useCases/saveManualTransaction';
import {
  extraordinaryPaymentTransactionId,
  registerExtraordinaryInstallmentPayment,
  type ExtraordinaryInstallmentPaymentParams,
} from '../../../src/modules/creditCards/useCases/extraordinaryInstallmentPayment';
import { serializeCreditCardVisualMetadata } from '../../../src/modules/creditCards/useCases/manageCreditCards';
import type { Transaction } from '../../../src/modules/transactions/types/Transaction';
import { resetSyntheticData } from '../../phase6b/probes';
import { bogotaNoon, withPhase1A2Clock } from '../../phase1a2/probes';

type Row = Record<string, unknown>;
type Database = SmartFinSQLiteDatabase;

/** One statement seen at the raw driver boundary. Counter values are read-only probes on the same connection. */
export type R2RawEvent = {
  seq: number;
  stage: string;
  sql: string;
  paramTypes: string[];
  outcome: 'ok' | 'error';
  error?: string;
  /** Value reported by the driver (react-native-sqlite-storage reports 1 for any multi-row INSERT). */
  driverRowsAffected: number | null;
  revisionBefore: number | null;
  revisionAfter: number | null;
  /** SQLite changes(): rows changed directly by this statement (DML only; stale for reads/control). */
  changesAfter: number | null;
  totalChangesBefore: number | null;
  totalChangesAfter: number | null;
  /** Inferred from the BEGIN/COMMIT/ROLLBACK stream at the driver boundary, before the statement. */
  inTransactionBefore: boolean;
};
export type R2Tracer = {
  /** Starts recording (clears previous events). */
  start: (stage: string) => void;
  stage: (stage: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => R2RawEvent[];
};

export const R2_REFERENCE_DATES = { purchase: '2026-10-11', register: '2026-10-12', edit: '2026-10-13' } as const;
const MARKER = 'synthetic_phase1a4b_marker';
const rowsOf = (result: { rows: { length: number; item: (index: number) => unknown } }) =>
  Array.from({ length: result.rows.length }, (_, index) => result.rows.item(index) as Row);
const json = (value: unknown) => JSON.stringify(value);
const query = async (database: Database, sql: string, values: (string | number | null)[] = []) =>
  rowsOf((await database.executeSql(sql, values))[0]);
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }

// ---------------------------------------------------------------------------------------------------------------
// Fixture: copied verbatim from scripts/phase1a4b/probes.ts (seed, purchase, extraordinary, editPaymentParams).

const dependencies = (database: Database) => ({
  accountRepository: createSqliteAccountRepository(database),
  transactionRepository: createSqliteTransactionRepository(database),
  creditCardRepository: createSqliteCreditCardRepository(database),
});
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
async function purchase(database: Database, date: string, amount: number, installments: number) {
  const params: SaveManualTransactionParams = {
    ...dependencies(database), accounts: await accountsAt(database, date), accountId: 'card', amount, merchantName: `Compra ${amount}`,
    operationType: 'Crédito', transactionType: 'expense', hasInterestFreeInstallments: false,
    installmentCountInput: String(installments), interestFreeInstallmentCountInput: '', occurrence: { kind: 'date', date },
    currentDate: bogotaNoon(date), now: bogotaNoon(date),
  };
  const transaction = await withPhase1A2Clock(bogotaNoon(date), async () => (await saveManualTransaction(params)).transaction);
  return { transaction, id: `installment-${transaction.id}` };
}
async function currentTransaction(database: Database, id: string): Promise<Transaction> {
  const transaction = (await dependencies(database).transactionRepository.getTransactions()).find(row => row.id === id);
  check(transaction, 'Movement missing: ' + id);
  return transaction;
}
function extraordinaryParams(database: Database, purchaseId: string, date: string): ExtraordinaryInstallmentPaymentParams {
  return { ...dependencies(database), cardAccountId: 'card', installmentPurchaseId: purchaseId, sourceAccountId: 'bank',
    paymentAmount: 100000, allocatedAmount: 100000, mode: 'unspecified', commandId: 'cmd-1', currentDate: bogotaNoon(date) };
}
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

// ---------------------------------------------------------------------------------------------------------------
// Observation (read only) at stage boundaries.

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function sqlClock(row: Row): Row {
  if (row.source !== 'purchaseEdit' && row.source !== 'purchaseRemoval') return row;
  check(typeof row.created_at === 'string' && ISO_INSTANT.test(row.created_at), 'SQLite clock format');
  return { ...row, created_at: '<sqlite-clock>' };
}
/** Same renaming as probes.ts canonical(): pinned-clock movement ids become M1.., ordinary payments P1... */
export function canonicalIds<T>(value: T): T {
  const text = json(value);
  const ids = [...new Set(text.match(/tx_manual_\d+(?:_\d+)?|tx-credit-card-payment-card-\d+-\d+/g) ?? [])];
  let manual = 0;
  let payment = 0;
  const labels = new Map(ids.map(id => [id, id.startsWith('tx_manual_') ? `M${++manual}` : `P${++payment}`] as const));
  const ordered = [...labels.entries()].sort((a, b) => b[0].length - a[0].length);
  return JSON.parse(ordered.reduce((current, [id, label]) => current.split(id).join(label), text)) as T;
}
const PAYMENT_ID = extraordinaryPaymentTransactionId('card', 'cmd-1');

async function stageState(database: Database, date: string) {
  const accounts = await query(database, `SELECT rowid AS row_id, id, balance_amount, debt_balance_amount, credit_limit_amount,
    created_at, updated_at FROM accounts ORDER BY id`);
  const summary = await getDashboardSummaryFromDb(database, bogotaNoon(date));
  const card = accounts.find(row => row.id === 'card');
  return {
    financialDataRevision: (await query(database, 'SELECT revision FROM financial_data_revision WHERE id = 1'))[0]?.revision ?? null,
    categories: await query(database, `SELECT rowid AS row_id, id FROM categories WHERE id IN ('cat-label','cat-other') ORDER BY id`),
    payment: await query(database, 'SELECT rowid AS row_id, * FROM transactions WHERE id = ?', [PAYMENT_ID]),
    allocations: await query(database, 'SELECT rowid AS row_id, * FROM installment_allocations ORDER BY rowid'),
    revisions: (await query(database, `SELECT r.* FROM installment_plan_revisions r
      LEFT JOIN installment_purchases p ON p.id = r.installment_purchase_id
      ORDER BY p.rowid IS NULL, p.rowid, r.installment_purchase_id, r.revision_number`)).map(sqlClock),
    statements: await query(database, 'SELECT rowid AS row_id, * FROM credit_card_statements ORDER BY account_id, statement_start_date, rowid'),
    transactions: await query(database, 'SELECT rowid AS row_id, * FROM transactions ORDER BY created_at, rowid'),
    installmentPurchases: await query(database, 'SELECT rowid AS row_id, * FROM installment_purchases ORDER BY rowid'),
    accounts,
    cardDebt: card?.debt_balance_amount ?? null,
    cardAvailableCredit: card ? Number(card.credit_limit_amount) - Number(card.debt_balance_amount) : null,
    summary: { availableBalance: summary.availableBalance, totalDebt: summary.totalDebt, netWorth: summary.netWorth },
    /** Idempotency evidence: command_id lives in the allocation row (no separate receipt table). */
    idempotency: await query(database, `SELECT rowid AS row_id, id, command_id, payment_transaction_id, status
      FROM installment_allocations WHERE command_id = 'cmd-1' ORDER BY rowid`),
  };
}

/** Effective schema facts compared between Node and Android: triggers, pragmas and the SQLite version. */
export async function r2SchemaFacts(database: Database) {
  const triggers = await query(database, "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name");
  const normalized = triggers.map(row => ({ name: row.name, table: row.tbl_name,
    sql: String(row.sql).replace(/\s+/g, ' ').trim() }));
  const backup = normalized.filter(row => String(row.name).startsWith('backup_revision_'));
  const [version] = await query(database, 'SELECT sqlite_version() AS version');
  const pragma = async (name: string) => (await query(database, `PRAGMA ${name}`))[0] ?? null;
  return {
    sqliteVersion: version?.version ?? null,
    pragmas: { recursive_triggers: await pragma('recursive_triggers'), foreign_keys: await pragma('foreign_keys') },
    triggerCount: normalized.length,
    backupTriggerTables: [...new Set(backup.map(row => String(row.table)))].sort(),
    categoriesTracked: backup.some(row => row.table === 'categories'),
    triggers: normalized,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Trace post-processing (identical in Node and Android).

const SOURCES: [RegExp, string][] = [
  [/^DROP TABLE IF EXISTS synthetic_/, 'probe seed: marker cleanup'],
  [/^SELECT name FROM sqlite_master/, 'resetSyntheticData: table list'],
  [/^DELETE FROM "/, 'resetSyntheticData'],
  [/^INSERT INTO financial_data_revision/, 'probe seed: counter row'],
  [/^INSERT INTO accounts \(id,name,type/, 'probe seed: accounts'],
  [/^INSERT OR IGNORE INTO categories/, 'probe seed: categories (INSERT OR IGNORE)'],
  [/^UPDATE installment_allocations SET status = 'reversed'/, 'sqliteInstallmentHistoryRepository.reverseAllocation (reverseActivePaymentAllocations, D6)'],
  [/^INSERT INTO installment_plan_revisions/, 'sqliteInstallmentHistoryRepository.appendPlanRevision'],
  [/^INSERT INTO installment_allocations/, 'sqliteInstallmentHistoryRepository.saveAllocations'],
  [/^(UPDATE accounts SET|INSERT INTO accounts \(id,name)/, 'saveSqliteAccounts (upsertSQLiteRow)'],
  [/^(UPDATE transactions SET|INSERT INTO transactions \()/, 'sqliteTransactionRepository.saveTransactions (upsertSQLiteRow)'],
  [/^DELETE FROM installment_purchases WHERE transaction_id/, 'sqliteTransactionRepository.deleteInstallmentPurchasesByTransactionId'],
  [/^(UPDATE|INSERT INTO) credit_card_statements/, 'sqliteCreditCardRepository.saveStatements (saveSQLiteRowPreservingIdentity)'],
  [/^(UPDATE|INSERT INTO) installment_purchases/, 'sqliteCreditCardRepository.saveInstallmentPurchases (saveSQLiteRowPreservingIdentity)'],
  [/^(BEGIN|COMMIT|ROLLBACK|END)/, 'atomicSQLite runner (transaction control)'],
];
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
function classify(sql: string) {
  const text = normalize(sql);
  const verb = (text.match(/^(\w+)/)?.[1] ?? '').toUpperCase();
  const table = text.match(/^(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM|REPLACE INTO)\s+"?([a-z_0-9]+)"?/i)?.[1]
    ?? text.match(/\bFROM\s+"?([a-z_0-9]+)"?/i)?.[1] ?? null;
  const kind = /^(INSERT|UPDATE|DELETE|REPLACE)$/.test(verb) ? 'write' : /^(BEGIN|COMMIT|ROLLBACK|END|SAVEPOINT|RELEASE)$/.test(verb)
    ? 'control' : 'read';
  return { text, verb, table, kind, source: SOURCES.find(([pattern]) => pattern.test(text))?.[1] ?? 'read/other' };
}
export type R2Event = ReturnType<typeof describeEvents>[number];
export function describeEvents(events: R2RawEvent[]) {
  let write = 0;
  return events.map(event => {
    const { text, verb, table, kind, source } = classify(event.sql);
    const counterDelta = event.revisionBefore === null || event.revisionAfter === null ? null : event.revisionAfter - event.revisionBefore;
    const totalDelta = event.totalChangesBefore === null || event.totalChangesAfter === null ? null
      : event.totalChangesAfter - event.totalChangesBefore;
    const direct = kind === 'write' && event.outcome === 'ok' ? event.changesAfter : kind === 'write' ? 0 : null;
    return {
      seq: event.seq, stage: event.stage, write: kind === 'write' ? ++write : null, kind, verb, table, source,
      sql: text.length > 200 ? text.slice(0, 200) + '…' : text, paramTypes: event.paramTypes, outcome: event.outcome,
      ...(event.error ? { error: event.error } : {}),
      driverRowsAffected: event.driverRowsAffected,
      /** Rows changed by the statement itself (SQLite changes()). */
      directRows: direct,
      /** Rows changed by triggers (total_changes delta minus direct rows). */
      triggerRows: totalDelta === null || direct === null ? (kind === 'write' ? null : totalDelta) : totalDelta - direct,
      revisionBefore: event.revisionBefore, revisionAfter: event.revisionAfter, counterDelta,
      inTransactionBefore: event.inTransactionBefore,
      transaction: verb === 'BEGIN' ? 'begin' : verb === 'COMMIT' || verb === 'END'
        ? (event.outcome === 'ok' ? 'confirmed' : 'uncertain') : verb === 'ROLLBACK' ? 'rolledBack' : null,
    };
  });
}
/** Writes and counter increments per stage, plus the statements that moved the counter. */
export function summarizeTrace(events: R2Event[]) {
  const stages: Record<string, { statements: number; writes: number; counterDelta: number; writesWithoutRows: number }> = {};
  for (const event of events) {
    const stage = (stages[event.stage] ??= { statements: 0, writes: 0, counterDelta: 0, writesWithoutRows: 0 });
    stage.statements++;
    if (event.kind === 'write') { stage.writes++; if (event.directRows === 0) stage.writesWithoutRows++; }
    stage.counterDelta += event.counterDelta ?? 0;
  }
  return {
    stages,
    counterMoves: events.filter(event => (event.counterDelta ?? 0) !== 0)
      .map(({ seq, stage, write, sql, directRows, triggerRows, revisionBefore, revisionAfter, counterDelta }) =>
        ({ seq, stage, write, sql: sql.slice(0, 90), directRows, triggerRows, revisionBefore, revisionAfter, counterDelta })),
    anomalies: events.filter(event => event.kind === 'write' && event.outcome === 'ok' && event.counterDelta !== null &&
      event.triggerRows !== null && event.counterDelta > event.triggerRows)
      .map(event => ({ seq: event.seq, sql: event.sql.slice(0, 90), counterDelta: event.counterDelta, triggerRows: event.triggerRows })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Comparison helpers (never normalize, never accept: they only enumerate).

const typeOf = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? 'array'
  : typeof value === 'number' ? (Number.isInteger(value) ? 'number(integer)' : 'number(real)') : typeof value;
const TABLES: Record<string, string> = {
  accounts: 'accounts', transactions: 'transactions', statements: 'credit_card_statements',
  allocations: 'installment_allocations', revisions: 'installment_plan_revisions', installmentPurchases: 'installment_purchases',
  backupRevision: 'financial_data_revision', financialDataRevision: 'financial_data_revision', summary: 'getDashboardSummaryFromDb',
  writes: 'write counter (INSERT/UPDATE/DELETE/REPLACE statements)', payment: 'transactions', idempotency: 'installment_allocations',
  categories: 'categories',
};
export type R2Difference = { path: string; node: unknown; android: unknown; nodeType: string; androidType: string; table: string | null };
/** Every difference, same traversal as the APK comparator (sorted keys, arrays by index). */
export function allDifferences(android: unknown, node: unknown, at = '$', out: R2Difference[] = []): R2Difference[] {
  if (android && node && typeof android === 'object' && typeof node === 'object' && Array.isArray(android) === Array.isArray(node)) {
    const a = android as Row;
    const n = node as Row;
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(n)])].sort())
      allDifferences(a[key], n[key], `${at}.${key}`, out);
    return out;
  }
  if (json(android) !== json(node)) {
    const segment = at.split('.').find(part => part in TABLES) ?? null;
    out.push({ path: at, node, android, nodeType: typeOf(node), androidType: typeOf(android), table: segment ? TABLES[segment]! : null });
  }
  return out;
}
const TRACE_FIELDS = ['stage', 'kind', 'verb', 'table', 'sql', 'paramTypes', 'outcome', 'directRows', 'triggerRows', 'counterDelta',
  'revisionBefore', 'revisionAfter', 'inTransactionBefore', 'transaction'] as const;
/** Statement-by-statement comparison; driverRowsAffected is reported apart (driver-specific for multi-row INSERT). */
export function compareTraces(android: R2Event[], node: R2Event[]) {
  const differences: Row[] = [];
  for (let index = 0; index < Math.max(android.length, node.length); index++) {
    const a = android[index] as Row | undefined;
    const n = node[index] as Row | undefined;
    if (!a || !n) { differences.push({ index, seq: (a ?? n)!.seq, missingIn: a ? 'node' : 'android', statement: (a ?? n)!.sql }); continue; }
    const fields = TRACE_FIELDS.filter(field => json(a[field]) !== json(n[field]));
    if (fields.length) differences.push({ index, seq: a.seq, fields: Object.fromEntries(fields.map(field => [field, { android: a[field], node: n[field] }])) });
  }
  const driverRowsAffected = android.map((event, index) => ({ index, sql: event.sql.slice(0, 90), android: event.driverRowsAffected,
    node: node[index]?.driverRowsAffected })).filter(entry => entry.android !== entry.node);
  return { statements: { android: android.length, node: node.length }, firstDivergence: differences[0] ?? null,
    differenceCount: differences.length, differences: differences.slice(0, 50), driverRowsAffected };
}

// ---------------------------------------------------------------------------------------------------------------
// Staged reproduction.

/**
 * The editAmount fixture split in observable stages: seed → purchase → extraordinary registration → edit parameters
 * (reads only) → saveManualTransaction with the new amount (D6 reversal + edit + reconciliation, one transaction).
 */
export async function runEditAmountStaged(database: Database, tracer: R2Tracer, label: string) {
  const stages: Row = {};
  const observe = async (name: string, date: string) => {
    tracer.pause();
    try { stages[name] = await stageState(database, date); } finally { tracer.resume(); }
  };
  tracer.start(`${label}:seed`);
  await seed(database);
  await observe('1-initial', R2_REFERENCE_DATES.purchase);
  tracer.stage(`${label}:purchase`);
  const { id } = await purchase(database, R2_REFERENCE_DATES.purchase, 600000, 6);
  await observe('2-afterPurchase', R2_REFERENCE_DATES.purchase);
  tracer.stage(`${label}:register`);
  const params = extraordinaryParams(database, id, R2_REFERENCE_DATES.register);
  await withPhase1A2Clock(bogotaNoon(R2_REFERENCE_DATES.register), () => registerExtraordinaryInstallmentPayment(params));
  await observe('3-afterPaymentAndAllocation', R2_REFERENCE_DATES.register);
  tracer.stage(`${label}:editParams`);
  const edit = await editPaymentParams(database, PAYMENT_ID, R2_REFERENCE_DATES.edit, { amount: 90000 });
  await observe('4-beforeEdit', R2_REFERENCE_DATES.edit);
  tracer.stage(`${label}:edit`);
  let editError: string | null = null;
  try {
    await withPhase1A2Clock(bogotaNoon(R2_REFERENCE_DATES.edit), () => saveManualTransaction(edit));
  } catch (error) { editError = String(error); }
  tracer.pause();
  stages['5-final'] = await stageState(database, R2_REFERENCE_DATES.edit);
  const events = describeEvents(tracer.stop());
  return canonicalIds({ label, editError, stages, trace: events, traceSummary: summarizeTrace(events) });
}
