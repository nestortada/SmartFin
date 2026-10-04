import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import type { SQLitePrimitive } from '../../src/database/sqliteRows';

type NativeStatement = {
  all: (...values: SQLitePrimitive[]) => Record<string, SQLitePrimitive>[];
  run: (...values: SQLitePrimitive[]) => {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
};
type NativeDatabase = {
  prepare: (sql: string) => NativeStatement;
  exec: (sql: string) => void;
  close: () => void;
};
// Node 24 is already installed in the workspace. This test adapter never runs in RN.
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => NativeDatabase;
};

export function realSQLite() {
  const native = new DatabaseSync(':memory:');
  let failing: string | undefined;
  const query = (sql: string, values: SQLitePrimitive[] = []) => {
    if (failing && sql.includes(failing))
      throw new Error('Injected SQLite failure');
    const statement = native.prepare(sql);
    let rows: Record<string, SQLitePrimitive>[] = [];
    let changes = 0;
    if (/^\s*(SELECT|PRAGMA)/i.test(sql)) rows = statement.all(...values);
    else changes = Number(statement.run(...values).changes);
    return {
      rows: {
        length: rows.length,
        item: (index: number) => rows[index],
        raw: () => rows,
      },
      rowsAffected: changes,
      insertId: 0,
    };
  };
  const database = {
    executeSql: async (sql: string, values?: SQLitePrimitive[]) => [
      query(sql, values),
    ],
    transaction: async (operation: (tx: object) => void) => {
      native.exec('BEGIN;');
      const tx = {
        executeSql: (
          sql: string,
          values: SQLitePrimitive[] = [],
          callback?: (
            transaction: object,
            result: ReturnType<typeof query>,
          ) => void,
        ) => {
          const result = query(sql, values);
          callback?.(tx, result);
        },
      };
      try {
        operation(tx);
        native.exec('COMMIT;');
      } catch (error) {
        native.exec('ROLLBACK;');
        throw error;
      }
    },
    close: async () => native.close(),
  } as unknown as SmartFinSQLiteDatabase;
  return {
    database,
    native,
    query,
    failOn: (sql?: string) => {
      failing = sql;
    },
  };
}
