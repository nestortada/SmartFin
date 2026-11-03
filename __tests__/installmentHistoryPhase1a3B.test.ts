// Phase 1a.3B: migration 5 (installment allocations, plan revisions, billing metadata) and its repositories.
// Synthetic in-memory SQLite only.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState, type FinancialState } from './helpers/financialState';
import { realSQLite } from './helpers/realSQLite';
import { applyVersionedMigrations } from '../src/database/migrations';
import { runSharedSQLiteTransaction } from '../src/database/atomicSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { SHARED_LOSS_SCHEMA } from '../src/modules/transactions/database/sharedLossSchema';
import {
  SHARED_EXPENSE_INDEXES,
  SHARED_EXPENSE_SCHEMA,
  SHARED_EXPENSE_TRIGGERS,
} from '../src/modules/transactions/database/sharedExpenseSchema';
import {
  INSTALLMENT_HISTORY_SCHEMA,
  INSTALLMENT_HISTORY_TABLE_NAMES,
} from '../src/modules/creditCards/database/installmentHistorySchema';
import { buildOriginalInstallmentRevision } from '../src/modules/creditCards/database/originalInstallmentRevisions';
import { createSqliteInstallmentHistoryRepository } from '../src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository';
import { selectEffectivePlanRevision } from '../src/modules/creditCards/useCases/installmentPlanRevisions';
import { registerCreditCardPayment } from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { deleteManualTransactionSafely } from '../src/modules/transactions/useCases/saveManualTransaction';
import { createSqliteFinancialDataRepository } from '../src/modules/settings/repositories/sqliteFinancialDataRepository';
import type { InstallmentPlanRevision, NewInstallmentPlanRevision } from '../src/modules/creditCards/types';
import type { SQLitePrimitive } from '../src/database/sqliteRows';

type Fixture = Awaited<ReturnType<typeof financialIntegrityFixture>>;
type Rows = Record<string, SQLitePrimitive>[];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

const NEW_TABLES: readonly string[] = INSTALLMENT_HISTORY_TABLE_NAMES;
const rows = (f: { query: Fixture['query'] }, sql: string, values: SQLitePrimitive[] = []): Rows =>
  f.query(sql, values).rows.raw();
const revisionCounter = (f: Fixture) => Number(rows(f, 'SELECT revision FROM financial_data_revision')[0]!.revision);
const versions = (f: Fixture) => rows(f, 'SELECT version FROM schema_migrations ORDER BY version').map(row => row.version);
const schema = (f: { query: Fixture['query'] }) =>
  rows(f, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name");
const planRevisions = (f: Fixture) => rows(f, 'SELECT * FROM installment_plan_revisions ORDER BY installment_purchase_id, revision_number');
const allocations = (f: Fixture) => rows(f, 'SELECT * FROM installment_allocations ORDER BY id');

/** Drops every migration 5 object, as on an installation that still runs version 4. */
function downgradeToVersion4(f: Fixture) {
  const triggers = rows(f, `SELECT name FROM sqlite_master WHERE type = 'trigger'
    AND (sql LIKE '%installment_allocations%' OR sql LIKE '%installment_plan_revisions%'
      OR sql LIKE '%credit_card_billing_rules%' OR sql LIKE '%installment_first_cycles%')`);
  for (const { name } of triggers) f.native.exec(`DROP TRIGGER "${String(name)}";`);
  for (const table of ['installment_plan_revisions', 'installment_allocations', 'installment_first_cycles', 'credit_card_billing_rules'])
    f.native.exec(`DROP TABLE ${table};`);
  f.native.exec('DELETE FROM schema_migrations WHERE version = 5;');
}

/** Pristine version 4 schema: the full schema minus migration 5, with migrations 1-4 applied. */
async function pristineVersion4Schema() {
  const sql = realSQLite({ fixedSqlDate: FINANCIAL_TEST_DATE });
  sql.native.exec('PRAGMA foreign_keys = ON;');
  sql.native.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
  sql.native.exec("INSERT INTO schema_migrations VALUES (5, 'placeholder');");
  for (const statement of SQLITE_SCHEMA_STATEMENTS) if (!INSTALLMENT_HISTORY_SCHEMA.includes(statement)) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  sql.native.exec('DELETE FROM schema_migrations WHERE version = 5;');
  const result = schema(sql);
  sql.native.close();
  return result;
}

/** Installed data: purchases saved by the production use cases, a payment, plus synthetic legacy rows. */
async function populatedVersion4(f: Fixture) {
  const exact = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3', amount: 300000 });
  await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '6', amount: 1234.56, merchantName: 'Centavos' });
  await f.save({ accountId: 'card', operationType: 'Crédito', amount: 50000, merchantName: 'Una cuota' });
  const payment = await registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount: 100000, currentDate: FINANCIAL_TEST_DATE });
  // Legacy rows the use cases no longer produce. Their movements exist; balances are not recomputed.
  const legacy = f.native.prepare(`INSERT INTO installment_purchases (id, transaction_id, account_id, merchant_name, total_amount,
    currency, installment_count, paid_installments, monthly_amount, first_due_date, status, created_at, updated_at)
    VALUES (?, ?, 'card', 'Legado', ?, 'COP', ?, ?, ?, NULL, ?, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`);
  legacy.run('legacy-inexact', exact.transaction.id, 0.1 + 0.2, 3, 1, 0.1, 'active');
  legacy.run('legacy-zero-count', exact.transaction.id, 90000, 0, 0, 90000, 'cancelled');
  legacy.run('legacy-long', exact.transaction.id, 1200000, 400, 400, 3000, 'paid');
  legacy.run('legacy-huge', exact.transaction.id, 2 ** 47, 2, 0, 2 ** 46, 'active');
  return { exact, payment };
}

