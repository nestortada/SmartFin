import { useEffect, useState, useMemo, useRef } from 'react';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import type { Transaction } from '../../transactions';
import type { TransactionHistoryCursor } from '../types/TransactionHistoryQuery';
import { HISTORY_PAGE_SIZE, TransactionHistoryChangedError, TransactionHistoryCancelledError } from '../repositories/sqliteTransactionHistory';
import { createSqliteTransactionRepository } from '../repositories/sqliteTransactionRepository';
import type { Account } from '../../accounts';
import { createSqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import type { Category } from '../../categories';
import { createSqliteCategoryRepository } from '../../categories/repositories/sqliteCategoryRepository';

type UseTransactionsListResult = {
  transactions: Transaction[];
  filteredTransactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  months: string[]; // List of available months e.g. ["2026-05", "2026-04"]
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: string | undefined;

  // Filter & Search states
  selectedMonth: string; // 'all' or 'YYYY-MM'
  setSelectedMonth: (month: string) => void;
  selectedAccount: string; // 'all' or accountId
  setSelectedAccount: (accountId: string) => void;
  selectedCategory: string; // 'all' or categoryId
  setSelectedCategory: (categoryId: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortOrder: 'newest' | 'oldest';
  setSortOrder: (order: 'newest' | 'oldest') => void;
};

// Map Spanish month names for displaying in filters
export const MONTH_NAMES_SPANISH: Record<string, string> = {
  '01': 'Enero',
  '02': 'Febrero',
  '03': 'Marzo',
  '04': 'Abril',
  '05': 'Mayo',
  '06': 'Junio',
  '07': 'Julio',
  '08': 'Agosto',
  '09': 'Septiembre',
  '10': 'Octubre',
  '11': 'Noviembre',
  '12': 'Diciembre',
};

export function formatYearMonth(ym: string): string {
  if (ym === 'all') return 'Todos';
  const parts = ym.split('-');
  if (parts.length < 2) return ym;
  const [year, month] = parts;
  const monthName = MONTH_NAMES_SPANISH[month as string] || month;
  return `${monthName} ${year}`;
}

export function transactionMatchesAccountFilter(
  transaction: Transaction,
  selectedAccount: string,
): boolean {
  if (selectedAccount === 'all') {
    return true;
  }

  if (transaction.type === 'internalTransfer') {
    return transaction.accountId === selectedAccount;
  }

  return (
    transaction.accountId === selectedAccount ||
    transaction.targetAccountId === selectedAccount
  );
}

export function useTransactionsList(
  database: SmartFinSQLiteDatabase | undefined,
  refreshKey: number,
): UseTransactionsListResult {
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [selectedAccount, setSelectedAccount] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [restart, setRestart] = useState(0);
  const query = useMemo(() => ({ month: selectedMonth, accountId: selectedAccount,
    categoryId: selectedCategory, search: searchQuery, sort: sortOrder }),
    [selectedMonth, selectedAccount, selectedCategory, searchQuery, sortOrder]);
  const request = useMemo(() => ({ database, query, refreshKey, restart }),
    [database, query, refreshKey, restart]);
  const latest = useRef(request);
  latest.current = request;
  const loaded = useRef({ database, query, count: 0 });
  const [data, setData] = useState<{ database: typeof database; query: typeof query; transactions: Transaction[] }>(
    { database, query, transactions: [] });
  const more = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    if (!database) {
      setAccounts([]); setCategories([]); setMonths([]);
      return;
    }
    const repo = createSqliteTransactionRepository(database);
    Promise.all([createSqliteAccountRepository(database).getAccounts(),
      createSqliteCategoryRepository(database).getCategories(), repo.getTransactionMonths()])
      .then(([acs, cats, availableMonths]) => {
        if (!cancelled) { setAccounts(acs); setCategories(cats); setMonths(availableMonths); }
      }).catch(() => { if (!cancelled) setError('No se pudieron cargar los movimientos.'); });
    return () => { cancelled = true; };
  }, [database, refreshKey, restart]);

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    let cursor: TransactionHistoryCursor | undefined;
    let exhausted = false;
    let transactions: Transaction[] = [];
    const isCancelled = () => cancelled || latest.current !== request;
    const target = loaded.current.database === database && loaded.current.query === query
      ? Math.max(HISTORY_PAGE_SIZE, loaded.current.count) : HISTORY_PAGE_SIZE;
    setError(undefined);
    setLoading(!!database);
    setLoadingMore(false);
    setHasMore(false);
    if (!database) {
      setData({ database, query, transactions });
      more.current = () => {};
      return;
    }
    const repo = createSqliteTransactionRepository(database);
    async function load(initial: boolean) {
      if (busy || exhausted || isCancelled()) return;
      busy = true;
      if (!initial) setLoadingMore(true);
      try {
        setError(undefined);
        do {
          const page = await repo.getTransactionPage(query, cursor, isCancelled);
          if (isCancelled()) return;
          const seen = new Set(transactions.map(tx => tx.id));
          transactions = [...transactions, ...page.transactions.filter(tx => !seen.has(tx.id))];
          cursor = page.nextCursor;
          exhausted = !cursor;
        } while (initial && cursor && transactions.length < target);
        if (isCancelled()) return;
        loaded.current = { database, query, count: transactions.length };
        setData({ database, query, transactions });
        setHasMore(!exhausted);
      } catch (err) {
        if (isCancelled() || err instanceof TransactionHistoryCancelledError) return;
        if (err instanceof TransactionHistoryChangedError) {
          // Discard the entire generation rather than mixing database revisions.
          setRestart(value => value + 1);
        } else {
          setError('No se pudieron cargar los movimientos.');
        }
      } finally {
        busy = false;
        if (!isCancelled()) { setLoading(false); setLoadingMore(false); }
      }
    }
    more.current = () => { void load(false); };
    void load(true);
    return () => { cancelled = true; };
  }, [database, query, request]);

  const transactions = data.database === database && data.query === query ? data.transactions : [];
  return { transactions, filteredTransactions: transactions, accounts, categories, months,
    loading, loadingMore, hasMore, error, loadMore: () => more.current(),
    selectedMonth, setSelectedMonth, selectedAccount, setSelectedAccount,
    selectedCategory, setSelectedCategory, searchQuery, setSearchQuery, sortOrder, setSortOrder };
}
