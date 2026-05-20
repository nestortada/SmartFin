import type { Transaction } from '../types';

export type TransactionDateGroup = {
  data: Transaction[];
  date: string;
};

export function groupTransactionsByDate(transactions: Transaction[]): TransactionDateGroup[] {
  const groups: Record<string, Transaction[]> = {};

  transactions.forEach(transaction => {
    const date = transaction.date.slice(0, 10);
    groups[date] = groups[date] ?? [];
    groups[date]?.push(transaction);
  });

  return Object.keys(groups).map(date => ({
    date,
    data: groups[date] ?? [],
  }));
}

export function formatTransactionDateHeader(date: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

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
  return Math.trunc(Math.max(value, 0)).toLocaleString('es-CO');
}
