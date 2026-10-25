import { openSmartFinDatabase } from '../../../database/sqliteDatabase';
import { getFinancialDataRevision } from '../../../database/sqliteDatabase';
import { createSqliteSubscriptionRepository } from '../repositories/sqliteSubscriptionRepository';
import {
  createSubscriptionApi,
  createSubscriptionCommandApi,
} from '../useCases/createSubscriptionApi';
import {
  runSharedSQLiteTransaction,
  SQLiteCommandFailure,
} from '../../../database/atomicSQLite';
import { sqliteConnectionState, sqliteBorrowedPermit } from '../../../database/managedSQLite';
import type { SubscriptionSyncResult } from '../types';
import {
  createSubscriptionReminderService,
  getNativeSubscriptionReminders,
} from './androidSubscriptionReminderService';
import {
  withDatabaseMaintenance,
  type DatabasePermit,
} from '../../../database/databaseCoordination';
import { borrowSQLiteDatabase } from '../../../database/managedSQLite';
import {
  createSqliteCategoryRepository,
  createSqliteSubcategoryRepository,
} from '../../categories/repositories';
import { awaitFinancialDeletionRecovery, subscriptionResourceEpoch } from '../../settings/services/financialDeletionLifecycle';

export async function getSubscriptionApi() {
  const api = await withDatabaseMaintenance(createRuntimeApi);
  // Protect complete public operations, including OS effects, from backup/close.
  return Object.fromEntries(
    Object.entries(api).map(([key, operation]) => [
      key,
      (...args: unknown[]) => {
        if (maintenanceMethods.has(key))
          return requestSubscriptionMaintenance();
        return withDatabaseMaintenance(async permit => {
          if (
            key === 'createSubscriptionCategory' ||
            key === 'createSubscriptionSubcategory'
          ) {
            const database = await openSmartFinDatabase(permit);
            const result = await runSharedSQLiteTransaction(
              database,
              async participant => {
                const command = runtimeApi(participant, true);
                return key === 'createSubscriptionCategory'
                  ? command.createSubscriptionCategory(args[0] as string)
                  : command.createSubscriptionSubcategory(
                      args[0] as string,
                      args[1] as string,
                    );
              },
              permit,
            );
            if (result.status !== 'confirmed')
              throw new SQLiteCommandFailure(result);
            try {
              const current = await createRuntimeApi(permit);
              return {
                ...result.value,
                sync: {
                  ...result.value.sync,
                  ...(await current.syncSubscriptionReminders()),
                },
              };
            } catch {
              return {
                ...result.value,
                sync: {
                  ...result.value.sync,
                  reminderErrors: [
                    'Cambios guardados. No se pudo sincronizar la plataforma; reintenta los recordatorios.',
                  ],
                },
              };
            }
          }
          const database = borrowSQLiteDatabase(
            await openSmartFinDatabase(permit),
            permit,
          );
          const current = runtimeApi(database);
          try {
            return await Reflect.apply(
              Reflect.get(current, key) ?? operation,
              current,
              args,
            );
          } catch (error) {
            if (sqliteConnectionState(database)?.status === 'quarantined')
              throw new SQLiteCommandFailure({ status: 'unknown', error });
            throw error;
          }
        });
      },
    ]),
  ) as typeof api;
}
async function createRuntimeApi(permit: DatabasePermit) {
  const database = borrowSQLiteDatabase(
    await openSmartFinDatabase(permit),
    permit,
  );
  return runtimeApi(database);
}
function runtimeApi(
  database: Parameters<typeof createSqliteSubscriptionRepository>[0],
  deferReminders = false,
) {
  return (
    deferReminders ? createSubscriptionCommandApi : createSubscriptionApi
  )({
    repository: createSqliteSubscriptionRepository(database),
    categoryRepository: createSqliteCategoryRepository(database),
    subcategoryRepository: createSqliteSubcategoryRepository(database),
    reminderService: createSubscriptionReminderService(sqliteBorrowedPermit(database)),
  });
}
const maintenanceMethods = new Set([
  'syncSubscriptions',
  'ensureUpcomingSubscriptionOccurrences',
  'markOverdueOccurrences',
  'syncSubscriptionCashFlow',
  'syncSubscriptionAlerts',
]);
let maintenance: Promise<SubscriptionSyncResult> | undefined;
function requestSubscriptionMaintenance(expectedEpoch?: string): Promise<SubscriptionSyncResult> {
  if (maintenance) return maintenance;
  const execute = async () => {
    // Another Android owner may be finishing cleanup; wait for its final state.
    const recovered = await awaitFinancialDeletionRecovery();
    if (recovered.status === 'unknown' || recovered.status === 'cleanupPending') throw new Error('Borrado pendiente; mantenimiento suspendido.');
    if (recovered.status === 'running') throw new Error('Recuperación de borrado en curso; mantenimiento aplazado.');
    const epoch = await withDatabaseMaintenance(subscriptionResourceEpoch);
    if (expectedEpoch !== undefined && epoch !== expectedEpoch) throw new Error('Trabajo de mantenimiento de una época anterior.');
    const verifyEpoch = async (permit: DatabasePermit) => {
      if (await subscriptionResourceEpoch(permit) !== epoch) throw new Error('Trabajo de mantenimiento obsoleto.');
    };
    let result!: SubscriptionSyncResult;
    for (let batch = 0; batch < 20; batch += 1) {
      const committed = await withDatabaseMaintenance(async permit => {
        await verifyEpoch(permit);
        const database = borrowSQLiteDatabase(
          await openSmartFinDatabase(permit),
          permit,
        );
        const sync = await runtimeApi(database, true).syncSubscriptions();
        return { sync, revision: await getFinancialDataRevision(database) };
      });
      result = committed.sync;
      if (!result.hasMore) {
        const finalized = await withDatabaseMaintenance(async permit => {
          await verifyEpoch(permit);
          const database = borrowSQLiteDatabase(
            await openSmartFinDatabase(permit),
            permit,
          );
          // Requests separated by a writer are not equivalent, even while a run is active.
          if ((await getFinancialDataRevision(database)) !== committed.revision)
            return undefined;
          return runtimeApi(database).syncSubscriptionReminders();
        });
        if (finalized) return { ...result, ...finalized };
      }
      // A new permit per bounded batch lets queued readers/payments make progress.
    }
    const reminders = await withDatabaseMaintenance(async permit => {
      await verifyEpoch(permit);
      return (await createRuntimeApi(permit)).syncSubscriptionReminders();
    });
    return { ...result, hasMore: true, ...reminders };
  };
  maintenance = execute().finally(() => {
    maintenance = undefined;
  });
  return maintenance;
}
export async function runSubscriptionMaintenance(): Promise<boolean> {
  const result = await requestSubscriptionMaintenance();
  return !result.hasMore && result.reminderErrors.length === 0;
}
export async function subscriptionHeadlessTask(data: {
  runId: string;
  datasetEpoch?: string;
}): Promise<void> {
  let success = false;
  try {
    const result = await requestSubscriptionMaintenance(data.datasetEpoch);
    success = !result.hasMore && result.reminderErrors.length === 0;
  } finally {
    getNativeSubscriptionReminders()?.completeMaintenance(data.runId, success);
  }
}
