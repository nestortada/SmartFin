import type { SettingsRepository } from '../../settings';
import {
  updateBiometricsEnabled,
  updateLocalCredentialEnabled,
} from '../../settings';
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

export async function authenticateAppAccess(
  securityService: SecurityService,
  settings: SettingsState,
  secret?: string,
): Promise<boolean> {
  if (settings.localCredentialEnabled && secret !== undefined) {
    return securityService.verifyLocalCredential(secret);
  }

  if (settings.biometricsEnabled) {
    let authenticated = false;

    try {
      authenticated = await securityService.authenticateBiometrics();
    } catch {
      authenticated = false;
    }

    if (authenticated) {
      return true;
    }
  }

  if (!settings.localCredentialEnabled || secret === undefined) {
    return false;
  }

  return securityService.verifyLocalCredential(secret);
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

export async function disableLocalAccessSecret(
  settingsRepository: SettingsRepository,
  securityService: SecurityService,
  currentSettings: SettingsState,
): Promise<SettingsState> {
  await securityService.clearLocalCredential();

  return updateLocalCredentialEnabled(settingsRepository, currentSettings, false);
}
