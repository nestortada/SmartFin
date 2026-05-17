import type { CurrencyCode } from '../types';

export function formatCurrency(value: number, currency: CurrencyCode): string {
  return new Intl.NumberFormat('es-CO', {
    currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    style: 'currency',
  }).format(value);
}
