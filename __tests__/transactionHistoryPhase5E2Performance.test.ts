import { getSQLiteTransactionHistoryPage as phase5E1 } from './helpers/transactionHistoryPhase5E1';
import { getSQLiteTransactionHistoryPage as phase5E2 } from '../src/modules/transactions/repositories/sqliteTransactionHistory';
import { rowToTransaction } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { historyFixture, type HistoryDistribution } from './helpers/historyDistributions';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLitePrimitive } from '../src/database/sqliteRows';
import type { TransactionHistoryQuery } from '../src/modules/transactions/types/TransactionHistoryQuery';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const process = require('node:process') as { env: Record<string, string | undefined>; version: string;
  memoryUsage: () => { heapUsed: number } };
const fs = require('node:fs') as { writeFileSync: (f: string, c: string) => void; mkdirSync: (p: string, o: object) => void };
const os = require('node:os') as { cpus: () => { model: string }[]; totalmem: () => number; platform: () => string };
const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };
const benchmark = process.env.SMARTFIN_5E2_BENCHMARK ? test : test.skip;
const base: TransactionHistoryQuery = { month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'newest' };
const CASES: [string, TransactionHistoryQuery][] = [
  ['newest', base],
  ['oldest', { ...base, sort: 'oldest' }],
  ['search49', { ...base, search: 'merchant 49' }],
  ['unicode', { ...base, search: 'árbol' }],
  ['absent', { ...base, search: 'not found' }],
  ['combined', { ...base, month: '2024-02', accountId: 'bank', categoryId: 'food', search: '%_', sort: 'oldest' }],
];

// Same data, cold proof cache per sample (new connection identity), alternating
// version order. The frozen 5E.1 adapter is the comparator; every sample checks
// that both first pages and second pages are identical.
benchmark('5E.1 vs 5E.2 history first and second page', async () => {
  const sizes = (process.env.SMARTFIN_5E2_SIZES ?? '1000,10000,100000').split(',').map(Number);
  const distributions = (process.env.SMARTFIN_5E2_DISTRIBUTIONS
    ?? 'canonicalUtc,civil,legacyDay,legacyTied,legacyWithCivil,legacyWithInvalid,mixed').split(',') as HistoryDistribution[];
  const gc = (globalThis as unknown as { gc?: () => void }).gc;
  const results: object[] = [];
  for (const size of sizes) for (const distribution of distributions) {
    const fixture = await historyFixture(distribution, size);
    const warmups = 1;
    const samples = size >= 100000 ? 3 : 5;
    try {
      for (const [name, query] of CASES) {
        for (let sample = -warmups; sample < samples; sample++) {
          const order = sample % 2 === 0 ? ['5E.1', '5E.2'] : ['5E.2', '5E.1'];
          const pages: Record<string, unknown> = {};
          for (const version of order) {
            const run = version === '5E.1' ? phase5E1 : phase5E2;
            let statements = 0; let rows = 0; let engineMs = 0;
            const database = new Proxy(fixture.database, { get(target, key) {
              if (key !== 'executeSql') return Reflect.get(target, key);
              return async (sql: string, values: SQLitePrimitive[] = []) => {
                const start = performance.now(); const result = fixture.query(sql, values);
                engineMs += performance.now() - start; statements++; rows += result.rows.length;
                return [result];
              };
            } }) as SmartFinSQLiteDatabase;
            gc?.(); const heap = process.memoryUsage().heapUsed;
            const start = performance.now();
            const first = await run(database, rowToTransaction, query);
            const firstMs = performance.now() - start;
            const firstStatements = statements; const firstRows = rows; const firstEngine = engineMs;
            const heapDeltaBytes = process.memoryUsage().heapUsed - heap;
            const secondStart = performance.now();
            const second = first.nextCursor ? await run(database, rowToTransaction, query, first.nextCursor) : undefined;
            const secondMs = first.nextCursor ? performance.now() - secondStart : undefined;
            pages[version] = [first.transactions, second?.transactions];
            if (sample >= 0) results.push({ size, distribution, name, version, sample, firstMs, firstStatements,
              firstRows, firstEngineMs: firstEngine, secondMs, secondStatements: statements - firstStatements,
              secondRows: rows - firstRows, heapDeltaBytes, legacyIds: first.nextCursor?.legacyIds?.length ?? 0,
              delivered: first.transactions.length });
          }
          expect(pages['5E.2']).toEqual(pages['5E.1']);
        }
      }
    } finally { fixture.native.close(); }
  }
  fs.mkdirSync('docs/rendimiento-fase5e2/node', { recursive: true });
  fs.writeFileSync(process.env.SMARTFIN_5E2_OUTPUT ?? 'docs/rendimiento-fase5e2/node/history-benchmark.json',
    JSON.stringify({ runtime: process.version, platform: os.platform(), cpu: os.cpus()[0]?.model, totalMemory: os.totalmem(),
      gcAvailable: !!gc, warmups: 1, samples: '5 (1k/10k), 3 (100k)', results }, null, 2));
}, 3600000);
