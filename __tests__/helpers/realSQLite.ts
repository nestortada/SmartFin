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
  function: (
    name: string,
    callback: (format: string, source: string) => string,
  ) => void;
};
export type SQLiteFault = {
  phase: 'before' | 'after';
  /** 1-based write position since resetTrace; includes writes affecting zero rows. */
  write?: number;
  sql?: string;
  occurrence?: number;
};
export type SQLiteTraceEntry = {
  order: number;
  sql: string;
  values: SQLitePrimitive[];
  write?: number;
  executed: boolean;
  outcome: 'ok' | 'sql-error' | 'injected-before' | 'injected-after';
};
export class InjectedSQLiteFailure extends Error {
  constructor(
    readonly entry: SQLiteTraceEntry,
    readonly phase: SQLiteFault['phase'],
  ) {
    super(
      `Injected SQLite failure ${phase} statement ${entry.order}, write ${
        entry.write ?? '-'
      }`,
    );
  }
}
// Node 24 is already installed in the workspace. This test adapter never runs in RN.
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => NativeDatabase;
};

export function realSQLite(options: { fixedSqlDate?: Date } = {}) {
  const native = new DatabaseSync(':memory:');
  if (options.fixedSqlDate) {
    const timestamp = options.fixedSqlDate.toISOString();
    // Only the audit clock used by current DDL/migrations. Unexpected usage fails loudly.
    native.function('strftime', (format, source) => {
      if (format !== '%Y-%m-%dT%H:%M:%fZ' || source !== 'now') {
        throw new Error('Unsupported fixed SQLite clock expression');
      }
      return timestamp;
    });
  }
  let failing: string | undefined;
  let fault: SQLiteFault | undefined;
  let matches = 0;
  let writes = 0;
  const trace: SQLiteTraceEntry[] = [];
  let barrier:
    | {
        sql: string;
        phase: SQLiteFault['phase'];
        arrived: () => void;
        released: Promise<void>;
      }
    | undefined;
  const waitAtBarrier = async (sql: string, phase: SQLiteFault['phase']) => {
    if (barrier?.sql && sql.includes(barrier.sql) && barrier.phase === phase) {
      const current = barrier;
      barrier = undefined;
      current.arrived();
      await current.released;
    }
  };
  const run = <T>(
    sql: string,
    values: SQLitePrimitive[],
    execute: () => T,
  ): T => {
    const isWrite = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);
    const entry: SQLiteTraceEntry = {
      order: trace.length + 1,
      sql,
      values: [...values],
      ...(isWrite ? { write: ++writes } : {}),
      executed: false,
      outcome: 'ok',
    };
    trace.push(entry);
    const selected =
      fault &&
      (fault.write === undefined || entry.write === fault.write) &&
      (fault.sql === undefined || sql.includes(fault.sql));
    const hit = selected && ++matches === (fault?.occurrence ?? 1);
    const inject = (phase: SQLiteFault['phase']) => {
      if (hit && fault?.phase === phase) {
        fault = undefined; // one-shot: rollback and inspection remain possible
        entry.outcome =
          phase === 'before' ? 'injected-before' : 'injected-after';
        throw new InjectedSQLiteFailure(entry, phase);
      }
    };
    inject('before');
    let result: T;
    try {
      if (failing && sql.includes(failing))
        throw new Error('Injected SQLite failure');
      result = execute();
      entry.executed = true;
    } catch (error) {
      entry.outcome = 'sql-error';
      throw error;
    }
    inject('after');
    return result;
  };
  const query = (sql: string, values: SQLitePrimitive[] = []) => {
    return run(sql, values, () => {
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
    });
  };
  const control = (sql: string) => run(sql, [], () => native.exec(sql));
  const database = {
    executeSql: async (sql: string, values?: SQLitePrimitive[]) => {
      await waitAtBarrier(sql, 'before');
      const result = query(sql, values);
      await waitAtBarrier(sql, 'after');
      return [result];
    },
    transaction: async (operation: (tx: object) => void) => {
      let active = false;
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
        run('BEGIN;', [], () => {
          native.exec('BEGIN;');
          active = true;
        });
        operation(tx);
        run('COMMIT;', [], () => {
          native.exec('COMMIT;');
          active = false;
        });
      } catch (error) {
        // A lost COMMIT response must never be represented as successful rollback.
        if (active) control('ROLLBACK;');
        throw error;
      }
    },
    close: async () => run('CLOSE', [], () => native.close()),
  } as unknown as SmartFinSQLiteDatabase;
  return {
    database,
    native,
    query,
    trace,
    /** Promise API only: synchronous transaction callbacks never await a barrier. */
    pauseNextExecuteSql: (sql: string, phase: SQLiteFault['phase']) => {
      if (barrier) throw new Error('A SQLite barrier is already armed');
      let arrived!: () => void;
      let release!: () => void;
      const reached = new Promise<void>(resolve => {
        arrived = resolve;
      });
      const released = new Promise<void>(resolve => {
        release = resolve;
      });
      barrier = { sql, phase, arrived, released };
      return { reached, release };
    },
    resetTrace: () => {
      trace.length = 0;
      writes = 0;
      matches = 0;
    },
    injectFault: (next?: SQLiteFault) => {
      if (
        next &&
        ((next.write !== undefined &&
          (!Number.isInteger(next.write) || next.write < 1)) ||
          (next.occurrence !== undefined &&
            (!Number.isInteger(next.occurrence) || next.occurrence < 1)))
      ) {
        throw new Error('Fault positions must be positive integers');
      }
      fault = next;
      matches = 0;
    },
    failOn: (sql?: string) => {
      failing = sql;
    },
  };
}
