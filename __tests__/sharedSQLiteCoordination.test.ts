import {
  financialIntegrityFixture,
  FINANCIAL_TEST_DATE,
} from './helpers/financialIntegrityFixture';
import {
  financialState,
  requireIntegralRollback,
} from './helpers/financialState';
import {
  runSharedSQLiteTransaction,
  runSQLiteTransaction,
  sqliteWithinExistingTransaction,
} from '../src/database/atomicSQLite';
import {
  borrowSQLiteDatabase,
  manageSQLiteDatabase,
  sqliteConnectionState,
} from '../src/database/managedSQLite';
import { withDatabaseMaintenance } from '../src/database/databaseCoordination';
import {
  openSmartFinDatabase,
  closeSmartFinDatabase,
  type SmartFinSQLiteDatabase,
} from '../src/database/sqliteDatabase';
import { openDatabase } from 'react-native-sqlite-storage';
import {
  financialAtomicityScenarios,
  runFinancialScenario,
} from './helpers/financialAtomicityScenarios';
import {
  getSubscriptionApi,
  runSubscriptionMaintenance,
} from '../src/modules/subscriptions/services/subscriptionRuntime';

jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(),
}));
beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'],
  });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

test.each(financialAtomicityScenarios)(
  'managed connection preserves phase 0 partial characterization: $name',
  async scenario => {
    const result = await runFinancialScenario(
      scenario,
      { phase: 'before', sql: scenario.faultSQL },
      { managed: true },
    );
    expect(result.error).toBeDefined();
    expect(result.after.metrics).toMatchObject(scenario.partial);
    expect(() =>
      requireIntegralRollback(result.before, result.after),
    ).toThrow();
  },
);

test.each(['before', 'after'] as const)(
  'BEGIN %s failure never runs the body or rolls back an unverified transaction',
  async phase => {
    const f = await financialIntegrityFixture();
    const database = manageSQLiteDatabase(f.database);
    f.resetTrace();
    f.injectFault({ phase, sql: 'BEGIN' });
    const body = jest.fn(async () => undefined);
    expect((await runSharedSQLiteTransaction(database, body)).status).toBe(
      'unknown',
    );
    expect(body).not.toHaveBeenCalled();
    expect(f.trace.some(entry => entry.sql === 'ROLLBACK;')).toBe(false);
    expect(sqliteConnectionState(database)?.status).toBe('closed');
  },
);

test('public and callback handles reject raw control SQL even behind comments', async () => {
  const f = await financialIntegrityFixture();
  try {
    const database = manageSQLiteDatabase(f.database);
    for (const sql of [
      'BEGIN;',
      '-- comment\n COMMIT;',
      '/* comment */ ; ROLLBACK;',
    ]) {
      await expect(database.executeSql(sql)).rejects.toThrow('runner');
    }
    await expect(
      database.transaction(tx => tx.executeSql('/* comment */ BEGIN;')),
    ).rejects.toThrow('forbidden');
  } finally {
    f.native.close();
  }
});

test('shared domain error restores parent, child references and trigger revision', async () => {
  const f = await financialIntegrityFixture();
  try {
    const expense = await f.save();
    f.query(
      `INSERT INTO transaction_splits(id,transaction_id,split_type,amount,currency,created_at,updated_at) VALUES ('child',?,'category',250000,'COP','2026-10-11','2026-10-11')`,
      [expense.transaction.id],
    );
    const before = await financialState(f);
    const result = await runSharedSQLiteTransaction(
      manageSQLiteDatabase(f.database),
      async scope => {
        await scope.executeSql('DELETE FROM transactions WHERE id=?', [
          expense.transaction.id,
        ]);
        throw new Error('domain');
      },
    );
    expect(result.status).toBe('rolledBack');
    requireIntegralRollback(before, await financialState(f));
  } finally {
    f.native.close();
  }
});

