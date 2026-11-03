// Phase 1a.4A: revision 0 for purchases registered after migration 5. Synthetic SQLite only.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState, requireIntegralRollback, type FinancialState } from './helpers/financialState';
import { realSQLite, type SQLiteFault } from './helpers/realSQLite';
import { applyVersionedMigrations } from '../src/database/migrations';
import { SQLiteCommandFailure, runSharedSQLiteTransaction } from '../src/database/atomicSQLite';
import { createSqliteCreditCardRepository } from '../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteInstallmentHistoryRepository } from '../src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository';
import { serializeCreditCardVisualMetadata } from '../src/modules/creditCards/useCases/manageCreditCards';
import {
  buildInitialInstallmentRevision,
  recordInitialInstallmentRevision,
} from '../src/modules/creditCards/useCases/initialInstallmentRevision';
import { buildOriginalInstallmentRevision } from '../src/modules/creditCards/database/originalInstallmentRevisions';
import { selectEffectivePlanRevision } from '../src/modules/creditCards/useCases/installmentPlanRevisions';
import { distributeInstallmentCents } from '../src/modules/creditCards/useCases/installmentPlan';
import { registerCreditCardPayment } from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import {
  deleteManualTransactionSafely,
  type SaveManualTransactionParams,
} from '../src/modules/transactions/useCases/saveManualTransaction';
import { updateTransactionQuickly } from '../src/modules/transactions/useCases/updateTransactionQuickly';
import type { InstallmentPurchase } from '../src/modules/creditCards/types';
import type { SQLitePrimitive } from '../src/database/sqliteRows';

type Fixture = Awaited<ReturnType<typeof financialIntegrityFixture>>;
type Rows = Record<string, SQLitePrimitive>[];
const fs = require('node:fs') as { mkdtempSync: (prefix: string) => string; rmSync: (path: string, options: object) => void };
const { join } = require('node:path') as { join: (...parts: string[]) => string };
const { tmpdir } = require('node:os') as { tmpdir: () => string };

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

const NOW = FINANCIAL_TEST_DATE.toISOString();
const rows = (f: { query: Fixture['query'] }, sql: string, values: SQLitePrimitive[] = []): Rows =>
  f.query(sql, values).rows.raw();
const revisionRows = (f: { query: Fixture['query'] }) =>
  rows(f, 'SELECT * FROM installment_plan_revisions ORDER BY installment_purchase_id, revision_number');
const counter = (f: { query: Fixture['query'] }) => Number(rows(f, 'SELECT revision FROM financial_data_revision')[0]!.revision);
const history = (f: Fixture) => createSqliteInstallmentHistoryRepository(f.database);
const setClosingDay = (f: Fixture, closingDay: number) =>
  f.native.prepare("UPDATE accounts SET description = ? WHERE id = 'card'").run(serializeCreditCardVisualMetadata({ closingDay }));
