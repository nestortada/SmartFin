import type {
  Subscription,
  SubscriptionInput,
  SubscriptionOccurrence,
  SubscriptionUpdate,
  SubscriptionMatch,
} from '../types';
import type {
  SubscriptionState,
  SubscriptionAlert,
} from '../repositories/SubscriptionRepository';
import type { Transaction } from '../../transactions/types';
import {
  addDays,
  nextContractDate,
  parseCivilDate,
  recurrenceInterval,
  roundSubscriptionMoney,
  daysBetween,
} from './recurrence';

export const DEFAULT_SUBSCRIPTION_REMINDERS = {
  enabled: true,
  offsets: [3, 1, 0],
  hour: 9,
  minute: 0,
};
export function validateSubscription(
  state: SubscriptionState,
  subscription: Subscription,
  validateReferences = true,
): void {
  if (!subscription.name.trim()) throw new Error('El nombre es obligatorio.');
  if (
    roundSubscriptionMoney(subscription.amount) <= 0 ||
    subscription.currency !== 'COP'
  )
    throw new Error('Importe o moneda inválidos.');
  parseCivilDate(subscription.anchorDate);
  parseCivilDate(subscription.generationCursor);
  recurrenceInterval(subscription.recurrence);
  if (
    !Number.isInteger(subscription.billingDay) ||
    subscription.billingDay < 1 ||
    subscription.billingDay > 31
  )
    throw new Error('Día de facturación inválido.');
  if (!['active', 'paused', 'cancelled'].includes(subscription.status))
    throw new Error('Estado inválido.');
  const config = subscription.reminders;
  if (
    typeof config.enabled !== 'boolean' ||
    !Array.isArray(config.offsets) ||
    config.offsets.length > 16 ||
    !config.offsets.every(
      offset => Number.isInteger(offset) && offset >= 0 && offset <= 365,
    ) ||
    !Number.isInteger(config.hour) ||
    config.hour < 0 ||
    config.hour > 23 ||
    !Number.isInteger(config.minute) ||
    config.minute < 0 ||
    config.minute > 59
  )
    throw new Error('Configuración de recordatorios inválida.');
  if (!validateReferences) return;
  if (subscription.accountId) {
    const account = state.accounts.find(
      value => value.id === subscription.accountId,
    );
    if (
      !account ||
      account.status !== 'active' ||
      account.currency !== 'COP' ||
      !['cash', 'bankAccount', 'savingsAccount', 'creditCard'].includes(
        account.type ?? '',
      )
    )
      throw new Error('La cuenta no es compatible o está inactiva.');
  }
  if (
    subscription.categoryId &&
    !state.categories.some(
      value => value.id === subscription.categoryId && value.type === 'expense',
    )
  )
    throw new Error('Categoría de gasto inválida.');
  if (
    subscription.subcategoryId &&
    !state.subcategories.some(
      value =>
        value.id === subscription.subcategoryId &&
        value.categoryId === subscription.categoryId &&
        value.isActive,
    )
  )
    throw new Error('Subcategoría incompatible.');
}
export function buildSubscription(
  state: SubscriptionState,
  input: SubscriptionInput,
  id: string,
  now: string,
): Subscription {
  const value: Subscription = {
    id,
    name: input.name.trim(),
    merchantName: input.merchantName?.trim() || undefined,
    amount: roundSubscriptionMoney(input.amount),
    currency: input.currency ?? 'COP',
    accountId: input.accountId,
    categoryId: input.categoryId,
    subcategoryId: input.subcategoryId,
    recurrence: input.recurrence,
    anchorDate: input.anchorDate,
    generationCursor: input.anchorDate,
    billingDay: input.billingDay ?? Number(input.anchorDate.slice(8)),
    status: input.status ?? 'active',
    reminders: { ...DEFAULT_SUBSCRIPTION_REMINDERS, ...input.reminders },
    scheduleRevision: 1,
    createdAt: now,
    updatedAt: now,
  };
  value.reminders.offsets = [...new Set(value.reminders.offsets)].sort(
    (a, b) => b - a,
  );
  validateSubscription(state, value);
  value.generationCursor = nextContractDate(
    value.anchorDate,
    value.recurrence,
    value.billingDay,
    value.anchorDate,
  );
  state.subscriptions.push(value);
  return value;
}
export function requireSubscription(
  state: SubscriptionState,
  id: string,
): Subscription {
  const value = state.subscriptions.find(
    subscription => subscription.id === id,
  );
  if (!value)
    throw new Error('Suscripción inexistente o configuración inválida.');
  return value;
}
export function updateSubscriptionState(
  state: SubscriptionState,
  id: string,
  input: SubscriptionUpdate,
  today: string,
  now: string,
): Subscription {
  const value = requireSubscription(state, id);
  if (value.status === 'cancelled')
    throw new Error('La suscripción está cancelada.');
  const allowed = [
    'name',
    'merchantName',
    'amount',
    'currency',
    'categoryId',
    'subcategoryId',
    'accountId',
    'recurrence',
    'anchorDate',
    'billingDay',
    'reminders',
  ];
  const candidate = {
    ...value,
    ...Object.fromEntries(
      Object.entries(input).filter(([key]) => allowed.includes(key)),
    ),
    currency: input.currency ?? value.currency,
    name: (input.name ?? value.name).trim(),
    amount: roundSubscriptionMoney(input.amount ?? value.amount),
    reminders: { ...value.reminders, ...input.reminders },
  };
  candidate.reminders.offsets = [...new Set(candidate.reminders.offsets)].sort(
    (a, b) => b - a,
  );
  // A pre-existing closed account may remain during unrelated descriptive edits.
  validateSubscription(
    state,
    candidate,
    !value.accountId ||
      candidate.accountId !== value.accountId ||
      state.accounts.some(
        account =>
          account.id === value.accountId && account.status === 'active',
      ),
  );
  if (
    candidate.categoryId &&
    !state.categories.some(
      category =>
        category.id === candidate.categoryId && category.type === 'expense',
    )
  )
    throw new Error('Categoría inválida.');
  if (
    candidate.subcategoryId &&
    !state.subcategories.some(
      category =>
        category.id === candidate.subcategoryId &&
        category.categoryId === candidate.categoryId &&
        category.isActive,
    )
  )
    throw new Error('Subcategoría inválida.');
  const ruleChanged =
    JSON.stringify(value.recurrence) !== JSON.stringify(candidate.recurrence) ||
    value.anchorDate !== candidate.anchorDate ||
    value.billingDay !== candidate.billingDay;
  const priceChanged = value.amount !== candidate.amount;
  const changed =
    JSON.stringify({ ...value, updatedAt: '' }) !==
    JSON.stringify({ ...candidate, updatedAt: '' });
  if (!changed) return value;
  candidate.scheduleRevision += 1;
  candidate.updatedAt = now;
  for (const occurrence of state.occurrences) {
    if (
      occurrence.subscriptionId !== id ||
      occurrence.status !== 'pending' ||
      occurrence.expectedDate <= today
    )
      continue;
    if (ruleChanged) {
      Object.assign(occurrence, {
        status: 'skipped',
        skipReason: 'rescheduled',
        skippedAt: now,
        updatedAt: now,
      });
    } else {
      if (priceChanged) occurrence.expectedAmount = candidate.amount;
      occurrence.accountId = candidate.accountId;
      occurrence.updatedAt = now;
    }
  }
  if (ruleChanged)
    candidate.generationCursor = nextContractDate(
      candidate.anchorDate,
      candidate.recurrence,
      candidate.billingDay,
      addDays(today, 1),
    );
  Object.assign(value, candidate);
  if (priceChanged)
    upsertAlert(
      state,
      `subscription-price-${id}-${value.scheduleRevision}`,
      'subscription_price_changed',
      'subscription',
      id,
      'Precio de suscripción actualizado',
      `${value.name}: ${value.amount} COP`,
      now,
    );
  return value;
}
export function changeSubscriptionStatus(
  state: SubscriptionState,
  id: string,
  status: Subscription['status'],
  today: string,
  now: string,
): Subscription {
  const value = requireSubscription(state, id);
  if (value.status === status) return value;
  if (value.status === 'cancelled')
    throw new Error('La cancelación es definitiva.');
  const oldStatus = value.status;
  value.status = status;
  value.scheduleRevision += 1;
  value.updatedAt = now;
  if (status !== 'active') {
    value.nextChargeDate = undefined;
    for (const occurrence of state.occurrences) {
      if (
        occurrence.subscriptionId === id &&
        occurrence.status === 'pending' &&
        occurrence.expectedDate > today
      ) {
        Object.assign(occurrence, {
          status: 'skipped',
          skippedAt: now,
          skipReason: status === 'paused' ? 'pause' : 'cancellation',
          updatedAt: now,
        });
      }
    }
  } else if (oldStatus === 'paused') {
    value.generationCursor = nextContractDate(
      value.anchorDate,
      value.recurrence,
      value.billingDay,
      today,
    );
    for (const occurrence of state.occurrences) {
      if (
        occurrence.subscriptionId === id &&
        occurrence.status === 'skipped' &&
        occurrence.skipReason === 'pause' &&
        occurrence.expectedDate >= today &&
        nextContractDate(
          value.anchorDate,
          value.recurrence,
          value.billingDay,
          occurrence.expectedDate,
        ) === occurrence.expectedDate
      ) {
        Object.assign(occurrence, {
          status: 'pending',
          skippedAt: undefined,
          skipReason: undefined,
          expectedAmount: value.amount,
          accountId: value.accountId,
          updatedAt: now,
        });
      }
    }
  }
  return value;
}
export function compatibleSubscriptionPayment(
  occurrence: SubscriptionOccurrence,
  transaction: Transaction,
): boolean {
  return (
    transaction.type === 'expense' &&
    transaction.status === 'posted' &&
    transaction.direction === 'outflow' &&
    transaction.currency === occurrence.currency &&
    Number.isFinite(transaction.amount) &&
    transaction.amount > 0 &&
    (!occurrence.accountId || occurrence.accountId === transaction.accountId)
  );
}
export function reconcileTransactionChanges(
  state: SubscriptionState,
  transactions: Transaction[],
  removedIds: string[],
  today: string,
  now: string,
): void {
  for (const occurrence of state.occurrences) {
    if (!occurrence.transactionId) continue;
    const transaction = transactions.find(
      value => value.id === occurrence.transactionId,
    );
    if (!transaction && !removedIds.includes(occurrence.transactionId))
      continue;
    if (transaction && compatibleSubscriptionPayment(occurrence, transaction)) {
      if (
        occurrence.actualAmount !==
          roundSubscriptionMoney(transaction.amount) ||
        occurrence.paidAt !== transaction.date
      )
        Object.assign(occurrence, {
          actualAmount: roundSubscriptionMoney(transaction.amount),
          paidAt: transaction.date,
          updatedAt: now,
        });
    } else {
      Object.assign(occurrence, {
        status: occurrence.expectedDate < today ? 'overdue' : 'pending',
        transactionId: undefined,
        actualAmount: undefined,
        paidAt: undefined,
        updatedAt: now,
      });
    }
  }
}
export function confirmPayment(
  state: SubscriptionState,
  occurrenceId: string,
  transactionId: string,
  now: string,
): SubscriptionOccurrence {
  const occurrence = state.occurrences.find(value => value.id === occurrenceId);
  const transaction = state.transactions.find(
    value => value.id === transactionId,
  );
  if (!occurrence || !transaction)
    throw new Error('Cobro o transacción inexistente.');
  if (
    occurrence.status === 'paid' &&
    occurrence.transactionId === transactionId
  )
    return occurrence;
  if (
    !['pending', 'overdue'].includes(occurrence.status) ||
    occurrence.transactionId
  )
    throw new Error('El cobro ya está resuelto.');
  if (!compatibleSubscriptionPayment(occurrence, transaction))
    throw new Error('El movimiento no es un gasto confirmado compatible.');
  if (state.occurrences.some(value => value.transactionId === transactionId))
    throw new Error('La transacción ya está conciliada.');
  Object.assign(occurrence, {
    status: 'paid',
    transactionId,
    actualAmount: roundSubscriptionMoney(transaction.amount),
    paidAt: transaction.date,
    updatedAt: now,
  });
  if (occurrence.actualAmount !== occurrence.expectedAmount)
    upsertAlert(
      state,
      `subscription-price-actual-${occurrence.id}`,
      'subscription_price_changed',
      'subscription_occurrence',
      occurrence.id,
      'Importe diferente al esperado',
      `Esperado ${occurrence.expectedAmount} COP; real ${occurrence.actualAmount} COP.`,
      now,
    );
  return occurrence;
}
export function updateOccurrenceAmount(
  state: SubscriptionState,
  id: string,
  amount: number,
  now: string,
): SubscriptionOccurrence {
  const value = state.occurrences.find(item => item.id === id);
  if (!value) throw new Error('Cobro inexistente.');
  if (value.status === 'skipped')
    throw new Error('No se puede editar un cobro saltado.');
  const rounded = roundSubscriptionMoney(amount);
  if (rounded <= 0) throw new Error('El importe debe ser mayor que cero.');
  if (value.expectedAmount !== rounded) {
    value.expectedAmount = rounded;
    value.updatedAt = now;
  }
  if (value.status === 'paid' && value.actualAmount !== rounded)
    upsertAlert(
      state,
      `subscription-price-actual-${id}`,
      'subscription_price_changed',
      'subscription_occurrence',
      id,
      'Importe diferente al esperado',
      `Esperado ${rounded} COP; real ${value.actualAmount} COP.`,
      now,
    );
  return value;
}
export function skipOccurrence(
  state: SubscriptionState,
  id: string,
  now: string,
  notes?: string,
): SubscriptionOccurrence {
  const value = state.occurrences.find(occurrence => occurrence.id === id);
  if (!value) throw new Error('Cobro inexistente.');
  if (value.status === 'skipped' && value.skipReason === 'manual') return value;
  if (!['pending', 'overdue'].includes(value.status))
    throw new Error('El cobro ya está resuelto.');
  Object.assign(value, {
    status: 'skipped',
    skipReason: 'manual',
    skippedAt: now,
    notes,
    updatedAt: now,
  });
  return value;
}
function upsertAlert(
  state: SubscriptionState,
  id: string,
  alertType: string,
  relatedEntityType: string,
  relatedEntityId: string,
  title: string,
  message: string,
  now: string,
): void {
  const previous = state.alerts.find(value => value.id === id);
  if (
    previous?.status === 'open' &&
    previous.message === message &&
    previous.title === title
  )
    return;
  const alert: SubscriptionAlert = {
    id,
    alertType,
    severity: 'warning',
    relatedEntityType,
    relatedEntityId,
    title,
    message,
    status: 'open',
    triggeredAt: previous?.triggeredAt ?? now,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  if (previous) Object.assign(previous, alert, { resolvedAt: undefined });
  else state.alerts.push(alert);
}
export function synchronizeSubscriptionState(
  state: SubscriptionState,
  today: string,
  now: string,
): boolean {
  const end = addDays(today, 90);
  let remaining = 500;
  let hasMore = false;
  for (const subscription of state.subscriptions) {
    if (subscription.status !== 'active') continue;
    let firstFuture = nextContractDate(
      subscription.anchorDate,
      subscription.recurrence,
      subscription.billingDay,
      today,
    );
    while (
      state.occurrences.some(
        value =>
          value.subscriptionId === subscription.id &&
          value.expectedDate === firstFuture &&
          (value.status === 'paid' ||
            (value.status === 'skipped' && value.skipReason !== 'rescheduled')),
      )
    ) {
      firstFuture = nextContractDate(
        subscription.anchorDate,
        subscription.recurrence,
        subscription.billingDay,
        firstFuture,
        false,
      );
    }
    const target = firstFuture > end ? firstFuture : end;
    let cursor = subscription.generationCursor;
    while (cursor <= target && remaining > 0) {
      const existing = state.occurrences.find(
        value =>
          value.subscriptionId === subscription.id &&
          value.expectedDate === cursor,
      );
      if (!existing)
        state.occurrences.push({
          id: `subscription-occurrence:${subscription.id}:${cursor}`,
          subscriptionId: subscription.id,
          expectedDate: cursor,
          expectedAmount: subscription.amount,
          currency: 'COP',
          accountId: subscription.accountId,
          status: cursor < today ? 'overdue' : 'pending',
          createdAt: now,
          updatedAt: now,
        });
      else if (
        existing.status === 'skipped' &&
        existing.skipReason === 'rescheduled' &&
        existing.expectedDate > today
      )
        Object.assign(existing, {
          status: 'pending',
          skippedAt: undefined,
          skipReason: undefined,
          expectedAmount: subscription.amount,
          accountId: subscription.accountId,
          updatedAt: now,
        });
      cursor = nextContractDate(
        subscription.anchorDate,
        subscription.recurrence,
        subscription.billingDay,
        cursor,
        false,
      );
      remaining -= 1;
    }
    if (subscription.generationCursor !== cursor) {
      subscription.generationCursor = cursor;
      subscription.updatedAt = now;
    }
    if (cursor <= target) hasMore = true;
    let next = firstFuture;
    while (
      state.occurrences.some(
        value =>
          value.subscriptionId === subscription.id &&
          value.expectedDate === next &&
          (value.status === 'paid' || value.status === 'skipped'),
      )
    ) {
      next = nextContractDate(
        subscription.anchorDate,
        subscription.recurrence,
        subscription.billingDay,
        next,
        false,
      );
    }
    if (subscription.nextChargeDate !== next) {
      subscription.nextChargeDate = next;
      subscription.updatedAt = now;
    }
    if (
      !state.occurrences.some(
        value =>
          value.subscriptionId === subscription.id &&
          value.expectedDate === next,
      )
    ) {
      state.occurrences.push({
        id: `subscription-occurrence:${subscription.id}:${next}`,
        subscriptionId: subscription.id,
        expectedDate: next,
        expectedAmount: subscription.amount,
        currency: 'COP',
        accountId: subscription.accountId,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  for (const occurrence of state.occurrences) {
    if (occurrence.status === 'pending' && occurrence.expectedDate < today)
      Object.assign(occurrence, { status: 'overdue', updatedAt: now });
  }
  reconcileTransactionChanges(state, state.transactions, [], today, now);
  const wantedAlerts = new Set<string>();
  const wantedReminders = new Set<string>();
  for (const diagnostic of state.diagnostics) {
    const id = `subscription-config-${diagnostic.subscriptionId}`;
    wantedAlerts.add(id);
    upsertAlert(
      state,
      id,
      'subscription_configuration_invalid',
      'subscription',
      diagnostic.subscriptionId,
      'Configuración de suscripción inválida',
      diagnostic.message,
      now,
    );
  }
  for (const subscription of state.subscriptions) {
    if (subscription.status !== 'active' || !subscription.accountId) continue;
    const account = state.accounts.find(
      value => value.id === subscription.accountId,
    );
    if (
      !account ||
      account.status !== 'active' ||
      !['cash', 'bankAccount', 'savingsAccount', 'creditCard'].includes(
        account.type ?? '',
      ) ||
      account.currency !== 'COP'
    ) {
      const id = `subscription-account-${subscription.id}`;
      wantedAlerts.add(id);
      upsertAlert(
        state,
        id,
        'subscription_account_invalid',
        'subscription',
        subscription.id,
        'Cuenta de suscripción inactiva',
        `${subscription.name} necesita una cuenta compatible.`,
        now,
      );
    }
  }
  for (const occurrence of state.occurrences) {
    const subscription = state.subscriptions.find(
      value => value.id === occurrence.subscriptionId,
    );
    const unresolved =
      occurrence.status === 'pending' || occurrence.status === 'overdue';
    // Obligations from before a pause stay visible; future projections require active status.
    const projected =
      !!subscription &&
      unresolved &&
      (subscription.status === 'active' || occurrence.expectedDate <= today);
    const projectionId = `subscription-projection:${occurrence.id}`;
    const projection = state.projections.find(
      value => value.id === projectionId,
    );
    if (projected && subscription) {
      const next = {
        id: projectionId,
        name: subscription.name,
        eventType: 'expense',
        amount: occurrence.expectedAmount,
        currency: 'COP',
        expectedDate: occurrence.expectedDate,
        accountId: occurrence.accountId,
        sourceEntityType: 'subscription_occurrence',
        sourceEntityId: occurrence.id,
        status: 'projected',
        createdAt: projection?.createdAt ?? now,
        updatedAt: projection?.updatedAt ?? now,
      };
      if (!projection) state.projections.push(next);
      else if (
        Object.entries(next).some(
          ([key, value]) => Reflect.get(projection, key) !== value,
        )
      )
        Object.assign(projection, next, { updatedAt: now });
    } else if (projection && projection.status !== 'cancelled')
      Object.assign(projection, { status: 'cancelled', updatedAt: now });
    if (!subscription) continue;
    const alertType =
      occurrence.status === 'overdue'
        ? 'subscription_overdue'
        : 'subscription_upcoming';
    if (
      unresolved &&
      (occurrence.status === 'overdue' ||
        (subscription.status === 'active' &&
          daysBetween(occurrence.expectedDate, today) <= 5))
    ) {
      const id = `${alertType}:${occurrence.id}`;
      wantedAlerts.add(id);
      upsertAlert(
        state,
        id,
        alertType,
        'subscription_occurrence',
        occurrence.id,
        occurrence.status === 'overdue'
          ? 'Cobro esperado vencido'
          : 'Próximo cobro',
        `${subscription.name}: ${occurrence.expectedAmount} COP (${occurrence.expectedDate})`,
        now,
      );
    }
    if (
      subscription.status !== 'active' ||
      occurrence.status !== 'pending' ||
      !subscription.reminders.enabled
    )
      continue;
    for (const offsetDays of subscription.reminders.offsets) {
      const id = `subscription-reminder:${occurrence.id}:${offsetDays}`;
      const date = addDays(occurrence.expectedDate, -offsetDays);
      const local = new Date(
        `${date}T${String(subscription.reminders.hour).padStart(
          2,
          '0',
        )}:${String(subscription.reminders.minute).padStart(2, '0')}:00`,
      );
      // The local constructor intentionally handles DST gaps using the device zone.
      const fireAt = local.toISOString();
      const existing = state.reminders.find(value => value.id === id);
      if (fireAt <= now && existing?.deliveryStatus !== 'scheduled') continue;
      wantedReminders.add(id);
      if (existing?.deliveryStatus === 'delivered') continue;
      const title =
        offsetDays === 0
          ? `${subscription.name} se cobra hoy`
          : `${subscription.name} se cobra en ${offsetDays} días`;
      const message = `${occurrence.expectedAmount} COP`;
      if (
        existing &&
        existing.fireAt === fireAt &&
        existing.title === title &&
        existing.message === message &&
        existing.desired === 'scheduled'
      )
        continue;
      const next = {
        id,
        occurrenceId: occurrence.id,
        offsetDays,
        revision: (existing?.revision ?? 0) + 1,
        fireAt,
        title,
        message,
        desired: 'scheduled' as const,
        deliveryStatus: 'pending' as const,
        updatedAt: now,
      };
      if (existing) Object.assign(existing, next, { error: undefined });
      else state.reminders.push(next);
    }
  }
  for (const reminder of state.reminders) {
    if (
      !wantedReminders.has(reminder.id) &&
      reminder.desired !== 'cancelled' &&
      reminder.deliveryStatus !== 'delivered'
    )
      Object.assign(reminder, {
        desired: 'cancelled',
        deliveryStatus: 'pending',
        revision: reminder.revision + 1,
        updatedAt: now,
      });
  }
  for (const alert of state.alerts) {
    const persistentPrice = alert.alertType === 'subscription_price_changed';
    if (
      alert.status === 'open' &&
      !persistentPrice &&
      !wantedAlerts.has(alert.id)
    )
      Object.assign(alert, {
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
      });
    if (
      persistentPrice &&
      alert.relatedEntityType === 'subscription_occurrence'
    ) {
      const occurrence = state.occurrences.find(
        value => value.id === alert.relatedEntityId,
      );
      if (
        occurrence &&
        (occurrence.status !== 'paid' ||
          occurrence.actualAmount === occurrence.expectedAmount) &&
        alert.status !== 'resolved'
      )
        Object.assign(alert, {
          status: 'resolved',
          resolvedAt: now,
          updatedAt: now,
        });
    }
  }
  return hasMore;
}
export function subscriptionMatches(
  state: SubscriptionState,
  transaction: Transaction,
): SubscriptionMatch[] {
  if (
    transaction.status !== 'posted' ||
    transaction.type !== 'expense' ||
    transaction.direction !== 'outflow' ||
    state.occurrences.some(value => value.transactionId === transaction.id)
  )
    return [];
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const transactionDate = transaction.civilDate ?? transaction.date.slice(0, 10);
  return state.occurrences
    .flatMap(occurrence => {
      if (
        !['pending', 'overdue'].includes(occurrence.status) ||
        !compatibleSubscriptionPayment(occurrence, transaction) ||
        Math.abs(daysBetween(occurrence.expectedDate, transactionDate)) > 7
      )
        return [];
      const subscription = state.subscriptions.find(
        value => value.id === occurrence.subscriptionId,
      );
      if (!subscription) return [];
      let score = 10;
      const reasons = ['Fecha dentro de ±7 días'];
      const merchant = normalize(
        subscription.merchantName ?? subscription.name,
      );
      if (
        merchant &&
        normalize(
          `${transaction.merchantName ?? ''} ${transaction.description}`,
        ).includes(merchant)
      ) {
        score += 40;
        reasons.push('Comercio o descripción coincidente');
      }
      if (occurrence.accountId === transaction.accountId) {
        score += 20;
        reasons.push('Misma cuenta');
      }
      if (
        subscription.categoryId &&
        subscription.categoryId === transaction.categoryId
      ) {
        score += 10;
        reasons.push('Misma categoría');
      }
      if (
        Math.abs(transaction.amount - occurrence.expectedAmount) /
          occurrence.expectedAmount <=
        0.1
      ) {
        score += 20;
        reasons.push('Importe dentro del 10%');
      }
      return score >= 30
        ? [{ occurrenceId: occurrence.id, score, reasons }]
        : [];
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.occurrenceId.localeCompare(b.occurrenceId),
    );
}
