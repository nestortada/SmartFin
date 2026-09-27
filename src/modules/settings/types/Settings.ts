export type AppTheme = 'dark' | 'light';

export type SettingsState = {
  theme: AppTheme;
  biometricsEnabled: boolean;
  localCredentialEnabled: boolean;
};

export const DEFAULT_SETTINGS: SettingsState = {
  theme: 'dark',
  biometricsEnabled: false,
  localCredentialEnabled: false,
};