const credit = (changes: Partial<SaveManualTransactionParams> = {}): Partial<SaveManualTransactionParams> =>
  ({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3', amount: 300000, merchantName: 'Compra', ...changes });
const transactionOf = async (f: Fixture, id: string) => {
  const found = (await f.transactionRepository.getTransactions()).find(row => row.id === id);
  if (!found) throw new Error('missing transaction');
  return found;
};
const purchaseOf = async (f: Fixture, transactionId: string) =>
  (await f.creditCardRepository.getInstallmentPurchases(['card', 'bank'])).find(row => row.transactionId === transactionId);
const shape = (row: Record<string, SQLitePrimitive>) => [row.revision_number, row.source, row.verification, row.pending_reasons,
  row.remaining_principal_cents, row.remaining_installments, row.installment_amount_cents, row.effective_cycle_end];

/** Drops every migration 5 object, as on an installation that still runs version 4 (same helper as 1a.3B). */
function downgradeToVersion4(f: Fixture) {
  const triggers = rows(f, `SELECT name FROM sqlite_master WHERE type = 'trigger'
    AND (sql LIKE '%installment_allocations%' OR sql LIKE '%installment_plan_revisions%'
      OR sql LIKE '%credit_card_billing_rules%' OR sql LIKE '%installment_first_cycles%')`);
  for (const { name } of triggers) f.native.exec(`DROP TRIGGER "${String(name)}";`);
  for (const table of ['installment_plan_revisions', 'installment_allocations', 'installment_first_cycles', 'credit_card_billing_rules'])
    f.native.exec(`DROP TABLE ${table};`);
  f.native.exec('DELETE FROM schema_migrations WHERE version = 5;');
}

describe('revision 0 of a new purchase', () => {
  test('a new multi-installment purchase gets exactly one original revision in its own save', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      const before = counter(f);
      f.resetTrace();
      const created = await f.save(credit());
      const purchase = (await purchaseOf(f, created.transaction.id))!;
      expect(purchase.id).toBe(`installment-${created.transaction.id}`);
      expect(revisionRows(f)).toEqual([{
        id: `${purchase.id}:revision:0`, installment_purchase_id: purchase.id, revision_number: 0, source: 'original',
        allocation_id: null, remaining_principal_cents: 30000000, remaining_installments: 3, installment_amount_cents: 10000000,
        // The fixture card has no closing day: the first cycle is never invented.
        effective_cycle_end: null, verification: 'pendingVerification', pending_reasons: 'firstCycleUnconfirmed',
        basis_total_amount: 300000, basis_monthly_amount: 100000, basis_installment_count: 3, created_at: NOW,
      }]);
      // One BEGIN, one COMMIT, the revision inside the same transaction right after the plan row.
      const control = f.trace.filter(entry => /^(BEGIN|COMMIT|ROLLBACK)/.test(entry.sql)).map(entry => /^[A-Z]+/.exec(entry.sql)![0]);
      expect(control).toEqual(['BEGIN', 'COMMIT']);
      const writes = f.trace.filter(entry => entry.write !== undefined).map(entry => entry.sql.trim().split(/\s+/).slice(0, 3).join(' '));
      const plan = writes.findIndex(sql => sql.includes('installment_purchases'));
      expect(writes[plan + 1]).toBe('INSERT INTO installment_plan_revisions');
      expect(writes.filter(sql => sql.includes('installment_plan_revisions'))).toHaveLength(1);
      expect(counter(f) - before).toBeGreaterThan(0);
      expect(rows(f, 'PRAGMA foreign_key_check')).toEqual([]);
    } finally { f.native.close(); }
  });

  test('single-installment and debit movements have no plan and no revision', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      await f.save(credit({ installmentCountInput: '1' }));
      await f.save({ amount: 1000 });
      expect(rows(f, 'SELECT COUNT(*) AS n FROM installment_purchases')).toEqual([{ n: 0 }]);
      expect(revisionRows(f)).toEqual([]);
    } finally { f.native.close(); }
  });

  test('cents are kept exactly with the D2 base; the legacy rounded monthly amount stays only in basis', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      await f.save(credit({ amount: 1234.57, installmentCountInput: '6' }));
      const [revision] = revisionRows(f);
      expect(revision).toMatchObject({ remaining_principal_cents: 123457, remaining_installments: 6, installment_amount_cents: 20576,
        basis_total_amount: 1234.57, basis_monthly_amount: 206, basis_installment_count: 6 });
      // 5 × 20,576 + 20,577 = 123,457: the residue belongs to the last installment, nothing is rounded away.
      expect(5 * 20576 + (123457 - 5 * 20576)).toBe(123457);
    } finally { f.native.close(); }
  });

  test('an inexact or impossible amount is stored as NULL and pending, never rounded', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      setClosingDay(f, 20);
      await f.save(credit({ amount: 0.1 + 0.2, merchantName: 'Inexacta' }));
      await f.save(credit({ amount: 0.02, merchantName: 'Cero' }));
      await f.save(credit({ amount: 400000, installmentCountInput: '400', merchantName: 'Larga' }));
      const byBasis = Object.fromEntries(revisionRows(f).map(row => [String(row.basis_total_amount), shape(row)]));
      expect(byBasis[String(0.1 + 0.2)]).toEqual([0, 'original', 'pendingVerification', 'inexactHistoricalAmount', null, 3, null, '2026-10-20']);
      // requiresDecision (zero-cent installments) is kept as its own reason; it is never projected or confirmed.
      expect(byBasis['0.02']).toEqual([0, 'original', 'pendingVerification', 'zeroCentInstallments', 2, 3, 0, '2026-10-20']);
      expect(byBasis['400000']).toEqual([0, 'original', 'pendingVerification', 'invalidInstallmentCount', 40000000, null, null, '2026-10-20']);
    } finally { f.native.close(); }
  });
});

