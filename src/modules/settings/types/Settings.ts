export type AppTheme = 'dark' | 'light';

export type SmsPermissionState =
  | 'unknown'
  | 'available'
  | 'granted'
  | 'denied'
  | 'unavailable';

export type SettingsState = {
  theme: AppTheme;
  biometricsEnabled: boolean;
  localCredentialEnabled: boolean;
  smsReadingEnabled: boolean;
  smsPermissionState: SmsPermissionState;
};

export const DEFAULT_SETTINGS: SettingsState = {
  theme: 'dark',
  biometricsEnabled: false,
  localCredentialEnabled: false,
  smsReadingEnabled: false,
  smsPermissionState: 'unknown',
};
