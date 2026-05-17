import React, { useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View, Pressable } from 'react-native';

import {
  GlassButton,
  PressableMotion,
  SettingsRow,
  SettingsSection,
  type SettingsPalette,
} from './primitives';
import type { SmsPermissionState } from '../../types';

type SecuritySectionProps = {
  biometricsEnabled: boolean;
  localCredentialEnabled: boolean;
  palette: SettingsPalette;
  smsPermissionState: SmsPermissionState;
  smsReadingEnabled: boolean;
  onSaveCredential: (secret: string) => Promise<void>;
  onToggleBiometrics: (enabled: boolean) => Promise<void>;
  onToggleSmsReading: (enabled: boolean) => Promise<void>;
};

export function SecuritySection({
  biometricsEnabled,
  localCredentialEnabled,
  palette,
  smsPermissionState,
  smsReadingEnabled,
  onSaveCredential,
  onToggleBiometrics,
  onToggleSmsReading,
}: SecuritySectionProps) {
  const [credentialDraft, setCredentialDraft] = useState('');
  const [showEditor, setShowEditor] = useState(false);

  const saveCredential = () => {
    void onSaveCredential(credentialDraft).then(() => {
      setCredentialDraft('');
      setShowEditor(false);
    });
  };

  const supportingText =
    smsPermissionState === 'unavailable'
      ? 'Disponible solo en Android'
      : 'Lectura automática de notificaciones';

  return (
    <SettingsSection palette={palette} title="Seguridad">
      {/* Biometría Row */}
      <SettingsRow
        icon="🧬"
        label="Biometría"
        palette={palette}
        trailing={
          <Switch
            ios_backgroundColor="rgba(120, 120, 130, 0.2)"
            onValueChange={onToggleBiometrics}
            thumbColor={biometricsEnabled ? '#ffffff' : '#f4f2f8'}
            trackColor={{
              false: 'rgba(255, 255, 255, 0.08)',
              true: palette.primary,
            }}
            value={biometricsEnabled}
          />
        }
      />

      <View style={styles.divider} />

      {/* SMS Row */}
      <SettingsRow
        icon="✉️"
        label="Notificaciones de SMS"
        palette={palette}
        supportingText={supportingText}
        trailing={
          <Switch
            disabled={smsPermissionState === 'unavailable'}
            ios_backgroundColor="rgba(120, 120, 130, 0.2)"
            onValueChange={onToggleSmsReading}
            thumbColor={smsReadingEnabled ? '#ffffff' : '#f4f2f8'}
            trackColor={{
              false: 'rgba(255, 255, 255, 0.08)',
              true: palette.primary,
            }}
            value={smsReadingEnabled}
          />
        }
      />

      <View style={styles.divider} />

      {/* PIN Row */}
      <SettingsRow
        icon="🔐"
        label="PIN de acceso"
        palette={palette}
        supportingText={
          localCredentialEnabled
            ? 'Credencial local activa'
            : 'Sin credencial local'
        }
        trailing={
          <Pressable onPress={() => setShowEditor(v => !v)} style={styles.chevronWrap}>
            <Text style={[styles.chevron, { color: palette.muted }]}>›</Text>
          </Pressable>
        }
      />

      {showEditor ? (
        <View
          style={[
            styles.credentialPanel,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}>
          <TextInput
            onChangeText={setCredentialDraft}
            placeholder="Mínimo 4 caracteres"
            placeholderTextColor={palette.muted}
            secureTextEntry
            style={[
              styles.credentialInput,
              { borderColor: palette.border, color: palette.text },
            ]}
            value={credentialDraft}
          />
          <GlassButton
            label="Guardar"
            onPress={saveCredential}
            palette={palette}
            variant="filled"
          />
        </View>
      ) : null}

      <View style={styles.divider} />

      {/* Auto-Lock Row */}
      <SettingsRow
        icon="🕒"
        label="Bloqueo automático"
        palette={palette}
        trailing={
          <Text style={[styles.trailingLabel, { color: palette.primary }]}>
            Inmediato
          </Text>
        }
      />
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  chevron: {
    fontSize: 22,
    fontWeight: '300',
  },
  chevronWrap: {
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  credentialInput: {
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  credentialPanel: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 10,
    marginVertical: 6,
    padding: 10,
  },
  divider: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    height: 1,
    marginHorizontal: 8,
  },
  trailingLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
