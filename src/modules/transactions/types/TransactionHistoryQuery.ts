import type { Transaction } from './Transaction';

export type TransactionHistoryQuery = {
  month: string;
  accountId: string;
  categoryId: string;
  search: string;
  sort: 'newest' | 'oldest';
};

export type TransactionHistoryCursor = {
  revision: number;
  queryKey: string;
  after?: { date: string; createdAt: string; rowId: number };
  // Legacy Date/invalid-date semantics require JS sorting of a narrow projection.
  legacyIds?: string[];
  legacyOffset: number;
};

export type TransactionHistoryPage = {
  transactions: Transaction[];
  nextCursor?: TransactionHistoryCursor;
};
