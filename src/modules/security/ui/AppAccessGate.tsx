import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { AppTheme, SettingsState } from '../../settings';
import type { SecurityService } from '../services';
import { authenticateAppAccess } from '../useCases';

type AppAccessGateProps = {
  colorScheme: AppTheme;
  isVisible: boolean;
  securityService: SecurityService;
  settings: SettingsState;
  onUnlocked: () => void;
};

const gatePalettes = {
  dark: {
    background: '#131314',
    border: 'rgba(255, 255, 255, 0.14)',
    button: '#bbc3ff',
    buttonText: '#001d93',
    card: '#222226',
    danger: '#ffb4ab',
    muted: '#c5c5d9',
    text: '#f2eff0',
  },
  light: {
    background: '#f8f8fb',
    border: 'rgba(30, 36, 60, 0.14)',
    button: '#2848ee',
    buttonText: '#ffffff',
    card: '#ffffff',
    danger: '#a9362e',
    muted: '#686678',
    text: '#18191f',
  },
};

export function AppAccessGate({
  colorScheme,
  isVisible,
  securityService,
  settings,
  onUnlocked,
}: AppAccessGateProps) {
  const palette = gatePalettes[colorScheme];
  const [pinDraft, setPinDraft] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const isAuthenticatingRef = useRef(false);

  const runBiometricUnlock = async () => {
    if (!settings.biometricsEnabled || isAuthenticatingRef.current) {
      return;
    }

    isAuthenticatingRef.current = true;
    setIsAuthenticating(true);
    setErrorMessage(undefined);

    try {
      const authenticated = await authenticateAppAccess(
        securityService,
        settings,
      );

      if (authenticated) {
        setPinDraft('');
        onUnlocked();
      } else {
        setErrorMessage('No se pudo abrir o validar la huella.');
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo validar la biometria.',
      );
    } finally {
      isAuthenticatingRef.current = false;
      setIsAuthenticating(false);
    }
  };

  const verifyPin = async () => {
    setErrorMessage(undefined);

    try {
      const authenticated = await authenticateAppAccess(
        securityService,
        settings,
        pinDraft,
      );

      if (authenticated) {
        setPinDraft('');
        onUnlocked();
      } else {
        setErrorMessage('PIN incorrecto.');
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudo validar el PIN.',
      );
    }
  };

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (isVisible && settings.biometricsEnabled) {
      timeoutId = setTimeout(() => {
        void runBiometricUnlock();
      }, 350);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
    // Authentication must run only when the gate opens or settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, settings.biometricsEnabled, settings.localCredentialEnabled]);

  return (
    <Modal animationType="fade" transparent={false} visible={isVisible}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View
          style={[
            styles.panel,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}>
          <Text style={[styles.title, { color: palette.text }]}>
            SmartFin bloqueado
          </Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>
            Valida tu acceso para entrar a tus finanzas.
          </Text>

          {settings.biometricsEnabled ? (
            <Pressable
              disabled={isAuthenticating}
              onPress={runBiometricUnlock}
              style={[styles.primaryButton, { backgroundColor: palette.button }]}>
              <Text style={[styles.primaryButtonText, { color: palette.buttonText }]}>
                {isAuthenticating ? 'Validando...' : 'Usar huella'}
              </Text>
            </Pressable>
          ) : null}

          {settings.localCredentialEnabled ? (
            <View style={styles.pinArea}>
              <View style={[styles.inputWrap, { borderColor: palette.border }]}>
                <TextInput
                  autoCapitalize="none"
                  keyboardType="number-pad"
                  onChangeText={setPinDraft}
                  onSubmitEditing={verifyPin}
                  placeholder="PIN de acceso"
                  placeholderTextColor={palette.muted}
                  secureTextEntry={!showPin}
                  style={[styles.input, { color: palette.text }]}
                  value={pinDraft}
                />
                <Pressable
                  accessibilityLabel={showPin ? 'Ocultar PIN' : 'Ver PIN'}
                  onPress={() => setShowPin(value => !value)}
                  style={styles.eyeButton}>
                  <Text style={[styles.eyeText, { color: palette.muted }]}>
                    {showPin ? 'Ocultar' : 'Ver'}
                  </Text>
                </Pressable>
              </View>
              <Pressable
                onPress={verifyPin}
                style={[styles.secondaryButton, { borderColor: palette.border }]}>
                <Text style={[styles.secondaryButtonText, { color: palette.text }]}>
                  Entrar con PIN
                </Text>
              </Pressable>
            </View>
          ) : null}

          {errorMessage ? (
            <Text style={[styles.errorText, { color: palette.danger }]}>
              {errorMessage}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  errorText: {
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  eyeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  eyeText: {
    fontSize: 12,
    fontWeight: '900',
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  inputWrap: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  panel: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 16,
    maxWidth: 420,
    padding: 20,
    width: '100%',
  },
  pinArea: {
    gap: 10,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '900',
  },
  screen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '900',
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    textAlign: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 28,
    textAlign: 'center',
  },
});
