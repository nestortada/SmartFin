import { financialIntegrityFixture } from '../helpers/financialIntegrityFixture';
import { serializeCreditCardVisualMetadata } from '../../src/modules/creditCards/useCases/manageCreditCards';
import { reconcileCreditCardTransactions, registerCreditCardPayment } from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';

/** One date per billing cycle of a card closing on day 20: 21 Sep–20 Oct 2026, 21 Oct–20 Nov, ... */
export const CYCLE_DATES = ['2026-10-11', '2026-11-11', '2026-12-11', '2027-01-11', '2027-02-11', '2027-03-11', '2027-04-11']
  .map(date => new Date(`${date}T17:00:00.000Z`));

/** Synthetic isolated SQLite (in memory): Banco 1.000.000, Visa closing on day 20 and paying on day 5. */
export async function creditCardFixture() {
  const f = await financialIntegrityFixture();
  f.native.prepare('UPDATE accounts SET description = ? WHERE id = ?;')
    .run(serializeCreditCardVisualMetadata({ closingDay: 20, paymentDay: 5 }), 'card');
  const at = (date: Date) => jest.setSystemTime(date);
  const purchase = async (amount: number, installments: number, date: Date, merchantName = 'Compra sintética') => {
    at(date);
    return f.save({
      accountId: 'card', operationType: 'Crédito', amount, merchantName,
      installmentCountInput: String(installments), currentDate: date, now: date,
    });
  };
  const reconcile = async (date: Date) => {
    at(date);
    await reconcileCreditCardTransactions({ ...f, currentDate: date });
  };
  const pay = async (amount: number, date: Date, settlement: 'partial' | 'fullDebt' = 'partial') => {
    at(date);
    return registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount, currentDate: date, settlement });
  };
  const statements = async () => (await f.creditCardRepository.getStatements(['card']))
    .map(({ statementStartDate, statementEndDate, totalAmount, status }) => ({ statementStartDate, statementEndDate, totalAmount, status }))
    .sort((a, b) => a.statementStartDate.localeCompare(b.statementStartDate));
  const card = async () => (await f.accountRepository.getAccounts()).find(account => account.id === 'card');
  const installments = async () => f.creditCardRepository.getInstallmentPurchases(['card']);
  const month = async (date: Date) => {
    const summary = await getDashboardSummaryFromDb(f.database, date);
    return { expense: summary.monthlyExpenses, wealth: summary.netWorth, debt: summary.totalDebt };
  };
  return { ...f, at, purchase, reconcile, pay, statements, card, installments, month };
}

export function installFixedClock() {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] }));
  afterEach(() => jest.useRealTimers());
}
