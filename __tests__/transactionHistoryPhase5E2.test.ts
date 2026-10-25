import { getSQLiteTransactionHistoryPage as phase5E1 } from './helpers/transactionHistoryPhase5E1';
import {
  getSQLiteTransactionHistoryPage as current,
  TransactionHistoryCancelledError,
  TransactionHistoryChangedError,
} from '../src/modules/transactions/repositories/sqliteTransactionHistory';
import { rowToTransaction } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { HISTORY_DISTRIBUTIONS, historyFixture, type HistoryDistribution } from './helpers/historyDistributions';
import { dashboardFixture } from './helpers/dashboardFixture';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLitePrimitive } from '../src/database/sqliteRows';
import type { TransactionHistoryCursor, TransactionHistoryPage, TransactionHistoryQuery } from '../src/modules/transactions/types/TransactionHistoryQuery';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const all: TransactionHistoryQuery = { month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'newest' };
const FILTERS: Partial<TransactionHistoryQuery>[] = [
  {},
  { search: 'merchant 4' }, // many ASCII matches spread over the history
  { search: 'merchant 49' },
  { search: 'árbol' }, // Unicode case folding only JS performs
  { search: 'İω' },
  { search: '\u0000' }, // NUL is invisible to SQLite text length
  { search: '%_' }, // LIKE metacharacters are literal
  { search: '   ' }, // whitespace-only is no search
  { search: 'not found' },
  { month: '2024-02' },
  { month: '2026-10', accountId: 'savings' }, // includes transfer targets
  { accountId: 'bank', categoryId: 'food', search: 'synthetic' },
  { categoryId: 'transport', month: '2025' },
];

type Path = 'legacy' | 'keyset' | 'end';
const path = (page: TransactionHistoryPage): Path =>
  !page.nextCursor ? 'end' : page.nextCursor.legacyIds ? 'legacy' : 'keyset';

// Walks both implementations in lockstep. Pages must be identical objects. When
// both use the same cursor representation the whole page, cursor included, must
// match. A path switch may only add one trailing empty page (5E.1 keyset search
// already reports more candidates when unmatched rows remain).
async function compareTraversal(database: SmartFinSQLiteDatabase, query: TransactionHistoryQuery) {
  let before: TransactionHistoryPage = await phase5E1(database, rowToTransaction, query);
  let after: TransactionHistoryPage = await current(database, rowToTransaction, query);
  const firstPaths = [path(before), path(after)];
  let total = 0;
  let extraEmpty = 0;
  const seen = new Set<string>();
  for (;;) {
    expect(after.transactions).toEqual(before.transactions);
    expect(after.transactions.length).toBeLessThanOrEqual(50);
    for (const tx of after.transactions) { expect(seen.has(tx.id)).toBe(false); seen.add(tx.id); }
    total += after.transactions.length;
    if (firstPaths[0] === firstPaths[1]) expect(after).toEqual(before);
    if (!before.nextCursor && after.nextCursor) {
      const tail = await current(database, rowToTransaction, query, after.nextCursor);
      expect(tail).toEqual({ transactions: [], nextCursor: undefined });
      extraEmpty++;
      break;
    }
    expect(!!after.nextCursor).toBe(!!before.nextCursor);
    if (!before.nextCursor || !after.nextCursor) break;
    before = await phase5E1(database, rowToTransaction, query, before.nextCursor);
    after = await current(database, rowToTransaction, query, after.nextCursor);
  }
  return { total, firstPaths, extraEmpty };
}

function count(fixture: { query: (sql: string) => { rows: { item: (i: number) => Record<string, SQLitePrimitive> | undefined } } }) {
  return Number(fixture.query('SELECT count(*) AS n FROM transactions').rows.item(0)?.n);
}

describe.each(HISTORY_DISTRIBUTIONS)('5E.2 exact equivalence with frozen 5E.1: %s', distribution => {
  test.each([0, 1, 49, 50, 51, 1000, 3000])('size %i, every filter and sort, all pages', async size => {
    const fixture = await historyFixture(distribution, size);
    try {
      expect(count(fixture)).toBe(size);
      for (const filter of FILTERS) for (const sort of ['newest', 'oldest'] as const) {
        const result = await compareTraversal(fixture.database, { ...all, ...filter, sort });
        if (!filter.search?.trim() && !filter.month && !filter.accountId && !filter.categoryId) expect(result.total).toBe(size);
        // A trailing empty page can only appear for a keyset search page.
        if (result.extraEmpty) expect(filter.search?.trim()).toBeTruthy();
      }
    } finally { fixture.native.close(); }
  }, 120000);
});

