import type {
  SharedExpenseState,
  SharedLossEvent,
  SharedLossEntry,
  SharedObligationStatus,
} from '../types/SharedExpense';
import { validateCivilDate } from '../../../shared/utils/transactionDate';

/** Signed integer arithmetic validated before conversion to public COP amounts. */
export function lossMinor(events: SharedLossEvent[]): number {
  const total = events.reduce((sum, event) => {
    if (!Number.isSafeInteger(event.amountMinor) || event.amountMinor <= 0)
      throw new Error('Importe en centavos inválido.');
    const sign =
      event.kind === 'forgiveness' || event.kind === 'recoveryReversal'
        ? 1n
        : -1n;
    return sum + sign * BigInt(event.amountMinor);
  }, 0n);
  if (
    total > BigInt(Number.MAX_SAFE_INTEGER) ||
    total < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error('Pérdida fuera del rango seguro.');
  return Number(total);
}
export function forgivenMinor(
  state: SharedExpenseState,
  participationId: string,
  asOf?: string,
): number {
  return lossMinor(
    state.lossEvents.filter(
      e =>
        e.participationId === participationId &&
        (e.kind === 'forgiveness' || e.kind === 'forgivenessReversal') &&
        (!asOf || e.date <= asOf),
    ),
  );
}
export function recoveredReceiptMinor(
  state: SharedExpenseState,
  receiptId: string,
  asOf?: string,
): number {
  return -lossMinor(
    state.lossEvents.filter(
      e =>
        e.receiptId === receiptId &&
        (e.kind === 'recovery' || e.kind === 'recoveryReversal') &&
        (!asOf || e.date <= asOf),
    ),
  );
}
export function recoveredForgivenessMinor(
  state: SharedExpenseState,
  forgivenessId: string,
): number {
  const recoveries = state.lossEvents.filter(
    e => e.kind === 'recovery' && e.relatedEventId === forgivenessId,
  );
  return -lossMinor(
    state.lossEvents.filter(e =>
      recoveries.some(r => r.id === e.id || r.id === e.relatedEventId),
    ),
  );
}
export function isReversed(
  state: SharedExpenseState,
  eventId: string,
): boolean {
  return state.lossEvents.some(
    e =>
      e.relatedEventId === eventId &&
      (e.kind === 'forgivenessReversal' || e.kind === 'recoveryReversal'),
  );
}
export function obligationStatus(
  pending: number,
  received: number,
  forgiven: number,
): SharedObligationStatus {
  if (pending === 0)
    return forgiven > 0
      ? received > 0
        ? 'completedMixed'
        : 'fullyForgiven'
      : 'completed';
  return forgiven > 0
    ? 'partiallyForgiven'
    : received > 0
    ? 'partiallyReimbursed'
    : 'pending';
}
export function getSharedLossEntries(
  state: SharedExpenseState,
  startDate?: string,
  endDateExclusive?: string,
): SharedLossEntry[] {
  if (startDate) validateCivilDate(startDate);
  if (endDateExclusive) validateCivilDate(endDateExclusive);
  return state.lossEvents
    .filter(
      e =>
        (!startDate || e.date >= startDate) &&
        (!endDateExclusive || e.date < endDateExclusive),
    )
    .map(e => ({
      ...e,
      classification: 'unrecoveredSharedExpenseLoss',
      lossDelta: lossMinor([e]) / 100,
      bankFlow: 0,
    }));
}

export type ForgivenessInput = {
  participationId: string;
  amount: number;
  date: string;
  reason?: string;
};
export type RecoveryInput = {
  forgivenessId: string;
  receiptId: string;
  amount: number;
  date: string;
  reason?: string;
};
export type LossReversalInput = {
  eventId: string;
  date: string;
  reason?: string;
};
