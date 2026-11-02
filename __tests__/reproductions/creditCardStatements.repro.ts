// Phase 0 · 4.1 Multi-cycle statements. Synthetic in-memory SQLite only; production code unchanged.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { creditCardFixture, CYCLE_DATES, installFixedClock } from './creditCardFixture';
import { phase0Evidence } from './phase0Evidence';

installFixedClock();
const evidence = phase0Evidence('creditCardStatements');

/** Purchase of 600.000 COP in 6 installments, then one reconciliation (statement query) per cycle. */
async function sixInstallmentsOverSevenCycles(extra?: (f: Awaited<ReturnType<typeof creditCardFixture>>) => Promise<void>) {
  const f = await creditCardFixture();
  await f.purchase(600000, 6, CYCLE_DATES[0]!, 'Televisor');
  const months = [];
  for (const [index, date] of CYCLE_DATES.entries()) {
    if (index === 1 && extra) await extra(f);
    await f.reconcile(date);
    months.push(await f.month(date));
  }
  return { f, statements: await f.statements(), months, card: await f.card() };
}

test('characterization: only the purchase cycle bills an installment; the five later installments never appear', async () => {
  const { f, statements } = await sixInstallmentsOverSevenCycles();
  try {
    expect(statements.map(s => [s.statementStartDate, s.totalAmount, s.status])).toEqual([
      ['2026-09-21', 100000, 'pending'],
      ['2026-10-21', 0, 'open'],
      ['2026-11-21', 0, 'open'],
      ['2026-12-21', 0, 'open'],
      ['2027-01-21', 0, 'open'],
      ['2027-02-21', 0, 'open'],
      ['2027-03-21', 0, 'open'],
    ]);
    evidence.sixInstallments = {
      status: 'confirmed',
      observed: statements,
      expected: 'six consecutive statements of 100.000 (sum 600.000)',
      note: 'Statement charges only include purchases dated inside the cycle (creditCardTransactionRelations.ts, statementChargeAmounts).',
    };
  } finally { f.native.close(); }
});

test('debt, expense and wealth stay consistent while the statements are wrong', async () => {
  const { f, months, card } = await sixInstallmentsOverSevenCycles();
  try {
    // The purchase is an expense once (October); later months carry debt but no expense; wealth is constant.
    expect(months).toEqual([{ expense: 600000, wealth: 400000, debt: 600000 },
      ...Array.from({ length: 6 }, () => ({ expense: 0, wealth: 400000, debt: 600000 }))]);
    expect(card?.debtBalance?.amount).toBe(600000);
    evidence.debtAndExpense = { status: 'discarded', observed: months, note: 'No accounting inconsistency: only the statement is affected.' };
  } finally { f.native.close(); }
});

test('characterization: an earlier purchase disappears from the next cycle when a new purchase is billed', async () => {
  const { f, statements } = await sixInstallmentsOverSevenCycles(card => card.purchase(300000, 3, CYCLE_DATES[1]!, 'Nevera').then(() => undefined));
  try {
    expect(statements.map(s => s.totalAmount)).toEqual([100000, 100000, 0, 0, 0, 0, 0]);
    evidence.previousPurchases = {
      status: 'confirmed',
      observed: statements,
      expected: 'the second cycle bills installment 2 of the TV and installment 1 of the fridge; nine installments (900.000) in total',
    };
  } finally { f.native.close(); }
});

// Acceptance criteria for Phase 1 (fail today, on purpose). Offset-agnostic: whichever cycle bills installment 1.
test.failing('acceptance: six consecutive cycles bill 100.000 each and add up to the purchase', async () => {
  const { f, statements } = await sixInstallmentsOverSevenCycles();
  try {
    const totals = statements.map(s => s.totalAmount);
    const first = totals.findIndex(total => total > 0);
    expect(totals.slice(first, first + 6)).toEqual(Array(6).fill(100000));
    expect(totals.reduce((sum, total) => sum + total, 0)).toBe(600000);
  } finally { f.native.close(); }
});

test.failing('acceptance: earlier installments keep appearing next to new purchases', async () => {
  const { f, statements } = await sixInstallmentsOverSevenCycles(card => card.purchase(300000, 3, CYCLE_DATES[1]!, 'Nevera').then(() => undefined));
  try {
    expect(statements.reduce((sum, s) => sum + s.totalAmount, 0)).toBe(900000);
    expect(statements[1]!.totalAmount).toBeGreaterThanOrEqual(200000);
  } finally { f.native.close(); }
});
