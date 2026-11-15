import {
  enablePromise,
  type SQLiteDatabase,
} from 'react-native-sqlite-storage';

import { SQLITE_SCHEMA_STATEMENTS } from './sqliteSchema';
import {
  activateDatabaseBinding,
  assertResolutionUsable,
  confirmFreshDatabase,
  isDatabaseBindingCurrent,
  releaseDatabaseBinding,
  resolveSmartFinDatabase,
} from './databaseLocation';

import { applyVersionedMigrations } from './migrations';
import { SHARED_LOSS_SCHEMA } from '../modules/transactions/database/sharedLossSchema';
import { INSTALLMENT_HISTORY_SCHEMA } from '../modules/creditCards/database/installmentHistorySchema';
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
    // Migration 5 creates its tables, revision 0 rows and triggers in one transaction.
    if (INSTALLMENT_HISTORY_SCHEMA.includes(statement)) continue;
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
      const state = sqliteConnectionState(previous);
      // C3A: a connection of an invalidated generation is closed and never reused.
      const obsolete = state?.binding !== undefined && !isDatabaseBindingCurrent(state.binding);
      if (state?.status !== 'open' || obsolete) {
        if (state?.status !== 'closed')
          await discardSQLiteConnection(previous, owner);
        if (state?.binding) await releaseDatabaseBinding(owner, state.binding);
        databasePromise = undefined;
      }
    }
    if (!databasePromise) {
      // Resolution happens before any driver call; a refusal (pending recovery, lost database, invalid
      // metadata) is thrown as DatabaseResolutionError and no file name is ever guessed or created.
      const resolution = await resolveSmartFinDatabase(owner);
      assertResolutionUsable(resolution.binding);
      databasePromise = openConfirmedSQLiteConnection({
        location: 'default',
        name: resolution.binding.fileName,
      })
        .then(async database => {
          const managedDatabase = manageSQLiteDatabase(database, resolution.binding);
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
            // A fresh installation becomes "active" only after schema, migrations and checks passed.
            if (resolution.freshInstall) await confirmFreshDatabase(owner, resolution.binding);
            activateDatabaseBinding(resolution.binding);
            return managedDatabase;
          } catch (error) {
            try {
              await discardSQLiteConnection(managedDatabase, owner);
              await releaseDatabaseBinding(owner, resolution.binding);
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

    const state = sqliteConnectionState(database);
    if (state?.status !== 'closed')
      await discardSQLiteConnection(database, owner);
    databasePromise = undefined;
    // Native side: no JS connection of this generation remains open (precondition of a future activation).
    if (state?.binding) await releaseDatabaseBinding(owner, state.binding);
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
