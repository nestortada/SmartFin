import { mockAccountRepository } from '../modules/accounts';
import { createSqliteAccountRepository } from '../modules/accounts/repositories/sqliteAccountRepository';
import { mockCategoryRepository } from '../modules/categories';
import { createSqliteCategoryRepository } from '../modules/categories/repositories/sqliteCategoryRepository';
import { mockTransactionRepository } from '../modules/transactions';
import { createSqliteTransactionRepository } from '../modules/transactions/repositories/sqliteTransactionRepository';

import { openSmartFinDatabase } from './sqliteDatabase';

export async function seedSmartFinDatabase(referenceDate = new Date()): Promise<void> {
  const database = await openSmartFinDatabase();
  const accountRepository = createSqliteAccountRepository(database);
  const categoryRepository = createSqliteCategoryRepository(database);
  const transactionRepository = createSqliteTransactionRepository(database);

  await accountRepository.saveAccounts(mockAccountRepository.getAccounts());
  await categoryRepository.saveCategories(mockCategoryRepository.getCategories());
  await transactionRepository.saveTransactions(
    await Promise.resolve(mockTransactionRepository.getTransactions(referenceDate)),
  );
}
