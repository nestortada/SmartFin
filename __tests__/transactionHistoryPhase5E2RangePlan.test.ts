import { getSQLiteTransactionHistoryPage } from '../src/modules/transactions/repositories/sqliteTransactionHistory';
import { rowToTransaction } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { historyFixture } from './helpers/historyDistributions';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLitePrimitive } from '../src/database/sqliteRows';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));

// Structural guard: page and compatibility batches sort by the CAST key (SQLite
// 3.9.2 ordering defect) inside an index range, never the whole history.
test('history batches use the CAST order inside an index-bounded key range', async () => {
  const fixture = await historyFixture('legacyWithCivil', 3000);
  const plans: string[][] = [];
  const database = new Proxy(fixture.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return async (sql: string, values: SQLitePrimitive[] = []) => {
      if (sql.includes('history_rowid')) {
        expect(sql).toMatch(/ORDER BY CAST\(COALESCE\(civil_date .* AS TEXT\) (ASC|DESC), created_at DESC, rowid DESC LIMIT \?;$/s);
        plans.push(fixture.native.prepare('EXPLAIN QUERY PLAN ' + sql).all(...values).map(r => String(r.detail)));
      }
      return target.executeSql(sql, values);
    };
  } }) as SmartFinSQLiteDatabase;
  try {
    for (const query of [{}, { sort: 'oldest' as const }, { search: 'árbol' }, { search: 'merchant 4' }]) {
      await getSQLiteTransactionHistoryPage(database, rowToTransaction,
        { month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'newest', ...query });
    }
    expect(plans.length).toBeGreaterThan(2);
    // The outer scan searches a key range: it never sorts the complete history.
    for (const plan of plans) expect(plan.some(line => /SEARCH transactions USING INDEX idx_transactions_civil_sort \(<expr>[<>]\?/.test(line))).toBe(true);
  } finally { fixture.native.close(); }
});
