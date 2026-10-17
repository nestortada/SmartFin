import type {
  Subscription,
  SubscriptionInput,
  SubscriptionRecurrence,
  SubscriptionFormOptions,
  SubscriptionCharge,
  OccurrenceStatus,
  SubscriptionStatus,
  SkipReason,
} from '../types';
import {
  addDays,
  civilDate,
  nextContractDate,
  parseCivilDate,
  recurrenceInterval,
  roundSubscriptionMoney,
} from './recurrence';

export const RECURRENCE_LABELS: Record<
  SubscriptionRecurrence['periodicity'],
  string
> = {
  weekly: 'Semanal',
  biweekly: 'Cada 14 días',
  monthly: 'Mensual',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  yearly: 'Anual',
  custom: 'Personalizada',
};
export const STATUS_LABELS: Record<
  SubscriptionStatus | OccurrenceStatus,
  string
> = {
  active: 'Activa',
  paused: 'Pausada',
  cancelled: 'Cancelada',
  pending: 'Pendiente',
  overdue: 'Vencido',
  paid: 'Pagado',
  skipped: 'Saltado',
};
export const SKIP_LABELS: Record<SkipReason, string> = {
  manual: 'Saltado por el usuario',
  pause: 'Saltado por pausa',
  cancellation: 'Saltado por cancelación',
  rescheduled: 'Programación modificada',
};
export function subscriptionMoney(value: number): string {
  return `${new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)} COP`;
}
export function subscriptionDate(value: string, long = false): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: long ? 'long' : 'short',
    year: long ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(parseCivilDate(value));
}
/** Receives the movement's civil day, or the preserved legacy ISO prefix. */
export function subscriptionTransactionDate(
  value: string,
  long = false,
): string {
  return subscriptionDate(value.slice(0, 10), long);
}
export function recurrenceLabel(rule: SubscriptionRecurrence): string {
  if (rule.periodicity !== 'custom') return RECURRENCE_LABELS[rule.periodicity];
  return `Cada ${rule.interval} ${
    rule.unit === 'days' ? 'días' : rule.unit === 'weeks' ? 'semanas' : 'meses'
  }`;
}
export function chargeRange(days: 7 | 30, today = civilDate(new Date())) {
  return { from: today, to: addDays(today, days - 1) };
}
export function groupCharges(charges: SubscriptionCharge[]) {
  const groups = new Map<string, SubscriptionCharge[]>();
  for (const charge of charges)
    groups.set(charge.expectedDate, [
      ...(groups.get(charge.expectedDate) ?? []),
      charge,
    ]);
  return Array.from(groups, ([date, items]) => ({ date, items })).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}
export function expectedChargeTotal(charges: SubscriptionCharge[]) {
  return roundSubscriptionMoney(
    charges.reduce((sum, value) => sum + value.expectedAmount, 0),
  );
}
export function selectableSubscriptionAccounts(
  options: SubscriptionFormOptions,
) {
  return options.accounts.filter(
    value =>
      value.status === 'active' &&
      value.currency === 'COP' &&
      ['cash', 'bankAccount', 'savingsAccount', 'creditCard'].includes(
        value.type,
      ),
  );
}
export type SubscriptionFormDraft = {
  name: string;
  merchantName: string;
  amount: string;
  accountId: string;
  categoryId: string;
  subcategoryId: string;
  anchorDate: string;
  billingDay: string;
  periodicity: SubscriptionRecurrence['periodicity'];
  interval: string;
  unit: 'days' | 'weeks' | 'months';
  enabled: boolean;
  offsets: number[];
  time: string;
};
export function subscriptionDraft(value?: Subscription): SubscriptionFormDraft {
  const anchorDate = value?.anchorDate ?? civilDate(new Date());
  return {
    name: value?.name ?? '',
    merchantName: value?.merchantName ?? '',
    amount: value ? String(value.amount).replace('.', ',') : '',
    accountId: value?.accountId ?? '',
    categoryId: value?.categoryId ?? '',
    subcategoryId: value?.subcategoryId ?? '',
    anchorDate,
    billingDay: String(value?.billingDay ?? Number(anchorDate.slice(-2))),
    periodicity: value?.recurrence.periodicity ?? 'monthly',
    interval:
      value?.recurrence.periodicity === 'custom'
        ? String(value.recurrence.interval)
        : '1',
    unit:
      value?.recurrence.periodicity === 'custom'
        ? value.recurrence.unit
        : 'months',
    enabled: value?.reminders.enabled ?? true,
    offsets: value?.reminders.offsets ?? [3, 1, 0],
    time: value
      ? `${String(value.reminders.hour).padStart(2, '0')}:${String(
          value.reminders.minute,
        ).padStart(2, '0')}`
      : '09:00',
  };
}
export function draftRecurrence(
  draft: SubscriptionFormDraft,
): SubscriptionRecurrence {
  const rule: SubscriptionRecurrence =
    draft.periodicity === 'custom'
      ? {
          periodicity: 'custom',
          interval: Number(draft.interval),
          unit: draft.unit,
        }
      : { periodicity: draft.periodicity };
  recurrenceInterval(rule);
  return rule;
}
export function parseSubscriptionAmount(value: string): number {
  const text = value.trim();
  // Colombian grouping and decimal comma; ungrouped decimal dot is also accepted.
  const valid =
    /^\d+(?:[.,]\d{1,2})?$/.test(text) ||
    /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text);
  if (!valid) throw new Error('Introduce un importe válido en COP.');
  const normalized =
    text.includes(',') || /^\d{1,3}(?:\.\d{3})+$/.test(text)
      ? text.replace(/\./g, '').replace(',', '.')
      : text;
  const amount = roundSubscriptionMoney(Number(normalized));
  if (amount <= 0) throw new Error('El importe debe ser mayor que cero.');
  return amount;
}
export { formatCopAmountInput as formatSubscriptionAmountInput } from '../../../shared/utils/copAmountInput';
export function previewSubscriptionDate(
  draft: SubscriptionFormDraft,
  today = civilDate(new Date()),
) {
  return nextContractDate(
    draft.anchorDate,
    draftRecurrence(draft),
    Number(draft.billingDay),
    today,
  );
}
export function subscriptionInputFromDraft(
  draft: SubscriptionFormDraft,
): SubscriptionInput {
  if (!draft.name.trim()) throw new Error('El nombre es obligatorio.');
  const recurrence = draftRecurrence(draft);
  parseCivilDate(draft.anchorDate);
  const billingDay = Number(draft.billingDay);
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31)
    throw new Error('El día contractual debe estar entre 1 y 31.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time))
    throw new Error('Usa una hora válida en formato HH:mm.');
  const [hour, minute] = draft.time.split(':').map(Number);
  if (draft.enabled && !draft.offsets.length)
    throw new Error('Selecciona al menos un recordatorio o desactívalos.');
  return {
    name: draft.name.trim(),
    merchantName: draft.merchantName.trim() || undefined,
    amount: parseSubscriptionAmount(draft.amount),
    currency: 'COP',
    accountId: draft.accountId || undefined,
    categoryId: draft.categoryId || undefined,
    subcategoryId: draft.subcategoryId || undefined,
    recurrence,
    anchorDate: draft.anchorDate,
    billingDay,
    reminders: {
      enabled: draft.enabled,
      offsets: [...new Set(draft.offsets)].sort((a, b) => b - a),
      hour,
      minute,
    },
  };
}
