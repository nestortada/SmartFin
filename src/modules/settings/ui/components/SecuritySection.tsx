import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';

import {
  GlassButton,
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
  onToggleLocalCredential: (enabled: boolean) => Promise<void>;
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
  onToggleLocalCredential,
  onToggleSmsReading,
}: SecuritySectionProps) {
  const [credentialDraft, setCredentialDraft] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [showCredential, setShowCredential] = useState(false);

  const saveCredential = () => {
    void onSaveCredential(credentialDraft).then(() => {
      setCredentialDraft('');
      setShowEditor(false);
      setShowCredential(false);
    });
  };

  const disableCredential = () => {
    setCredentialDraft('');
    setShowCredential(false);
    setShowEditor(false);
    void onToggleLocalCredential(false);
  };

  return (
    <SettingsSection palette={palette} title="Seguridad">
      <SettingsRow
        icon={<MaterialIcons name="fingerprint" size={24} color={palette.muted} />}
        label="Biometría"
        palette={palette}
        trailing={
          <Switch
            ios_backgroundColor="rgba(120, 120, 130, 0.2)"
            onValueChange={onToggleBiometrics}
            thumbColor={biometricsEnabled ? '#ffffff' : '#f4f2f8'}
            trackColor={{
              false: 'rgba(255, 255, 255, 0.12)',
              true: palette.primary,
            }}
            value={biometricsEnabled}
          />
        }
      />

      <View style={styles.divider} />

      <SettingsRow
        icon={<MaterialIcons name="sms-failed" size={24} color={palette.muted} />}
        label="Notificaciones de SMS"
        palette={palette}
        supportingText="Lectura automática de notificaciones"
        trailing={
          <Switch
            disabled={smsPermissionState === 'unavailable'}
            ios_backgroundColor="rgba(120, 120, 130, 0.2)"
            onValueChange={onToggleSmsReading}
            thumbColor={smsReadingEnabled ? '#ffffff' : '#f4f2f8'}
            trackColor={{
              false: 'rgba(255, 255, 255, 0.12)',
              true: palette.primary,
            }}
            value={smsReadingEnabled}
          />
        }
      />

      <View style={styles.divider} />

      <SettingsRow
        icon={<MaterialIcons name="lock-open" size={24} color={palette.muted} />}
        label="PIN de acceso"
        palette={palette}
        supportingText={
          localCredentialEnabled
            ? 'Activo. Puedes cambiarlo o desactivarlo.'
            : 'Desactivado'
        }
        trailing={
          <Switch
            ios_backgroundColor="rgba(120, 120, 130, 0.2)"
            onValueChange={enabled => {
              if (enabled) {
                setShowEditor(true);
              } else {
                disableCredential();
              }
            }}
            thumbColor={localCredentialEnabled ? '#ffffff' : '#f4f2f8'}
            trackColor={{
              false: 'rgba(255, 255, 255, 0.12)',
              true: palette.primary,
            }}
            value={localCredentialEnabled}
          />
        }
      />

      <View style={styles.pinActions}>
        <Pressable
          onPress={() => setShowEditor(value => !value)}
          style={[styles.inlineButton, { borderColor: palette.border }]}>
          <Text style={[styles.inlineButtonText, { color: palette.primary }]}>
            {localCredentialEnabled ? 'Cambiar PIN' : 'Crear PIN'}
          </Text>
        </Pressable>
      </View>

      {showEditor ? (
        <View
          style={[
            styles.credentialPanel,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}>
          <TextInput
            onChangeText={setCredentialDraft}
            placeholder="Minimo 4 caracteres"
            placeholderTextColor={palette.muted}
            secureTextEntry={!showCredential}
            style={[
              styles.credentialInput,
              { borderColor: palette.border, color: palette.text },
            ]}
            value={credentialDraft}
          />
          <Pressable
            accessibilityLabel={showCredential ? 'Ocultar PIN' : 'Ver PIN'}
            onPress={() => setShowCredential(value => !value)}
            style={[styles.eyeButton, { borderColor: palette.border }]}>
            <Text style={[styles.eyeButtonText, { color: palette.muted }]}>
              {showCredential ? 'Ocultar' : 'Ver'}
            </Text>
          </Pressable>
          <GlassButton
            label={localCredentialEnabled ? 'Cambiar' : 'Guardar'}
            onPress={saveCredential}
            palette={palette}
            variant="filled"
          />
        </View>
      ) : null}

      <View style={styles.divider} />

      <SettingsRow
        icon="LOCK"
        label="Bloqueo automatico"
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
  credentialInput: {
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    minHeight: 44,
    minWidth: 0,
    paddingHorizontal: 14,
  },
  credentialPanel: {
    alignItems: 'center',
    borderRadius: 12,
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
  },
  eyeButton: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  eyeButtonText: {
    fontSize: 12,
    fontWeight: '900',
  },
  inlineButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  inlineButtonText: {
    fontSize: 12,
    fontWeight: '900',
  },
  pinActions: {
    paddingBottom: 12,
    paddingHorizontal: 64,
  },
  trailingLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
});
