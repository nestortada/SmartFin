import {
  getDashboardSummaryFromDb,
  getEmptyDashboardSummary,
} from '../src/modules/dashboard/useCases/getDashboardSummary';
import { getBaselineDashboardSummaryFromDb } from './helpers/dashboardSummaryBaseline';
import {
  DASHBOARD_DATE,
  dashboardFixture,
  dashboardTransaction,
  insertSyntheticHistory,
} from './helpers/dashboardFixture';
import type { Transaction } from '../src/modules/transactions/types';
import type { SQLitePrimitive } from '../src/database/sqliteRows';

jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(),
}));

test('empty database retains the original empty dashboard', async () => {
  const fixture = await dashboardFixture([]);
  try {
    expect(
      await getDashboardSummaryFromDb(fixture.database, DASHBOARD_DATE),
    ).toEqual(getEmptyDashboardSummary(DASHBOARD_DATE));
    expect(
      await getDashboardSummaryFromDb(fixture.database, DASHBOARD_DATE),
    ).toEqual(
      await getBaselineDashboardSummaryFromDb(fixture.database, DASHBOARD_DATE),
    );
  } finally {
    await fixture.database.close();
  }
});

test('balances, wealth, monthly cashflow and all recent posted movement types retain their rules', async () => {
  const fixture = await dashboardFixture();
  const movements: Partial<Transaction>[] = [
    { id: 'income', type: 'income', direction: 'inflow', amount: 3000 },
    { id: 'debit-expense', amount: 200, paymentMethod: 'debit' },
    {
      id: 'credit-expense',
      amount: 500,
      accountId: 'card',
      paymentMethod: 'credit',
    },
    {
      id: 'wrong-income-direction',
      type: 'income',
      direction: 'outflow',
      amount: 9999,
    },
    {
      id: 'wrong-expense-direction',
      type: 'expense',
      direction: 'inflow',
      amount: 9999,
    },
    { id: 'neutral-expense', direction: 'neutral', amount: 9999 },
    {
      id: 'transfer-out',
      type: 'internalTransfer',
      direction: 'outflow',
      targetAccountId: 'savings',
    },
    {
      id: 'transfer-in',
      type: 'internalTransfer',
      direction: 'inflow',
      accountId: 'savings',
      targetAccountId: 'bank',
    },
    { id: 'card-payment', type: 'creditCardPayment', targetAccountId: 'card' },
    { id: 'loan-payment', type: 'loanPayment', targetAccountId: 'loan' },
    { id: 'refund', type: 'refund', direction: 'inflow' },
    { id: 'investment', type: 'investment' },
    { id: 'adjustment', type: 'manualAdjustment' },
    {
      id: 'pending-income',
      type: 'income',
      direction: 'inflow',
      status: 'pending',
      amount: 9999,
    },
    { id: 'cancelled-expense', status: 'cancelled', amount: 9999 },
    {
      id: 'future-this-month',
      type: 'income',
      direction: 'inflow',
      amount: 400,
      date: '2026-10-31T23:59:59Z',
    },
    { id: 'next-month', amount: 9999, date: '2026-11-01T00:00:00Z' },
    { id: 'first-day', amount: 50, date: '2026-10-01T00:00:00Z' },
    { id: 'previous-month', amount: 9999, date: '2026-09-30T23:59:59Z' },
    { id: 'recent-start', date: '2026-09-10T00:00:00Z' },
    { id: 'too-old', date: '2026-09-09T23:59:59Z' },
    { id: 'today-end', date: '2026-10-10T23:59:59-05:00' },
    { id: 'tomorrow', date: '2026-10-11T00:00:00+14:00' },
  ];
  for (const movement of movements)
    fixture.insertTransaction(dashboardTransaction(movement));
  try {
    const summary = await getDashboardSummaryFromDb(
      fixture.database,
      DASHBOARD_DATE,
    );
    expect(summary).toEqual(
      await getBaselineDashboardSummaryFromDb(fixture.database, DASHBOARD_DATE),
    );
    expect(summary).toMatchObject({
      availableBalance: 3100,
      totalDebt: 1000,
      netWorth: 7100,
      monthlyIncome: 3400,
      monthlyExpenses: 950,
      monthlySavings: 2450,
      recentTransactionCount: 17,
    });
  } finally {
    await fixture.database.close();
  }
});

test.each([
  new Date(2026, 0, 1, 12),
  new Date(2026, 11, 31, 12),
  new Date(2024, 1, 29, 12),
  new Date(2026, 2, 31, 12),
  new Date(2026, 10, 15, 12),
])(
  'month/year/leap-day boundaries match the original at %s',
  async currentDate => {
    const fixture = await dashboardFixture();
    const dates = [
      '2025-12-31',
      '2026-01-01',
      '2026-01-31',
      '2026-02-28',
      '2026-03-01',
      '2026-03-31',
      '2026-04-01',
      '2026-11-01',
      '2026-11-15',
      '2026-11-30',
      '2026-12-01',
      '2026-12-31',
      '2027-01-01',
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ];
    dates.forEach((date, index) =>
      fixture.insertTransaction(
        dashboardTransaction({ id: `date-${index}`, date }),
      ),
    );
    try {
      expect(
        await getDashboardSummaryFromDb(fixture.database, currentDate),
      ).toEqual(
        await getBaselineDashboardSummaryFromDb(fixture.database, currentDate),
      );
    } finally {
      await fixture.database.close();
    }
  },
);

