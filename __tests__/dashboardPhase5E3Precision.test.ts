import { getDashboardSummaryFromDb } from '../src/modules/dashboard/useCases/getDashboardSummary';
import { getBaselineDashboardSummaryFromDb } from './helpers/dashboardSummaryBaseline';
import { dashboardFixture } from './helpers/dashboardFixture';
import { PERSONAL_AMOUNT_SQL } from '../src/modules/transactions/repositories/sharedFinancialProjectionSql';
import { TRANSACTION_DAY_SQL } from '../src/shared/utils/transactionDate';
import { formatCurrency } from '../src/shared/utils/formatCurrency';

// Phase 5E.3 decision matrix for the dashboard decimal discrepancy. Diagnostic
// only: production order and amounts are not changed, no tolerance is applied.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
const process = require('node:process') as { env: Record<string, string | undefined>; version: string };
const fs = require('node:fs') as { writeFileSync: (f: string, c: string) => void; mkdirSync: (p: string, o: object) => void };
const DATE = new Date('2026-10-24T12:00:00.000Z');
type Row = { id: string; amount: number; income: boolean; createdAt: string; status?: string };

// Rows are inserted in array order, so rowid follows the array index.
const SCENARIOS: Record<string, Row[]> = {
  // 5E.2 reproduction: 1000 rows, same date and created_at, 1.1 or 1.
  fractionalTies1000: Array.from({ length: 1000 }, (_, i) => ({ id: `load-${i + 1}`, amount: (i + 1) % 3 === 0 ? 1.1 : 1,
    income: (i + 1) % 4 === 0, createdAt: '2026-10-24', status: (i + 1) % 10 === 9 ? 'pending' : 'posted' })),
  // Same shape with whole pesos: every order is exact.
  integerTies1000: Array.from({ length: 1000 }, (_, i) => ({ id: `int-${i + 1}`, amount: ((i % 7) + 1) * 1000,
    income: (i + 1) % 4 === 0, createdAt: '2026-10-24' })),
  // Centavos whose exact total ends in ,50: the order decides the displayed peso.
  centavosDisplayFlip: [
    ...[0.05, 0.15, 0.3].map((amount, i) => ({ id: `inc-${i}`, amount, income: true, createdAt: '2026-10-24T10:00:00.000Z' })),
    ...[0.7, 0.2, 0.3, 1.1, 0.05, 0.15].map((amount, i) => ({ id: `exp-${i}`, amount, income: false, createdAt: '2026-10-24T10:00:00.000Z' })),
  ],
  // Same amounts with distinct created_at: the order is fully determined.
  centavosNoTies: [
    ...[0.05, 0.15, 0.3].map((amount, i) => ({ id: `inc-${i}`, amount, income: true, createdAt: `2026-10-24T10:00:0${i}.000Z` })),
    ...[0.7, 0.2, 0.3, 1.1, 0.05, 0.15].map((amount, i) => ({ id: `exp-${i}`, amount, income: false, createdAt: `2026-10-24T11:00:0${i}.000Z` })),
  ],
  // Realistic magnitudes with centavos, 10k rows in one day.
  largeCentavosTies10000: Array.from({ length: 10000 }, (_, i) => ({ id: `big-${i + 1}`, amount: (100000 + ((i * 7919) % 100000)) / 100,
    income: i % 5 === 0, createdAt: '2026-10-24' })),
};

const ORDERS = {
  rowidAsc: 'date DESC, created_at DESC, rowid ASC',
  rowidDesc: 'date DESC, created_at DESC, rowid DESC',
  idAsc: 'date DESC, created_at DESC, id ASC',
} as const;

// Exact decimal reference: every fixture amount has at most two decimals.
function exactCents(values: number[]) {
  return values.reduce((total, value) => {
    const cents = Math.round(value * 100);
    expect(cents / 100).toBe(value);
    return total + BigInt(cents);
  }, 0n);
}
const centsText = (cents: bigint) => `${cents < 0n ? '-' : ''}${(cents < 0n ? -cents : cents) / 100n}.${String((cents < 0n ? -cents : cents) % 100n).padStart(2, '0')}`;
const fields = (income: number, expenses: number) => ({ monthlyIncome: income, monthlyExpenses: expenses, monthlySavings: income - expenses });
const display = (summary: Record<string, number>) => Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, formatCurrency(v, 'COP')]));

