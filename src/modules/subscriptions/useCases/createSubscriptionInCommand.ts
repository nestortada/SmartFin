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
import { stableJson } from '../../../shared/utils/stableJson';

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
    if (existing) {
      const candidate = buildSubscription(
        { ...state, subscriptions: [] },
        input,
        id,
        date.toISOString(),
      );
      const terms = (value: typeof existing) => ({
        name: value.name,
        merchantName: value.merchantName,
        amount: value.amount,
        currency: value.currency,
        accountId: value.accountId,
        categoryId: value.categoryId,
        subcategoryId: value.subcategoryId,
        recurrence: value.recurrence,
        anchorDate: value.anchorDate,
        billingDay: value.billingDay,
        reminders: value.reminders,
        status: value.status,
      });
      if (stableJson(terms(existing)) !== stableJson(terms(candidate)))
        throw new Error(
          'El ID de la suscripción corresponde a otro contenido. Genera una nueva solicitud.',
        );
      return existing;
    }
    const before = JSON.parse(JSON.stringify(state)) as typeof state;
    const value = buildSubscription(state, input, id, date.toISOString());
    synchronizeSubscriptionState(state, today, date.toISOString());
    yield* persistSubscriptionState(before, state);
    return value;
  });
}