async function migratedFixture() {
  const f = await financialIntegrityFixture({ managed: true });
  const data = await populatedVersion4(f);
  downgradeToVersion4(f);
  await applyVersionedMigrations(f.database);
  return { f, ...data };
}

function withoutNewTables(state: FinancialState) {
  const tables = Object.fromEntries(Object.entries(state.tables)
    .filter(([name]) => !NEW_TABLES.includes(name) && name !== 'schema_migrations'));
  return { ...state, tables };
}

const historyRepository = (f: Fixture) => createSqliteInstallmentHistoryRepository(f.database);
const currentTransaction = async (f: Fixture, id: string) => {
  const transaction = (await f.transactionRepository.getTransactions()).find(row => row.id === id);
  if (!transaction) throw new Error('missing transaction');
  return transaction;
};

/** Revision 0 rows expected for the purchases currently stored, computed with the migration builder. */
function expectedOriginalRevisions(f: Fixture) {
  return rows(f, 'SELECT id, total_amount, monthly_amount, installment_count FROM installment_purchases ORDER BY id')
    .map(buildOriginalInstallmentRevision)
    .map(revision => ({
      id: revision.id, installment_purchase_id: revision.installmentPurchaseId, revision_number: 0, source: 'original',
      allocation_id: null, remaining_principal_cents: revision.remainingPrincipalCents,
      remaining_installments: revision.remainingInstallments, installment_amount_cents: revision.installmentAmountCents,
      effective_cycle_end: null, verification: 'pendingVerification', pending_reasons: revision.pendingReasons.join(','),
      basis_total_amount: revision.basis.totalAmount, basis_monthly_amount: revision.basis.monthlyAmount,
      basis_installment_count: revision.basis.installmentCount, created_at: FINANCIAL_TEST_DATE.toISOString(),
    }));
}

async function purchaseIdOf(f: Fixture, transactionId: string) {
  const purchase = (await f.creditCardRepository.getInstallmentPurchases(['card'])).find(row => row.transactionId === transactionId);
  if (!purchase) throw new Error('missing purchase');
  return purchase.id;
}

async function allocate(f: Fixture, purchaseId: string, paymentId: string, commandId = 'command-1', amountCents = 5000000) {
  return historyRepository(f).saveAllocations(commandId, [{
    id: `${commandId}:${purchaseId}`, paymentTransactionId: paymentId, installmentPurchaseId: purchaseId,
    amountCents, mode: 'unspecified', createdAt: '2026-10-11T12:00:00.000Z',
  }]);
}