describe('meaning of installment_amount_cents', () => {
  test('new revision 0 stores the D2 base; the last installment (with the residue) is derived, never stored', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      setClosingDay(f, 20);
      for (const [amount, count] of [[1234.57, 6], [100, 3], [300000, 3], [0.05, 2]] as const)
        await f.save(credit({ amount, installmentCountInput: String(count), merchantName: `M${amount}` }));
      for (const row of revisionRows(f)) {
        const principal = Number(row.remaining_principal_cents);
        const count = Number(row.remaining_installments);
        const { baseCents, lastCents, residueCents } = distributeInstallmentCents(principal, count);
        expect(row.installment_amount_cents).toBe(baseCents);
        expect(baseCents * (count - 1) + lastCents).toBe(principal);
        // Where a residue exists the stored value is never the last installment.
        if (residueCents > 0) expect(row.installment_amount_cents).not.toBe(lastCents);
      }
    } finally { f.native.close(); }
  });

  test('migration 5 revision 0 keeps the legacy monthly amount: readers must derive amounts from principal and count', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      await f.save(credit({ amount: 1234.56, installmentCountInput: '6' }));
      downgradeToVersion4(f);
      await applyVersionedMigrations(f.database);
      const [migrated] = revisionRows(f);
      // Legacy monthly_amount = Math.round(1234.56 / 6) = 206 pesos; the D2 base of the same plan is 205.76.
      expect(migrated).toMatchObject({ installment_amount_cents: 20600, basis_monthly_amount: 206, remaining_principal_cents: 123456 });
      expect(distributeInstallmentCents(123456, 6)).toEqual({ baseCents: 20576, lastCents: 20576, residueCents: 0 });
    } finally { f.native.close(); }
  });
});

