import { dashboardFixture, insertSyntheticHistory } from './helpers/dashboardFixture';
import { baselineHistory } from './helpers/transactionHistoryBaseline';
import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import type { SQLitePrimitive } from '../src/database/sqliteRows';
import type { TransactionHistoryCursor, TransactionHistoryQuery } from '../src/modules/transactions/types/TransactionHistoryQuery';
import { TRANSACTION_SORT_SQL } from '../src/shared/utils/transactionDate';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const all: TransactionHistoryQuery = { month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'newest' };

test.each([false, true])('5E-001: compatible probe and ordering preserve exact pages and cursors (legacy=%s)', async legacy => {
  const f = await dashboardFixture();
  insertSyntheticHistory(f, 1000);
  if (legacy) f.native.exec("UPDATE transactions SET date=CASE WHEN rowid%2=0 THEN '2026-10-24' ELSE '2026-10-24T04:00:00-05:00' END, description='ÁRBOL Σ %_ café';");
  const initial = (sql: string) => !sql.includes('DISTINCT') && sql.includes(' AS date FROM transactions') && sql.endsWith('LIMIT 1;');
  let rejectedOldHint = 0;
  const old = new Proxy(f.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return (sql: string, values: SQLitePrimitive[] = []) => target.executeSql((initial(sql)
      ? sql.replace('FROM transactions WHERE', 'FROM transactions INDEXED BY idx_transactions_civil_sort WHERE') : sql)
      .replace(`ORDER BY CAST(${TRANSACTION_SORT_SQL} AS TEXT) ASC`, `ORDER BY ${TRANSACTION_SORT_SQL} ASC`), values);
  } });
  const api24 = new Proxy(f.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return (sql: string, values: SQLitePrimitive[] = []) => {
      if (initial(sql) && sql.includes('INDEXED BY')) { rejectedOldHint++; throw Error('no query solution'); }
      return target.executeSql(sql, values);
    };
  } });
  const previous = createSqliteTransactionRepository(old);
  const current = createSqliteTransactionRepository(api24);
  try {
    for (const sort of ['newest', 'oldest'] as const) {
      for (const filter of [{}, { accountId: 'bank', search: 'synthetic' }, { search: 'árbol' }, { search: 'absent' }]) {
        const query = { ...all, ...filter, sort };
        let a: TransactionHistoryCursor | undefined;
        let b: TransactionHistoryCursor | undefined;
        const transactions = [];
        do {
          const before = await previous.getTransactionPage(query, a);
          const after = await current.getTransactionPage(query, b);
          expect(after).toEqual(before); // Includes every cursor field and every monetary/reference field.
          expect(after.transactions.length).toBeLessThanOrEqual(50);
          transactions.push(...after.transactions);
          a = before.nextCursor; b = after.nextCursor;
        } while (b);
        expect(transactions).toEqual(baselineHistory(await current.getTransactions(), query.month,
          query.accountId, query.categoryId, query.search, query.sort));
      }
    }
    expect(rejectedOldHint).toBe(0);
  } finally { f.native.close(); }
});
