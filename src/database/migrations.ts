import type { SmartFinSQLiteDatabase } from './sqliteDatabase';
import { runSQLiteTransaction } from './atomicSQLite';
import { SHARED_LOSS_SCHEMA } from '../modules/transactions/database/sharedLossSchema';
import { MOVEMENT_DATE_COLUMNS, SHARED_SPLIT_COLUMNS, SHARED_EXPENSE_SCHEMA, SHARED_EXPENSE_INDEXES,
  SHARED_EXPENSE_TRIGGERS } from '../modules/transactions/database/sharedExpenseSchema';
import {
  SUBSCRIPTION_COLUMNS,
  SUBSCRIPTION_SCHEMA,
} from '../modules/subscriptions/database/schema';

export async function applyVersionedMigrations(
  database: SmartFinSQLiteDatabase,
): Promise<void> {
  await database.executeSql(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);',
  );
  await runSQLiteTransaction(database, function* () {
    const versions = yield { sql: 'SELECT version FROM schema_migrations;' };
    if (!versions.some(row => row.version === 1)) {
      const additions = [
        ['transactions', 'payment_method', 'TEXT'],
        ['transactions', 'credit_card_hint', 'TEXT'],
        ['transactions', 'dedupe_key', 'TEXT'],
        ['ai_command_drafts', 'messages_json', "TEXT NOT NULL DEFAULT '[]'"],
        [
          'ai_command_drafts',
          'clarification_history_json',
          "TEXT NOT NULL DEFAULT '[]'",
        ],
      ] as const;
      for (const [table, column, definition] of additions) {
        const columns = yield { sql: `PRAGMA table_info(${table});` };
        if (!columns.some(row => row.name === column))
          yield {
            sql: `ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`,
          };
      }
      yield {
        sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_dedupe_key ON transactions(dedupe_key) WHERE dedupe_key IS NOT NULL;',
      };
      yield {
        sql: "INSERT INTO schema_migrations VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));",
      };
    }
    if (!versions.some(row => row.version === 2)) {
      const columns = yield {
        sql: 'PRAGMA table_info(recurring_subscriptions);',
      };
      for (const [column, definition] of SUBSCRIPTION_COLUMNS) {
        if (!columns.some(row => row.name === column))
          yield {
            sql: `ALTER TABLE recurring_subscriptions ADD COLUMN ${column} ${definition};`,
          };
      }
      for (const sql of SUBSCRIPTION_SCHEMA) yield { sql };
      // Preserve the legacy next date; validation/quarantine belongs to the domain.
      yield {
        sql: `UPDATE recurring_subscriptions SET anchor_date = substr(next_charge_date,1,10), generation_cursor = substr(next_charge_date,1,10)
        WHERE anchor_date IS NULL AND next_charge_date IS NOT NULL;`,
      };
      for (const table of [
        'subscription_occurrences',
        'subscription_reminders',
      ]) {
        for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
          yield {
            sql: `CREATE TRIGGER IF NOT EXISTS backup_revision_${table}_${event.toLowerCase()} AFTER ${event} ON ${table}
            BEGIN UPDATE financial_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1; END;`,
          };
        }
      }
      yield {
        sql: "INSERT INTO schema_migrations VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ','now'));",
      };
    }
    if (!versions.some(row => row.version === 3)) {
      for (const sql of SHARED_EXPENSE_SCHEMA) yield { sql };
      for (const [table, additions] of [['transactions', MOVEMENT_DATE_COLUMNS], ['transaction_splits', SHARED_SPLIT_COLUMNS]] as const) {
        const columns = yield { sql: `PRAGMA table_info(${table});` };
        for (const [column, definition] of additions) {
          if (!columns.some(row => row.name === column)) yield { sql: `ALTER TABLE ${table} ADD COLUMN ${column} ${definition};` };
        }
      }
      for (const sql of [...SHARED_EXPENSE_INDEXES, ...SHARED_EXPENSE_TRIGGERS]) yield { sql };
      yield { sql: "INSERT INTO schema_migrations VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ','now'));" };
    }
    if (!versions.some(row => row.version === 4)) {
      for (const sql of SHARED_LOSS_SCHEMA) yield { sql };
      yield { sql: "INSERT INTO schema_migrations VALUES (4, strftime('%Y-%m-%dT%H:%M:%fZ','now'));" };
    }
    return undefined;
  });
}
