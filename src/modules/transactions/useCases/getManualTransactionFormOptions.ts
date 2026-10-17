import type { Transaction } from '../types';
import {
  readCurrentManualTransaction,
  type SqliteTransactionRepository,
} from '../repositories/sqliteTransactionRepository';

export async function getManualTransactionFormOptions(
  repository: Pick<SqliteTransactionRepository, 'getTransactions'>,
  transaction: Transaction,
): Promise<{ transferTaxCharged: boolean }> {
  return {
    transferTaxCharged:
      transaction.type === 'internalTransfer' &&
      Boolean(
        await readCurrentManualTransaction(
          repository,
          `${transaction.id}-4x1000`,
        ),
      ),
  };
}
