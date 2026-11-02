// Phase 0 · 4.3 Installment rounding. Synthetic in-memory SQLite only.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { creditCardFixture, CYCLE_DATES, installFixedClock } from './creditCardFixture';
import { cents, phase0Evidence } from './phase0Evidence';

installFixedClock();
const evidence = phase0Evidence('installmentRounding');

// [total, installments, stored monthly amount observed today]
const CASES = [
  ['100000', 3, 33333], ['600000', 6, 100000], ['100000.50', 3, 33334], ['100000.01', 3, 33333],
  ['10', 3, 3], ['2', 3, 1], ['1', 3, 0], ['0.40', 2, 0], ['0.01', 2, 0],
] as const;

async function storedPlan(total: string, count: number) {
  const f = await creditCardFixture();
  try {
    await f.purchase(Number(total), count, CYCLE_DATES[0]!);
    const [plan] = await f.installments();
    return { plan: plan!, debt: (await f.card())?.debtBalance?.amount };
  } finally { f.native.close(); }
}

test('characterization: one whole-peso monthly amount (Math.round(total / n)) loses or creates money', async () => {
  const rows = [];
  for (const [total, count, monthly] of CASES) {
    const { plan, debt } = await storedPlan(total, count);
    // The purchase, the debt and the expense keep the exact total; only the installment amount is rounded.
    expect(plan.totalAmount).toBe(Number(total));
    expect(debt).toBe(Number(total));
    expect(plan.monthlyAmount).toBe(monthly);
    const billed = cents(plan.monthlyAmount) * BigInt(count);
    rows.push({ total, count, monthlyAmount: plan.monthlyAmount, billedTotal: Number(billed) / 100,
      differenceCop: Number(billed - cents(total)) / 100 });
  }
  expect(rows.map(row => row.differenceCop)).toEqual([-1, 0, 1.5, -1.01, -1, 1, -1, -0.4, -0.01]);
  evidence.monthlyAmounts = { status: 'confirmed', observed: rows,
    expected: 'the installments of a purchase add up exactly to its total, in cents',
    note: 'saveTransactionInstallments stores a single Math.round(total / n); cents are dropped and amounts below n pesos give 0 per installment.' };
});

// Acceptance (fails today): the amounts billed across the cycles add up to the exact purchase. It also depends
// on 4.1, because today only one cycle bills an installment.
test.failing.each([['100000', 3], ['100000.50', 3], ['1', 3], ['0.40', 2]] as const)(
  'acceptance: %s COP in %i installments is billed exactly, cent by cent', async (total, count) => {
    const f = await creditCardFixture();
    try {
      await f.purchase(Number(total), count, CYCLE_DATES[0]!);
      for (const date of CYCLE_DATES) await f.reconcile(date);
      const billed = (await f.statements()).reduce((sum, s) => sum + cents(s.totalAmount), 0n);
      expect(billed).toBe(cents(total));
    } finally { f.native.close(); }
  });
