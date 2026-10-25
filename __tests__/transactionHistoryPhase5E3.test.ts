import {
  getSQLiteTransactionHistoryPage as current,
  TransactionHistoryChangedError,
} from '../src/modules/transactions/repositories/sqliteTransactionHistory';
import { rowToTransaction } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { HISTORY_DISTRIBUTIONS, historyFixture, type HistoryDistribution } from './helpers/historyDistributions';
import { CREATED_AT_VARIANTS, createdAtStatement, type CreatedAtVariant } from './helpers/historyCreatedAtVariants';
import { baselineHistory } from './helpers/transactionHistoryBaseline';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLitePrimitive, SQLiteRow } from '../src/database/sqliteRows';
import type { Transaction } from '../src/modules/transactions/types';
import type { TransactionHistoryPage, TransactionHistoryQuery } from '../src/modules/transactions/types/TransactionHistoryQuery';

// Phase 5E.3: definitive 5E2-001 regression. Every page is compared with an oracle
// independent of the SQLite planner (all rows, key/created_at/rowid order in JS,
// then the frozen hook semantics), with variable created_at shapes.
const process = require('node:process') as { env: Record<string, string | undefined> };
const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const LARGE = process.env.SMARTFIN_5E3_LARGE === '1';
const all: TransactionHistoryQuery = { month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'newest' };
const FILTERS: Partial<TransactionHistoryQuery>[] = [
  {},
  { search: 'merchant 4' },
  { search: 'merchant 49' },
  { search: 'árbol' },
  { search: 'İω' },
  { search: '%_' },
  { search: '   ' },
  { search: 'not found' },
  { month: '2024-02' },
  { month: '2026-10', accountId: 'savings' },
  { accountId: 'bank', categoryId: 'food', search: 'synthetic' },
  { categoryId: 'transport', month: '2025' },
];

type Fixture = Awaited<ReturnType<typeof historyFixture>>;
async function variantFixture(distribution: HistoryDistribution, variant: CreatedAtVariant, size: number) {
  const fixture = await historyFixture(distribution, size);
  fixture.native.exec(createdAtStatement(variant));
  return fixture;
}

// Same construction as the 5E.2 Android oracle. Keys and created_at are ASCII,
// so JS code-unit comparison equals SQLite BINARY.
function oracle(fixture: Fixture) {
  const rows = fixture.native.prepare('SELECT rowid AS history_rowid, * FROM transactions').all() as SQLiteRow[];
  const key = (row: SQLiteRow) => row.civil_date ? `${row.civil_date}T${row.local_time ?? '00:00'}:00.000Z` : String(row.date);
  const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  rows.sort((a, b) => cmp(key(b), key(a)) || cmp(String(b.created_at), String(a.created_at))
    || Number(b.history_rowid) - Number(a.history_rowid));
  const transactions = rows.map(rowToTransaction);
  const byId = new Map(transactions.map(tx => [tx.id, tx]));
  const normalized = transactions.map(tx => ({ ...tx, date: tx.civilDate ? `${tx.civilDate}T${tx.localTime ?? '00:00'}:00.000Z` : tx.date }));
  return (query: TransactionHistoryQuery): Transaction[] =>
    baselineHistory(normalized, query.month, query.accountId, query.categoryId, query.search, query.sort).map(tx => byId.get(tx.id)!);
}

// Walks every page until exhaustion. Exact objects and order; no duplicates or
// omissions. A keyset search may end with one empty page (behaviour since 5E.1).
async function traverse(database: SmartFinSQLiteDatabase, query: TransactionHistoryQuery, want: Transaction[]) {
  let page: TransactionHistoryPage = await current(database, rowToTransaction, query);
  const seen = new Set<string>();
  let total = 0;
  let pages = 0;
  for (;;) {
    expect(page.transactions.length).toBeLessThanOrEqual(50);
    expect(page.transactions).toEqual(want.slice(total, total + page.transactions.length));
    if (page.nextCursor) expect(page.transactions.length === 50 || (page.transactions.length === 0 && total === want.length)).toBe(true);
    for (const tx of page.transactions) { expect(seen.has(tx.id)).toBe(false); seen.add(tx.id); }
    total += page.transactions.length;
    pages++;
    if (!page.nextCursor) break;
    page = await current(database, rowToTransaction, query, page.nextCursor);
  }
  expect(total).toBe(want.length);
  return { total, pages };
}

describe.each(HISTORY_DISTRIBUTIONS)('5E.3 oracle traversal with variable created_at: %s', distribution => {
  test.each(CREATED_AT_VARIANTS)('created_at %s, 1000 rows, every filter and sort', async variant => {
    const fixture = await variantFixture(distribution, variant, 1000);
    try {
      const expected = oracle(fixture);
      for (const filter of FILTERS) for (const sort of ['newest', 'oldest'] as const) {
        const query = { ...all, ...filter, sort };
        const result = await traverse(fixture.database, query, expected(query));
        if (Object.keys(filter).length === 0) expect(result.total).toBe(1000);
      }
    } finally { fixture.native.close(); }
  }, 120000);
});