const expectedPath: Partial<Record<HistoryDistribution, { newest: Path; oldest: Path }>> = {
  canonicalUtc: { newest: 'keyset', oldest: 'keyset' },
  secondsUtc: { newest: 'keyset', oldest: 'keyset' },
  civil: { newest: 'keyset', oldest: 'keyset' },
  legacyDay: { newest: 'keyset', oldest: 'keyset' },
  legacyTied: { newest: 'keyset', oldest: 'keyset' },
  legacyCivilDate: { newest: 'keyset', oldest: 'keyset' },
  legacyWithCivilTime: { newest: 'keyset', oldest: 'keyset' },
  // D and DT00:00:00(.000)Z are equal JS instants: oldest keeps the JS path.
  legacyWithCivil: { newest: 'keyset', oldest: 'legacy' },
  legacyWithSeconds: { newest: 'keyset', oldest: 'legacy' },
  legacyWithInvalid: { newest: 'legacy', oldest: 'legacy' },
  legacyWithOffset: { newest: 'legacy', oldest: 'legacy' },
  secondsAndMillis: { newest: 'legacy', oldest: 'legacy' },
  mixed: { newest: 'legacy', oldest: 'legacy' },
};
test.each(Object.entries(expectedPath))('%s selects the proven path', async (distribution, paths) => {
  // 3000 rows repeat each spread day, creating cross-format ties where they apply.
  const fixture = await historyFixture(distribution as HistoryDistribution, 3000);
  try {
    for (const sort of ['newest', 'oldest'] as const) {
      expect(path(await current(fixture.database, rowToTransaction, { ...all, sort }))).toBe(paths[sort]);
    }
  } finally { fixture.native.close(); }
});

test('a newest proof with JS ties is never reused for oldest pages or subsets', async () => {
  const fixture = await historyFixture('legacyWithCivil', 2000);
  try {
    for (const query of [all, { ...all, sort: 'oldest' as const }, { ...all, accountId: 'bank', sort: 'oldest' as const },
      { ...all, accountId: 'bank' }, { ...all, sort: 'oldest' as const }]) {
      await compareTraversal(fixture.database, query);
    }
  } finally { fixture.native.close(); }
});

test('subsets without cross-format ties use the keyset path for oldest; equivalent either way', async () => {
  const fixture = await historyFixture('legacyWithCivil', 2000);
  try {
    // Removing civil rows from the category leaves one date-only format in that subset.
    const day = String(fixture.query("SELECT date FROM transactions WHERE civil_date IS NULL LIMIT 1").rows.item(0)?.date);
    fixture.native.exec(`UPDATE transactions SET category_id = NULL WHERE civil_date IS NOT NULL;`);
    const query = { ...all, month: day, categoryId: 'food', sort: 'oldest' as const };
    const result = await compareTraversal(fixture.database, query);
    expect(result.firstPaths[1]).not.toBe('legacy');
  } finally { fixture.native.close(); }
});

test('large tie groups: every page equal, bounded statements, batches capped', async () => {
  const fixture = await historyFixture('legacyTied', 20000);
  const statements: { sql: string; rows: number; limit?: SQLitePrimitive }[] = [];
  const database = new Proxy(fixture.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return async (sql: string, values: SQLitePrimitive[] = []) => {
      const [result] = await target.executeSql(sql, values);
      statements.push({ sql, rows: result.rows.length, limit: sql.includes('LIMIT ?') ? values[values.length - 1] : undefined });
      return [result];
    };
  } }) as SmartFinSQLiteDatabase;
  try {
    for (const query of [all, { ...all, sort: 'oldest' as const }, { ...all, search: 'not found' }, { ...all, search: 'merchant 49' }]) {
      statements.length = 0;
      const page = await current(database, rowToTransaction, query);
      const reference = await phase5E1(fixture.database, rowToTransaction, query);
      expect(page.transactions).toEqual(reference.transactions);
      expect(Math.max(...statements.map(s => s.rows))).toBeLessThanOrEqual(6400);
      expect(statements.filter(s => typeof s.limit === 'number').every(s => Number(s.limit) % 200 === 0 || s.limit === 51)).toBe(true);
      // 5E.1 executed 100+ statements for these first pages; 5E.2 uses a few.
      expect(statements.length).toBeLessThanOrEqual(12);
    }
  } finally { fixture.native.close(); }
}, 120000);

