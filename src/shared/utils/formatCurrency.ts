import type { CurrencyCode } from '../types';

export function formatCurrency(value: number, currency: CurrencyCode): string {
  return new Intl.NumberFormat('es-CO', {
    currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    style: 'currency',
  }).format(withoutNegativeZero(value));
}

/**
 * 6B-D4: the IEEE negative zero is the exact amount 0 and must not read «−$ 0». Only −0 changes
 * (`-0 === 0`); any non-zero value, however small, keeps its sign and Intl rounding unchanged.
 * Normalizing before Intl avoids `signDisplay`, whose support differs between Android API levels.
 */
export function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}
