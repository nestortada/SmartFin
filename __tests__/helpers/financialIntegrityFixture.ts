import { realSQLite } from './realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../../src/database/migrations';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import { saveManualTransaction, type SaveManualTransactionParams } from '../../src/modules/transactions/useCases/saveManualTransaction';
import { manageSQLiteDatabase } from '../../src/database/managedSQLite';
import { saveManualTransaction as phase0Save } from './phase0ManualTransactions';

export const FINANCIAL_TEST_DATE = new Date('2026-10-11T12:00:00.000Z');

export async function financialIntegrityFixture(options: {managed?: boolean; historical?: boolean} = {}) {
  const sql = realSQLite({ fixedSqlDate: FINANCIAL_TEST_DATE });
  sql.native.exec('PRAGMA foreign_keys = ON;');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  sql.native.exec(`INSERT INTO accounts
    (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at)
    VALUES ('bank','Banco','bankAccount','active','COP',1000000,NULL,'2026-01-01','2026-01-01'),
    ('target','Destino','bankAccount','active','COP',0,NULL,'2026-01-01','2026-01-01'),
    ('card','Visa','creditCard','active','COP',0,0,'2026-01-01','2026-01-01');`);
  const database = options.managed ? manageSQLiteDatabase(sql.database) : sql.database;
  const accountRepository = createSqliteAccountRepository(database);
  const transactionRepository = createSqliteTransactionRepository(database);
  const creditCardRepository = createSqliteCreditCardRepository(database);
  const dependencies = { accountRepository, transactionRepository, creditCardRepository };
  const save = async (changes: Partial<SaveManualTransactionParams> = {}) =>
    (options.historical ? phase0Save : saveManualTransaction)({
      ...dependencies, accounts: await accountRepository.getAccounts(),
      accountId: 'bank', amount: 250000, merchantName: 'Visa',
      operationType: 'Débito', transactionType: 'expense',
      hasInterestFreeInstallments: false, installmentCountInput: '1',
      interestFreeInstallmentCountInput: '', currentDate: FINANCIAL_TEST_DATE,
      ...changes,
    });
  const snapshot = async () => {
    const accounts = await accountRepository.getAccounts();
    const summary = await getDashboardSummaryFromDb(database, FINANCIAL_TEST_DATE);
    expect(sql.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
    return {
      balances: Object.fromEntries(accounts.map(account => [account.id, account.balance.amount])),
      debt: accounts.find(account => account.id === 'card')?.debtBalance?.amount,
      available: summary.availableBalance, wealth: summary.netWorth,
      income: summary.monthlyIncome, expense: summary.monthlyExpenses,
      savings: summary.monthlySavings,
    };
  };
  return { ...sql, database, ...dependencies, save, snapshot };
}
