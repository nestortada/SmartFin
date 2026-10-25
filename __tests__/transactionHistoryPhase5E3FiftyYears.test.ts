import { getSQLiteTransactionHistoryPage as current } from '../src/modules/transactions/repositories/sqliteTransactionHistory';
import { rowToTransaction } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { getDashboardSummaryFromDb } from '../src/modules/dashboard/useCases/getDashboardSummary';
import { getBaselineDashboardSummaryFromDb } from './helpers/dashboardSummaryBaseline';
import { historyFixture } from './helpers/historyDistributions';
import { FIFTY_YEAR_SHAPES, fiftyYearStatements, type FiftyYearShape } from './helpers/historyFiftyYears';
import { baselineHistory } from './helpers/transactionHistoryBaseline';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLiteRow } from '../src/database/sqliteRows';
import type { Transaction } from '../src/modules/transactions/types';
import type { TransactionHistoryPage, TransactionHistoryQuery } from '../src/modules/transactions/types/TransactionHistoryQuery';

// Phase 5E.3 acceptance volume: 100,000 movements spread over 50 years
// (AGENTS.md "Performance Volumes"). Exact oracle traversal and timings.
const process = require('node:process') as { env: Record<string, string | undefined> };
const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
const LARGE = process.env.SMARTFIN_5E3_LARGE === '1';
const all: TransactionHistoryQuery = { month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'newest' };
const FILTERS: Partial<TransactionHistoryQuery>[] = [
  {}, { sort: 'oldest' }, { search: 'merchant 49' }, { search: 'árbol' }, { search: 'İω', sort: 'oldest' },
  { search: 'not found' }, { month: '2026-10', accountId: 'savings' }, { month: '1999-02', accountId: 'bank', categoryId: 'food', search: '%_', sort: 'oldest' },
];

async function fiftyYearFixture(shape: FiftyYearShape, size: number) {
  const fixture = await historyFixture('legacyDay', size);
  for (const statement of fiftyYearStatements(shape)) fixture.native.exec(statement);
  return fixture;
}
type Fixture = Awaited<ReturnType<typeof fiftyYearFixture>>;

function oracle(fixture: Fixture) {
  const rows = fixture.native.prepare('SELECT rowid AS history_rowid, * FROM transactions').all() as SQLiteRow[];
  const key = (row: SQLiteRow) => row.civil_date ? `${row.civil_date}T${row.local_time ?? '00:00'}:00.000Z` : String(row.date);
  const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  rows.sort((a, b) => cmp(key(b), key(a)) || cmp(String(b.created_at), String(a.created_at)) || Number(b.history_rowid) - Number(a.history_rowid));
  const transactions = rows.map(rowToTransaction);
  const byId = new Map(transactions.map(tx => [tx.id, tx]));
  const normalized = transactions.map(tx => ({ ...tx, date: tx.civilDate ? `${tx.civilDate}T${tx.localTime ?? '00:00'}:00.000Z` : tx.date }));
  return (q: TransactionHistoryQuery): Transaction[] => baselineHistory(normalized, q.month, q.accountId, q.categoryId, q.search, q.sort).map(tx => byId.get(tx.id)!);
}

async function traverse(database: SmartFinSQLiteDatabase, query: TransactionHistoryQuery, want: Transaction[]) {
  let page: TransactionHistoryPage = await current(database, rowToTransaction, query);
  const seen = new Set<string>();
  let total = 0;
  for (;;) {
    expect(page.transactions).toEqual(want.slice(total, total + page.transactions.length));
    for (const tx of page.transactions) { expect(seen.has(tx.id)).toBe(false); seen.add(tx.id); }
    total += page.transactions.length;
    if (!page.nextCursor) break;
    page = await current(database, rowToTransaction, query, page.nextCursor);
  }
  expect(total).toBe(want.length);
  return total;
}

test.each(FIFTY_YEAR_SHAPES)('50-year %s shape: density and keyset path', async shape => {
  const fixture = await fiftyYearFixture(shape, 1000);
  try {
    const span = fixture.native.prepare("SELECT min(COALESCE(civil_date, substr(date,1,10))) AS a, max(COALESCE(civil_date, substr(date,1,10))) AS b FROM transactions").all()[0] as { a: string; b: string };
    expect(span.a >= '1976-10-26' && span.b <= '2026-10-25').toBe(true);
    const expected = oracle(fixture);
    for (const filter of FILTERS) await traverse(fixture.database, { ...all, ...filter }, expected({ ...all, ...filter }));
    const first = await current(fixture.database, rowToTransaction, all);
    expect(first.nextCursor?.legacyIds).toBeUndefined();
  } finally { fixture.native.close(); }
});

(LARGE ? test.each(FIFTY_YEAR_SHAPES) : test.skip.each(FIFTY_YEAR_SHAPES))('100k over 50 years, %s: every page exact, timings and dashboard', async shape => {
  const fixture = await fiftyYearFixture(shape, 100000);
  try {
    const density = fixture.native.prepare(`SELECT count(*) AS n, count(DISTINCT COALESCE(civil_date, substr(date,1,10))) AS days,
      sum(substr(COALESCE(civil_date, date),1,7) = '2026-10') AS october FROM transactions`).all()[0];
    const expected = oracle(fixture);
    const timings: Record<string, object> = {};
    for (const filter of FILTERS) {
      const query = { ...all, ...filter };
      // Cold first and second page: a proxy is a new connection identity (no cached proof).
      const samples = [];
      for (let i = 0; i < 4; i++) {
        const cold = new Proxy(fixture.database, {}) as SmartFinSQLiteDatabase;
        let start = performance.now();
        const first = await current(cold, rowToTransaction, query);
        const firstMs = performance.now() - start;
        start = performance.now();
        if (first.nextCursor) await current(cold, rowToTransaction, query, first.nextCursor);
        if (i) samples.push({ firstMs: Math.round(firstMs * 10) / 10, secondMs: Math.round((performance.now() - start) * 10) / 10 });
      }
      const start = performance.now();
      const total = await traverse(fixture.database, query, expected(query));
      timings[JSON.stringify(filter)] = { total, samples, traversalMs: Math.round(performance.now() - start) };
    }
    const date = new Date('2026-10-24T12:00:00.000Z');
    const dashboard = [];
    for (let i = 0; i < 4; i++) {
      const start = performance.now();
      const summary = await getDashboardSummaryFromDb(fixture.database, date);
      if (i) dashboard.push(Math.round((performance.now() - start) * 10) / 10);
      expect(summary.monthlySavings).toBe(summary.monthlyIncome - summary.monthlyExpenses - summary.monthlyNetLosses);
    }
    const baseline = await getBaselineDashboardSummaryFromDb(fixture.database, date);
    const currentSummary = await getDashboardSummaryFromDb(fixture.database, date);
    const differences = (['monthlyIncome', 'monthlyExpenses', 'availableBalance', 'totalDebt', 'netWorth', 'recentTransactionCount'] as const)
      .filter(k => currentSummary[k] !== baseline[k]).map(k => ({ k, current: currentSummary[k], baseline: baseline[k] }));
    console.log(JSON.stringify({ shape, density, timings, dashboardMs: dashboard, dashboardDifferences: differences }));
  } finally { fixture.native.close(); }
}, 1800000);
