import type { CurrencyCode, ISODateString } from '../../../shared/types';

export type TransactionType =
  | 'income'
  | 'expense'
  | 'internalTransfer'
  | 'creditCardPayment'
  | 'loanPayment'
  | 'investment'
  | 'refund'
  | 'manualAdjustment';

export type TransactionDirection = 'inflow' | 'outflow' | 'neutral';

export type TransactionStatus = 'posted' | 'pending' | 'cancelled';

export type Transaction = {
  id: string;
  amount: number;
  currency: CurrencyCode;
  description: string;
  date: ISODateString;
  accountId: string;
  categoryId?: string;
  type: TransactionType;
  direction: TransactionDirection;
  status: TransactionStatus;
  targetAccountId?: string;
  merchantName?: string;
  notes?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};