describe('calendar and verification (1a.1 rules)', () => {
  test('without a closing day the revision is pending and has no cycle', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      await f.save(credit());
      expect(shape(revisionRows(f)[0]!)).toEqual([0, 'original', 'pendingVerification', 'firstCycleUnconfirmed', 30000000, 3, 10000000, null]);
    } finally { f.native.close(); }
  });

  test('with a closing day the calendar is projected from the purchase cycle, never confirmed', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      setClosingDay(f, 20);
      await f.save(credit());
      expect(shape(revisionRows(f)[0]!)).toEqual([0, 'original', 'projected', null, 30000000, 3, 10000000, '2026-10-20']);
    } finally { f.native.close(); }
  });

  test('a purchase on the closing day follows the card policy and stays pending without one', async () => {
    const results: unknown[] = [];
    for (const policy of [undefined, 'closingCycle', 'nextCycle'] as const) {
      const f = await financialIntegrityFixture({ managed: true });
      try {
        setClosingDay(f, 11);
        if (policy) await history(f).saveBillingRules({ accountId: 'card', closingDayPurchasePolicy: policy, createdAt: NOW, updatedAt: NOW });
        await f.save(credit());
        results.push(shape(revisionRows(f)[0]!).slice(2));
      } finally { f.native.close(); }
    }
    expect(results).toEqual([
      ['pendingVerification', 'firstCycleUnconfirmed', 30000000, 3, 10000000, null],
      ['projected', null, 30000000, 3, 10000000, '2026-10-11'],
      ['projected', null, 30000000, 3, 10000000, '2026-11-11'],
    ]);
  });

  test('only an explicit per-purchase confirmation yields a confirmed revision', async () => {
    const purchase: InstallmentPurchase = { id: 'p', transactionId: 't', accountId: 'card', totalAmount: 300000, currency: 'COP',
      installmentCount: 3, paidInstallments: 2, monthlyAmount: 100000, status: 'active', createdAt: NOW, updatedAt: NOW };
    const base = { purchase, purchaseDate: '2026-10-11', billing: { closingDay: 20 }, createdAt: NOW };
    expect(buildInitialInstallmentRevision(base)).toMatchObject({ verification: 'projected', effectiveCycleEnd: '2026-10-20', pendingReasons: [] });
    expect(buildInitialInstallmentRevision({ ...base, confirmedFirstCycle: { cycleEnd: '2026-11-20', source: 'user' } }))
      .toMatchObject({ verification: 'confirmed', effectiveCycleEnd: '2026-11-20', remainingInstallments: 3, pendingReasons: [] });
    // An inconsistent confirmation is reported, not accepted.
    expect(buildInitialInstallmentRevision({ ...base, confirmedFirstCycle: { cycleEnd: '2026-11-19', source: 'user' } }))
      .toMatchObject({ verification: 'pendingVerification', effectiveCycleEnd: null, pendingReasons: ['firstCycleUnconfirmed'] });
    // paid_installments (2) is legacy: it never reduces the remaining installments of revision 0.
    expect(buildInitialInstallmentRevision(base).remainingInstallments).toBe(3);
  });

  test('the persisted confirmation of a purchase without history is honoured by the use case', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      setClosingDay(f, 20);
      const created = await f.save(credit());
      const purchase = (await purchaseOf(f, created.transaction.id))!;
      // Synthetic purchase without history (as left by the 1a.3B code between migration 5 and this phase).
      f.native.exec(`INSERT INTO installment_purchases SELECT 'gap', transaction_id, account_id, merchant_name, total_amount, currency,
        installment_count, paid_installments, monthly_amount, first_due_date, status, created_at, updated_at
        FROM installment_purchases WHERE id = '${purchase.id}'`);
      await history(f).saveFirstCycle({ installmentPurchaseId: 'gap', cycleEnd: '2026-11-20', source: 'statement', createdAt: NOW, updatedAt: NOW });
      const result = await runSharedSQLiteTransaction(f.database, participant => recordInitialInstallmentRevision({
        creditCardRepository: createSqliteCreditCardRepository(participant), purchase: { ...purchase, id: 'gap' },
        purchaseDate: '2026-10-11', createdAt: NOW,
      }));
      expect(result.status).toBe('confirmed');
      expect(shape(rows(f, "SELECT * FROM installment_plan_revisions WHERE installment_purchase_id = 'gap'")[0]!))
        .toEqual([0, 'original', 'confirmed', null, 30000000, 3, 10000000, '2026-11-20']);
    } finally { f.native.close(); }
  });

  test('outside the purchase transaction the use case refuses to write', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      const created = await f.save(credit());
      const purchase = (await purchaseOf(f, created.transaction.id))!;
      await expect(recordInitialInstallmentRevision({ creditCardRepository: f.creditCardRepository, purchase,
        purchaseDate: '2026-10-11', createdAt: NOW })).rejects.toThrow('misma transacción');
    } finally { f.native.close(); }
  });
});

