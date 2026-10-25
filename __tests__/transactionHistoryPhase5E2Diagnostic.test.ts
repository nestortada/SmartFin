import { getSQLiteTransactionHistoryPage as phase5E1 } from './helpers/transactionHistoryPhase5E1';
import { rowToTransaction } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { historyFixture, type HistoryDistribution } from './helpers/historyDistributions';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLitePrimitive } from '../src/database/sqliteRows';
import type { TransactionHistoryQuery } from '../src/modules/transactions/types/TransactionHistoryQuery';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const process = require('node:process') as { env: Record<string, string | undefined>; version: string };
const fs = require('node:fs') as { writeFileSync: (f: string, c: string) => void; mkdirSync: (p: string, o: object) => void };
const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };
const diagnostic = process.env.SMARTFIN_5E2_DIAGNOSTIC ? test : test.skip;
const base: TransactionHistoryQuery = { month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'newest' };

// Decomposes the frozen 5E.1 first page: statements, rows and engine time per shape.
diagnostic('5E.1 first-page decomposition by date distribution', async () => {
  const sizes = (process.env.SMARTFIN_5E2_SIZES ?? '1000,10000,100000').split(',').map(Number);
  const distributions = (process.env.SMARTFIN_5E2_DISTRIBUTIONS ?? 'canonicalUtc,civil,legacyDay,legacyTied,mixed')
    .split(',') as HistoryDistribution[];
  const results: object[] = [];
  for (const size of sizes) for (const distribution of distributions) {
    const fixture = await historyFixture(distribution, size);
    try {
      for (const [name, query] of [['newest', base], ['oldest', { ...base, sort: 'oldest' }],
        ['search', { ...base, search: 'merchant 49' }], ['absent', { ...base, search: 'not found' }]] as const) {
        const shapes = new Map<string, { count: number; rows: number; engineMs: number }>();
        let mapMs = 0;
        const database = new Proxy(fixture.database, { get(target, key) {
          if (key !== 'executeSql') return Reflect.get(target, key);
          return async (sql: string, values: SQLitePrimitive[] = []) => {
            const start = performance.now(); const result = fixture.query(sql, values);
            const shape = sql.replace(/\s+/g, ' ').slice(0, 90);
            const entry = shapes.get(shape) ?? { count: 0, rows: 0, engineMs: 0 };
            entry.count++; entry.rows += result.rows.length; entry.engineMs += performance.now() - start;
            shapes.set(shape, entry);
            return [result];
          };
        } }) as SmartFinSQLiteDatabase;
        const map = (row: Parameters<typeof rowToTransaction>[0]) => {
          const start = performance.now(); try { return rowToTransaction(row); } finally { mapMs += performance.now() - start; }
        };
        const start = performance.now();
        const page = await phase5E1(database, map, query);
        const totalMs = performance.now() - start;
        const list = [...shapes.entries()].map(([shape, v]) => ({ shape, ...v }));
        results.push({ size, distribution, name, totalMs, mapMs, delivered: page.transactions.length,
          legacyIds: page.nextCursor?.legacyIds?.length ?? 0,
          statements: list.reduce((s, v) => s + v.count, 0), rows: list.reduce((s, v) => s + v.rows, 0),
          engineMs: list.reduce((s, v) => s + v.engineMs, 0), shapes: list });
      }
    } finally { fixture.native.close(); }
  }
  fs.mkdirSync('docs/rendimiento-fase5e2/node', { recursive: true });
  fs.writeFileSync('docs/rendimiento-fase5e2/node/diagnostic-5e1.json',
    JSON.stringify({ runtime: process.version, results }, null, 2));
}, 600000);

// Plans and engine time of the keyset continuation inside a large tie group.
diagnostic('keyset continuation plans', async () => {
  const fixture = await historyFixture('legacyTied', 100000);
  const sortSql = "COALESCE(civil_date || 'T' || COALESCE(local_time, '00:00') || ':00.000Z', date)";
  const boundary = `AND ${sortSql} <= ? AND (${sortSql} < ?
    OR (${sortSql} = ? AND created_at < ?)
    OR (${sortSql} = ? AND created_at = ? AND rowid < ?))`;
  const after = ['2026-10-24', '2026-10-24', '2026-10-24', '2026-10-24', '2026-10-24', '2026-10-24', 50000];
  const variants: Record<string, [string, SQLitePrimitive[]]> = {
    current: [`SELECT rowid AS history_rowid, * FROM transactions INDEXED BY idx_transactions_civil_sort WHERE 1 = 1 ${boundary}
      ORDER BY ${sortSql} DESC, created_at DESC, rowid DESC LIMIT 51;`, after],
    currentOldest: [`SELECT rowid AS history_rowid, * FROM transactions INDEXED BY idx_transactions_civil_sort WHERE 1 = 1
      AND ${sortSql} >= ? AND (${sortSql} > ? OR (${sortSql} = ? AND created_at < ?) OR (${sortSql} = ? AND created_at = ? AND rowid < ?))
      ORDER BY CAST(${sortSql} AS TEXT) ASC, created_at DESC, rowid DESC LIMIT 51;`, after],
    tieGroupOnly: [`SELECT rowid AS history_rowid, * FROM transactions INDEXED BY idx_transactions_civil_sort WHERE 1 = 1
      AND ${sortSql} = ? AND created_at = ? AND rowid < ?
      ORDER BY ${sortSql} DESC, created_at DESC, rowid DESC LIMIT 51;`, ['2026-10-24', '2026-10-24', 50000]],
    firstPage: [`SELECT rowid AS history_rowid, * FROM transactions INDEXED BY idx_transactions_civil_sort WHERE 1 = 1
      ORDER BY ${sortSql} DESC, created_at DESC, rowid DESC LIMIT 51;`, []],
  };
  const out: object[] = [];
  for (const [name, [sql, values]] of Object.entries(variants)) {
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) { const start = performance.now(); fixture.query(sql, values); samples.push(performance.now() - start); }
    out.push({ name, samples, plan: fixture.native.prepare('EXPLAIN QUERY PLAN ' + sql).all(...values) });
  }
  fixture.native.close();
  fs.writeFileSync('docs/rendimiento-fase5e2/node/keyset-plans.json', JSON.stringify(out, null, 2));
}, 600000);
