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
  return transaction.date.slice(0, 7) === toYearMonth(currentDate);
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

function getTransactionLocalDayTime(transaction: Pick<Transaction, 'date'>): number {
  return new Date(`${transaction.date.slice(0, 10)}T00:00:00`).getTime();
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
  const monthlyTransactions = transactions
    .filter(isPosted)
    .filter(transaction => isCurrentMonthTransaction(transaction, currentDate));

  const recentTransactionCount = transactions
    .filter(isPosted)
    .filter(transaction => isRecentTransaction(transaction, currentDate)).length;

  return buildSummary(accounts, monthlyTransactions, recentTransactionCount);
}

function buildSummary(
  accounts: Account[],
  monthlyTransactions: TransactionAmount[],
  recentTransactionCount: number,
): DashboardSummary {
  const availableBalance = sumBalances(accounts, AVAILABLE_BALANCE_ACCOUNT_TYPES);
  const totalDebt = sumDebts(accounts);
  const netWorth =
    sumBalances(accounts, NET_WORTH_ASSET_ACCOUNT_TYPES) - totalDebt;
  const monthlyIncome = monthlyTransactions
    .filter(isIncome)
    .reduce((total, transaction) => total + transaction.amount, 0);
  const monthlyExpenses = monthlyTransactions
    .filter(isRealExpense)
    .reduce((total, transaction) => total + transaction.amount, 0);
  const monthlySavings = monthlyIncome - monthlyExpenses;

  return {
    currency: PRIMARY_CURRENCY,
    availableBalance,
    totalDebt,
    netWorth,
    monthlyIncome,
    monthlyExpenses,
    monthlySavings,
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

  const [accounts, monthlyAmounts, recentDayCounts] = await Promise.all([
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
  ]);

  const recentTransactionCount = recentDayCounts
    .filter(day => isRecentTransaction(day, currentDate))
    .reduce((total, day) => total + day.count, 0);

  return buildSummary(accounts, monthlyAmounts, recentTransactionCount);
}
