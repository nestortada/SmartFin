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
  };
}
