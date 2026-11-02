// Phase 0 · 4.6 Amounts accepted by the AI assistant executor. Synthetic in-memory SQLite only.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
jest.mock('react-native-config', () => ({}));
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from '../helpers/financialIntegrityFixture';
import { executeAiCommandPlan } from '../../src/modules/transactions/useCases/executeAiCommandPlan';
import { toExactCopCents } from '../../src/shared/utils/exactCopCents';
import type { AiCommandPlan } from '../../src/modules/transactions/types';
import { phase0Evidence } from './phase0Evidence';

const evidence = phase0Evidence('aiAmountValidation');
beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] }); jest.setSystemTime(FINANCIAL_TEST_DATE); });
afterEach(() => jest.useRealTimers());

type Outcome = { error?: string; amounts: number[]; bank: number; monthlyInstallments: number[] };

/** Executes one confirmed AI action (the last gate before SQLite) in a fresh synthetic database. */
async function execute(entity: 'transaction' | 'subscription', fields: Record<string, unknown>): Promise<Outcome> {
  const f = await financialIntegrityFixture({ managed: true });
  try {
    const plan = { version: 1, answeredFields: [], summary: 'IA sintética',
      actions: [{ id: 'action', entity, operation: 'create', fields }] } as unknown as AiCommandPlan;
    let error: string | undefined;
    try { await executeAiCommandPlan(f.database, 'draft', plan); } catch (caught) { error = (caught as Error).message; }
    const table = entity === 'transaction' ? "transactions WHERE type = 'expense'" : 'recurring_subscriptions';
    return {
      error,
      amounts: f.query(`SELECT amount FROM ${table} ORDER BY amount;`).rows.raw().map(row => row.amount as number),
      bank: f.query("SELECT balance_amount FROM accounts WHERE id = 'bank';").rows.item(0)?.balance_amount as number,
      monthlyInstallments: f.query('SELECT monthly_amount FROM installment_purchases;').rows.raw().map(row => row.monthly_amount as number),
    };
  } finally { f.native.close(); }
}
const expense = (amount: number, extra: Record<string, unknown> = {}) =>
  execute('transaction', { accountId: 'bank', amount, description: 'Gasto IA', transactionType: 'expense', date: '2026-10-11', ...extra });

test('rejected before any write: zero, negatives, NaN and infinities', async () => {
  const rows: Record<string, Outcome> = {};
  for (const amount of [0, -5, -0.4, NaN, Infinity, -Infinity]) rows[String(amount)] = await expense(amount);
  for (const outcome of Object.values(rows)) expect(outcome).toMatchObject({ amounts: [], bank: 1000000 });
  expect(rows['0']!.error).toBe('Monto invÃ¡lido.'); // 6B-O1 mojibake is still visible.
  expect(rows.NaN!.error).toBe('El contenido incluye un número no finito.');
  expect(rows.Infinity!.error).toBe(rows.NaN!.error);
  evidence.rejected = { status: 'discarded', observed: rows };
});

test('valid two-decimal amounts, including positive values below 0,50, are stored exactly', async () => {
  const rows: Record<string, Outcome> = {};
  for (const amount of [0.3, 0.49, 0.01, 1234.56]) rows[String(amount)] = await expense(amount);
  expect(Object.values(rows).map(row => [row.amounts, row.bank])).toEqual([
    [[0.3], 999999.7], [[0.49], 999999.51], [[0.01], 999999.99], [[1234.56], 998765.44]]);
  evidence.validCents = { status: 'discarded', observed: rows };
});

test('characterization: amounts with more than two decimals, even 0,00 at cents, are accepted and persisted', async () => {
  const rows: Record<string, Outcome> = {};
  for (const amount of [0.004, 0.005, 10.005, 1e-7]) rows[String(amount)] = await expense(amount);
  expect(Object.values(rows).map(row => [row.error, row.amounts, row.bank])).toEqual([
    [undefined, [0.004], 999999.996], [undefined, [0.005], 999999.995],
    [undefined, [10.005], 999989.995], [undefined, [1e-7], 999999.9999999]]);
  // Neither the movement nor the resulting balance belongs to the two-decimal contract any more.
  expect(Object.values(rows).every(row => toExactCopCents(row.amounts[0]!) === undefined && toExactCopCents(row.bank) === undefined)).toBe(true);
  evidence.moreThanTwoDecimals = { status: 'confirmed', observed: rows,
    note: 'requiredNumber only checks finiteness (executeAiCommandPlan.ts); saveManualTransaction only checks > 0. Not stored as 0, but outside the contract: input of 6B-D5 and source of binary drift.' };
});

test('characterization: a positive credit purchase in installments is registered with installments of 0', async () => {
  const card = (amount: number, installmentCount: number) =>
    execute('transaction', { accountId: 'card', amount, description: 'Compra IA', transactionType: 'expense', date: '2026-10-11', installmentCount });
  const rows = { '0.40 x 2': await card(0.4, 2), '1.20 x 3': await card(1.2, 3), '2 x 3': await card(2, 3) };
  expect(Object.values(rows).map(row => [row.amounts, row.monthlyInstallments])).toEqual([[[0.4], [0]], [[1.2], [0]], [[2], [1]]]);
  evidence.zeroInstallments = { status: 'confirmed', observed: rows,
    note: 'The only flow found where a positive amount ends up as 0: the monthly installment (Math.round(total / n)); same code as the manual form (4.3).' };
});

test('subscriptions: 0,004 is rejected but 0,005 is rounded up to 0,01 when stored', async () => {
  const subscription = (amount: number) =>
    execute('subscription', { name: 'Servicio', amount, accountId: 'bank', anchorDate: '2026-10-15', periodicity: 'monthly', remindersEnabled: false });
  const rows = { '0.004': await subscription(0.004), '0.005': await subscription(0.005), '0.3': await subscription(0.3) };
  expect(Object.values(rows).map(row => [row.error, row.amounts])).toEqual([
    ['Falta un importe válido de suscripción.', []], [undefined, [0.01]], [undefined, [0.3]]]);
  evidence.subscriptions = { status: 'ambiguous', observed: rows,
    note: 'roundSubscriptionMoney rounds instead of rejecting a third decimal: half a cent becomes one cent. Needs the same rule as movements.' };
});

test.failing.each([0.004, 0.005, 10.005, 1e-7])('acceptance: %p never persists outside the two-decimal contract', async amount => {
  const outcome = await expense(amount);
  if (outcome.error === undefined) {
    expect(outcome.amounts.every(value => value > 0 && toExactCopCents(value) !== undefined)).toBe(true);
    expect(toExactCopCents(outcome.bank)).toBeDefined();
  }
  expect(outcome.amounts.length + (outcome.error ? 1 : 0)).toBe(1);
});

test.failing('acceptance: a positive installment purchase never bills an installment of 0', async () => {
  const outcome = await execute('transaction', { accountId: 'card', amount: 0.4, description: 'Compra IA', transactionType: 'expense', date: '2026-10-11', installmentCount: 2 });
  expect(outcome.error !== undefined || outcome.monthlyInstallments.every(value => value > 0)).toBe(true);
});
