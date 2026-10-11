import type { ISODateString } from '../../../shared/types';
import type { Transaction, TransactionStatus } from './Transaction';

export type TransactionDateRangeQuery = {
  startDate: ISODateString;
  endDateExclusive: ISODateString;
  status: TransactionStatus;
};

export type TransactionAmount = Pick<
  Transaction,
  'amount' | 'type' | 'direction'
>;

export type TransactionAmountQuery = TransactionDateRangeQuery & {
  datePrefix: string;
  operations: ReadonlyArray<Pick<Transaction, 'type' | 'direction'>>;
};

export type TransactionDayCount = {
  date: ISODateString;
  count: number;
};
