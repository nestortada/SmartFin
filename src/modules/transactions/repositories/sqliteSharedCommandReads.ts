import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { registerSQLiteRepository } from '../../../database/sqliteRepositoryScope';
import {
  readNumber,
  readString,
  resultSetToRows,
} from '../../../database/sqliteRows';
import type { Transaction } from '../types';
import type { SharedEffectTransaction } from './SharedExpenseRepository';
import { SHARED_EFFECT_CONTRIBUTIONS as effects } from '../useCases/sharedCommandEffects';
import {
  createSqliteTransactionRepository,
  rowToTransaction,
} from './sqliteTransactionRepository';

/** Lives only inside the existing BEGIN IMMEDIATE; no persisted money cache. */
export function sqliteSharedCommandReads(database: SmartFinSQLiteDatabase) {
  const original = createSqliteTransactionRepository(database);
  const previous = new Map<string, Transaction | undefined>();
  const previousRowIds = new Map<string, bigint>();
  const remember = async (id: string) => {
    if (previous.has(id)) return;
    const [result] = await database.executeSql(
      'SELECT *, CAST(rowid AS TEXT) AS command_rowid FROM transactions WHERE id = ?;',
      [id],
    );
    const row = resultSetToRows(result)[0];
    previous.set(id, row ? rowToTransaction(row) : undefined);
    if (row) previousRowIds.set(id, BigInt(readString(row, 'command_rowid')));
  };
  const transactionRepository = registerSQLiteRepository(database, {
    ...original,
    saveTransactions: async (transactions: Transaction[]) => {
      for (const transaction of transactions) await remember(transaction.id);
      await original.saveTransactions(transactions);
    },
    deleteTransaction: async (id: string) => {
      await remember(id);
      await original.deleteTransaction(id);
    },
  });
  return {
    transactionRepository,
    readEffectTransactions: async (): Promise<SharedEffectTransaction[]> => {
      const [result] =
        await database.executeSql(`SELECT id, amount, contribution FROM (
          SELECT t.id, t.amount, t.date, t.created_at,
            CASE WHEN t.type = 'income' AND t.direction = 'inflow' THEN ${effects.income}
                 WHEN t.type = 'expense' AND t.direction = 'outflow' THEN ${effects.expense} ELSE 0 END +
            CASE WHEN a.type IN ('cash','bankAccount','savingsAccount')
                   AND (t.payment_method IS NULL OR t.payment_method <> 'credit')
                 THEN CASE WHEN t.direction = 'inflow' THEN ${effects.bankInflow}
                           WHEN t.direction = 'outflow' THEN ${effects.bankOutflow} ELSE 0 END ELSE 0 END AS contribution
          FROM transactions t INDEXED BY idx_transactions_date LEFT JOIN accounts a ON a.id = t.account_id
          WHERE t.status = 'posted'
        ) WHERE contribution > 0 ORDER BY date DESC, created_at DESC;`);
      return resultSetToRows(result).map(row => {
        const contribution = readNumber(row, 'contribution');
        if (
          !Number.isInteger(contribution) ||
          contribution < 1 ||
          contribution > 15
        )
          throw new Error('Clasificación de efecto financiero inválida.');
        return {
          id: readString(row, 'id'),
          amount: readNumber(row, 'amount'),
          contribution,
        };
      });
    },
    readTransactionChanges: async () => {
      const transactions: Transaction[] = [];
      const deletedTransactionIds: string[] = [];
      // Same ledger order as the public result, including accompanying rows.
      if (previous.size) {
        const ids = [...previous.keys()];
        const current: { transaction: Transaction; rowId: bigint }[] = [];
        // Card reconciliation can write a large batch; stay below Android's bind limit.
        for (let offset = 0; offset < ids.length; offset += 300) {
          const chunk = ids.slice(offset, offset + 300);
          const [result] = await database.executeSql(
            `SELECT *, CAST(rowid AS TEXT) AS command_rowid FROM transactions WHERE id IN (${chunk
              .map(() => '?')
              .join(',')});`,
            chunk,
          );
          current.push(
            ...resultSetToRows(result).map(row => ({
              transaction: rowToTransaction(row),
              rowId: BigInt(readString(row, 'command_rowid')),
            })),
          );
        }
        const descending = (left: string, right: string) =>
          left === right ? 0 : left > right ? -1 : 1;
        const descendingRowId = (left: bigint, right: bigint) =>
          left === right ? 0 : left > right ? -1 : 1;
        current.sort(
          (a, b) =>
            descending(a.transaction.date, b.transaction.date) ||
            descending(a.transaction.createdAt, b.transaction.createdAt) ||
            descendingRowId(a.rowId, b.rowId),
        );
        // Read through the same mapper as getTransactions (including nullable keys).
        for (const { transaction } of current) {
          if (
            JSON.stringify(transaction) !==
            JSON.stringify(previous.get(transaction.id))
          )
            transactions.push(transaction);
        }
        // Preserve the original before-ledger ordering for deleted IDs.
        const currentIds = new Set(current.map(r => r.transaction.id));
        const removed = [...previous.values()].filter(
          (t): t is Transaction => !!t && !currentIds.has(t.id),
        );
        removed.sort((a, b) => {
          return (
            descending(a.date, b.date) ||
            descending(a.createdAt, b.createdAt) ||
            descendingRowId(
              previousRowIds.get(a.id)!,
              previousRowIds.get(b.id)!,
            )
          );
        });
        deletedTransactionIds.push(...removed.map(t => t.id));
      }
      return { transactions, deletedTransactionIds };
    },
  };
}
