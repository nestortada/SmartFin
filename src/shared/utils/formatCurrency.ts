import type { CurrencyCode } from '../types';

export function formatCurrency(value: number, currency: CurrencyCode): string {
  const amount = withoutNegativeZero(value);
  if (isBelowOnePeso(amount)) {
    return formatBelowOnePeso(amount, currency);
  }
  return new Intl.NumberFormat('es-CO', {
    currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    style: 'currency',
  }).format(amount);
}

/**
 * Like formatCurrency, but a non-whole amount keeps its two decimals («$ 10.000,40»). For screens
 * where the exact figure matters, such as the debt that "Pagar deuda total" settles (6B.3).
 */
export function formatCurrencyWithCents(value: number, currency: CurrencyCode): string {
  const amount = withoutNegativeZero(value);
  if (Number.isInteger(amount) || isBelowOnePeso(amount)) {
    return formatCurrency(amount, currency);
  }
  return twoDecimalFormat(currency).format(amount);
}

/**
 * 6B-D4: the IEEE negative zero is the exact amount 0 and must not read «−$ 0». Only −0 changes
 * (`-0 === 0`); any non-zero value, however small, keeps its sign and Intl rounding unchanged.
 * Normalizing before Intl avoids `signDisplay`, whose support differs between Android API levels.
 */
export function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/** 6B.3: a non-zero amount that whole-peso formatting would show as $ 0 or $ 1. */
export function isBelowOnePeso(value: number): boolean {
  return value !== 0 && Math.abs(value) < 1;
}

/**
 * 6B.3: 0 < |amount| < 1 is shown with two decimals («$ 0,40», «-$ 0,40», «$ 0,01») so a real
 * debt or balance never reads as $ 0. Only the text changes, never the stored value. A legacy
 * residue below half a cent, which two decimals would still print as 0,00, reads «< $ 0,01» or
 * «> -$ 0,01»: it is not zero, and it is not shown as a settled obligation either.
 */
export function formatBelowOnePeso(amount: number, currency: CurrencyCode): string {
  const format = twoDecimalFormat(currency);
  if (Math.abs(amount) < 0.005) {
    return amount > 0 ? `< ${format.format(0.01)}` : `> ${format.format(-0.01)}`;
  }
  return format.format(amount);
}

function twoDecimalFormat(currency: CurrencyCode): Intl.NumberFormat {
  return new Intl.NumberFormat('es-CO', {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  });
}
