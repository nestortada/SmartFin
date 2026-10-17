'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const node_fs_1 = require('node:fs');
const node_buffer_1 = require('node:buffer');
const node_perf_hooks_1 = require('node:perf_hooks');
const sharedPositionVolume_1 = require('./helpers/sharedPositionVolume');
const dashboardFixture_1 = require('./helpers/dashboardFixture');
const dashboardBeforeForgiveness_1 = require('./helpers/dashboardBeforeForgiveness');
const getDashboardSummary_1 = require('../src/modules/dashboard/useCases/getDashboardSummary');
const sharedFinancialTotalsBeforeForgiveness_1 = require('./helpers/sharedFinancialTotalsBeforeForgiveness');
const sharedFinancialTotalsSql_1 = require('../src/modules/transactions/repositories/sharedFinancialTotalsSql');
const sqliteSharedExpenseRepository_1 = require('../src/modules/transactions/repositories/sqliteSharedExpenseRepository');
const sharedExpenseDomain_1 = require('../src/modules/transactions/useCases/sharedExpenseDomain');
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const median = values =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const benchmark =
  process.env.SMARTFIN_FORGIVENESS_PERF === '1' ? test : test.skip;
benchmark(
  'synthetic 100k ledger: optimized dashboard before, after empty journal and after populated journal',
  async () => {
    const report = {
      runtime: process.version,
      movements: 100000,
      warmups: 3,
      samples: 7,
      entries: [],
    };
    for (const size of [0, 100, 1000, 5000]) {
      const f = await (0, sharedPositionVolume_1.sharedPositionVolume)(size);
      try {
        // Synthetic receipts retain an advance for recovery and its reversal.
        f.native
          .exec(`UPDATE shared_receipts SET amount_minor = amount_minor + 100000;
          UPDATE transactions SET amount = amount + 1000 WHERE id IN (SELECT transaction_id FROM shared_receipts);`);
        let queries = [];
        let version = 'before';
        const traced = new Proxy(f.database, {
          get(target, key) {
            if (key !== 'executeSql') return Reflect.get(target, key);
            return async (sql, values = []) => {
              const actualSql =
                version === 'before' &&
                sql === sharedFinancialTotalsSql_1.SHARED_FINANCIAL_TOTALS_SQL
                  ? sharedFinancialTotalsBeforeForgiveness_1.SHARED_FINANCIAL_TOTALS_SQL
                  : sql;
              const result = f.query(actualSql, values);
              queries.push({
                sql: actualSql,
                values,
                rows: result.rows.length,
                bytes: node_buffer_1.Buffer.byteLength(
                  JSON.stringify(result.rows.raw()),
                ),
              });
              return [result];
            };
          },
        });
        const original = await (0,
        dashboardBeforeForgiveness_1.getDashboardSummaryFromDb)(
          traced,
          dashboardFixture_1.DASHBOARD_DATE,
        );
        for (version of ['before', 'afterEmpty', 'afterPopulated']) {
          if (version === 'afterPopulated' && size > 0) {
            f.native.exec('BEGIN');
            for (let i = 0; i < size; i++) {
              const insert = f.native
                .prepare(`INSERT INTO shared_loss_events(id,kind,expense_id,participation_key,contact_id,amount_minor,date,related_event_id,receipt_id,created_at)
              VALUES(?,?,?,?,?,?,?, ?, ?, '2026-10-10T12:00:00Z')`);
              insert.run(
                `loss-${i}`,
                'forgiveness',
                `expense-${i}`,
                `part-${i}`,
                `person-${i % 50}`,
                250000,
                '2026-10-10',
                null,
                null,
              );
              insert.run(
                `undo-${i}`,
                'forgivenessReversal',
                `expense-${i}`,
                `part-${i}`,
                `person-${i % 50}`,
                250000,
                '2026-11-01',
                `loss-${i}`,
                null,
              );
              insert.run(
                `loss2-${i}`,
                'forgiveness',
                `expense-${i}`,
                `part-${i}`,
                `person-${i % 50}`,
                100000,
                '2026-11-01',
                null,
                null,
              );
              insert.run(
                `recovery-${i}`,
                'recovery',
                `expense-${i}`,
                `part-${i}`,
                `person-${i % 50}`,
                50000,
                '2026-11-02',
                `loss2-${i}`,
                `receipt-${i}`,
              );
              insert.run(
                `recovery-undo-${i}`,
                'recoveryReversal',
                `expense-${i}`,
                `part-${i}`,
                `person-${i % 50}`,
                50000,
                '2026-12-02',
                `recovery-${i}`,
                `receipt-${i}`,
              );
            }
            f.native.exec('COMMIT');
          }
          const summarize =
            version === 'before'
              ? dashboardBeforeForgiveness_1.getDashboardSummaryFromDb
              : getDashboardSummary_1.getDashboardSummaryFromDb;
          const expected =
            version === 'afterPopulated'
              ? {
                  ...original,
                  netWorth: original.netWorth - 1000 * size,
                  monthlyForgivenessLosses: 2500 * size,
                  monthlyNetLosses: 2500 * size,
                  monthlySavings: original.monthlySavings - 2500 * size,
                }
              : original;
          for (let warm = 0; warm < 3; warm++)
            await summarize(traced, dashboardFixture_1.DASHBOARD_DATE);
          const milliseconds = [];
          for (let sample = 0; sample < 7; sample++) {
            queries = [];
            const start = node_perf_hooks_1.performance.now();
            const actual = await summarize(
              traced,
              dashboardFixture_1.DASHBOARD_DATE,
            );
            milliseconds.push(node_perf_hooks_1.performance.now() - start);
            expect(actual).toEqual(expected);
          }
          expect(
            queries.some(q =>
              /SELECT \* FROM shared_|SELECT \* FROM transaction_splits/.test(
                q.sql,
              ),
            ),
          ).toBe(false);
          const journalQueries = queries.filter(q =>
            q.sql.includes('shared_loss_events'),
          );
          expect(journalQueries.every(q => q.rows === 1)).toBe(true);
          report.entries.push({
            size,
            journalRows: version === 'afterPopulated' ? size * 5 : 0,
            version,
            medianMs: median(milliseconds),
            milliseconds,
            queries: queries.length,
            returnedRows: queries.reduce((sum, q) => sum + q.rows, 0),
            returnedBytes: queries.reduce((sum, q) => sum + q.bytes, 0),
            statements: queries.map(q => ({
              ...q,
              plan: f.native
                .prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
                .all(...q.values),
            })),
          });
        }
        const repository = (0,
        sqliteSharedExpenseRepository_1.createSqliteSharedExpenseRepository)(
          f.database,
        );
        const position = (0, sharedExpenseDomain_1.getSharedFinancialPosition)(
          await repository.getState(),
        );
        expect(await repository.getFinancialTotals()).toEqual({
          receivables: position.receivables,
          thirdPartyAdvances: position.thirdPartyAdvances,
        });
        expect(f.native.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        f.native.close();
      }
    }
    (0, node_fs_1.mkdirSync)('docs/performance/shared-forgiveness', {
      recursive: true,
    });
    (0, node_fs_1.writeFileSync)(
      'docs/performance/shared-forgiveness/node-comparison.json',
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      JSON.stringify(
        report.entries.map(entry => {
          const {
            statements: _statements,
            milliseconds: _samples,
            ...summary
          } = entry;
          return summary;
        }),
        null,
        2,
      ),
    );
  },
  180000,
);
