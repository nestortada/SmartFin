import type { ResultSet } from 'react-native-sqlite-storage';

import type { SmartFinSQLiteDatabase } from '../src/database';
import { createSqliteSettingsRepository } from '../src/modules/settings/repositories/sqliteSettingsRepository';
import { DEFAULT_SETTINGS } from '../src/modules/settings/types';
import { updateTheme } from '../src/modules/settings/useCases/manageSettings';

type SettingRow = {
  setting_key: string;
  setting_value: string;
};

function createResultSet(rows: SettingRow[]): ResultSet {
  return {
    insertId: 0,
    rows: {
      item: (index: number) => rows[index],
      length: rows.length,
      raw: () => rows,
    },
    rowsAffected: 0,
  };
}

function createSettingsDatabase(initialRows: SettingRow[]) {
  const rows = new Map(
    initialRows.map(row => [row.setting_key, row.setting_value]),
  );
  const executeSql = jest.fn(
    async (statement: string, values?: unknown[]) => {
      if (statement.includes('SELECT setting_key')) {
        return [createResultSet(Array.from(rows).map(([key, value]) => ({
          setting_key: key,
          setting_value: value,
        })))] as const;
      }

      if (statement.includes('INSERT OR REPLACE INTO app_settings')) {
        const key = values?.[0];
        const value = values?.[1];

        if (typeof key === 'string' && typeof value === 'string') {
          rows.set(key, value);
        }
      }

      return [createResultSet([])] as const;
    },
  );

  return {
    database: { executeSql } as unknown as SmartFinSQLiteDatabase,
    executeSql,
    rows,
  };
}

test('settings repository returns defaults when nothing has been saved', async () => {
  const { database } = createSettingsDatabase([]);
  const repository = createSqliteSettingsRepository(database);

  await expect(repository.getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
});

test('settings repository persists theme changes', async () => {
  const { database, rows } = createSettingsDatabase([]);
  const repository = createSqliteSettingsRepository(database);

  const nextSettings = await updateTheme(repository, DEFAULT_SETTINGS, 'light');

  expect(nextSettings.theme).toBe('light');
  expect(rows.get('theme')).toBe('light');
});