test.each(['before', 'after'] as const)(
  'shared runner %s a write really restores complete state and revision',
  async phase => {
    const f = await financialIntegrityFixture();
    try {
      const database = manageSQLiteDatabase(f.database);
      const before = await financialState(f);
      f.resetTrace();
      f.injectFault({ phase, write: 2 });
      const result = await runSharedSQLiteTransaction(database, async scope => {
        await runSQLiteTransaction(scope, function* () {
          yield {
            sql: 'UPDATE accounts SET balance_amount=900000 WHERE id=?',
            values: ['bank'],
          };
          yield {
            sql: 'UPDATE accounts SET balance_amount=100000 WHERE id=?',
            values: ['target'],
          };
        });
      });
      expect(result.status).toBe('rolledBack');
      requireIntegralRollback(before, await financialState(f));
      expect(
        f.trace.filter(entry => entry.sql.startsWith('BEGIN')),
      ).toHaveLength(1);
    } finally {
      f.native.close();
    }
  },
);

test('two owners and an external reader wait at a deterministic barrier and see only committed state', async () => {
  const f = await financialIntegrityFixture();
  try {
    const database = manageSQLiteDatabase(f.database);
    const barrier = f.pauseNextExecuteSql('UPDATE accounts', 'after');
    const events: string[] = [];
    const first = runSharedSQLiteTransaction(database, async scope => {
      events.push('first');
      await scope.executeSql(
        "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
      );
      expect(sqliteConnectionState(database)?.owned).toBe(true);
    });
    await barrier.reached;
    const reader = database
      .executeSql("SELECT balance_amount FROM accounts WHERE id='bank'")
      .then(([rows]) => {
        events.push('reader');
        return rows.rows.item(0).balance_amount as number;
      });
    const second = runSharedSQLiteTransaction(database, async scope => {
      events.push('second');
      await scope.executeSql(
        "UPDATE accounts SET balance_amount=balance_amount-100000 WHERE id='bank'",
      );
    });
    await Promise.resolve();
    expect(events).toEqual(['first']);
    barrier.release();
    expect((await first).status).toBe('confirmed');
    expect(await reader).toBe(900000);
    expect((await second).status).toBe('confirmed');
    expect(events).toEqual(['first', 'reader', 'second']);
    expect(
      f
        .query("SELECT balance_amount FROM accounts WHERE id='bank'")
        .rows.item(0)?.balance_amount,
    ).toBe(800000);
  } finally {
    f.native.close();
  }
});

test('participant cannot escape, nest a transaction or close its owner; repositories share exactly one commit', async () => {
  const f = await financialIntegrityFixture();
  try {
    const database = manageSQLiteDatabase(f.database);
    let escaped!: SmartFinSQLiteDatabase;
    f.resetTrace();
    expect(
      (
        await runSharedSQLiteTransaction(database, async scope => {
          escaped = sqliteWithinExistingTransaction(scope);
          await expect(
            runSharedSQLiteTransaction(scope, async () => undefined),
          ).rejects.toThrow('Nested');
          await expect(scope.transaction(() => undefined)).rejects.toThrow(
            'Nested',
          );
          await expect(scope.close()).rejects.toThrow('active transaction');
          await runSQLiteTransaction(scope, function* () {
            yield {
              sql: "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
            };
          });
        })
      ).status,
    ).toBe('confirmed');
    expect(f.trace.filter(entry => entry.sql.startsWith('BEGIN'))).toHaveLength(
      1,
    );
    expect(f.trace.filter(entry => entry.sql === 'COMMIT;')).toHaveLength(1);
    await expect(
      Promise.resolve().then(() => escaped.executeSql('SELECT 1')),
    ).rejects.toThrow();
    expect(() => sqliteWithinExistingTransaction(database)).toThrow();
  } finally {
    f.native.close();
  }
});

