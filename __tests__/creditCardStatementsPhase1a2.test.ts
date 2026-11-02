// Phase 1a.2: multi-cycle statements from the installment engine. Synthetic in-memory SQLite only.
// The financial magnitudes (balances, debt, expense, wealth, movements, installment records) must equal
// the behavior recorded before the correction (docs/correccion-fase1a2/node/before.json) bit for bit;
// only the statements change, and each change is asserted against an independent BigInt oracle.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { creditCardFixture, CYCLE_DATES, installFixedClock } from './reproductions/creditCardFixture';
import { cents } from './reproductions/phase0Evidence';
import {
  BOUNDARY_CASES, bogotaNoon, observe, purchaseOn, reconcileOn, scenarioA, scenarioB, scenarioC, scenarioD,
  scenarioFixture, statementRows,
} from './helpers/phase1a2StatementScenarios';
import * as previous from './helpers/pre6B3CreditCardRelations';
import { reconcileCreditCardTransactions } from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { statementChargesForCycle } from '../src/modules/creditCards/useCases/creditCardStatementCharges';
import { deleteManualTransactionSafely } from '../src/modules/transactions/useCases/saveManualTransaction';
import type { InstallmentPurchase } from '../src/modules/creditCards/types';

const fs = require('node:fs') as {
  readFileSync: (path: string, encoding: 'utf8') => string;
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  writeFileSync: (path: string, value: string) => void;
};

installFixedClock();
type Step = Awaited<ReturnType<typeof observe>>;
const BEFORE = JSON.parse(fs.readFileSync('docs/correccion-fase1a2/node/before.json', 'utf8')) as {
  A: Step[]; B: Step[]; C: { october: Step; november: Step; payment: unknown }; D: { name: string; steps: Step[] }[];
};
const after: Record<string, unknown> = {};
afterAll(() => {
  fs.mkdirSync('docs/correccion-fase1a2/node', { recursive: true });
  fs.writeFileSync('docs/correccion-fase1a2/node/after.json', JSON.stringify(after, null, 2) + '\n');
});

/** Everything except the statements must be identical to the pre-correction run. */
function expectSameFinancials(actual: Step, before: Step) {
  expect({ ...actual, statements: undefined }).toEqual({ ...before, statements: undefined });
  expect(actual.integrity).toEqual([{ integrity_check: 'ok' }]);
  expect(actual.foreignKeys).toEqual([]);
}

/** Totals of the statement of each step's cycle (the cycle containing the step date). */
const currentTotals = (steps: Step[]) => steps.map(step => step.statements[step.statements.length - 1]!.total);
const oracleSum = (amounts: number[]) => amounts.reduce((sum, amount) => sum + cents(amount), 0n);

describe('scenario A: 600.000 in 6 installments, closing day 20', () => {
  test('six consecutive cycles bill 100.000 each and add up to the purchase', async () => {
    const steps = await scenarioA();
    after.A = steps;
    expect(statementRows(steps[6]!)).toEqual([
      ['2026-09-21', '2026-10-20', 100000, 10000, 'pending'],
      ['2026-10-21', '2026-11-20', 100000, 10000, 'pending'],
      ['2026-11-21', '2026-12-20', 100000, 10000, 'pending'],
      ['2026-12-21', '2027-01-20', 100000, 10000, 'pending'],
      ['2027-01-21', '2027-02-20', 100000, 10000, 'pending'],
      ['2027-02-21', '2027-03-20', 100000, 10000, 'pending'],
      ['2027-03-21', '2027-04-20', 0, 0, 'open'],
    ]);
    expect(oracleSum(currentTotals(steps))).toBe(cents('600000'));
    steps.forEach((step, index) => expectSameFinancials(step, BEFORE.A[index]!));
    // Debt is never derived from the statements: it stays the purchase until a payment.
    expect(steps.every(step => step.debt === 600000 && step.wealth === 400000)).toBe(true);
    // Expense once, in October; installments create no movements.
    expect(steps.map(step => step.expense)).toEqual([600000, 0, 0, 0, 0, 0, 0]);
    expect(steps[6]!.transactions).toHaveLength(1);
    // paid_installments and the plan status are untouched (D7).
    expect(steps[6]!.installments).toEqual(BEFORE.A[6]!.installments);
  });
});

