import type { SQLiteProgram } from './atomicSQLite';
import type { SQLiteRow } from './sqliteRows';

/** Portable to Android 7's SQLite (modern ON CONFLICT DO UPDATE needs 3.24). */
export function* upsertSQLiteRow(
  table: string,
  row: SQLiteRow,
): SQLiteProgram<void> {
  const columns = Object.keys(row);
  if (
    ![table, ...columns].every(value => /^[a-z_]+$/.test(value)) ||
    typeof row.id !== 'string'
  )
    throw new Error('Identificador de persistencia inválido.');
  const mutable = columns.filter(
    column => column !== 'id' && column !== 'created_at',
  );
  yield {
    sql: `UPDATE ${table} SET ${mutable
      .map(column => `${column} = ?`)
      .join(',')} WHERE id = ?;`,
    values: [...mutable.map(column => row[column] ?? null), row.id],
  };
  yield {
    sql: `INSERT INTO ${table} (${columns.join(',')}) SELECT ${columns
      .map(() => '?')
      .join(',')} WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE id = ?);`,
    values: [...columns.map(column => row[column] ?? null), row.id],
  };
  return undefined;
}
