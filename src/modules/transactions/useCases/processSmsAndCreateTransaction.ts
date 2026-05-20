import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import {
  parseFinancialSms,
  type FinancialMessage,
  type ParsedFinancialMessage,
} from '../../settings/services/smsParser';
import type { TransactionRepository } from '../repositories';
import { createTransactionFromSms } from './createTransactionFromSms';
import { createSqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import { createSqliteCreditCardRepository } from '../../creditCards/repositories';
import { reconcileCreditCardTransactions } from '../../creditCards/useCases';
import type { Transaction } from '../types';
import { createSqliteTransactionRepository } from '../repositories/sqliteTransactionRepository';

export type ProcessSmsAndCreateTransactionParams = {
  smsMessage: FinancialMessage;
  transactionRepository: TransactionRepository;
  database: SmartFinSQLiteDatabase;
  accountId: string;
  categoryId: string;
  creditCardHint?: string;
  paymentMethod?: Transaction['paymentMethod'];
};

/**
 * Processes an incoming SMS, creates a transaction, and saves it to the database.
 * Returns the created transaction if successful, or null if the SMS could not be parsed.
 */
import { resultSetToRows } from '../../../database/sqliteRows';

const SAME_SOURCE_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const CROSS_SOURCE_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

function normalizeForDedupe(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function toAmountCents(amount: number): number {
  return Math.round(amount * 100);
}

function getMessageTimeMs(receivedAt: string): number {
  const parsed = Date.parse(receivedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function getTransactionSourceType(transaction: Transaction): 'sms' | 'notification' | undefined {
  const notes = transaction.notes?.toLowerCase() ?? '';

  if (notes.includes('notificacion')) {
    return 'notification';
  }

  if (notes.includes('sms')) {
    return 'sms';
  }

  return undefined;
}

function buildFinancialTransactionDedupeKey(params: {
  accountId: string;
  bankName: string;
  merchantName: string;
  amount: number;
  paymentMethod?: Transaction['paymentMethod'];
  receivedAt: string;
}): string {
  const timeBucket = Math.floor(getMessageTimeMs(params.receivedAt) / SAME_SOURCE_DEDUPE_WINDOW_MS);

  return [
    'financial-message-v1',
    normalizeForDedupe(params.bankName),
    toAmountCents(params.amount),
    normalizeForDedupe(params.merchantName),
    params.paymentMethod ?? 'unknown',
    params.accountId,
    timeBucket,
  ].join('|');
}

function isDuplicateFinancialTransaction(params: {
  existingTransaction: Transaction;
  parsedMessage: Extract<ParsedFinancialMessage, { status: 'parsed' }>;
  accountId: string;
  paymentMethod?: Transaction['paymentMethod'];
  receivedAt: string;
  sourceType: 'sms' | 'notification';
}): boolean {
  const {
    accountId,
    existingTransaction,
    parsedMessage,
    paymentMethod,
    receivedAt,
    sourceType,
  } = params;

  if (
    existingTransaction.type !== 'expense' ||
    existingTransaction.direction !== 'outflow' ||
    existingTransaction.accountId !== accountId ||
    toAmountCents(existingTransaction.amount) !== toAmountCents(parsedMessage.amount)
  ) {
    return false;
  }

  const existingMerchant = normalizeForDedupe(
    existingTransaction.merchantName ?? existingTransaction.description,
  );
  const nextMerchant = normalizeForDedupe(parsedMessage.merchantName);

  if (!existingMerchant || existingMerchant !== nextMerchant) {
    return false;
  }

  const existingPaymentMethod = existingTransaction.paymentMethod ?? paymentMethod;
  const nextPaymentMethod = paymentMethod ?? existingTransaction.paymentMethod;
  if (existingPaymentMethod && nextPaymentMethod && existingPaymentMethod !== nextPaymentMethod) {
    return false;
  }

  const existingTime = getMessageTimeMs(existingTransaction.createdAt);
  const nextTime = getMessageTimeMs(receivedAt);
  const existingSourceType = getTransactionSourceType(existingTransaction);
  const windowMs =
    existingSourceType && existingSourceType === sourceType
      ? SAME_SOURCE_DEDUPE_WINDOW_MS
      : CROSS_SOURCE_DEDUPE_WINDOW_MS;

  return Math.abs(existingTime - nextTime) <= windowMs;
}

export async function processSmsAndCreateTransaction(
  params: ProcessSmsAndCreateTransactionParams,
): Promise<void> {
  const {
    smsMessage,
    transactionRepository,
    database,
    accountId,
    categoryId,
    creditCardHint,
    paymentMethod,
  } = params;

  // Parse the SMS message
  const parsedMessage = parseFinancialSms(smsMessage);

  // If the message couldn't be parsed, skip it
  if (parsedMessage.status !== 'parsed') {
    console.log('SMS message could not be parsed:', smsMessage.body);
    return;
  }

  const sourceType = smsMessage.sourceType ?? 'sms';
  const transactionsResult = transactionRepository.getTransactions();
  const existingTransactions = transactionsResult instanceof Promise
    ? await transactionsResult
    : transactionsResult;

  const duplicateTransaction = existingTransactions.find(existingTransaction =>
    isDuplicateFinancialTransaction({
      accountId,
      existingTransaction,
      parsedMessage,
      paymentMethod,
      receivedAt: smsMessage.receivedAt,
      sourceType,
    }),
  );

  if (duplicateTransaction) {
    console.log(
      'Financial message skipped as duplicate:',
      duplicateTransaction.id,
      parsedMessage.merchantName,
    );
    return;
  }

  let finalCategoryId = categoryId;
  try {
    const [resultSet] = await database.executeSql(
      'SELECT category_id FROM merchant_mappings WHERE raw_merchant_text = ? OR normalized_merchant_name = ?;',
      [parsedMessage.merchantName, parsedMessage.merchantName]
    );
    const rows = resultSetToRows(resultSet);
    const firstRow = rows[0];
    if (firstRow) {
      const dbCategoryId = firstRow.category_id as string | null;
      if (dbCategoryId) {
        finalCategoryId = dbCategoryId;
        console.log(`[Categorization] Rule found! Mapped ${parsedMessage.merchantName} to category: ${dbCategoryId}`);
      }
    }
  } catch (err) {
    console.error('[Categorization] Error reading merchant mappings:', err);
  }

  // Create a transaction from the parsed SMS
  const transaction = createTransactionFromSms({
    parsedMessage,
    accountId,
    categoryId: finalCategoryId,
    creditCardHint,
    dedupeKey: buildFinancialTransactionDedupeKey({
      accountId,
      amount: parsedMessage.amount,
      bankName: parsedMessage.bankName,
      merchantName: parsedMessage.merchantName,
      paymentMethod,
      receivedAt: smsMessage.receivedAt,
    }),
    paymentMethod,
    receivedAt: smsMessage.receivedAt,
    sourceType,
  });

  // Add the new transaction
  const updatedTransactions = [...existingTransactions, transaction];

  // Save to database
  if (transactionRepository.saveTransactions) {
    await transactionRepository.saveTransactions(updatedTransactions);
  }

  if (paymentMethod === 'credit') {
    await reconcileCreditCardTransactions({
      accountRepository: createSqliteAccountRepository(database),
      creditCardRepository: createSqliteCreditCardRepository(database),
      transactionRepository: createSqliteTransactionRepository(database),
    });
  }

  console.log('Transaction created from SMS:', transaction.id, transaction.merchantName);
}

/**
 * Automatically categorizes a merchant name based on common patterns.
 * This is a simple heuristic that can be improved over time.
 */
export function categorizeMerchantName(merchantName: string): string {
  const name = merchantName.toLowerCase();

  // Food & Restaurants
  if (
    name.includes('restaur') ||
    name.includes('comida') ||
    name.includes('pizza') ||
    name.includes('burger') ||
    name.includes('cafe')
  ) {
    return 'category-food';
  }

  // Education (mapped to other as education category doesn't exist in seed)
  if (
    name.includes('universidad') ||
    name.includes('escuela') ||
    name.includes('colegio') ||
    name.includes('educación')
  ) {
    return 'category-other';
  }

  // Transport
  if (
    name.includes('transporte') ||
    name.includes('taxi') ||
    name.includes('uber') ||
    name.includes('metro') ||
    name.includes('gasolina')
  ) {
    return 'category-transport';
  }

  // Entertainment
  if (
    name.includes('netflix') ||
    name.includes('spotify') ||
    name.includes('cine') ||
    name.includes('película') ||
    name.includes('juegos')
  ) {
    return 'category-entertainment';
  }

  // Health
  if (
    name.includes('farmacia') ||
    name.includes('hospital') ||
    name.includes('médico') ||
    name.includes('doctor')
  ) {
    return 'category-health';
  }

  // Default to miscellaneous
  return 'category-other';
}
