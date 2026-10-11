import { upsertSQLiteRow } from '../../../database/upsertSQLiteRow';
import { runSQLiteTransaction } from '../../../database/atomicSQLite';
import {
  loadSubscriptionState,
  persistSubscriptionState,
} from '../../subscriptions/repositories/sqliteSubscriptionRepository';
import {
  reconcileTransactionChanges,
  synchronizeSubscriptionState,
} from '../../subscriptions/useCases/subscriptionLifecycle';
import { civilDate } from '../../subscriptions/useCases/recurrence';
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
  TransactionPaymentMethod,
  TransactionStatus,
  TransactionType,
} from '../types';
import type {
  TransactionAmount,
  TransactionAmountQuery,
  TransactionDateRangeQuery,
  TransactionDayCount,
} from '../types/TransactionQuery';

export type SqliteTransactionRepository = {
  getTransactions: () => Promise<Transaction[]>;
  getTransactionAmounts: (
    query: TransactionAmountQuery,
  ) => Promise<TransactionAmount[]>;
  getTransactionCountsByDay: (
    query: TransactionDateRangeQuery,
  ) => Promise<TransactionDayCount[]>;
  saveTransactions: (transactions: Transaction[]) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  deleteInstallmentPurchasesByTransactionId: (transactionId: string) => Promise<void>;
  updateTransactionCategory: (id: string, categoryId: string | null) => Promise<void>;
  updateTransactionsCategoryByDescription: (description: string, categoryId: string | null) => Promise<void>;
  saveMerchantMapping: (rawMerchantText: string, categoryId: string) => Promise<void>;
  getMerchantMapping: (rawMerchantText: string) => Promise<string | null>;
};

export function rowToTransaction(row: SQLiteRow): Transaction {
  return {
    id: readString(row, 'id'),
    amount: readNumber(row, 'amount'),
    currency: readString(row, 'currency') as CurrencyCode,
    description: readString(row, 'description'),
    date: readString(row, 'date'),
    accountId: readString(row, 'account_id'),
    categoryId: readNullableString(row, 'category_id'),
    subcategoryId: readNullableString(row, 'subcategory_id'),
    type: readString(row, 'type') as TransactionType,
    direction: readString(row, 'direction') as TransactionDirection,
    status: readString(row, 'status') as TransactionStatus,
    targetAccountId: readNullableString(row, 'target_account_id'),
    merchantName: readNullableString(row, 'merchant_name'),
    paymentMethod: readNullableString(row, 'payment_method') as TransactionPaymentMethod | undefined,
    creditCardHint: readNullableString(row, 'credit_card_hint'),
    dedupeKey: readNullableString(row, 'dedupe_key'),
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
          subcategory_id,
          type,
          direction,
          status,
          target_account_id,
          merchant_name,
          payment_method,
          credit_card_hint,
          dedupe_key,
          notes,
          created_at,
          updated_at
        FROM transactions
        ORDER BY date DESC, created_at DESC;`,
      );

      return resultSetToRows(resultSet).map(rowToTransaction);
    },
    getTransactionAmounts: async query => {
      if (query.operations.length === 0) return [];
      const operations = query.operations
        .map(() => '(type = ? AND direction = ?)')
        .join(' OR ');
      const [resultSet] = await database.executeSql(
        `SELECT amount, type, direction FROM transactions
         WHERE date >= ? AND date < ? AND status = ?
           AND substr(date, 1, ?) = ? AND (${operations})
         ORDER BY date DESC, created_at DESC;`,
        [
          query.startDate,
          query.endDateExclusive,
          query.status,
          query.datePrefix.length,
          query.datePrefix,
          ...query.operations.flatMap(operation => [
            operation.type,
            operation.direction,
          ]),
        ],
      );
      // Keep the same order as getTransactions: REAL amounts are summed in JS.
      return resultSetToRows(resultSet).map(row => ({
        amount: readNumber(row, 'amount'),
        type: readString(row, 'type') as Transaction['type'],
        direction: readString(row, 'direction') as Transaction['direction'],
      }));
    },
    getTransactionCountsByDay: async query => {
      const [resultSet] = await database.executeSql(
        `SELECT substr(date, 1, 10) AS date, COUNT(*) AS count FROM transactions
         WHERE date >= ? AND date < ? AND status = ?
         GROUP BY substr(date, 1, 10);`,
        [query.startDate, query.endDateExclusive, query.status],
      );
      return resultSetToRows(resultSet).map(row => ({
        date: readString(row, 'date'),
        count: readNumber(row, 'count'),
      }));
    },
    saveTransactions: async transactions => {
      const date = new Date();
      await runSQLiteTransaction(database, function* () {
        const state = yield* loadSubscriptionState({
          today: civilDate(date),
          transactionIds: transactions.map(transaction => transaction.id),
        });
        const before = JSON.parse(JSON.stringify(state)) as typeof state;
        for (const transaction of transactions) {
          yield* upsertSQLiteRow('transactions', {
            id: transaction.id, amount: transaction.amount, currency: transaction.currency,
            description: transaction.description, date: transaction.date, account_id: transaction.accountId,
            category_id: transaction.categoryId ?? null, subcategory_id: transaction.subcategoryId ?? null,
            type: transaction.type, direction: transaction.direction, status: transaction.status,
            target_account_id: transaction.targetAccountId ?? null, merchant_name: transaction.merchantName ?? null,
            payment_method: transaction.paymentMethod ?? null, credit_card_hint: transaction.creditCardHint ?? null,
            dedupe_key: transaction.dedupeKey ?? null, notes: transaction.notes ?? null,
            created_at: transaction.createdAt, updated_at: transaction.updatedAt,
          });
        }

        reconcileTransactionChanges(
          state,
          transactions,
          [],
          civilDate(date),
          date.toISOString(),
        );
        state.transactions = [
          ...state.transactions.filter(
            tx => !transactions.some(next => next.id === tx.id),
          ),
          ...transactions,
        ];
        synchronizeSubscriptionState(
          state,
          civilDate(date),
          date.toISOString(),
        );
        yield* persistSubscriptionState(before, state);
        return undefined;
      });
    },
    deleteTransaction: async id => {
      const date = new Date();
      await runSQLiteTransaction(database, function* () {
        const state = yield* loadSubscriptionState({
          today: civilDate(date),
          transactionId: id,
        });
        const before = JSON.parse(JSON.stringify(state)) as typeof state;
        reconcileTransactionChanges(
          state,
          [],
          [id],
          civilDate(date),
          date.toISOString(),
        );
        state.transactions = state.transactions.filter(tx => tx.id !== id);
        synchronizeSubscriptionState(
          state,
          civilDate(date),
          date.toISOString(),
        );
        yield* persistSubscriptionState(before, state);
        for (const table of [
          'envelope_movements',
          'amortization_schedule_items',
          'installment_purchases',
          'receipt_attachments',
          'transaction_splits',
        ]) {
          yield {
            sql: `DELETE FROM ${table} WHERE transaction_id = ?;`,
            values: [id],
          };
        }
        yield { sql: 'DELETE FROM transactions WHERE id = ?;', values: [id] };
        return undefined;
      });
    },
    deleteInstallmentPurchasesByTransactionId: async transactionId => {
      await database.executeSql('DELETE FROM installment_purchases WHERE transaction_id = ?;', [transactionId]);
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
