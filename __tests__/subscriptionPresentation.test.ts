import {
  chargeRange,
  groupCharges,
  formatSubscriptionAmountInput,
  parseSubscriptionAmount,
  previewSubscriptionDate,
  selectableSubscriptionAccounts,
  subscriptionDraft,
  subscriptionInputFromDraft,
} from '../src/modules/subscriptions/useCases/subscriptionPresentation';

test('COP input groups thousands, preserves decimal comma and keeps invalid negative drafts rejectable', () => {
  expect(formatSubscriptionAmountInput('1234567,50')).toBe('1.234.567,50');
  expect(formatSubscriptionAmountInput('1.234.567,')).toBe('1.234.567,');
  expect(formatSubscriptionAmountInput('44900')).toBe('44.900');
  expect(() =>
    parseSubscriptionAmount(formatSubscriptionAmountInput('-44900')),
  ).toThrow();
});

test('quick ranges include today and exactly 7 or 30 civil dates', () => {
  expect(chargeRange(7, '2026-12-29')).toEqual({
    from: '2026-12-29',
    to: '2027-01-04',
  });
  expect(chargeRange(30, '2028-02-01')).toEqual({
    from: '2028-02-01',
    to: '2028-03-01',
  });
});
test.each([
  ['38.900', 38900],
  ['38.900,50', 38900.5],
  ['38900.50', 38900.5],
  ['38900', 38900],
])('COP entry %s is parsed safely', (text, amount) =>
  expect(parseSubscriptionAmount(String(text))).toBe(amount),
);
test.each([
  '0',
  '-1',
  'NaN',
  'Infinity',
  '12.345.67',
  '1,000,000',
  '9007199254740992',
])('invalid money %s is rejected', value =>
  expect(() => parseSubscriptionAmount(value)).toThrow(),
);
test('day 31 preview clamps February and returns to March 31; form stays unpersisted', () => {
  const draft = {
    ...subscriptionDraft(),
    name: 'Netflix',
    amount: '38.900',
    anchorDate: '2028-01-31',
    billingDay: '31',
  };
  expect(previewSubscriptionDate(draft, '2028-02-01')).toBe('2028-02-29');
  expect(previewSubscriptionDate(draft, '2028-03-01')).toBe('2028-03-31');
  expect(subscriptionInputFromDraft(draft)).toMatchObject({
    amount: 38900,
    recurrence: { periodicity: 'monthly' },
    reminders: { offsets: [3, 1, 0], hour: 9, minute: 0 },
  });
});
test('custom intervals, reminder time and optional reference clearing are validated', () => {
  const draft = {
    ...subscriptionDraft(),
    name: 'Servicio',
    amount: '100',
    periodicity: 'custom' as const,
    interval: '2',
    unit: 'weeks' as const,
    accountId: '',
    subcategoryId: '',
  };
  expect(subscriptionInputFromDraft(draft)).toMatchObject({
    recurrence: { periodicity: 'custom', interval: 2, unit: 'weeks' },
    accountId: undefined,
    subcategoryId: undefined,
  });
  expect(() => subscriptionInputFromDraft({ ...draft, interval: '0' })).toThrow(
    'Recurrencia',
  );
  expect(() => subscriptionInputFromDraft({ ...draft, time: '24:00' })).toThrow(
    'hora',
  );
  expect(() => subscriptionInputFromDraft({ ...draft, offsets: [] })).toThrow(
    'recordatorio',
  );
});
test('account selector exposes active COP cash, bank, savings and credit cards only', () => {
  const accounts = [
    'cash',
    'bankAccount',
    'savingsAccount',
    'creditCard',
    'investment',
  ].map(type => ({
    id: type,
    name: type,
    type,
    status: 'active',
    currency: 'COP',
  }));
  accounts.push(
    {
      id: 'closed',
      name: 'Cerrada',
      type: 'bankAccount',
      status: 'closed',
      currency: 'COP',
    },
    { id: 'usd', name: 'USD', type: 'cash', status: 'active', currency: 'USD' },
  );
  expect(
    selectableSubscriptionAccounts({
      accounts,
      categories: [],
      subcategories: [],
    }).map(value => value.id),
  ).toEqual(['cash', 'bankAccount', 'savingsAccount', 'creditCard']);
});
test('charge grouping is chronological and keeps all occurrences', () => {
  const base = {
    subscriptionId: 'netflix',
    subscriptionName: 'Netflix',
    expectedAmount: 44900,
    currency: 'COP' as const,
    status: 'pending' as const,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
  const charges = [
    { ...base, id: 'later', expectedDate: '2026-11-01' },
    { ...base, id: 'first', expectedDate: '2026-10-01' },
    { ...base, id: 'same-day', expectedDate: '2026-10-01' },
  ];
  expect(
    groupCharges(charges).map(group => ({
      date: group.date,
      ids: group.items.map(item => item.id),
    })),
  ).toEqual([
    { date: '2026-10-01', ids: ['first', 'same-day'] },
    { date: '2026-11-01', ids: ['later'] },
  ]);
});
