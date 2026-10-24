jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
jest.mock('../src/modules/subscriptions/services/androidSubscriptionReminderService', () => ({
  createSubscriptionReminderService: () => ({ cancelAll: async () => { mockAlarms.clear(); } }),
}));
import { financialIntegrityFixture } from './helpers/financialIntegrityFixture';
import { financialState } from './helpers/financialState';
import { createSqliteFinancialDataRepository } from './helpers/phase5cPreviousFinancialDataRepository';
import { deleteFinancialData } from './helpers/phase5cPreviousDeleteFinancialData';

const mockAlarms = new Set<string>();
test('5C baseline: original cancellation precedes confirmed SQLite rollback (synthetic OS double)', async () => {
  const f = await financialIntegrityFixture();
  try {
    await f.save();
    mockAlarms.add('synthetic-reminder');
    const before = await financialState(f);
    f.failOn('DELETE FROM accounts;');
    await expect(deleteFinancialData(createSqliteFinancialDataRepository(f.database))).rejects.toThrow();
    expect(await financialState(f)).toEqual(before);
    expect(mockAlarms.size).toBe(0);
  } finally { f.native.close(); }
});

