import { getDashboardSummaryFromDb, getDashboardSummary } from '../src/modules/dashboard/useCases/getDashboardSummary';
import { getDashboardSummaryFromDbPre6A, getDashboardSummaryPre6A } from './helpers/dashboardSummaryPrePhase6A';
import { dashboardFixture } from './helpers/dashboardFixture';
import { sharedExpenseFixture, SHARED_TEST_DATE } from './helpers/sharedExpenseFixture';
import { formatCurrency } from '../src/shared/utils/formatCurrency';
import { parseCopAmountDraft } from '../src/shared/utils/copAmountInput';
import { toMinor } from '../src/modules/transactions/useCases/sharedExpenseDomain';
import {
  MAX_EXACT_COP_CENTS_AMOUNT,
  sumExactCopCents,
  toExactCopCents,
} from '../src/shared/utils/exactCopCents';
import {
  PHASE6A_INSERT_SQL,
  PHASE6A_SCENARIOS,
  centsText,
  decimalCents,
  exactMonthlyReference,
  phase6aRowValues,
} from '../scripts/phase6a/scenarios';
import type { DashboardSummary } from '../src/modules/dashboard/types/DashboardSummary';
import { phase6AExpectedSummary, phase6AMonthlyRows } from './helpers/phase6AExpectedSummary';
import { realSQLite } from './helpers/realSQLite';
import { REPRESENTATIVE_REFERENCE_DAY, representativeSeedStatements, type RepresentativeSize } from './helpers/representativeHistory';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { TRANSACTION_DAY_SQL } from '../src/shared/utils/transactionDate';

// Phase 6A: monthly income, expenses and savings accumulate exact cents when every amount
// is the canonical double of a two-decimal COP amount below 2^46. Otherwise the previous
// binary accumulation is kept unchanged. No tolerance is applied anywhere in this file.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
const process = require('node:process') as { env: Record<string, string | undefined>; version: string; versions: Record<string, string> };
const fs = require('node:fs') as { writeFileSync: (f: string, c: string) => void; mkdirSync: (p: string, o: object) => void };

const DATE = new Date('2026-10-24T12:00:00.000Z');
const MONTHLY = ['monthlyIncome', 'monthlyExpenses', 'monthlySavings'] as const;
const UNAFFECTED = ['availableBalance', 'totalDebt', 'netWorth', 'recentTransactionCount', 'monthlyForgivenessLosses',
  'monthlyLossReversals', 'monthlyLossRecoveries', 'monthlyRecoveryReversals', 'monthlyNetLosses'] as const;

/** Exact decimal expansion of a finite double (every binary fraction is a finite decimal). */
function exactDouble(value: number): string {
  if (Object.is(value, -0)) return '-0';
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const negative = bits / 2n ** 63n === 1n;
  const exponent = Number((bits / 2n ** 52n) % 2048n);
  let mantissa = bits % 2n ** 52n;
  if (exponent !== 0) mantissa += 2n ** 52n;
  const power = (exponent === 0 ? 1 : exponent) - 1075;
  let text: string;
  if (power >= 0) text = (mantissa * 2n ** BigInt(power)).toString();
  else {
    // mantissa / 2^-power = mantissa * 5^-power / 10^-power
    const digits = (mantissa * 5n ** BigInt(-power)).toString().padStart(-power + 1, '0');
    text = `${digits.slice(0, power)}.${digits.slice(power)}`.replace(/\.?0+$/, '');
  }
  return (negative ? '-' : '') + text;
}

/** Exact difference a - b of two decimal strings, as a decimal string. */
function decimalDifference(a: string, b: string): string {
  const scale = Math.max((a.split('.')[1] ?? '').length, (b.split('.')[1] ?? '').length);
  const toInt = (s: string) => {
    const negative = s.startsWith('-');
    const [whole, fraction = ''] = s.replace('-', '').split('.');
    const value = BigInt(whole + fraction.padEnd(scale, '0'));
    return negative ? -value : value;
  };
  const diff = toInt(a) - toInt(b);
  const abs = (diff < 0n ? -diff : diff).toString().padStart(scale + 1, '0');
  const text = scale ? `${abs.slice(0, -scale)}.${abs.slice(-scale)}`.replace(/\.?0+$/, '') : abs;
  return (diff < 0n ? '-' : '') + text;
}

