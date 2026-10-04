import { openSmartFinDatabase } from '../../../database/sqliteDatabase';
import { createSqliteSubscriptionRepository } from '../repositories/sqliteSubscriptionRepository';
import { createSubscriptionApi } from '../useCases/createSubscriptionApi';
import {
  createSubscriptionReminderService,
  getNativeSubscriptionReminders,
} from './androidSubscriptionReminderService';
import { withDatabaseMaintenance } from '../../../database/databaseCoordination';
import {
  createSqliteCategoryRepository,
  createSqliteSubcategoryRepository,
} from '../../categories/repositories';

export async function getSubscriptionApi() {
  const api = await withDatabaseMaintenance(createRuntimeApi);
  // Protect complete public operations, including OS effects, from backup/close.
  return Object.fromEntries(
    Object.entries(api).map(([key, operation]) => [
      key,
      (...args: unknown[]) =>
        withDatabaseMaintenance(async () => {
          const current = await createRuntimeApi();
          return Reflect.apply(
            Reflect.get(current, key) ?? operation,
            current,
            args,
          );
        }),
    ]),
  ) as typeof api;
}
async function createRuntimeApi() {
  const database = await openSmartFinDatabase();
  return createSubscriptionApi({
    repository: createSqliteSubscriptionRepository(database),
    categoryRepository: createSqliteCategoryRepository(database),
    subcategoryRepository: createSqliteSubcategoryRepository(database),
    reminderService: createSubscriptionReminderService(),
  });
}
export async function runSubscriptionMaintenance(): Promise<boolean> {
  return withDatabaseMaintenance(async () => {
    const api = await createRuntimeApi();
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
