import { saveSqliteAccounts } from './saveSqliteAccounts';
import { registerSQLiteRepository } from '../../../database/sqliteRepositoryScope';
import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import {
  readNullableNumber,
  readNullableString,
  readNumber,
  readString,
  resultSetToRows,
  type SQLiteRow,
} from '../../../database/sqliteRows';
import type { CurrencyCode } from '../../../shared/types';
import type { Account, AccountStatus, AccountType } from '../types';

export type SqliteAccountRepository = {
  getAccounts: () => Promise<Account[]>;
  saveAccounts: (accounts: Account[]) => Promise<void>;
};

function rowToAccount(row: SQLiteRow): Account {
  const currency = readString(row, 'currency') as CurrencyCode;
  const debtBalanceAmount = readNullableNumber(row, 'debt_balance_amount');
  const creditLimitAmount = readNullableNumber(row, 'credit_limit_amount');

  return {
    id: readString(row, 'id'),
    name: readString(row, 'name'),
    type: readString(row, 'type') as AccountType,
    status: readString(row, 'status') as AccountStatus,
    currency,
    balance: {
      amount: readNumber(row, 'balance_amount'),
      currency,
    },
    ...(debtBalanceAmount !== undefined
      ? {
          debtBalance: {
            amount: debtBalanceAmount,
            currency,
          },
        }
      : {}),
    ...(creditLimitAmount !== undefined
      ? {
          creditLimit: {
            amount: creditLimitAmount,
            currency,
          },
        }
      : {}),
    institutionName: readNullableString(row, 'institution_name'),
    description: readNullableString(row, 'description'),
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
  };
}

export function createSqliteAccountRepository(
  database: SmartFinSQLiteDatabase,
): SqliteAccountRepository {
  return registerSQLiteRepository<SqliteAccountRepository>(database, {
    getAccounts: async () => {
      const [resultSet] = await database.executeSql(
        `SELECT
          id,
          name,
          type,
          status,
          currency,
          balance_amount,
          debt_balance_amount,
          credit_limit_amount,
          institution_name,
          description,
          created_at,
          updated_at
        FROM accounts
        ORDER BY name ASC;`,
      );

      return resultSetToRows(resultSet).map(rowToAccount);
    },
    saveAccounts: accounts => saveSqliteAccounts(database, accounts),
  });
}
