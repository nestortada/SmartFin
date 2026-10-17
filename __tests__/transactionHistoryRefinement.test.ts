import { dashboardFixture, dashboardTransaction, insertSyntheticHistory } from './helpers/dashboardFixture';
import { baselineHistory } from './helpers/transactionHistoryBaseline';
import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { TransactionHistoryCancelledError, TransactionHistoryChangedError } from '../src/modules/transactions/repositories/sqliteTransactionHistory';
import type { TransactionHistoryQuery } from '../src/modules/transactions/types/TransactionHistoryQuery';
import type { SQLitePrimitive } from '../src/database/sqliteRows';
import { applyVersionedMigrations } from '../src/database/migrations';
import { realSQLite } from './helpers/realSQLite';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const all: TransactionHistoryQuery = { month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'newest' };

test.each(['UTF-8', 'UTF-16le', 'UTF-16be'])('the byte prefilter never excludes a JS ASCII match in %s storage', encoding => {
  const f = realSQLite();
  try {
    f.native.exec(`PRAGMA encoding='${encoding}'; CREATE TABLE search_text (value TEXT);`);
    const values = ['İ K', 'a\0SECRET', '\0ABC', '😀𐐀', '  %_  ',
      ...Array.from({length: 1024}, (_, index) => `prefix ${String.fromCodePoint(index)} ABC suffix`)];
    const insert = f.native.prepare('INSERT INTO search_text VALUES (?);');
    for (const value of values) insert.run(value);
    for (const search of ['i', 'k', 'secret', 'abc', '%_', ' ', '\x7f']) {
      const rows = f.query('SELECT value FROM search_text WHERE instr(lower(value), ?) > 0 OR length(CAST(value AS BLOB)) <> length(value);', [search]);
      const candidates = new Set(rows.rows.raw().map(row => row.value));
      for (const value of values.filter(text => text.toLowerCase().includes(search))) expect(candidates.has(value)).toBe(true);
    }
  } finally { f.native.close(); }
});

test('byte-length prefilter preserves Unicode, ASCII controls, NUL and literal untrimmed text in every field', async () => {
  const f = await dashboardFixture();
  try {
    const text = ['ÁRBOL İΣ K', '😀𐐀', 'a\0SECRET', '\t\nABC\x7f', '  %_ [.*]  ', '', 'ASCII ordinary'];
    for (let index = 0; index < 217; index++) f.insertTransaction(dashboardTransaction({
      id: `text-${index}`, date: new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
      description: text[index % text.length] ?? '', merchantName: text[(index + 1) % text.length], notes: text[(index + 2) % text.length],
    }));
    const repo = createSqliteTransactionRepository(f.database);
    const reference = await repo.getTransactions();
    for (const search of ['i', 'k', 'secret', '𐐨', '😀', 'i̇', 'σ', '\0', '\nabc', '\t', '\x7f', ' %_ ', '[.*]', '  ', 'ASCII', 'absent', 'ABSENT extended']) {
      const actual = []; let cursor;
      do { const page = await repo.getTransactionPage({ ...all, search }, cursor); actual.push(...page.transactions); cursor = page.nextCursor; } while (cursor);
      expect(actual).toEqual(baselineHistory(reference, 'all', 'all', 'all', search));
    }
  } finally { f.native.close(); }
});

test('reuse is limited to exhaustive misses with the same filters and revision, not shorter queries or last pages', async () => {
  const f = await dashboardFixture(); insertSyntheticHistory(f, 120);
  const sql: string[] = [];
  const db = new Proxy(f.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return async (statement: string, values: SQLitePrimitive[] = []) => { sql.push(statement); return target.executeSql(statement, values); };
  } });
  const repo = createSqliteTransactionRepository(db);
  try {
    await repo.getTransactionPage({ ...all, search: 'not found' });
    sql.length = 0;
    expect((await repo.getTransactionPage({ ...all, search: 'NOT FOUND extended', sort: 'oldest' })).transactions).toEqual([]);
    expect(sql).toHaveLength(2); expect(sql.every(s => s.includes('SELECT revision'))).toBe(true);
    sql.length = 0;
    await repo.getTransactionPage({ ...all, search: 'not' });
    expect(sql.some(s => s.includes('history_rowid'))).toBe(true);
    await repo.getTransactionPage({ ...all, accountId: 'missing-account', search: 'merchant' });
    expect((await repo.getTransactionPage({ ...all, search: 'merchant 49' })).transactions).toHaveLength(2);
    f.insertTransaction(dashboardTransaction({ id: 'new-match', description: 'NOT FOUND extended', date: '2027-01-01T00:00:00.000Z' }));
    expect((await repo.getTransactionPage({ ...all, search: 'not found extended' })).transactions.map(tx => tx.id)).toEqual(['new-match']);
    let cursor;
    do { cursor = (await repo.getTransactionPage({ ...all, search: 'merchant' }, cursor)).nextCursor; } while (cursor);
    expect((await repo.getTransactionPage({ ...all, search: 'merchant 49' })).transactions).toHaveLength(2);
  } finally { f.native.close(); }
});

