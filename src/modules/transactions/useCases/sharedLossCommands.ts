import type { SharedExpenseContext } from '../repositories/SharedExpenseRepository';
import { validateCivilDate } from '../../../shared/utils/transactionDate';
import {
  allocatedToParticipation,
  availableReceipt,
  toMinor,
} from './sharedExpenseDomain';
import {
  forgivenMinor,
  isReversed,
  recoveredForgivenessMinor,
  type ForgivenessInput,
  type RecoveryInput,
  type LossReversalInput,
} from './sharedLossDomain';

type LossContext = Pick<SharedExpenseContext, 'state' | 'now' | 'id'>;

function participation(context: LossContext, id: string) {
  const part = context.state.participations.find(
    p => p.id === id && p.active && p.contactId,
  );
  const expense = context.state.expenses.find(
    e => e.id === part?.expenseId && e.status === 'active',
  );
  if (!part?.contactId || !expense)
    throw new Error('La obligación ya no está activa.');
  return { part, expense };
}
export function forgive(context: LossContext, input: ForgivenessInput) {
  validateCivilDate(input.date);
  const { part, expense } = participation(context, input.participationId);
  const amountMinor = toMinor(input.amount);
  if (input.date < expense.date)
    throw new Error('La condonación no puede ser anterior a la compra.');
  if (
    amountMinor >
    part.amountMinor -
      allocatedToParticipation(context.state, part.id) -
      forgivenMinor(context.state, part.id)
  )
    throw new Error('La condonación supera el saldo pendiente.');
  // Prevent a newly backdated forgiveness from consuming cents already settled in a later event.
  const latestSettlement = [
    ...context.state.lossEvents
      .filter(e => e.participationId === part.id)
      .map(e => e.date),
    ...context.state.allocations
      .filter(a => a.active && a.participationId === part.id)
      .map(a => context.state.receipts.find(r => r.id === a.receiptId)!.date),
  ]
    .sort()
    .pop();
  if (latestSettlement && input.date < latestSettlement)
    throw new Error(
      'La condonación debe seguir la fecha de los abonos y eventos de la obligación.',
    );
  const id = context.id('loss');
  context.state.lossEvents.push({
    id,
    kind: 'forgiveness',
    expenseId: expense.id,
    participationId: part.id,
    contactId: part.contactId!,
    amountMinor,
    date: input.date,
    reason: input.reason?.trim() || undefined,
    createdAt: context.now,
  });
  return { entityId: id };
}
export function recover(context: LossContext, input: RecoveryInput) {
  validateCivilDate(input.date);
  const event = context.state.lossEvents.find(
    e => e.id === input.forgivenessId && e.kind === 'forgiveness',
  );
  const receipt = context.state.receipts.find(
    r => r.id === input.receiptId && r.status === 'active',
  );
  if (
    !event ||
    isReversed(context.state, event.id) ||
    !receipt ||
    receipt.contactId !== event.contactId
  )
    throw new Error(
      'Selecciona una condonación vigente y un cobro de la misma persona.',
    );
  participation(context, event.participationId);
  const latest = context.state.lossEvents
    .filter(e => e.participationId === event.participationId)
    .map(e => e.date)
    .sort()
    .pop()!;
  if (input.date < latest || input.date < receipt.date)
    throw new Error(
      'La recuperación no puede ser anterior a la condonación o al cobro.',
    );
  const amountMinor = toMinor(input.amount);
  if (
    amountMinor >
      event.amountMinor - recoveredForgivenessMinor(context.state, event.id) ||
    amountMinor > availableReceipt(context.state, receipt.id)
  )
    throw new Error(
      'La recuperación supera la pérdida o el dinero disponible.',
    );
  const id = context.id('loss');
  context.state.lossEvents.push({
    ...event,
    id,
    kind: 'recovery',
    amountMinor,
    date: input.date,
    reason: input.reason?.trim() || undefined,
    relatedEventId: event.id,
    receiptId: receipt.id,
    createdAt: context.now,
  });
  return { entityId: id };
}
export function reverseLoss(context: LossContext, input: LossReversalInput) {
  validateCivilDate(input.date);
  const event = context.state.lossEvents.find(e => e.id === input.eventId);
  if (
    !event ||
    !['forgiveness', 'recovery'].includes(event.kind) ||
    isReversed(context.state, event.id)
  )
    throw new Error('El evento no está disponible para reversión.');
  participation(context, event.participationId);
  const latest = context.state.lossEvents
    .filter(e => e.participationId === event.participationId)
    .map(e => e.date)
    .sort()
    .pop()!;
  if (input.date < latest)
    throw new Error(
      'La reversión no puede ser anterior a los eventos de la obligación.',
    );
  if (
    event.kind === 'forgiveness' &&
    recoveredForgivenessMinor(context.state, event.id) > 0
  )
    throw new Error('Revierte primero las recuperaciones de esta condonación.');
  const id = context.id('loss');
  context.state.lossEvents.push({
    ...event,
    id,
    kind:
      event.kind === 'forgiveness' ? 'forgivenessReversal' : 'recoveryReversal',
    relatedEventId: event.id,
    date: input.date,
    reason: input.reason?.trim() || undefined,
    createdAt: context.now,
  });
  return { entityId: id };
}
