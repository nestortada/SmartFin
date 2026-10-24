import {
  enablePromise,
  type SQLiteDatabase,
} from 'react-native-sqlite-storage';

import {
  SMARTFIN_DATABASE_NAME,
  SQLITE_SCHEMA_STATEMENTS,
} from './sqliteSchema';

import { applyVersionedMigrations } from './migrations';
import { SHARED_LOSS_SCHEMA } from '../modules/transactions/database/sharedLossSchema';
import { SHARED_EXPENSE_INDEXES, SHARED_EXPENSE_SCHEMA, SHARED_EXPENSE_TRIGGERS } from '../modules/transactions/database/sharedExpenseSchema';
import {
  withDatabaseMaintenance,
  verifyNativeDatabaseOwner,
  type DatabasePermit,
} from './databaseCoordination';
import {
  borrowSQLiteDatabase,
  discardSQLiteConnection,
  manageSQLiteDatabase,
  sqliteConnectionState,
} from './managedSQLite';
import {
  openConfirmedSQLiteConnection,
  sqliteLifecycleReceipt,
} from './sqliteLifecycle';

export type SmartFinSQLiteDatabase = SQLiteDatabase;

let databasePromise: Promise<SmartFinSQLiteDatabase> | undefined;
let failedInitialization: SmartFinSQLiteDatabase | undefined;
let promiseRuntimeEnabled = false;
// A failed receipt/check requires restart and explicit review, not automatic reopen.
let openingFailure: { error: unknown } | undefined;

async function applySchema(database: SmartFinSQLiteDatabase): Promise<void> {
  for (const statement of SQLITE_SCHEMA_STATEMENTS) {
    if (SHARED_LOSS_SCHEMA.includes(statement)) continue;
    // Installed tables acquire their new columns in the versioned migration.
    if ([...SHARED_EXPENSE_SCHEMA, ...SHARED_EXPENSE_INDEXES, ...SHARED_EXPENSE_TRIGGERS].includes(statement)) continue;
    await database.executeSql(statement);
  }

  await applyVersionedMigrations(database);
}

export async function openSmartFinDatabase(
  permit?: DatabasePermit,
): Promise<SmartFinSQLiteDatabase> {
  return withDatabaseMaintenance(async owner => {
    await verifyNativeDatabaseOwner(owner);
    if (openingFailure) throw openingFailure.error;
    if (failedInitialization) {
      await discardSQLiteConnection(failedInitialization, owner);
      failedInitialization = undefined;
    }
    if (!promiseRuntimeEnabled) {
      enablePromise(true);
      promiseRuntimeEnabled = true;
    }

    if (databasePromise) {
      const previous = await databasePromise;
      if (sqliteConnectionState(previous)?.status !== 'open') {
        if (sqliteConnectionState(previous)?.status !== 'closed')
          await discardSQLiteConnection(previous, owner);
        databasePromise = undefined;
      }
    }
    if (!databasePromise) {
      databasePromise = openConfirmedSQLiteConnection({
        location: 'default',
        name: SMARTFIN_DATABASE_NAME,
      })
        .then(async database => {
          const managedDatabase = manageSQLiteDatabase(database);
          try {
            // Initialization uses a borrowed handle, so migration transactions never requeue.
            const owned = borrowSQLiteDatabase(managedDatabase, owner);
            await sqliteLifecycleReceipt(
              (async () => {
                await applySchema(owned);
                const [mode] = await owned.executeSql('PRAGMA foreign_keys;');
                const [fk] = await owned.executeSql(
                  'PRAGMA foreign_key_check;',
                );
                const [integrity] = await owned.executeSql(
                  'PRAGMA integrity_check;',
                );
                const [revision] = await owned.executeSql(
                  'SELECT revision FROM financial_data_revision WHERE id=1;',
                );
                const value: unknown =
                  revision.rows.length === 1
                    ? revision.rows.item(0).revision
                    : undefined;
                if (
                  mode.rows.item(0).foreign_keys !== 1 ||
                  fk.rows.length ||
                  integrity.rows.item(0).integrity_check !== 'ok' ||
                  typeof value !== 'number' ||
                  !Number.isSafeInteger(value) ||
                  value < 0
                )
                  throw new Error(
                    'SQLite recovery state/integrity check failed',
                  );
              })(),
              'state verification',
            );
            return managedDatabase;
          } catch (error) {
            try {
              await discardSQLiteConnection(managedDatabase, owner);
            } catch {
              failedInitialization = managedDatabase;
            }
            throw error;
          }
        })
        .catch(error => {
          openingFailure = { error };
          databasePromise = undefined;
          throw error;
        });
    }

    return databasePromise;
  }, permit);
}

export async function closeSmartFinDatabase(
  permit?: DatabasePermit,
): Promise<void> {
  return withDatabaseMaintenance(async owner => {
    if (openingFailure) throw openingFailure.error;
    if (failedInitialization) {
      await discardSQLiteConnection(failedInitialization, owner);
      failedInitialization = undefined;
    }
    const database = await databasePromise;

    if (!database) {
      return;
    }

    if (sqliteConnectionState(database)?.status !== 'closed')
      await discardSQLiteConnection(database, owner);
    databasePromise = undefined;
  }, permit);
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
