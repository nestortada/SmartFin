import { runSharedSQLiteTransaction, SQLiteCommandFailure } from '../../../database/atomicSQLite';
import { isSQLiteParticipant } from '../../../database/managedSQLite';
import { repositorySQLiteDatabase } from '../../../database/sqliteRepositoryScope';
import { createSqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import { createSqliteCreditCardRepository } from '../../creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteTransactionRepository } from '../repositories/sqliteTransactionRepository';
import type { SaveManualTransactionParams } from './saveManualTransaction';
import type { Transaction } from '../types';

type Dependencies = Pick<SaveManualTransactionParams,
  'accountRepository' | 'creditCardRepository' | 'transactionRepository'>;

export async function withManualTransactionScope<T>(
  dependencies: Dependencies,
  operation: (current: Dependencies, persisted: boolean) => Promise<T>,
): Promise<T> {
  const databases = [dependencies.accountRepository, dependencies.creditCardRepository,
    dependencies.transactionRepository].map(repositorySQLiteDatabase);
  const database = databases[0];
  if (databases.every(candidate => candidate === undefined)) {
    // In-memory domain doubles have no SQLite guarantee.
    return operation(dependencies, false);
  }
  if (!database || databases.some(candidate => candidate !== database)) {
    throw new Error('Los repositorios deben compartir el mismo ámbito SQLite.');
  }
  if (isSQLiteParticipant(database)) return operation(dependencies, true);
  const result = await runSharedSQLiteTransaction(database, participant => operation({
    accountRepository: createSqliteAccountRepository(participant),
    creditCardRepository: createSqliteCreditCardRepository(participant),
    transactionRepository: createSqliteTransactionRepository(participant),
  }, true));
  if (result.status === 'confirmed') return result.value;
  if (result.status === 'rolledBack') throw result.error;
  throw new SQLiteCommandFailure(result);
}

export class ManualTransactionConflict extends Error {
  constructor() {
    super('El movimiento cambió o fue eliminado. Actualiza el historial antes de volver a editarlo.');
  }
}

export function requireCurrentTransaction(expected: Transaction, current?: Transaction): Transaction {
  // Compare all persisted fields, even when two writes share updatedAt's millisecond.
  const keys = new Set([...Object.keys(expected), ...Object.keys(current ?? {})]);
  if (!current || [...keys].some(key =>
    expected[key as keyof Transaction] !== current[key as keyof Transaction])) {
    throw new ManualTransactionConflict();
  }
  return current;
}
