import { transactionMatchesAccountFilter } from '../src/modules/transactions/hooks/useTransactionsList';
import type { Transaction } from '../src/modules/transactions';

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx',
    accountId: 'source-account',
    amount: 100000,
    createdAt: '2026-05-20T12:00:00.000Z',
    currency: 'COP',
    date: '2026-05-20T12:00:00.000Z',
    description: 'Movimiento',
    direction: 'neutral',
    status: 'posted',
    targetAccountId: 'target-account',
    type: 'internalTransfer',
    updatedAt: '2026-05-20T12:00:00.000Z',
    ...overrides,
  };
}

describe('transactionMatchesAccountFilter', () => {
  it('matches only the visible leg account for internal transfer filters', () => {
    expect(transactionMatchesAccountFilter(transaction(), 'source-account')).toBe(true);
    expect(transactionMatchesAccountFilter(transaction(), 'target-account')).toBe(false);
    expect(transactionMatchesAccountFilter(transaction(), 'other-account')).toBe(false);
  });

  it('matches the incoming transfer leg on the destination card', () => {
    expect(transactionMatchesAccountFilter(
      transaction({
        accountId: 'target-account',
        direction: 'inflow',
        targetAccountId: 'source-account',
      }),
      'target-account',
    )).toBe(true);
    expect(transactionMatchesAccountFilter(
      transaction({
        accountId: 'target-account',
        direction: 'inflow',
        targetAccountId: 'source-account',
      }),
      'source-account',
    )).toBe(false);
  });

  it('still matches target account for non-transfer transactions', () => {
    expect(transactionMatchesAccountFilter(
      transaction({
        direction: 'outflow',
        type: 'creditCardPayment',
      }),
      'target-account',
    )).toBe(true);
  });

  it('matches all transactions when the filter is all', () => {
    expect(transactionMatchesAccountFilter(transaction(), 'all')).toBe(true);
  });
});
