import type { SmartFinSQLiteDatabase } from '../src/database';
import { createSqliteFinancialDataRepository } from '../src/modules/settings/repositories/sqliteFinancialDataRepository';

test('financial wipe deletes finance tables but does not delete app settings', async () => {
  const statements: string[] = [];
  const database = {
    executeSql: jest.fn(async (statement: string) => {
      statements.push(statement);
      return [];
    }),
  } as unknown as SmartFinSQLiteDatabase;
  const repository = createSqliteFinancialDataRepository(database);

  await repository.deleteFinancialData();

  expect(statements).toContain('DELETE FROM transactions;');
  expect(statements).toContain('DELETE FROM raw_financial_messages;');
  expect(statements).toContain('DELETE FROM accounts;');
  expect(statements).not.toContain('DELETE FROM app_settings;');
});
