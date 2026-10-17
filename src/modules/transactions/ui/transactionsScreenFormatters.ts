import type { Transaction } from '../types';
import { bogotaToday, transactionDateKey } from '../../../shared/utils/transactionDate';

export type TransactionDateGroup = {
  data: Transaction[];
  date: string;
};

export function groupTransactionsByDate(transactions: Transaction[]): TransactionDateGroup[] {
  const groups: Record<string, Transaction[]> = {};

  transactions.forEach(transaction => {
    const date = transactionDateKey(transaction);
    groups[date] = groups[date] ?? [];
    groups[date]?.push(transaction);
  });

  return Object.keys(groups).map(date => ({
    date,
    data: groups[date] ?? [],
  }));
}

export function formatTransactionDateHeader(date: string): string {
  const today = bogotaToday();
  const yesterday = bogotaToday(new Date(Date.now() - 86400000));

  if (date === today) return 'HOY';
  if (date === yesterday) return 'AYER';

  const parts = date.split('-');
  if (parts.length < 3) return date;

  const [year, month, day] = parts;
  const monthsSpanish = [
    'ENE',
    'FEB',
    'MAR',
    'ABR',
    'MAY',
    'JUN',
    'JUL',
    'AGO',
    'SEP',
    'OCT',
    'NOV',
    'DIC',
  ];
  const monthIndex = parseInt(month as string, 10) - 1;

  return `${day} DE ${monthsSpanish[monthIndex]} DE ${year}`;
}

export function formatCOP(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatAmountInputForForm(value: number): string {
  return Math.max(value, 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
}
