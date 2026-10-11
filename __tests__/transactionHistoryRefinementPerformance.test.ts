import { getSQLiteTransactionHistoryPage as before } from './helpers/transactionHistoryPhase3';
import { getSQLiteTransactionHistoryPage as after, getSQLiteTransactionMonths } from '../src/modules/transactions/repositories/sqliteTransactionHistory';
import { rowToTransaction, createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { dashboardFixture, insertSyntheticHistory } from './helpers/dashboardFixture';
import { baselineHistory } from './helpers/transactionHistoryBaseline';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLitePrimitive } from '../src/database/sqliteRows';
import type { TransactionHistoryQuery } from '../src/modules/transactions/types/TransactionHistoryQuery';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const process = require('node:process') as {
  env: Record<string, string | undefined>; version: string;
  memoryUsage: () => { heapUsed: number };
};
const fs = require('node:fs') as { writeFileSync: (file: string, content: string) => void };
const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };
const benchmark = process.env.SMARTFIN_HISTORY_REFINEMENT ? test : test.skip;
const base: TransactionHistoryQuery = { month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'newest' };

benchmark('phase 3 vs 3.1: same sequential interactions and cold connection per sample', async () => {
  const results: object[] = [];
  const gc = (globalThis as unknown as { gc?: () => void }).gc;
  for (const size of [1000, 10000, 100000]) {
    const fixture = await dashboardFixture(); insertSyntheticHistory(fixture, size);
    try {
      const reference = await createSqliteTransactionRepository(fixture.database).getTransactions();
      const modes = process.env.SMARTFIN_HISTORY_REFINEMENT === 'before' ? ['before'] : ['before', 'after'];
      for (let sample = -2; sample < 5; sample++) for (const mode of sample % 2 ? modes : [...modes].reverse()) {
        const queries: { sql: string; rows: number; milliseconds: number }[] = [];
        const database = new Proxy(fixture.database, { get(target, key) {
          if (key !== 'executeSql') return Reflect.get(target, key);
          return async (sql: string, values: SQLitePrimitive[] = []) => {
            const start = performance.now(); const result = fixture.query(sql, values);
            queries.push({ sql, rows: result.rows.length, milliseconds: performance.now() - start });
            return [result];
          };
        } }) as SmartFinSQLiteDatabase;
        const run = mode === 'before' ? before : after;
        for (const [name, query] of [
          ['initial', base],
          ['combinedFilters', { ...base, month: '2024-02', accountId: 'bank', categoryId: 'cat_expense' }],
          ['oldSearch', { ...base, search: 'merchant 49' }],
          ['absentSearch', { ...base, search: 'not found' }],
          ['absentExtension', { ...base, search: 'not found extended' }],
          ['reset', base],
        ] as const) {
          gc?.(); const heap = process.memoryUsage().heapUsed; const index = queries.length;
          const start = performance.now();
          const page = await run(database, rowToTransaction, query);
          if (name === 'initial') await getSQLiteTransactionMonths(database);
          const milliseconds = performance.now() - start;
          const heapDeltaBytes = process.memoryUsage().heapUsed - heap;
          const expected = baselineHistory(reference, query.month, query.accountId, query.categoryId, query.search, query.sort).slice(0, 50);
          expect(page.transactions).toEqual(expected);
          if (sample >= 0) results.push({ size, mode, sample, name, milliseconds, heapDeltaBytes,
            retained: page.transactions.length, returnedRows: queries.slice(index).reduce((sum, q) => sum + q.rows, 0),
            queries: queries.slice(index), exact: true });
        }
      }
      // Identify whether index traversal or text predicates dominate misses.
      const values: SQLitePrimitive[] = ['not found', 'not found', 'not found'];
      const predicate = ['merchant_name', 'description', 'notes'].map(col =>
        `(instr(lower(${col}), ?) > 0 OR ${col} GLOB '*[^ -~]*' OR instr(${col}, char(0)) > 0)`).join(' OR ');
      const plans = [];
      for (const variant of ['glob', 'byteLength']) for (const access of ['INDEXED BY idx_transactions_date', 'NOT INDEXED']) {
        const textPredicate = variant === 'glob' ? predicate : ['merchant_name', 'description', 'notes'].map(col =>
          `(instr(lower(${col}), ?) > 0 OR length(CAST(${col} AS BLOB)) <> length(${col}))`).join(' OR ');
        const sql = `SELECT 1 FROM transactions ${access} WHERE ${textPredicate} LIMIT 1;`;
        const samples = [];
        for (let i = 0; i < 5; i++) { const start = performance.now(); fixture.query(sql, values); samples.push(performance.now() - start); }
        plans.push({ variant, access, samples, plan: fixture.native.prepare('EXPLAIN QUERY PLAN ' + sql).all(...values) });
      }
      results.push({ size, plans });
    } finally { fixture.native.close(); }
  }
  fs.writeFileSync(`docs/performance/transactions-phase31/node-${process.env.SMARTFIN_HISTORY_REFINEMENT}.json`,
    JSON.stringify({ runtime: process.version, warmups: 2, samples: 5, gcAvailable: !!gc, results }, null, 2));
}, 180000);
