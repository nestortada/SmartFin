import {
  authenticateAppAccess,
  disableLocalAccessSecret,
  setLocalAccessSecret,
} from '../src/modules/security';
import type { SecurityService } from '../src/modules/security';
import type { SettingsRepository, SettingsState } from '../src/modules/settings';
import { DEFAULT_SETTINGS } from '../src/modules/settings';

function createSettingsRepository() {
  let savedSettings: SettingsState = DEFAULT_SETTINGS;

  const repository: SettingsRepository = {
    getSettings: jest.fn(async () => savedSettings),
    saveSettings: jest.fn(async settings => {
      savedSettings = settings;
    }),
  };

  return { repository };
}

function createSecurityService(): SecurityService {
  return {
    authenticateBiometrics: jest.fn(async () => false),
    clearLocalCredential: jest.fn(async () => undefined),
    enableBiometrics: jest.fn(async () => undefined),
    isBiometricsAvailable: jest.fn(async () => true),
    setLocalCredential: jest.fn(async () => undefined),
    verifyLocalCredential: jest.fn(async () => false),
  };
}

test('setLocalAccessSecret enables local credential when the secret is valid', async () => {
  const { repository } = createSettingsRepository();
  const securityService = createSecurityService();

  const settings = await setLocalAccessSecret(
    repository,
    securityService,
    DEFAULT_SETTINGS,
    '1234',
  );

  expect(settings.localCredentialEnabled).toBe(true);
  expect(securityService.setLocalCredential).toHaveBeenCalledWith('1234');
  expect(repository.saveSettings).toHaveBeenCalledWith(settings);
});

test('disableLocalAccessSecret clears secure storage and disables the setting', async () => {
  const { repository } = createSettingsRepository();
  const securityService = createSecurityService();
  const currentSettings = { ...DEFAULT_SETTINGS, localCredentialEnabled: true };

  const settings = await disableLocalAccessSecret(
    repository,
    securityService,
    currentSettings,
  );

  expect(settings.localCredentialEnabled).toBe(false);
  expect(securityService.clearLocalCredential).toHaveBeenCalled();
});

test('authenticateAppAccess accepts biometrics before checking the PIN', async () => {
  const securityService = {
    ...createSecurityService(),
    authenticateBiometrics: jest.fn(async () => true),
    verifyLocalCredential: jest.fn(async () => false),
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    biometricsEnabled: true,
    localCredentialEnabled: true,
  };

  await expect(authenticateAppAccess(securityService, settings)).resolves.toBe(
    true,
  );
  expect(securityService.verifyLocalCredential).not.toHaveBeenCalled();
});

test('authenticateAppAccess falls back to PIN when biometrics fail', async () => {
  const securityService = {
    ...createSecurityService(),
    authenticateBiometrics: jest.fn(async () => false),
    verifyLocalCredential: jest.fn(async () => true),
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    biometricsEnabled: true,
    localCredentialEnabled: true,
  };

  await expect(
    authenticateAppAccess(securityService, settings, '1234'),
  ).resolves.toBe(true);
  expect(securityService.verifyLocalCredential).toHaveBeenCalledWith('1234');
});

test('authenticateAppAccess validates PIN directly when a secret is provided', async () => {
  const securityService = {
    ...createSecurityService(),
    authenticateBiometrics: jest.fn(async () => {
      throw new Error('native function is undefined');
    }),
    verifyLocalCredential: jest.fn(async () => true),
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    biometricsEnabled: true,
    localCredentialEnabled: true,
  };

  await expect(
    authenticateAppAccess(securityService, settings, '1234'),
  ).resolves.toBe(true);
  expect(securityService.authenticateBiometrics).not.toHaveBeenCalled();
  expect(securityService.verifyLocalCredential).toHaveBeenCalledWith('1234');
});

test('authenticateAppAccess treats biometric native errors as a failed unlock', async () => {
  const securityService = {
    ...createSecurityService(),
    authenticateBiometrics: jest.fn(async () => {
      throw new Error('native function is undefined');
    }),
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    biometricsEnabled: true,
  };

  await expect(authenticateAppAccess(securityService, settings)).resolves.toBe(
    false,
  );
});
