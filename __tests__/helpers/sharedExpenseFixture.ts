import { realSQLite } from './realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../../src/database/migrations';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteSharedExpenseRepository } from '../../src/modules/transactions/repositories/sqliteSharedExpenseRepository';
import { createSharedExpenseApi } from '../../src/modules/transactions/useCases/createSharedExpenseApi';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import {
  saveManualTransaction,
  type SaveManualTransactionParams,
} from '../../src/modules/transactions/useCases/saveManualTransaction';

export const SHARED_TEST_DATE = new Date('2026-10-11T12:00:00.000Z');
export async function sharedExpenseFixture(options: { syntheticPath?: string } = {}) {
  const sql = realSQLite(options);
  for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  sql.native
    .exec(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at)
    VALUES ('bank','Davivienda','bankAccount','active','COP',1000000,NULL,'2026-01-01','2026-01-01'),
    ('target','Nequi','bankAccount','active','COP',0,NULL,'2026-01-01','2026-01-01'),
    ('card','Visa','creditCard','active','COP',0,0,'2026-01-01','2026-01-01');
    INSERT INTO categories(id,name,type,macro_category,color) VALUES('food','Alimentación','expense','food','#ffffff');`);
  const accountRepository = createSqliteAccountRepository(sql.database);
  const transactionRepository = createSqliteTransactionRepository(sql.database);
  const creditCardRepository = createSqliteCreditCardRepository(sql.database);
  const sharedRepository = createSqliteSharedExpenseRepository(sql.database);
  const api = createSharedExpenseApi(sharedRepository);
  const dependencies = {
    accountRepository,
    transactionRepository,
    creditCardRepository,
  };
  const save = async (changes: Partial<SaveManualTransactionParams> = {}) =>
    saveManualTransaction({
      ...dependencies,
      accounts: await accountRepository.getAccounts(),
      accountId: 'bank',
      amount: 30000,
      categoryId: 'food',
      merchantName: 'Restaurante',
      transactionType: 'expense',
      operationType: 'Débito',
      hasInterestFreeInstallments: false,
      installmentCountInput: '1',
      interestFreeInstallmentCountInput: '',
      currentDate: SHARED_TEST_DATE,
      occurrence: { kind: 'date', date: '2026-10-05' },
      ...changes,
    });
  const contactId = (await api.saveContact('person', 'Amiga')).entityId;
  const distribution = {
    mode: 'amounts' as const,
    personalAmount: 15000,
    participants: [{ contactId, amount: 15000 }],
  };
  const purchase = async (command = 'purchase') => {
    const result = await api.createPurchase(command, {
      purchase: {
        accountId: 'bank',
        amount: 30000,
        categoryId: 'food',
        merchantName: 'Restaurante',
        operationType: 'Débito',
        occurrence: { kind: 'date', date: '2026-10-05' },
      },
      distribution,
    });
    const overview = await api.getExpense(result.entityId);
    return {
      ...result,
      participationId: overview.participants[0]!.participationId,
    };
  };
  const summary = (date = SHARED_TEST_DATE) =>
    getDashboardSummaryFromDb(sql.database, date);
  const balances = async () =>
    Object.fromEntries(
      (await accountRepository.getAccounts()).map(a => [
        a.id,
        a.balance.amount,
      ]),
    );
  const verifyForeignKeys = () =>
    expect(sql.query('PRAGMA foreign_key_check;').rows.raw()).toEqual([]);
  return {
    ...sql,
    ...dependencies,
    sharedRepository,
    api,
    contactId,
    distribution,
    purchase,
    save,
    summary,
    balances,
    verifyForeignKeys,
  };
}
