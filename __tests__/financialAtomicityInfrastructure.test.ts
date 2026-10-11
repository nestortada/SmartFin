import {
  financialIntegrityFixture,
  FINANCIAL_TEST_DATE,
} from './helpers/financialIntegrityFixture';
import {
  financialState,
  financialStateDifferences,
  requireIntegralRollback,
} from './helpers/financialState';
import { runSQLiteTransaction } from '../src/database/atomicSQLite';
import { InjectedSQLiteFailure } from './helpers/realSQLite';
import { deleteManualTransactionSafely } from './helpers/phase0ManualTransactions';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'],
  });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

test.each([
  { sql: 'BEGIN;', phase: 'before' as const, committed: false },
  { sql: 'BEGIN;', phase: 'after' as const, committed: false },
  { sql: 'COMMIT;', phase: 'before' as const, committed: false },
  { sql: 'COMMIT;', phase: 'after' as const, committed: true },
])(
  'local boundary $phase $sql records actual persisted outcome (committed=$committed)',
  async fault => {
    const f = await financialIntegrityFixture();
    try {
      const before = await financialState(f);
      f.resetTrace();
      f.injectFault(fault);
      await expect(
        runSQLiteTransaction(f.database, function* () {
          yield {
            sql: 'UPDATE accounts SET balance_amount=900000 WHERE id=?',
            values: ['bank'],
          };
        }),
      ).rejects.toBeInstanceOf(InjectedSQLiteFailure);
      const trace = [...f.trace];
      const after = await financialState(f);
      if (fault.committed) {
        expect(after.metrics.balances.bank).toBe(900000);
        expect(trace.some(entry => entry.sql === 'ROLLBACK;')).toBe(false);
        expect(() => requireIntegralRollback(before, after)).toThrow();
      } else {
        requireIntegralRollback(before, after);
      }
      // The adapter connection remains usable after all four boundary cases.
      await f.database.executeSql('SELECT 1;');
    } finally {
      f.native.close();
    }
  },
);

test.each(['before', 'after'] as const)(
  'real local transaction rolls back rows AND trigger revision with a %s fault',
  async phase => {
    const f = await financialIntegrityFixture();
    try {
      const before = await financialState(f);
      f.resetTrace();
      f.injectFault({ phase, write: 2 });
      await expect(
        runSQLiteTransaction(f.database, function* () {
          yield {
            sql: 'UPDATE accounts SET balance_amount = 800000 WHERE id = ?;',
            values: ['bank'],
          };
          yield {
            sql: 'UPDATE accounts SET balance_amount = 200000 WHERE id = ?;',
            values: ['target'],
          };
        }),
      ).rejects.toBeInstanceOf(InjectedSQLiteFailure);
      expect(
        f.trace.some(
          entry =>
            entry.sql.includes('smartfin_transaction_abort_missing_table') &&
            entry.outcome === 'sql-error',
        ),
      ).toBe(true);
      expect(f.trace.at(-1)?.sql).toBe('ROLLBACK;');
      requireIntegralRollback(before, await financialState(f));
    } finally {
      f.native.close();
    }
  },
);

test('after an autocommit write, lost response leaves the REAL row and revision committed; matching occurrence is one-shot', async () => {
  const f = await financialIntegrityFixture();
  try {
    const before = await financialState(f);
    f.resetTrace();
    f.injectFault({ phase: 'after', sql: 'UPDATE accounts', occurrence: 2 });
    f.query('UPDATE accounts SET balance_amount = 1 WHERE id = ?', ['target']);
    expect(() =>
      f.query('UPDATE accounts SET balance_amount = 900000 WHERE id = ?', [
        'bank',
      ]),
    ).toThrow(InjectedSQLiteFailure);
    f.query('UPDATE accounts SET balance_amount = 2 WHERE id = ?', ['target']);
    expect(
      f.trace.filter(entry => entry.outcome === 'injected-after'),
    ).toHaveLength(1);
    const after = await financialState(f);
    expect(after.metrics.balances).toMatchObject({ bank: 900000, target: 2 });
    expect(financialStateDifferences(before, after)).toContain(
      'tables.financial_data_revision',
    );
    expect(() => requireIntegralRollback(before, after)).toThrow();
  } finally {
    f.native.close();
  }
});

test.each(['before', 'after'] as const)(
  'deterministic promise barrier %s SQL allows controlled interleaving without timers',
  async phase => {
    const f = await financialIntegrityFixture();
    try {
      const barrier = f.pauseNextExecuteSql('UPDATE accounts', phase);
      const pending = f.database.executeSql(
        'UPDATE accounts SET balance_amount = 900000 WHERE id = ?',
        ['bank'],
      );
      await barrier.reached;
      try {
        expect(
          f
            .query("SELECT balance_amount FROM accounts WHERE id='bank'")
            .rows.item(0)?.balance_amount,
        ).toBe(phase === 'before' ? 1000000 : 900000);
      } finally {
        barrier.release();
      }
      await pending;
      expect(
        f
          .query("SELECT balance_amount FROM accounts WHERE id='bank'")
          .rows.item(0)?.balance_amount,
      ).toBe(900000);
    } finally {
      f.native.close();
    }
  },
);

