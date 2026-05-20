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
  it('matches source and target accounts for account filters', () => {
    expect(transactionMatchesAccountFilter(transaction(), 'source-account')).toBe(true);
    expect(transactionMatchesAccountFilter(transaction(), 'target-account')).toBe(true);
    expect(transactionMatchesAccountFilter(transaction(), 'other-account')).toBe(false);
  });

  it('matches all transactions when the filter is all', () => {
    expect(transactionMatchesAccountFilter(transaction(), 'all')).toBe(true);
  });
});
