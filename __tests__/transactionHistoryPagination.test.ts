import { dashboardFixture, dashboardTransaction, insertSyntheticHistory } from './helpers/dashboardFixture';
import { baselineHistory } from './helpers/transactionHistoryBaseline';
import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { TransactionHistoryChangedError, TransactionHistoryCancelledError } from '../src/modules/transactions/repositories/sqliteTransactionHistory';
import type { TransactionHistoryCursor, TransactionHistoryQuery } from '../src/modules/transactions/types/TransactionHistoryQuery';
import type { Transaction } from '../src/modules/transactions/types';
import type { SQLitePrimitive } from '../src/database/sqliteRows';
import { groupTransactionsByDate } from '../src/modules/transactions/ui/transactionsScreenFormatters';
import { applyVersionedMigrations } from '../src/database/migrations';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const all: TransactionHistoryQuery = { month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'newest' };
async function collect(repo: ReturnType<typeof createSqliteTransactionRepository>, query = all) {
  let cursor: TransactionHistoryCursor | undefined;
  const transactions: Transaction[] = [];
  do {
    const page = await repo.getTransactionPage(query, cursor);
    expect(page.transactions.length).toBeLessThanOrEqual(50);
    transactions.push(...page.transactions);
    cursor = page.nextCursor;
  } while (cursor);
  expect(new Set(transactions.map(tx => tx.id)).size).toBe(transactions.length);
  return transactions;
}

test.each([1000, 10000])('complete traversal and combined queries equal the frozen hook with %i records', async size => {
  const f = await dashboardFixture();
  insertSyntheticHistory(f, size);
  const repo = createSqliteTransactionRepository(f.database);
  try {
    const baseline = await repo.getTransactions();
    for (const sort of ['newest', 'oldest'] as const) {
      for (const filters of [ {}, { month: '2023-10' }, { accountId: 'bank' },
        { accountId: 'card', search: 'merchant 49' }, { search: ' merchant 49 ' },
        { month: '2024-02', accountId: 'bank', search: 'synthetic' }, { search: 'not found' } ]) {
        const query = { ...all, ...filters, sort };
        const actual = await collect(repo, query);
        const expected = baselineHistory(baseline, query.month, query.accountId, query.categoryId, query.search, sort);
        expect(actual).toEqual(expected);
        expect(groupTransactionsByDate(actual)).toEqual(groupTransactionsByDate(expected));
      }
    }
    expect(await repo.getTransactionMonths()).toEqual(
      [...new Set(baseline.map(tx => tx.date.slice(0, 7)))].sort((a, b) => b.localeCompare(a)));
  } finally { f.native.close(); }
});

test.each([false, true])('ties, offsets, Unicode, literal wildcards and invalid dates preserve results (legacy=%s)', async legacy => {
  const f = await dashboardFixture();
  const repo = createSqliteTransactionRepository(f.database);
  try {
    f.native.exec("INSERT INTO categories (id,name,type,macro_category,color) VALUES ('food','food','expense','food','#fff');");
    for (let i = 0; i < 215; i++) {
      const dates = legacy ? ['2026-10-01T00:00:00+14:00', '2026-09-30T23:59:59-05:00',
        '2026-02-31', '2026-02-28T00:00:00.000Z', 'invalid', '2026-10-01T00:00:00Z'] : ['2026-10-01T00:00:00.000Z'];
      f.insertTransaction(dashboardTransaction({ id: String(i), date: dates[i % dates.length] ?? '',
        createdAt: '2026-01-01', description: i % 2 ? 'ÁRBOL İΣ %_ Ñ café' : 'Other\0SECRET K',
        type: i % 3 ? 'expense' : 'internalTransfer', targetAccountId: 'card',
        merchantName: undefined, notes: i % 5 ? undefined : 'antiguo Ω' }));
    }
    f.native.exec("UPDATE transactions SET category_id = 'food' WHERE rowid % 3 = 0;");
    const before = await repo.getTransactions();
    for (const sort of ['newest', 'oldest'] as const) for (const search of ['', 'árbol', '%_', 'i̇', 'i', 'k', 'secret', 'σ', ' café', ' ', ' antiguo ', 'ω', 'unknown']) {
      for (const filter of [{}, { month: '2026-10' }, { accountId: 'card' }, { accountId: 'card', categoryId: 'food' }]) {
        const query = { ...all, ...filter, sort, search };
        expect(await collect(repo, query)).toEqual(baselineHistory(before, query.month, query.accountId, query.categoryId, search, sort));
      }
    }
  } finally { f.native.close(); }
});

