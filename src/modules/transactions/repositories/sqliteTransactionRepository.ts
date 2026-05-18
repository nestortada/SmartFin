import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import {
  readNullableString,
  readNumber,
  readString,
  resultSetToRows,
  type SQLiteRow,
} from '../../../database/sqliteRows';
import type { CurrencyCode } from '../../../shared/types';
import type {
  Transaction,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
} from '../types';

export type SqliteTransactionRepository = {
  getTransactions: () => Promise<Transaction[]>;
  saveTransactions: (transactions: Transaction[]) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  updateTransactionCategory: (id: string, categoryId: string | null) => Promise<void>;
  updateTransactionsCategoryByDescription: (description: string, categoryId: string | null) => Promise<void>;
  saveMerchantMapping: (rawMerchantText: string, categoryId: string) => Promise<void>;
  getMerchantMapping: (rawMerchantText: string) => Promise<string | null>;
};

function rowToTransaction(row: SQLiteRow): Transaction {
  return {
    id: readString(row, 'id'),
    amount: readNumber(row, 'amount'),
    currency: readString(row, 'currency') as CurrencyCode,
    description: readString(row, 'description'),
    date: readString(row, 'date'),
    accountId: readString(row, 'account_id'),
    categoryId: readNullableString(row, 'category_id'),
    type: readString(row, 'type') as TransactionType,
    direction: readString(row, 'direction') as TransactionDirection,
    status: readString(row, 'status') as TransactionStatus,
    targetAccountId: readNullableString(row, 'target_account_id'),
    merchantName: readNullableString(row, 'merchant_name'),
    notes: readNullableString(row, 'notes'),
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
  };
}

export function createSqliteTransactionRepository(
  database: SmartFinSQLiteDatabase,
): SqliteTransactionRepository {
  return {
    getTransactions: async () => {
      const [resultSet] = await database.executeSql(
        `SELECT
          id,
          amount,
          currency,
          description,
          date,
          account_id,
          category_id,
          type,
          direction,
          status,
          target_account_id,
          merchant_name,
          notes,
          created_at,
          updated_at
        FROM transactions
        ORDER BY date DESC, created_at DESC;`,
      );

      return resultSetToRows(resultSet).map(rowToTransaction);
    },
    saveTransactions: async transactions => {
      for (const transaction of transactions) {
        await database.executeSql(
          `INSERT OR REPLACE INTO transactions (
            id,
            amount,
            currency,
            description,
            date,
            account_id,
            category_id,
            type,
            direction,
            status,
            target_account_id,
            merchant_name,
            notes,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            transaction.id,
            transaction.amount,
            transaction.currency,
            transaction.description,
            transaction.date,
            transaction.accountId,
            transaction.categoryId ?? null,
            transaction.type,
            transaction.direction,
            transaction.status,
            transaction.targetAccountId ?? null,
            transaction.merchantName ?? null,
            transaction.notes ?? null,
            transaction.createdAt,
            transaction.updatedAt,
          ],
        );
      }
    },
    deleteTransaction: async id => {
      // Delete references from dependent tables to prevent constraint violations
      await database.executeSql('DELETE FROM envelope_movements WHERE transaction_id = ?;', [id]);
      await database.executeSql('DELETE FROM amortization_schedule_items WHERE transaction_id = ?;', [id]);
      await database.executeSql('DELETE FROM installment_purchases WHERE transaction_id = ?;', [id]);
      await database.executeSql('DELETE FROM receipt_attachments WHERE transaction_id = ?;', [id]);
      await database.executeSql('DELETE FROM transaction_splits WHERE transaction_id = ?;', [id]);
      await database.executeSql('DELETE FROM transactions WHERE id = ?;', [id]);
    },
    updateTransactionCategory: async (id, categoryId) => {
      await database.executeSql(
        'UPDATE transactions SET category_id = ?, updated_at = ? WHERE id = ?;',
        [categoryId, new Date().toISOString(), id]
      );
    },
    updateTransactionsCategoryByDescription: async (description, categoryId) => {
      await database.executeSql(
        'UPDATE transactions SET category_id = ?, updated_at = ? WHERE description = ? OR merchant_name = ?;',
        [categoryId, new Date().toISOString(), description, description]
      );
    },
    saveMerchantMapping: async (rawMerchantText, categoryId) => {
      const id = 'mapping_' + Date.now();
      const now = new Date().toISOString();
      await database.executeSql(
        `INSERT OR REPLACE INTO merchant_mappings (
          id, raw_merchant_text, normalized_merchant_name, category_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?);`,
        [id, rawMerchantText, rawMerchantText, categoryId, now, now]
      );
    },
    getMerchantMapping: async rawMerchantText => {
      const [resultSet] = await database.executeSql(
        'SELECT category_id FROM merchant_mappings WHERE raw_merchant_text = ? OR normalized_merchant_name = ?;',
        [rawMerchantText, rawMerchantText]
      );
      const rows = resultSetToRows(resultSet);
      const firstRow = rows[0];
      if (firstRow) {
        return readNullableString(firstRow, 'category_id') ?? null;
      }
      return null;
    },
  };
}
