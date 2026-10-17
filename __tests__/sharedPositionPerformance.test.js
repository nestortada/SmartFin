const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const { performance } = require('node:perf_hooks');
const { sharedPositionVolume } = require('./helpers/sharedPositionVolume');
const { DASHBOARD_DATE } = require('./helpers/dashboardFixture');
const {
  getDashboardSummaryFromDb: before,
} = require('./helpers/dashboardSharedStateBaseline');
const {
  getDashboardSummaryFromDb: after,
} = require('../src/modules/dashboard/useCases/getDashboardSummary');
jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(),
}));
const median = values =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
test('same financial results and synthetic 100k ledger before/after for every shared volume', async () => {
  const report = {
    runtime: process.version,
    platform: process.platform,
    gcAvailable: Boolean(global.gc),
    warmups: 3,
    samples: 7,
    bankMovements: 100000,
    entries: [],
  };
  for (const size of [0, 100, 1000, 5000]) {
    const fixture = await sharedPositionVolume(size);
    try {
      expect(fixture.native.prepare('PRAGMA foreign_key_check').all()).toEqual(
        [],
      );
      const expected = await before(fixture.database, DASHBOARD_DATE);
      const traceBefore = fixture.native
        .prepare('SELECT count(*) AS n FROM transactions')
        .all();
      for (const [version, summarize] of [
        ['before', before],
        ['after', after],
      ]) {
        let queries = [];
        let peak = 0;
        let memoryStart = 0;
        const database = new Proxy(fixture.database, {
          get(target, key) {
            if (key !== 'executeSql') return Reflect.get(target, key);
            return async (sql, values = []) => {
              const result = fixture.query(sql, values);
              peak = Math.max(peak, process.memoryUsage().heapUsed);
              queries.push({
                sql,
                values,
                rows: result.rows.length,
                bytes: Buffer.byteLength(JSON.stringify(result.rows.raw())),
              });
              return [result];
            };
          },
        });
        for (let i = 0; i < 3; i++) await summarize(database, DASHBOARD_DATE);
        const milliseconds = [];
        const heap = [];
        for (let i = 0; i < 7; i++) {
          global.gc?.();
          queries = [];
          memoryStart = process.memoryUsage().heapUsed;
          peak = memoryStart;
          const start = performance.now();
          const actual = await summarize(database, DASHBOARD_DATE);
          milliseconds.push(performance.now() - start);
          peak = Math.max(peak, process.memoryUsage().heapUsed);
          heap.push(peak - memoryStart);
          expect(actual).toEqual(expected);
        }
        report.entries.push({
          size,
          version,
          medianMs: median(milliseconds),
          milliseconds,
          queries: queries.length,
          returnedRows: queries.reduce((n, q) => n + q.rows, 0),
          returnedBytes: queries.reduce((n, q) => n + q.bytes, 0),
          medianSampledHeapGrowthBytes: median(heap),
          heapSamples: heap,
          summary: expected,
          statements: queries.map(q => ({
            ...q,
            plan: fixture.native
              .prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
              .all(...q.values),
          })),
        });
      }
      expect(
        fixture.native.prepare('SELECT count(*) AS n FROM transactions').all(),
      ).toEqual(traceBefore);
    } finally {
      fixture.native.close();
    }
  }
  fs.mkdirSync('docs/performance/shared-position', { recursive: true });
  fs.writeFileSync(
    'docs/performance/shared-position/node-comparison.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      report.entries.map(
        ({
          size,
          version,
          medianMs,
          queries,
          returnedRows,
          returnedBytes,
          medianSampledHeapGrowthBytes,
        }) => ({
          size,
          version,
          medianMs,
          queries,
          returnedRows,
          returnedBytes,
          medianSampledHeapGrowthBytes,
        }),
      ),
      null,
      2,
    ),
  );
}, 180000);
