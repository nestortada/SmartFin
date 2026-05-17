import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import {
  readString,
  resultSetToRows,
  type SQLiteRow,
} from '../../../database/sqliteRows';
import {
  DEFAULT_SETTINGS,
  type AppTheme,
  type SettingsState,
  type SmsPermissionState,
} from '../types';

export type SettingsRepository = {
  getSettings: () => Promise<SettingsState>;
  saveSettings: (settings: SettingsState) => Promise<void>;
};

type PersistedSettingKey = keyof SettingsState;

const SETTING_KEYS: PersistedSettingKey[] = [
  'theme',
  'biometricsEnabled',
  'localCredentialEnabled',
  'smsReadingEnabled',
  'smsPermissionState',
];

function isAppTheme(value: string): value is AppTheme {
  return value === 'dark' || value === 'light';
}

function isSmsPermissionState(value: string): value is SmsPermissionState {
  return (
    value === 'unknown' ||
    value === 'available' ||
    value === 'granted' ||
    value === 'denied' ||
    value === 'unavailable'
  );
}

function parseBoolean(value: string): boolean {
  return value === 'true';
}

function settingRowToPair(row: SQLiteRow): [string, string] {
  return [readString(row, 'setting_key'), readString(row, 'setting_value')];
}

function mergePersistedSettings(rows: SQLiteRow[]): SettingsState {
  const persisted = new Map(rows.map(settingRowToPair));
  const theme = persisted.get('theme');
  const smsPermissionState = persisted.get('smsPermissionState');

  return {
    theme: theme && isAppTheme(theme) ? theme : DEFAULT_SETTINGS.theme,
    biometricsEnabled: parseBoolean(
      persisted.get('biometricsEnabled') ??
        String(DEFAULT_SETTINGS.biometricsEnabled),
    ),
    localCredentialEnabled: parseBoolean(
      persisted.get('localCredentialEnabled') ??
        String(DEFAULT_SETTINGS.localCredentialEnabled),
    ),
    smsReadingEnabled: parseBoolean(
      persisted.get('smsReadingEnabled') ??
        String(DEFAULT_SETTINGS.smsReadingEnabled),
    ),
    smsPermissionState:
      smsPermissionState && isSmsPermissionState(smsPermissionState)
        ? smsPermissionState
        : DEFAULT_SETTINGS.smsPermissionState,
  };
}

function serializeSetting(settings: SettingsState, key: PersistedSettingKey): string {
  return String(settings[key]);
}

export function createSqliteSettingsRepository(
  database: SmartFinSQLiteDatabase,
): SettingsRepository {
  return {
    getSettings: async () => {
      const [resultSet] = await database.executeSql(
        `SELECT setting_key, setting_value
        FROM app_settings
        WHERE setting_key IN (?, ?, ?, ?, ?);`,
        SETTING_KEYS,
      );

      return mergePersistedSettings(resultSetToRows(resultSet));
    },
    saveSettings: async settings => {
      const updatedAt = new Date().toISOString();

      for (const key of SETTING_KEYS) {
        await database.executeSql(
          `INSERT OR REPLACE INTO app_settings (
            setting_key,
            setting_value,
            updated_at
          ) VALUES (?, ?, ?);`,
          [key, serializeSetting(settings, key), updatedAt],
        );
      }
    },
  };
}
