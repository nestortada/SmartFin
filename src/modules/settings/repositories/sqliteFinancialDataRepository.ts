import { runSQLiteTransaction, runSharedSQLiteTransaction, type SQLiteCommandResult } from '../../../database/atomicSQLite';
import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { borrowSQLiteDatabase } from '../../../database/managedSQLite';
import { withExclusiveDatabase, type DatabasePermit } from '../../../database/databaseCoordination';
import { resultSetToRows } from '../../../database/sqliteRows';
import { DELETION_RECEIPT_PREFIX, FINANCIAL_LIFECYCLE_KEY, parseDeletionIntent, requireDeletionId,
  type DeletionPlatformInventory, type FinancialDeletionIntent } from '../types/financialDeletion';

export type FinancialDataRepository = {
  deleteFinancialData: (id: string, inventory: DeletionPlatformInventory, permit?: DatabasePermit) => Promise<SQLiteCommandResult<FinancialDeletionIntent>>;
};

const FINANCIAL_TABLES_IN_DELETE_ORDER = [
  'shared_commands',
  'shared_loss_events',
  'shared_allocations',
  'shared_returns',
  'shared_receipts',
  'transaction_splits',
  'shared_expenses',
  'shared_contacts',
  'subscription_reminders',
  'subscription_occurrences',
  'ai_command_drafts',
  'transaction_tax_tags',
  'tax_tags',
  'receipt_attachments',
  'installment_purchases',
  'credit_card_statements',
  'credit_card_profiles',
  'amortization_schedule_items',
  'loans',
  'recurring_subscriptions',
  'envelope_movements',
  'envelopes',
  'budgets',
  'account_balance_history',
  'transactions',
  'merchant_mappings',
  'subcategories',
  'categories',
  'cash_flow_events',
  'smart_alerts',
  'financial_health_scores',
  'financial_goals',
  'investment_assets',
  'backup_records',
  'raw_financial_messages',
  'accounts',
] as const;

export function createSqliteFinancialDataRepository(
  database: SmartFinSQLiteDatabase,
): FinancialDataRepository {
  return {
    deleteFinancialData: async (id, inventory, permit) => {
      requireDeletionId(id);
      return withExclusiveDatabase(async owner => {
        const owned = borrowSQLiteDatabase(database, owner);
        // Read IDs only after native participants have drained. No OS effects here.
        const [reminders] = await owned.executeSql('SELECT id FROM subscription_reminders ORDER BY id;');
        const [settings] = await owned.executeSql('SELECT setting_value FROM app_settings WHERE setting_key = ?;', [FINANCIAL_LIFECYCLE_KEY]);
        const previous = resultSetToRows(settings);
        const current = previous.length ? parseDeletionIntent(previous[0]!.setting_value) : undefined;
        if (current && current.phase !== 'completed') throw new Error('Hay una limpieza financiera pendiente.');
        const intent: FinancialDeletionIntent = { version: 1, id, epoch: id,
          previousEpoch: current?.epoch ?? 'legacy', phase: 'cleanupPending',
          ...inventory, reminderIds: [...new Set([...(inventory.reminderIds ?? []), ...resultSetToRows(reminders).map(row => {
            if (typeof row.id !== 'string') throw new Error('Recordatorio inválido.');
            return row.id;
          })])].sort() };
        parseDeletionIntent(JSON.stringify(intent));
        return runSharedSQLiteTransaction(owned, async participant => runSQLiteTransaction(participant, function* () {
        const receipt = yield { sql: 'SELECT setting_value FROM app_settings WHERE setting_key = ?;', values: [DELETION_RECEIPT_PREFIX + id] };
        if (receipt.length) throw new Error('Este ID de borrado ya fue utilizado.');
        for (const tableName of FINANCIAL_TABLES_IN_DELETE_ORDER)
          yield { sql: `DELETE FROM ${tableName};` };
        const updatedAt = new Date().toISOString();
        // app_settings is preserved; public settings writes touch only their three explicit keys.
        yield { sql: 'INSERT OR REPLACE INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?);',
          values: [FINANCIAL_LIFECYCLE_KEY, JSON.stringify(intent), updatedAt] };
        yield { sql: 'INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?);',
          values: [DELETION_RECEIPT_PREFIX + id, JSON.stringify({ version: 1, id, epoch: id }), updatedAt] };
        return intent;
        }), owner);
      }, permit);
    },
  };
}