test('empty history, cursor query isolation, cancellation and revision invalidation', async () => {
  const f = await dashboardFixture();
  await applyVersionedMigrations(f.database);
  const repo = createSqliteTransactionRepository(f.database);
  try {
    expect(await repo.getTransactionPage(all)).toEqual({ transactions: [], nextCursor: undefined });
    expect(await repo.getTransactionMonths()).toEqual([]);
    insertSyntheticHistory(f, 101);
    const page = await repo.getTransactionPage(all);
    expect(page.transactions).toHaveLength(50);
    expect(page.nextCursor).toBeDefined();
    await expect(repo.getTransactionPage({ ...all, search: 'other' }, page.nextCursor)).rejects.toThrow('Cursor de otro filtro');
    await expect(repo.getTransactionPage(all, page.nextCursor, () => true)).rejects.toBeInstanceOf(TransactionHistoryCancelledError);
    f.native.exec("UPDATE transactions SET description = 'edited' WHERE id = 'synthetic-0';");
    await expect(repo.getTransactionPage(all, page.nextCursor)).rejects.toBeInstanceOf(TransactionHistoryChangedError);
    expect(await collect(repo)).toEqual(baselineHistory(await repo.getTransactions()));
    const next = await repo.getTransactionPage(all);
    await repo.deleteTransaction(next.transactions[0]?.id ?? '');
    await expect(repo.getTransactionPage(all, next.nextCursor)).rejects.toBeInstanceOf(TransactionHistoryChangedError);
    expect(await collect(repo)).toEqual(baselineHistory(await repo.getTransactions()));
  } finally { f.native.close(); }
});

test('a mutation during a page never publishes a mixed revision', async () => {
  const f = await dashboardFixture();
  insertSyntheticHistory(f, 101);
  const original = f.database.executeSql.bind(f.database);
  let mutated = false;
  const database = new Proxy(f.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return async (sql: string, values: SQLitePrimitive[] = []) => {
    const result = await original(sql, values);
    if (sql.includes('history_rowid') && !mutated) {
      mutated = true;
      f.insertTransaction(dashboardTransaction({ id: 'new', date: '2027-01-01T00:00:00.000Z' }));
    }
    return result;
  }; } });
  try {
    await expect(createSqliteTransactionRepository(database).getTransactionPage(all)).rejects.toBeInstanceOf(TransactionHistoryChangedError);
  } finally { f.native.close(); }
});

test('100,000 movements: complete traversal, old search and global categorization', async () => {
  const f = await dashboardFixture();
  insertSyntheticHistory(f, 100000);
  const repo = createSqliteTransactionRepository(f.database);
  try {
    const before = await repo.getTransactions();
    expect(await collect(repo)).toEqual(baselineHistory(before));
    const query = { ...all, month: '2023-10', search: 'merchant 49', sort: 'oldest' as const };
    expect(await collect(repo, query)).toEqual(baselineHistory(before, query.month, 'all', 'all', query.search, query.sort));
    f.native.exec("INSERT INTO categories (id,name,type,macro_category,color) VALUES ('food','food','expense','food','#fff');");
    await repo.updateTransactionsCategoryByDescription('Synthetic merchant 49', 'food');
    const categorized = await collect(repo, { ...all, categoryId: 'food' });
    expect(categorized).toHaveLength(2000);
    expect(categorized.every(tx => tx.categoryId === 'food')).toBe(true);
  } finally { f.native.close(); }
}, 30000);

test('a search exhausting exact scan-size multiples has no extra cursor', async () => {
  const f = await dashboardFixture();
  insertSyntheticHistory(f, 400);
  try {
    expect(await createSqliteTransactionRepository(f.database).getTransactionPage({ ...all, search: 'not found' }))
      .toEqual({ transactions: [], nextCursor: undefined });
  } finally { f.native.close(); }
});

test('Android string-bound numeric parameters still select the canonical fast path', async () => {
  const f = await dashboardFixture();
  insertSyntheticHistory(f, 101);
  const database = new Proxy(f.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return (sql: string, values: SQLitePrimitive[] = []) => target.executeSql(sql,
      values.map(value => typeof value === 'number' ? String(value) : value));
  } });
  try {
    const repo = createSqliteTransactionRepository(database);
    const page = await repo.getTransactionPage(all);
    expect(page.transactions).toHaveLength(50);
    expect(page.nextCursor?.legacyIds).toBeUndefined();
    expect(page.nextCursor?.after).toBeDefined();
    expect(await collect(repo)).toEqual(baselineHistory(await repo.getTransactions()));
  } finally { f.native.close(); }
});
