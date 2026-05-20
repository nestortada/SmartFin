import type { ParsedFinancialMessage } from '../../settings/services/smsParser';
import type { Transaction } from '../types';

export type CreateTransactionFromSmsParams = {
  parsedMessage: ParsedFinancialMessage;
  accountId: string;
  categoryId: string;
  creditCardHint?: string;
  dedupeKey?: string;
  paymentMethod?: Transaction['paymentMethod'];
  receivedAt: string;
  sourceType?: 'sms' | 'notification';
};

export function createTransactionFromSms(
  params: CreateTransactionFromSmsParams,
): Transaction {
  const {
    parsedMessage,
    accountId,
    categoryId,
    creditCardHint,
    dedupeKey,
    paymentMethod,
    receivedAt,
    sourceType = 'sms',
  } = params;

  if (parsedMessage.status !== 'parsed') {
    throw new Error('Cannot create transaction from unsupported SMS message');
  }

  const uniqueId = `sms-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();

  return {
    id: `txn-${uniqueId}`,
    accountId,
    amount: parsedMessage.amount,
    categoryId,
    createdAt: now,
    creditCardHint,
    currency: parsedMessage.currency,
    date: receivedAt.slice(0, 10),
    dedupeKey,
    description: parsedMessage.merchantName,
    direction: 'outflow',
    merchantName: parsedMessage.merchantName,
    notes: `Capturado desde ${sourceType === 'notification' ? 'notificacion' : 'SMS'} (${parsedMessage.bankName})`,
    paymentMethod,
    status: 'posted',
    type: 'expense',
    updatedAt: now,
  };
}