test('fractional and large amounts keep the original descending summation order, including ties', async () => {
  const fixture = await dashboardFixture();
  const amounts = [0.1, 0.2, 0.3, 1e16, 1, 1, 1e16, 0.1];
  for (const type of ['income', 'expense'] as const) {
    amounts.forEach((amount, index) =>
      fixture.insertTransaction(
        dashboardTransaction({
          id: `${type}-${index}`,
          type,
          amount,
          direction: type === 'income' ? 'inflow' : 'outflow',
          date: index < 4 ? `2026-10-0${index + 1}` : '2026-10-05',
          createdAt: index < 4 ? `2026-10-0${index + 1}` : '2026-10-05',
        }),
      ),
    );
  }
  try {
    expect(
      await getDashboardSummaryFromDb(fixture.database, DASHBOARD_DATE),
    ).toEqual(
      await getBaselineDashboardSummaryFromDb(fixture.database, DASHBOARD_DATE),
    );
  } finally {
    await fixture.database.close();
  }
});

test.each([1000, 10000, 100000])(
  'identical synthetic history of %i movements matches every dashboard field',
  async size => {
    const fixture = await dashboardFixture();
    insertSyntheticHistory(fixture, size);
    try {
      expect(
        await getDashboardSummaryFromDb(fixture.database, DASHBOARD_DATE),
      ).toEqual(
        await getBaselineDashboardSummaryFromDb(
          fixture.database,
          DASHBOARD_DATE,
        ),
      );
    } finally {
      await fixture.database.close();
    }
  },
);

test.each([new Date(2026, 2, 31, 12), new Date(2026, 10, 15, 12)])(
  'recent local-day window keeps exact 30 x 24h arithmetic across DST at %s',
  async currentDate => {
    const fixture = await dashboardFixture();
    for (let offset = -1; offset <= 34; offset += 1) {
      const date = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate() - offset,
      );
      const prefix = `${date.getFullYear()}-${String(
        date.getMonth() + 1,
      ).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      fixture.insertTransaction(
        dashboardTransaction({
          id: `offset-${offset}`,
          date: `${prefix}T23:59:59+14:00`,
        }),
      );
    }
    try {
      expect(
        await getDashboardSummaryFromDb(fixture.database, currentDate),
      ).toEqual(
        await getBaselineDashboardSummaryFromDb(fixture.database, currentDate),
      );
    } finally {
      await fixture.database.close();
    }
  },
);

test('legacy overflowing day strings keep JavaScript date normalization in the recent count', async () => {
  const fixture = await dashboardFixture();
  for (const date of [
    '2026-02-29',
    '2026-02-30',
    '2026-02-31',
    '2026-03-01',
    '2026-03-32',
    'invalid-date',
  ]) {
    fixture.insertTransaction(dashboardTransaction({ id: date, date }));
  }
  try {
    const currentDate = new Date(2026, 2, 31, 12);
    const summary = await getDashboardSummaryFromDb(
      fixture.database,
      currentDate,
    );
    expect(summary).toEqual(
      await getBaselineDashboardSummaryFromDb(fixture.database, currentDate),
    );
    expect(summary.recentTransactionCount).toBe(4);
  } finally {
    await fixture.database.close();
  }
});

test('dashboard reads narrow indexed projections and daily counts without changing stored data', async () => {
  const fixture = await dashboardFixture();
  insertSyntheticHistory(fixture, 10000);
  try {
    const revisionBefore = fixture
      .query('SELECT revision FROM financial_data_revision;')
      .rows.item(0);
    const queries: { sql: string; values: SQLitePrimitive[]; rows: number }[] =
      [];
    const original = fixture.database.executeSql.bind(fixture.database);
    const spy = jest
      .spyOn(fixture.database, 'executeSql')
      .mockImplementation(async (sql, values = []) => {
        const result = await original(sql, values);
        queries.push({ sql, values, rows: result[0]?.rows.length ?? 0 });
        return result;
      });
    const summary = await getDashboardSummaryFromDb(
      fixture.database,
      DASHBOARD_DATE,
    );
    spy.mockRestore();
    expect(summary).toEqual(
      await getBaselineDashboardSummaryFromDb(fixture.database, DASHBOARD_DATE),
    );
    const historyQueries = queries.filter(query =>
      query.sql.includes('FROM transactions'),
    );
    expect(historyQueries).toHaveLength(2);
    expect(historyQueries[0]?.sql).toContain('SELECT amount, type, direction');
    expect(historyQueries[1]?.sql).toContain('COUNT(*)');
    expect(
      historyQueries.reduce((total, query) => total + query.rows, 0),
    ).toBeLessThan(100);
    for (const query of historyQueries) {
      const plan = fixture.native
        .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
        .all(...query.values);
      expect(
        plan.some(row =>
          String(row.detail).includes(
            'SEARCH transactions USING INDEX idx_transactions_date',
          ),
        ),
      ).toBe(true);
    }
    expect(
      fixture
        .query('SELECT revision FROM financial_data_revision;')
        .rows.item(0),
    ).toEqual(revisionBefore);
  } finally {
    await fixture.database.close();
  }
});
