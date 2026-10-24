import type { SmartFinSQLiteDatabase } from './sqliteDatabase';
import type { Transaction as SQLiteCallbackTransaction } from 'react-native-sqlite-storage';
import { sqliteLifecycleReceipt } from './sqliteLifecycle';
import {
  assertDatabasePermit,
  withDatabaseMaintenance,
  type DatabasePermit,
} from './databaseCoordination';

type Connection = {
  raw: SmartFinSQLiteDatabase;
  generation: number;
  status: 'open' | 'quarantined' | 'closed';
  transactionOwner?: DatabasePermit;
  closeFailure?: { error: unknown };
};
type Handle = {
  connection: Connection;
  permit?: DatabasePermit;
  scope?: { active: boolean };
};
const handles = new WeakMap<SmartFinSQLiteDatabase, Handle>();
const managed = new WeakMap<SmartFinSQLiteDatabase, SmartFinSQLiteDatabase>();
let generation = 0;
async function closeConnection(connection: Connection) {
  if (connection.closeFailure) throw connection.closeFailure.error;
  if (connection.status === 'closed') return;
  connection.status = 'quarantined';
  try {
    await sqliteLifecycleReceipt(connection.raw.close(), 'closing');
    connection.status = 'closed';
  } catch (error) {
    connection.closeFailure = { error };
    throw error;
  }
}
const controlSQL = (sql: string) =>
  /^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(
    sql.replace(/^(?:\s|;|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*\s*/, ''),
  );

function validate(handle: Handle) {
  if (handle.connection.status !== 'open')
    throw new Error('SQLite connection is not usable');
  if (handle.permit) assertDatabasePermit(handle.permit);
  if (
    handle.scope &&
    (!handle.scope.active ||
      handle.connection.transactionOwner !== handle.permit)
  ) {
    throw new Error('SQLite transaction scope is revoked');
  }
}
function makeHandle(handle: Handle): SmartFinSQLiteDatabase {
  const access = <T>(operation: (owner: DatabasePermit) => Promise<T>) => {
    validate(handle);
    if (handle.permit) return operation(handle.permit);
    return withDatabaseMaintenance(async owner => {
      validate(handle);
      return operation(owner);
    });
  };
  const raw = handle.connection.raw;
  const database = new Proxy({} as SmartFinSQLiteDatabase, {
    get(_managedTarget, key) {
      if (key === 'then') return undefined;
      if (key === 'executeSql')
        return (sql: string, values?: unknown[]) =>
          access(async () => {
            if (controlSQL(sql))
              throw new Error('Transaction control requires the SQLite runner');
            if (handle.connection.transactionOwner && !handle.scope)
              throw new Error('Use the active transaction participant');
            return raw.executeSql(sql, values);
          });
      if (key === 'transaction' || key === 'readTransaction')
        return (
          operation: Parameters<SmartFinSQLiteDatabase['transaction']>[0],
        ) =>
          access(async owner => {
            if (handle.connection.transactionOwner)
              throw new Error('Nested SQLite transaction is forbidden');
            handle.connection.transactionOwner = owner;
            let active = true;
            try {
              let guardedTransaction: SQLiteCallbackTransaction;
              await raw[key](tx => {
                const guarded = new Proxy({} as SQLiteCallbackTransaction, {
                  get(_target, property) {
                    if (property === 'then') return undefined;
                    if (property !== 'executeSql')
                      throw new Error('Unsupported SQLite transaction method');
                    return (...args: Parameters<typeof tx.executeSql>) => {
                      if (!active)
                        throw new Error(
                          'SQLite callback transaction is finalized',
                        );
                      validate(handle);
                      const [sql, values, callback, errorCallback] = args;
                      if (controlSQL(sql))
                        throw new Error('Nested SQLite control is forbidden');
                      return tx.executeSql(
                        sql,
                        values,
                        callback
                          ? (_tx, result) => callback(guarded, result)
                          : undefined,
                        errorCallback
                          ? (_tx, error) => errorCallback(guarded, error)
                          : undefined,
                      );
                    };
                  },
                });
                guardedTransaction = guarded;
                operation(guarded);
              });
              return guardedTransaction!;
            } catch (error) {
              // The installed driver explicitly labels COMMIT/ROLLBACK failures.
              // Keep ordinary local rollback behavior; quarantine uncertain finalization.
              const message = String(
                typeof error === 'object' &&
                  error !== null &&
                  'message' in error
                  ? error.message
                  : error,
              );
              if (/trying to (commit|roll back)/i.test(message))
                handle.connection.status = 'quarantined';
              throw error;
            } finally {
              active = false;
              handle.connection.transactionOwner = undefined;
            }
          });
      if (key === 'close')
        return () =>
          access(async () => {
            if (handle.connection.transactionOwner)
              throw new Error('Cannot close an active transaction scope');
            await closeConnection(handle.connection);
          });
      // Never expose driver internals or an uncoordinated bound method.
      throw new Error(`Unsupported managed SQLite member: ${String(key)}`);
    },
  });
  handles.set(database, handle);
  return database;
}
export function manageSQLiteDatabase(
  raw: SmartFinSQLiteDatabase,
): SmartFinSQLiteDatabase {
  if (handles.has(raw)) return raw;
  const previous = managed.get(raw);
  if (previous) return previous;
  const result = makeHandle({
    connection: { raw, generation: ++generation, status: 'open' },
  });
  managed.set(raw, result);
  return result;
}
export function borrowSQLiteDatabase(
  database: SmartFinSQLiteDatabase,
  permit: DatabasePermit,
): SmartFinSQLiteDatabase {
  assertDatabasePermit(permit);
  const handle = handles.get(manageSQLiteDatabase(database))!;
  validate(handle);
  return makeHandle({
    connection: handle.connection,
    permit,
    scope: handle.scope,
  });
}
export function sqliteConnectionState(database: SmartFinSQLiteDatabase) {
  const handle = handles.get(database);
  return handle
    ? {
        generation: handle.connection.generation,
        status: handle.connection.status,
        owned: !!handle.connection.transactionOwner,
      }
    : undefined;
}
export function isSQLiteParticipant(database: SmartFinSQLiteDatabase): boolean {
  const handle = handles.get(database);
  if (!handle?.scope) return false;
  validate(handle);
  return true;
}
export function sqliteBorrowedPermit(
  database: SmartFinSQLiteDatabase,
): DatabasePermit | undefined {
  const handle = handles.get(database);
  if (handle?.permit) validate(handle);
  return handle?.permit;
}
export function createSQLiteParticipant(database: SmartFinSQLiteDatabase) {
  const handle = handles.get(database);
  if (!handle?.permit)
    throw new Error('SQLite participant requires a connection owner');
  validate(handle);
  if (handle.connection.transactionOwner)
    throw new Error('Nested SQLite transaction is forbidden');
  handle.connection.transactionOwner = handle.permit;
  const scope = { active: true };
  return {
    database: makeHandle({ ...handle, scope }),
    revoke: () => {
      scope.active = false;
      handle.connection.transactionOwner = undefined;
    },
  };
}
/** Internal runner/lifecycle entry points; never expose the raw connection. */
export async function executeSQLiteControl(
  database: SmartFinSQLiteDatabase,
  sql: string,
) {
  const handle = handles.get(database);
  if (!handle?.permit || !controlSQL(sql))
    throw new Error('SQLite control requires an owner');
  validate(handle);
  return handle.connection.raw.executeSql(sql);
}
export async function discardSQLiteConnection(
  database: SmartFinSQLiteDatabase,
  permit: DatabasePermit,
) {
  assertDatabasePermit(permit);
  const handle = handles.get(database);
  if (!handle) throw new Error('Unmanaged SQLite connection');
  if (handle.connection.transactionOwner)
    throw new Error('Cannot discard an active SQLite transaction');
  await closeConnection(handle.connection);
}
