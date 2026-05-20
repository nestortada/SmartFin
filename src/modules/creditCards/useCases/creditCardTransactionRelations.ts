import { PRIMARY_CURRENCY, type ISODateString } from '../../../shared/types';
import type { Account } from '../../accounts';
import type { SqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import type { Transaction } from '../../transactions';
import type { SqliteTransactionRepository } from '../../transactions/repositories/sqliteTransactionRepository';
import type { CreditCardRepository } from '../repositories';
import type { CreditCardStatement } from '../types';
import {
  parseCreditCardVisualMetadata,
  serializeCreditCardVisualMetadata,
} from './manageCreditCards';

export const UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID = 'account-credit-card-unclassified';
export const UNCLASSIFIED_CREDIT_CARD_ACCOUNT_NAME = 'Tarjeta por clasificar';

const DEFAULT_PAYMENT_DAY = 25;
const DEFAULT_MINIMUM_PAYMENT_RATIO = 0.1;

type AccountRepository = Pick<SqliteAccountRepository, 'getAccounts' | 'saveAccounts'>;
type TransactionRepository = Pick<SqliteTransactionRepository, 'getTransactions' | 'saveTransactions'>;

export type ResolveCreditCardTransactionTargetParams = {
  accountRepository: AccountRepository;
  accounts: Account[];
  creditCardHint?: string;
  isCreditTransaction: boolean;
  rawText?: string;
  selectedAccountId?: string;
};

export type ResolveCreditCardTransactionTargetResult = {
  accountId?: string;
  creditCardHint?: string;
  matchedAccount?: Account;
  missingCreditCard: boolean;
};

export type ReconcileCreditCardTransactionsParams = {
  accountRepository: AccountRepository;
  creditCardRepository: CreditCardRepository;
  currentDate?: Date;
  transactionRepository: TransactionRepository;
};

export type RegisterCreditCardPaymentParams = {
  accountId: string;
  accountRepository: AccountRepository;
  amount: number;
  creditCardRepository: CreditCardRepository;
  currentDate?: Date;
  sourceAccountId: string;
  transactionRepository: TransactionRepository;
};

export type RegisterCreditCardPaymentResult = {
  paidAmount: number;
  previousDebt: number;
  remainingDebt: number;
  transaction: Transaction;
};

function normalizeSearchText(value?: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactSearchText(value?: string): string {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function extractDigits(value?: string): string[] {
  return (value ?? '').match(/\d{4,}/g) ?? [];
}

function toDateOnly(date: Date): ISODateString {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function dateInMonth(referenceDate: Date, monthOffset: number, preferredDay: number): ISODateString {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth() + monthOffset;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.max(1, Math.min(preferredDay, lastDay));

  return toDateOnly(new Date(year, month, day));
}

function addDays(date: ISODateString, days: number): ISODateString {
  const nextDate = new Date(`${date.slice(0, 10)}T00:00:00`);
  nextDate.setDate(nextDate.getDate() + days);
  return toDateOnly(nextDate);
}

function toLocalDate(date: ISODateString): Date {
  return new Date(`${date.slice(0, 10)}T00:00:00`);
}

function getCurrentMonthRange(currentDate: Date): { end: ISODateString; key: string; start: ISODateString } {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  return {
    end: toDateOnly(new Date(year, month + 1, 0)),
    key: `${year}-${String(month + 1).padStart(2, '0')}`,
    start: toDateOnly(new Date(year, month, 1)),
  };
}

function getCurrentStatementRange(
  account: Account,
  currentDate: Date,
): { end: ISODateString; key: string; start: ISODateString } {
  const metadata = parseCreditCardVisualMetadata(account.description);

  if (!metadata.closingDay) {
    return getCurrentMonthRange(currentDate);
  }

  const thisMonthClosingDate = dateInMonth(currentDate, 0, metadata.closingDay);
  const today = toDateOnly(currentDate);
  const statementEndDate = thisMonthClosingDate >= today
    ? thisMonthClosingDate
    : dateInMonth(currentDate, 1, metadata.closingDay);
  const previousClosingDate = dateInMonth(toLocalDate(statementEndDate), -1, metadata.closingDay);
  const start = addDays(previousClosingDate, 1);
  const end = statementEndDate;

  return {
    end,
    key: `${start}-${end}`,
    start,
  };
}

function isPostedExpense(transaction: Transaction): boolean {
  return (
    transaction.status !== 'cancelled' &&
    transaction.direction === 'outflow' &&
    transaction.type === 'expense'
  );
}

function isPostedCreditCardPayment(transaction: Transaction, accountId: string): boolean {
  return (
    transaction.status !== 'cancelled' &&
    transaction.type === 'creditCardPayment' &&
    (transaction.targetAccountId === accountId || transaction.accountId === accountId)
  );
}

function isDateInRange(value: string, start: string, end: string): boolean {
  const date = value.slice(0, 10);
  return date >= start && date <= end;
}

function getPaymentDueDateForStatement(account: Account, statementEndDate: ISODateString): ISODateString {
  const metadata = parseCreditCardVisualMetadata(account.description);
  const paymentDay = metadata.paymentDay ?? DEFAULT_PAYMENT_DAY;
  const statementEnd = toLocalDate(statementEndDate);
  const sameMonthDueDate = dateInMonth(statementEnd, 0, paymentDay);

  return sameMonthDueDate > statementEndDate
    ? sameMonthDueDate
    : dateInMonth(statementEnd, 1, paymentDay);
}

function isRealCreditCardAccount(account: Account): boolean {
  return account.type === 'creditCard' && account.status === 'active';
}

function isPaymentSourceAccount(account: Account): boolean {
  return (
    account.status === 'active' &&
    ['cash', 'bankAccount', 'savingsAccount'].includes(account.type)
  );
}

function sumAmounts(transactions: Transaction[]): number {
  return transactions.reduce((total, transaction) => total + transaction.amount, 0);
}

function accountMatchesHint(account: Account, hint?: string, rawText?: string): boolean {
  const searchText = normalizeSearchText(`${hint ?? ''} ${rawText ?? ''}`);
  const compactText = compactSearchText(`${hint ?? ''} ${rawText ?? ''}`);
  const digits = extractDigits(`${hint ?? ''} ${rawText ?? ''}`);

  if (!searchText && digits.length === 0) {
    return false;
  }

  const metadata = parseCreditCardVisualMetadata(account.description);
  const candidates = [
    account.name,
    account.institutionName,
    metadata.lastFourDigits,
  ].filter(Boolean);

  return candidates.some(candidate => {
    const normalizedCandidate = normalizeSearchText(candidate);
    const compactCandidate = compactSearchText(candidate);

    if (metadata.lastFourDigits && digits.some(value => value.endsWith(metadata.lastFourDigits ?? ''))) {
      return true;
    }

    if (normalizedCandidate.length < 3) {
      return false;
    }

    return searchText.includes(normalizedCandidate) || compactText.includes(compactCandidate);
  });
}

export function shouldTreatTextAsCreditCardTransaction(rawText?: string): boolean {
  const normalized = normalizeSearchText(rawText);

  return /\b(tarjeta|credito[a-z0-9]*|credit[a-z0-9]*|visa|mastercard|amex|american express|tc|t c)\b/.test(normalized);
}

export function findMatchingCreditCardAccount(
  accounts: Account[],
  creditCardHint?: string,
  rawText?: string,
): Account | undefined {
  return accounts
    .filter(isRealCreditCardAccount)
    .find(account => accountMatchesHint(account, creditCardHint, rawText));
}

export async function ensureUnclassifiedCreditCardAccount(
  accountRepository: AccountRepository,
  accounts?: Account[],
): Promise<Account> {
  const currentAccounts = accounts ?? await accountRepository.getAccounts();
  const existing = currentAccounts.find(account => account.id === UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID);

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const account: Account = {
    id: UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID,
    balance: {
      amount: 0,
      currency: PRIMARY_CURRENCY,
    },
    createdAt: now,
    currency: PRIMARY_CURRENCY,
    description: serializeCreditCardVisualMetadata({}),
    institutionName: 'Pendiente',
    name: UNCLASSIFIED_CREDIT_CARD_ACCOUNT_NAME,
    status: 'active',
    type: 'bankAccount',
    updatedAt: now,
  };

  await accountRepository.saveAccounts([account]);
  return account;
}

export async function resolveCreditCardTransactionTarget({
  accountRepository,
  accounts,
  creditCardHint,
  isCreditTransaction,
  rawText,
  selectedAccountId,
}: ResolveCreditCardTransactionTargetParams): Promise<ResolveCreditCardTransactionTargetResult> {
  if (!isCreditTransaction) {
    return {
      accountId: selectedAccountId,
      missingCreditCard: false,
    };
  }

  const selectedAccount = accounts.find(account => account.id === selectedAccountId);
  if (selectedAccount && isRealCreditCardAccount(selectedAccount)) {
    return {
      accountId: selectedAccount.id,
      creditCardHint: creditCardHint || selectedAccount.name,
      matchedAccount: selectedAccount,
      missingCreditCard: false,
    };
  }

  const matchedAccount = findMatchingCreditCardAccount(accounts, creditCardHint, rawText);
  if (matchedAccount) {
    return {
      accountId: matchedAccount.id,
      creditCardHint: creditCardHint || matchedAccount.name,
      matchedAccount,
      missingCreditCard: false,
    };
  }

  const unclassifiedAccount = await ensureUnclassifiedCreditCardAccount(accountRepository, accounts);

  return {
    accountId: unclassifiedAccount.id,
    creditCardHint: creditCardHint || rawText,
    missingCreditCard: true,
  };
}

export async function reconcileCreditCardTransactions({
  accountRepository,
  creditCardRepository,
  currentDate = new Date(),
  transactionRepository,
}: ReconcileCreditCardTransactionsParams): Promise<void> {
  const [accounts, transactions] = await Promise.all([
    accountRepository.getAccounts(),
    transactionRepository.getTransactions(),
  ]);
  const creditCards = accounts.filter(isRealCreditCardAccount);
  const installments = await creditCardRepository.getInstallmentPurchases(
    creditCards.map(account => account.id),
  );
  const installmentByTransactionId = new Map(
    installments.map(installment => [installment.transactionId, installment]),
  );
  const now = new Date().toISOString();
  const accountUpdates: Account[] = [];
  const statements: CreditCardStatement[] = [];

  for (const card of creditCards) {
    const statementRange = getCurrentStatementRange(card, currentDate);
    const cardTransactions = transactions.filter(
      transaction => transaction.accountId === card.id && isPostedExpense(transaction),
    );
    const paymentTransactions = transactions.filter(transaction =>
      isPostedCreditCardPayment(transaction, card.id),
    );
    const totalCreditUsage = sumAmounts(cardTransactions);
    const totalPayments = sumAmounts(paymentTransactions);
    const debtBalance = Math.max(0, totalCreditUsage - totalPayments);
    const statementPayments = paymentTransactions
      .filter(transaction => isDateInRange(transaction.date, statementRange.start, statementRange.end));
    const statementCharges = cardTransactions
      .filter(transaction => isDateInRange(transaction.date, statementRange.start, statementRange.end))
      .reduce((total, transaction) => {
        const installment = installmentByTransactionId.get(transaction.id);
        return total + (installment && installment.installmentCount > 1 && installment.status === 'active'
          ? installment.monthlyAmount
          : transaction.amount);
      }, 0);
    const statementTotal = Math.max(
      0,
      statementCharges - sumAmounts(statementPayments),
    );
    const statementStatus = statementCharges > 0
      ? statementTotal > 0 ? 'pending' : 'paid'
      : 'open';

    accountUpdates.push({
      ...card,
      debtBalance: {
        amount: debtBalance,
        currency: card.currency,
      },
      updatedAt: now,
    });

    statements.push({
      id: `statement-auto-${card.id}-${statementRange.key}`,
      accountId: card.id,
      createdAt: now,
      currency: card.currency,
      minimumPaymentAmount: Math.round(statementTotal * DEFAULT_MINIMUM_PAYMENT_RATIO),
      paymentDueDate: getPaymentDueDateForStatement(card, statementRange.end),
      statementEndDate: statementRange.end,
      statementStartDate: statementRange.start,
      status: statementStatus,
      totalAmount: statementTotal,
      updatedAt: now,
    });
  }

  if (accountUpdates.length > 0) {
    await accountRepository.saveAccounts(accountUpdates);
  }

  if (statements.length > 0) {
    await creditCardRepository.saveStatements(statements);
  }
}

export async function associatePendingTransactionsForCreditCard({
  account,
  accountRepository,
  creditCardRepository,
  transactionRepository,
}: {
  account: Account;
  accountRepository: AccountRepository;
  creditCardRepository: CreditCardRepository;
  transactionRepository: TransactionRepository;
}): Promise<number> {
  const transactions = await transactionRepository.getTransactions();
  const now = new Date().toISOString();
  const pendingTransactions = transactions.filter(
    transaction =>
      transaction.accountId === UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID &&
      transaction.paymentMethod === 'credit' &&
      accountMatchesHint(account, transaction.creditCardHint, transaction.notes),
  );

  if (pendingTransactions.length === 0) {
    return 0;
  }

  await transactionRepository.saveTransactions(
    pendingTransactions.map(transaction => ({
      ...transaction,
      accountId: account.id,
      creditCardHint: transaction.creditCardHint || account.name,
      updatedAt: now,
    })),
  );
  await creditCardRepository.updateInstallmentPurchasesAccount(
    pendingTransactions.map(transaction => transaction.id),
    account.id,
  );

  await reconcileCreditCardTransactions({
    accountRepository,
    creditCardRepository,
    transactionRepository,
  });

  return pendingTransactions.length;
}

export async function registerCreditCardPayment({
  accountId,
  accountRepository,
  amount,
  creditCardRepository,
  currentDate = new Date(),
  sourceAccountId,
  transactionRepository,
}: RegisterCreditCardPaymentParams): Promise<RegisterCreditCardPaymentResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Ingresa un monto valido para el pago de la tarjeta.');
  }

  await reconcileCreditCardTransactions({
    accountRepository,
    creditCardRepository,
    currentDate,
    transactionRepository,
  });

  const accounts = await accountRepository.getAccounts();
  const card = accounts.find(account => account.id === accountId && isRealCreditCardAccount(account));
  const sourceAccount = accounts.find(account => account.id === sourceAccountId && isPaymentSourceAccount(account));

  if (!card) {
    throw new Error('Selecciona una tarjeta de credito activa.');
  }

  if (!sourceAccount) {
    throw new Error('Selecciona una cuenta origen activa para registrar el pago.');
  }

  const previousDebt = Math.max(card.debtBalance?.amount ?? 0, 0);
  if (previousDebt <= 0) {
    throw new Error('La tarjeta no tiene saldo pendiente por pagar.');
  }

  const paidAmount = Math.min(Math.round(amount), previousDebt);
  if (sourceAccount.balance.amount < paidAmount) {
    throw new Error('La cuenta origen no tiene saldo suficiente para ese pago.');
  }

  const now = currentDate.toISOString();
  const transaction: Transaction = {
    id: `tx-credit-card-payment-${card.id}-${Date.now()}`,
    accountId: sourceAccount.id,
    amount: paidAmount,
    createdAt: now,
    currency: card.currency,
    date: now,
    description: `Pago de tarjeta de credito - ${card.name}`,
    direction: 'outflow',
    merchantName: card.name,
    notes: 'Pago de tarjeta de credito. No cuenta como gasto del mes.',
    paymentMethod: 'debit',
    status: 'posted',
    targetAccountId: card.id,
    type: 'creditCardPayment',
    updatedAt: now,
  };

  await accountRepository.saveAccounts([
    {
      ...sourceAccount,
      balance: {
        ...sourceAccount.balance,
        amount: sourceAccount.balance.amount - paidAmount,
      },
      updatedAt: now,
    },
  ]);
  await transactionRepository.saveTransactions([transaction]);
  await reconcileCreditCardTransactions({
    accountRepository,
    creditCardRepository,
    currentDate,
    transactionRepository,
  });

  return {
    paidAmount,
    previousDebt,
    remainingDebt: Math.max(previousDebt - paidAmount, 0),
    transaction,
  };
}
