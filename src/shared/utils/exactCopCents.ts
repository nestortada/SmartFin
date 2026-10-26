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