describe('migration 5 schema', () => {
  test('a version 4 database is reproduced exactly by removing the migration 5 objects', async () => {
    const f = await financialIntegrityFixture();
    try {
      downgradeToVersion4(f);
      expect(schema(f)).toEqual(await pristineVersion4Schema());
      expect(versions(f)).toEqual([1, 2, 3, 4]);
    } finally { f.native.close(); }
  });

  test('a new installation gets the same migration 5 objects through the versioned migration', async () => {
    const sql = realSQLite({ fixedSqlDate: FINANCIAL_TEST_DATE });
    try {
      // Same statement filter as applySchema in sqliteDatabase.ts.
      const deferred = [...SHARED_LOSS_SCHEMA, ...SHARED_EXPENSE_SCHEMA, ...SHARED_EXPENSE_INDEXES,
        ...SHARED_EXPENSE_TRIGGERS, ...INSTALLMENT_HISTORY_SCHEMA];
      for (const statement of SQLITE_SCHEMA_STATEMENTS) if (!deferred.includes(statement)) sql.native.exec(statement);
      await applyVersionedMigrations(sql.database);
      const reference = await financialIntegrityFixture();
      const migrationObjects = (f: { query: Fixture['query'] }) => schema(f).filter(row =>
        NEW_TABLES.includes(String(row.tbl_name)) || NEW_TABLES.some(table => String(row.sql).includes(table)));
      expect(migrationObjects(sql)).toEqual(migrationObjects(reference));
      expect(migrationObjects(sql).length).toBeGreaterThan(20);
      expect(rows(sql, 'SELECT version FROM schema_migrations ORDER BY version').map(row => row.version)).toEqual([1, 2, 3, 4, 5]);
      expect(rows(sql, 'SELECT count(*) AS total FROM installment_plan_revisions')).toEqual([{ total: 0 }]);
      expect(rows(sql, 'PRAGMA foreign_key_check')).toEqual([]);
      reference.native.close();
    } finally { sql.native.close(); }
  });

  test('migration 5 uses no SQL newer than SQLite 3.9.2 and never INSERT OR REPLACE', () => {
    const text = [...INSTALLMENT_HISTORY_SCHEMA, String(applyVersionedMigrations)].join('\n');
    for (const forbidden of [/\bON\s+CONFLICT\b/i, /\bRETURNING\b/i, /\bOR\s+REPLACE\b/i, /\bOVER\s*\(/i,
      /\bGENERATED\b/i, /\bWITHOUT\s+ROWID\b/i, /\biif\s*\(/i, /\bSTRICT\b/, /->>/, /\bDROP\s+COLUMN\b/i, /\bRENAME\s+COLUMN\b/i])
      expect(text).not.toMatch(forbidden);
  });
});

describe('migration 4 -> 5 with installed data', () => {
  test('creates one exact or pending revision 0 per purchase and changes nothing financial', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      const { exact } = await populatedVersion4(f);
      downgradeToVersion4(f);
      const before = await financialState(f);
      const revisionBefore = revisionCounter(f);
      await applyVersionedMigrations(f.database);
      const after = await financialState(f);
      // Movements, balances, debt, wealth, income, expenses, statements, purchases and the backup counter.
      expect(withoutNewTables(after)).toEqual(withoutNewTables(before));
      expect(after.metrics).toEqual(before.metrics);
      expect(revisionCounter(f)).toBe(revisionBefore);
      expect(versions(f)).toEqual([1, 2, 3, 4, 5]);
      expect(after.integrity.foreignKeyViolations).toEqual([]);

      const exactId = await purchaseIdOf(f, exact.transaction.id);
      const byPurchase: Record<string, Rows[number]> = Object.fromEntries(planRevisions(f).map(row => [String(row.installment_purchase_id), row]));
      expect(Object.keys(byPurchase)).toHaveLength(6);
      const common = { revision_number: 0, source: 'original', allocation_id: null, effective_cycle_end: null,
        verification: 'pendingVerification', created_at: FINANCIAL_TEST_DATE.toISOString() };
      expect(byPurchase[exactId]).toEqual({ ...common, id: `${exactId}:revision:0`, installment_purchase_id: exactId,
        remaining_principal_cents: 30000000, remaining_installments: 3, installment_amount_cents: 10000000,
        pending_reasons: 'firstCycleUnconfirmed', basis_total_amount: 300000, basis_monthly_amount: 100000,
        basis_installment_count: 3 });
      const cents = Object.values(byPurchase).find(row => row.basis_total_amount === 1234.56)!;
      // Stored monthly amount is the legacy Math.round(1234.56 / 6) = 206; kept as recorded, not re-derived.
      expect(cents).toMatchObject({ remaining_principal_cents: 123456, remaining_installments: 6,
        installment_amount_cents: 20600, basis_monthly_amount: 206 });
      expect(byPurchase['legacy-inexact']).toMatchObject({ remaining_principal_cents: null, remaining_installments: 3,
        installment_amount_cents: 10, pending_reasons: 'firstCycleUnconfirmed,inexactHistoricalAmount',
        basis_total_amount: 0.1 + 0.2 });
      expect(byPurchase['legacy-zero-count']).toMatchObject({ remaining_installments: null,
        pending_reasons: 'firstCycleUnconfirmed,invalidInstallmentCount', basis_installment_count: 0 });
      expect(byPurchase['legacy-long']).toMatchObject({ remaining_installments: null, remaining_principal_cents: 120000000,
        pending_reasons: 'firstCycleUnconfirmed,invalidInstallmentCount' });
      expect(byPurchase['legacy-huge']).toMatchObject({ remaining_principal_cents: null, installment_amount_cents: null,
        pending_reasons: 'firstCycleUnconfirmed,inexactHistoricalAmount,inexactInstallmentAmount', basis_total_amount: 2 ** 47 });
      expect(planRevisions(f).filter(row => row.verification !== 'pendingVerification')).toEqual([]);
      // Single-installment purchases have no installment plan row, so no revision either.
      expect(rows(f, 'SELECT count(*) AS total FROM installment_purchases')).toEqual([{ total: 6 }]);
    } finally { f.native.close(); }
  });

  test('a repeated migration is a no-op', async () => {
    const { f } = await migratedFixture();
    try {
      const first = await financialState(f);
      const masterBefore = schema(f);
      f.resetTrace();
      await applyVersionedMigrations(f.database);
      await applyVersionedMigrations(f.database);
      expect(await financialState(f)).toEqual(first);
      expect(schema(f)).toEqual(masterBefore);
      expect(f.trace.filter(entry => entry.write !== undefined)).toEqual([]);
    } finally { f.native.close(); }
  });

  test('the revision 0 builder never rounds and never invents a confirmed cycle', () => {
    for (const [amount, cents] of [[0.07, 7], [1e-3, null], [-5, null], [Number.POSITIVE_INFINITY, null], [12.345, null]] as const) {
      const revision = buildOriginalInstallmentRevision({ id: 'p', total_amount: amount, monthly_amount: 1, installment_count: 2 });
      expect(revision.remainingPrincipalCents).toBe(cents);
      expect(revision.basis.totalAmount).toBe(amount);
      expect(revision.pendingReasons).toContain('firstCycleUnconfirmed');
    }
    expect(buildOriginalInstallmentRevision({ id: 'p', total_amount: '100', monthly_amount: 1, installment_count: 2 }))
      .toMatchObject({ remainingPrincipalCents: null, pendingReasons: ['firstCycleUnconfirmed', 'inexactHistoricalAmount'] });
    expect(() => buildOriginalInstallmentRevision({ id: null, total_amount: 1, monthly_amount: 1, installment_count: 1 })).toThrow();
  });
});

