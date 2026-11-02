// Phase 1a.2: synthetic multi-cycle statement scenarios (in-memory SQLite only). The same runner records the
// behavior before the correction (reproduction) and after it (stable regression), so both are comparable.
import { creditCardFixture } from '../reproductions/creditCardFixture';
import { serializeCreditCardVisualMetadata } from '../../src/modules/creditCards/useCases/manageCreditCards';
import { reconcileCreditCardTransactions } from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';

export type Fixture = Awaited<ReturnType<typeof creditCardFixture>>;

/** Noon in Bogotá of a civil date: never ambiguous, independent of the host time zone. */
export const bogotaNoon = (date: string) => new Date(`${date}T17:00:00.000Z`);

export async function scenarioFixture(closingDay?: number) {
  const f = await creditCardFixture();
  f.native.prepare('UPDATE accounts SET description = ? WHERE id = ?;')
    .run(serializeCreditCardVisualMetadata(closingDay === undefined ? { paymentDay: 5 } : { closingDay, paymentDay: 5 }), 'card');
  return f;
}

/** Purchase with an explicit civil date (`occurrence`), recorded at noon of that day. */
export async function purchaseOn(f: Fixture, date: string, amount: number, installments: number, merchantName = 'Compra sintética') {
  const now = bogotaNoon(date);
  f.at(now);
  return f.save({
    accountId: 'card', operationType: 'Crédito', amount, merchantName, installmentCountInput: String(installments),
    occurrence: { kind: 'date', date }, currentDate: now, now,
  });
}

export async function reconcileOn(f: Fixture, date: string) {
  const now = bogotaNoon(date);
  f.at(now);
  return reconcileCreditCardTransactions({ ...f, currentDate: now });
}

