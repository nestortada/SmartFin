// Phase 1a.3A: credit card persistence keeps identity and dependent rows (no INSERT OR REPLACE).
// Synthetic in-memory SQLite only. The dependent tables are synthetic stand-ins for the references that
// migration 5 will add; they are created here, never in the production schema.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState, requireIntegralRollback } from './helpers/financialState';
import { creditCardFixture, CYCLE_DATES } from './reproductions/creditCardFixture';
import { createSqliteCreditCardRepository as createReplaceRepository } from './helpers/post3BCreditCardRepositoryBaseline';
import { saveSQLiteRowPreservingIdentity } from '../src/database/saveSQLiteRowPreservingIdentity';
import { SQLiteCommandFailure } from '../src/database/atomicSQLite';
import type { SQLiteFault } from './helpers/realSQLite';
import type { InstallmentPurchase } from '../src/modules/creditCards/types';

type Fixture = Awaited<ReturnType<typeof financialIntegrityFixture>>;
const fs = require('node:fs') as { readFileSync: (path: string, encoding: 'utf8') => string };

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

const DEPENDENTS = `
  CREATE TABLE synthetic_installment_allocations (
    id TEXT PRIMARY KEY NOT NULL,
    installment_purchase_id TEXT NOT NULL REFERENCES installment_purchases(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL);
  CREATE TABLE synthetic_installment_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    installment_purchase_id TEXT REFERENCES installment_purchases(id) ON DELETE SET NULL);
  CREATE TABLE synthetic_statement_allocations (
    id TEXT PRIMARY KEY NOT NULL,
    statement_id TEXT NOT NULL REFERENCES credit_card_statements(id) ON DELETE CASCADE);`;

function addInstallmentDependents(f: Fixture, purchaseId: string) {
  f.native.exec(DEPENDENTS);
  f.native.prepare('INSERT INTO synthetic_installment_allocations VALUES (?, ?, ?)').run('alloc-1', purchaseId, 100000);
  f.native.prepare('INSERT INTO synthetic_installment_revisions VALUES (?, ?)').run('rev-1', purchaseId);
}
const rows = (f: Fixture, sql: string) => f.query(sql).rows.raw();
const revision = (f: Fixture) => Number(rows(f, 'SELECT revision FROM financial_data_revision')[0]!.revision);
const identity = (f: Fixture, table: string) => rows(f, `SELECT rowid, id, created_at FROM ${table} ORDER BY id`);
const dependents = (f: Fixture) => ({
  allocations: rows(f, 'SELECT * FROM synthetic_installment_allocations ORDER BY id'),
  revisions: rows(f, 'SELECT * FROM synthetic_installment_revisions ORDER BY id'),
});

/** Credit purchase in 3 installments with synthetic dependents, then an edit of its installment plan. */
async function installmentEdit(f: Fixture) {
  jest.setSystemTime(FINANCIAL_TEST_DATE);
  const created = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3', amount: 300000 });
  const [purchase] = await f.creditCardRepository.getInstallmentPurchases(['card']);
  f.native.prepare('UPDATE installment_purchases SET paid_installments = 1 WHERE id = ?').run(purchase!.id);
  addInstallmentDependents(f, purchase!.id);
  jest.setSystemTime(new Date(FINANCIAL_TEST_DATE.getTime() + 60_000));
  return {
    purchase: { ...purchase!, paidInstallments: 1 },
    edit: () => f.save({
      editingTransaction: created.transaction, accountId: 'card',
      operationType: 'Crédito', installmentCountInput: '3', amount: 300000, merchantName: 'Visa editada',
    }),
  };
}

/** The same plan edit written by the previous (REPLACE) and the current repository. */
async function savePlanEdit(previous: boolean) {
  const f = await financialIntegrityFixture();
  const { purchase } = await installmentEdit(f);
  f.native.exec("ALTER TABLE installment_purchases ADD COLUMN synthetic_extra TEXT DEFAULT 'default'");
  f.native.prepare("UPDATE installment_purchases SET synthetic_extra = 'kept' WHERE id = ?").run(purchase.id);
  const repository = previous ? createReplaceRepository(f.database) : f.creditCardRepository;
  const before = { identity: identity(f, 'installment_purchases'), revision: revision(f) };
  await repository.saveInstallmentPurchases([{ ...purchase, merchantName: 'Visa editada', updatedAt: '2026-10-11T12:01:00.000Z' }]);
  const after = {
    identity: identity(f, 'installment_purchases'),
    revisionDelta: revision(f) - before.revision,
    dependents: dependents(f),
    extra: rows(f, 'SELECT synthetic_extra FROM installment_purchases'),
    plan: (await f.creditCardRepository.getInstallmentPurchases(['card']))[0],
    foreignKeyCheck: rows(f, 'PRAGMA foreign_key_check'),
  };
  f.native.close();
  return { purchase, before, after };
}

