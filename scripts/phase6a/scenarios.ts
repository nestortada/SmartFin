// Phase 6A dashboard monetary precision scenarios, shared by Node (Jest) and the synthetic APK.
// Amounts are written as decimal strings: the exact reference is computed from the text with
// BigInt, independently of the production double -> cents conversion.

export type Phase6ARow = {
  id: string;
  amount: string;
  type: string;
  direction: string;
  status: string;
  date: string;
  createdAt: string;
};

export type Phase6AScenario = {
  name: string;
  /** 'exact': every posted income/expense is a canonical two-decimal amount; 'legacy': it is not. */
  path: 'exact' | 'legacy';
  date: string;
  rows: Phase6ARow[];
};

const REFERENCE = Date.UTC(2026, 9, 24, 12);

/**
 * Rows without ties get strictly decreasing created_at, so the production order
 * (date DESC, created_at DESC) equals the array order.
 */
function rows(
  prefix: string,
  entries: [kind: 'income' | 'expense' | string, amount: string, status?: string][],
  options: { ties?: boolean; date?: string } = {},
): Phase6ARow[] {
  return entries.map(([kind, amount, status], index) => {
    const [type, direction] =
      kind === 'income' ? ['income', 'inflow'] : kind === 'expense' ? ['expense', 'outflow'] : kind.split('/');
    return {
      id: `${prefix}-${index + 1}`,
      amount,
      type: type!,
      direction: direction!,
      status: status ?? 'posted',
      date: options.date ?? '2026-10-24',
      createdAt: options.ties
        ? '2026-10-24T10:00:00.000Z'
        : new Date(REFERENCE - index * 1000).toISOString(),
    };
  });
}

const income = (amount: string, status?: string) => ['income', amount, status] as ['income', string, string?];
const expense = (amount: string, status?: string) => ['expense', amount, status] as ['expense', string, string?];

function multiYear(): Phase6ARow[] {
  // Three calendar years, 30 movements per month with centavos, deterministic.
  const result: Phase6ARow[] = [];
  let n = 0;
  for (let year = 2024; year <= 2026; year++)
    for (let month = 1; month <= 12; month++) {
      if (year === 2026 && month > 10) break;
      for (let i = 0; i < 30; i++) {
        n++;
        const day = String((i % 28) + 1).padStart(2, '0');
        const pesos = 1000 + ((n * 7919) % 250000);
        const cents = String((n * 37) % 100).padStart(2, '0');
        const kind = i % 6 === 0 ? 'income' : 'expense';
        result.push({
          id: `multi-${n}`,
          amount: `${kind === 'income' ? pesos * 20 : pesos}.${cents}`,
          type: kind,
          direction: kind === 'income' ? 'inflow' : 'outflow',
          status: n % 23 === 0 ? 'pending' : n % 29 === 0 ? 'cancelled' : 'posted',
          date: `${year}-${String(month).padStart(2, '0')}-${day}`,
          createdAt: new Date(Date.UTC(year, month - 1, i % 28 + 1, 12, 0, n % 60)).toISOString(),
        });
      }
    }
  return result;
}

