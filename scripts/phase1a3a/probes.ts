// Phase 1a.3A probes: identity-preserving persistence (no INSERT OR REPLACE) on the real SQLite driver. The same
// synthetic scenarios run in Node (node:sqlite, __tests__/phase1a3aAndroidEquivalence.test.ts) and in the isolated
// Android APK, through the unchanged production use cases. Every step pins the JS clock. Dependent rows live in
// synthetic tables created in the synthetic database only; the financial schema is not modified, except the
// last probe, which adds a synthetic column (as migration 5 will) and therefore runs last.
import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import { runSharedSQLiteTransaction, SQLiteCommandFailure } from '../../src/database/atomicSQLite';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import {
  saveManualTransaction,
  type SaveManualTransactionParams,
} from '../../src/modules/transactions/useCases/saveManualTransaction';
import {
  reconcileCreditCardTransactions,
  registerCreditCardPayment,
} from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { serializeCreditCardVisualMetadata } from '../../src/modules/creditCards/useCases/manageCreditCards';
import type { Transaction } from '../../src/modules/transactions/types/Transaction';
import type { InstallmentPurchase } from '../../src/modules/creditCards/types';
import { centsText, resetSyntheticData, textCents } from '../phase6b/probes';
import { bogotaNoon, withPhase1A2Clock } from '../phase1a2/probes';

export const PHASE1A3A_PROBES = [
  'insertNew', 'editPlanUnchangedTerms', 'editPlanChangedTerms', 'statementPaymentInPlace',
  'repeatedReconciliation', 'profileUpdate', 'rejectMissingReference', 'unlistedColumns',
] as const;
export type Phase1A3AProbe = (typeof PHASE1A3A_PROBES)[number];
export const PHASE1A3A_MATRICES = ['planEdit', 'statementPayment'] as const;
export type Phase1A3AMatrix = (typeof PHASE1A3A_MATRICES)[number];

type Row = Record<string, unknown>;
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
const rowsOf = (result: { rows: { length: number; item: (index: number) => unknown } }) =>
  Array.from({ length: result.rows.length }, (_, index) => result.rows.item(index) as Row);
const json = (value: unknown) => JSON.stringify(value);
// node:sqlite and the Android driver reject with message objects that are not always Error instances.
const errorText = (error: unknown) => error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
  ? String((error as { message: string }).message) : json(error);

const SYNTHETIC_TABLES = ['synthetic_installment_allocations', 'synthetic_installment_revisions',
  'synthetic_statement_allocations', 'synthetic_statement_links', 'synthetic_restart_marker'] as const;
const SYNTHETIC_DDL = [
  `CREATE TABLE synthetic_installment_allocations (id TEXT PRIMARY KEY NOT NULL,
    installment_purchase_id TEXT NOT NULL REFERENCES installment_purchases(id) ON DELETE CASCADE, amount_text TEXT NOT NULL)`,
  `CREATE TABLE synthetic_installment_revisions (id TEXT PRIMARY KEY NOT NULL,
    installment_purchase_id TEXT REFERENCES installment_purchases(id) ON DELETE SET NULL)`,
  `CREATE TABLE synthetic_statement_allocations (id TEXT PRIMARY KEY NOT NULL,
    statement_id TEXT NOT NULL REFERENCES credit_card_statements(id) ON DELETE CASCADE)`,
  `CREATE TABLE synthetic_statement_links (id TEXT PRIMARY KEY NOT NULL,
    statement_id TEXT REFERENCES credit_card_statements(id) ON DELETE SET NULL)`,
  'CREATE TABLE synthetic_restart_marker (plan_id TEXT NOT NULL, plan_rowid INTEGER NOT NULL, plan_created_at TEXT NOT NULL)',
];

const dependencies = (database: SmartFinSQLiteDatabase) => ({
  accountRepository: createSqliteAccountRepository(database),
  transactionRepository: createSqliteTransactionRepository(database),
  creditCardRepository: createSqliteCreditCardRepository(database),
});
const query = async (database: SmartFinSQLiteDatabase, sql: string, values: (string | number | null)[] = []) =>
  rowsOf((await database.executeSql(sql, values))[0]);

