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

  await applyLightweightMigrations(database);
}

async function applyLightweightMigrations(database: SmartFinSQLiteDatabase): Promise<void> {
  const migrations = [
    'ALTER TABLE transactions ADD COLUMN payment_method TEXT;',
    'ALTER TABLE transactions ADD COLUMN credit_card_hint TEXT;',
    'ALTER TABLE transactions ADD COLUMN dedupe_key TEXT;',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_dedupe_key ON transactions(dedupe_key) WHERE dedupe_key IS NOT NULL;',
  ];

  for (const statement of migrations) {
    try {
      await database.executeSql(statement);
    } catch {
      // SQLite raises "duplicate column name" on existing local databases.
    }
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