describe('scenario B: overlapping plans', () => {
  test('earlier installments keep appearing next to new purchases (900.000 in total)', async () => {
    const steps = await scenarioB();
    after.B = steps;
    expect(currentTotals(steps)).toEqual([100000, 200000, 200000, 200000, 100000, 100000, 0]);
    expect(oracleSum(currentTotals(steps))).toBe(cents('900000'));
    steps.forEach((step, index) => expectSameFinancials(step, BEFORE.B[index]!));
    expect(steps.map(step => step.expense)).toEqual([600000, 300000, 0, 0, 0, 0, 0]);
  });
});

describe('scenario C: payment of the previous statement made in the next cycle', () => {
  test('the existing in-cycle payment rule is preserved and documented, debt unchanged', async () => {
    const result = await scenarioC();
    after.C = result;
    // October: 300.000 single + installment 1 of 600.000 = 400.000.
    expect(statementRows(result.october)).toEqual([['2026-09-21', '2026-10-20', 400000, 40000, 'pending']]);
    // November: new charges 50.000 + installment 2 (100.000) = 150.000; the 400.000 paid on 12 Nov for October
    // is dated in this cycle and, as before, offsets this cycle's charges. Without an allocation of payments to
    // statements (not in the model) the obligation cannot be attributed: the limitation is kept, not invented.
    expect(statementRows(result.november)[1]).toEqual(['2026-10-21', '2026-11-20', 0, 0, 'paid']);
    expect(result.payment).toEqual(BEFORE.C.payment);
    expectSameFinancials(result.october, BEFORE.C.october);
    expectSameFinancials(result.november, BEFORE.C.november);
    expect(result.november.debt).toBe(550000);
    expect(result.november.bank).toBe(600000);
  });

});

