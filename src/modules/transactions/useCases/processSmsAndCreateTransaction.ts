import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { parseFinancialSms, type FinancialSmsMessage } from '../../settings/services/smsParser';
import type { TransactionRepository } from '../repositories';
import { createTransactionFromSms } from './createTransactionFromSms';

export type ProcessSmsAndCreateTransactionParams = {
  smsMessage: FinancialSmsMessage;
  transactionRepository: TransactionRepository;
  database: SmartFinSQLiteDatabase;
  accountId: string;
  categoryId: string;
};

/**
 * Processes an incoming SMS, creates a transaction, and saves it to the database.
 * Returns the created transaction if successful, or null if the SMS could not be parsed.
 */
import { resultSetToRows } from '../../../database/sqliteRows';

export async function processSmsAndCreateTransaction(
  params: ProcessSmsAndCreateTransactionParams,
): Promise<void> {
  const { smsMessage, transactionRepository, database, accountId, categoryId } = params;

  // Parse the SMS message
  const parsedMessage = parseFinancialSms(smsMessage);

  // If the message couldn't be parsed, skip it
  if (parsedMessage.status !== 'parsed') {
    console.log('SMS message could not be parsed:', smsMessage.body);
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
    receivedAt: smsMessage.receivedAt,
  });

  // Get existing transactions (handle both sync and async)
  const transactionsResult = transactionRepository.getTransactions();
  const existingTransactions = transactionsResult instanceof Promise
    ? await transactionsResult
    : transactionsResult;

  // Add the new transaction
  const updatedTransactions = [...existingTransactions, transaction];

  // Save to database
  if (transactionRepository.saveTransactions) {
    await transactionRepository.saveTransactions(updatedTransactions);
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
