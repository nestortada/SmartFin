import type { AiSubscriptionFields } from '../../transactions/types/AiCommand';
import type { SubscriptionInput, SubscriptionRecurrence } from '../types';
import {
  parseCivilDate,
  recurrenceInterval,
  roundSubscriptionMoney,
} from './recurrence';

/** Translate the reviewed AI draft; never infer account, category, dates or financial movements. */
export function subscriptionFromAiFields(
  fields: AiSubscriptionFields,
  references: Map<string, string>,
): SubscriptionInput {
  const reference = (
    id: string | null | undefined,
    ref: string | null | undefined,
  ) => {
    if (ref && (!references.has(ref) || (id && id !== references.get(ref))))
      throw new Error(`Referencia no resuelta: ${ref}`);
    return id ?? (ref ? references.get(ref) : undefined);
  };
  if (!fields.name?.trim())
    throw new Error('Falta el nombre de la suscripción.');
  if (fields.amount == null || roundSubscriptionMoney(fields.amount) <= 0)
    throw new Error('Falta un importe válido de suscripción.');
  if (!fields.anchorDate) throw new Error('Falta la fecha contractual.');
  parseCivilDate(fields.anchorDate);
  if (!fields.periodicity) throw new Error('Falta la periodicidad.');
  const recurrence: SubscriptionRecurrence =
    fields.periodicity === 'custom'
      ? {
          periodicity: 'custom',
          interval: fields.customInterval ?? 0,
          unit: fields.customUnit ?? 'days',
        }
      : { periodicity: fields.periodicity };
  if (fields.periodicity === 'custom' && !fields.customUnit)
    throw new Error('Falta la unidad de la recurrencia personalizada.');
  recurrenceInterval(recurrence);
  if (fields.remindersEnabled == null)
    throw new Error('Indica si quieres recordatorios.');
  if (
    fields.remindersEnabled &&
    (fields.reminderOffsets == null ||
      fields.reminderHour == null ||
      fields.reminderMinute == null)
  )
    throw new Error('Falta completar los recordatorios.');
  if (
    fields.remindersEnabled &&
    !/^\d+(?:\s*,\s*\d+)*$/.test(fields.reminderOffsets ?? '')
  )
    throw new Error('Escribe los días de anticipación separados por comas.');
  return {
    name: fields.name,
    merchantName: fields.merchantName ?? undefined,
    amount: fields.amount,
    anchorDate: fields.anchorDate,
    billingDay: fields.billingDay ?? undefined,
    recurrence,
    accountId: reference(fields.accountId, fields.accountRef),
    categoryId: reference(fields.categoryId, fields.categoryRef),
    subcategoryId: reference(fields.subcategoryId, fields.subcategoryRef),
    reminders: fields.remindersEnabled
      ? {
          enabled: true,
          offsets: fields.reminderOffsets!.split(',').map(Number),
          hour: fields.reminderHour!,
          minute: fields.reminderMinute!,
        }
      : { enabled: false },
  };
}
