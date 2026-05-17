
import type { ParsedFinancialMessage } from '../../settings/services/smsParser';
import type { Transaction } from '../types';

export type CreateTransactionFromSmsParams = {
  parsedMessage: ParsedFinancialMessage;
  accountId: string;
  categoryId: string;
  receivedAt: string;
};

/**
 * Creates a transaction from a parsed SMS message.
 * Automatically determines the transaction type and direction based on the parsed content.
 */
export function createTransactionFromSms(
  params: CreateTransactionFromSmsParams,
): Transaction {
  const { parsedMessage, accountId, categoryId, receivedAt } = params;

  if (parsedMessage.status !== 'parsed') {
    throw new Error(`Cannot create transaction from unsupported SMS message`);
  }

  // Generate a unique transaction ID
  const uniqueId = `sms-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const id = `txn-${uniqueId}`;

  const now = new Date().toISOString();
  const date = receivedAt.slice(0, 10) as any; // ISODateString format: YYYY-MM-DD

  const isCredit = parsedMessage.bankName.toUpperCase().includes('CREDIT') || 
                   parsedMessage.parserName.includes('credit') ||
                   accountId.includes('credit-card');
  const opType = isCredit ? 'Crédito' : 'Débito';

  // For payments (NEQUI, etc.), we assume they are expenses
  const transaction: Transaction = {
    id,
    amount: parsedMessage.amount,
    currency: parsedMessage.currency,
    description: parsedMessage.merchantName,
    date,
    accountId,
    categoryId,
    type: 'expense',
    direction: 'outflow',
    status: 'posted',
    merchantName: parsedMessage.merchantName,
    notes: `Capturado desde SMS (${parsedMessage.bankName})`,
    createdAt: now,
    updatedAt: now,
  };

  return transaction;
}