describe('edits, removal and recreation', () => {
  test('ordinary edits append nothing and keep identity; changed terms append purchaseEdit', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      const created = await f.save(credit());
      const purchaseId = (await purchaseOf(f, created.transaction.id))!.id;
      const identity = () => rows(f, 'SELECT rowid, id, created_at FROM installment_purchases');
      const initial = identity();
      jest.setSystemTime(new Date(FINANCIAL_TEST_DATE.getTime() + 60_000));
      const renamed = await f.save(credit({ editingTransaction: await transactionOf(f, created.transaction.id), merchantName: 'Otro nombre' }));
      expect(identity()).toEqual(initial);
      expect(revisionRows(f).map(row => row.source)).toEqual(['original']);
      // The same edit repeated is still ordinary.
      await f.save(credit({ editingTransaction: await transactionOf(f, renamed.transaction.id), merchantName: 'Otro nombre' }));
      expect(revisionRows(f)).toHaveLength(1);

      jest.setSystemTime(new Date(FINANCIAL_TEST_DATE.getTime() + 120_000));
      await f.save(credit({ editingTransaction: await transactionOf(f, created.transaction.id), merchantName: 'Otro nombre', installmentCountInput: '6' }));
      expect(identity()).toEqual(initial);
      expect(revisionRows(f).map(row => [row.revision_number, row.source, row.verification, row.pending_reasons, row.basis_installment_count]))
        .toEqual([[0, 'original', 'pendingVerification', 'firstCycleUnconfirmed', 3], [1, 'purchaseEdit', 'pendingVerification', 'termsChanged', 6]]);
      // Revision 0 is never rewritten.
      expect(revisionRows(f)[0]).toMatchObject({ remaining_installments: 3, created_at: NOW });
      expect(selectEffectivePlanRevision(await history(f).getPlanRevisions(purchaseId))).toMatchObject({ status: 'current', revision: { source: 'purchaseEdit' } });
    } finally { f.native.close(); }
  });

  test('to one installment, back to installments, to debit and deletion keep the whole history', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      setClosingDay(f, 20);
      const created = await f.save(credit());
      const id = created.transaction.id;
      const purchaseId = `installment-${id}`;
      const step = async (changes: Partial<SaveManualTransactionParams>, offset: number) => {
        jest.setSystemTime(new Date(FINANCIAL_TEST_DATE.getTime() + offset * 60_000));
        return f.save(credit({ editingTransaction: await transactionOf(f, id), ...changes }));
      };
      await step({ installmentCountInput: '1' }, 1);
      expect(await purchaseOf(f, id)).toBeUndefined();
      expect(selectEffectivePlanRevision(await history(f).getPlanRevisions(purchaseId)).status).toBe('removed');
      await step({ installmentCountInput: '4', amount: 400000 }, 2);
      await step({ operationType: 'Débito', accountId: 'bank', installmentCountInput: '1' }, 3);
      await step({ installmentCountInput: '2' }, 4);
      await deleteManualTransactionSafely({ ...f, accounts: await f.accountRepository.getAccounts(), transaction: await transactionOf(f, id) });
      expect(revisionRows(f).map(shape)).toEqual([
        [0, 'original', 'projected', null, 30000000, 3, 10000000, '2026-10-20'],
        [1, 'purchaseRemoval', 'pendingVerification', 'purchaseRemoved', null, null, null, null],
        // Recreated with the same id: a new incarnation with its own terms, nothing inherited.
        [2, 'original', 'projected', null, 40000000, 4, 10000000, '2026-10-20'],
        [3, 'purchaseRemoval', 'pendingVerification', 'purchaseRemoved', null, null, null, null],
        [4, 'original', 'projected', null, 30000000, 2, 15000000, '2026-10-20'],
        [5, 'purchaseRemoval', 'pendingVerification', 'purchaseRemoved', null, null, null, null],
      ]);
      expect(rows(f, 'SELECT COUNT(*) AS n FROM transactions')).toEqual([{ n: 0 }]);
      expect(rows(f, 'PRAGMA foreign_key_check')).toEqual([]);
    } finally { f.native.close(); }
  });

  test('the quick installment action creates revision 0 when it creates the plan, and only then', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      const created = await f.save(credit({ installmentCountInput: '1' }));
      const dependencies = { accountRepository: f.accountRepository, transactionRepository: f.transactionRepository, creditCardRepository: f.creditCardRepository };
      await updateTransactionQuickly(dependencies, created.transaction.id, { kind: 'installments', installmentCount: 3, interestFreeCount: 0 });
      expect(revisionRows(f).map(row => [row.source, row.remaining_installments])).toEqual([['original', 3]]);
      await updateTransactionQuickly(dependencies, created.transaction.id, { kind: 'installments', installmentCount: 3, interestFreeCount: 0 });
      expect(revisionRows(f)).toHaveLength(1);
      await updateTransactionQuickly(dependencies, created.transaction.id, { kind: 'installments', installmentCount: 1, interestFreeCount: 0 });
      expect(revisionRows(f).map(row => row.source)).toEqual(['original', 'purchaseRemoval']);
    } finally { f.native.close(); }
  });

  test('repeating the initial revision writes nothing more', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      const created = await f.save(credit());
      const purchase = (await purchaseOf(f, created.transaction.id))!;
      const before = await financialState(f);
      f.resetTrace();
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await runSharedSQLiteTransaction(f.database, participant => recordInitialInstallmentRevision({
          creditCardRepository: createSqliteCreditCardRepository(participant), purchase, purchaseDate: '2026-10-11', createdAt: 'other',
        }));
        expect(result).toMatchObject({ status: 'confirmed', value: { revisionNumber: 0, createdAt: NOW } });
      }
      expect(f.trace.filter(entry => entry.write !== undefined)).toEqual([]);
      expect(await financialState(f)).toEqual(before);
      // The repository itself refuses a second original revision in the same incarnation.
      await expect(history(f).appendPlanRevision(buildInitialInstallmentRevision({ purchase, purchaseDate: '2026-10-11',
        billing: {}, createdAt: NOW }))).rejects.toThrow('revisión original vigente');
      expect(await financialState(f)).toEqual(before);
    } finally { f.native.close(); }
  });
});

