import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { dashboardFixture, insertSyntheticHistory } from './helpers/dashboardFixture';
import { baselineHistory } from './helpers/transactionHistoryBaseline';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLitePrimitive } from '../src/database/sqliteRows';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const process = require('node:process') as {
  env: Record<string, string | undefined>; version: string; platform: string;
  memoryUsage: () => { heapUsed: number };
};
const fs = require('node:fs') as { writeFileSync: (file: string, content: string) => void };
const { Buffer } = require('node:buffer') as { Buffer: { byteLength: (value: string) => number } };
const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };
const benchmark = process.env.SMARTFIN_HISTORY_BENCHMARK ? test : test.skip;

benchmark('history before/after on identical isolated SQLite fixtures', async () => {
  const results: object[] = [];
  const gc = (globalThis as unknown as { gc?: () => void }).gc;
  for (const size of [1000, 10000, 100000]) {
    const fixture = await dashboardFixture();
    insertSyntheticHistory(fixture, size);
    try {
      const reference = await createSqliteTransactionRepository(fixture.database).getTransactions();
      const plans = new Map<string, object>();
      const modes = process.env.SMARTFIN_HISTORY_BENCHMARK === 'before' ? ['before'] : ['before', 'after'];
      for (const mode of modes) {
        for (const search of ['', 'merchant 49', 'never found']) {
          const samples: object[] = [];
          for (let sample = 0; sample < 5; sample++) {
            gc?.();
            let rows = 0;
            let queries = 0;
            const database = new Proxy(fixture.database, {
              get(target, key) {
                if (key !== 'executeSql') return Reflect.get(target, key);
                return async (sql: string, values: SQLitePrimitive[] = []) => {
                  const result = fixture.query(sql, values);
                  rows += result.rows.length;
                  queries++;
                  if (sample === 0 && !plans.has(sql)) plans.set(sql, { sql, values,
                    plan: fixture.native.prepare('EXPLAIN QUERY PLAN ' + sql).all(...values) });
                  return [result];
                };
              },
            }) as SmartFinSQLiteDatabase;
            const repo = createSqliteTransactionRepository(database);
            const heapBefore = process.memoryUsage().heapUsed;
            const start = performance.now();
            const output = mode === 'before'
              ? baselineHistory(await repo.getTransactions(), 'all', 'all', 'all', search)
              : await optimized(repo, search);
            samples.push({ milliseconds: performance.now() - start, returnedRows: rows, queries,
              heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore, retainedTransactions: output.length,
              retainedJsonBytes: Buffer.byteLength(JSON.stringify(output)), });
            const expected = baselineHistory(reference, 'all', 'all', 'all', search);
            expect(output).toEqual(mode === 'before' ? expected : expected.slice(0, 50));
          }
          results.push({ size, mode, search, samples, exact: true, plans: [...plans.values()] });
        }
      }
    } finally { fixture.native.close(); }
  }
  fs.writeFileSync(`docs/performance/transactions-phase3/${process.env.SMARTFIN_HISTORY_BENCHMARK}.json`,
    JSON.stringify({ runtime: process.version, gcAvailable: !!gc, platform: process.platform, results }, null, 2));
}, 120000);

async function optimized(repo: ReturnType<typeof createSqliteTransactionRepository>, search: string) {
  const [page] = await Promise.all([
    repo.getTransactionPage({ month: 'all', accountId: 'all', categoryId: 'all', search, sort: 'newest' }),
    repo.getTransactionMonths(),
  ]);
  return page.transactions;
}