describe('migration 5 atomicity', () => {
  const FAULTS = [
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
  ];

  test.each(FAULTS.flatMap(sql => (['before', 'after'] as const).map(phase => [sql, phase] as const)))(
    'failure at %s (%s) rolls back to the exact version 4 state and the next start recovers',
    async (sql, phase) => {
      const reference = await migratedFixture();
      const expectedSchema = schema(reference.f);
      reference.f.native.close();

      const f = await financialIntegrityFixture({ managed: true });
      try {
        await populatedVersion4(f);
        downgradeToVersion4(f);
        const before = { state: await financialState(f), schema: schema(f), revision: revisionCounter(f) };
        // 'after' on the revision 0 batch fails once its rows were written.
        f.injectFault({ phase, sql });
        await expect(applyVersionedMigrations(f.database)).rejects.toThrow('Injected SQLite failure');
        expect({ state: await financialState(f), schema: schema(f), revision: revisionCounter(f) }).toEqual(before);
        expect(versions(f)).toEqual([1, 2, 3, 4]);

        await applyVersionedMigrations(f.database);
        expect(schema(f)).toEqual(expectedSchema);
        expect(withoutNewTables(await financialState(f))).toEqual(withoutNewTables(before.state));
        expect(revisionCounter(f)).toBe(before.revision);
        expect(versions(f)).toEqual([1, 2, 3, 4, 5]);
        expect(planRevisions(f)).toEqual(expectedOriginalRevisions(f));
        expect(planRevisions(f)).toHaveLength(6);
      } finally { f.native.close(); }
    },
  );
});

describe('integrity rules', () => {
  test('revisions are append-only, sequential, deterministic and reference an existing purchase', async () => {
    const { f, exact } = await migratedFixture();
    try {
      const id = await purchaseIdOf(f, exact.transaction.id);
      const insert = (number: number, purchase = id, source = 'original') => f.native.prepare(`INSERT INTO installment_plan_revisions
        (id, installment_purchase_id, revision_number, source, verification, pending_reasons, basis_total_amount,
        basis_monthly_amount, basis_installment_count, created_at)
        VALUES (?, ?, ?, ?, 'pendingVerification', 'manualReview', 1, 1, 1, 'now')`).run(`${purchase}:revision:${number}`, purchase, number, source);
      expect(() => f.native.exec(`UPDATE installment_plan_revisions SET verification = 'confirmed' WHERE installment_purchase_id = '${id}'`))
        .toThrow('solo inserción');
      expect(() => insert(0)).toThrow(/fuera de secuencia|UNIQUE/);
      expect(() => insert(2)).toThrow('fuera de secuencia');
      expect(() => insert(0, 'missing')).toThrow('no existe');
      expect(() => f.native.prepare(`INSERT OR REPLACE INTO installment_plan_revisions (id, installment_purchase_id, revision_number,
        source, verification, pending_reasons, basis_total_amount, basis_monthly_amount, basis_installment_count, created_at)
        VALUES (?, ?, 0, 'original', 'pendingVerification', 'manualReview', 1, 1, 1, 'x')`).run(`${id}:revision:0`, id)).toThrow('fuera de secuencia');
      expect(() => f.native.prepare(`INSERT INTO installment_plan_revisions (id, installment_purchase_id, revision_number, source,
        verification, created_at, remaining_principal_cents, remaining_installments, installment_amount_cents)
        VALUES ('wrong-id', ?, 1, 'statement', 'confirmed', 'x', 1, 1, 1)`).run(id)).toThrow('CHECK');
      // confirmed requires a complete plan with an explicit cycle.
      expect(() => f.native.prepare(`INSERT INTO installment_plan_revisions (id, installment_purchase_id, revision_number, source,
        verification, created_at, remaining_principal_cents, remaining_installments, installment_amount_cents)
        VALUES (?, ?, 1, 'statement', 'confirmed', 'x', 1, 1, 1)`).run(`${id}:revision:1`, id)).toThrow('CHECK');
      expect(planRevisions(f).filter(row => row.installment_purchase_id === id)).toHaveLength(1);
    } finally { f.native.close(); }
  });

  test('allocations validate money, mode, status, purchase, payment card and command', async () => {
    const { f, exact, payment } = await migratedFixture();
    try {
      const id = await purchaseIdOf(f, exact.transaction.id);
      const raw = (values: Partial<Record<string, SQLitePrimitive>>) => f.native.prepare(`INSERT INTO installment_allocations
        (id, payment_transaction_id, installment_purchase_id, amount_cents, mode, status, command_id, created_at, reversed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'x', ?)`).run(...[values.id ?? 'a', values.payment ?? payment.transaction.id,
        values.purchase ?? id, values.amount === undefined ? 100 : values.amount, values.mode ?? 'unspecified',
        values.status ?? 'active', values.command ?? 'c', values.reversed ?? null] as SQLitePrimitive[]);
      // Numeric text such as '100' becomes the exact INTEGER 100 by column affinity; anything else is rejected.
      for (const amount of [0, -1, 1.5, '1.5', 'cien', null, 9007199254740992]) expect(() => raw({ amount })).toThrow();
      expect(() => raw({ mode: 'other' })).toThrow('CHECK');
      expect(() => raw({ status: 'reversed', reversed: 'x' })).toThrow('debe estar activa');
      expect(() => raw({ reversed: 'x' })).toThrow('CHECK');
      expect(() => raw({ purchase: 'missing' })).toThrow('no existe');
      expect(() => raw({ payment: exact.transaction.id })).toThrow('no corresponde');
      raw({ id: 'a1', command: 'c1' });
      // Several partial allocations of the same payment, including to the same purchase from another command.
      raw({ id: 'a2', command: 'c2', purchase: 'legacy-inexact' });
      raw({ id: 'a3', command: 'c3' });
      expect(() => raw({ id: 'a4', command: 'c1' })).toThrow('UNIQUE');
      f.native.exec("INSERT INTO transactions (id, amount, currency, description, date, account_id, type, direction, status, target_account_id, created_at, updated_at) VALUES ('other-payment', 1, 'COP', 'x', '2026-10-11', 'bank', 'creditCardPayment', 'outflow', 'posted', 'card', 'x', 'x')");
      expect(() => raw({ id: 'a5', command: 'c1', purchase: 'legacy-long', payment: 'other-payment' })).toThrow('otro pago');
      expect(() => f.native.exec("UPDATE installment_allocations SET amount_cents = 1 WHERE id = 'a1'")).toThrow('activa a revertida');
      f.native.exec("UPDATE installment_allocations SET status = 'reversed', reversed_at = 'y' WHERE id = 'a1'");
      expect(() => f.native.exec("UPDATE installment_allocations SET status = 'active', reversed_at = NULL WHERE id = 'a1'")).toThrow('activa a revertida');
      // A revision of one purchase cannot cite an allocation of another purchase.
      expect(() => f.native.prepare(`INSERT INTO installment_plan_revisions (id, installment_purchase_id, revision_number, source,
        allocation_id, verification, pending_reasons, created_at) VALUES ('legacy-long:revision:1', 'legacy-long', 1,
        'allocation', 'a2', 'pendingVerification', 'manualReview', 'x')`).run()).toThrow('FOREIGN KEY');
      expect(rows(f, 'PRAGMA foreign_key_check')).toEqual([]);
    } finally { f.native.close(); }
  });

  test('a repeated command is idempotent and a different payload under the same command is rejected', async () => {
    const { f, exact, payment } = await migratedFixture();
    try {
      const id = await purchaseIdOf(f, exact.transaction.id);
      const first = await allocate(f, id, payment.transaction.id);
      expect(first.status).toBe('inserted');
      const counter = revisionCounter(f);
      f.resetTrace();
      const replay = await allocate(f, id, payment.transaction.id);
      expect(replay).toEqual({ status: 'replayed', allocations: first.allocations });
      expect(f.trace.filter(entry => entry.write !== undefined)).toEqual([]);
      expect(revisionCounter(f)).toBe(counter);
      await expect(allocate(f, id, payment.transaction.id, 'command-1', 1)).rejects.toThrow('imputaciones distintas');
      expect(allocations(f)).toHaveLength(1);
    } finally { f.native.close(); }
  });
});