const exactFormat = new Intl.NumberFormat('es-CO', { currency: 'COP', maximumFractionDigits: 0, minimumFractionDigits: 0, style: 'currency' });

function compare(previous: DashboardSummary, next: DashboardSummary, exact?: Record<(typeof MONTHLY)[number], bigint>) {
  return Object.fromEntries(MONTHLY.map(field => {
    const expected = exact ? centsText(exact[field]) : undefined;
    return [field, {
      previous: exactDouble(previous[field]),
      expectedDecimal: expected,
      next: exactDouble(next[field]),
      difference: decimalDifference(exactDouble(next[field]), exactDouble(previous[field])),
      previousDisplay: formatCurrency(previous[field], 'COP'),
      nextDisplay: formatCurrency(next[field], 'COP'),
      visibleChange: formatCurrency(previous[field], 'COP') !== formatCurrency(next[field], 'COP'),
    }];
  }));
}

describe('exact COP cents conversion', () => {
  test('every two-decimal amount up to ±20.000,00 converts back to its exact cents', () => {
    const mismatches: number[] = [];
    for (let cents = -2_000_000; cents <= 2_000_000; cents++) {
      const abs = Math.abs(cents);
      const text = `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
      // Number(text) is how the input parser builds the stored double.
      if (!Object.is(toExactCopCents(Number(text)), cents + 0)) mismatches.push(cents);
    }
    expect(mismatches).toEqual([]);
  });

  test('boundaries of every magnitude and of 2^46 convert exactly', () => {
    const edges: bigint[] = [];
    for (let power = 2; power <= 15; power++) edges.push(10n ** BigInt(power));
    for (let power = 30; power <= 46; power++) edges.push(2n ** BigInt(power) * 100n);
    const limit = BigInt(MAX_EXACT_COP_CENTS_AMOUNT) * 100n;
    let checked = 0;
    const mismatches: string[] = [];
    for (const edge of edges)
      for (let delta = -2000n; delta <= 2000n; delta++)
        for (const sign of [1n, -1n]) {
          const cents = sign * (edge + delta);
          if ((cents < 0n ? -cents : cents) >= limit) continue;
          if (toExactCopCents(Number(centsText(cents))) !== Number(cents)) mismatches.push(cents.toString());
          checked++;
        }
    expect(mismatches).toEqual([]);
    expect(checked).toBeGreaterThan(100000);
  });

  test('deterministic sample of the whole admitted domain below 2^46 converts exactly', () => {
    let state = 0x6a6a6a6an;
    const limit = BigInt(MAX_EXACT_COP_CENTS_AMOUNT) * 100n;
    const mismatches: string[] = [];
    for (let i = 0; i < 300000; i++) {
      state = (state * 6364136223846793005n + 1442695040888963407n) % 18446744073709551616n;
      const cents = (state / 2048n) % limit * (i % 2 ? -1n : 1n);
      const value = Number(centsText(cents));
      if (toExactCopCents(value) !== Number(cents)) mismatches.push(cents.toString());
      // Same result as the decimal-text conversion already used by shared expenses.
      if (cents > 0n && toMinor(value) !== Number(cents)) mismatches.push(`toMinor ${cents}`);
    }
    expect(mismatches).toEqual([]);
  });

  test('the UI parser output is always recovered exactly below 2^46', () => {
    for (const text of ['0,01', '0,40', '0,5', '1.234.567,89', '-1.500,50', '9.999.999.999.999,99', '70.368.744.177.663,99'])
      expect(toExactCopCents(parseCopAmountDraft(text))).toBe(Number(decimalCents(text.replace(/\./g, '').replace(',', '.'))));
  });

  test('values that are not canonical two-decimal amounts are rejected, never rounded', () => {
    for (const value of [0.005, 1.234, 0.1 + 0.2, 2.4999999999999996, 0.49999999999999994, 1 / 3,
      NaN, Infinity, -Infinity, MAX_EXACT_COP_CENTS_AMOUNT, -MAX_EXACT_COP_CENTS_AMOUNT, 70368744177664.5, 9e15])
      expect(toExactCopCents(value)).toBeUndefined();
    expect(Object.is(toExactCopCents(-0), 0)).toBe(true);
    // Distinct cents share a double from 2^46 COP on: the stored value no longer identifies them.
    expect(Number('70368744177664.01')).toBe(Number('70368744177664.02'));
  });

  test('sums reject any non-conforming element and any unsafe total', () => {
    expect(sumExactCopCents([0.1, 0.2])).toBe(30);
    expect(sumExactCopCents([])).toBe(0);
    expect(sumExactCopCents([0.1, 0.005])).toBeUndefined();
    expect(sumExactCopCents([70000000000000.01, 70000000000000.02])).toBeUndefined();
  });
});

async function evaluate(scenario: (typeof PHASE6A_SCENARIOS)[number]) {
  const fixture = await dashboardFixture();
  try {
    const insert = fixture.native.prepare(PHASE6A_INSERT_SQL);
    for (const row of scenario.rows) insert.run(...phase6aRowValues(row));
    const previous = await getDashboardSummaryFromDbPre6A(fixture.database, DATE);
    const next = await getDashboardSummaryFromDb(fixture.database, DATE);
    return { previous, next };
  } finally {
    fixture.native.close();
  }
}

test('6A scenario matrix: exact path equals the decimal reference; legacy path is bit-identical', async () => {
  const report: unknown[] = [];
  for (const scenario of PHASE6A_SCENARIOS) {
    const { previous, next } = await evaluate(scenario);
    const exact = scenario.path === 'exact' ? exactMonthlyReference(scenario) : { income: 0n, expenses: 0n, savings: 0n };
    for (const key of UNAFFECTED) expect(Object.is(next[key], previous[key])).toBe(true);
    if (scenario.path === 'exact') {
      expect(next.monthlyIncome).toBe(Number(centsText(exact.income)));
      expect(next.monthlyExpenses).toBe(Number(centsText(exact.expenses)));
      expect(next.monthlySavings).toBe(Number(centsText(exact.savings)));
      // Display always follows the exact decimal.
      for (const [field, cents] of [['monthlyIncome', exact.income], ['monthlyExpenses', exact.expenses], ['monthlySavings', exact.savings]] as const)
        expect(formatCurrency(next[field], 'COP')).toBe(exactFormat.format(centsText(cents) as unknown as number));
      // Where the previous binary result already was the exact decimal, nothing changes.
      for (const field of MONTHLY)
        if (previous[field] === Number(centsText(exact[field.replace('monthly', '').toLowerCase() as 'income']))) expect(Object.is(next[field], previous[field])).toBe(true);
    } else {
      for (const field of MONTHLY) expect(Object.is(next[field], previous[field])).toBe(true);
    }
    report.push({ scenario: scenario.name, path: scenario.path, rows: scenario.rows.length, fields: compare(previous, next, scenario.path === 'exact' ? {
      monthlyIncome: exact.income, monthlyExpenses: exact.expenses, monthlySavings: exact.savings } : undefined),
      unaffected: Object.fromEntries(UNAFFECTED.map(key => [key, next[key]])) });
  }
  type Field = { visibleChange: boolean; expectedDecimal?: string; previous: string };
  const changed = (report as { scenario: string; fields: Record<string, Field> }[])
    .flatMap(r => Object.entries(r.fields).filter(([, v]) => v.visibleChange).map(([field, v]) => ({ name: `${r.scenario}.${field}`, ...v })));
  // A visible change only happens where the exact total ends in ,50 and the binary one did not.
  for (const field of changed) {
    expect(field.expectedDecimal).toMatch(/\.50$/);
    expect(field.previous).not.toMatch(/\.5$/);
  }
  // Observed with the V8/ICU of this Node (the same family as HONOR API 35).
  expect(changed.map(field => field.name).sort()).toEqual([
    'centavosNoTies.monthlyExpenses',
    'centavosTies.monthlyExpenses',
    'expensesEndInHalf.monthlyExpenses',
    'incomeEndsInHalf.monthlyIncome',
    'incomeEndsInHalf.monthlySavings',
    'negativeSavingsHalf.monthlySavings',
  ]);
  if (process.env.SMARTFIN_6A_EVIDENCE) {
    fs.mkdirSync('docs/precision-fase6a/node', { recursive: true });
    fs.writeFileSync('docs/precision-fase6a/node/scenarios.json', JSON.stringify({ runtime: process.version, icu: process.versions.icu, date: DATE.toISOString(), report }, null, 2));
  }
});

test('6A multi-year history: every month equals the decimal reference', async () => {
  const scenario = PHASE6A_SCENARIOS.find(s => s.name === 'multiYearCentavos')!;
  const fixture = await dashboardFixture();
  try {
    const insert = fixture.native.prepare(PHASE6A_INSERT_SQL);
    for (const row of scenario.rows) insert.run(...phase6aRowValues(row));
    let changedInternal = 0;
    const months = [...new Set(scenario.rows.map(r => r.date.slice(0, 7)))];
    for (const month of months) {
      const date = new Date(`${month}-15T17:00:00.000Z`);
      const previous = await getDashboardSummaryFromDbPre6A(fixture.database, date);
      const next = await getDashboardSummaryFromDb(fixture.database, date);
      const exact = exactMonthlyReference(scenario, month);
      expect(next.monthlyIncome).toBe(Number(centsText(exact.income)));
      expect(next.monthlyExpenses).toBe(Number(centsText(exact.expenses)));
      expect(next.monthlySavings).toBe(Number(centsText(exact.savings)));
      for (const key of UNAFFECTED) expect(Object.is(next[key], previous[key])).toBe(true);
      if (MONTHLY.some(field => !Object.is(next[field], previous[field]))) changedInternal++;
    }
    expect(months).toHaveLength(34);
    expect(changedInternal).toBeGreaterThan(0);
  } finally {
    fixture.native.close();
  }
});

test('6A shared expense with centavos, forgiveness and income keep their semantics', async () => {
  const f = await sharedExpenseFixture();
  try {
    const created = await f.api.createPurchase('purchase-cents', {
      purchase: { accountId: 'bank', amount: 30000.15, categoryId: 'food', merchantName: 'Restaurante', operationType: 'Débito',
        occurrence: { kind: 'date', date: '2026-10-05' } },
      distribution: { mode: 'amounts', personalAmount: 15000.07, participants: [{ contactId: f.contactId, amount: 15000.08 }] },
    });
    const overview = await f.api.getExpense(created.entityId);
    await f.api.forgiveParticipation('forgive-cents', { participationId: overview.participants[0]!.participationId, amount: 1000.01, date: '2026-10-06' });
    for (const amount of [0.05, 0.15, 0.3]) await f.save({ transactionType: 'income', amount, merchantName: 'Ingreso', operationType: 'Débito' });
    await f.save({ amount: 2250.33 });
    const previous = await getDashboardSummaryFromDbPre6A(f.database, SHARED_TEST_DATE);
    const next = await getDashboardSummaryFromDb(f.database, SHARED_TEST_DATE);
    // Personal part only (15.000,07) plus the plain expense; forgiveness stays a separate loss.
    expect(next).toMatchObject({ monthlyIncome: 0.5, monthlyExpenses: 17250.4, monthlyForgivenessLosses: 1000.01,
      monthlyNetLosses: 1000.01, monthlySavings: Number(centsText(50n - 1725040n - 100001n)) });
    for (const key of UNAFFECTED) expect(Object.is(next[key], previous[key])).toBe(true);
    f.verifyForeignKeys();
    if (process.env.SMARTFIN_6A_EVIDENCE) {
      fs.mkdirSync('docs/precision-fase6a/node', { recursive: true });
      fs.writeFileSync('docs/precision-fase6a/node/shared.json', JSON.stringify(compare(previous, next, {
        monthlyIncome: 50n, monthlyExpenses: 1725040n, monthlySavings: 50n - 1725040n - 100001n }), null, 2));
    }
  } finally {
    f.native.close();
  }
});

test('6A synchronous mock path keeps its figures (whole pesos are already exact)', () => {
  for (const currentDate of [new Date(2026, 9, 10, 12), new Date(2026, 0, 15, 12)]) {
    const previous = getDashboardSummaryPre6A({ currentDate });
    const next = getDashboardSummary({ currentDate });
    expect(next).toEqual(previous);
    for (const field of MONTHLY) expect(Object.is(next[field], previous[field])).toBe(true);
  }
});

// Representative histories (1k/6 months, 10k/5 years, 100k/50 calendar years), month by month.
// The "centavos" profile rewrites amounts of the same dated history to two decimals: a
// separate amount distribution, not a volume benchmark. 100k runs with SMARTFIN_6A_EVIDENCE.
async function representativeMonths(size: RepresentativeSize, centavos: boolean) {
  const sql = realSQLite();
  sql.native.exec('PRAGMA foreign_keys=ON');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  for (const statement of representativeSeedStatements(size)) sql.native.exec(statement);
  if (centavos) sql.native.exec("UPDATE transactions SET amount = amount + ((rowid * 7919) % 100) / 100.0 WHERE id LIKE 'rep-%'");
  try {
    const months = (sql.native.prepare(`SELECT DISTINCT substr(${TRANSACTION_DAY_SQL},1,7) AS m FROM transactions ORDER BY m`).all() as { m: string }[]).map(r => r.m);
    const totals = { size, profile: centavos ? 'centavos' : 'representative', months: months.length, identical: 0, internalChange: 0, visibleChange: 0 };
    const visible: unknown[] = [];
    for (const month of months) {
      const date = new Date(`${month}-15T17:00:00.000Z`);
      const previous = await getDashboardSummaryFromDbPre6A(sql.database, date);
      const next = await getDashboardSummaryFromDb(sql.database, date);
      expect(next).toEqual(phase6AExpectedSummary(previous, phase6AMonthlyRows(sql.native, month)));
      for (const key of UNAFFECTED) expect(Object.is(next[key], previous[key])).toBe(true);
      const changed = MONTHLY.filter(field => !Object.is(next[field], previous[field]));
      if (!changed.length) totals.identical++;
      else totals.internalChange++;
      const shown = changed.filter(field => formatCurrency(next[field], 'COP') !== formatCurrency(previous[field], 'COP'));
      if (shown.length) {
        totals.visibleChange++;
        visible.push({ month, fields: compare(previous, next) });
      }
    }
    return { ...totals, visible };
  } finally {
    sql.native.close();
  }
}

test('6A representative histories: whole/half pesos unchanged, centavos equal the exact decimal', async () => {
  const sizes: RepresentativeSize[] = process.env.SMARTFIN_6A_EVIDENCE ? [1000, 10000, 100000] : [1000, 10000];
  const results = [];
  for (const size of sizes) for (const centavos of [false, true]) results.push(await representativeMonths(size, centavos));
  for (const r of results) if (r.profile === 'representative') expect(r.identical).toBe(r.months);
  if (process.env.SMARTFIN_6A_EVIDENCE) {
    fs.mkdirSync('docs/precision-fase6a/node', { recursive: true });
    fs.writeFileSync('docs/precision-fase6a/node/representative.json', JSON.stringify({ runtime: process.version, icu: process.versions.icu, results }, null, 2));
  }
}, 900000);

// Dashboard cost on the representative histories, alternating implementations; evidence only
// (timings are not asserted). Run with SMARTFIN_6A_BENCHMARK=1.
(process.env.SMARTFIN_6A_BENCHMARK ? test : test.skip)('6A dashboard timing on representative histories', async () => {
  const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };
  const results = [];
  for (const size of [1000, 10000, 100000] as RepresentativeSize[]) {
    const sql = realSQLite();
    for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
    await applyVersionedMigrations(sql.database);
    for (const statement of representativeSeedStatements(size)) sql.native.exec(statement);
    const date = new Date(`${REPRESENTATIVE_REFERENCE_DAY}T17:00:00.000Z`);
    const runs = { next: [] as number[], previous: [] as number[] };
    let next = await getDashboardSummaryFromDb(sql.database, date);
    let previous = await getDashboardSummaryFromDbPre6A(sql.database, date);
    for (let i = 0; i < 21; i++)
      for (const name of (i % 2 ? ['previous', 'next'] : ['next', 'previous']) as ('next' | 'previous')[]) {
        const start = performance.now();
        const summary = await (name === 'next' ? getDashboardSummaryFromDb : getDashboardSummaryFromDbPre6A)(sql.database, date);
        runs[name].push(performance.now() - start);
        if (name === 'next') next = summary; else previous = summary;
      }
    expect(next).toEqual(previous);
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    results.push({ size, medianMs: { next: median(runs.next), previous: median(runs.previous) }, runs });
    sql.native.close();
  }
  fs.mkdirSync('docs/precision-fase6a/node', { recursive: true });
  fs.writeFileSync('docs/precision-fase6a/node/performance.json', JSON.stringify({ runtime: process.version, results }, null, 2));
}, 900000);
