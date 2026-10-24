import { repositorySQLiteDatabase } from '../../../database/sqliteRepositoryScope';
import { resultSetToRows } from '../../../database/sqliteRows';
import { rowToTransaction, type SqliteTransactionRepository } from '../../transactions/repositories/sqliteTransactionRepository';

/** Full matching history, with the same order as getTransactions; never a visible page. */
export async function readUnclassifiedCreditTransactions(
  repository: Pick<SqliteTransactionRepository, 'getTransactions'>,
  accountId: string,
) {
  const database = repositorySQLiteDatabase(repository);
  if (!database) return repository.getTransactions();
  const [result] = await database.executeSql(
    `SELECT * FROM transactions INDEXED BY idx_transactions_date
     WHERE account_id = ? AND payment_method = ? ORDER BY date DESC, created_at DESC;`,
    [accountId, 'credit'],
  );
  return resultSetToRows(result).map(rowToTransaction);
}