describe('existing edit and delete flows (D5, D6)', () => {
  test('the same operations write the same SQL and produce the same finances on version 4 and version 5', async () => {
    const run = async (version: 4 | 5) => {
      jest.setSystemTime(FINANCIAL_TEST_DATE);
      const f = await financialIntegrityFixture({ managed: true });
      const created = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3', amount: 300000 });
      if (version === 4) downgradeToVersion4(f);
      else { downgradeToVersion4(f); await applyVersionedMigrations(f.database); }
      f.resetTrace();
      jest.setSystemTime(new Date(FINANCIAL_TEST_DATE.getTime() + 60_000));
      const edited = await f.save({ editingTransaction: created.transaction, accountId: 'card', operationType: 'Crédito',
        installmentCountInput: '6', amount: 300000 });
      const payment = await registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount: 100000, currentDate: FINANCIAL_TEST_DATE });
      await deleteManualTransactionSafely({ ...f, accounts: await f.accountRepository.getAccounts(), transaction: payment.transaction });
      await deleteManualTransactionSafely({ ...f, accounts: await f.accountRepository.getAccounts(), transaction: edited.transaction });
      const writes = f.trace.filter(entry => entry.write !== undefined).map(entry => entry.sql);
      const state = withoutNewTables(await financialState(f));
      const history = version === 5 ? planRevisions(f) : [];
      f.native.close();
      return { writes, state, history };
    };
    const v4 = await run(4);
    const v5 = await run(5);
    expect(v5.writes).toEqual(v4.writes);
    const { financial_data_revision: revision4, ...tables4 } = v4.state.tables;
    const { financial_data_revision: revision5, ...tables5 } = v5.state.tables;
    expect({ ...v5.state, tables: tables5 }).toEqual({ ...v4.state, tables: tables4 });
    // Only the two history rows appended by triggers add to the backup counter.
    expect(Number(revision5![0]!.revision) - Number(revision4![0]!.revision)).toBe(2);
    expect(v5.history.map(row => [row.revision_number, row.source, row.verification, row.pending_reasons,
      row.basis_installment_count])).toEqual([
      [0, 'original', 'pendingVerification', 'firstCycleUnconfirmed', 3],
      [1, 'purchaseEdit', 'pendingVerification', 'termsChanged', 6],
      [2, 'purchaseRemoval', 'pendingVerification', 'purchaseRemoved', null],
    ]);
  });

  test('editing a purchase without new terms appends nothing; the first cycle survives edits and follows deletion', async () => {
    const { f, exact } = await migratedFixture();
    try {
      const id = await purchaseIdOf(f, exact.transaction.id);
      const repository = historyRepository(f);
      await repository.saveFirstCycle({ installmentPurchaseId: id, cycleEnd: '2026-10-20', source: 'user',
        createdAt: '2026-10-11T12:00:00.000Z', updatedAt: '2026-10-11T12:00:00.000Z' });
      const identity = rows(f, 'SELECT rowid, id, created_at FROM installment_purchases WHERE id = ?', [id]);
      await f.save({ editingTransaction: await currentTransaction(f, exact.transaction.id), accountId: 'card',
        operationType: 'Crédito', installmentCountInput: '3', amount: 300000, merchantName: 'Solo nombre' });
      expect(rows(f, 'SELECT rowid, id, created_at FROM installment_purchases WHERE id = ?', [id])).toEqual(identity);
      expect(await repository.getPlanRevisions(id)).toHaveLength(1);
      expect(await repository.getFirstCycles([id])).toEqual([expect.objectContaining({ cycleEnd: '2026-10-20', source: 'user' })]);
      await deleteManualTransactionSafely({ ...f, accounts: await f.accountRepository.getAccounts(),
        transaction: await currentTransaction(f, exact.transaction.id) });
      expect(await repository.getFirstCycles([id])).toEqual([]);
      expect((await repository.getPlanRevisions(id)).map(row => row.source)).toEqual(['original', 'purchaseRemoval']);
      expect(rows(f, 'PRAGMA foreign_key_check')).toEqual([]);
    } finally { f.native.close(); }
  });

  test('a recreated purchase starts a new incarnation and never inherits the removed plan', async () => {
    const { f, exact } = await migratedFixture();
    try {
      const id = await purchaseIdOf(f, exact.transaction.id);
      const repository = historyRepository(f);
      const toSingle = await f.save({ editingTransaction: await currentTransaction(f, exact.transaction.id), accountId: 'card', operationType: 'Crédito',
        installmentCountInput: '1', amount: 300000 });
      await f.save({ editingTransaction: toSingle.transaction, accountId: 'card', operationType: 'Crédito',
        installmentCountInput: '4', amount: 300000 });
      expect(await purchaseIdOf(f, exact.transaction.id)).toBe(id);
      // 1a.4A: recreating the plan appends its own original revision in the same save.
      const [, removal, original] = await repository.getPlanRevisions(id);
      expect(removal).toMatchObject({ revisionNumber: 1, source: 'purchaseRemoval' });
      expect(original).toMatchObject({ id: `${id}:revision:2`, revisionNumber: 2, source: 'original', remainingPrincipalCents: 30000000,
        remainingInstallments: 4, installmentAmountCents: 7500000, effectiveCycleEnd: null, verification: 'pendingVerification',
        pendingReasons: ['firstCycleUnconfirmed'], basis: { totalAmount: 300000, monthlyAmount: 75000, installmentCount: 4 } });
      expect(selectEffectivePlanRevision(await repository.getPlanRevisions(id))).toMatchObject({ status: 'current', revision: original });
      // A removed incarnation still accepts nothing but a new original revision (row recreated outside the use case).
      f.native.exec(`CREATE TEMP TABLE kept AS SELECT * FROM installment_purchases WHERE id = '${id}'`);
      f.native.exec(`DELETE FROM installment_purchases WHERE id = '${id}'`);
      f.native.exec('INSERT INTO installment_purchases SELECT * FROM kept');
      const pending: NewInstallmentPlanRevision = { installmentPurchaseId: id, source: 'statement', remainingPrincipalCents: 1,
        remainingInstallments: 1, installmentAmountCents: 1, effectiveCycleEnd: '2026-10-20', verification: 'projected',
        pendingReasons: [], createdAt: 'x' };
      await expect(repository.appendPlanRevision(pending)).rejects.toThrow('revisión original');
    } finally { f.native.close(); }
  });

  test('an active allocation blocks deleting or changing its payment and purchase until it is reversed explicitly', async () => {
    const { f, exact, payment } = await migratedFixture();
    try {
      const id = await purchaseIdOf(f, exact.transaction.id);
      await allocate(f, id, payment.transaction.id);
      const before = await financialState(f);
      await expect(deleteManualTransactionSafely({ ...f, accounts: await f.accountRepository.getAccounts(),
        transaction: payment.transaction })).rejects.toThrow('imputaciones activas');
      expect(await financialState(f)).toEqual(before);
      expect(() => f.native.exec(`UPDATE transactions SET amount = 1 WHERE id = '${payment.transaction.id}'`)).toThrow('imputaciones activas');
      f.native.exec(`UPDATE transactions SET description = 'Descripción' WHERE id = '${payment.transaction.id}'`);
      expect(() => f.native.exec(`DELETE FROM installment_purchases WHERE id = '${id}'`)).toThrow('imputaciones activas');

      // Explicit reversal (the future use case does it in the same transaction), then the deletion proceeds.
      f.native.exec("UPDATE installment_allocations SET status = 'reversed', reversed_at = '2026-10-11T12:05:00.000Z'");
      await deleteManualTransactionSafely({ ...f, accounts: await f.accountRepository.getAccounts(),
        transaction: await currentTransaction(f, payment.transaction.id) });
      expect(allocations(f)).toEqual([expect.objectContaining({ payment_transaction_id: payment.transaction.id, status: 'reversed' })]);
      expect(rows(f, 'SELECT id FROM transactions WHERE id = ?', [payment.transaction.id])).toEqual([]);
      expect(rows(f, 'PRAGMA foreign_key_check')).toEqual([]);
    } finally { f.native.close(); }
  });

  test('the financial wipe removes the new history in one commit', async () => {
    const { f, exact, payment } = await migratedFixture();
    try {
      await allocate(f, await purchaseIdOf(f, exact.transaction.id), payment.transaction.id);
      await historyRepository(f).saveBillingRules({ accountId: 'card', closingDayPurchasePolicy: 'nextCycle', createdAt: 'x', updatedAt: 'x' });
      const result = await createSqliteFinancialDataRepository(f.database).deleteFinancialData(
        '22222222-2222-4222-8222-222222222222', { workIds: [], backupJobIds: [], snapshotIds: [] });
      expect(result.status).toBe('confirmed');
      for (const table of [...NEW_TABLES, 'installment_purchases', 'transactions', 'accounts'])
        expect(rows(f, `SELECT count(*) AS total FROM ${table}`)).toEqual([{ total: 0 }]);
      expect(rows(f, 'PRAGMA foreign_key_check')).toEqual([]);
    } finally { f.native.close(); }
  });
});

