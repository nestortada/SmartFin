// Phase 0 · 4.2 Installment progress and card closure. Synthetic in-memory SQLite only.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { creditCardFixture, CYCLE_DATES, installFixedClock } from './creditCardFixture';
import { phase0Evidence } from './phase0Evidence';
import { deleteCreditCard } from '../../src/modules/creditCards/useCases/manageCreditCards';

installFixedClock();
const evidence = phase0Evidence('creditCardInstallmentProgress');

/** 600.000 in 6 installments; each cycle is queried and 100.000 is paid, until the debt is zero. */
async function payInstallmentByInstallment() {
  const f = await creditCardFixture();
  await f.purchase(600000, 6, CYCLE_DATES[0]!, 'Televisor');
  const steps = [];
  for (const date of CYCLE_DATES.slice(0, 6)) {
    await f.reconcile(date);
    const payment = await f.pay(100000, date);
    const [plan] = await f.installments();
    const billed = (await f.statements()).filter(s => s.status !== 'open').length;
    steps.push({ date: date.toISOString().slice(0, 10), paid: payment.paidAmount, remainingDebt: payment.remainingDebt,
      billedCycles: billed, paidInstallments: plan?.paidInstallments, planStatus: plan?.status });
  }
  return { f, steps };
}

async function closeResult(f: Awaited<ReturnType<typeof creditCardFixture>>) {
  try {
    await deleteCreditCard(f.creditCardRepository, 'card');
    return { closed: true, status: (await f.card())?.status };
  } catch (error) {
    return { closed: false, message: (error as Error).message };
  }
}

test('characterization: paying every installment leaves paidInstallments at 0 and the card cannot be closed', async () => {
  const { f, steps } = await payInstallmentByInstallment();
  try {
    expect(steps.map(s => s.remainingDebt)).toEqual([500000, 400000, 300000, 200000, 100000, 0]);
    expect(steps.every(s => s.paidInstallments === 0 && s.planStatus === 'active')).toBe(true);
    expect((await f.card())?.debtBalance?.amount).toBe(0);
    const close = await closeResult(f);
    expect(close).toEqual({ closed: false, message: 'No puedes eliminar la tarjeta porque tiene compras a cuotas vigentes.' });
    evidence.installmentByInstallment = { status: 'confirmed', observed: { steps, close },
      expected: 'with the whole purchase paid (debt 0) no installment is pending and the card can be closed',
      note: 'No production code advances paid_installments (only the demo seed writes it).' };
  } finally { f.native.close(); }
});

test('characterization: settling the whole debt at once also leaves the card blocked', async () => {
  const f = await creditCardFixture();
  try {
    await f.purchase(600000, 6, CYCLE_DATES[0]!, 'Televisor');
    await f.reconcile(CYCLE_DATES[0]!);
    const payment = await f.pay(600000, CYCLE_DATES[0]!, 'fullDebt');
    expect(payment).toMatchObject({ paidAmount: 600000, remainingDebt: 0 });
    expect((await f.installments())[0]).toMatchObject({ paidInstallments: 0, status: 'active' });
    const close = await closeResult(f);
    expect(close.closed).toBe(false);
    evidence.fullDebtSettlement = { status: 'confirmed', observed: { payment: { paidAmount: payment.paidAmount, remainingDebt: payment.remainingDebt }, close } };
  } finally { f.native.close(); }
});

test('ambiguous: billed installments, paid installments and stored progress are three different numbers', async () => {
  const { f, steps } = await payInstallmentByInstallment();
  try {
    const third = steps[2]!;
    // After three cycles: 300.000 paid (three installments' worth), the statements show one billed cycle with
    // charges (defect 4.1) and the stored progress says 0. Which one "paid installments" means is a product rule.
    expect(third).toMatchObject({ paid: 100000, remainingDebt: 300000, paidInstallments: 0 });
    evidence.billedVersusPaid = { status: 'ambiguous', observed: steps,
      note: 'Decide whether progress advances when an installment is billed, when a payment covers it (and in which order payments are allocated across purchases), or both.' };
  } finally { f.native.close(); }
});

test.failing('acceptance: once every installment is paid (debt 0) the card can be closed', async () => {
  const { f } = await payInstallmentByInstallment();
  try {
    expect(await closeResult(f)).toEqual({ closed: true, status: 'closed' });
  } finally { f.native.close(); }
});

test.failing('acceptance: a fully paid six-installment plan no longer reports pending installments', async () => {
  const { f } = await payInstallmentByInstallment();
  try {
    const [plan] = await f.installments();
    expect(plan?.status !== 'active' || plan.paidInstallments === plan.installmentCount).toBe(true);
  } finally { f.native.close(); }
});
