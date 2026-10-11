import type { SmartFinSQLiteDatabase } from './sqliteDatabase';
import {
  resultSetToRows,
  type SQLitePrimitive,
  type SQLiteRow,
} from './sqliteRows';

export type SQLQuery = { sql: string; values?: SQLitePrimitive[] };
export type SQLiteProgram<T> = Generator<SQLQuery, T, SQLiteRow[]>;

const existingTransactionScopes = new WeakSet<SmartFinSQLiteDatabase>();

/** Internal adapter for commands already enclosed by BEGIN/COMMIT on this connection. */
export function sqliteWithinExistingTransaction(
  database: SmartFinSQLiteDatabase,
): SmartFinSQLiteDatabase {
  const scoped = new Proxy(database, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  existingTransactionScopes.add(scoped);
  return scoped;
}

/** Advance synchronously from SQLite callbacks: never await inside a transaction. */
export async function runSQLiteTransaction<T>(
  database: SmartFinSQLiteDatabase,
  program: () => SQLiteProgram<T>,
): Promise<T> {
  if (existingTransactionScopes.has(database)) {
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