test('borrowed permit reuses queue for local transactions and runner without deadlock, then expires', async () => {
  const f = await financialIntegrityFixture();
  try {
    const database = manageSQLiteDatabase(f.database);
    let escaped!: SmartFinSQLiteDatabase;
    await withDatabaseMaintenance(async permit => {
      const borrowed = borrowSQLiteDatabase(database, permit);
      escaped = borrowed;
      await withDatabaseMaintenance(async reused => {
        expect(reused).toBe(permit);
        await borrowed.executeSql('SELECT 1');
      }, permit);
      await runSQLiteTransaction(borrowed, function* () {
        yield { sql: 'SELECT 1' };
      });
      expect(
        (
          await runSharedSQLiteTransaction(borrowed, async scope => {
            await scope.executeSql('SELECT 1');
          })
        ).status,
      ).toBe('confirmed');
    });
    await expect(
      Promise.resolve().then(() => escaped.executeSql('SELECT 1')),
    ).rejects.toThrow('expired');
  } finally {
    f.native.close();
  }
});

test.each(['before', 'after'] as const)(
  'COMMIT %s failure is unknown, runs body once and closes unusable handle',
  async phase => {
    const f = await financialIntegrityFixture();
    const database = manageSQLiteDatabase(f.database);
    const body = jest.fn(async (scope: SmartFinSQLiteDatabase) =>
      scope.executeSql(
        "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
      ),
    );
    f.injectFault({ phase, sql: 'COMMIT' });
    const result = await runSharedSQLiteTransaction(database, body);
    expect(result.status).toBe('unknown');
    expect(body).toHaveBeenCalledTimes(1);
    expect(sqliteConnectionState(database)?.status).toBe('closed');
    await expect(
      Promise.resolve().then(() => database.executeSql('SELECT 1')),
    ).rejects.toThrow('not usable');
    expect(f.trace.some(entry => entry.sql === 'ROLLBACK;')).toBe(false);
  },
);

test.each(['before', 'after'] as const)(
  'ROLLBACK %s response failure stays unknown even if SQL executed',
  async phase => {
    const f = await financialIntegrityFixture();
    const database = manageSQLiteDatabase(f.database);
    const original = new Error('Domain failure');
    f.injectFault({ phase, sql: 'ROLLBACK' });
    const result = await runSharedSQLiteTransaction(database, async scope => {
      await scope.executeSql(
        "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
      );
      throw original;
    });
    expect(result).toMatchObject({ status: 'unknown', error: original });
    if (result.status === 'unknown') expect(result.rollbackError).toBeDefined();
    expect(sqliteConnectionState(database)?.status).toBe('closed');
  },
);

test('failed recovery close quarantines the connection and pending readers fail before SQL', async () => {
  const f = await financialIntegrityFixture();
  try {
    const raw = {
      ...f.database,
      close: jest.fn(async () => {
        throw new Error('close lost');
      }),
    };
    const database = manageSQLiteDatabase(raw);
    f.injectFault({ phase: 'before', sql: 'ROLLBACK' });
    const result = await runSharedSQLiteTransaction(database, async () => {
      throw new Error('domain');
    });
    expect(result).toMatchObject({
      status: 'unknown',
      recoveryError: expect.any(Error),
    });
    expect(sqliteConnectionState(database)?.status).toBe('quarantined');
    await expect(
      Promise.resolve().then(() => database.executeSql('SELECT 1')),
    ).rejects.toThrow('not usable');
    expect(raw.close).toHaveBeenCalledTimes(1);
  } finally {
    f.native.close();
  }
});

