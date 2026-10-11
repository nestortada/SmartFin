import { getDashboardSummaryFromDb } from '../src/modules/dashboard/useCases/getDashboardSummary';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLitePrimitive } from '../src/database/sqliteRows';
import { getBaselineDashboardSummaryFromDb } from './helpers/dashboardSummaryBaseline';
import {
  DASHBOARD_DATE,
  dashboardFixture,
  insertSyntheticHistory,
} from './helpers/dashboardFixture';

jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(),
}));

const nodeProcess = require('node:process') as {
  env: Record<string, string | undefined>;
  version: string;
  platform: string;
  arch: string;
  memoryUsage: () => { heapUsed: number };
};
const { performance } = require('node:perf_hooks') as {
  performance: { now: () => number };
};
const { Buffer } = require('node:buffer') as {
  Buffer: { byteLength: (value: string, encoding: string) => number };
};
const benchmark = nodeProcess.env.SMARTFIN_DASHBOARD_BENCHMARK
  ? test
  : test.skip;
const median = (values: number[]) =>
  [...values].sort((left, right) => left - right)[
    Math.floor(values.length / 2)
  ] ?? 0;

benchmark(
  'reproducible SQLite dashboard benchmark',
  async () => {
    const gc = (globalThis as unknown as { gc?: () => void }).gc;
    const entries: object[] = [];
    const versions =
      nodeProcess.env.SMARTFIN_DASHBOARD_BENCHMARK === 'baseline'
        ? { before: getBaselineDashboardSummaryFromDb }
        : {
            before: getBaselineDashboardSummaryFromDb,
            after: getDashboardSummaryFromDb,
          };
    for (const size of [1000, 10000, 100000]) {
      const fixture = await dashboardFixture();
      insertSyntheticHistory(fixture, size);
      try {
        const expected = await getBaselineDashboardSummaryFromDb(
          fixture.database,
          DASHBOARD_DATE,
        );
        for (const [version, summarize] of Object.entries(versions)) {
          let queries = 0;
          let rows = 0;
          let sqlMilliseconds = 0;
          let heapPeak = 0;
          let sampleMemory = false;
          const statements: {
            sql: string;
            values: SQLitePrimitive[];
            rows: number;
            bytes: number;
            plan: unknown;
          }[] = [];
          let capture = false;
          const database: SmartFinSQLiteDatabase = new Proxy(fixture.database, {
            get(target, key) {
              if (key !== 'executeSql') return Reflect.get(target, key);
              return async (sql: string, values: SQLitePrimitive[] = []) => {
                const start = performance.now();
                const result = fixture.query(sql, values);
                sqlMilliseconds += performance.now() - start;
                queries += 1;
                rows += result.rows.length;
                if (sampleMemory)
                  heapPeak = Math.max(
                    heapPeak,
                    nodeProcess.memoryUsage().heapUsed,
                  );
                if (capture)
                  statements.push({
                    sql,
                    values,
                    rows: result.rows.length,
                    bytes: Buffer.byteLength(
                      JSON.stringify(result.rows.raw()),
                      'utf8',
                    ),
                    plan: fixture.native
                      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
                      .all(...values),
                  });
                return [result];
              };
            },
          });
          for (let warmup = 0; warmup < 3; warmup += 1)
            await summarize(database, DASHBOARD_DATE);
          const latencies: number[] = [];
          const sqlLatencies: number[] = [];
          for (let iteration = 0; iteration < 7; iteration += 1) {
            gc?.();
            queries = 0;
            rows = 0;
            sqlMilliseconds = 0;
            const start = performance.now();
            const actual = await summarize(database, DASHBOARD_DATE);
            latencies.push(performance.now() - start);
            sqlLatencies.push(sqlMilliseconds);
            expect(actual).toEqual(expected);
          }
          const memory: number[] = [];
          if (gc) {
            sampleMemory = true;
            for (let iteration = 0; iteration < 3; iteration += 1) {
              gc();
              const before = nodeProcess.memoryUsage().heapUsed;
              heapPeak = before;
              await summarize(database, DASHBOARD_DATE);
              heapPeak = Math.max(heapPeak, nodeProcess.memoryUsage().heapUsed);
              memory.push(heapPeak - before);
            }
            sampleMemory = false;
          }
          queries = 0;
          rows = 0;
          capture = true;
          expect(await summarize(database, DASHBOARD_DATE)).toEqual(expected);
          entries.push({
            size,
            version,
            queries,
            returnedRows: rows,
            returnedTransactionRows: statements
              .filter(statement => statement.sql.includes('FROM transactions'))
              .reduce((total, statement) => total + statement.rows, 0),
            returnedJsonBytes: statements.reduce(
              (total, statement) => total + statement.bytes,
              0,
            ),
            medianMilliseconds: median(latencies),
            medianSqlMilliseconds: median(sqlLatencies),
            sampledHeapDeltaBytes: gc ? median(memory) : null,
            latencies,
            sqlLatencies,
            memory,
            summary: expected,
            statements,
          });
        }
      } finally {
        await fixture.database.close();
      }
    }
    const report = {
      node: nodeProcess.version,
      platform: nodeProcess.platform,
      architecture: nodeProcess.arch,
      sqlite: 'node:sqlite / DatabaseSync',
      sqliteVersion: (() => {
        const sql = require('node:sqlite') as {
          DatabaseSync: new (path: string) => {
            prepare: (sql: string) => { get: () => unknown };
            close: () => void;
          };
        };
        const database = new sql.DatabaseSync(':memory:');
        const version = database
          .prepare('SELECT sqlite_version() AS version')
          .get();
        database.close();
        return version;
      })(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      currentDate: '2026-10-10 local noon',
      gcAvailable: Boolean(gc),
      warmups: 3,
      iterations: 7,
      memoryIterations: 3,
      timer: 'node:perf_hooks.performance.now',
      hardware: (() => {
        const os = require('node:os') as {
          cpus: () => { model: string }[];
          totalmem: () => number;
        };
        return {
          cpu: os.cpus()[0]?.model,
          logicalProcessors: os.cpus().length,
          totalMemoryBytes: os.totalmem(),
        };
      })(),
      entries,
    };
    const fs = require('node:fs') as {
      mkdirSync: (path: string, options: { recursive: boolean }) => void;
      writeFileSync: (path: string, value: string) => void;
    };
    fs.mkdirSync('docs/performance', { recursive: true });
    const name =
      nodeProcess.env.SMARTFIN_DASHBOARD_BENCHMARK === 'baseline'
        ? 'baseline'
        : 'comparison';
    fs.writeFileSync(
      `docs/performance/dashboard-phase2-${name}.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      JSON.stringify(
        entries.map(entry => {
          const metrics = entry as Record<string, unknown>;
          return Object.fromEntries(
            [
              'size',
              'version',
              'queries',
              'returnedRows',
              'returnedTransactionRows',
              'returnedJsonBytes',
              'medianMilliseconds',
              'medianSqlMilliseconds',
              'sampledHeapDeltaBytes',
            ].map(key => [key, metrics[key]]),
          );
        }),
        null,
        2,
      ),
    );
  },
  120000,
);
