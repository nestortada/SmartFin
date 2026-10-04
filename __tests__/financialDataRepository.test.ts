import type { Transaction } from 'react-native-sqlite-storage';

import type { SmartFinSQLiteDatabase } from '../src/database';
import { createSqliteFinancialDataRepository } from '../src/modules/settings/repositories/sqliteFinancialDataRepository';

test('financial wipe deletes finance tables but does not delete app settings', async () => {
  const statements: string[] = [];
  const database = {
    transaction: async (operation: (tx: Transaction) => void) => {
      operation({
        executeSql: (
          statement: string,
          _values: unknown[],
          success: (tx: Transaction, result: unknown) => void,
        ) => {
          statements.push(statement);
          success?.({} as Transaction, { rows: { length: 0 } });
        },
      } as unknown as Transaction);
    },
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