test('canonical global proof avoids repeated checks, but invalid dates after writes require exact compatibility', async () => {
  const f = await dashboardFixture(); insertSyntheticHistory(f, 110);
  await applyVersionedMigrations(f.database);
  const sql: string[] = [];
  const db = new Proxy(f.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return (statement: string, values: SQLitePrimitive[] = []) => { sql.push(statement); return target.executeSql(statement, values); };
  } });
  const repo = createSqliteTransactionRepository(db);
  try {
    await repo.getTransactionPage(all); sql.length = 0;
    await repo.getTransactionPage({ ...all, month: '2024-02', accountId: 'bank' });
    expect(sql.some(s => s.includes('SELECT DISTINCT date'))).toBe(false);
    f.insertTransaction(dashboardTransaction({ id: 'legacy', date: '2027-02-31T12:00:00Z' }));
    expect((await repo.getTransactionPage(all)).nextCursor?.legacyIds).toBeDefined();
    expect((await repo.getTransactionPage({ ...all, month: '2024-02' })).nextCursor?.legacyIds).toBeUndefined();
    expect((await repo.getTransactionPage(all)).transactions).toEqual(baselineHistory(await repo.getTransactions()).slice(0, 50));
    await repo.updateTransactionCategory('legacy', null);
    await repo.deleteTransaction('legacy');
    expect((await repo.getTransactionPage(all)).nextCursor?.legacyIds).toBeUndefined();
  } finally { f.native.close(); }
});

test('cancellation after a native result prevents follow-up SQL, and cache hits still check concurrent writes', async () => {
  const f = await dashboardFixture(); insertSyntheticHistory(f, 100);
  let cancelled = false; let count = 0; let inject = false;
  const db = new Proxy(f.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return async (sql: string, values: SQLitePrimitive[] = []) => {
      count++; const result = await target.executeSql(sql, values);
      if (cancelled || count === 1) cancelled = true;
      if (inject && count === 1) f.insertTransaction(dashboardTransaction({ id: 'write', description: 'missing extended' }));
      return result;
    };
  } });
  try {
    const repo = createSqliteTransactionRepository(db);
    await expect(repo.getTransactionPage(all, undefined, () => cancelled)).rejects.toBeInstanceOf(TransactionHistoryCancelledError);
    expect(count).toBe(1);
    await repo.getTransactionPage({ ...all, search: 'missing' });
    count = 0; inject = true;
    await expect(repo.getTransactionPage({ ...all, search: 'missing extended' })).rejects.toBeInstanceOf(TransactionHistoryChangedError);
    inject = false;
    expect((await repo.getTransactionPage({ ...all, search: 'missing extended' })).transactions.map(tx => tx.id)).toEqual(['write']);
  } finally { f.native.close(); }
});

test('miss proofs are bounded and never share state across connections', async () => {
  const f = await dashboardFixture(); insertSyntheticHistory(f, 10);
  let scans = 0;
  const db = new Proxy(f.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return (sql: string, values: SQLitePrimitive[] = []) => { if (sql.includes('history_rowid')) scans++; return target.executeSql(sql, values); };
  } });
  try {
    const repo = createSqliteTransactionRepository(db);
    for (let index = 0; index < 10; index++) await repo.getTransactionPage({ ...all, search: `absent-${index}!` });
    scans = 0;
    await repo.getTransactionPage({ ...all, search: 'absent-0!' }); expect(scans).toBe(1);
    const other = await dashboardFixture();
    try {
      other.insertTransaction(dashboardTransaction({ id: 'other', description: 'absent-0!' }));
      expect((await createSqliteTransactionRepository(other.database).getTransactionPage({ ...all, search: 'absent-0!' })).transactions).toHaveLength(1);
    } finally { other.native.close(); }
  } finally { f.native.close(); }
});

test('cancelled date validation does not publish a reusable proof or enqueue its remaining queries', async () => {
  const f = await dashboardFixture(); insertSyntheticHistory(f, 80);
  let cancelled = false; let cancelShape = true; const sql: string[] = [];
  const db = new Proxy(f.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return async (statement: string, values: SQLitePrimitive[] = []) => {
      sql.push(statement); const result = await target.executeSql(statement, values);
      if (cancelShape && statement.includes('AS date FROM transactions INDEXED BY idx_transactions_civil_sort')) cancelled = true;
      return result;
    };
  } });
  try {
    const repo = createSqliteTransactionRepository(db);
    await expect(repo.getTransactionPage(all, undefined, () => cancelled)).rejects.toBeInstanceOf(TransactionHistoryCancelledError);
    expect(sql).toHaveLength(2);
    sql.length = 0; cancelShape = false; cancelled = false;
    await repo.getTransactionPage(all);
    expect(sql.some(s => s.includes('SELECT DISTINCT COALESCE(civil_date'))).toBe(true);
  } finally { f.native.close(); }
});
