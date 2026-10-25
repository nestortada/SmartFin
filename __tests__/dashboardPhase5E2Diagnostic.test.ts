import { getDashboardSummaryFromDb } from '../src/modules/dashboard/useCases/getDashboardSummary';
import { getBaselineDashboardSummaryFromDb } from './helpers/dashboardSummaryBaseline';
import { dashboardFixture } from './helpers/dashboardFixture';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLitePrimitive } from '../src/database/sqliteRows';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
const process = require('node:process') as { env: Record<string, string | undefined>; version: string };
const fs = require('node:fs') as { writeFileSync: (f: string, c: string) => void; mkdirSync: (p: string, o: object) => void };
const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };
const diagnostic = process.env.SMARTFIN_5E2_DASHBOARD ? test : test.skip;
// Phase 5E integrated acceptance date: every synthetic load row is "today".
const DATE = new Date('2026-10-24T12:00:00.000Z');

const LOADS = {
  // 5E integrated load: YYYY-MM-DD equal to the current day, posted expense of 1.
  integratedToday: "'2026-10-24'",
  // Same legacy format spread over three years (current month is ~1/36 of rows).
  legacySpread: "date('2023-10-25', '+' || ((n * 37) % 1096) || ' days')",
  // Canonical UTC instants spread the same way.
  canonicalSpread: "strftime('%Y-%m-%dT%H:%M:%f', date('2023-10-25', '+' || ((n * 37) % 1096) || ' days'), '+' || (n % 86400) || ' seconds') || 'Z'",
} as const;

function label(sql: string) {
  if (sql.includes('FROM accounts')) return 'accounts';
  if (sql.includes('personal_amount')) return 'monthlyAmounts';
  if (sql.includes('COUNT(*) AS count')) return 'recentDayCounts';
  if (sql.includes('receivable_minor')) return 'sharedPosition';
  if (sql.includes('recovery_reversals')) return 'lossPeriod';
  return sql.replace(/\s+/g, ' ').slice(0, 60);
}

diagnostic('dashboard decomposition: current vs frozen baseline, same SQLite data', async () => {
  const results: object[] = [];
  for (const size of [1000, 10000, 100000]) for (const [load, date] of Object.entries(LOADS)) {
    const fixture = await dashboardFixture();
    fixture.native.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${size})
      INSERT INTO transactions(id, amount, currency, description, date, account_id, type, direction, status, created_at, updated_at)
      SELECT 'load-' || n, CASE WHEN n % 3 = 0 THEN 1.1 ELSE 1 END, 'COP', 'Synthetic historical load', ${date}, 'bank',
        CASE WHEN n % 4 = 0 THEN 'income' ELSE 'expense' END, CASE WHEN n % 4 = 0 THEN 'inflow' ELSE 'outflow' END,
        CASE WHEN n % 10 = 9 THEN 'pending' ELSE 'posted' END, '2026-10-24', '2026-10-24' FROM seq;`);
    try {
      for (let sample = -1; sample < 5; sample++) for (const version of sample % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
        const shapes: Record<string, { count: number; rows: number; engineMs: number; awaitMs: number }> = {};
        const database = new Proxy(fixture.database, { get(target, key) {
          if (key !== 'executeSql') return Reflect.get(target, key);
          return async (sql: string, values: SQLitePrimitive[] = []) => {
            const start = performance.now(); const result = fixture.query(sql, values);
            const engineMs = performance.now() - start;
            const entry = shapes[label(sql)] ??= { count: 0, rows: 0, engineMs: 0, awaitMs: 0 };
            entry.count++; entry.rows += result.rows.length; entry.engineMs += engineMs;
            await Promise.resolve();
            entry.awaitMs += performance.now() - start;
            return [result];
          };
        } }) as SmartFinSQLiteDatabase;
        const start = performance.now();
        const summary = version === 'current'
          ? await getDashboardSummaryFromDb(database, DATE)
          : await getBaselineDashboardSummaryFromDb(database, DATE);
        const totalMs = performance.now() - start;
        if (sample >= 0) results.push({ size, load, version, sample, totalMs, shapes,
          summary: { availableBalance: summary.availableBalance, totalDebt: summary.totalDebt, netWorth: summary.netWorth,
            monthlyIncome: summary.monthlyIncome, monthlyExpenses: summary.monthlyExpenses,
            monthlySavings: summary.monthlySavings, recentTransactionCount: summary.recentTransactionCount } });
      }
      const current = await getDashboardSummaryFromDb(fixture.database, DATE);
      const baseline = await getBaselineDashboardSummaryFromDb(fixture.database, DATE);
      // No shared expenses exist here. Record exact differences; never tolerate them.
      const differences = Object.entries(baseline).filter(([key, value]) => key !== 'modules'
        && JSON.stringify(value) !== JSON.stringify((current as Record<string, unknown>)[key]))
        .map(([key, value]) => ({ key, baseline: value, current: (current as Record<string, unknown>)[key] }));
      // Summation order: amounts in each version's SQL order, and the same amounts by rowid.
      const amounts = (sql: string) => { const r = fixture.query(sql); return Array.from({ length: r.rows.length }, (_, i) => Number(r.rows.item(i)?.amount)); };
      const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
      const monthIncome = "type = 'income' AND direction = 'inflow' AND status = 'posted' AND substr(COALESCE(civil_date, substr(date, 1, 10)), 1, 7) = '2026-10'";
      const order = {
        currentQueryOrder: sum(amounts(`SELECT amount FROM transactions WHERE COALESCE(civil_date, substr(date, 1, 10)) >= '2026-10' AND COALESCE(civil_date, substr(date, 1, 10)) < '2026-11' AND status = 'posted' AND ${monthIncome} ORDER BY date DESC, created_at DESC`)),
        baselineQueryOrder: sum(amounts(`SELECT amount FROM transactions WHERE ${monthIncome} AND rowid IN (SELECT rowid FROM transactions ORDER BY date DESC, created_at DESC) ORDER BY date DESC, created_at DESC`)),
        rowidAsc: sum(amounts(`SELECT amount FROM transactions WHERE ${monthIncome} ORDER BY rowid ASC`)),
        rowidDesc: sum(amounts(`SELECT amount FROM transactions WHERE ${monthIncome} ORDER BY rowid DESC`)),
      };
      results.push({ size, load, exactEqual: differences.length === 0, differences, order });
    } finally { fixture.native.close(); }
  }
  fs.mkdirSync('docs/rendimiento-fase5e2/node', { recursive: true });
  fs.writeFileSync('docs/rendimiento-fase5e2/node/dashboard-diagnostic.json', JSON.stringify({ runtime: process.version, date: DATE, results }, null, 2));
}, 1800000);
