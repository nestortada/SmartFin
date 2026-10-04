import type { SubscriptionRecurrence } from '../types';

export function parseCivilDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('Fecha civil inválida. Usa YYYY-MM-DD.');
  const date = new Date(`${value}T12:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error('Fecha inexistente.');
  return date;
}
export function civilDate(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${(
    date.getMonth() + 1
  )
    .toString()
    .padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}
export function addDays(value: string, days: number): string {
  const date = parseCivilDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function recurrenceInterval(rule: SubscriptionRecurrence): {
  interval: number;
  unit: 'days' | 'months';
} {
  switch (rule.periodicity) {
    case 'weekly':
      return { interval: 7, unit: 'days' };
    case 'biweekly':
      return { interval: 14, unit: 'days' };
    case 'monthly':
      return { interval: 1, unit: 'months' };
    case 'bimonthly':
      return { interval: 2, unit: 'months' };
    case 'quarterly':
      return { interval: 3, unit: 'months' };
    case 'semiannual':
      return { interval: 6, unit: 'months' };
    case 'yearly':
      return { interval: 12, unit: 'months' };
    case 'custom':
      if (
        !Number.isSafeInteger(rule.interval) ||
        rule.interval <= 0 ||
        !['days', 'weeks', 'months'].includes(rule.unit)
      )
        throw new Error('Recurrencia personalizada inválida.');
      return {
        interval: rule.interval * (rule.unit === 'weeks' ? 7 : 1),
        unit: rule.unit === 'months' ? 'months' : 'days',
      };
    default:
      throw new Error('Periodicidad inválida.');
  }
}
export function dateAtPeriod(
  anchor: string,
  rule: SubscriptionRecurrence,
  billingDay: number,
  period: number,
): string {
  const { interval, unit } = recurrenceInterval(rule);
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31)
    throw new Error('Día de facturación inválido.');
  if (unit === 'days') return addDays(anchor, interval * period);
  const date = parseCivilDate(anchor);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + interval * period);
  const last = new Date(date.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(billingDay, last.getUTCDate()));
  return date.toISOString().slice(0, 10);
}
export function nextContractDate(
  anchor: string,
  rule: SubscriptionRecurrence,
  billingDay: number,
  from: string,
  inclusive = true,
): string {
  const a = parseCivilDate(anchor);
  const f = parseCivilDate(from);
  const { interval, unit } = recurrenceInterval(rule);
  const distance =
    unit === 'days'
      ? (f.getTime() - a.getTime()) / 86400000
      : (f.getUTCFullYear() - a.getUTCFullYear()) * 12 +
        f.getUTCMonth() -
        a.getUTCMonth();
  let period = Math.max(0, Math.floor(distance / interval));
  let candidate = dateAtPeriod(anchor, rule, billingDay, period);
  while (
    candidate < anchor ||
    candidate < from ||
    (!inclusive && candidate === from)
  ) {
    candidate = dateAtPeriod(anchor, rule, billingDay, ++period);
  }
  return candidate;
}
export function calculateNextSubscriptionDate(
  anchor: string,
  rule: SubscriptionRecurrence,
  billingDay: number,
  after: string,
): string {
  return nextContractDate(anchor, rule, billingDay, after, false);
}
export function roundSubscriptionMoney(amount: number): number {
  if (
    !Number.isFinite(amount) ||
    Math.abs(amount) > Number.MAX_SAFE_INTEGER / 100
  )
    throw new Error('Importe fuera del rango seguro.');
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
export function annualEquivalent(
  amount: number,
  rule: SubscriptionRecurrence,
): number {
  const { interval, unit } = recurrenceInterval(rule);
  return amount * (unit === 'months' ? 12 / interval : 365.2425 / interval);
}
export function daysBetween(a: string, b: string): number {
  return (parseCivilDate(a).getTime() - parseCivilDate(b).getTime()) / 86400000;
}