async function evaluate(name: string, rows: Row[]) {
  const fixture = await dashboardFixture();
  try {
    const insert = fixture.native.prepare(`INSERT INTO transactions(id, amount, currency, description, date, account_id, type, direction, status, created_at, updated_at)
      VALUES (?, ?, 'COP', 'Synthetic', '2026-10-24', 'bank', ?, ?, ?, ?, ?)`);
    for (const row of rows) insert.run(row.id, row.amount, row.income ? 'income' : 'expense', row.income ? 'inflow' : 'outflow', row.status ?? 'posted', row.createdAt, row.createdAt);
    const current = await getDashboardSummaryFromDb(fixture.database, DATE);
    const historical = await getBaselineDashboardSummaryFromDb(fixture.database, DATE);
    const where = `WHERE ${TRANSACTION_DAY_SQL} >= '2026-10' AND ${TRANSACTION_DAY_SQL} < '2026-11' AND status = 'posted'
      AND substr(${TRANSACTION_DAY_SQL}, 1, 7) = '2026-10' AND ((type = 'income' AND direction = 'inflow') OR (type = 'expense' AND direction = 'outflow'))`;
    const currentSql = `SELECT id, type, ${PERSONAL_AMOUNT_SQL} AS amount FROM transactions ${where} ORDER BY date DESC, created_at DESC`;
    const sumOrder = (sql: string) => {
      const ordered = fixture.native.prepare(sql).all() as { id: string; type: string; amount: number }[];
      const income = ordered.filter(r => r.type === 'income').reduce((t, r) => t + r.amount, 0);
      const expenses = ordered.filter(r => r.type === 'expense').reduce((t, r) => t + r.amount, 0);
      return { summary: fields(income, expenses), firstIds: ordered.slice(0, 3).map(r => r.id) };
    };
    const explicit = Object.fromEntries(Object.entries(ORDERS).map(([order, tail]) =>
      [order, sumOrder(`SELECT id, type, ${PERSONAL_AMOUNT_SQL} AS amount FROM transactions ${where} ORDER BY ${tail}`)]));
    const posted = rows.filter(r => (r.status ?? 'posted') === 'posted');
    const income = exactCents(posted.filter(r => r.income).map(r => r.amount));
    const expenses = exactCents(posted.filter(r => !r.income).map(r => r.amount));
    const exact = { monthlyIncome: centsText(income), monthlyExpenses: centsText(expenses), monthlySavings: centsText(income - expenses) };
    const pick = (s: typeof current) => fields(s.monthlyIncome, s.monthlyExpenses);
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const matches = (summary: Record<string, number>) => Object.entries(explicit).filter(([, v]) => same(v.summary, summary)).map(([k]) => k);
    // Savings is income minus expenses in both implementations.
    expect(current.monthlySavings).toBe(current.monthlyIncome - current.monthlyExpenses);
    expect(historical.monthlySavings).toBe(historical.monthlyIncome - historical.monthlyExpenses);
    // Fields outside the monthly sums never depend on transaction order.
    for (const key of ['availableBalance', 'totalDebt', 'netWorth', 'recentTransactionCount'] as const) expect(current[key]).toBe(historical[key]);
    return {
      name, rows: rows.length,
      plan: (fixture.native.prepare('EXPLAIN QUERY PLAN ' + currentSql).all() as { detail: string }[]).map(r => r.detail),
      exactDecimal: exact,
      current: { summary: pick(current), display: display(pick(current)), equalsExplicit: matches(pick(current)) },
      historical: { summary: pick(historical), display: display(pick(historical)), equalsExplicit: matches(pick(historical)) },
      explicit: Object.fromEntries(Object.entries(explicit).map(([k, v]) => [k, { ...v, display: display(v.summary) }])),
      binaryEqual: same(pick(current), pick(historical)),
      displayEqual: same(display(pick(current)), display(pick(historical))),
      unaffected: { availableBalance: current.availableBalance, totalDebt: current.totalDebt, netWorth: current.netWorth, recentTransactionCount: current.recentTransactionCount },
    };
  } finally { fixture.native.close(); }
}

test('5E.3 dashboard precision matrix: order dependence is binary, displayed peso can flip at ,50', async () => {
  const results: Awaited<ReturnType<typeof evaluate>>[] = [];
  for (const [name, rows] of Object.entries(SCENARIOS)) results.push(await evaluate(name, rows));
  const get = (name: string) => { const found = results.find(r => r.name === name); if (!found) throw Error(name); return found; };
  // 5E.2 reproduction: same figures as documented, current = rowid ASC, historical = rowid DESC.
  expect(get('fractionalTies1000').current.summary.monthlyIncome).toBe(258.2999999999997);
  expect(get('fractionalTies1000').historical.summary.monthlyIncome).toBe(258.29999999999967);
  expect(get('fractionalTies1000').current.equalsExplicit).toContain('rowidAsc');
  expect(get('fractionalTies1000').historical.equalsExplicit).toContain('rowidDesc');
  expect(get('fractionalTies1000').displayEqual).toBe(true);
  // Whole pesos: every order gives the same exact value.
  expect(get('integerTies1000').binaryEqual).toBe(true);
  expect(new Set(Object.values(get('integerTies1000').explicit).map(v => JSON.stringify((v as { summary: unknown }).summary))).size).toBe(1);
  // Without ties every order coincides.
  expect(get('centavosNoTies').binaryEqual).toBe(true);
  // Exact totals ending in ,50 with ties: the displayed peso follows the order.
  expect(get('centavosDisplayFlip').displayEqual).toBe(false);
  expect(get('centavosDisplayFlip').current.equalsExplicit).toContain('rowidAsc');
  // Independent of order: binary 0.49999999999999994 displays $0 for an exact 0,50.
  expect(get('centavosNoTies').current.summary.monthlyIncome).toBe(0.49999999999999994);
  expect(get('centavosNoTies').current.display.monthlyIncome).toBe(formatCurrency(0, 'COP'));
  if (process.env.SMARTFIN_5E3_DIAGNOSTIC) {
    fs.mkdirSync('docs/aceptacion-fase5e3/node', { recursive: true });
    fs.writeFileSync('docs/aceptacion-fase5e3/node/dashboard-precision.json', JSON.stringify({ runtime: process.version, date: DATE.toISOString(), results }, null, 2));
  }
});
