import {
  calculateNextSubscriptionDate,
  nextContractDate,
  annualEquivalent,
  civilDate,
  addDays,
  roundSubscriptionMoney,
} from '../src/modules/subscriptions/useCases/recurrence';
import type { SubscriptionRecurrence } from '../src/modules/subscriptions/types';

test.each<[SubscriptionRecurrence, string, string]>([
  [{ periodicity: 'weekly' }, '2026-12-28', '2027-01-04'],
  [{ periodicity: 'biweekly' }, '2026-12-28', '2027-01-11'],
  [{ periodicity: 'monthly' }, '2026-01-31', '2026-02-28'],
  [{ periodicity: 'bimonthly' }, '2026-01-31', '2026-03-31'],
  [{ periodicity: 'quarterly' }, '2026-01-31', '2026-04-30'],
  [{ periodicity: 'semiannual' }, '2026-08-31', '2027-02-28'],
  [{ periodicity: 'yearly' }, '2024-02-29', '2025-02-28'],
  [
    { periodicity: 'custom', interval: 3, unit: 'days' },
    '2026-12-31',
    '2027-01-03',
  ],
  [
    { periodicity: 'custom', interval: 3, unit: 'weeks' },
    '2026-12-31',
    '2027-01-21',
  ],
  [
    { periodicity: 'custom', interval: 5, unit: 'months' },
    '2026-01-31',
    '2026-06-30',
  ],
])('advances %j from %s to %s', (rule, anchor, expected) => {
  expect(
    calculateNextSubscriptionDate(
      anchor,
      rule,
      Number(anchor.slice(8)),
      anchor,
    ),
  ).toBe(expected);
});
test.each([29, 30, 31])('preserves billing day %i after February', day => {
  const anchor = `2026-01-${day}`;
  expect(
    calculateNextSubscriptionDate(
      anchor,
      { periodicity: 'monthly' },
      day,
      '2026-02-28',
    ),
  ).toBe(`2026-03-${day}`);
  expect(
    calculateNextSubscriptionDate(
      `2024-01-${day}`,
      { periodicity: 'monthly' },
      day,
      `2024-01-${day}`,
    ),
  ).toBe('2024-02-29');
});
test('civil dates do not drift across DST and annualization uses the Gregorian average', () => {
  expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
  expect(
    nextContractDate(
      '2026-01-31',
      { periodicity: 'monthly' },
      31,
      '2026-02-15',
    ),
  ).toBe('2026-02-28');
  expect(annualEquivalent(7, { periodicity: 'weekly' })).toBe(365.2425);
  expect(annualEquivalent(14, { periodicity: 'biweekly' })).toBe(365.2425);
  expect(roundSubscriptionMoney(19.999)).toBe(20);
  expect(civilDate(new Date(2026, 9, 3, 9))).toBe('2026-10-03');
});
test('rejects invalid dates, recurrence and unsafe money', () => {
  expect(() => addDays('2026-02-29', 1)).toThrow();
  expect(() =>
    annualEquivalent(5, { periodicity: 'custom', interval: 0, unit: 'days' }),
  ).toThrow();
  expect(() => roundSubscriptionMoney(Infinity)).toThrow();
  expect(() => roundSubscriptionMoney(Number.MAX_SAFE_INTEGER)).toThrow();
});
