// Phase 5E.5: financial figures and canonical table digests shared by the synthetic
// Android harness (live database, before capture) and the isolated Node verifier
// (independent read-only copy of the published SQLite). Read paths only: nothing
// here writes, so the verifier can open its copy read-only.
import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import { resultSetToRows } from '../../src/database/sqliteRows';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { getCreditCardsOverview } from '../../src/modules/creditCards/useCases/getCreditCardsOverview';
import { getDebitCardsOverview } from '../../src/modules/accounts/useCases/getDebitCardsOverview';
import { createSqliteSubscriptionRepository } from '../../src/modules/subscriptions/repositories/sqliteSubscriptionRepository';
import { createSqliteSharedExpenseRepository } from '../../src/modules/transactions/repositories/sqliteSharedExpenseRepository';

/** Fixed civil reference: the representative fixtures end on 2026-10-25 (Bogotá). */
export const RECOVERABILITY_REFERENCE = new Date('2026-10-25T17:00:00.000Z');
const PAGE = 2000;

type Rows = Record<string, unknown>[];
const rowsOf = async (database: SmartFinSQLiteDatabase, sql: string, values: unknown[] = []): Promise<Rows> =>
  resultSetToRows((await database.executeSql(sql, values as never))[0]) as Rows;
const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"';

export type TableDigestSink = {
  begin: (table: string) => Promise<void>;
  append: (table: string, text: string) => Promise<void>;
  finish: (table: string) => Promise<{ sha256: string; bytes: number }>;
};

/**
 * Every table, every column, every row. Rows are JSON lines in column order, ordered
 * by rowid: the published SQLite is a byte copy of the live file, so rowids match.
 */
export async function canonicalTables(database: SmartFinSQLiteDatabase, sink: TableDigestSink) {
  const result: { table: string; columns: string[]; rows: number; sha256: string; bytes: number }[] = [];
  const tables = await rowsOf(database, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  for (const { name } of tables) {
    if (typeof name !== 'string') throw new Error('Invalid table name');
    const columns = (await rowsOf(database, `PRAGMA table_info(${quote(name)})`)).map(c => String(c.name));
    const select = columns.map(quote).join(',');
    await sink.begin(name);
    let count = 0;
    for (let offset = 0; ; offset += PAGE) {
      const page = await rowsOf(database, `SELECT ${select} FROM ${quote(name)} ORDER BY rowid LIMIT ${PAGE} OFFSET ${offset}`);
      if (!page.length) break;
      // Explicit column order: drivers may differ in object key order.
      await sink.append(name, page.map(row => JSON.stringify(columns.map(c => row[c] ?? null))).join('\n') + '\n');
      count += page.length;
      if (page.length < PAGE) break;
    }
    result.push({ table: name, columns, rows: count, ...(await sink.finish(name)) });
  }
  return result;
}

export async function recoverabilityFigures(database: SmartFinSQLiteDatabase, reference = RECOVERABILITY_REFERENCE) {
  const months = (await rowsOf(database, "SELECT DISTINCT substr(COALESCE(civil_date, substr(date,1,10)),1,7) AS m FROM transactions WHERE date GLOB '[0-9][0-9][0-9][0-9]-*' ORDER BY m"))
    .map(r => String(r.m));
  const dashboard: Record<string, unknown> = {};
  for (const month of months) {
    // Mid-month civil noon in Bogotá; the summary reads that month and its 30-day window.
    const summary = await getDashboardSummaryFromDb(database, new Date(`${month}-15T17:00:00.000Z`));
    dashboard[month] = summary;
  }
  const current = await getDashboardSummaryFromDb(database, reference);
  const accountRepository = createSqliteAccountRepository(database);
  const transactionRepository = createSqliteTransactionRepository(database);
  const accounts = await accountRepository.getAccounts();
  const creditCards = await getCreditCardsOverview(createSqliteCreditCardRepository(database), transactionRepository, reference);
  const debitCards = await getDebitCardsOverview({ accountRepository, transactionRepository }, reference);
  const subscriptionRepository = createSqliteSubscriptionRepository(database);
  const subscriptions = await subscriptionRepository.getSubscriptions();
  const charges = await subscriptionRepository.getCharges('0001-01-01', '9999-12-31', ['pending', 'paid', 'skipped', 'overdue']);
  const shared = await createSqliteSharedExpenseRepository(database).getState();
  const history = {
    newest: (await transactionRepository.getTransactionPage({ month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'newest' })),
    oldest: (await transactionRepository.getTransactionPage({ month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'oldest' })),
  };
  const aiReceipts = await rowsOf(database, "SELECT * FROM ai_command_drafts WHERE phase='confirmed' ORDER BY id");
  const audit = {
    revision: await rowsOf(database, 'SELECT * FROM financial_data_revision'),
    balanceHistory: await rowsOf(database, 'SELECT count(*) AS n, total(balance_amount) AS t FROM account_balance_history'),
    migrations: await rowsOf(database, 'SELECT * FROM schema_migrations ORDER BY 1'),
  };
  const counts = await rowsOf(database, "SELECT type, status, count(*) AS n, total(amount) AS t FROM transactions GROUP BY type, status ORDER BY type, status");
  return { months: months.length, current, dashboard, accounts, creditCards, debitCards, subscriptions, charges, shared,
    history: { newest: history.newest, oldest: history.oldest }, aiReceipts, audit, counts };
}