export const PHASE6A_SCENARIOS: Phase6AScenario[] = [
  { name: 'integers', path: 'exact', date: '2026-10-24',
    rows: rows('int', [income('2500000'), income('1200000'), expense('35000'), expense('120000'), expense('48900'), expense('1500')]) },
  { name: 'halfPesos', path: 'exact', date: '2026-10-24',
    rows: rows('half', [income('1000.5'), income('2000.5'), expense('500.5'), expense('0.5')]) },
  { name: 'oneDecimal', path: 'exact', date: '2026-10-24',
    rows: rows('one', [income('0.1'), income('0.2'), expense('0.3'), expense('0.7'), expense('0.9')]) },
  // Income exact total ,50 whose binary sum rounds down.
  { name: 'incomeEndsInHalf', path: 'exact', date: '2026-10-24',
    rows: rows('inch', [income('12345.01'), income('67890.51'), income('1000.98'), expense('5000')]) },
  // Expense exact total ,50 whose binary sum rounds down.
  { name: 'expensesEndInHalf', path: 'exact', date: '2026-10-24',
    rows: rows('exph', [income('100000'), expense('45000.02'), expense('18000.19'), expense('7000.29')]) },
  // Negative savings exact -1.500,50; binary -1.500,4999...
  { name: 'negativeSavingsHalf', path: 'exact', date: '2026-10-24',
    rows: rows('negs', [income('1000.01'), income('2000.14'), expense('2250.32'), expense('2250.33')]) },
  // 5E.3 matrix without ties: income 0,05+0,15+0,30.
  { name: 'centavosNoTies', path: 'exact', date: '2026-10-24',
    rows: rows('cnt', [income('0.05'), income('0.15'), income('0.3'), expense('0.7'), expense('0.2'), expense('0.3'), expense('1.1'), expense('0.05'), expense('0.15')]) },
  // Same amounts tied on date and created_at: production sums in rowid order.
  { name: 'centavosTies', path: 'exact', date: '2026-10-24',
    rows: rows('tie', [income('0.05'), income('0.15'), income('0.3'), expense('0.7'), expense('0.2'), expense('0.3'), expense('1.1'), expense('0.05'), expense('0.15')], { ties: true }) },
  // 5E.2 reproduction: 1.000 tied rows of 1 or 1,1 (pending rows excluded).
  { name: 'fractionalTies1000', path: 'exact', date: '2026-10-24',
    rows: rows('load', Array.from({ length: 1000 }, (_, i) => [(i + 1) % 4 === 0 ? 'income' : 'expense', (i + 1) % 3 === 0 ? '1.1' : '1', (i + 1) % 10 === 9 ? 'pending' : 'posted'] as [string, string, string]), { ties: true }) },
  // Stored negative amounts (not produced by current flows) keep their sign.
  { name: 'negativeStoredAmounts', path: 'exact', date: '2026-10-24',
    rows: rows('negamt', [income('-0.1'), income('0.65'), income('-1200.35'), expense('-0.05'), expense('0.1'), expense('-0.5')]) },
  // Cancelled, pending, refund, transfers and card payments stay outside income/expense.
  { name: 'cancellationsAndRefunds', path: 'exact', date: '2026-10-24',
    rows: rows('cr', [income('1500.25'), income('0.25', 'cancelled'), income('99.99', 'pending'), expense('700.1'), expense('0.4', 'cancelled'),
      ['refund/inflow', '300.33'], ['internalTransfer/outflow', '1000.01'], ['internalTransfer/inflow', '1000.01'], ['creditCardPayment/outflow', '250.5'],
      expense('199.65')]) },
  // Sub-cent amounts (possible through AI fields or legacy data): previous binary sum is kept.
  { name: 'subCentAmounts', path: 'legacy', date: '2026-10-24',
    rows: rows('sub', [income('0.1'), income('0.2'), income('0.005'), expense('1.234'), expense('0.3')]) },
  // At or beyond 2^46 COP distinct cents share a double: previous binary sum is kept.
  { name: 'ambiguousMagnitude', path: 'legacy', date: '2026-10-24',
    rows: rows('amb', [income('70368744177664.5'), income('0.1'), expense('0.2')]) },
  // Total cents beyond Number.MAX_SAFE_INTEGER: previous binary sum is kept.
  { name: 'unsafeTotal', path: 'legacy', date: '2026-10-24',
    rows: rows('ovf', [income('70000000000000.01'), income('70000000000000.02'), expense('0.1')]) },
  { name: 'multiYearCentavos', path: 'exact', date: '2026-10-24', rows: multiYear() },
];

/** Exact cents of a decimal string with at most two decimals (BigInt, no doubles). */
export function decimalCents(text: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw Error(`Not a two-decimal amount: ${text}`);
  const cents = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0');
  return match[1] ? -cents : cents;
}

export function centsText(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** Exact decimal reference for one month, following the dashboard predicates. */
export function exactMonthlyReference(scenario: Phase6AScenario, yearMonth = scenario.date.slice(0, 7)) {
  const posted = scenario.rows.filter(r => r.status === 'posted' && r.date.startsWith(yearMonth));
  const total = (type: string, direction: string) =>
    posted.filter(r => r.type === type && r.direction === direction).reduce((t, r) => t + decimalCents(r.amount), 0n);
  const incomeCents = total('income', 'inflow');
  const expenseCents = total('expense', 'outflow');
  return { income: incomeCents, expenses: expenseCents, savings: incomeCents - expenseCents };
}

export const PHASE6A_INSERT_SQL = `INSERT INTO transactions(id, amount, currency, description, date, account_id, type, direction, status, created_at, updated_at)
  VALUES (?, ?, 'COP', 'Synthetic 6A', ?, 'bank', ?, ?, ?, ?, ?)`;

export const phase6aRowValues = (row: Phase6ARow) => [
  row.id, Number(row.amount), row.date, row.type, row.direction, row.status, row.createdAt, row.createdAt,
];