/** Same flow in an isolated module registry, with or without the revision 0 step, from the same clock and id sequence. */
async function runIsolatedFlow(withRevision: boolean) {
  let modules!: { fixture: typeof financialIntegrityFixture; state: typeof financialState; remove: typeof deleteManualTransactionSafely;
    pay: typeof registerCreditCardPayment };
  const path = '../src/modules/creditCards/useCases/initialInstallmentRevision';
  jest.isolateModules(() => {
    if (!withRevision) jest.doMock(path, () => ({ ...jest.requireActual(path), recordInitialInstallmentRevision: async () => undefined }));
    modules = {
      fixture: require('./helpers/financialIntegrityFixture').financialIntegrityFixture,
      state: require('./helpers/financialState').financialState,
      remove: require('../src/modules/transactions/useCases/saveManualTransaction').deleteManualTransactionSafely,
      pay: require('../src/modules/creditCards/useCases/creditCardTransactionRelations').registerCreditCardPayment,
    };
  });
  jest.dontMock(path);
  jest.setSystemTime(FINANCIAL_TEST_DATE);
  const f = await modules.fixture({ managed: true });
  try {
    setClosingDay(f, 20);
    const at = (minutes: number) => jest.setSystemTime(new Date(FINANCIAL_TEST_DATE.getTime() + minutes * 60_000));
    const current = async (id: string) => (await f.transactionRepository.getTransactions()).find(row => row.id === id)!;
    const snapshots: FinancialState[] = [];
    const record = async () => snapshots.push(await modules.state(f));
    const created = await f.save(credit()); await record();
    const cents = await f.save(credit({ amount: 1234.57, installmentCountInput: '6', merchantName: 'Centavos' })); await record();
    at(1); await f.save(credit({ editingTransaction: await current(created.transaction.id), merchantName: 'Renombrada' })); await record();
    at(2); await f.save(credit({ editingTransaction: await current(created.transaction.id), merchantName: 'Renombrada', installmentCountInput: '6' })); await record();
    at(3); const payment = await modules.pay({ ...f, accountId: 'card', sourceAccountId: 'bank', amount: 100000, currentDate: FINANCIAL_TEST_DATE }); await record();
    at(4); await f.save(credit({ editingTransaction: await current(cents.transaction.id), amount: 1234.57, installmentCountInput: '1', merchantName: 'Centavos' })); await record();
    at(5); await f.save(credit({ editingTransaction: await current(cents.transaction.id), amount: 1234.57, installmentCountInput: '2', merchantName: 'Centavos' })); await record();
    at(6); await modules.remove({ ...f, accounts: await f.accountRepository.getAccounts(), transaction: await current(payment.transaction.id) }); await record();
    at(7); await modules.remove({ ...f, accounts: await f.accountRepository.getAccounts(), transaction: await current(created.transaction.id) }); await record();
    const writes = f.trace.filter(entry => entry.write !== undefined).map(entry => ({ sql: entry.sql, values: entry.values }));
    return { snapshots, writes, revisions: revisionRows(f) };
  } finally { f.native.close(); }
}

