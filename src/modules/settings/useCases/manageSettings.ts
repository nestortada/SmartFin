import type { SettingsRepository } from '../repositories';
import type { AppTheme, SettingsState, SmsPermissionState } from '../types';

export async function loadSettings(
  settingsRepository: SettingsRepository,
): Promise<SettingsState> {
  return settingsRepository.getSettings();
}

export async function updateTheme(
  settingsRepository: SettingsRepository,
  currentSettings: SettingsState,
  theme: AppTheme,
): Promise<SettingsState> {
  const nextSettings = { ...currentSettings, theme };
  await settingsRepository.saveSettings(nextSettings);
  return nextSettings;
}

export async function updateBiometricsEnabled(
  settingsRepository: SettingsRepository,
  currentSettings: SettingsState,
  biometricsEnabled: boolean,
): Promise<SettingsState> {
  const nextSettings = { ...currentSettings, biometricsEnabled };
  await settingsRepository.saveSettings(nextSettings);
  return nextSettings;
}

export async function updateLocalCredentialEnabled(
  settingsRepository: SettingsRepository,
  currentSettings: SettingsState,
  localCredentialEnabled: boolean,
): Promise<SettingsState> {
  const nextSettings = { ...currentSettings, localCredentialEnabled };
  await settingsRepository.saveSettings(nextSettings);
  return nextSettings;
}

export async function updateSmsReadingPreference(
  settingsRepository: SettingsRepository,
  currentSettings: SettingsState,
  smsReadingEnabled: boolean,
  smsPermissionState: SmsPermissionState,
): Promise<SettingsState> {
  const nextSettings = {
    ...currentSettings,
    smsPermissionState,
    smsReadingEnabled,
  };
  await settingsRepository.saveSettings(nextSettings);
  return nextSettings;
}
