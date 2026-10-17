import { runSharedSQLiteTransaction, SQLiteCommandFailure } from '../../../database/atomicSQLite';
import { isSQLiteParticipant } from '../../../database/managedSQLite';
import { repositorySQLiteDatabase } from '../../../database/sqliteRepositoryScope';
import { createSqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../repositories/sqliteCreditCardRepository';
import type { RegisterCreditCardPaymentParams } from './creditCardTransactionRelations';

type Dependencies = Pick<RegisterCreditCardPaymentParams,
  'accountRepository' | 'creditCardRepository' | 'transactionRepository'>;

export async function withCreditCardPaymentScope<T>(
  dependencies: Dependencies,
  operation: (current: Dependencies) => Promise<T>,
): Promise<T> {
  const databases = [dependencies.accountRepository, dependencies.creditCardRepository,
    dependencies.transactionRepository].map(repositorySQLiteDatabase);
  const database = databases[0];
  // Domain doubles preserve their contract but cannot prove SQLite atomicity.
  if (databases.every(candidate => candidate === undefined)) return operation(dependencies);
  if (!database || databases.some(candidate => candidate !== database)) {
    throw new Error('Los repositorios deben compartir el mismo ámbito SQLite.');
  }
  if (isSQLiteParticipant(database)) return operation(dependencies);
  const result = await runSharedSQLiteTransaction(database, participant => operation({
    accountRepository: createSqliteAccountRepository(participant),
    creditCardRepository: createSqliteCreditCardRepository(participant),
    transactionRepository: createSqliteTransactionRepository(participant),
  }));
  if (result.status === 'confirmed') return result.value;
  if (result.status === 'rolledBack') throw result.error;
  throw new SQLiteCommandFailure(result);
}