/** Bank 1.000.000, Visa closing on day 20 (cycles 21–20) with a 2.000.000 limit, revision counter at 0. */
async function seed(database: SmartFinSQLiteDatabase) {
  for (const table of SYNTHETIC_TABLES) await database.executeSql(`DROP TABLE IF EXISTS ${table}`);
  await resetSyntheticData(database);
  // resetSyntheticData also empties financial_data_revision; without its row the triggers count nothing.
  await database.executeSql("INSERT INTO financial_data_revision (id, revision, updated_at) VALUES (1, 0, '2026-01-01')");
  await database.executeSql(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,credit_limit_amount,
    description,created_at,updated_at) VALUES
    ('bank','Banco','bankAccount','active','COP',1000000,NULL,NULL,NULL,'2026-01-01','2026-01-01'),
    ('card','Visa','creditCard','active','COP',0,0,2000000,?,'2026-01-01','2026-01-01')`,
  [serializeCreditCardVisualMetadata({ closingDay: 20, paymentDay: 5 })]);
  for (const statement of SYNTHETIC_DDL) await database.executeSql(statement);
}

const revision = async (database: SmartFinSQLiteDatabase) =>
  Number((await query(database, 'SELECT revision FROM financial_data_revision WHERE id = 1'))[0]?.revision);

function purchaseParams(accounts: Awaited<ReturnType<ReturnType<typeof dependencies>['accountRepository']['getAccounts']>>,
  database: SmartFinSQLiteDatabase, date: string, amount: string, installments: number, extra: Partial<SaveManualTransactionParams> = {},
): SaveManualTransactionParams {
  return {
    ...dependencies(database), accounts, accountId: 'card', amount: Number(amount), merchantName: 'Sintetico 1a.3A',
    operationType: 'Crédito', transactionType: 'expense', hasInterestFreeInstallments: false,
    installmentCountInput: String(installments), interestFreeInstallmentCountInput: '', occurrence: { kind: 'date', date },
    currentDate: bogotaNoon(date), now: bogotaNoon(date), ...extra,
  };
}
async function purchase(database: SmartFinSQLiteDatabase, date: string, amount: string, installments: number): Promise<Transaction> {
  return withPhase1A2Clock(bogotaNoon(date), async () => {
    const accounts = await dependencies(database).accountRepository.getAccounts();
    return (await saveManualTransaction(purchaseParams(accounts, database, date, amount, installments))).transaction;
  });
}
/** Edit of the plan's movement on `at`, keeping its civil date. The params object is the request identity. */
async function editParams(database: SmartFinSQLiteDatabase, original: Transaction, at: string, installments: number,
  merchantName = 'Sintetico editada') {
  const accounts = await withPhase1A2Clock(bogotaNoon(at), () => dependencies(database).accountRepository.getAccounts());
  return purchaseParams(accounts, database, original.civilDate ?? original.date.slice(0, 10), String(original.amount), installments,
    { editingTransaction: original, merchantName, currentDate: bogotaNoon(at), now: bogotaNoon(at) });
}
const edit = async (database: SmartFinSQLiteDatabase, original: Transaction, at: string, installments: number, merchantName?: string) => {
  const params = await editParams(database, original, at, installments, merchantName);
  return withPhase1A2Clock(bogotaNoon(at), () => saveManualTransaction(params));
};
const pay = (database: SmartFinSQLiteDatabase, date: string, amount: string) => withPhase1A2Clock(bogotaNoon(date), () =>
  registerCreditCardPayment({ ...dependencies(database), accountId: 'card', sourceAccountId: 'bank', amount: Number(amount),
    currentDate: bogotaNoon(date), settlement: 'partial' }));
const reconcile = (database: SmartFinSQLiteDatabase, date: string) => withPhase1A2Clock(bogotaNoon(date), () =>
  reconcileCreditCardTransactions({ ...dependencies(database), currentDate: bogotaNoon(date) }));

async function plans(database: SmartFinSQLiteDatabase) {
  return query(database, 'SELECT rowid AS row_id, * FROM installment_purchases ORDER BY rowid');
}
async function statementRows(database: SmartFinSQLiteDatabase) {
  return query(database, 'SELECT rowid AS row_id, * FROM credit_card_statements ORDER BY statement_start_date, rowid');
}
async function addDependents(database: SmartFinSQLiteDatabase) {
  const [plan] = await plans(database);
  const [statement] = await statementRows(database);
  if (plan) {
    await database.executeSql("INSERT INTO synthetic_installment_allocations VALUES ('alloc-1', ?, '100000.00')", [String(plan.id)]);
    await database.executeSql("INSERT INTO synthetic_installment_revisions VALUES ('revision-1', ?)", [String(plan.id)]);
  }
  if (statement) {
    await database.executeSql("INSERT INTO synthetic_statement_allocations VALUES ('statement-alloc-1', ?)", [String(statement.id)]);
    await database.executeSql("INSERT INTO synthetic_statement_links VALUES ('statement-link-1', ?)", [String(statement.id)]);
  }
}
async function dependents(database: SmartFinSQLiteDatabase) {
  const result: Record<string, Row[]> = {};
  for (const table of SYNTHETIC_TABLES.slice(0, 4)) result[table] = await query(database, `SELECT * FROM ${table} ORDER BY id`);
  return result;
}

/**
 * Financial observation compared field by field with Node: accounts and available credit (BigInt cents), dashboard
 * figures, movements, plans and statements with rowid, dependents, revision counter and SQLite integrity.
 */
async function observe(database: SmartFinSQLiteDatabase, date: string) {
  const accounts = await query(database, `SELECT id, balance_amount, debt_balance_amount, credit_limit_amount, created_at, updated_at
    FROM accounts ORDER BY id`);
  const card = accounts.find(account => account.id === 'card');
  const summary = await getDashboardSummaryFromDb(database, bogotaNoon(date));
  const integrity = await query(database, 'PRAGMA integrity_check');
  const foreignKeys = await query(database, 'PRAGMA foreign_key_check');
  check(integrity[0]?.integrity_check === 'ok' && foreignKeys.length === 0, 'SQLite integrity / foreign keys');
  return {
    accounts,
    availableCredit: card ? centsText(textCents(String(card.credit_limit_amount)) - textCents(String(card.debt_balance_amount))) : null,
    summary: { availableBalance: summary.availableBalance, totalDebt: summary.totalDebt, netWorth: summary.netWorth,
      monthlyIncome: summary.monthlyIncome, monthlyExpenses: summary.monthlyExpenses, monthlySavings: summary.monthlySavings },
    transactions: await query(database, 'SELECT * FROM transactions ORDER BY created_at, rowid'),
    installmentPurchases: await plans(database),
    statements: await statementRows(database),
    profiles: await query(database, 'SELECT rowid AS row_id, * FROM credit_card_profiles ORDER BY rowid'),
    dependents: await dependents(database),
    revision: await revision(database),
    integrity: { integrityCheck: 'ok', foreignKeyViolations: 0 },
  };
}
type Observation = Awaited<ReturnType<typeof observe>>;

/** Movement ids embed the clock and a per-process sequence: renamed T1..Tn in creation order, references included. */
async function canonical<T>(database: SmartFinSQLiteDatabase, value: T): Promise<T> {
  const ids = (await query(database, 'SELECT id FROM transactions ORDER BY created_at, rowid')).map(row => String(row.id));
  const order = ids.map((id, index) => [id, `T${index + 1}`] as const).sort((a, b) => b[0].length - a[0].length);
  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') return order.reduce((text, [id, label]) => text.split(id).join(label), input);
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, walk(item)]));
    return input;
  };
  return walk(value) as T;
}

const amountOf = (rows: Row[], id: string, column: string) => rows.find(row => row.id === id)?.[column];
function expectMoney(observation: Observation, bank: string, debt: string, expense: string) {
  check(textCents(String(amountOf(observation.accounts, 'bank', 'balance_amount'))) === textCents(bank), `Bank ${bank}`);
  check(textCents(String(amountOf(observation.accounts, 'card', 'debt_balance_amount'))) === textCents(debt), `Debt ${debt}`);
  check(observation.availableCredit === centsText(textCents('2000000') - textCents(debt)), 'Available credit');
  check(textCents(String(observation.summary.netWorth)) === textCents(bank) - textCents(debt), 'Net worth');
  check(textCents(String(observation.summary.monthlyExpenses)) === textCents(expense), `Expense ${expense}`);
}
/** Same id, rowid and created_at; dependents untouched. */
function expectSameIdentity(before: Row[], after: Row[], what: string) {
  const identity = (rows: Row[]) => json(rows.map(row => [row.id, row.row_id, row.created_at]));
  check(identity(after.slice(0, before.length)) === identity(before), `${what}: identity changed`);
}
function expectDependentsKept(before: Observation, after: Observation) {
  check(json(after.dependents) === json(before.dependents), 'Dependents lost or modified');
  check(Object.values(after.dependents).every(rows => rows.length === 1), 'Dependent rows missing');
}
const at = (date: string) => bogotaNoon(date).toISOString();

export async function runPhase1A3AProbe(database: SmartFinSQLiteDatabase, name: Phase1A3AProbe): Promise<unknown> {
  await seed(database);
  const result = await probe(database, name);
  return canonical(database, result);
}

async function probe(database: SmartFinSQLiteDatabase, name: Phase1A3AProbe): Promise<unknown> {
  switch (name) {
    // New plan and statement are inserted once, with created_at = updated_at = the pinned clock.
    case 'insertNew': {
      const start = await revision(database);
      await purchase(database, '2026-10-11', '300000', 3);
      const after = await observe(database, '2026-10-11');
      check(after.installmentPurchases.length === 1 && after.statements.length === 1, 'One plan and one statement');
      const [plan] = after.installmentPurchases;
      check(plan?.created_at === at('2026-10-11') && plan.updated_at === at('2026-10-11'), 'Plan audit fields');
      check(after.statements[0]?.total_amount === 100000 && after.statements[0].status === 'pending', 'First installment billed');
      expectMoney(after, '1000000', '300000', '300000');
      return { after, revisionDelta: after.revision - start };
    }
    // Edit without new terms: identity, progress, monthly amount and dependents kept; updated_at moves.
    case 'editPlanUnchangedTerms':
    case 'editPlanChangedTerms': {
      const original = await purchase(database, '2026-10-11', '300000', 3);
      await database.executeSql('UPDATE installment_purchases SET paid_installments = 1');
      await addDependents(database);
      const before = await observe(database, '2026-10-12');
      const installments = name === 'editPlanUnchangedTerms' ? 3 : 6;
      await edit(database, original, '2026-10-12', installments);
      const after = await observe(database, '2026-10-12');
      expectSameIdentity(before.installmentPurchases, after.installmentPurchases, 'Plan');
      expectSameIdentity(before.statements, after.statements, 'Statement');
      expectDependentsKept(before, after);
      const plan = after.installmentPurchases[0]!;
      check(after.installmentPurchases.length === 1 && plan.merchant_name === 'Sintetico editada', 'Plan edited in place');
      check(plan.updated_at === at('2026-10-12'), 'Plan updated_at');
      // Approved behavior: unchanged terms keep progress; new terms restart the plan (pending for 1a.3B).
      check(name === 'editPlanUnchangedTerms'
        ? plan.paid_installments === 1 && plan.monthly_amount === 100000
        : plan.paid_installments === 0 && plan.monthly_amount === 50000 && plan.installment_count === 6, 'Plan terms');
      expectMoney(after, '1000000', '300000', '300000');
      return { before, after, revisionDelta: after.revision - before.revision };
    }
    // A payment rewrites the current statement in place: same row, settled total, dependents untouched.
    case 'statementPaymentInPlace': {
      await purchase(database, '2026-10-11', '600000', 6);
      await addDependents(database);
      const before = await observe(database, '2026-10-13');
      await pay(database, '2026-10-13', '100000');
      const after = await observe(database, '2026-10-13');
      expectSameIdentity(before.statements, after.statements, 'Statement');
      expectSameIdentity(before.installmentPurchases, after.installmentPurchases, 'Plan');
      expectDependentsKept(before, after);
      const statement = after.statements[0]!;
      check(after.statements.length === 1 && statement.total_amount === 0 && statement.status === 'paid', 'Statement settled');
      check(statement.updated_at === at('2026-10-13'), 'Statement updated_at');
      expectMoney(after, '900000', '500000', '600000');
      return { before, after, revisionDelta: after.revision - before.revision };
    }
    // Repeated and later reconciliations: no duplicate, earlier statements keep row, created_at and dependents.
    case 'repeatedReconciliation': {
      await purchase(database, '2026-10-11', '600000', 6);
      await addDependents(database);
      const first = await observe(database, '2026-10-11');
      const steps: unknown[] = [];
      for (const date of ['2026-10-11', '2026-10-15', '2026-11-11', '2026-11-15', '2026-12-11', '2026-12-11']) {
        await reconcile(database, date);
        const step = await observe(database, date);
        expectSameIdentity(first.statements, step.statements, `Statements on ${date}`);
        expectDependentsKept(first, step);
        steps.push({ date, statements: step.statements, revision: step.revision });
      }
      const last = await observe(database, '2026-12-11');
      check(json(last.statements.map(row => [row.statement_end_date, row.total_amount])) ===
        json([['2026-10-20', 100000], ['2026-11-20', 100000], ['2026-12-20', 100000]]), 'One statement per cycle');
      expectMoney(last, '1000000', '600000', '0');
      return { first, steps, last };
    }
    // Profile: created_at stays the first one, updated_at and the rate change, same rowid.
    case 'profileUpdate': {
      const { creditCardRepository } = dependencies(database);
      const start = await revision(database);
      await creditCardRepository.saveProfiles([{ accountId: 'card', monthlyInterestRate: 0.02, createdAt: at('2026-10-11'), updatedAt: at('2026-10-11') }]);
      const first = await observe(database, '2026-10-11');
      await creditCardRepository.saveProfiles([{ accountId: 'card', monthlyInterestRate: 0.03, createdAt: at('2026-10-12'), updatedAt: at('2026-10-12') }]);
      const second = await observe(database, '2026-10-12');
      expectSameIdentity(first.profiles.map(row => ({ ...row, id: row.account_id })), second.profiles.map(row => ({ ...row, id: row.account_id })), 'Profile');
      check(second.profiles.length === 1 && second.profiles[0]?.monthly_interest_rate === 0.03 &&
        second.profiles[0].created_at === at('2026-10-11') && second.profiles[0].updated_at === at('2026-10-12'), 'Profile updated in place');
      return { first, second, revisionDeltas: [first.revision - start, second.revision - first.revision] };
    }
    // Writes with missing references fail (no OR IGNORE) and leave nothing behind.
    case 'rejectMissingReference': {
      const { creditCardRepository } = dependencies(database);
      const start = await observe(database, '2026-10-11');
      const orphan: InstallmentPurchase = { id: 'installment-orphan', transactionId: 'missing-transaction', accountId: 'card',
        totalAmount: 1, currency: 'COP', installmentCount: 2, paidInstallments: 0, monthlyAmount: 1, status: 'active',
        createdAt: '2026-10-11', updatedAt: '2026-10-11' };
      const attempts = {
        installmentPurchase: () => creditCardRepository.saveInstallmentPurchases([orphan]),
        statement: () => creditCardRepository.saveStatements([{ id: 'statement-orphan', accountId: 'missing-account',
          statementStartDate: '2026-09-21', statementEndDate: '2026-10-20', paymentDueDate: '2026-11-05', totalAmount: 1,
          currency: 'COP', status: 'pending', createdAt: '2026-10-11', updatedAt: '2026-10-11' }]),
        profile: () => creditCardRepository.saveProfiles([{ accountId: 'missing-account', monthlyInterestRate: 0.01,
          createdAt: '2026-10-11', updatedAt: '2026-10-11' }]),
      };
      const outcomes: Record<string, { rejected: boolean; foreignKey: boolean }> = {};
      for (const [kind, attempt] of Object.entries(attempts)) {
        let failure: unknown;
        try { await attempt(); } catch (error) { failure = error; }
        outcomes[kind] = { rejected: failure !== undefined, foreignKey: /FOREIGN KEY/i.test(errorText(failure)) };
        check(outcomes[kind]!.rejected, `${kind}: missing reference accepted`);
      }
      const after = await observe(database, '2026-10-11');
      check(json(after) === json(start), 'A rejected write left changes');
      return { outcomes, after };
    }
    // Columns the repository does not write (future migration 5) survive edits and payments.
    case 'unlistedColumns': {
      const original = await purchase(database, '2026-10-11', '600000', 6);
      for (const table of ['installment_purchases', 'credit_card_statements']) {
        await database.executeSql(`ALTER TABLE ${table} ADD COLUMN synthetic_extra TEXT DEFAULT 'default'`);
        await database.executeSql(`UPDATE ${table} SET synthetic_extra = 'kept'`);
      }
      await edit(database, original, '2026-10-12', 6);
      await pay(database, '2026-10-13', '100000');
      await reconcile(database, '2026-11-11');
      const after = await observe(database, '2026-11-11');
      check(after.installmentPurchases[0]?.synthetic_extra === 'kept', 'Plan extra column reset');
      check(json(after.statements.map(row => row.synthetic_extra)) === json(['kept', 'default']), 'Statement extra column');
      expectMoney(after, '900000', '500000', '0');
      return { after };
    }
  }
}

/** Fault injection on the write boundaries, provided by each runtime (node:sqlite trace / APK managed proxy). */
export type Phase1A3AFaults = {
  countWrites: (run: () => Promise<unknown>) => Promise<number>;
  arm: (write: number, phase: 'before' | 'after') => { fired: () => boolean; isInjected: (error: unknown) => boolean };
  disarm: () => void;
};

async function prepareMatrix(database: SmartFinSQLiteDatabase, name: Phase1A3AMatrix) {
  await seed(database);
  if (name === 'planEdit') {
    const original = await purchase(database, '2026-10-11', '300000', 3);
    await database.executeSql('UPDATE installment_purchases SET paid_installments = 1');
    await addDependents(database);
    const params = await editParams(database, original, '2026-10-12', 3);
    return { date: '2026-10-12', params, run: () => withPhase1A2Clock(bogotaNoon('2026-10-12'), () => saveManualTransaction(params)) };
  }
  await purchase(database, '2026-10-11', '600000', 6);
  await addDependents(database);
  return { date: '2026-10-13', params: undefined, run: () => pay(database, '2026-10-13', '100000') };
}

/** Every table with rowids (revision included), dashboard figures and integrity: the exact rollback oracle. */
async function fullState(database: SmartFinSQLiteDatabase, date: string) {
  const tables: Record<string, Row[]> = {};
  for (const { name } of await query(database, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) {
    check(typeof name === 'string' && /^[a-z0-9_]+$/.test(name), 'Unexpected table name');
    tables[String(name)] = await query(database, `SELECT rowid AS row_id, * FROM ${String(name)} ORDER BY rowid`);
  }
  const summary = await getDashboardSummaryFromDb(database, bogotaNoon(date));
  return { tables, summary, integrity: await query(database, 'PRAGMA integrity_check'), foreignKeys: await query(database, 'PRAGMA foreign_key_check') };
}

/**
 * Write count of a successful run (compared with Node), then every write before/after: the original injected error
 * propagates, rollback is confirmed (not unknown), the connection stays usable, a new owner confirms a transaction
 * (none left open) and every table, rowid, dependent, revision and dashboard figure equals the state before.
 */
export async function runPhase1A3AMatrix(database: SmartFinSQLiteDatabase, name: Phase1A3AMatrix, faults: Phase1A3AFaults,
  record: (label: string, operation: () => Promise<unknown>) => Promise<unknown>) {
  let writes = 0;
  await record(`${name}-success`, async () => {
    const { date, run } = await prepareMatrix(database, name);
    const before = await observe(database, date);
    writes = await faults.countWrites(run);
    const after = await observe(database, date);
    expectSameIdentity(before.installmentPurchases, after.installmentPurchases, 'Plan');
    expectSameIdentity(before.statements, after.statements, 'Statement');
    expectDependentsKept(before, after);
    check(writes > 0, 'Write instrumentation missing');
    return canonical(database, { writes, points: writes * 2, after });
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
      check(json(after) === json(before), 'Rollback changed tables, rowids, dependents, revision or figures');
      return { write, phase, status: 'rolledBack', exactStateRestored: true, nextOwnerConfirmed: true };
    });
  }
  return writes;
}

/**
 * Lost COMMIT response on a plan edit with dependents: `unknown`, the same request is never executed again and the
 * connection is retired. The marker row lets the restart check find the plan identity after reopening.
 */
export async function runPhase1A3AUnknown(database: SmartFinSQLiteDatabase, loseCommit: (lost: boolean) => void) {
  const { params, run } = await prepareMatrix(database, 'planEdit');
  const [plan] = await plans(database);
  await database.executeSql('INSERT INTO synthetic_restart_marker VALUES (?, ?, ?)', [String(plan!.id), Number(plan!.row_id), String(plan!.created_at)]);
  check(params !== undefined, 'Unknown scenario seeded');
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

/** After reopening: the edit committed exactly once, identity and dependents kept, money unchanged, integrity ok. */
export async function checkPhase1A3AAfterRestart(database: SmartFinSQLiteDatabase) {
  const [marker] = await query(database, 'SELECT * FROM synthetic_restart_marker');
  check(marker, 'Restart marker missing');
  const after = await observe(database, '2026-10-12');
  const [plan] = after.installmentPurchases;
  check(after.installmentPurchases.length === 1 && plan !== undefined && plan.id === marker!.plan_id && plan.row_id === marker!.plan_rowid &&
    plan.created_at === marker!.plan_created_at, 'Plan identity after restart');
  check(plan.merchant_name === 'Sintetico editada' && plan.updated_at === at('2026-10-12'), 'Edit persisted once');
  check(after.transactions.length === 1, 'Movement duplicated or missing');
  check(Object.values(after.dependents).every(rows => rows.length === 1), 'Dependents lost');
  expectMoney(after, '1000000', '300000', '300000');
  return canonical(database, { marker, after });
}
