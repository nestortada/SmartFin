import { runSharedSQLiteTransaction, SQLiteCommandFailure } from '../../../database/atomicSQLite';
import { isSQLiteParticipant } from '../../../database/managedSQLite';
import { repositorySQLiteDatabase } from '../../../database/sqliteRepositoryScope';
import { createSqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository, type CreditCardRepository } from '../repositories/sqliteCreditCardRepository';
import { createSqliteCreditCardAlertRepository } from '../repositories/sqliteCreditCardAlertRepository';

export function creditCardManagementRepositories(database: Parameters<typeof createSqliteAccountRepository>[0]) {
  return {
    accountRepository: createSqliteAccountRepository(database),
    creditCardRepository: createSqliteCreditCardRepository(database),
    transactionRepository: createSqliteTransactionRepository(database),
    alertRepository: createSqliteCreditCardAlertRepository(database),
  };
}

export async function withCreditCardManagementScope<T>(
  repository: CreditCardRepository,
  operation: (repository: CreditCardRepository,
    dependencies?: ReturnType<typeof creditCardManagementRepositories>) => Promise<T>,
): Promise<T> {
  const database = repositorySQLiteDatabase(repository);
  if (!database) return operation(repository); // Domain doubles have no SQL guarantee.
  if (isSQLiteParticipant(database)) return operation(repository, creditCardManagementRepositories(database));
  const result = await runSharedSQLiteTransaction(database, participant => {
    const dependencies = creditCardManagementRepositories(participant);
    return operation(dependencies.creditCardRepository, dependencies);
  });
  if (result.status === 'confirmed') return result.value;
  if (result.status === 'rolledBack') throw result.error;
  throw new SQLiteCommandFailure(result);
}
