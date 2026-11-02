import type { SmartFinSQLiteDatabase } from './sqliteDatabase';
import { resultSetToRows, type SQLiteRow } from './sqliteRows';

/**
 * 1a.3A: saves one row without INSERT OR REPLACE, which deletes and reinserts an existing row (new rowid,
 * ON DELETE CASCADE/SET NULL on children, unlisted columns reset to their DEFAULT).
 *
 * SELECT, then UPDATE only the listed columns, or INSERT when absent. Portable to Android 7's SQLite 3.9
 * (ON CONFLICT DO UPDATE needs 3.24). The key, rowid and stored created_at are kept. Exactly one write per
 * row, like the REPLACE it substitutes: same revision triggers and the same write positions validated on
 * Android. Runs through `database`, so it joins the caller's transaction participant and never opens a
 * nested one. A plain INSERT lets an unexpected constraint violation fail loudly.
 */
export async function saveSQLiteRowPreservingIdentity(
  database: SmartFinSQLiteDatabase,
  table: string,
  key: string,
  row: SQLiteRow,
): Promise<void> {
  const columns = Object.keys(row);
  if (
    ![table, key, ...columns].every(value => /^[a-z_]+$/.test(value)) ||
    typeof row[key] !== 'string'
  ) {
    throw new Error('Identificador de persistencia inválido.');
  }
  const mutable = columns.filter(column => column !== key && column !== 'created_at');
  const [selected] = await database.executeSql(
    `SELECT 1 AS present FROM ${table} WHERE ${key} = ?;`,
    [row[key]],
  );

  if (resultSetToRows(selected).length === 0) {
    await database.executeSql(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')});`,
      columns.map(column => row[column] ?? null),
    );
    return;
  }

  const [updated] = await database.executeSql(
    `UPDATE ${table} SET ${mutable.map(column => `${column} = ?`).join(', ')} WHERE ${key} = ?;`,
    [...mutable.map(column => row[column] ?? null), row[key]],
  );
  if (updated.rowsAffected !== 1) {
    throw new Error(`No se pudo actualizar ${table}: el registro cambió durante la escritura.`);
  }
}