describe('financial invariants', () => {
  test('revision 0 adds history rows only: same accounting, movements, statements, plans and other writes', async () => {
    const without = await runIsolatedFlow(false);
    const withRevision = await runIsolatedFlow(true);
    const isRevisionInsert = (sql: string) => sql.trim().startsWith('INSERT INTO installment_plan_revisions');
    expect(withRevision.writes.filter(write => !isRevisionInsert(write.sql))).toEqual(without.writes);
    // Three plans created: two new purchases and one recreation.
    expect(withRevision.writes.filter(write => isRevisionInsert(write.sql))).toHaveLength(3);
    expect(without.revisions).toEqual([]);
    withRevision.snapshots.forEach((snapshot, index) => {
      const other = without.snapshots[index]!;
      // Balances, debt, available credit, wealth, income, expenses and savings.
      expect(snapshot.metrics).toEqual(other.metrics);
      const withoutHistory = (state: FinancialState) => Object.fromEntries(Object.entries(state.tables)
        .filter(([name]) => name !== 'installment_plan_revisions' && name !== 'financial_data_revision'));
      expect(withoutHistory(snapshot)).toEqual(withoutHistory(other));
      const [revisionA, revisionB] = [snapshot.tables.financial_data_revision, other.tables.financial_data_revision];
      // Every history row (application or trigger) and nothing else moves the backup counter.
      expect(Number(revisionA![0]!.revision) - Number(revisionB![0]!.revision)).toBe(snapshot.tables.installment_plan_revisions!.length);
      expect(snapshot.integrity).toEqual(other.integrity);
    });
    expect(withRevision.revisions.map(row => [row.revision_number, row.source])).toEqual([
      [0, 'original'], [1, 'purchaseEdit'], [2, 'purchaseRemoval'],
      [0, 'original'], [1, 'purchaseRemoval'], [2, 'original'],
    ]);
    // paid_installments is never derived from history.
    const plans = withRevision.snapshots.at(-1)!.tables.installment_purchases!;
    expect(plans.map(row => row.paid_installments)).toEqual([0]);
  });
});