/** Every financial magnitude a statement correction must not change, plus the statements themselves. */
export async function observe(f: Fixture, date: string) {
  const accounts = await f.accountRepository.getAccounts();
  const card = accounts.find(account => account.id === 'card');
  const summary = await getDashboardSummaryFromDb(f.database, bogotaNoon(date));
  const statements = (await f.creditCardRepository.getStatements(['card']))
    .map(s => ({ start: s.statementStartDate, end: s.statementEndDate, total: s.totalAmount, minimum: s.minimumPaymentAmount ?? null, status: s.status }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const transactions = (await f.transactionRepository.getTransactions())
    .map(t => [t.id, t.amount, t.type, t.direction, t.accountId, t.targetAccountId ?? null, t.civilDate ?? t.date.slice(0, 10)])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const installments = (await f.creditCardRepository.getInstallmentPurchases(['card']))
    .map(p => [p.transactionId, p.totalAmount, p.installmentCount, p.paidInstallments, p.monthlyAmount, p.status])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return {
    date,
    bank: accounts.find(account => account.id === 'bank')?.balance.amount,
    debt: card?.debtBalance?.amount,
    available: Math.max((card?.creditLimit?.amount ?? 0) - (card?.debtBalance?.amount ?? 0), 0),
    expense: summary.monthlyExpenses, income: summary.monthlyIncome, wealth: summary.netWorth,
    statements, transactions, installments,
    integrity: f.query('PRAGMA integrity_check').rows.raw(),
    foreignKeys: f.query('PRAGMA foreign_key_check').rows.raw(),
  };
}

export const CYCLE_DAYS_20 = ['2026-10-11', '2026-11-11', '2026-12-11', '2027-01-11', '2027-02-11', '2027-03-11', '2027-04-11'];

/** A: 600.000 in 6 installments on 11 Oct 2026, closing day 20; one reconciliation per cycle. */
export async function scenarioA() {
  const f = await scenarioFixture(20);
  try {
    await purchaseOn(f, '2026-10-11', 600000, 6, 'Televisor');
    const steps = [];
    for (const date of CYCLE_DAYS_20) {
      await reconcileOn(f, date);
      steps.push(await observe(f, date));
    }
    return steps;
  } finally { f.native.close(); }
}

/** B: A plus 300.000 in 3 installments on 11 Nov 2026. */
export async function scenarioB() {
  const f = await scenarioFixture(20);
  try {
    await purchaseOn(f, '2026-10-11', 600000, 6, 'Televisor');
    const steps = [];
    for (const [index, date] of CYCLE_DAYS_20.entries()) {
      if (index === 1) await purchaseOn(f, '2026-11-11', 300000, 3, 'Nevera');
      await reconcileOn(f, date);
      steps.push(await observe(f, date));
    }
    return steps;
  } finally { f.native.close(); }
}

/**
 * C: October bills 300.000 (one installment) and 600.000 in 6; on 12 Nov the user pays 400.000 for the
 * October statement and buys 50.000 in November. The payment is dated in the November cycle.
 */
export async function scenarioC() {
  const f = await scenarioFixture(20);
  try {
    await purchaseOn(f, '2026-10-11', 300000, 1, 'Mercado');
    await purchaseOn(f, '2026-10-12', 600000, 6, 'Televisor');
    await reconcileOn(f, '2026-10-20');
    const october = await observe(f, '2026-10-20');
    const payDate = bogotaNoon('2026-11-12');
    f.at(payDate);
    const payment = await f.pay(400000, payDate);
    await purchaseOn(f, '2026-11-13', 50000, 1, 'Farmacia');
    await reconcileOn(f, '2026-11-20');
    const november = await observe(f, '2026-11-20');
    return { october, payment: { paid: payment.paidAmount, remainingDebt: payment.remainingDebt }, november };
  } finally { f.native.close(); }
}

/** D: boundary dates. Each case: closing day, purchase date, installments and the cycles reconciled. */
export const BOUNDARY_CASES = [
  { name: 'before closing day', closingDay: 20, purchase: '2026-10-19', count: 3, cycles: ['2026-10-19', '2026-11-19', '2026-12-19'] },
  { name: 'on closing day (no card policy)', closingDay: 20, purchase: '2026-10-20', count: 3, cycles: ['2026-10-20', '2026-11-19', '2026-12-19'] },
  { name: 'after closing day', closingDay: 20, purchase: '2026-10-21', count: 3, cycles: ['2026-10-21', '2026-11-19', '2026-12-19', '2027-01-19'] },
  { name: 'closing 31, short months', closingDay: 31, purchase: '2027-01-05', count: 4, cycles: ['2027-01-05', '2027-02-10', '2027-03-10', '2027-04-10'] },
  { name: 'closing 30, leap February', closingDay: 30, purchase: '2028-01-31', count: 3, cycles: ['2028-01-31', '2028-02-29', '2028-03-10', '2028-04-10'] },
  { name: 'closing 29, normal February', closingDay: 29, purchase: '2027-01-30', count: 2, cycles: ['2027-01-30', '2027-02-28', '2027-03-10'] },
  { name: 'year change', closingDay: 20, purchase: '2026-12-21', count: 3, cycles: ['2026-12-21', '2027-01-15', '2027-02-15', '2027-03-15'] },
  { name: 'card without closingDay', closingDay: undefined, purchase: '2026-10-11', count: 3, cycles: ['2026-10-11', '2026-11-11', '2026-12-11'] },
  { name: 'cents and residue (100.000 in 3)', closingDay: 20, purchase: '2026-10-11', count: 3, amount: 100000, cycles: ['2026-10-11', '2026-11-11', '2026-12-11'] },
  { name: 'zero-cent installments (0,01 in 2)', closingDay: 20, purchase: '2026-10-11', count: 2, amount: 0.01, cycles: ['2026-10-11', '2026-11-11'] },
  { name: 'single installment', closingDay: 20, purchase: '2026-10-11', count: 1, amount: 123456.78, cycles: ['2026-10-11', '2026-11-11'] },
] as const;

export async function scenarioD() {
  const results = [];
  for (const boundary of BOUNDARY_CASES) {
    const f = await scenarioFixture(boundary.closingDay);
    try {
      await purchaseOn(f, boundary.purchase, 'amount' in boundary ? boundary.amount : 300000, boundary.count);
      const steps = [];
      for (const date of boundary.cycles) {
        await reconcileOn(f, date);
        steps.push(await observe(f, date));
      }
      results.push({ name: boundary.name, steps });
    } finally { f.native.close(); }
  }
  return results;
}

/** Compact statement view: [start, end, total, minimum, status]. */
export const statementRows = (step: Awaited<ReturnType<typeof observe>>) =>
  step.statements.map(s => [s.start, s.end, s.total, s.minimum, s.status]);