describe('defect reproduced with the previous INSERT OR REPLACE repository', () => {
  test('REPLACE renumbers the plan, cascades its children away, nulls weak references and resets defaults', async () => {
    const { purchase, before, after } = await savePlanEdit(true);
    expect(after.identity[0]!.id).toBe(purchase.id);
    expect(after.identity[0]!.rowid).not.toBe(before.identity[0]!.rowid);
    // The DELETE half of REPLACE runs the foreign key actions; recursive_triggers is off, so only the
    // INSERT revision trigger fires: +1, the same delta as one UPDATE.
    expect(after.dependents).toEqual({ allocations: [], revisions: [{ id: 'rev-1', installment_purchase_id: null }] });
    expect(after.extra).toEqual([{ synthetic_extra: 'default' }]);
    expect(after.revisionDelta).toBe(1);
    expect(after.foreignKeyCheck).toEqual([]); // silent: no integrity error reveals the loss
  });

  test('the current repository writes the same plan values and keeps identity, children and defaults', async () => {
    const previous = await savePlanEdit(true);
    const current = await savePlanEdit(false);
    // Only the generated movement id differs between the two fixtures.
    const values = ({ id: _id, transactionId: _tx, ...plan }: InstallmentPurchase) => plan;
    expect(values(current.after.plan!)).toEqual(values(previous.after.plan!));
    expect(current.after.revisionDelta).toBe(previous.after.revisionDelta);
    expect(current.after.identity).toEqual(current.before.identity);
    expect(current.after.dependents).toEqual({
      allocations: [{ id: 'alloc-1', installment_purchase_id: current.purchase.id, amount: 100000 }],
      revisions: [{ id: 'rev-1', installment_purchase_id: current.purchase.id }],
    });
    expect(current.after.extra).toEqual([{ synthetic_extra: 'kept' }]);
    expect(current.after.foreignKeyCheck).toEqual([]);
  });
});

