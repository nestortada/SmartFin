import { PRIMARY_CURRENCY, type ISODateString } from '../../../shared/types';
import type { Account } from '../../accounts';
import type { SqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import type { Transaction } from '../../transactions';
import { bogotaCalendarDate, transactionDateKey } from '../../../shared/utils/transactionDate';
import { addCopAmounts, differenceOfCopSums, toExactCopCents } from '../../../shared/utils/exactCopCents';
import type { SqliteTransactionRepository } from '../../transactions/repositories/sqliteTransactionRepository';
import { readCurrentManualTransaction } from '../../transactions/repositories/sqliteTransactionRepository';
import { isSQLiteParticipant } from '../../../database/managedSQLite';
import { repositorySQLiteDatabase } from '../../../database/sqliteRepositoryScope';
import { withCreditCardPaymentScope } from './creditCardPaymentScope';
import { readUnclassifiedCreditTransactions } from '../repositories/readUnclassifiedCreditTransactions';
import { readCreditCardReconciliationTransactions, type CreditCardReconciliationTransaction } from '../repositories/readCreditCardReconciliationTransactions';
import type { CreditCardRepository } from '../repositories';
import type { CreditCardStatement } from '../types';
import { statementChargesForCycle, type StatementCharge, type StatementPlanNotice } from './creditCardStatementCharges';
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

/**
 * 'partial' (default) keeps the phase 3B contract: whole pesos, at least $1 COP, limited by the debt.
 * 'fullDebt' (6B.3) is the explicit "Pagar deuda total": `amount` is the debt the user saw, which must
 * still be the exact current debt; it is paid exactly, with up to two decimals and also below $1.
 */
export type CreditCardPaymentSettlement = 'partial' | 'fullDebt';

export type RegisterCreditCardPaymentParams = {
  accountId: string;
  accountRepository: AccountRepository;
  amount: number;
  creditCardRepository: CreditCardRepository;
  currentDate?: Date;
  settlement?: CreditCardPaymentSettlement;
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

function isPostedExpense(transaction: CreditCardReconciliationTransaction): boolean {
  return (
    transaction.status !== 'cancelled' &&
    transaction.direction === 'outflow' &&
    transaction.type === 'expense'
  );
}

function isPostedCreditCardPayment(transaction: CreditCardReconciliationTransaction, accountId: string): boolean {
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

function amountsOf(items: readonly { amount: number }[]): number[] {
  return items.map(item => item.amount);
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

/**
 * 1a.2: why the statement of the evaluated cycle was or was not written. Statements are written only for
 * the cycle that contains the evaluation date, never when the card already has a statement for a later
 * cycle (that cycle is history), and never over a stored `closed` statement.
 */
export type CreditCardStatementWrite = 'written' | 'supersededByLaterCycle' | 'storedClosed';

export type CreditCardStatementReconciliation = {
  accountId: string;
  statementId: string;
  write: CreditCardStatementWrite;
  charges: StatementCharge[];
  notices: StatementPlanNotice[];
};

export type CreditCardReconciliationReport = { statements: CreditCardStatementReconciliation[] };

export async function reconcileCreditCardTransactions(
  params: ReconcileCreditCardTransactionsParams,
): Promise<CreditCardReconciliationReport> {
  const intention = { ...params, currentDate: new Date(params.currentDate?.getTime() ?? Date.now()) };
  return withCreditCardPaymentScope(intention, dependencies =>
    reconcileCreditCardTransactionsInScope({ ...intention, ...dependencies }));
}

function statementWrite(
  storedStatements: CreditCardStatement[],
  statementId: string,
  statementEndDate: ISODateString,
): CreditCardStatementWrite {
  if (storedStatements.some(statement => statement.statementEndDate.slice(0, 10) > statementEndDate)) {
    return 'supersededByLaterCycle';
  }
  return storedStatements.some(statement => statement.id === statementId && statement.status === 'closed')
    ? 'storedClosed' : 'written';
}

async function reconcileCreditCardTransactionsInScope({
  accountRepository,
  creditCardRepository,
  currentDate = new Date(),
  transactionRepository,
}: ReconcileCreditCardTransactionsParams): Promise<CreditCardReconciliationReport> {
  const accounts = await accountRepository.getAccounts();
  const creditCards = accounts.filter(isRealCreditCardAccount);
  const transactions = await readCreditCardReconciliationTransactions(
    transactionRepository, creditCards.map(account => account.id),
  );
  const installments = await creditCardRepository.getInstallmentPurchases(
    creditCards.map(account => account.id),
  );
  const installmentByTransactionId = new Map(
    installments.map(installment => [installment.transactionId, installment]),
  );
  const storedStatements = await creditCardRepository.getStatements(creditCards.map(account => account.id));
  const now = new Date().toISOString();
  const accountUpdates: Account[] = [];
  const statements: CreditCardStatement[] = [];
  const report: CreditCardReconciliationReport = { statements: [] };

  for (const card of creditCards) {
    const statementRange = getCurrentStatementRange(card, bogotaCalendarDate(currentDate));
    const cardTransactions = transactions.filter(
      transaction => transaction.accountId === card.id && isPostedExpense(transaction),
    );
    const paymentTransactions = transactions.filter(transaction =>
      isPostedCreditCardPayment(transaction, card.id),
    );
    // 6B.1: Σ purchases − Σ payments in exact cents when every amount has at most two decimals;
    // otherwise the previous binary sums in the same order. Derived from movements, never stored history.
    const debtBalance = Math.max(0, differenceOfCopSums(
      amountsOf(cardTransactions), amountsOf(paymentTransactions), 'creditCard.debt',
    ).amount);
    const statementPayments = paymentTransactions
      .filter(transaction => isDateInRange(transactionDateKey(transaction), statementRange.start, statementRange.end));
    // 1a.2: each installment plan contributes the installment of this cycle (exact cents, engine D1/D2),
    // so earlier purchases keep appearing; plans that cannot be scheduled keep the previous rule.
    const { charges, notices } = statementChargesForCycle({
      closingDay: parseCreditCardVisualMetadata(card.description).closingDay,
      cycleEnd: statementRange.end,
      cycleStart: statementRange.start,
      installmentsByTransactionId: installmentByTransactionId,
      purchases: cardTransactions,
    });
    const statementChargeAmounts = amountsOf(charges);
    const statementCharges = differenceOfCopSums(statementChargeAmounts, [], 'creditCard.statementCharges').amount;
    const statementTotal = Math.max(
      0,
      differenceOfCopSums(statementChargeAmounts, amountsOf(statementPayments), 'creditCard.statementTotal').amount,
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

    const statementId = `statement-auto-${card.id}-${statementRange.key}`;
    const cardStatements = storedStatements.filter(statement => statement.accountId === card.id);
    const write = statementWrite(cardStatements, statementId, statementRange.end);
    report.statements.push({ accountId: card.id, statementId, write, charges, notices });
    if (write !== 'written') {
      // History is preserved as stored: no recalculation, overwrite or deletion.
      continue;
    }

    statements.push({
      id: statementId,
      accountId: card.id,
      createdAt: cardStatements.find(statement => statement.id === statementId)?.createdAt ?? now,
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

  return report;
}

type AssociatePendingTransactionsParams = {
  account: Account;
  accountRepository: AccountRepository;
  creditCardRepository: CreditCardRepository;
  transactionRepository: TransactionRepository;
};

export async function associatePendingTransactionsForCreditCard(params: AssociatePendingTransactionsParams): Promise<number> {
  const intention = { ...params, account: { ...params.account } };
  return withCreditCardPaymentScope(intention, async dependencies => {
    const current = (await dependencies.accountRepository.getAccounts()).find(card => card.id === intention.account.id);
    if (!current || !isRealCreditCardAccount(current)) {
      throw new Error('Selecciona una tarjeta de credito activa para asociar los movimientos.');
    }
    return associatePendingTransactionsInScope({ ...dependencies, account: current });
  });
}

async function associatePendingTransactionsInScope({
  account,
  accountRepository,
  creditCardRepository,
  transactionRepository,
}: AssociatePendingTransactionsParams): Promise<number> {
  const transactions = await readUnclassifiedCreditTransactions(transactionRepository, UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID);
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

/**
 * 6B.3: the exact amount of an explicit whole-debt settlement, read inside the payment scope. No
 * rounding, tolerance or forgiveness: the debt must be canonical and equal to what the user saw.
 */
function fullDebtSettlementAmount(expectedDebt: number, currentDebt: number, sourceAccount: Account): number {
  if (toExactCopCents(currentDebt) === undefined) {
    throw new Error('La deuda tiene fracciones inferiores a un centavo y no puede liquidarse con exactitud.');
  }
  if (currentDebt !== expectedDebt) {
    throw new Error('La deuda de la tarjeta cambio. Revisa el saldo pendiente antes de pagar el total.');
  }
  if (!Number.isInteger(currentDebt) && toExactCopCents(sourceAccount.balance.amount) === undefined) {
    throw new Error('La cuenta origen tiene un saldo con fracciones inferiores a un centavo y no puede debitar centavos exactos.');
  }
  return currentDebt;
}

const paymentRequests = new WeakMap<RegisterCreditCardPaymentParams, Promise<RegisterCreditCardPaymentResult>>();
let paymentIdSequence = 0;

export async function registerCreditCardPayment(
  params: RegisterCreditCardPaymentParams,
): Promise<RegisterCreditCardPaymentResult> {
  const database = repositorySQLiteDatabase(params.transactionRepository);
  // Participant results are provisional: their owner still decides COMMIT/ROLLBACK.
  const participant = database && isSQLiteParticipant(database);
  const existing = participant ? undefined : paymentRequests.get(params);
  if (existing) return existing;
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error('Ingresa un monto valido para el pago de la tarjeta.');
  }
  const settlement = params.settlement ?? 'partial';
  if (settlement !== 'partial' && settlement !== 'fullDebt') {
    throw new Error('Tipo de pago de tarjeta no valido.');
  }
  if (settlement === 'fullDebt') {
    if (toExactCopCents(params.amount) === undefined) {
      throw new Error('El total de la deuda debe expresarse con un maximo de dos decimales.');
    }
  } else if (Math.round(params.amount) < 1) {
    throw new Error('El importe del pago debe ser de al menos $1 COP.');
  }
  // Capture the intention before waiting for the connection; never cache a mutable caller object.
  const intention = { ...params, currentDate: new Date(params.currentDate?.getTime() ?? Date.now()) };
  const result = withCreditCardPaymentScope(intention, dependencies =>
    registerCreditCardPaymentInScope({ ...intention, ...dependencies }));
  // Runtime protection for the same request, including rejection/unknown; no durable receipt.
  if (!participant) paymentRequests.set(params, result);
  return result;
}

async function registerCreditCardPaymentInScope({
  accountId,
  accountRepository,
  amount,
  creditCardRepository,
  currentDate = new Date(),
  settlement = 'partial',
  sourceAccountId,
  transactionRepository,
}: RegisterCreditCardPaymentParams): Promise<RegisterCreditCardPaymentResult> {
  const transactionId = `tx-credit-card-payment-${accountId}-${Date.now()}-${++paymentIdSequence}`;
  if (await readCurrentManualTransaction(transactionRepository, transactionId)) {
    throw new Error('La identidad del pago ya existe. Actualiza el historial antes de registrarlo.');
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

  const paidAmount = settlement === 'fullDebt'
    ? fullDebtSettlementAmount(amount, previousDebt, sourceAccount)
    : Math.min(Math.round(amount), previousDebt);
  if (settlement === 'partial' && (!Number.isSafeInteger(paidAmount) || paidAmount < 1)) {
    throw new Error('El importe efectivo del pago debe ser de al menos $1 COP y expresarse en pesos enteros válidos.');
  }
  if (sourceAccount.balance.amount < paidAmount) {
    throw new Error('La cuenta origen no tiene saldo suficiente para ese pago.');
  }

  const now = currentDate.toISOString();
  const transaction: Transaction = {
    id: transactionId,
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
        amount: addCopAmounts(sourceAccount.balance.amount, -paidAmount, 'creditCardPayment.source').amount,
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

  if (settlement === 'fullDebt') {
    // Same coordinated scope: throwing here rolls back the debit, the payment and the reconciliation.
    const settledCard = (await accountRepository.getAccounts()).find(account => account.id === card.id);
    if (settledCard?.debtBalance?.amount !== 0) {
      throw new Error('La liquidacion no dejo la deuda en cero. No se registro el pago.');
    }
  }

  return {
    paidAmount,
    previousDebt,
    remainingDebt: Math.max(addCopAmounts(previousDebt, -paidAmount, 'creditCardPayment.remainingDebt').amount, 0),
    transaction,
  };
}
