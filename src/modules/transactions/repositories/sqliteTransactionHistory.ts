import { getFinancialDataRevision, type SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { readNumber, readString, resultSetToRows, type SQLitePrimitive, type SQLiteRow } from '../../../database/sqliteRows';
import type { Transaction } from '../types';
import type { TransactionHistoryCursor, TransactionHistoryPage, TransactionHistoryQuery } from '../types/TransactionHistoryQuery';
import { TRANSACTION_DAY_SQL, TRANSACTION_SORT_SQL } from '../../../shared/utils/transactionDate';

export const HISTORY_PAGE_SIZE = 50;
const SCAN_SIZE = 200;
const CACHE_LIMIT = 8;
type HistoryChecks = {
  revision: number;
  canonical: Map<string, boolean>;
  misses: { filterKey: string; search: string }[];
};
// Retain proofs, never complete transactions. Connection identity and the
// trigger-maintained revision prevent reuse after writes or database changes.
const historyChecks = new WeakMap<SmartFinSQLiteDatabase, HistoryChecks>();
const allDatesKey = JSON.stringify(['all', 'all', 'all']);
function filterKey(query: TransactionHistoryQuery) {
  return JSON.stringify([query.month, query.accountId, query.categoryId]);
}

export class TransactionHistoryChangedError extends Error {
  constructor() { super('El historial cambió durante la consulta.'); }
}
export class TransactionHistoryCancelledError extends Error {
  constructor() { super('Consulta de historial cancelada.'); }
}

// SQLite LOWER is ASCII-only. Preserve JS Unicode, literal %, _, and whitespace.
function matchesSearch(row: SQLiteRow, search: string): boolean {
  if (!search.trim()) return true;
  const query = search.toLowerCase();
  return ['merchant_name', 'description', 'notes'].some(key => {
    const value = row[key];
    return typeof value === 'string' && value.toLowerCase().includes(query);
  });
}

function filters(query: TransactionHistoryQuery) {
  const clauses = ['1 = 1'];
  const values: SQLitePrimitive[] = [];
  if (query.month !== 'all') {
    clauses.push(`substr(${TRANSACTION_DAY_SQL}, 1, ?) = ?`);
    values.push(query.month.length, query.month);
  }
  if (query.accountId !== 'all') {
    clauses.push("(account_id = ? OR (type <> 'internalTransfer' AND target_account_id = ?))");
    values.push(query.accountId, query.accountId);
  }
  if (query.categoryId !== 'all') {
    clauses.push('category_id = ?');
    values.push(query.categoryId);
  }
  const search = query.search.toLowerCase();
  if (search.trim() && /^[ -~]+$/.test(search)) {
    // ASCII (including controls) folds identically in SQLite and JS. In UTF-8,
    // Unicode has more bytes than codepoints; NUL truncates SQL text length.
    // Both pass through to JS. UTF-16 conservatively passes ASCII too.
    clauses.push('(' + ['merchant_name', 'description', 'notes'].map(column =>
      `(instr(lower(${column}), ?) > 0 OR length(CAST(${column} AS BLOB)) <> length(${column}))`
    ).join(' OR ') + ')');
    values.push(search, search, search);
  }
  return { where: clauses.join(' AND '), values };
}

function pageBoundary(sort: TransactionHistoryQuery['sort'], after: TransactionHistoryCursor['after']) {
  if (!after) return { sql: '', values: [] as SQLitePrimitive[] };
  const comparison = sort === 'newest' ? '<' : '>';
  return { sql: `AND ${TRANSACTION_SORT_SQL} ${comparison}= ? AND (${TRANSACTION_SORT_SQL} ${comparison} ?
    OR (${TRANSACTION_SORT_SQL} = ? AND created_at < ?)
    OR (${TRANSACTION_SORT_SQL} = ? AND created_at = ? AND rowid < ?))`,
    values: [after.date, after.date, after.date, after.createdAt,
      after.date, after.createdAt, after.rowId] as SQLitePrimitive[] };
}

// Homogeneous canonical UTC strings have the same ordering as JS Date. Verify
// calendar validity explicitly: older Android SQLite does not normalize Feb 31.
async function hasCanonicalDates(database: SmartFinSQLiteDatabase, where: string, values: SQLitePrimitive[], checkCancelled: () => void) {
  checkCancelled();
  const [first] = await database.executeSql(
    `SELECT ${TRANSACTION_SORT_SQL} AS date FROM transactions INDEXED BY idx_transactions_civil_sort WHERE ${where} LIMIT 1;`, values);
  checkCancelled();
  if (!first.rows.length) return true;
  const firstRow = resultSetToRows(first)[0];
  if (!firstRow) return true;
  const date = readString(firstRow, 'date');
  const length = date.length;
  if (length !== 20 && length !== 24) return false;
  const pattern = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]' +
    (length === 24 ? '.[0-9][0-9][0-9]Z' : 'Z');
  const [invalid] = await database.executeSql(
    `SELECT date FROM (
      SELECT DISTINCT ${TRANSACTION_SORT_SQL} AS date FROM transactions INDEXED BY idx_transactions_civil_sort WHERE ${where} LIMIT -1
    ) WHERE (
      length(date) <> CAST(? AS INTEGER) OR date NOT GLOB ?
      OR substr(date, 6, 2) NOT BETWEEN '01' AND '12'
      OR substr(date, 9, 2) NOT BETWEEN '01' AND '31'
      OR substr(date, 12, 2) NOT BETWEEN '00' AND '23'
      OR substr(date, 15, 2) NOT BETWEEN '00' AND '59'
      OR substr(date, 18, 2) NOT BETWEEN '00' AND '59'
      OR strftime('%d', substr(date, 1, 7) || '-01', '+1 month', '-1 day') IS NULL
      OR substr(date, 9, 2) > strftime('%d', substr(date, 1, 7) || '-01', '+1 month', '-1 day')
    ) LIMIT 1;`, [...values, length, pattern]);
  checkCancelled();
  return invalid.rows.length === 0;
}