// Ties of date and created_at at once, decided only by rowid, around page and
// 200-row batch boundaries, in both sorts.
test.each(['legacyTied', 'legacyDay', 'civil', 'canonicalUtc'] as const)('%s: date and created_at ties across page and batch boundaries', async distribution => {
  const fixture = await historyFixture(distribution, 1000);
  try {
    fixture.native.exec("UPDATE transactions SET created_at = CASE WHEN rowid % 2 = 0 THEN '2026-10-10' ELSE '2026-10-11' END;");
    fixture.native.exec("UPDATE transactions SET date = '2026-10-24', civil_date = NULL, local_time = NULL, time_zone = NULL, date_precision = NULL WHERE rowid BETWEEN 30 AND 260;");
    const expected = oracle(fixture);
    for (const sort of ['newest', 'oldest'] as const) for (const filter of [{}, { search: 'merchant 4' }, { accountId: 'savings' }]) {
      const query = { ...all, ...filter, sort };
      await traverse(fixture.database, query, expected(query));
    }
  } finally { fixture.native.close(); }
});

// Concurrent mutations: insert, edit (date and created_at), delete and invalid
// date between pages invalidate the cursor; a write between the statements of a
// page never publishes a mixed revision; a fresh traversal equals the new oracle.
describe.each(['civil', 'legacyDay', 'legacyTied', 'legacyWithCivil', 'mixed', 'canonicalUtc'] as const)('5E.3 cursor invalidation: %s', distribution => {
  const MUTATIONS = [
    "INSERT INTO transactions(id, amount, currency, description, date, account_id, type, direction, status, created_at, updated_at) VALUES ('late', 7, 'COP', 'late', '2026-10-24', 'bank', 'expense', 'outflow', 'posted', '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z');",
    "UPDATE transactions SET created_at = '2030-01-01T00:00:00.000Z' WHERE id = 'history-500';",
    "UPDATE transactions SET date = '2023-01-01' WHERE id = 'history-7';",
    "DELETE FROM transactions WHERE id = 'history-3';",
    "UPDATE transactions SET date = 'invalid' WHERE id = 'history-9';",
  ];
  test.each(MUTATIONS.flatMap((sql, index) => (['newest', 'oldest'] as const).map(sort => [index, sort, sql] as const)))('mutation %i %s', async (_index, sort, mutation) => {
    const fixture = await variantFixture(distribution, 'scrambled', 1000);
    try {
      const query = { ...all, sort };
      const first = await current(fixture.database, rowToTransaction, query);
      const second = await current(fixture.database, rowToTransaction, query, first.nextCursor);
      expect(second.nextCursor).toBeDefined();
      fixture.native.exec(mutation);
      await expect(current(fixture.database, rowToTransaction, query, second.nextCursor)).rejects.toBeInstanceOf(TransactionHistoryChangedError);
      await traverse(fixture.database, query, oracle(fixture)(query));
      let injected = false;
      const concurrent = new Proxy(fixture.database, { get(target, key) {
        if (key !== 'executeSql') return Reflect.get(target, key);
        return async (sql: string, values: SQLitePrimitive[] = []) => {
          const result = await target.executeSql(sql, values);
          if (sql.includes('history_rowid') && !injected) { injected = true; fixture.native.exec("UPDATE transactions SET notes = 'Concurrent' WHERE id = 'history-2';"); }
          return result;
        };
      } }) as SmartFinSQLiteDatabase;
      await expect(current(concurrent, rowToTransaction, { ...all, search: 'synthetic' })).rejects.toBeInstanceOf(TransactionHistoryChangedError);
      expect(injected).toBe(true);
    } finally { fixture.native.close(); }
  }, 120000);
});

// Large volumes (SMARTFIN_5E3_LARGE=1): 10k for every distribution and variant,
// 100k for representative and pathological shapes. All pages until exhaustion.
const LARGE_CASES: [HistoryDistribution, CreatedAtVariant, number][] = LARGE ? [
  ...HISTORY_DISTRIBUTIONS.flatMap(d => CREATED_AT_VARIANTS.map(v => [d, v, 10000] as [HistoryDistribution, CreatedAtVariant, number])),
  ['civil', 'scrambled', 100000], ['legacyDay', 'reverse', 100000], ['canonicalUtc', 'constant', 100000],
  // No 100k single-day history (AGENTS.md "Performance Volumes").
  ['legacyWithCivil', 'scrambled', 100000], ['mixed', 'scrambled', 100000],
  ['legacyWithOffset', 'mixedFormat', 100000],
] : [];
const LARGE_FILTERS: Partial<TransactionHistoryQuery>[] = [{}, { search: 'merchant 49' }, { search: 'árbol' }, { search: 'not found' }, { month: '2026-10', accountId: 'savings' }];
(LARGE ? test.each(LARGE_CASES) : test.skip.each([['civil', 'grouped', 0]] as [HistoryDistribution, CreatedAtVariant, number][]))(
  'large %s created_at %s %i: every page equals the oracle', async (distribution, variant, size) => {
    const fixture = await variantFixture(distribution, variant, size);
    try {
      const expected = oracle(fixture);
      const timings: Record<string, number> = {};
      for (const filter of LARGE_FILTERS) for (const sort of ['newest', 'oldest'] as const) {
        const query = { ...all, ...filter, sort };
        const start = performance.now();
        const result = await traverse(fixture.database, query, expected(query));
        timings[`${JSON.stringify(filter)}-${sort}`] = Math.round(performance.now() - start);
        if (!Object.keys(filter).length) expect(result.total).toBe(size);
      }
      console.log(JSON.stringify({ distribution, variant, size, traversalMs: timings }));
    } finally { fixture.native.close(); }
  }, 3600000);