describe('identity-preserving save', () => {
  test('editing an installment purchase keeps id, rowid, created_at, children and revision delta', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      const { purchase, edit } = await installmentEdit(f);
      f.native.exec("ALTER TABLE installment_purchases ADD COLUMN synthetic_extra TEXT DEFAULT 'default'");
      f.native.prepare("UPDATE installment_purchases SET synthetic_extra = 'kept' WHERE id = ?").run(purchase.id);
      const before = identity(f, 'installment_purchases');
      const childrenBefore = dependents(f);
      const revisionBefore = revision(f);
      f.resetTrace();
      await edit();
      expect(identity(f, 'installment_purchases')).toEqual(before);
      expect(dependents(f)).toEqual(childrenBefore);
      // One revision per row written: movement, plan, card account and current statement.
      expect(revision(f) - revisionBefore).toBe(4);
      const [stored] = await f.creditCardRepository.getInstallmentPurchases(['card']);
      // Approved behavior: unchanged terms keep the plan progress and the stored monthly amount.
      expect(stored).toMatchObject({ id: purchase.id, merchantName: 'Visa editada', paidInstallments: 1,
        monthlyAmount: purchase.monthlyAmount, totalAmount: 300000, createdAt: purchase.createdAt });
      expect(rows(f, 'SELECT synthetic_extra FROM installment_purchases')).toEqual([{ synthetic_extra: 'kept' }]);
      const planWrites = f.trace.filter(entry => entry.write && entry.sql.includes('installment_purchases'));
      expect(planWrites.map(entry => entry.sql.trim().split(/\s+/)[0])).toEqual(['UPDATE']);
      expect(f.trace.some(entry => /REPLACE|DELETE FROM installment_purchases/i.test(entry.sql))).toBe(false);
      expect(f.trace.filter(entry => entry.sql.startsWith('BEGIN'))).toHaveLength(1);
      expect(rows(f, 'PRAGMA foreign_key_check')).toEqual([]);
    } finally { f.native.close(); }
  });

  test('changed terms keep identity and children; the plan is reset as before (pending for 1a.3B)', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      const created = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3', amount: 300000 });
      const [purchase] = await f.creditCardRepository.getInstallmentPurchases(['card']);
      addInstallmentDependents(f, purchase!.id);
      const before = identity(f, 'installment_purchases');
      await f.save({ editingTransaction: created.transaction, accountId: 'card', operationType: 'Crédito',
        installmentCountInput: '6', amount: 300000 });
      expect(identity(f, 'installment_purchases')).toEqual(before);
      expect(dependents(f).allocations).toHaveLength(1);
      const [stored] = await f.creditCardRepository.getInstallmentPurchases(['card']);
      expect(stored).toMatchObject({ installmentCount: 6, monthlyAmount: 50000, paidInstallments: 0 });
    } finally { f.native.close(); }
  });

  test('a resave updates the plan in place with one write and one revision, never a duplicate', async () => {
    const f = await financialIntegrityFixture();
    try {
      await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3', amount: 300000 });
      const [purchase] = await f.creditCardRepository.getInstallmentPurchases(['card']);
      const revisionBefore = revision(f);
      f.resetTrace();
      await f.creditCardRepository.saveInstallmentPurchases([purchase!]);
      // Parity with REPLACE: exactly one write (and one revision) per saved row, so the Android fault
      // positions and the revision semantics stay as validated.
      expect(f.trace.filter(entry => entry.write).map(entry => entry.sql.trim().split(/\s+/).slice(0, 2).join(' ')))
        .toEqual(['UPDATE installment_purchases']);
      expect(revision(f)).toBe(revisionBefore + 1);
      expect(rows(f, 'SELECT COUNT(*) AS n FROM installment_purchases')).toEqual([{ n: 1 }]);
    } finally { f.native.close(); }
  });

  test('unexpected integrity errors surface instead of being ignored', async () => {
    const f = await financialIntegrityFixture();
    try {
      const orphan: InstallmentPurchase = {
        id: 'installment-orphan', transactionId: 'missing-transaction', accountId: 'card', totalAmount: 1,
        currency: 'COP', installmentCount: 2, paidInstallments: 0, monthlyAmount: 1, status: 'active',
        createdAt: '2026-10-11', updatedAt: '2026-10-11',
      };
      await expect(f.creditCardRepository.saveInstallmentPurchases([orphan])).rejects.toThrow(/FOREIGN KEY/);
      expect(rows(f, 'SELECT COUNT(*) AS n FROM installment_purchases')).toEqual([{ n: 0 }]);
      await expect(saveSQLiteRowPreservingIdentity(f.database, 'installment_purchases; DROP', 'id', { id: 'x' }))
        .rejects.toThrow('Identificador de persistencia inválido.');
    } finally { f.native.close(); }
  });

  test('profiles keep their stored created_at and rowid', async () => {
    const f = await financialIntegrityFixture();
    try {
      await f.creditCardRepository.saveProfiles([{ accountId: 'card', monthlyInterestRate: 0.02, createdAt: '2026-01-01', updatedAt: '2026-01-01' }]);
      const before = rows(f, 'SELECT rowid, account_id, created_at FROM credit_card_profiles');
      await f.creditCardRepository.saveProfiles([{ accountId: 'card', monthlyInterestRate: 0.03, createdAt: '2026-10-11', updatedAt: '2026-10-11' }]);
      expect(rows(f, 'SELECT rowid, account_id, created_at FROM credit_card_profiles')).toEqual(before);
      expect(await f.creditCardRepository.getProfiles(['card'])).toEqual([
        { accountId: 'card', monthlyInterestRate: 0.03, createdAt: '2026-01-01', updatedAt: '2026-10-11' },
      ]);
    } finally { f.native.close(); }
  });

  test('production repositories no longer REPLACE or IGNORE credit card rows', () => {
    const source = fs.readFileSync('src/modules/creditCards/repositories/sqliteCreditCardRepository.ts', 'utf8');
    expect(source).not.toMatch(/INSERT\s+OR\s+(REPLACE|IGNORE)\s+INTO/i);
    expect(fs.readFileSync('src/database/saveSQLiteRowPreservingIdentity.ts', 'utf8')).not.toMatch(/`[^`]*(ON CONFLICT|OR IGNORE|OR REPLACE)/);
  });
});