describe('scenario D: boundary dates', () => {
  const EXPECTED: Record<string, (number | string)[]> = {
    'before closing day': [100000, 100000, 100000],
    'on closing day (no card policy)': [100000, 0, 0],
    'after closing day': [100000, 100000, 100000, 100000],
    'closing 31, short months': [75000, 75000, 75000, 75000],
    'closing 30, leap February': [100000, 100000, 100000, 100000],
    'closing 29, normal February': [150000, 150000, 150000],
    'year change': [100000, 100000, 100000, 100000],
    'card without closingDay': [100000, 0, 0],
    'cents and residue (100.000 in 3)': [33333.33, 33333.33, 33333.34],
    'zero-cent installments (0,01 in 2)': [0, 0],
    'single installment': [123456.78, 0],
  };

  test('each cycle bills the engine installment; unschedulable plans keep the previous charge', async () => {
    const results = await scenarioD();
    after.D = results;
    for (const [index, result] of results.entries()) {
      expect([result.name, currentTotals(result.steps)]).toEqual([result.name, EXPECTED[result.name]]);
      result.steps.forEach((step, stepIndex) => expectSameFinancials(step, BEFORE.D[index]!.steps[stepIndex]!));
    }
    const byName = Object.fromEntries(results.map(result => [result.name, result.steps]));
    // Cycle ends follow the engine: last day of short months, leap February, year change.
    expect(byName['closing 31, short months']![3]!.statements.map(s => s.end)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
    expect(byName['closing 30, leap February']![1]!.statements.map(s => s.end)).toEqual(['2028-02-29']);
    expect(byName['year change']![1]!.statements.map(s => s.end)).toEqual(['2027-01-20']);
    // 100.000 in 3: exact cents, residue on the last installment; the minimum keeps its whole-peso rule.
    expect(byName['cents and residue (100.000 in 3)']![2]!.statements.map(s => s.minimum)).toEqual([3333, 3333, 3333]);
    expect(oracleSum(currentTotals(byName['cents and residue (100.000 in 3)']!))).toBe(cents('100000'));
    // Same cases as the boundary list, nothing skipped.
    expect(results.map(result => result.name)).toEqual(BOUNDARY_CASES.map(boundary => boundary.name));
  });

  test.each([
    ['on closing day without card policy', 20, '2026-10-20', 300000, 3, 'pendingVerification', ['missingClosingDayPurchasePolicy']],
    ['card without closingDay', undefined, '2026-10-11', 300000, 3, 'pendingVerification', ['missingClosingDay']],
    ['zero-cent installments', 20, '2026-10-11', 0.01, 2, 'requiresDecision', ['zeroCentInstallments']],
  ] as const)('%s: legacy charge kept and flagged, never presented as scheduled', async (_name, closingDay, date, amount, count, status, reasons) => {
    const f = await scenarioFixture(closingDay);
    try {
      await purchaseOn(f, date, amount, count);
      const report = await reconcileOn(f, date);
      expect(report.statements[0]!.charges.map(c => c.source)).toEqual(['legacyUnverified']);
      expect(report.statements[0]!.notices.map(n => [n.planStatus, n.reasons])).toEqual([[status, reasons]]);
    } finally { f.native.close(); }
  });
});

// Promoted from Phase 0 (installmentRounding.repro.ts and creditCardStatements.repro.ts acceptance tests).
describe('Phase 0 acceptance, now regressions', () => {
  test.each([['100000', 3], ['100000.50', 3], ['1', 3], ['0.40', 2]] as const)(
    '%s COP in %i installments is billed exactly, cent by cent', async (total, count) => {
      const f = await creditCardFixture();
      try {
        await f.purchase(Number(total), count, CYCLE_DATES[0]!);
        for (const date of CYCLE_DATES) await f.reconcile(date);
        const billed = (await f.statements()).reduce((sum, s) => sum + cents(s.totalAmount), 0n);
        expect(billed).toBe(cents(total));
      } finally { f.native.close(); }
    });
});

describe('protection of historical statements', () => {
  const rowsOf = (f: Awaited<ReturnType<typeof scenarioFixture>>) =>
    f.query('SELECT rowid AS r, * FROM credit_card_statements ORDER BY id').rows.raw();

  test('closed, paid and old open statements are never recalculated, overwritten or deleted', async () => {
    const f = await scenarioFixture(20);
    try {
      await purchaseOn(f, '2026-08-11', 600000, 6, 'Televisor');
      f.native.exec('DELETE FROM credit_card_statements;');
      // History stored by earlier versions: an old open row with the legacy 0, a paid one and a closed one.
      const insert = f.native.prepare(`INSERT INTO credit_card_statements (id,account_id,statement_start_date,statement_end_date,
        payment_due_date,total_amount,minimum_payment_amount,currency,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'COP',?,?,?)`);
      insert.run('statement-auto-card-2026-07-21-2026-08-20', 'card', '2026-07-21', '2026-08-20', '2026-09-05', 100000, 10000, 'closed', 'h1', 'h1');
      insert.run('statement-auto-card-2026-08-21-2026-09-20', 'card', '2026-08-21', '2026-09-20', '2026-10-05', 0, 0, 'paid', 'h2', 'h2');
      insert.run('statement-auto-card-2026-09-21-2026-10-20', 'card', '2026-09-21', '2026-10-20', '2026-11-05', 0, 0, 'open', 'h3', 'h3');
      const history = rowsOf(f);
      const report = await reconcileOn(f, '2026-11-11');
      const rows = rowsOf(f);
      expect(rows.slice(0, 3)).toEqual(history);
      expect(rows[3]).toMatchObject({ statement_end_date: '2026-11-20', total_amount: 100000, status: 'pending' });
      expect(report.statements[0]!.write).toBe('written');
      // Read-only diagnostic of the old open row: the engine would bill installment 3 there; nothing is written.
      const installments = await f.creditCardRepository.getInstallmentPurchases(['card']);
      const diagnostic = statementChargesForCycle({
        closingDay: 20, cycleStart: '2026-09-21', cycleEnd: '2026-10-20',
        installmentsByTransactionId: new Map(installments.map(p => [p.transactionId, p])),
        purchases: (await f.transactionRepository.getTransactions()).filter(t => t.accountId === 'card'),
      });
      expect(diagnostic.charges.map(c => [c.amount, c.installmentPosition])).toEqual([[100000, 3]]);
      expect(rowsOf(f)).toEqual(rows);
    } finally { f.native.close(); }
  });

  test('a stored closed statement of the current cycle is not overwritten', async () => {
    const f = await scenarioFixture(20);
    try {
      await purchaseOn(f, '2026-10-11', 600000, 6);
      f.native.exec("UPDATE credit_card_statements SET status='closed', total_amount=1 WHERE account_id='card'");
      const before = rowsOf(f);
      const report = await reconcileOn(f, '2026-10-15');
      expect(report.statements[0]!.write).toBe('storedClosed');
      expect(rowsOf(f)).toEqual(before);
    } finally { f.native.close(); }
  });

  test('reconciling an earlier date after a later cycle exists writes nothing (clock moved back), debt unchanged', async () => {
    const f = await scenarioFixture(20);
    try {
      await purchaseOn(f, '2026-10-11', 600000, 6);
      await reconcileOn(f, '2026-11-11');
      const before = { statements: rowsOf(f), debt: (await f.card())?.debtBalance?.amount };
      const report = await reconcileOn(f, '2026-10-15');
      expect(report.statements[0]!.write).toBe('supersededByLaterCycle');
      expect({ statements: rowsOf(f), debt: (await f.card())?.debtBalance?.amount }).toEqual(before);
    } finally { f.native.close(); }
  });

  test('repeated reconciliation is idempotent and keeps the statement id and created_at', async () => {
    const f = await scenarioFixture(20);
    try {
      await purchaseOn(f, '2026-10-11', 600000, 6);
      const [first] = rowsOf(f);
      await reconcileOn(f, '2026-10-15');
      await reconcileOn(f, '2026-10-15');
      const [again] = rowsOf(f);
      expect(rowsOf(f)).toHaveLength(1);
      expect({ ...again, r: undefined, updated_at: undefined }).toEqual({ ...first, r: undefined, updated_at: undefined });
      // INSERT OR REPLACE renumbers the rowid; nothing references it (no child tables).
    } finally { f.native.close(); }
  });
});

describe('compatibility with current operations', () => {
  test('ordinary flows without installment plans produce the same statements as the frozen previous rule', async () => {
    const run = async (reconcile: (date: string, f: Awaited<ReturnType<typeof scenarioFixture>>) => Promise<unknown>) => {
      const f = await scenarioFixture(20);
      try {
        await purchaseOn(f, '2026-10-11', 120000.5, 1, 'Mercado');
        await purchaseOn(f, '2026-10-20', 80000, 1, 'Cine');
        await f.save({ accountId: 'bank', operationType: 'Débito', amount: 1000, transactionType: 'expense', merchantName: 'Café' });
        await f.save({ accountId: 'bank', targetAccountId: 'target', amount: 5000, transactionType: 'internalTransfer', merchantName: 'Ahorro' });
        await f.save({ accountId: 'card', amount: 3000, transactionType: 'refund', merchantName: 'Devolución' });
        await f.pay(50000, bogotaNoon('2026-10-21'));
        await purchaseOn(f, '2026-10-25', 999.99, 1, 'Libro');
        await reconcile('2026-10-25', f);
        await reconcile('2026-11-25', f);
        return {
          statements: f.query('SELECT id,statement_start_date,statement_end_date,payment_due_date,total_amount,minimum_payment_amount,status FROM credit_card_statements ORDER BY id').rows.raw(),
          accounts: f.query('SELECT id,balance_amount,debt_balance_amount FROM accounts ORDER BY id').rows.raw(),
        };
      } finally { f.native.close(); }
    };
    const current = await run((date, f) => reconcileOn(f, date));
    const frozen = await run((date, f) => { f.at(bogotaNoon(date)); return previous.reconcileCreditCardTransactions({ ...f, currentDate: bogotaNoon(date) }); });
    expect(current).toEqual(frozen);
  });

  test('editing and deleting an installment purchase update the open statement only', async () => {
    const f = await scenarioFixture(20);
    try {
      const { transaction } = await purchaseOn(f, '2026-10-11', 600000, 6, 'Televisor');
      await reconcileOn(f, '2026-11-11');
      const october = f.query("SELECT * FROM credit_card_statements WHERE statement_end_date='2026-10-20'").rows.raw();
      f.at(bogotaNoon('2026-11-12'));
      await f.save({ accountId: 'card', operationType: 'Crédito', amount: 300000, merchantName: 'Televisor', installmentCountInput: '6',
        editingTransaction: transaction, currentDate: bogotaNoon('2026-11-12'), now: bogotaNoon('2026-11-12') });
      let step = await observe(f, '2026-11-12');
      expect(statementRows(step)[1]).toEqual(['2026-10-21', '2026-11-20', 50000, 5000, 'pending']);
      expect([step.debt, step.wealth]).toEqual([300000, 700000]);
      const edited = (await f.transactionRepository.getTransactions()).find(t => t.id === transaction.id)!;
      await deleteManualTransactionSafely({ ...f, accounts: await f.accountRepository.getAccounts(), transaction: edited });
      step = await observe(f, '2026-11-12');
      expect(statementRows(step)[1]).toEqual(['2026-10-21', '2026-11-20', 0, 0, 'open']);
      expect([step.debt, step.wealth, step.installments]).toEqual([0, 1000000, []]);
      expect(f.query("SELECT * FROM credit_card_statements WHERE statement_end_date='2026-10-20'").rows.raw()).toEqual(october);
    } finally { f.native.close(); }
  });

  test('partial and full-debt payments: debt exact, plan untouched, purchase not marked as settled', async () => {
    const f = await scenarioFixture(20);
    try {
      await purchaseOn(f, '2026-10-11', 100000, 3);
      await reconcileOn(f, '2026-11-11');
      const partial = await f.pay(30000, bogotaNoon('2026-11-11'));
      expect([partial.paidAmount, partial.remainingDebt]).toEqual([30000, 70000]);
      expect(statementRows(await observe(f, '2026-11-11'))[1]).toEqual(['2026-10-21', '2026-11-20', 3333.33, 333, 'pending']);
      const full = await f.pay(70000, bogotaNoon('2026-11-12'), 'fullDebt');
      const step = await observe(f, '2026-11-12');
      expect([full.remainingDebt, step.debt, step.bank, step.wealth]).toEqual([0, 0, 900000, 900000]);
      expect(statementRows(step)[1]).toEqual(['2026-10-21', '2026-11-20', 0, 0, 'paid']);
      expect(step.installments).toEqual([[expect.any(String), 100000, 3, 0, 33333, 'active']]);
    } finally { f.native.close(); }
  });
});

describe('atomicity', () => {
  test('a failing statement write rolls back the payment, the debit and the reconciliation', async () => {
    const f = await scenarioFixture(20);
    try {
      await purchaseOn(f, '2026-10-11', 600000, 6);
      await reconcileOn(f, '2026-11-11');
      const before = await observe(f, '2026-11-11');
      f.native.exec("CREATE TEMP TRIGGER fail_statement BEFORE INSERT ON credit_card_statements BEGIN SELECT RAISE(ABORT, 'injected statement failure'); END;");
      await expect(f.pay(100000, bogotaNoon('2026-11-11'))).rejects.toThrow('injected statement failure');
      expect(await observe(f, '2026-11-11')).toEqual(before);
      f.native.exec('DROP TRIGGER fail_statement;');
    } finally { f.native.close(); }
  });

  test('a failing statement insert leaves no partial statements and no debt change', async () => {
    const f = await scenarioFixture(20);
    try {
      await purchaseOn(f, '2026-10-11', 600000, 6);
      f.native.exec("UPDATE accounts SET debt_balance_amount = 1 WHERE id = 'card'");
      const before = await observe(f, '2026-12-11');
      f.native.exec("CREATE TEMP TRIGGER fail_insert BEFORE INSERT ON credit_card_statements BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END;");
      await expect(reconcileOn(f, '2026-12-11')).rejects.toThrow('injected insert failure');
      // The stale debt stays as it was: the debt update of the same scope was rolled back too.
      expect(await observe(f, '2026-12-11')).toEqual(before);
    } finally { f.native.close(); }
  });
});

describe('pure cycle charges', () => {
  const installment = (count: number, monthlyAmount: number): InstallmentPurchase => ({
    id: 'i', transactionId: 'p', accountId: 'card', totalAmount: 0, currency: 'COP', installmentCount: count,
    paidInstallments: 0, monthlyAmount, status: 'active', createdAt: 'c', updatedAt: 'u',
  });

  test('future cycles project the remaining installments exactly (projection only, nothing persisted)', () => {
    const map = new Map([['p', installment(7, 14285.71)]]);
    const purchases = [{ id: 'p', amount: 100000, date: '2026-10-11', civilDate: '2026-10-11' }];
    const ends = ['2026-10-20', '2026-11-20', '2026-12-20', '2027-01-20', '2027-02-20', '2027-03-20', '2027-04-20', '2027-05-20'];
    let previousEnd = '2026-09-20';
    const amounts = ends.map(end => {
      const start = `${previousEnd.slice(0, 8)}21`;
      previousEnd = end;
      const { charges } = statementChargesForCycle({ closingDay: 20, cycleStart: start, cycleEnd: end, installmentsByTransactionId: map, purchases });
      expect(charges.every(charge => charge.source === 'installmentProjected')).toBe(true);
      return charges.reduce((sum, charge) => sum + charge.amount, 0);
    });
    expect(amounts).toEqual([14285.71, 14285.71, 14285.71, 14285.71, 14285.71, 14285.71, 14285.74, 0]);
    expect(oracleSum(amounts)).toBe(cents('100000'));
  });

  test('a non-active or single-installment record keeps the full purchase in its cycle', () => {
    for (const record of [installment(1, 100000), { ...installment(3, 33333), status: 'paid' as const }]) {
      const { charges } = statementChargesForCycle({ closingDay: 20, cycleStart: '2026-09-21', cycleEnd: '2026-10-20',
        installmentsByTransactionId: new Map([['p', record]]), purchases: [{ id: 'p', amount: 100000, date: '2026-10-11' }] });
      expect(charges).toEqual([{ transactionId: 'p', amount: 100000, source: 'singleCharge' }]);
    }
  });

  test('the function does not mutate its inputs', () => {
    const map = new Map([['p', Object.freeze(installment(3, 33333))]]);
    const purchases = Object.freeze([Object.freeze({ id: 'p', amount: 100000, date: '2026-10-11' })]);
    const snapshot = JSON.stringify([...map.values(), purchases]);
    statementChargesForCycle({ closingDay: 20, cycleStart: '2026-10-21', cycleEnd: '2026-11-20', installmentsByTransactionId: map, purchases });
    expect(JSON.stringify([...map.values(), purchases])).toBe(snapshot);
  });

  test('the cycle report separates new charges from in-cycle payments', async () => {
    const f = await scenarioFixture(20);
    try {
      await purchaseOn(f, '2026-10-12', 600000, 6, 'Televisor');
      await purchaseOn(f, '2026-11-13', 50000, 1, 'Farmacia');
      const report = await reconcileOn(f, '2026-11-20');
      expect(report.statements[0]!.charges.map(c => [c.source, c.amount, c.installmentPosition ?? null])).toEqual([
        ['singleCharge', 50000, null], ['installmentProjected', 100000, 2],
      ]);
    } finally { f.native.close(); }
  });

  test('reconcile returns a report for every active card', async () => {
    const f = await scenarioFixture(20);
    try {
      const report = await reconcileCreditCardTransactions({ ...f, currentDate: bogotaNoon('2026-10-11') });
      expect(report.statements.map(s => [s.accountId, s.write, s.charges.length])).toEqual([['card', 'written', 0]]);
    } finally { f.native.close(); }
  });
});