test('real SQLite rejects FK, primary key, dedupe, occurrence uniqueness and CHECK violations without changing the snapshot', async () => {
  const f = await financialIntegrityFixture();
  try {
    const expense = await f.save({ dedupeKey: 'synthetic-dedupe' });
    f.query(`INSERT INTO recurring_subscriptions
      (id,name,amount,currency,periodicity,status,created_at,updated_at)
      VALUES ('sub','Synthetic',250000,'COP','monthly','active','2026-10-11','2026-10-11')`);
    const insertOccurrence = (
      id: string,
      date: string,
      amount: number,
      status: string,
      transactionId: string | null,
    ) =>
      f.query(
        `INSERT INTO subscription_occurrences
      (id,subscription_id,expected_date,expected_amount,currency,status,transaction_id,created_at,updated_at)
      VALUES (?,'sub',?,?,'COP',?,?,'2026-10-11','2026-10-11')`,
        [id, date, amount, status, transactionId],
      );
    insertOccurrence(
      'occ',
      '2026-10-11',
      250000,
      'paid',
      expense.transaction.id,
    );
    const before = await financialState(f);
    const failures = [
      () =>
        f.query('UPDATE transactions SET account_id=? WHERE id=?', [
          'missing',
          expense.transaction.id,
        ]),
      () =>
        f.query('UPDATE transactions SET target_account_id=? WHERE id=?', [
          'missing',
          expense.transaction.id,
        ]),
      () =>
        f.query('INSERT INTO accounts SELECT * FROM accounts WHERE id=?', [
          'bank',
        ]),
      () =>
        f.transactionRepository.saveTransactions([
          { ...expense.transaction, id: 'duplicate-dedupe' },
        ]),
      () =>
        insertOccurrence('duplicate-date', '2026-10-11', 1, 'pending', null),
      () =>
        insertOccurrence(
          'duplicate-link',
          '2026-11-11',
          1,
          'paid',
          expense.transaction.id,
        ),
      () => insertOccurrence('bad-amount', '2026-11-11', 0, 'pending', null),
      () => insertOccurrence('bad-status', '2026-11-11', 1, 'invalid', null),
    ];
    for (const operation of failures) {
      await expect(
        Promise.resolve().then<unknown>(() => operation()),
      ).rejects.toThrow();
      requireIntegralRollback(before, await financialState(f));
    }
  } finally {
    f.native.close();
  }
});

test('complete snapshots retain children, audit fields and revision; domain failure really rolls back a prior write', async () => {
  const f = await financialIntegrityFixture();
  try {
    const expense = await f.save();
    f.query(
      `INSERT INTO transaction_splits
      (id,transaction_id,split_type,amount,currency,created_at,updated_at)
      VALUES ('child',?,'category',250000,'COP','2026-10-11','2026-10-11')`,
      [expense.transaction.id],
    );
    const before = await financialState(f);
    expect(before.tables.transaction_splits).toHaveLength(1);
    expect(before.tables.accounts?.[0]?.created_at).toBeDefined();
    await expect(
      runSQLiteTransaction(f.database, function* () {
        yield {
          sql: 'DELETE FROM transactions WHERE id=?',
          values: [expense.transaction.id],
        };
        throw new Error('Synthetic domain failure');
      }),
    ).rejects.toThrow('Synthetic domain failure');
    requireIntegralRollback(before, await financialState(f));
  } finally {
    f.native.close();
  }
});

test.each(['before', 'after'] as const)(
  'deletion failure %s the ORIGINAL expense DELETE restores its child locally but leaves the balance reversal committed',
  async phase => {
    const f = await financialIntegrityFixture();
    try {
      const expense = await f.save();
      f.query(
        `INSERT INTO transaction_splits
      (id,transaction_id,split_type,amount,currency,created_at,updated_at)
      VALUES ('child',?,'category',250000,'COP','2026-10-11','2026-10-11')`,
        [expense.transaction.id],
      );
      const before = await financialState(f);
      f.resetTrace();
      // First two DELETEs target absent companions; third targets the original expense.
      f.injectFault({ phase, sql: 'DELETE FROM transactions', occurrence: 3 });
      await expect(
        deleteManualTransactionSafely({
          ...f,
          accounts: await f.accountRepository.getAccounts(),
          transaction: expense.transaction,
        }),
      ).rejects.toBeInstanceOf(InjectedSQLiteFailure);
      const failed = f.trace.find(
        entry => entry.outcome === `injected-${phase}`,
      );
      expect(failed?.values).toEqual([expense.transaction.id]);
      const after = await financialState(f);
      expect(after.tables.transaction_splits).toEqual(
        before.tables.transaction_splits,
      );
      expect(after.tables.transactions).toEqual(before.tables.transactions);
      expect(after.metrics).toMatchObject({
        balances: { bank: 1000000 },
        expense: 250000,
      });
      expect(() => requireIntegralRollback(before, after)).toThrow();
    } finally {
      f.native.close();
    }
  },
);
