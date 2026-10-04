import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { runSQLiteTransaction } from '../../../database/atomicSQLite';
import {
  loadSubscriptionState,
  persistSubscriptionState,
} from '../repositories/sqliteSubscriptionRepository';
import {
  buildSubscription,
  synchronizeSubscriptionState,
} from './subscriptionLifecycle';
import { civilDate } from './recurrence';
import type { SubscriptionInput } from '../types';

/** Persist financial intent in the command's transaction. OS scheduling follows its commit. */
export async function createSubscriptionInCommand(
  database: SmartFinSQLiteDatabase,
  input: SubscriptionInput,
  id: string,
  date = new Date(),
) {
  return runSQLiteTransaction(database, function* () {
    const today = civilDate(date);
    const state = yield* loadSubscriptionState({ today });
    const existing = state.subscriptions.find(item => item.id === id);
    if (existing) return existing;
    const before = JSON.parse(JSON.stringify(state)) as typeof state;
    const value = buildSubscription(state, input, id, date.toISOString());
    synchronizeSubscriptionState(state, today, date.toISOString());
    yield* persistSubscriptionState(before, state);
    return value;
  });
}
