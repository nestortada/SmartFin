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

function isCurrentMonthTransaction(
  transaction: Transaction,
  currentDate: Date,
): boolean {
  return transaction.date.slice(0, 7) === toYearMonth(currentDate);
}

function isPosted(transaction: Transaction): boolean {
  return transaction.status === 'posted';
}

function isRealExpense(transaction: Transaction): boolean {
  return transaction.type === 'expense' && transaction.direction === 'outflow';
}

function isIncome(transaction: Transaction): boolean {
  return transaction.type === 'income' && transaction.direction === 'inflow';
}

function getLocalDayTime(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function getTransactionLocalDayTime(transaction: Transaction): number {
  return new Date(`${transaction.date.slice(0, 10)}T00:00:00`).getTime();
}

function isRecentTransaction(
  transaction: Transaction,
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
  const recentTransactionCount = transactions
    .filter(isPosted)
    .filter(transaction => isRecentTransaction(transaction, currentDate)).length;

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
        description: 'Movimientos COP de ejemplo sin conexión bancaria.',
      },
      {
        id: 'debts',
        title: 'Deuda básica',
        description: 'Tarjeta y préstamo separados de los gastos comunes.',
      },
    ],
  };
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

  const [accounts, transactions] = await Promise.all([
    accountRepository.getAccounts(),
    Promise.resolve(transactionRepository.getTransactions()),
  ]);

  return computeSummary(accounts, transactions, currentDate);
}
