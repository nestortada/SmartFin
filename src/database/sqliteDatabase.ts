import {
  enablePromise,
  openDatabase,
  type SQLiteDatabase,
} from 'react-native-sqlite-storage';

import {
  SMARTFIN_DATABASE_NAME,
  SQLITE_SCHEMA_STATEMENTS,
} from './sqliteSchema';

export type SmartFinSQLiteDatabase = SQLiteDatabase;

let databasePromise: Promise<SmartFinSQLiteDatabase> | undefined;

async function applySchema(database: SmartFinSQLiteDatabase): Promise<void> {
  for (const statement of SQLITE_SCHEMA_STATEMENTS) {
    await database.executeSql(statement);
  }
}

export async function openSmartFinDatabase(): Promise<SmartFinSQLiteDatabase> {
  enablePromise(true);

  if (!databasePromise) {
    databasePromise = openDatabase({
      location: 'default',
      name: SMARTFIN_DATABASE_NAME,
    }).then(async database => {
      await applySchema(database);
      return database;
    });
  }

  return databasePromise;
}

export async function closeSmartFinDatabase(): Promise<void> {
  const database = await databasePromise;

  if (!database) {
    return;
  }

  await database.close();
  databasePromise = undefined;
}
