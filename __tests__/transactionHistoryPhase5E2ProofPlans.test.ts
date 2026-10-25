import { historyFixture } from './helpers/historyDistributions';
import { TRANSACTION_DAY_SQL, TRANSACTION_SORT_SQL } from '../src/shared/utils/transactionDate';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const process = require('node:process') as { env: Record<string, string | undefined> };
const fs = require('node:fs') as { writeFileSync: (f: string, c: string) => void };
const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };
const diagnostic = process.env.SMARTFIN_5E2_DIAGNOSTIC ? test : test.skip;

// Access-path variants of the date-order proof; results must not depend on them.
diagnostic('proof access paths by filter', async () => {
  const out: object[] = [];
  for (const distribution of ['canonicalUtc', 'legacyDay'] as const) {
    const fixture = await historyFixture(distribution, 100000);
    const filters: [string, string, (string | number)[]][] = [
      ['none', '1 = 1', []],
      ['category', 'category_id = ?', ['food']],
      ['account', "(account_id = ? OR (type <> 'internalTransfer' AND target_account_id = ?))", ['bank', 'bank']],
      ['combined', `substr(${TRANSACTION_DAY_SQL}, 1, ?) = ? AND (account_id = ? OR (type <> 'internalTransfer' AND target_account_id = ?)) AND category_id = ?`, [7, '2024-02', 'bank', 'bank', 'food']],
    ];
    for (const [name, where, values] of filters) for (const hint of ['INDEXED BY idx_transactions_civil_sort', '']) {
      const sql = `SELECT count(*) AS n FROM (SELECT DISTINCT ${TRANSACTION_SORT_SQL} AS k FROM transactions ${hint} WHERE ${where} LIMIT -1);`;
      const samples: number[] = []; let n = 0;
      for (let i = 0; i < 4; i++) { const s = performance.now(); n = Number(fixture.query(sql, values).rows.item(0)?.n); if (i) samples.push(performance.now() - s); }
      out.push({ distribution, name, hint: !!hint, n, samples, plan: fixture.native.prepare('EXPLAIN QUERY PLAN ' + sql).all(...values).map(r => r.detail) });
    }
    fixture.native.close();
  }
  fs.writeFileSync('docs/rendimiento-fase5e2/node/proof-access-paths.json', JSON.stringify(out, null, 2));
}, 600000);