describe('atomicity', () => {
  async function run(fault?: SQLiteFault) {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      setClosingDay(f, 20);
      const before = await financialState(f);
      f.resetTrace(); f.injectFault(fault);
      let error: unknown;
      try { await f.save(credit()); } catch (caught) { error = caught; }
      const trace = f.trace.map(entry => ({ ...entry }));
      f.injectFault();
      if (error instanceof SQLiteCommandFailure && error.result.status === 'unknown') return { before, trace, error };
      return { before, after: await financialState(f), trace, error };
    } finally { try { f.native.close(); } catch { /* retired after an unknown result */ } }
  }

  test('a failure before or after every write, including the revision, rolls back everything', async () => {
    const success = await run();
    expect(success.error).toBeUndefined();
    const writes = success.trace.filter(entry => entry.write !== undefined);
    const revision = writes.find(entry => entry.sql.trim().startsWith('INSERT INTO installment_plan_revisions'))!;
    const plan = writes.find(entry => entry.sql.includes('installment_purchases'))!;
    expect(revision.write).toBe(plan.write! + 1);
    for (const entry of writes) {
      for (const phase of ['before', 'after'] as const) {
        const failed = await run({ phase, write: entry.write });
        expect(failed.error).toBeDefined();
        expect(failed.error).not.toBeInstanceOf(SQLiteCommandFailure);
        expect(failed.trace.filter(value => value.sql.startsWith('BEGIN'))).toHaveLength(1);
        expect(failed.trace.filter(value => value.sql.startsWith('ROLLBACK') && value.outcome === 'ok')).toHaveLength(1);
        expect(failed.trace.some(value => value.sql.startsWith('COMMIT'))).toBe(false);
        requireIntegralRollback(failed.before, failed.after!);
      }
    }
  });

  test('a failing revision leaves no purchase, and a failing purchase leaves no orphan revision', async () => {
    const revisionFails = await run({ phase: 'before', sql: 'INSERT INTO installment_plan_revisions' });
    expect(revisionFails.after!.tables.installment_purchases).toEqual([]);
    expect(revisionFails.after!.tables.transactions).toEqual([]);
    const purchaseFails = await run({ phase: 'after', sql: 'installment_purchases' });
    expect(purchaseFails.trace.some(entry => entry.sql.includes('INSERT INTO installment_plan_revisions'))).toBe(false);
    expect(purchaseFails.after!.tables.installment_plan_revisions).toEqual([]);
    requireIntegralRollback(revisionFails.before, revisionFails.after!);
    requireIntegralRollback(purchaseFails.before, purchaseFails.after!);
  });

  test.each(['before', 'after'] as const)('COMMIT %s: unknown result, retired connection, no retry, no duplicate after reopening', async phase => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'smartfin-1a4a-unknown-'));
    const syntheticPath = join(directory, 'synthetic.db');
    try {
      const f = await financialIntegrityFixture({ managed: true, syntheticPath });
      f.resetTrace(); f.injectFault({ phase, sql: 'COMMIT' });
      const error = await f.save(credit()).then(() => undefined, caught => caught);
      expect(error).toBeInstanceOf(SQLiteCommandFailure);
      expect((error as SQLiteCommandFailure).result.status).toBe('unknown');
      expect(f.trace.filter(entry => entry.sql.startsWith('BEGIN'))).toHaveLength(1);
      expect(f.trace.filter(entry => entry.sql.trim().startsWith('INSERT INTO installment_plan_revisions'))).toHaveLength(1);
      expect(() => f.query('SELECT 1')).toThrow('database is not open');
      // Forensic reopen of the synthetic file: all or nothing, never duplicated.
      const forensic = realSQLite({ syntheticPath, fixedSqlDate: FINANCIAL_TEST_DATE });
      const purchases = rows(forensic, 'SELECT id FROM installment_purchases');
      const revisions = revisionRows(forensic);
      expect(purchases).toHaveLength(phase === 'after' ? 1 : 0);
      expect(revisions.map(row => [row.installment_purchase_id, row.revision_number]))
        .toEqual(purchases.map(row => [row.id, 0]));
      expect(rows(forensic, 'PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      forensic.native.close();
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  test('revision 0 survives closing and reopening SQLite, and the startup migration adds nothing', async () => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'smartfin-1a4a-reopen-'));
    const syntheticPath = join(directory, 'synthetic.db');
    try {
      const f = await financialIntegrityFixture({ managed: true, syntheticPath });
      setClosingDay(f, 20);
      await f.save(credit());
      const before = revisionRows(f);
      f.native.close();
      const reopened = realSQLite({ syntheticPath, fixedSqlDate: FINANCIAL_TEST_DATE });
      reopened.native.exec('PRAGMA foreign_keys = ON;');
      await applyVersionedMigrations(reopened.database);
      expect(revisionRows(reopened)).toEqual(before);
      expect(before.map(shape)).toEqual([[0, 'original', 'projected', null, 30000000, 3, 10000000, '2026-10-20']]);
      reopened.native.close();
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('migration 5 compatibility', () => {
  test('migrated purchases keep their single revision 0; purchases created afterwards get their own', async () => {
    const f = await financialIntegrityFixture({ managed: true });
    try {
      const legacy = await f.save(credit({ amount: 1234.56, installmentCountInput: '6', merchantName: 'Heredada' }));
      downgradeToVersion4(f);
      expect(rows(f, "SELECT name FROM sqlite_master WHERE name = 'installment_plan_revisions'")).toEqual([]);
      await applyVersionedMigrations(f.database);
      const legacyId = (await purchaseOf(f, legacy.transaction.id))!.id;
      const migrated = rows(f, 'SELECT id, total_amount, monthly_amount, installment_count FROM installment_purchases')
        .map(buildOriginalInstallmentRevision)[0]!;
      expect(revisionRows(f)).toEqual([expect.objectContaining({ id: `${legacyId}:revision:0`, verification: 'pendingVerification',
        remaining_principal_cents: migrated.remainingPrincipalCents, installment_amount_cents: migrated.installmentAmountCents })]);
      const identity = rows(f, 'SELECT rowid, id FROM installment_purchases');

      jest.setSystemTime(new Date(FINANCIAL_TEST_DATE.getTime() + 60_000));
      const fresh = await f.save(credit({ merchantName: 'Nueva' }));
      // Ordinary edit of the migrated purchase: nothing appended to it.
      await f.save(credit({ editingTransaction: await transactionOf(f, legacy.transaction.id), amount: 1234.56,
        installmentCountInput: '6', merchantName: 'Heredada renombrada' }));
      await applyVersionedMigrations(f.database);
      const byPurchase = revisionRows(f).reduce<Record<string, number>>((acc, row) => {
        acc[String(row.installment_purchase_id)] = (acc[String(row.installment_purchase_id)] ?? 0) + 1; return acc;
      }, {});
      expect(byPurchase).toEqual({ [legacyId]: 1, [`installment-${fresh.transaction.id}`]: 1 });
      expect(rows(f, 'SELECT rowid, id FROM installment_purchases WHERE id = ?', [legacyId])).toEqual(identity);
      expect(rows(f, 'SELECT version FROM schema_migrations ORDER BY version').map(row => row.version)).toEqual([1, 2, 3, 4, 5]);
      expect(rows(f, 'SELECT COUNT(*) AS n FROM installment_allocations')).toEqual([{ n: 0 }]);
    } finally { f.native.close(); }
  });
});
