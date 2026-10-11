import type { SmartFinSQLiteDatabase } from './sqliteDatabase';
import {
  withDatabaseMaintenance,
  type DatabasePermit,
} from './databaseCoordination';
import {
  borrowSQLiteDatabase,
  createSQLiteParticipant,
  discardSQLiteConnection,
  executeSQLiteControl,
  isSQLiteParticipant,
  manageSQLiteDatabase,
  sqliteBorrowedPermit,
} from './managedSQLite';
import {
  resultSetToRows,
  type SQLitePrimitive,
  type SQLiteRow,
} from './sqliteRows';

export type SQLQuery = { sql: string; values?: SQLitePrimitive[] };
export type SQLiteProgram<T> = Generator<SQLQuery, T, SQLiteRow[]>;

/** Internal adapter for commands already enclosed by BEGIN/COMMIT on this connection. */
export function sqliteWithinExistingTransaction(
  database: SmartFinSQLiteDatabase,
): SmartFinSQLiteDatabase {
  if (!isSQLiteParticipant(database))
    throw new Error('No active owned SQLite transaction');
  return database;
}

export type SQLiteCommandResult<T> =
  | { status: 'confirmed'; value: T }
  | { status: 'rolledBack'; error: unknown }
  | {
      status: 'unknown';
      error: unknown;
      rollbackError?: unknown;
      recoveryError?: unknown;
    };
export class SQLiteCommandFailure extends Error {
  constructor(
    readonly result: Exclude<
      SQLiteCommandResult<never>,
      { status: 'confirmed' }
    >,
  ) {
    super(
      result.status === 'unknown'
        ? 'No se pudo confirmar el resultado de la operación. No la repitas antes de verificar su estado.'
        : 'La operación se revirtió.',
    );
  }
}
/** One owner, one native BEGIN/COMMIT. No financial retry or compensation. */
export async function runSharedSQLiteTransaction<T>(
  database: SmartFinSQLiteDatabase,
  operation: (participant: SmartFinSQLiteDatabase) => Promise<T>,
  permit?: DatabasePermit,
): Promise<SQLiteCommandResult<T>> {
  if (isSQLiteParticipant(database))
    throw new Error('Nested SQLite runner is forbidden');
  const managedDatabase = manageSQLiteDatabase(database);
  return withDatabaseMaintenance(async owner => {
    const owned = borrowSQLiteDatabase(managedDatabase, owner);
    let participant: ReturnType<typeof createSQLiteParticipant> | undefined;
    const unknown = async (
      error: unknown,
      rollbackError?: unknown,
    ): Promise<SQLiteCommandResult<T>> => {
      participant?.revoke();
      try {
        await discardSQLiteConnection(managedDatabase, owner);
        return { status: 'unknown', error, rollbackError };
      } catch (recoveryError) {
        return { status: 'unknown', error, rollbackError, recoveryError };
      }
    };
    participant = createSQLiteParticipant(owned);
    try {
      await executeSQLiteControl(owned, 'BEGIN IMMEDIATE;');
    } catch (error) {
      return unknown(error);
    } // BEGIN ownership uncertain: never rollback someone else's transaction
    let value: T;
    try {
      value = await operation(participant.database);
    } catch (error) {
      participant.revoke();
      try {
        await executeSQLiteControl(owned, 'ROLLBACK;');
        return { status: 'rolledBack', error };
      } catch (rollbackError) {
        return unknown(error, rollbackError);
      }
    }
    participant.revoke();
    try {
      await executeSQLiteControl(owned, 'COMMIT;');
    } catch (error) {
      return unknown(error);
    }
    return { status: 'confirmed', value };
  }, permit ?? sqliteBorrowedPermit(database));
}

/** Advance synchronously from SQLite callbacks: never await inside a transaction. */
export async function runSQLiteTransaction<T>(
  database: SmartFinSQLiteDatabase,
  program: () => SQLiteProgram<T>,
): Promise<T> {
  if (isSQLiteParticipant(database)) {
    const iterator = program();
    let rows: SQLiteRow[] = [];
    for (;;) {
      const step = iterator.next(rows);
      if (step.done) return step.value;
      const [result] = await database.executeSql(
        step.value.sql,
        step.value.values ?? [],
      );
      rows = resultSetToRows(result);
    }
  }
  let value: T;
  let domainError: unknown;
  await database
    .transaction(transaction => {
      const iterator = program();
      const advance = (rows: SQLiteRow[]) => {
        try {
          const step = iterator.next(rows);
          if (step.done) {
            value = step.value;
            return;
          }
          transaction.executeSql(
            step.value.sql,
            step.value.values ?? [],
            (_tx, result) => {
              advance(resultSetToRows(result));
            },
          );
        } catch (error) {
          domainError ??= error;
          // A failed statement forces the driver's rollback, including prior writes.
          transaction.executeSql(
            'SELECT * FROM smartfin_transaction_abort_missing_table;',
          );
        }
      };
      advance([]);
    })
    .catch(error => {
      throw domainError ?? error;
    });
  return value!;
}
