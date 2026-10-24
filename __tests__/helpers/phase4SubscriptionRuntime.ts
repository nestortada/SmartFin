// Frozen before phase 4; only relative imports adapted.
import { openSmartFinDatabase } from '../../src/database/sqliteDatabase';
import { createSqliteSubscriptionRepository } from '../../src/modules/subscriptions/repositories/sqliteSubscriptionRepository';
import { createSubscriptionApi } from './phase4SubscriptionApi';
import {
  createSubscriptionReminderService,
  getNativeSubscriptionReminders,
} from '../../src/modules/subscriptions/services/androidSubscriptionReminderService';
import { withDatabaseMaintenance, type DatabasePermit } from '../../src/database/databaseCoordination';
import { borrowSQLiteDatabase } from '../../src/database/managedSQLite';
import {
  createSqliteCategoryRepository,
  createSqliteSubcategoryRepository,
} from '../../src/modules/categories/repositories';

export async function getSubscriptionApi() {
  const api = await withDatabaseMaintenance(createRuntimeApi);
  // Protect complete public operations, including OS effects, from backup/close.
  return Object.fromEntries(
    Object.entries(api).map(([key, operation]) => [
      key,
      (...args: unknown[]) =>
        withDatabaseMaintenance(async permit => {
          const current = await createRuntimeApi(permit);
          return Reflect.apply(
            Reflect.get(current, key) ?? operation,
            current,
            args,
          );
        }),
    ]),
  ) as typeof api;
}
async function createRuntimeApi(permit: DatabasePermit) {
  const database = borrowSQLiteDatabase(await openSmartFinDatabase(permit), permit);
  return createSubscriptionApi({
    repository: createSqliteSubscriptionRepository(database),
    categoryRepository: createSqliteCategoryRepository(database),
    subcategoryRepository: createSqliteSubcategoryRepository(database),
    reminderService: createSubscriptionReminderService(),
  });
}
export async function runSubscriptionMaintenance(): Promise<boolean> {
  return withDatabaseMaintenance(async permit => {
    const api = await createRuntimeApi(permit);
    let result = await api.syncSubscriptions();
    // Yield to SQLite between bounded batches rather than holding a long transaction.
    for (let batch = 1; result.hasMore && batch < 20; batch += 1)
      result = await api.syncSubscriptions();
    return !result.hasMore && result.reminderErrors.length === 0;
  });
}
export async function subscriptionHeadlessTask(data: {
  runId: string;
}): Promise<void> {
  let success = false;
  try {
    success = await runSubscriptionMaintenance();
  } finally {
    getNativeSubscriptionReminders()?.completeMaintenance(data.runId, success);
  }
}
