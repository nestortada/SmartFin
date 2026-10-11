import {
  enablePromise,
  openDatabase,
  type SQLiteDatabase,
} from 'react-native-sqlite-storage';

import {
  SMARTFIN_DATABASE_NAME,
  SQLITE_SCHEMA_STATEMENTS,
} from './sqliteSchema';

import { applyVersionedMigrations } from './migrations';

export type SmartFinSQLiteDatabase = SQLiteDatabase;

let databasePromise: Promise<SmartFinSQLiteDatabase> | undefined;
let promiseRuntimeEnabled = false;

async function applySchema(database: SmartFinSQLiteDatabase): Promise<void> {
  for (const statement of SQLITE_SCHEMA_STATEMENTS) {
    await database.executeSql(statement);
  }

  await applyVersionedMigrations(database);
}

export async function openSmartFinDatabase(): Promise<SmartFinSQLiteDatabase> {
  if (!promiseRuntimeEnabled) {
    enablePromise(true);
    promiseRuntimeEnabled = true;
  }

  if (!databasePromise) {
    databasePromise = openDatabase({
      location: 'default',
      name: SMARTFIN_DATABASE_NAME,
    })
      .then(async database => {
        try {
          await applySchema(database);
        } catch (error) {
          await database.close();
          throw error;
        }
        return database;
      })
      .catch(error => {
        databasePromise = undefined;
        throw error;
      });
  }

  return databasePromise;
}

export async function closeSmartFinDatabase(): Promise<void> {
  const database = await databasePromise;

  if (!database) {
    return;
  }

  try {
    await database.close();
  } finally {
    databasePromise = undefined;
  }
}

export async function getFinancialDataRevision(
  database: SmartFinSQLiteDatabase,
): Promise<number> {
  const [result] = await database.executeSql(
    'SELECT revision FROM financial_data_revision WHERE id = 1;',
  );

  if (result.rows.length === 0) {
    return 0;
  }

  const value: unknown = result.rows.item(0).revision;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