export async function getSQLiteTransactionHistoryPage(
  database: SmartFinSQLiteDatabase,
  map: (row: SQLiteRow) => Transaction,
  query: TransactionHistoryQuery,
  cursor?: TransactionHistoryCursor,
  isCancelled: () => boolean = () => false,
): Promise<TransactionHistoryPage> {
  const checkCancelled = () => { if (isCancelled()) throw new TransactionHistoryCancelledError(); };
  checkCancelled();
  const queryKey = JSON.stringify(query);
  if (cursor && cursor.queryKey !== queryKey) throw new Error('Cursor de otro filtro.');
  const revision = await getFinancialDataRevision(database);
  checkCancelled();
  if (cursor && cursor.revision !== revision) throw new TransactionHistoryChangedError();
  let checks = historyChecks.get(database);
  if (!checks || checks.revision !== revision) {
    checks = { revision, canonical: new Map(), misses: [] };
    historyChecks.set(database, checks);
  }
  const key = filterKey(query);
  const search = query.search.toLowerCase();
  // An exhaustive miss for p proves a miss for any q containing p. Keep the
  // literal, untrimmed lowercased text and require identical non-search filters.
  if (!cursor && search.trim() && checks.misses.some(miss => miss.filterKey === key && search.includes(miss.search))) {
    if (await getFinancialDataRevision(database) !== revision) throw new TransactionHistoryChangedError();
    checkCancelled();
    return { transactions: [], nextCursor: undefined };
  }
  const filter = filters(query);
  // Validate ordering through the covering date index, without a text-search
  // predicate that would fetch every record just to validate its date.
  const dateFilter = filters({ ...query, search: '' });
  let position: TransactionHistoryCursor = cursor ?? { revision, queryKey, legacyOffset: 0 };
  let canonical: boolean | undefined;
  if (!cursor) {
    // A true proof for the entire history also proves every filtered subset.
    // A false global proof cannot determine a subset's ordering.
    canonical = checks.canonical.get(allDatesKey) === true ? true : checks.canonical.get(key);
    if (canonical === undefined) canonical = await hasCanonicalDates(database, dateFilter.where, dateFilter.values, checkCancelled);
  }

  if (!cursor && !canonical) {
    // Compatibility path: only id/date and search text in bounded SQL batches.
    // Do not retain financial records or search text for the complete history.
    const entries: { id: string; date: string }[] = [];
    let after: TransactionHistoryCursor['after'];
    for (;;) {
      checkCancelled();
      const boundary = pageBoundary('newest', after);
      const [result] = await database.executeSql(
        `SELECT rowid AS history_rowid, id, date, ${TRANSACTION_SORT_SQL} AS history_sort_key, created_at, merchant_name, description, notes
         FROM transactions INDEXED BY idx_transactions_civil_sort
         WHERE ${filter.where} ${boundary.sql} ORDER BY ${TRANSACTION_SORT_SQL} DESC, created_at DESC, rowid DESC LIMIT ?;`,
        [...filter.values, ...boundary.values, SCAN_SIZE]);
      checkCancelled();
      const rows = resultSetToRows(result);
      for (const row of rows) {
        if (matchesSearch(row, query.search)) entries.push({ id: readString(row, 'id'), date: readString(row, 'history_sort_key') });
        after = { date: readString(row, 'history_sort_key'), createdAt: readString(row, 'created_at'), rowId: readNumber(row, 'history_rowid') };
      }
      if (rows.length < SCAN_SIZE) break;
    }
    // Same stable comparator as the original hook, including NaN for invalid dates.
    entries.sort((a, b) => query.sort === 'newest'
      ? new Date(b.date).getTime() - new Date(a.date).getTime()
      : new Date(a.date).getTime() - new Date(b.date).getTime());
    position = { ...position, legacyIds: entries.map(entry => entry.id) };
  }

  checkCancelled();
  const transactions: Transaction[] = [];
  let hasMore = false;
  if (position.legacyIds) {
    const legacyIds = position.legacyIds;
    const ids = legacyIds.slice(position.legacyOffset, position.legacyOffset + HISTORY_PAGE_SIZE);
    if (ids.length) {
      const [result] = await database.executeSql(
        `SELECT * FROM transactions WHERE id IN (${ids.map(() => '?').join(',')});`, ids);
      const byId = new Map(resultSetToRows(result).map(row => [readString(row, 'id'), map(row)]));
      for (const id of ids) {
        const transaction = byId.get(id);
        if (!transaction) throw new TransactionHistoryChangedError();
        transactions.push(transaction);
      }
    }
    position = { ...position, legacyOffset: position.legacyOffset + ids.length };
    hasMore = position.legacyOffset < legacyIds.length;
  } else {
    const searchActive = query.search.trim().length > 0;
    const matchingIds: string[] = [];
    const batchSize = searchActive ? SCAN_SIZE : HISTORY_PAGE_SIZE + 1;
    for (;;) {
      checkCancelled();
      const direction = query.sort === 'newest' ? 'DESC' : 'ASC';
      const boundary = pageBoundary(query.sort, position.after);
      const [result] = await database.executeSql(
        `SELECT rowid AS history_rowid, ${TRANSACTION_SORT_SQL} AS history_sort_key, ${searchActive
          ? 'id, date, created_at, merchant_name, description, notes' : '*'} FROM transactions INDEXED BY idx_transactions_civil_sort
         WHERE ${filter.where} ${boundary.sql}
         ORDER BY ${TRANSACTION_SORT_SQL} ${direction}, created_at DESC, rowid DESC LIMIT ?;`,
        [...filter.values, ...boundary.values, batchSize]);
      checkCancelled();
      const rows = resultSetToRows(result);
      if (rows.length === 0) hasMore = false;
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        if (!row) continue;
        // Leave the lookahead unconsumed for the next page.
        if ((searchActive ? matchingIds.length : transactions.length) === HISTORY_PAGE_SIZE) { hasMore = true; break; }
        position = { ...position, after: { date: readString(row, 'history_sort_key'), createdAt: readString(row, 'created_at'),
          rowId: readNumber(row, 'history_rowid') } };
        if (matchesSearch(row, query.search)) {
          if (searchActive) matchingIds.push(readString(row, 'id'));
          else transactions.push(map(row));
        }
        hasMore = index < rows.length - 1 || rows.length === batchSize;
      }
      if ((searchActive ? matchingIds.length : transactions.length) === HISTORY_PAGE_SIZE || rows.length < batchSize) break;
    }
    if (matchingIds.length) {
      checkCancelled();
      const [result] = await database.executeSql(
        `SELECT * FROM transactions WHERE id IN (${matchingIds.map(() => '?').join(',')});`, matchingIds);
      const byId = new Map(resultSetToRows(result).map(row => [readString(row, 'id'), map(row)]));
      for (const id of matchingIds) {
        const transaction = byId.get(id);
        if (!transaction) throw new TransactionHistoryChangedError();
        transactions.push(transaction);
      }
    }
  }
  checkCancelled();
  if (await getFinancialDataRevision(database) !== revision) throw new TransactionHistoryChangedError();
  checkCancelled();
  // Publish only proofs established by a complete, uncancelled same-revision
  // operation. An older concurrent request cannot replace a newer cache.
  if (historyChecks.get(database) === checks) {
    if (canonical !== undefined) {
      checks.canonical.set(key, canonical);
      if (checks.canonical.size > CACHE_LIMIT) {
        const oldest = checks.canonical.keys().next().value;
        if (oldest !== undefined) checks.canonical.delete(oldest);
      }
    }
    // Empty later pages are not proof that the whole search has no matches.
    if (!cursor && search.trim() && !hasMore && transactions.length === 0) {
      checks.misses.push({ filterKey: key, search });
      if (checks.misses.length > CACHE_LIMIT) checks.misses.shift();
    }
  }
  return { transactions, nextCursor: hasMore ? position : undefined };
}

export async function getSQLiteTransactionMonths(database: SmartFinSQLiteDatabase): Promise<string[]> {
  const [result] = await database.executeSql(
    `SELECT DISTINCT substr(${TRANSACTION_DAY_SQL}, 1, 7) AS month FROM transactions WHERE length(date) >= 7;`);
  return resultSetToRows(result).map(row => readString(row, 'month')).sort((a, b) => b.localeCompare(a));
}
