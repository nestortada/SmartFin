import type { Account } from '../src/modules/accounts';
import { buildDebitCardsOverview } from '../src/modules/accounts';
import type { Transaction } from '../src/modules/transactions';

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-bank',
    balance: { amount: 1000000, currency: 'COP' },
    createdAt: '2026-05-01',
    currency: 'COP',
    institutionName: 'Banco',
    name: 'Debito Banco',
    status: 'active',
    type: 'bankAccount',
    updatedAt: '2026-05-01',
    ...overrides,
  };
}

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx',
    accountId: 'account-bank',
    amount: 100000,
    createdAt: '2026-05-10T12:00:00.000Z',
    currency: 'COP',
    date: '2026-05-10T12:00:00.000Z',
    description: 'Movimiento',
    direction: 'outflow',
    merchantName: 'Comercio',
    paymentMethod: 'debit',
    status: 'posted',
    type: 'expense',
    updatedAt: '2026-05-10T12:00:00.000Z',
    ...overrides,
  };
}

describe('buildDebitCardsOverview', () => {
  it('builds debit card movements and monthly metrics from local accounts', () => {
    const overview = buildDebitCardsOverview(
      [
        account(),
        account({ id: 'cash', type: 'cash' }),
        account({ id: 'closed', status: 'closed' }),
      ],
      [
        transaction({ id: 'payment', amount: 120000 }),
        transaction({
          id: 'top-up',
          accountId: 'account-bank',
          amount: 300000,
          direction: 'inflow',
          targetAccountId: 'source-account',
          type: 'internalTransfer',
        }),
        transaction({
          id: 'transfer-out',
          amount: 200000,
          direction: 'outflow',
          targetAccountId: 'other-account',
          type: 'internalTransfer',
        }),
        transaction({
          id: 'income',
          amount: 500000,
          direction: 'inflow',
          type: 'income',
        }),
        transaction({
          id: 'old-payment',
          amount: 90000,
          date: '2026-04-10T12:00:00.000Z',
        }),
      ],
      new Date('2026-05-20T12:00:00.000Z'),
    );

    expect(overview.cards).toHaveLength(1);
    expect(overview.totalAvailable).toBe(1000000);
    expect(overview.cards[0]?.movements.map(movement => movement.kind)).toEqual([
      'payment',
      'topUp',
      'transferOut',
      'income',
      'payment',
    ]);
    expect(overview.cards[0]?.monthlyMetrics).toEqual({
      income: 500000,
      netFlow: 480000,
      payments: 120000,
      topUps: 300000,
      transfersOut: 200000,
    });
  });

  it('builds a seven day weekly trend with signed daily net values', () => {
    const overview = buildDebitCardsOverview(
      [account()],
      [
        transaction({
          id: 'monday-payment',
          amount: 100000,
          date: '2026-05-18T12:00:00.000Z',
        }),
        transaction({
          id: 'monday-top-up',
          accountId: 'account-bank',
          amount: 250000,
          date: '2026-05-18T14:00:00.000Z',
          direction: 'inflow',
          targetAccountId: 'other-account',
          type: 'internalTransfer',
        }),
        transaction({
          id: 'older-payment',
          amount: 80000,
          date: '2026-05-10T12:00:00.000Z',
        }),
      ],
      new Date('2026-05-20T12:00:00.000Z'),
    );

    expect(overview.cards[0]?.weeklyTrend).toHaveLength(7);
    expect(overview.cards[0]?.weeklyTrend.find(point => point.date === '2026-05-18')).toEqual({
      date: '2026-05-18',
      label: 'LUN',
      netAmount: 150000,
    });
  });
});