describe('repositories', () => {
  test('revisions are read in order and appended with the next number, without REPLACE', async () => {
    const { f, exact } = await migratedFixture();
    try {
      const id = await purchaseIdOf(f, exact.transaction.id);
      const repository = historyRepository(f);
      f.resetTrace();
      const appended = await repository.appendPlanRevision({ installmentPurchaseId: id, source: 'statement',
        remainingPrincipalCents: 20000000, remainingInstallments: 2, installmentAmountCents: 10000000,
        effectiveCycleEnd: '2026-11-20', verification: 'confirmed', pendingReasons: [], createdAt: '2026-10-11T12:00:00.000Z' });
      expect(f.trace.filter(entry => entry.write !== undefined).map(entry => entry.sql.split('(')[0]!.trim()))
        .toEqual(['INSERT INTO installment_plan_revisions']);
      expect(appended).toMatchObject({ id: `${id}:revision:1`, revisionNumber: 1, verification: 'confirmed', pendingReasons: [] });
      expect((await repository.getPlanRevisions(id)).map(row => row.revisionNumber)).toEqual([0, 1]);
      expect(await repository.getLatestPlanRevision(id)).toEqual(appended);
      expect(await repository.getLatestPlanRevision('missing')).toBeUndefined();
      const invalid = { ...appended, source: 'statement' as const, pendingReasons: [] };
      await expect(repository.appendPlanRevision({ ...invalid, remainingPrincipalCents: 1.5 })).rejects.toThrow('centavos');
      await expect(repository.appendPlanRevision({ ...invalid, effectiveCycleEnd: '2026-02-30' })).rejects.toThrow('fecha civil');
      await expect(repository.appendPlanRevision({ ...invalid, verification: 'pendingVerification' })).rejects.toThrow('motivos');
      await expect(repository.appendPlanRevision({ ...invalid, source: 'purchaseEdit' as never })).rejects.toThrow('no admitido');
      expect(await repository.getPlanRevisions(id)).toHaveLength(2);
    } finally { f.native.close(); }
  });

  test('billing rules keep identity, accept an undefined policy and reject unknown policies', async () => {
    const { f } = await migratedFixture();
    try {
      const repository = historyRepository(f);
      await repository.saveBillingRules({ accountId: 'card', createdAt: '2026-10-01', updatedAt: '2026-10-01' });
      expect(await repository.getBillingRules(['card'])).toEqual([{ accountId: 'card', createdAt: '2026-10-01', updatedAt: '2026-10-01' }]);
      const identity = rows(f, 'SELECT rowid, created_at FROM credit_card_billing_rules');
      await repository.saveBillingRules({ accountId: 'card', closingDayPurchasePolicy: 'closingCycle', createdAt: 'ignored', updatedAt: '2026-10-02' });
      expect(rows(f, 'SELECT rowid, created_at FROM credit_card_billing_rules')).toEqual(identity);
      expect(await repository.getBillingRules(['card', 'bank'])).toEqual([
        { accountId: 'card', closingDayPurchasePolicy: 'closingCycle', createdAt: '2026-10-01', updatedAt: '2026-10-02' }]);
      await expect(repository.saveBillingRules({ accountId: 'card', closingDayPurchasePolicy: 'sameDay' as never, createdAt: 'x', updatedAt: 'x' }))
        .rejects.toThrow('Política');
      await expect(repository.saveBillingRules({ accountId: 'missing', createdAt: 'x', updatedAt: 'x' })).rejects.toThrow('FOREIGN KEY');
      await expect(repository.saveFirstCycle({ installmentPurchaseId: 'missing', cycleEnd: '2026-10-20', source: 'statement', createdAt: 'x', updatedAt: 'x' }))
        .rejects.toThrow('FOREIGN KEY');
    } finally { f.native.close(); }
  });

  test('repositories join the owner transaction: one BEGIN, no nesting, full rollback', async () => {
    const { f, exact, payment } = await migratedFixture();
    try {
      const id = await purchaseIdOf(f, exact.transaction.id);
      const before = await financialState(f);
      f.resetTrace();
      const result = await runSharedSQLiteTransaction(f.database, async participant => {
        const repository = createSqliteInstallmentHistoryRepository(participant);
        await repository.saveAllocations('scoped', [{ id: 'scoped-1', paymentTransactionId: payment.transaction.id,
          installmentPurchaseId: id, amountCents: 100, mode: 'unspecified', createdAt: 'x' }]);
        await repository.appendPlanRevision({ installmentPurchaseId: id, source: 'allocation', allocationId: 'scoped-1',
          remainingPrincipalCents: null, remainingInstallments: null, installmentAmountCents: null, effectiveCycleEnd: null,
          verification: 'pendingVerification', pendingReasons: ['manualReview'], createdAt: 'x' });
        expect(allocations(f)).toHaveLength(1);
        throw new Error('domain failure');
      });
      expect(result.status).toBe('rolledBack');
      expect(f.trace.filter(entry => /^BEGIN/.test(entry.sql))).toHaveLength(1);
      expect(f.trace.filter(entry => /^COMMIT/.test(entry.sql))).toHaveLength(0);
      expect(await financialState(f)).toEqual(before);
    } finally { f.native.close(); }
  });
});

