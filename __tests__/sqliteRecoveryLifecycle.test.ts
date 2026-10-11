import {
  openDatabase,
  type DatabaseParams,
  type ResultSet,
} from 'react-native-sqlite-storage';
import {
  openConfirmedSQLiteConnection,
  SQLITE_LIFECYCLE_TIMEOUT_MS,
} from '../src/database/sqliteLifecycle';
import {
  discardSQLiteConnection,
  manageSQLiteDatabase,
  sqliteConnectionState,
} from '../src/database/managedSQLite';
import { withDatabaseMaintenance } from '../src/database/databaseCoordination';
import { runSharedSQLiteTransaction } from '../src/database/atomicSQLite';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import { financialIntegrityFixture } from './helpers/financialIntegrityFixture';

jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(),
}));
type OpenSuccess = (database: SmartFinSQLiteDatabase) => void;
type OpenFailure = (error: unknown) => void;
const openMock = openDatabase as jest.Mock;
const params: DatabaseParams = { name: 'synthetic.db', location: 'default' };
afterEach(() => {
  jest.useRealTimers();
  openMock.mockReset();
});

test.each([
  ['foreign keys disabled', 'PRAGMA foreign_keys;', { foreign_keys: 0 }],
  [
    'dangling reference',
    'PRAGMA foreign_key_check;',
    { table: 'transactions' },
  ],
  [
    'damaged integrity',
    'PRAGMA integrity_check;',
    { integrity_check: 'damaged' },
  ],
  [
    'invalid revision',
    'SELECT revision FROM financial_data_revision WHERE id=1;',
    { revision: 1.5 },
  ],
] as const)(
  '%s refuses application readiness even with successful SQL callbacks',
  async (_name, statement, invalid) => {
    jest.resetModules();
    const lifecycle =
      require('../src/database/sqliteDatabase') as typeof import('../src/database/sqliteDatabase');
    const driver = require('react-native-sqlite-storage') as {
      openDatabase: jest.Mock;
    };
    const f = await financialIntegrityFixture();
    const executeSql = async (
      sql: string,
      values?: unknown[],
    ): Promise<[ResultSet]> => {
      const result = await f.database.executeSql(sql, values);
      return sql === statement
        ? [
            {
              ...result[0],
              rows: { length: 1, item: () => invalid, raw: () => [invalid] },
            },
          ]
        : result;
    };
    driver.openDatabase.mockImplementation(
      (_params: DatabaseParams, success: OpenSuccess) => {
        success({ ...f.database, executeSql });
        return Promise.resolve(f.database);
      },
    );
    await expect(lifecycle.openSmartFinDatabase()).rejects.toThrow(
      'state/integrity check failed',
    );
    await expect(lifecycle.openSmartFinDatabase()).rejects.toThrow(
      'state/integrity check failed',
    );
    expect(driver.openDatabase).toHaveBeenCalledTimes(1);
  },
);

