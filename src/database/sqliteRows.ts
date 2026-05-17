import type { ResultSet } from 'react-native-sqlite-storage';

export type SQLitePrimitive = string | number | null;

export type SQLiteRow = Record<string, SQLitePrimitive>;

function isSQLitePrimitive(value: unknown): value is SQLitePrimitive {
  return value === null || typeof value === 'string' || typeof value === 'number';
}

function isSQLiteRow(value: unknown): value is SQLiteRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(isSQLitePrimitive);
}

export function resultSetToRows(resultSet: ResultSet): SQLiteRow[] {
  const rows: SQLiteRow[] = [];

  for (let index = 0; index < resultSet.rows.length; index += 1) {
    const rawRow = resultSet.rows.item(index) as unknown;

    if (!isSQLiteRow(rawRow)) {
      throw new Error('SQLite devolvió una fila con una forma inesperada.');
    }

    rows.push(rawRow);
  }

  return rows;
}

export function readString(row: SQLiteRow, key: string): string {
  const value = row[key];

  if (typeof value !== 'string') {
    throw new Error(`SQLite devolvió un valor no textual para ${key}.`);
  }

  return value;
}

export function readNullableString(row: SQLiteRow, key: string): string | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`SQLite devolvió un valor no textual para ${key}.`);
  }

  return value;
}

export function readNumber(row: SQLiteRow, key: string): number {
  const value = row[key];

  if (typeof value !== 'number') {
    throw new Error(`SQLite devolvió un valor no numérico para ${key}.`);
  }

  return value;
}

export function readNullableNumber(row: SQLiteRow, key: string): number | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number') {
    throw new Error(`SQLite devolvió un valor no numérico para ${key}.`);
  }

  return value;
}