describe('effective plan selection', () => {
  const revision = (revisionNumber: number, source: InstallmentPlanRevision['source'], effectiveCycleEnd: string | null = null) =>
    ({ id: `p:revision:${revisionNumber}`, installmentPurchaseId: 'p', revisionNumber, source, remainingPrincipalCents: null,
      remainingInstallments: null, installmentAmountCents: null, effectiveCycleEnd, verification: 'pendingVerification',
      pendingReasons: ['manualReview'], createdAt: 'x' }) as InstallmentPlanRevision;

  test('the latest started revision of the current incarnation applies; later cycles are scheduled', () => {
    const history = [revision(2, 'statement', '2026-12-20'), revision(0, 'original'), revision(1, 'allocation', '2026-11-20')];
    expect(selectEffectivePlanRevision(history, '2026-10-20')).toMatchObject({ status: 'current', revision: { revisionNumber: 0 },
      scheduled: [{ revisionNumber: 1 }, { revisionNumber: 2 }] });
    expect(selectEffectivePlanRevision(history, '2026-11-20')).toMatchObject({ revision: { revisionNumber: 1 }, scheduled: [{ revisionNumber: 2 }] });
    expect(selectEffectivePlanRevision(history)).toMatchObject({ revision: { revisionNumber: 2 }, scheduled: [] });
    expect(selectEffectivePlanRevision([])).toEqual({ status: 'none' });
    expect(selectEffectivePlanRevision([revision(0, 'original'), revision(1, 'purchaseRemoval')]).status).toBe('removed');
    expect(selectEffectivePlanRevision([revision(0, 'original', '2027-01-20')], '2026-10-20')).toEqual({ status: 'none' });
    expect(() => selectEffectivePlanRevision([revision(0, 'original'), revision(2, 'statement')])).toThrow('incompleto');
  });
});