test('provisional driver Promise cannot deliver a usable connection before native receipt', async () => {
  const f = await financialIntegrityFixture();
  let receipt!: OpenSuccess;
  openMock.mockImplementation(
    (_params: DatabaseParams, success: OpenSuccess) => {
      receipt = success;
      return Promise.resolve(f.database);
    },
  );
  let opened = false;
  const operation = openConfirmedSQLiteConnection(params).then(database => {
    opened = true;
    return database;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(opened).toBe(false);
  receipt(f.database);
  expect(await operation).toBe(f.database);
  f.native.close();
});

test('native open error wins over the provisional object', async () => {
  const f = await financialIntegrityFixture();
  const failure = new Error('Native SQLiteDatabaseLockedException');
  openMock.mockImplementation(
    (_params: DatabaseParams, _success: OpenSuccess, error: OpenFailure) => {
      error(failure);
      return Promise.resolve(f.database);
    },
  );
  await expect(openConfirmedSQLiteConnection(params)).rejects.toBe(failure);
  f.native.close();
});

test('missing open callback times out as failure and late success cannot resurrect it', async () => {
  const f = await financialIntegrityFixture();
  jest.useFakeTimers();
  let receipt!: OpenSuccess;
  openMock.mockImplementation(
    (_params: DatabaseParams, success: OpenSuccess) => {
      receipt = success;
      return Promise.resolve(f.database);
    },
  );
  const result = openConfirmedSQLiteConnection(params).catch(
    (error: unknown) => error,
  );
  await jest.advanceTimersByTimeAsync(SQLITE_LIFECYCLE_TIMEOUT_MS);
  expect(String(await result)).toContain('opening receipt timed out');
  receipt(f.database);
  expect(String(await result)).toContain('opening receipt timed out');
  f.native.close();
});

test.each(['before', 'after'] as const)(
  'failed close %s native action keeps unknown, revoked scope and sticky quarantine',
  async phase => {
    const f = await financialIntegrityFixture();
    const close = jest.fn(async () => {
      if (phase === 'after') await f.database.close();
      throw new Error('Lost close receipt');
    });
    const database = manageSQLiteDatabase({ ...f.database, close });
    let escaped!: SmartFinSQLiteDatabase;
    let bodies = 0;
    f.injectFault({ sql: 'ROLLBACK', phase: 'before' });
    const result = await runSharedSQLiteTransaction(database, async scope => {
      escaped = scope;
      bodies++;
      await scope.executeSql(
        "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
      );
      throw new Error('domain');
    });
    expect(result).toMatchObject({
      status: 'unknown',
      recoveryError: expect.any(Error),
    });
    expect(bodies).toBe(1);
    expect(sqliteConnectionState(database)?.status).toBe('quarantined');
    const before = f.trace.length;
    await expect(
      Promise.resolve().then(() => escaped.executeSql('SELECT 1')),
    ).rejects.toThrow();
    await expect(
      Promise.resolve().then(() => database.executeSql('SELECT 1')),
    ).rejects.toThrow('not usable');
    await expect(
      withDatabaseMaintenance(owner =>
        discardSQLiteConnection(database, owner),
      ),
    ).rejects.toThrow('Lost close receipt');
    expect(f.trace).toHaveLength(before);
    expect(close).toHaveBeenCalledTimes(1);
    if (phase === 'before') f.native.close();
  },
);

test('missing close callback and eventual callback never release quarantine', async () => {
  const f = await financialIntegrityFixture();
  jest.useFakeTimers();
  let complete!: () => void;
  const close = jest.fn(
    () =>
      new Promise<void>(resolve => {
        complete = resolve;
      }),
  );
  const database = manageSQLiteDatabase({ ...f.database, close });
  const result = database.close().catch((error: unknown) => error);
  await jest.advanceTimersByTimeAsync(SQLITE_LIFECYCLE_TIMEOUT_MS);
  expect(String(await result)).toContain('closing receipt timed out');
  complete();
  await Promise.resolve();
  expect(sqliteConnectionState(database)?.status).toBe('quarantined');
  await expect(
    withDatabaseMaintenance(owner => discardSQLiteConnection(database, owner)),
  ).rejects.toThrow('closing receipt timed out');
  expect(close).toHaveBeenCalledTimes(1);
  f.native.close();
});

test('missing state verification receipt blocks reopening and late receipt cannot start further SQL', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  const lifecycle =
    require('../src/database/sqliteDatabase') as typeof import('../src/database/sqliteDatabase');
  const driver = require('react-native-sqlite-storage') as {
    openDatabase: jest.Mock;
  };
  const f = await financialIntegrityFixture();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => {
    release = resolve;
  });
  const executeSql = jest.fn(async (sql: string, values?: unknown[]) => {
    const result = await f.database.executeSql(sql, values);
    await barrier;
    return result;
  });
  driver.openDatabase.mockImplementation(
    (_params: DatabaseParams, success: OpenSuccess) => {
      success({ ...f.database, executeSql });
      return Promise.resolve(f.database);
    },
  );
  const failure = lifecycle
    .openSmartFinDatabase()
    .catch((error: unknown) => error);
  await jest.advanceTimersByTimeAsync(SQLITE_LIFECYCLE_TIMEOUT_MS);
  expect(String(await failure)).toContain(
    'state verification receipt timed out',
  );
  release();
  await Promise.resolve();
  await expect(lifecycle.openSmartFinDatabase()).rejects.toThrow(
    'state verification receipt timed out',
  );
  expect(driver.openDatabase).toHaveBeenCalledTimes(1);
  expect(executeSql).toHaveBeenCalledTimes(1);
});

test.each([
  'opening',
  'foreign_keys',
  'foreign_key_check',
  'integrity_check',
  'revision',
])(
  'failed %s validation permanently blocks automatic application reopen',
  async failure => {
    // Load lifecycle state afresh; no production filename is opened by this mock.
    jest.resetModules();
    const lifecycle =
      require('../src/database/sqliteDatabase') as typeof import('../src/database/sqliteDatabase');
    const driver = require('react-native-sqlite-storage') as {
      openDatabase: jest.Mock;
    };
    const f = await financialIntegrityFixture();
    const executeSql = jest.fn(async (sql: string, values?: unknown[]) => {
      if (
        (failure === 'foreign_keys' && sql === 'PRAGMA foreign_keys;') ||
        (failure === 'foreign_key_check' &&
          sql === 'PRAGMA foreign_key_check;') ||
        (failure === 'integrity_check' && sql === 'PRAGMA integrity_check;') ||
        (failure === 'revision' &&
          sql === 'SELECT revision FROM financial_data_revision WHERE id=1;')
      )
        throw new Error(`Invalid ${failure}`);
      return f.database.executeSql(sql, values);
    });
    driver.openDatabase.mockImplementation(
      (_params: DatabaseParams, success: OpenSuccess, error: OpenFailure) => {
        if (failure === 'opening') error(new Error('Native opening failed'));
        else success({ ...f.database, executeSql });
        return Promise.resolve(f.database);
      },
    );
    await expect(lifecycle.openSmartFinDatabase()).rejects.toThrow();
    const before = executeSql.mock.calls.length;
    await expect(lifecycle.openSmartFinDatabase()).rejects.toThrow();
    await expect(lifecycle.closeSmartFinDatabase()).rejects.toThrow();
    expect(driver.openDatabase).toHaveBeenCalledTimes(1);
    expect(executeSql).toHaveBeenCalledTimes(before);
    if (failure === 'opening') f.native.close();
  },
);
