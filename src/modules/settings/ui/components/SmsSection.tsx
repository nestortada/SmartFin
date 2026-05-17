import React from 'react';
import { Switch } from 'react-native';

import { SettingsRow, SettingsSection, type SettingsPalette } from './primitives';
import type { SmsPermissionState } from '../../types';

type SmsSectionProps = {
  palette: SettingsPalette;
  smsPermissionState: SmsPermissionState;
  smsReadingEnabled: boolean;
  onToggleSmsReading: (enabled: boolean) => Promise<void>;
};

export function SmsSection({
  palette,
  smsPermissionState,
  smsReadingEnabled,
  onToggleSmsReading,
}: SmsSectionProps) {
  const supportingText =
    smsPermissionState === 'unavailable'
      ? 'Disponible solo en Android'
      : 'Detecta pagos de Nequi, Bancolombia, Davivienda y Daviplata sin conexión';

  return (
    <SettingsSection palette={palette} title="SMS Financiero">
      <SettingsRow
        icon="✉"
        label="Leer SMS de pagos"
        palette={palette}
        supportingText={supportingText}
        trailing={
          <Switch
            disabled={smsPermissionState === 'unavailable'}
            ios_backgroundColor="rgba(120, 120, 130, 0.28)"
            onValueChange={onToggleSmsReading}
            thumbColor={smsReadingEnabled ? '#001d93' : '#f4f2f8'}
            trackColor={{
              false: 'rgba(120, 120, 130, 0.28)',
              true: palette.primary,
            }}
            value={smsReadingEnabled}
          />
        }
      />
    </SettingsSection>
  );
}