describe('statements: identity, children and multi-cycle behavior', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] }));

  test('a payment rewrites the open statement in place; a repeated reconciliation rewrites it in place once', async () => {
    const f = await creditCardFixture();
    try {
      await f.purchase(600000, 6, CYCLE_DATES[0]!);
      f.native.exec(DEPENDENTS);
      const [statement] = rows(f, 'SELECT id FROM credit_card_statements');
      f.native.prepare('INSERT INTO synthetic_statement_allocations VALUES (?, ?)').run('s-alloc', String(statement!.id));
      const before = identity(f, 'credit_card_statements');
      const paidAt = new Date(CYCLE_DATES[0]!.getTime() + 3_600_000);
      await f.pay(100000, paidAt);
      expect(identity(f, 'credit_card_statements')).toEqual(before);
      expect(rows(f, 'SELECT * FROM synthetic_statement_allocations')).toEqual([{ id: 's-alloc', statement_id: statement!.id }]);
      expect(await f.statements()).toEqual([
        { statementStartDate: '2026-09-21', statementEndDate: '2026-10-20', totalAmount: 0, status: 'paid' },
      ]);
      const revisionBefore = revision(f);
      f.resetTrace();
      await f.reconcile(paidAt);
      expect(f.trace.filter(entry => entry.write && entry.sql.includes('credit_card_statements'))
        .map(entry => entry.sql.trim().split(/\s+/)[0])).toEqual(['UPDATE']);
      expect(identity(f, 'credit_card_statements')).toEqual(before);
      // Card account and statement, one revision each, as with REPLACE.
      expect(revision(f) - revisionBefore).toBe(2);
      expect(rows(f, 'SELECT COUNT(*) AS n FROM credit_card_statements')).toEqual([{ n: 1 }]);
    } finally { f.native.close(); }
  });

  test('later cycles keep earlier statements, their rowids and children untouched', async () => {
    const f = await creditCardFixture();
    try {
      await f.purchase(600000, 6, CYCLE_DATES[0]!);
      f.native.exec(DEPENDENTS);
      const [first] = rows(f, 'SELECT id FROM credit_card_statements');
      f.native.prepare('INSERT INTO synthetic_statement_allocations VALUES (?, ?)').run('s-alloc', String(first!.id));
      const firstIdentity = identity(f, 'credit_card_statements');
      for (const date of CYCLE_DATES.slice(1)) await f.reconcile(date);
      expect(identity(f, 'credit_card_statements').slice(0, 1)).toEqual(firstIdentity);
      expect((await f.statements()).map(value => value.totalAmount)).toEqual([100000, 100000, 100000, 100000, 100000, 100000, 0]);
      expect(rows(f, 'SELECT COUNT(*) AS n FROM synthetic_statement_allocations')).toEqual([{ n: 1 }]);
      expect(rows(f, 'PRAGMA foreign_key_check')).toEqual([]);
    } finally { f.native.close(); }
  });
});

describe('atomicity of the identity-preserving edit', () => {
  async function run(fault?: SQLiteFault) {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      const { edit } = await installmentEdit(f);
      const before = { state: await financialState(f), rowids: identity(f, 'installment_purchases') };
      f.resetTrace(); f.injectFault(fault);
      let error: unknown;
      try { await edit(); } catch (caught) { error = caught; }
      const trace = f.trace.map(entry => ({ ...entry }));
      f.injectFault();
      // An unknown outcome retires the connection: its state is only verifiable after reopening.
      if (error instanceof SQLiteCommandFailure && error.result.status === 'unknown') return { before, trace, error };
      const after = { state: await financialState(f), rowids: identity(f, 'installment_purchases') };
      return { before, after, trace, error };
    } finally { try { f.native.close(); } catch { /* already retired by the runner */ } }
  }

  test('every write before/after rolls back all tables, children, rowids and revision', async () => {
    const success = await run();
    expect(success.error).toBeUndefined();
    expect(success.trace.filter(entry => entry.sql.startsWith('BEGIN'))).toHaveLength(1);
    const writes = success.trace.filter(entry => entry.write !== undefined);
    expect(writes.some(entry => entry.sql.trim().startsWith('UPDATE installment_purchases'))).toBe(true);
    for (const entry of writes) {
      for (const phase of ['before', 'after'] as const) {
        const failed = await run({ phase, write: entry.write });
        expect(failed.error).toBeDefined();
        expect(failed.error).not.toBeInstanceOf(SQLiteCommandFailure);
        expect(failed.trace.filter(value => value.sql.startsWith('ROLLBACK') && value.outcome === 'ok')).toHaveLength(1);
        expect(failed.trace.some(value => value.sql.startsWith('COMMIT'))).toBe(false);
        requireIntegralRollback(failed.before.state, failed.after!.state);
        expect(failed.after!.rowids).toEqual(failed.before.rowids);
      }
    }
  });

  test.each(['before', 'after'] as const)('COMMIT %s: unknown result, the plan update is never retried', async phase => {
    const result = await run({ phase, sql: 'COMMIT' });
    expect(result.error).toBeInstanceOf(SQLiteCommandFailure);
    expect((result.error as SQLiteCommandFailure).result.status).toBe('unknown');
    expect(result.trace.filter(entry => entry.sql.trim().startsWith('UPDATE installment_purchases'))).toHaveLength(1);
    expect(result.trace.filter(entry => entry.sql.startsWith('BEGIN'))).toHaveLength(1);
  });
});
