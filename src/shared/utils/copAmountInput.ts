import { toExactCopCents } from './exactCopCents';

/** Preserve incomplete decimal drafts while grouping COP thousands. */
export function formatCopAmountInput(value: string): string {
  const clean = value.replace(/[^\d,]/g, '');
  const [integer = '', ...decimals] = clean.split(',');
  const grouped = integer
    .replace(/^0+(?=\d)/, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const prefix = value.trim().startsWith('-') ? '-' : '';
  return (
    prefix +
    (decimals.length ? `${grouped},${decimals.join('').slice(0, 2)}` : grouped)
  );
}

/**
 * Input text of a stored two-decimal amount, built from its exact cents («10.000,40»). Never rounds:
 * undefined for negative amounts or amounts that are not canonical two-decimal doubles (6B.3).
 */
export function formatExactCopAmountInput(amount: number): string | undefined {
  const cents = toExactCopCents(amount);
  if (cents === undefined || cents < 0) return undefined;
  const integer = formatCopAmountInput(String(Math.floor(cents / 100)));
  const fraction = cents % 100;
  return fraction ? `${integer},${String(fraction).padStart(2, '0')}` : integer;
}

export function parseCopAmountDraft(value: string): number {
  const normalized = value.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d{0,2})?$/.test(normalized)) return 0;
  const amount = Number(normalized);
  return Number.isFinite(amount) &&
    Math.abs(amount) <= Number.MAX_SAFE_INTEGER / 100
    ? amount
    : 0;
}
