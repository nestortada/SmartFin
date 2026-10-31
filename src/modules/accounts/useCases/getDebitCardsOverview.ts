import type { Account } from '../types';
import type { SqliteAccountRepository } from '../repositories/sqliteAccountRepository';
import type { SqliteTransactionRepository } from '../../transactions/repositories/sqliteTransactionRepository';
import type { Transaction } from '../../transactions';
import { bogotaCalendarDate, transactionDateKey, transactionSortValue } from '../../../shared/utils/transactionDate';
import type { SharedExpenseState } from '../../transactions/types/SharedExpense';
import { repositorySQLiteDatabase } from '../../../database/sqliteRepositoryScope';
import { createSqliteSharedExpenseRepository } from '../../transactions/repositories/sqliteSharedExpenseRepository';
import { sumCopAmounts } from '../../../shared/utils/exactCopCents';
import {
  parseDebitCardMetadata,
  type DebitCardRecurringIncome,
} from './manageDebitCards';

export type DebitCardMovementKind =
  | 'income'
  | 'payment'
  | 'topUp'
  | 'transferOut'
  | 'other';
// Third-party funds are bank inflows/outflows, not personal income/consumption.
type ThirdPartyMovementKind = 'reimbursement' | 'thirdPartyReturn';

export type DebitCardMovement = {
  amount: number;
  kind: DebitCardMovementKind | ThirdPartyMovementKind;
  signedAmount: number;
  transaction: Transaction;
};

export type DebitCardMonthlyMetrics = {
  income: number;
  netFlow: number;
  payments: number;
  topUps: number;
  transfersOut: number;
  reimbursementsReceived?: number;
  thirdPartyReturns?: number;
};

export type DebitCardWeeklyTrendPoint = {
  date: string;
  label: string;
  netAmount: number;
};

export type DebitCardSummary = {
  account: Account;
  maskedNumber: string;
  monthlyMetrics: DebitCardMonthlyMetrics;
  movements: DebitCardMovement[];
  recurringIncome?: DebitCardRecurringIncome;
  weeklyTrend: DebitCardWeeklyTrendPoint[];
};

export type DebitCardsOverview = {
  cards: DebitCardSummary[];
  generatedAt: string;
  totalAvailable: number;
};

type DebitCardsOverviewRepositories = {
  accountRepository: Pick<SqliteAccountRepository, 'getAccounts'>;
  transactionRepository: Pick<SqliteTransactionRepository, 'getTransactions'>;
};

const DEBIT_CARD_ACCOUNT_TYPES: Account['type'][] = ['bankAccount', 'savingsAccount'];
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];

function isDebitCardAccount(account: Account): boolean {
  return account.status === 'active' && DEBIT_CARD_ACCOUNT_TYPES.includes(account.type);
}

function isPosted(transaction: Transaction): boolean {
  return transaction.status === 'posted';
}

function toYearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function toLocalDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function getCardTransactions(accountId: string, transactions: Transaction[]): Transaction[] {
  return transactions
    .filter(transaction =>
      transaction.type === 'internalTransfer'
        ? transaction.accountId === accountId
        : transaction.accountId === accountId || transaction.targetAccountId === accountId,
    )
    .sort((left, right) => {
      const dateComparison = transactionSortValue(right) - transactionSortValue(left);
      if (dateComparison !== 0) {
        return dateComparison;
      }

      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
}

function classifyMovement(accountId: string, transaction: Transaction, shared?: SharedExpenseState): DebitCardMovement {
  if (shared?.receipts.some(r => r.status === 'active' && r.transactionId === transaction.id))
    return { amount: transaction.amount, kind: 'reimbursement', signedAmount: transaction.amount, transaction };
  if (shared?.returns.some(r => r.status === 'active' && r.transactionId === transaction.id))
    return { amount: transaction.amount, kind: 'thirdPartyReturn', signedAmount: -transaction.amount, transaction };
  if (transaction.type === 'internalTransfer' && transaction.direction === 'inflow') {
    return {
      amount: transaction.amount,
      kind: 'topUp',
      signedAmount: transaction.amount,
      transaction,
    };
  }

  if (transaction.type === 'internalTransfer' && transaction.direction === 'outflow') {
    return {
      amount: transaction.amount,
      kind: 'transferOut',
      signedAmount: -transaction.amount,
      transaction,
    };
  }

  if (transaction.direction === 'inflow' || transaction.type === 'income') {
    return {
      amount: transaction.amount,
      kind: 'income',
      signedAmount: transaction.amount,
      transaction,
    };
  }

  if (
    transaction.paymentMethod === 'debit' &&
    transaction.direction === 'outflow' &&
    transaction.accountId === accountId
  ) {
    return {
      amount: transaction.amount,
      kind: 'payment',
      signedAmount: -transaction.amount,
      transaction,
    };
  }

  return {
    amount: transaction.amount,
    kind: 'other',
    signedAmount: transaction.accountId === accountId ? -transaction.amount : transaction.amount,
    transaction,
  };
}

function buildMonthlyMetrics(
  movements: DebitCardMovement[],
  currentDate: Date,
): DebitCardMonthlyMetrics {
  const currentMonth = toYearMonth(currentDate);
  const monthlyMovements = movements
    .filter(movement => isPosted(movement.transaction))
    .filter(movement => transactionDateKey(movement.transaction).slice(0, 7) === currentMonth);

  return monthlyMovements.reduce<DebitCardMonthlyMetrics>(
    (metrics, movement) => ({
      income: metrics.income + (movement.kind === 'income' ? movement.amount : 0),
      netFlow: metrics.netFlow + movement.signedAmount,
      payments: metrics.payments + (movement.kind === 'payment' ? movement.amount : 0),
      topUps: metrics.topUps + (movement.kind === 'topUp' ? movement.amount : 0),
      transfersOut: metrics.transfersOut + (movement.kind === 'transferOut' ? movement.amount : 0),
      ...(metrics.reimbursementsReceived !== undefined || movement.kind === 'reimbursement'
        ? { reimbursementsReceived: (metrics.reimbursementsReceived ?? 0) + (movement.kind === 'reimbursement' ? movement.amount : 0) } : {}),
      ...(metrics.thirdPartyReturns !== undefined || movement.kind === 'thirdPartyReturn'
        ? { thirdPartyReturns: (metrics.thirdPartyReturns ?? 0) + (movement.kind === 'thirdPartyReturn' ? movement.amount : 0) } : {}),
    }),
    {
      income: 0,
      netFlow: 0,
      payments: 0,
      topUps: 0,
      transfersOut: 0,
    },
  );
}

function buildWeeklyTrend(
  movements: DebitCardMovement[],
  currentDate: Date,
): DebitCardWeeklyTrendPoint[] {
  const currentDay = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate(),
  );

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(currentDay.getTime() - (6 - index) * DAY_IN_MS);
    const date = toLocalDateKey(day);
    const netAmount = movements
      .filter(movement => isPosted(movement.transaction))
      .filter(movement => transactionDateKey(movement.transaction) === date)
      .reduce((total, movement) => total + movement.signedAmount, 0);

    return {
      date,
      label: WEEKDAY_LABELS[day.getDay()] ?? date,
      netAmount,
    };
  });
}

function getMaskedNumber(account: Account, index: number): string {
  const numericSeed = account.id
    .split('')
    .reduce((total, character) => total + character.charCodeAt(0), 0);
  const suffix = String(1000 + ((numericSeed + index * 137) % 9000)).padStart(4, '0');

  return `**** ${suffix}`;
}

export function buildDebitCardsOverview(
  accounts: Account[],
  transactions: Transaction[],
  currentDate: Date = new Date(),
  shared?: SharedExpenseState,
): DebitCardsOverview {
  const debitAccounts = accounts.filter(isDebitCardAccount);
  const referenceDate = bogotaCalendarDate(currentDate);

  return {
    cards: debitAccounts.map((account, index) => {
      const movements = getCardTransactions(account.id, transactions)
        .map(transaction => classifyMovement(account.id, transaction, shared));
      const metadata = parseDebitCardMetadata(account);

      return {
        account,
        maskedNumber: getMaskedNumber(account, index),
        monthlyMetrics: buildMonthlyMetrics(movements, referenceDate),
        movements,
        recurringIncome: metadata.recurringIncome,
        weeklyTrend: buildWeeklyTrend(movements, referenceDate),
      };
    }),
    generatedAt: currentDate.toISOString(),
    // Exact cents as the dashboard (6B.2); out of contract, the previous binary sum.
    totalAvailable: sumCopAmounts(debitAccounts.map(account => account.balance.amount), 'debitCards.totalAvailable').amount,
  };
}

export async function getDebitCardsOverview({
  accountRepository,
  transactionRepository,
}: DebitCardsOverviewRepositories, currentDate: Date = new Date()): Promise<DebitCardsOverview> {
  const [accounts, transactions] = await Promise.all([
    accountRepository.getAccounts(),
    transactionRepository.getTransactions(),
  ]);

  const database = repositorySQLiteDatabase(transactionRepository);
  const shared = database ? await createSqliteSharedExpenseRepository(database).getState() : undefined;
  return buildDebitCardsOverview(accounts, transactions, currentDate, shared);
}
