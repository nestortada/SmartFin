import type { SettingsRepository } from '../../settings';
import { updateBiometricsEnabled, updateLocalCredentialEnabled } from '../../settings';
import type { SettingsState } from '../../settings';
import type { SecurityService } from '../services';

export async function enableBiometricAccess(
  settingsRepository: SettingsRepository,
  securityService: SecurityService,
  currentSettings: SettingsState,
): Promise<SettingsState> {
  await securityService.enableBiometrics();

  return updateBiometricsEnabled(settingsRepository, currentSettings, true);
}

export async function disableBiometricAccess(
  settingsRepository: SettingsRepository,
  currentSettings: SettingsState,
): Promise<SettingsState> {
  return updateBiometricsEnabled(settingsRepository, currentSettings, false);
}

export async function setLocalAccessSecret(
  settingsRepository: SettingsRepository,
  securityService: SecurityService,
  currentSettings: SettingsState,
  secret: string,
): Promise<SettingsState> {
  if (secret.trim().length < 4) {
    throw new Error('La contraseña o PIN debe tener al menos 4 caracteres.');
  }

  await securityService.setLocalCredential(secret);

  return updateLocalCredentialEnabled(settingsRepository, currentSettings, true);
}