test('close/backup lifecycle queues behind transaction; reopening creates a new generation and invalidates old handles', async () => {
  const first = await financialIntegrityFixture();
  const second = await financialIntegrityFixture();
  (openDatabase as jest.Mock)
    .mockImplementationOnce((_params, success) => {
      success(first.database);
      return Promise.resolve(first.database);
    })
    .mockImplementationOnce((_params, success) => {
      success(second.database);
      return Promise.resolve(second.database);
    });
  const database = await openSmartFinDatabase();
  const barrier = first.pauseNextExecuteSql('UPDATE accounts', 'after');
  const transaction = runSharedSQLiteTransaction(database, async scope =>
    scope.executeSql(
      "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
    ),
  );
  await barrier.reached;
  const events: string[] = [];
  const backup = withDatabaseMaintenance(async permit => {
    events.push('backup');
    const borrowed = borrowSQLiteDatabase(database, permit);
    await borrowed.executeSql('PRAGMA wal_checkpoint(FULL);');
    await closeSmartFinDatabase(permit);
    return openSmartFinDatabase(permit);
  });
  await Promise.resolve();
  expect(events).toEqual([]);
  barrier.release();
  expect((await transaction).status).toBe('confirmed');
  const reopened = await backup;
  expect(sqliteConnectionState(reopened)?.generation).not.toBe(
    sqliteConnectionState(database)?.generation,
  );
  await expect(
    Promise.resolve().then(() => database.executeSql('SELECT 1')),
  ).rejects.toThrow();
  await closeSmartFinDatabase();
});

test('public subscription facade and maintenance borrow ownership and reopen without deadlock or financial effects', async () => {
  const first = await financialIntegrityFixture();
  const second = await financialIntegrityFixture();
  (openDatabase as jest.Mock)
    .mockImplementationOnce((_params, success) => {
      success(first.database);
      return Promise.resolve(first.database);
    })
    .mockImplementationOnce((_params, success) => {
      success(second.database);
      return Promise.resolve(second.database);
    });
  const api = await getSubscriptionApi();
  const initial = await first.snapshot();
  await api.createSubscription({
    name: 'Synthetic',
    amount: 25000,
    accountId: 'bank',
    recurrence: { periodicity: 'monthly' },
    anchorDate: '2026-10-15',
    reminders: { enabled: false },
  });
  expect(await runSubscriptionMaintenance()).toBe(true);
  expect(await api.getSubscriptions()).toHaveLength(1);
  expect(await first.snapshot()).toEqual(initial);
  expect(await first.transactionRepository.getTransactions()).toEqual([]);
  await closeSmartFinDatabase();
  expect(await api.getSubscriptions()).toEqual([]);
  await closeSmartFinDatabase();
});

test('queued external read fails before native SQL when COMMIT response is lost', async () => {
  const f = await financialIntegrityFixture();
  const database = manageSQLiteDatabase(f.database);
  const barrier = f.pauseNextExecuteSql('COMMIT', 'before');
  f.resetTrace();
  f.injectFault({ phase: 'after', sql: 'COMMIT' });
  const transaction = runSharedSQLiteTransaction(database, async scope =>
    scope.executeSql(
      "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
    ),
  );
  await barrier.reached;
  const reader = database.executeSql('SELECT 12345;');
  const rejected = reader.then(
    () => {
      throw new Error('Reader accessed an uncertain connection');
    },
    (error: unknown) => error,
  );
  barrier.release();
  expect((await transaction).status).toBe('unknown');
  expect(String(await rejected)).toContain('not usable');
  expect(f.trace.some(entry => entry.sql === 'SELECT 12345;')).toBe(false);
});

test('callback success never exposes a raw transaction and escaped callback handle is finalized', async () => {
  const f = await financialIntegrityFixture();
  try {
    const database = manageSQLiteDatabase(f.database);
    let escaped:
      | Parameters<Parameters<SmartFinSQLiteDatabase['transaction']>[0]>[0]
      | undefined;
    await database.transaction(tx => {
      tx.executeSql('SELECT 1', [], successTx => {
        expect(successTx).toBe(tx);
        escaped = successTx;
        expect(Object.getOwnPropertyDescriptor(tx, 'db')).toBeUndefined();
      });
    });
    expect(() => escaped?.executeSql('SELECT 2')).toThrow('finalized');
  } finally {
    f.native.close();
  }
});