describe('volume', () => {
  test('migrates 2,000 purchases spread over 50 years in one transaction', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      const created = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3', amount: 300000 });
      downgradeToVersion4(f);
      const insert = f.native.prepare(`INSERT INTO installment_purchases (id, transaction_id, account_id, total_amount, currency,
        installment_count, paid_installments, monthly_amount, status, created_at, updated_at)
        VALUES (?, ?, 'card', ?, 'COP', ?, 0, ?, 'active', ?, ?)`);
      f.native.exec('BEGIN');
      for (let index = 0; index < 2000; index += 1) {
        const year = 1977 + Math.floor(index / 40);
        const date = `${year}-${String((index % 12) + 1).padStart(2, '0')}-15T12:00:00.000Z`;
        insert.run(`volume-${String(index).padStart(4, '0')}`, created.transaction.id, 1000 + index + 0.25, (index % 24) + 2, 500, date, date);
      }
      f.native.exec('COMMIT');
      f.resetTrace();
      const started = Date.now();
      await applyVersionedMigrations(f.database);
      expect(rows(f, 'SELECT count(*) AS total FROM installment_plan_revisions')).toEqual([{ total: 2001 }]);
      expect(f.trace.filter(entry => /^BEGIN/.test(entry.sql))).toHaveLength(1);
      expect(rows(f, "SELECT count(*) AS total FROM installment_plan_revisions WHERE remaining_principal_cents IS NULL")).toEqual([{ total: 0 }]);
      expect(Date.now() - started).toBeLessThan(30_000);
    } finally { f.native.close(); }
  });
});
