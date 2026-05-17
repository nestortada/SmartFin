import { useEffect, useState, useMemo } from 'react';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import {
  mockTransactionRepository,
  type Transaction,
} from '../../transactions';
import { createSqliteTransactionRepository } from '../repositories/sqliteTransactionRepository';
import {
  mockAccountRepository,
  type Account,
} from '../../accounts';
import { createSqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import {
  mockCategoryRepository,
  type Category,
} from '../../categories';
import { createSqliteCategoryRepository } from '../../categories/repositories/sqliteCategoryRepository';

type UseTransactionsListResult = {
  transactions: Transaction[];
  filteredTransactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  months: string[]; // List of available months e.g. ["2026-05", "2026-04"]
  loading: boolean;
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

export function useTransactionsList(
  database: SmartFinSQLiteDatabase | undefined,
  refreshKey: number,
): UseTransactionsListResult {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Filtering states
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  // Load from database or fallbacks
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(undefined);

      try {
        if (database) {
          const txRepo = createSqliteTransactionRepository(database);
          const acRepo = createSqliteAccountRepository(database);
          const catRepo = createSqliteCategoryRepository(database);

          const [txs, acs, cats] = await Promise.all([
            txRepo.getTransactions(),
            acRepo.getAccounts(),
            catRepo.getCategories(),
          ]);

          if (!cancelled) {
            setTransactions(txs);
            setAccounts(acs);
            setCategories(cats);
          }
        } else {
          // Fallback to mocks
          const mockTxs = mockTransactionRepository.getTransactions(new Date()) as Transaction[];
          const mockAcs = mockAccountRepository.getAccounts();
          const mockCats = mockCategoryRepository.getCategories();

          if (!cancelled) {
            setTransactions(mockTxs);
            setAccounts(mockAcs);
            setCategories(mockCats);
          }
        }
      } catch (err) {
        console.error('Error loading transaction screen data:', err);
        if (!cancelled) {
          setError('No se pudieron cargar los movimientos.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [database, refreshKey]);

  // Compute list of unique months present in the transactions
  const months = useMemo(() => {
    const uniqueMonths = new Set<string>();
    transactions.forEach(t => {
      if (t.date && t.date.length >= 7) {
        uniqueMonths.add(t.date.slice(0, 7)); // Format YYYY-MM
      }
    });
    return Array.from(uniqueMonths).sort((a, b) => b.localeCompare(a));
  }, [transactions]);

  // Apply filters and sorting
  const filteredTransactions = useMemo(() => {
    let result = [...transactions];

    // Filter by month
    if (selectedMonth !== 'all') {
      result = result.filter(t => t.date && t.date.startsWith(selectedMonth));
    }

    // Filter by account
    if (selectedAccount !== 'all') {
      result = result.filter(t => t.accountId === selectedAccount);
    }

    // Filter by category
    if (selectedCategory !== 'all') {
      result = result.filter(t => t.categoryId === selectedCategory);
    }

    // Search query filter (merchant Name, description or notes)
    if (searchQuery.trim().length > 0) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        t =>
          (t.merchantName && t.merchantName.toLowerCase().includes(query)) ||
          (t.description && t.description.toLowerCase().includes(query)) ||
          (t.notes && t.notes.toLowerCase().includes(query)),
      );
    }

    // Sort order
    result.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (sortOrder === 'newest') {
        return dateB - dateA;
      } else {
        return dateA - dateB;
      }
    });

    return result;
  }, [transactions, selectedMonth, selectedAccount, selectedCategory, searchQuery, sortOrder]);

  return {
    transactions,
    filteredTransactions,
    accounts,
    categories,
    months,
    loading,
    error,
    selectedMonth,
    setSelectedMonth,
    selectedAccount,
    setSelectedAccount,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
  };
}
