import type { DashboardSummary } from '../../src/modules/dashboard/types/DashboardSummary';
import { PERSONAL_AMOUNT_SQL } from '../../src/modules/transactions/repositories/sharedFinancialProjectionSql';
import { TRANSACTION_DAY_SQL } from '../../src/shared/utils/transactionDate';

// Phase 6A contract oracle, independent of the production conversion: an amount is exact
// when its shortest round-trip text has at most two decimals and |amount| < 2^46 COP;
// a figure is exact when all of its amounts are and its cent total is a safe integer.
// Otherwise the figure must equal the frozen reference passed by the caller.

const LIMIT_CENTS = 2n ** 46n * 100n;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function cents(amount: number): bigint | undefined {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount));
  if (!match) return undefined;
  const value = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0');
  if (value >= LIMIT_CENTS) return undefined;
  return match[1] ? -value : value;
}

function total(amounts: number[]): bigint | undefined {
  let sum = 0n;
  for (const amount of amounts) {
    const value = cents(amount);
    if (value === undefined) return undefined;
    sum += value;
    if (sum > SAFE || sum < -SAFE) return undefined;
  }
  return sum;
}

const toAmount = (value: bigint) => Number(value) / 100;

type MonthlyRow = { type: string; amount: number };

/** Rows of the dashboard monthly query (same predicates, personal amounts). */
export function phase6AMonthlyRows(
  native: { prepare: (sql: string) => { all: (yearMonth: string) => unknown[] } },
  yearMonth: string,
): MonthlyRow[] {
  return native.prepare(`SELECT type, ${PERSONAL_AMOUNT_SQL} AS amount FROM transactions
    WHERE status = 'posted' AND substr(${TRANSACTION_DAY_SQL}, 1, 7) = ?
      AND ((type = 'income' AND direction = 'inflow') OR (type = 'expense' AND direction = 'outflow'))`).all(yearMonth) as MonthlyRow[];
}

export function phase6AExpectedSummary(reference: DashboardSummary, rows: MonthlyRow[]): DashboardSummary {
  const income = total(rows.filter(r => r.type === 'income').map(r => r.amount));
  const expenses = total(rows.filter(r => r.type === 'expense').map(r => r.amount));
  const netLoss = cents(reference.monthlyNetLosses);
  const savings = income === undefined || expenses === undefined || netLoss === undefined ? undefined : income - expenses - netLoss;
  return {
    ...reference,
    monthlyIncome: income === undefined ? reference.monthlyIncome : toAmount(income),
    monthlyExpenses: expenses === undefined ? reference.monthlyExpenses : toAmount(expenses),
    monthlySavings: savings === undefined || savings > SAFE || savings < -SAFE ? reference.monthlySavings : toAmount(savings),
  };
}
