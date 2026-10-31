/**
 * From 2^46 COP on, consecutive doubles are 2^-6 apart, so distinct two-decimal
 * amounts can share the same stored double. Below it every cent maps to its own double.
 */
export const MAX_EXACT_COP_CENTS_AMOUNT = 2 ** 46;

/**
 * Exact integer cents of a stored COP amount, or undefined when the value is not the
 * double of a two-decimal amount below MAX_EXACT_COP_CENTS_AMOUNT. Never rounds: the
 * candidate is accepted only if `cents / 100` (correctly rounded by IEEE 754, as the
 * input parser does with `Number(text)`) reproduces exactly the same double.
 */
export function toExactCopCents(amount: number): number | undefined {
  if (!Number.isFinite(amount) || Math.abs(amount) >= MAX_EXACT_COP_CENTS_AMOUNT) {
    return undefined;
  }
  // Below the limit |amount * 100 - cents| < 0.9, so the exact cents are one of these.
  const rounded = Math.round(amount * 100);
  for (const cents of [rounded, rounded - 1, rounded + 1]) {
    if (cents / 100 === amount) {
      return cents + 0; // normalizes -0
    }
  }
  return undefined;
}

/** Exact sum in cents, or undefined if any amount is not exact or the total is unsafe. */
export function sumExactCopCents(amounts: readonly number[]): number | undefined {
  let total = 0;
  for (const amount of amounts) {
    const cents = toExactCopCents(amount);
    if (cents === undefined) {
      return undefined;
    }
    total += cents;
    if (!Number.isSafeInteger(total)) {
      return undefined;
    }
  }
  return total;
}

/** Which arithmetic produced a persisted COP amount (6B.1). */
export type CopArithmeticPath = 'exactCents' | 'binaryLegacy';
export type CopArithmeticResult = { amount: number; path: CopArithmeticPath };

const MAX_EXACT_COP_CENTS = MAX_EXACT_COP_CENTS_AMOUNT * 100;

function fromExactCents(cents: number): number | undefined {
  // The result must itself be a two-decimal amount below the limit to be stored canonically.
  return Number.isSafeInteger(cents) && Math.abs(cents) < MAX_EXACT_COP_CENTS ? cents / 100 + 0 : undefined;
}

/**
 * In-memory, local-only record of writes that could not use exact cents (operands with more
 * than two decimals, non-finite or beyond 2^46 COP). Nothing is persisted or sent anywhere.
 */
const binaryFallbacks = new Map<string, number>();

function binaryFallback(site: string, amount: number): CopArithmeticResult {
  binaryFallbacks.set(site, (binaryFallbacks.get(site) ?? 0) + 1);
  return { amount, path: 'binaryLegacy' };
}

/** Counts of binary fallbacks by writer since start (or the last reset). */
export function getCopArithmeticFallbacks(): Record<string, number> {
  return Object.fromEntries(binaryFallbacks);
}

export function resetCopArithmeticFallbacks(): void {
  binaryFallbacks.clear();
}

/**
 * `base + delta` for a persisted balance or debt. When both operands are canonical two-decimal
 * amounts the result is the canonical double of the exact decimal sum; otherwise it is the
 * previous binary `base + delta`, unchanged (no rounding, no repair of out-of-contract data).
 * For whole pesos both paths give the same double.
 */
export function addCopAmounts(base: number, delta: number, site = 'unspecified'): CopArithmeticResult {
  const baseCents = toExactCopCents(base);
  const deltaCents = toExactCopCents(delta);
  const exact = baseCents === undefined || deltaCents === undefined ? undefined : fromExactCents(baseCents + deltaCents);
  return exact === undefined ? binaryFallback(site, base + delta) : { amount: exact, path: 'exactCents' };
}

/** `a + b` of exact cents, or undefined if an operand is missing or the result is not a safe integer. */
export function addSafeCents(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined || b === undefined) {
    return undefined;
  }
  // Both operands are safe integers: an exact total within the safe range is computed exactly, and
  // a total beyond it rounds to at least 2^53, so it can never come back as a wrong safe integer.
  const total = a + b;
  return Number.isSafeInteger(total) ? total : undefined;
}

/**
 * Value of a derived, non-persisted aggregate (6B.2 dashboard figures): exact cents converted once
 * when they are available and safe; otherwise the previous binary value, unchanged and recorded.
 * Unlike persisted balances it does not require the result below 2^46: `cents / 100` is already the
 * nearest double to the exact decimal, as in the 6A monthly figures.
 */
export function copAggregate(cents: number | undefined, binary: number, site = 'unspecified'): CopArithmeticResult {
  if (cents !== undefined && Number.isSafeInteger(cents)) {
    return { amount: cents / 100 + 0, path: 'exactCents' };
  }
  aggregateFallbacks.set(site, (aggregateFallbacks.get(site) ?? 0) + 1);
  return { amount: binary, path: 'binaryLegacy' };
}

/** Like the writer record, but for derived aggregates that are read, never persisted (6B.2). */
const aggregateFallbacks = new Map<string, number>();

/** Counts of binary fallbacks by aggregate since start (or the last reset). */
export function getCopAggregateFallbacks(): Record<string, number> {
  return Object.fromEntries(aggregateFallbacks);
}

export function resetCopAggregateFallbacks(): void {
  aggregateFallbacks.clear();
}

/** `Σ amounts` for a derived aggregate: exact cents, or the previous binary sum in the given order. */
export function sumCopAmounts(amounts: readonly number[], site = 'unspecified'): CopArithmeticResult {
  return copAggregate(sumExactCopCents(amounts), amounts.reduce((total, amount) => total + amount, 0), site);
}

/**
 * `Σ plus − Σ minus` for a derived balance (card debt, statement total). Exact when every amount
 * is a canonical two-decimal amount; otherwise the previous binary sums in the given order.
 */
export function differenceOfCopSums(
  plus: readonly number[],
  minus: readonly number[],
  site = 'unspecified',
): CopArithmeticResult {
  const plusCents = sumExactCopCents(plus);
  const minusCents = sumExactCopCents(minus);
  const exact = plusCents === undefined || minusCents === undefined ? undefined : fromExactCents(plusCents - minusCents);
  if (exact !== undefined) {
    return { amount: exact, path: 'exactCents' };
  }
  const binarySum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  return binaryFallback(site, binarySum(plus) - binarySum(minus));
}