test('the 200-row cursor rule survives larger batches when a page fills at the boundary', async () => {
  // 50th match is exactly the 200th candidate and nothing follows it.
  const fixture = await dashboardFixture();
  try {
    fixture.native.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 200)
      INSERT INTO transactions(id, amount, currency, description, date, account_id, type, direction, status, created_at, updated_at)
      SELECT 'edge-' || n, 1, 'COP', CASE WHEN n % 4 = 0 THEN 'hit' ELSE 'miss' END,
        printf('2026-01-01T00:%02d:%02d.000Z', n / 60, n % 60), 'bank', 'expense', 'outflow', 'posted', '2026-01-01', '2026-01-01' FROM seq;`);
    for (const sort of ['newest', 'oldest'] as const) {
      const query = { ...all, search: 'hit', sort };
      const result = await compareTraversal(fixture.database, query);
      expect(result.total).toBe(50);
    }
    // With 400 candidates the second (400-row) batch ends short of no boundary.
    fixture.native.exec(`WITH RECURSIVE seq(n) AS (SELECT 201 UNION ALL SELECT n + 1 FROM seq WHERE n < 999)
      INSERT INTO transactions(id, amount, currency, description, date, account_id, type, direction, status, created_at, updated_at)
      SELECT 'edge-' || n, 1, 'COP', CASE WHEN n % 4 = 0 THEN 'hit' ELSE 'miss' END,
        printf('2026-01-02T%02d:%02d:%02d.000Z', n / 3600, (n / 60) % 60, n % 60), 'bank', 'expense', 'outflow', 'posted', '2026-01-01', '2026-01-01' FROM seq;`);
    for (const search of ['hit', 'miss']) for (const sort of ['newest', 'oldest'] as const) {
      await compareTraversal(fixture.database, { ...all, search, sort });
    }
  } finally { fixture.native.close(); }
});

test('legacy date-only keyset pages keep revision, cancellation and concurrent-write protection', async () => {
  const fixture = await historyFixture('legacyDay', 500);
  try {
    const first = await current(fixture.database, rowToTransaction, all);
    expect(path(first)).toBe('keyset');
    await expect(current(fixture.database, rowToTransaction, all, first.nextCursor, () => true))
      .rejects.toBeInstanceOf(TransactionHistoryCancelledError);
    let calls = 0;
    await expect(current(fixture.database, rowToTransaction, all, undefined, () => ++calls > 3))
      .rejects.toBeInstanceOf(TransactionHistoryCancelledError);
    let injected = false;
    const concurrent = new Proxy(fixture.database, { get(target, key) {
      if (key !== 'executeSql') return Reflect.get(target, key);
      return async (sql: string, values: SQLitePrimitive[] = []) => {
        const result = await target.executeSql(sql, values);
        if (sql.includes('history_rowid') && !injected) {
          injected = true; fixture.native.exec("UPDATE transactions SET notes = 'Concurrent' WHERE id = 'history-2';");
        }
        return result;
      };
    } }) as SmartFinSQLiteDatabase;
    await expect(current(concurrent, rowToTransaction, { ...all, search: 'synthetic' })).rejects.toBeInstanceOf(TransactionHistoryChangedError);
    fixture.native.exec("UPDATE transactions SET notes = 'Edited' WHERE id = 'history-1';");
    await expect(current(fixture.database, rowToTransaction, all, first.nextCursor as TransactionHistoryCursor))
      .rejects.toBeInstanceOf(TransactionHistoryChangedError);
    // A write that introduces an invalid date invalidates the cached proof.
    fixture.native.exec("UPDATE transactions SET date = 'invalid' WHERE id = 'history-3';");
    expect(path(await current(fixture.database, rowToTransaction, all))).toBe('legacy');
    await compareTraversal(fixture.database, all);
    fixture.native.exec('DELETE FROM transactions;');
    expect(await current(fixture.database, rowToTransaction, all)).toEqual({ transactions: [], nextCursor: undefined });
  } finally { fixture.native.close(); }
});

test.each(['legacyDay', 'legacyTied', 'legacyWithCivil', 'mixed', 'civil'] as const)(
  '%s at 10k: complete traversals cross capped batches without omissions', async distribution => {
    const fixture = await historyFixture(distribution, 10000);
    try {
      for (const filter of [{}, { search: 'merchant 4' }, { search: 'árbol' }, { search: 'not found' }, { accountId: 'savings', search: '%_' }])
        for (const sort of ['newest', 'oldest'] as const) {
          const result = await compareTraversal(fixture.database, { ...all, ...filter, sort });
          if (!filter.search && !('accountId' in filter)) expect(result.total).toBe(10000);
        }
    } finally { fixture.native.close(); }
  }, 600000);
