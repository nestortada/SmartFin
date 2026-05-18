import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';

export type FinancialDataRepository = {
  deleteFinancialData: () => Promise<void>;
};

const FINANCIAL_TABLES_IN_DELETE_ORDER = [
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
    deleteFinancialData: async () => {
      await database.executeSql('PRAGMA foreign_keys = OFF;');

      try {
        for (const tableName of FINANCIAL_TABLES_IN_DELETE_ORDER) {
          await database.executeSql(`DELETE FROM ${tableName};`);
        }
      } finally {
        await database.executeSql('PRAGMA foreign_keys = ON;');
      }
    },
  };
}
