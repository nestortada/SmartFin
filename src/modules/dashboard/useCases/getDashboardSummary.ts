import { PRIMARY_CURRENCY } from '../../../shared/types';
import {
  mockAccountRepository,
  type Account,
  type AccountRepository,
  type AccountType,
} from '../../accounts';
import { createSqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import {
  mockTransactionRepository,
  type Transaction,
  type TransactionRepository,
} from '../../transactions';
import { createSqliteTransactionRepository } from '../../transactions/repositories/sqliteTransactionRepository';
import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import type { DashboardSummary } from '../types/DashboardSummary';
import type { TransactionAmount } from '../../transactions/types/TransactionQuery';
import { bogotaCalendarDate, transactionDateKey } from '../../../shared/utils/transactionDate';
import { createSqliteSharedExpenseRepository } from '../../transactions/repositories/sqliteSharedExpenseRepository';
import type { SharedFinancialTotals } from '../../transactions/useCases/readSharedFinancialTotals';
import {
  addSafeCents,
  copAggregate,
  sumExactCopCents,
  toExactCopCents,
} from '../../../shared/utils/exactCopCents';

type DashboardSummaryDependencies = {
  accountRepository?: AccountRepository;
  transactionRepository?: TransactionRepository;
  currentDate?: Date;
};

const AVAILABLE_BALANCE_ACCOUNT_TYPES: AccountType[] = [
  'cash',
  'bankAccount',
  'savingsAccount',
];

const NET_WORTH_ASSET_ACCOUNT_TYPES: AccountType[] = [
  'cash',
  'bankAccount',
  'savingsAccount',
  'investment',
];

const DEBT_ACCOUNT_TYPES: AccountType[] = ['creditCard', 'loan'];

function isActiveAccount(account: Account): boolean {
  return account.status === 'active';
}

/** A sum of amounts: exact cents when every amount is canonical (else undefined) and the previous binary sum. */
type CopSum = { cents: number | undefined; binary: number };

function sumCop(amounts: number[]): CopSum {
  return {
    cents: sumExactCopCents(amounts),
    binary: amounts.reduce((total, amount) => total + amount, 0),
  };
}

function sumBalances(accounts: Account[], accountTypes: AccountType[]): CopSum {
  return sumCop(
    accounts
      .filter(account => isActiveAccount(account))
      .filter(account => accountTypes.includes(account.type))
      .map(account => account.balance.amount),
  );
}

function sumDebts(accounts: Account[]): CopSum {
  return sumCop(
    accounts
      .filter(account => isActiveAccount(account))
      .filter(account => DEBT_ACCOUNT_TYPES.includes(account.type))
      .map(account => account.debtBalance?.amount ?? 0),
  );
}

/**
 * Phase 6B.2: available balance, total debt and net worth (assets − debt + receivables − advances)
 * accumulate exact cents and convert once. Each figure independently keeps its previous binary
 * value, with the same operations and order, when an operand is not a two-decimal COP amount below
 * 2^46 or a partial or final total is not a safe integer. Individual balances are never rounded.
 */
function sumBalanceFigures(
  accounts: Account[],
  position?: SharedFinancialTotals,
): Pick<DashboardSummary, 'availableBalance' | 'totalDebt' | 'netWorth'> {
  const available = sumBalances(accounts, AVAILABLE_BALANCE_ACCOUNT_TYPES);
  const assets = sumBalances(accounts, NET_WORTH_ASSET_ACCOUNT_TYPES);
  const debt = sumDebts(accounts);
  let netWorthCents = addSafeCents(assets.cents, debt.cents === undefined ? undefined : -debt.cents);
  let netWorthBinary = assets.binary - debt.binary;
  if (position) {
    const receivableCents = toExactCopCents(position.receivables);
    const advanceCents = toExactCopCents(position.thirdPartyAdvances);
    netWorthCents = addSafeCents(
      addSafeCents(netWorthCents, receivableCents),
      advanceCents === undefined ? undefined : -advanceCents,
    );
    netWorthBinary = netWorthBinary + position.receivables - position.thirdPartyAdvances;
  }

  return {
    availableBalance: copAggregate(available.cents, available.binary, 'dashboard.availableBalance').amount,
    totalDebt: copAggregate(debt.cents, debt.binary, 'dashboard.totalDebt').amount,
    netWorth: copAggregate(netWorthCents, netWorthBinary, 'dashboard.netWorth').amount,
  };
}

function toYearMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${year}-${month}`;
}

function toLocalDatePrefix(date: Date): string {
  return `${toYearMonth(date)}-${String(date.getDate()).padStart(2, '0')}`;
}

function isCurrentMonthTransaction(
  transaction: Transaction,
  currentDate: Date,
): boolean {
  return transactionDateKey(transaction).slice(0, 7) === toYearMonth(currentDate);
}

function isPosted(transaction: Transaction): boolean {
  return transaction.status === 'posted';
}

function isRealExpense(transaction: TransactionAmount): boolean {
  return transaction.type === 'expense' && transaction.direction === 'outflow';
}

function isIncome(transaction: TransactionAmount): boolean {
  return transaction.type === 'income' && transaction.direction === 'inflow';
}

function getLocalDayTime(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function getTransactionLocalDayTime(transaction: Pick<Transaction, 'date' | 'civilDate'>): number {
  return new Date(`${transactionDateKey(transaction)}T00:00:00`).getTime();
}

function isRecentTransaction(
  transaction: Pick<Transaction, 'date'>,
  currentDate: Date,
): boolean {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const currentDayTime = getLocalDayTime(currentDate);
  const transactionDayTime = getTransactionLocalDayTime(transaction);
  const oldestRecentDayTime = currentDayTime - 30 * millisecondsPerDay;

  return (
    transactionDayTime >= oldestRecentDayTime &&
    transactionDayTime <= currentDayTime
  );
}

function computeSummary(
  accounts: Account[],
  transactions: Transaction[],
  currentDate: Date,
): DashboardSummary {
  currentDate = bogotaCalendarDate(currentDate);
  const monthlyTransactions = transactions
    .filter(isPosted)
    .filter(transaction => isCurrentMonthTransaction(transaction, currentDate));

  const recentTransactionCount = transactions
    .filter(isPosted)
    .filter(transaction => isRecentTransaction(transaction, currentDate)).length;

  return buildSummary(accounts, monthlyTransactions, recentTransactionCount);
}

/**
 * Phase 6A: income, expenses and savings add exact cents when every amount is a
 * two-decimal COP value (see exactCopCents). Otherwise each figure keeps the previous
 * binary accumulation, in the same order, so no stored amount is rounded.
 */
function sumMonthlyFigures(
  monthlyTransactions: TransactionAmount[],
  monthlyNetLoss: number,
): Pick<DashboardSummary, 'monthlyIncome' | 'monthlyExpenses' | 'monthlySavings'> {
  const incomeAmounts = monthlyTransactions.filter(isIncome).map(transaction => transaction.amount);
  const expenseAmounts = monthlyTransactions.filter(isRealExpense).map(transaction => transaction.amount);
  const binaryIncome = incomeAmounts.reduce((total, amount) => total + amount, 0);
  const binaryExpenses = expenseAmounts.reduce((total, amount) => total + amount, 0);
  const incomeCents = sumExactCopCents(incomeAmounts);
  const expenseCents = sumExactCopCents(expenseAmounts);
  const netLossCents = toExactCopCents(monthlyNetLoss);
  const savingsCents =
    incomeCents === undefined || expenseCents === undefined || netLossCents === undefined
      ? undefined
      : incomeCents - expenseCents - netLossCents;

  return {
    monthlyIncome: incomeCents === undefined ? binaryIncome : incomeCents / 100,
    monthlyExpenses: expenseCents === undefined ? binaryExpenses : expenseCents / 100,
    monthlySavings:
      savingsCents !== undefined && Number.isSafeInteger(savingsCents)
        ? savingsCents / 100
        : binaryIncome - binaryExpenses - monthlyNetLoss,
  };
}

function buildSummary(
  accounts: Account[],
  monthlyTransactions: TransactionAmount[],
  recentTransactionCount: number,
  monthlyNetLoss = 0,
  position?: SharedFinancialTotals,
): DashboardSummary {
  const { availableBalance, totalDebt, netWorth } = sumBalanceFigures(accounts, position);
  const { monthlyIncome, monthlyExpenses, monthlySavings } = sumMonthlyFigures(
    monthlyTransactions,
    monthlyNetLoss,
  );

  return {
    currency: PRIMARY_CURRENCY,
    availableBalance,
    totalDebt,
    netWorth,
    monthlyIncome,
    monthlyExpenses,
    monthlySavings,
    monthlyForgivenessLosses: 0,
    monthlyLossReversals: 0,
    monthlyLossRecoveries: 0,
    monthlyRecoveryReversals: 0,
    monthlyNetLosses: 0,
    recentTransactionCount,
    modules: [
      {
        id: 'accounts',
        title: 'Cuentas',
        description: 'Efectivo, ahorro, tarjeta y préstamo en un solo lugar.',
      },
      {
        id: 'categories',
        title: 'Categorías',
        description: 'Clasificación local para ingresos, gastos y deudas.',
      },
      {
        id: 'transactions',
        title: 'Transacciones',
        description: 'Movimientos en COP registrados localmente.',
      },
      {
        id: 'debts',
        title: 'Deuda básica',
        description: 'Tarjeta y préstamo separados de los gastos comunes.',
      },
    ],
  };
}

export function getEmptyDashboardSummary(currentDate: Date = new Date()): DashboardSummary {
  return computeSummary([], [], currentDate);
}

/**
 * Synchronous version (uses mock repositories) — kept for backward
 * compatibility and as a fallback before the database is ready.
 */
export function getDashboardSummary({
  accountRepository = mockAccountRepository,
  currentDate = new Date(),
}: Omit<DashboardSummaryDependencies, 'transactionRepository'> = {}): DashboardSummary {
  const accounts = accountRepository.getAccounts();
  // getTransactions on the mock is sync — call it directly to avoid the union type
  const transactions = mockTransactionRepository.getTransactions(currentDate) as Transaction[];

  return computeSummary(accounts, transactions, currentDate);
}

/**
 * Async version — reads live data from SQLite.
 * Falls back gracefully to an empty state if the database returns no data.
 */
export async function getDashboardSummaryFromDb(
  database: SmartFinSQLiteDatabase,
  currentDate: Date = new Date(),
): Promise<DashboardSummary> {
  currentDate = bogotaCalendarDate(currentDate);
  const accountRepository = createSqliteAccountRepository(database);
  const transactionRepository = createSqliteTransactionRepository(database);

  const yearMonth = toYearMonth(currentDate);
  const nextMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    1,
  );
  const currentDayTime = getLocalDayTime(currentDate);
  const oldestRecentDay = new Date(currentDayTime - 30 * 24 * 60 * 60 * 1000);
  // JS normalizes dates such as February 30 into March. Read three extra days
  // before the window, then apply the original local-day predicate to each group.
  const firstCandidateDay = new Date(
    oldestRecentDay.getFullYear(),
    oldestRecentDay.getMonth(),
    oldestRecentDay.getDate() - 3,
  );
  const dayAfterToday = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate() + 1,
  );

  const sharedRepository = createSqliteSharedExpenseRepository(database);
  const [accounts, monthlyAmounts, recentDayCounts, position, losses] = await Promise.all([
    accountRepository.getAccounts(),
    transactionRepository.getTransactionAmounts({
      startDate: yearMonth,
      endDateExclusive: toYearMonth(nextMonth),
      datePrefix: yearMonth,
      status: 'posted',
      operations: [
        { type: 'income', direction: 'inflow' },
        { type: 'expense', direction: 'outflow' },
      ],
    }),
    transactionRepository.getTransactionCountsByDay({
      startDate: toLocalDatePrefix(firstCandidateDay),
      endDateExclusive: toLocalDatePrefix(dayAfterToday),
      status: 'posted',
    }),
    sharedRepository.getFinancialTotals(),
    sharedRepository.getLossPeriodTotals(`${yearMonth}-01`, `${toYearMonth(nextMonth)}-01`),
  ]);

  const recentTransactionCount = recentDayCounts
    .filter(day => isRecentTransaction(day, currentDate))
    .reduce((total, day) => total + day.count, 0);

  const summary = buildSummary(accounts, monthlyAmounts, recentTransactionCount, losses.netLoss, position);
  return { ...summary,
    monthlyForgivenessLosses: losses.losses, monthlyLossReversals: losses.reversals,
    monthlyLossRecoveries: losses.recoveries, monthlyRecoveryReversals: losses.recoveryReversals,
    monthlyNetLosses: losses.netLoss };
}
