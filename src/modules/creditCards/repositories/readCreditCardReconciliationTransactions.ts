import { repositorySQLiteDatabase } from '../../../database/sqliteRepositoryScope';
import { readNullableString, readNumber, readString, resultSetToRows } from '../../../database/sqliteRows';
import type { SqliteTransactionRepository } from '../../transactions/repositories/sqliteTransactionRepository';
import type { Transaction } from '../../transactions/types';

export type CreditCardReconciliationTransaction = Pick<Transaction,
  'id' | 'amount' | 'date' | 'civilDate' | 'accountId' | 'targetAccountId' | 'type' | 'direction' | 'status'>;

/** Complete financial candidates, never a visible history page. No SQL sums. */
export async function readCreditCardReconciliationTransactions(
  repository: Pick<SqliteTransactionRepository, 'getTransactions'>,
  accountIds: string[],
): Promise<CreditCardReconciliationTransaction[]> {
  const database = repositorySQLiteDatabase(repository);
  if (!database) return repository.getTransactions();
  if (accountIds.length === 0) return [];
  // Three copies of the IDs must fit the SQLite variable limit on API 24.
  // For unusually many cards the domain still filters the complete candidates.
  const restrictAccounts = accountIds.length <= 300;
  const placeholders = accountIds.map(() => '?').join(',');
  const [result] = await database.executeSql(
    `SELECT id, amount, date, civil_date, account_id, target_account_id, type, direction, status
     FROM transactions INDEXED BY idx_transactions_date
     WHERE status != 'cancelled' AND (
       (type = 'expense' AND direction = 'outflow'${restrictAccounts ? ` AND account_id IN (${placeholders})` : ''})
       OR (type = 'creditCardPayment'${restrictAccounts ? ` AND (account_id IN (${placeholders}) OR target_account_id IN (${placeholders}))` : ''})
     )
     ORDER BY date DESC, created_at DESC;`,
    restrictAccounts ? [...accountIds, ...accountIds, ...accountIds] : [],
  );
  // Preserve getTransactions' reverse date-index traversal and tie order. Using
  // the account index here can reorder equal timestamps and change REAL sums.
  return resultSetToRows(result).map(row => {
    const civilDate = readNullableString(row, 'civil_date');
    return {
      id: readString(row, 'id'), amount: readNumber(row, 'amount'), date: readString(row, 'date'),
      ...(civilDate ? { civilDate } : {}),
      accountId: readString(row, 'account_id'), targetAccountId: readNullableString(row, 'target_account_id'),
      type: readString(row, 'type') as Transaction['type'],
      direction: readString(row, 'direction') as Transaction['direction'],
      status: readString(row, 'status') as Transaction['status'],
    };
  });
}
