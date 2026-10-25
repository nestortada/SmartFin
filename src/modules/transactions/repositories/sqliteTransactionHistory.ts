import { getFinancialDataRevision, type SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { readNumber, readString, resultSetToRows, type SQLitePrimitive, type SQLiteRow } from '../../../database/sqliteRows';
import type { Transaction } from '../types';
import type { TransactionHistoryCursor, TransactionHistoryPage, TransactionHistoryQuery } from '../types/TransactionHistoryQuery';
import { TRANSACTION_DAY_SQL, TRANSACTION_SORT_SQL } from '../../../shared/utils/transactionDate';

export const HISTORY_PAGE_SIZE = 50;
const SCAN_SIZE = 200;
// Candidate batches double up to this size. Every batch is a multiple of
// SCAN_SIZE, so each batch end is also a 200-row boundary of earlier phases.
const MAX_SCAN_SIZE = SCAN_SIZE * 32;
const CACHE_LIMIT = 8;
// SQLite 3.9.2 treats an expression-index scan in either direction as
// satisfying every ORDER BY term, returning created_at/rowid ties in index
// order (5E.1 fixed oldest; 5E.2 measured duplicates/omissions in newest).
// The key is already TEXT; this equivalent expression forces the full sort.
const ORDER_KEY_SQL = `CAST(${TRANSACTION_SORT_SQL} AS TEXT)`;
// ordered: SQL text order refines JS Date order. ties: distinct keys share an instant.
type DateProof = { ordered: boolean; ties: boolean };
type HistoryChecks = {
  revision: number;
  canonical: Map<string, DateProof>;
  misses: { filterKey: string; search: string }[];
};
// Valid date-only keys may join SQL ordering only if this engine parses them as
// UTC midnight (ES spec). Otherwise they keep the JS compatibility path.
const DATE_ONLY_IS_UTC = new Date('1970-01-02').getTime() === 86400000
  && new Date('2000-02-29').getTime() === Date.UTC(2000, 1, 29);
function canonicalFor(proof: DateProof | undefined, sort: TransactionHistoryQuery['sort']) {
  return proof !== undefined && proof.ordered && (sort === 'newest' || !proof.ties);
}
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

function searchActive(query: TransactionHistoryQuery) {
  return query.search.trim().length > 0;
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

// A LIMIT n batch is the first n rows in key-major order, so all of them lie in
// the key range ending at the key of the n-th matching row in key order. Bounding
// the scan to that range (same predicate) leaves the result unchanged and lets
// ORDER_KEY_SQL sort only the range instead of the whole remaining history. A
// single-term key order is correct even on SQLite 3.9.2. With fewer than n rows
// left, the bound is the extreme key of the table, which restricts nothing.
// Very selective filters pay at most one more linear scan, never a full sort.
function batchRange(direction: 'ASC' | 'DESC', filter: ReturnType<typeof filters>, boundary: { sql: string; values: SQLitePrimitive[] },
  batchSize: number) {
  const index = 'FROM transactions INDEXED BY idx_transactions_civil_sort';
  return { sql: `AND ${TRANSACTION_SORT_SQL} ${direction === 'DESC' ? '>=' : '<='} COALESCE(
      (SELECT ${TRANSACTION_SORT_SQL} ${index} WHERE ${filter.where} ${boundary.sql} ORDER BY ${TRANSACTION_SORT_SQL} ${direction} LIMIT 1 OFFSET ?),
      (SELECT ${TRANSACTION_SORT_SQL} ${index} ORDER BY ${TRANSACTION_SORT_SQL} ${direction === 'DESC' ? 'ASC' : 'DESC'} LIMIT 1))`,
    values: [...filter.values, ...boundary.values, batchSize - 1] };
}

const DAY_GLOB = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
const SECONDS_GLOB = DAY_GLOB + 'T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]';
// Valid UTC keys are YYYY-MM-DD, ...THH:MM:SSZ or ...THH:MM:SS.mmmZ. Verify
// calendar validity explicitly: older Android SQLite does not normalize Feb 31.
const VALID_KEY_SQL = `(CASE length(history_key) WHEN 10 THEN history_key GLOB '${DAY_GLOB}'
    WHEN 20 THEN history_key GLOB '${SECONDS_GLOB}Z' WHEN 24 THEN history_key GLOB '${SECONDS_GLOB}.[0-9][0-9][0-9]Z' ELSE 0 END
  AND substr(history_key, 6, 2) BETWEEN '01' AND '12'
  AND substr(history_key, 9, 2) BETWEEN '01' AND '31'
  AND (length(history_key) = 10 OR (substr(history_key, 12, 2) BETWEEN '00' AND '23'
    AND substr(history_key, 15, 2) BETWEEN '00' AND '59' AND substr(history_key, 18, 2) BETWEEN '00' AND '59'))
  AND (substr(history_key, 9, 2) <= '28' OR (strftime('%d', substr(history_key, 1, 7) || '-01', '+1 month', '-1 day') IS NOT NULL
    AND substr(history_key, 9, 2) <= strftime('%d', substr(history_key, 1, 7) || '-01', '+1 month', '-1 day'))))`;

// JS sorts by Date value; SQL by text. For valid keys of one format, or
// date-only keys with one full format, a later instant always has greater text,
// so SQL order equals JS stable order for newest. Oldest additionally requires
// that no D coexists with DT00:00:00(.000)Z, whose JS tie keeps newest order.
async function proveDateOrder(database: SmartFinSQLiteDatabase, query: TransactionHistoryQuery, checkCancelled: () => void): Promise<DateProof> {
  checkCancelled();
  // Without a text-search predicate that would fetch every record just to validate its date.
  const { where, values } = filters({ ...query, search: '' });
  // A category filter can use its own plain index (then DISTINCT sorts the few
  // keys); otherwise keep the covering date index. DISTINCT keys are plan-independent.
  const access = query.categoryId === 'all' ? 'INDEXED BY idx_transactions_civil_sort' : '';
  const keys = `(SELECT DISTINCT ${TRANSACTION_SORT_SQL} AS history_key FROM transactions ${access} WHERE ${where} LIMIT -1)`;
  const [result] = await database.executeSql(
    `SELECT
      max(CASE WHEN ${VALID_KEY_SQL} THEN 0 ELSE 1 END) AS has_invalid,
      max(length(history_key) = 10) AS has_day,
      max(length(history_key) = 20) AS has_seconds,
      max(length(history_key) = 24) AS has_millis
    FROM ${keys};`, values);
  checkCancelled();
  const row = resultSetToRows(result)[0];
  const flag = (key: string) => row !== undefined && row[key] === 1;
  // An empty set has NULL aggregates and is trivially ordered.
  const ordered = !flag('has_invalid') && !(flag('has_seconds') && flag('has_millis'))
    && (!flag('has_day') || DATE_ONLY_IS_UTC);
  // Cross-format instants can only tie when date-only keys join a full format.
  if (!ordered || !flag('has_day') || !(flag('has_seconds') || flag('has_millis'))) return { ordered, ties: false };
  const [ties] = await database.executeSql(
    `SELECT 1 FROM ${keys} WHERE length(history_key) = 10 OR substr(history_key, 11) IN ('T00:00:00Z', 'T00:00:00.000Z')
     GROUP BY substr(history_key, 1, 10) HAVING count(*) > 1 LIMIT 1;`, values);
  checkCancelled();
  return { ordered, ties: ties.rows.length > 0 };
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
  let position: TransactionHistoryCursor = cursor ?? { revision, queryKey, legacyOffset: 0 };
  let proof: DateProof | undefined;
  let canonical = false;
  if (!cursor) {
    // A global proof valid for this sort also proves every filtered subset.
    // Otherwise it cannot determine a subset's ordering.
    if (canonicalFor(checks.canonical.get(allDatesKey), query.sort)) canonical = true;
    else {
      proof = checks.canonical.get(key) ?? await proveDateOrder(database, query, checkCancelled);
      canonical = canonicalFor(proof, query.sort);
    }
  }

  if (!cursor && !canonical) {
    // Compatibility path: only id/date and search text in bounded SQL batches.
    // Do not retain financial records or search text for the complete history.
    const entries: { id: string; time: number }[] = [];
    let after: TransactionHistoryCursor['after'];
    let batchSize = SCAN_SIZE;
    for (;;) {
      checkCancelled();
      const boundary = pageBoundary('newest', after);
      const range = batchRange('DESC', filter, boundary, batchSize);
      const [result] = await database.executeSql(
        `SELECT rowid AS history_rowid, id, ${TRANSACTION_SORT_SQL} AS history_sort_key, created_at${searchActive(query)
          ? ', merchant_name, description, notes' : ''}
         FROM transactions INDEXED BY idx_transactions_civil_sort
         WHERE ${filter.where} ${boundary.sql} ${range.sql} ORDER BY ${ORDER_KEY_SQL} DESC, created_at DESC, rowid DESC LIMIT ?;`,
        [...filter.values, ...boundary.values, ...range.values, batchSize]);
      checkCancelled();
      const rows = resultSetToRows(result);
      for (const row of rows) {
        // Parse once per row; the comparator below sees identical values.
        if (matchesSearch(row, query.search)) entries.push({ id: readString(row, 'id'), time: new Date(readString(row, 'history_sort_key')).getTime() });
        after = { date: readString(row, 'history_sort_key'), createdAt: readString(row, 'created_at'), rowId: readNumber(row, 'history_rowid') };
      }
      if (rows.length < batchSize) break;
      batchSize = Math.min(batchSize * 2, MAX_SCAN_SIZE);
    }
    // Same stable comparator and input order as the original hook, including NaN for invalid dates.
    entries.sort((a, b) => query.sort === 'newest' ? b.time - a.time : a.time - b.time);
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
    const searching = searchActive(query);
    const matchingIds: string[] = [];
    let batchSize = searching ? SCAN_SIZE : HISTORY_PAGE_SIZE + 1;
    let consumed = 0;
    for (;;) {
      checkCancelled();
      const direction = query.sort === 'newest' ? 'DESC' : 'ASC';
      const boundary = pageBoundary(query.sort, position.after);
      const range = batchRange(direction, filter, boundary, batchSize);
      const [result] = await database.executeSql(
        `SELECT rowid AS history_rowid, ${TRANSACTION_SORT_SQL} AS history_sort_key, ${searching
          ? 'id, created_at, merchant_name, description, notes' : '*'} FROM transactions INDEXED BY idx_transactions_civil_sort
         WHERE ${filter.where} ${boundary.sql} ${range.sql}
         ORDER BY ${ORDER_KEY_SQL} ${direction}, created_at DESC, rowid DESC LIMIT ?;`,
        [...filter.values, ...boundary.values, ...range.values, batchSize]);
      checkCancelled();
      const rows = resultSetToRows(result);
      if (rows.length === 0) hasMore = false;
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        if (!row) continue;
        // Leave the lookahead unconsumed for the next page.
        if ((searching ? matchingIds.length : transactions.length) === HISTORY_PAGE_SIZE) { hasMore = true; break; }
        position = { ...position, after: { date: readString(row, 'history_sort_key'), createdAt: readString(row, 'created_at'),
          rowId: readNumber(row, 'history_rowid') } };
        consumed++;
        if (matchesSearch(row, query.search)) {
          if (searching) matchingIds.push(readString(row, 'id'));
          else transactions.push(map(row));
        }
        // A page filled at a 200-row boundary keeps the cursor that fixed
        // 200-row batches produced there, even when this larger batch is shorter.
        hasMore = index < rows.length - 1 || rows.length === batchSize
          || (searching && consumed % SCAN_SIZE === 0 && matchingIds.length === HISTORY_PAGE_SIZE);
      }
      if ((searching ? matchingIds.length : transactions.length) === HISTORY_PAGE_SIZE || rows.length < batchSize) break;
      // Larger batches avoid re-sorting a large date tie group 200 rows at a time.
      if (searching) batchSize = Math.min(batchSize * 2, MAX_SCAN_SIZE);
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
    if (proof !== undefined) {
      checks.canonical.set(key, proof);
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
