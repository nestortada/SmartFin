// Frozen copy of src/modules/dashboard/useCases/getDashboardSummary.ts at 6113758 (6B.1), before 6B.2.
// Used only as the before/after reference of the 6B.2 probes (Node and the synthetic APK). Do not edit.
import { PRIMARY_CURRENCY } from '../../src/shared/types';
import {
  mockAccountRepository,
  type Account,
  type AccountRepository,
  type AccountType,
} from '../../src/modules/accounts';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import {
  mockTransactionRepository,
  type Transaction,
  type TransactionRepository,
} from '../../src/modules/transactions';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import type { DashboardSummary } from '../../src/modules/dashboard/types/DashboardSummary';
import type { TransactionAmount } from '../../src/modules/transactions/types/TransactionQuery';
import { bogotaCalendarDate, transactionDateKey } from '../../src/shared/utils/transactionDate';
import { createSqliteSharedExpenseRepository } from '../../src/modules/transactions/repositories/sqliteSharedExpenseRepository';
import { sumExactCopCents, toExactCopCents } from '../../src/shared/utils/exactCopCents';

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

function sumBalances(accounts: Account[], accountTypes: AccountType[]): number {
  return accounts
    .filter(account => isActiveAccount(account))
    .filter(account => accountTypes.includes(account.type))
    .reduce((total, account) => total + account.balance.amount, 0);
}

function sumDebts(accounts: Account[]): number {
  return accounts
    .filter(account => isActiveAccount(account))
    .filter(account => DEBT_ACCOUNT_TYPES.includes(account.type))
    .reduce((total, account) => total + (account.debtBalance?.amount ?? 0), 0);
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
): DashboardSummary {
  const availableBalance = sumBalances(accounts, AVAILABLE_BALANCE_ACCOUNT_TYPES);
  const totalDebt = sumDebts(accounts);
  const netWorth =
    sumBalances(accounts, NET_WORTH_ASSET_ACCOUNT_TYPES) - totalDebt;
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

  const summary = buildSummary(accounts, monthlyAmounts, recentTransactionCount, losses.netLoss);
  return { ...summary, netWorth: summary.netWorth + position.receivables - position.thirdPartyAdvances,
    monthlyForgivenessLosses: losses.losses, monthlyLossReversals: losses.reversals,
    monthlyLossRecoveries: losses.recoveries, monthlyRecoveryReversals: losses.recoveryReversals,
    monthlyNetLosses: losses.netLoss };
}

/** Frozen copy of src/shared/utils/formatCurrency.ts at 6113758 (6B.1). */
export function formatCurrency(value: number, currency: 'COP'): string {
  return new Intl.NumberFormat('es-CO', {
    currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    style: 'currency',
  }).format(value);
}
