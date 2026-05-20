import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation, type BottomNavigationTab } from '../../../shared/components';
import type { AppTheme, SettingsState } from '../types';

import { PersonalizationSection } from './components/PersonalizationSection';
import { SecuritySection } from './components/SecuritySection';
import { SettingsHeroCard } from './components/SettingsHeroCard';
import { StatusPill, type SettingsPalette } from './components/primitives';

// ─── Palettes ─────────────────────────────────────────────────────────────────

const palettes: Record<AppTheme, SettingsPalette> = {
  dark: {
    background: '#131314',
    border: 'rgba(255, 255, 255, 0.1)',
    card: 'rgba(255, 255, 255, 0.08)',
    cardStrong: 'rgba(255, 255, 255, 0.08)',
    danger: '#ffb4ab',
    dangerSoft: 'rgba(255, 180, 171, 0.1)',
    inverseText: '#001d93',
    muted: '#c5c5d9',
    primary: '#bbc3ff',
    primarySoft: 'rgba(187, 195, 255, 0.2)',
    secondary: '#cdbdff',
    secondarySoft: 'rgba(205, 189, 255, 0.14)',
    tertiary: '#00e475',
    tertiarySoft: 'rgba(0, 127, 62, 0.2)',
    text: '#e5e2e3',
  },
  light: {
    background: '#f8f8fb',
    border: 'rgba(30, 36, 60, 0.12)',
    card: 'rgba(255, 255, 255, 0.86)',
    cardStrong: 'rgba(255, 255, 255, 0.96)',
    danger: '#a9362e',
    dangerSoft: 'rgba(169, 54, 46, 0.1)',
    inverseText: '#ffffff',
    muted: '#686678',
    primary: '#2848ee',
    primarySoft: 'rgba(61, 90, 254, 0.12)',
    secondary: '#5203d5',
    secondarySoft: 'rgba(82, 3, 213, 0.1)',
    tertiary: '#007f3e',
    tertiarySoft: 'rgba(0, 127, 62, 0.12)',
    text: '#18191f',
  },
};

// ─── Props ────────────────────────────────────────────────────────────────────

type SettingsScreenProps = {
  busyMessage?: string;
  errorMessage?: string;
  settings: SettingsState;
  onBack: () => void;
  onDeleteFinancialData: () => Promise<void>;
  onNavigateToHome: () => void;
  onNavigateToTransactions: () => void;
  onOpenCategories: () => void;
  onOpenCreditCards: () => void;
  onOpenDebitCards: () => void;
  onSaveCredential: (secret: string) => Promise<void>;
  onThemeChange: (theme: AppTheme) => Promise<void>;
  onToggleBiometrics: (enabled: boolean) => Promise<void>;
  onToggleSmsReading: (enabled: boolean) => Promise<void>;
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export function SettingsScreen({
  busyMessage,
  errorMessage,
  settings,
  onBack,
  onDeleteFinancialData,
  onNavigateToHome,
  onNavigateToTransactions,
  onOpenCategories,
  onOpenCreditCards,
  onOpenDebitCards,
  onSaveCredential,
  onThemeChange,
  onToggleBiometrics,
  onToggleSmsReading,
}: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const palette = palettes[settings.theme];

  const handleTabPress = (tab: BottomNavigationTab) => {
    if (tab === 'home') {
      onNavigateToHome();
    } else if (tab === 'transactions') {
      onNavigateToTransactions();
    }
  };

  const confirmFinancialDataDeletion = () => {
    Alert.alert(
      'Eliminar datos financieros',
      'Se borrarán cuentas, movimientos, presupuestos, mensajes SMS financieros y cálculos locales. Tus ajustes se conservarán.',
      [
        { style: 'cancel', text: 'Cancelar' },
        {
          onPress: () => { void onDeleteFinancialData(); },
          style: 'destructive',
          text: 'Eliminar',
        },
      ],
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      {/* ── Top bar ── */}
      <View
        style={[
          styles.topBar,
          {
            backgroundColor:
              settings.theme === 'dark'
                ? 'rgba(19, 19, 20, 0.92)'
                : 'rgba(248, 248, 251, 0.92)',
            borderColor: palette.border,
            paddingTop: insets.top + 8,
          },
        ]}>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={styles.backButton}>
          <Text style={[styles.backIcon, { color: palette.primary }]}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.primary }]}>Ajustes</Text>
        
        {/* Right side items: Bell notification and profile mark */}
        <View style={styles.topRightControls}>
          <Pressable style={styles.iconButton}>
            <Text style={[styles.bellIcon, { color: palette.muted }]}>🔔</Text>
          </Pressable>
          <View style={[styles.profileMark, { backgroundColor: '#3d5afe', borderColor: palette.primary }]}>
            <Text style={[styles.profileMarkText, { color: palette.text }]}>
              SF
            </Text>
          </View>
        </View>
      </View>

      {/* ── Content ── */}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 128, paddingTop: insets.top + 116 },
        ]}>
        <SettingsHeroCard palette={palette} />

        {busyMessage ? (
          <StatusPill palette={palette} text={busyMessage} tone="primary" />
        ) : null}

        {errorMessage ? (
          <StatusPill palette={palette} text={errorMessage} tone="danger" />
        ) : null}

        {/* SECURITY CARD */}
        <SecuritySection
          biometricsEnabled={settings.biometricsEnabled}
          localCredentialEnabled={settings.localCredentialEnabled}
          smsPermissionState={settings.smsPermissionState}
          smsReadingEnabled={settings.smsReadingEnabled}
          onSaveCredential={onSaveCredential}
          onToggleBiometrics={onToggleBiometrics}
          onToggleSmsReading={onToggleSmsReading}
          palette={palette}
        />

        {/* PERSONALIZATION & DELETION CARD */}
        <PersonalizationSection
          onOpenCategories={onOpenCategories}
          onThemeChange={onThemeChange}
          onDeleteFinancialData={confirmFinancialDataDeletion}
          palette={palette}
          theme={settings.theme}
        />

        {/* FOOTER */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: palette.muted }]}>
            SmartFin v2.4.0 (Build 8291)
          </Text>
          <Text style={[styles.footerTextSmall, { color: palette.muted }]}>
            Hecho con seguridad por el equipo de SmartFin
          </Text>
        </View>
      </ScrollView>

      <BottomNavigation
        activeTab="more"
        bottomInset={insets.bottom}
        colorScheme={settings.theme}
        onMoreActionPress={action => {
          if (action === 'creditCards') {
            onOpenCreditCards();
          } else if (action === 'debitCards') {
            onOpenDebitCards();
          }
        }}
        onTabPress={handleTabPress}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 32,
  },
  backIcon: {
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 32,
  },
  bellIcon: {
    fontSize: 11,
    fontWeight: '900',
  },
  content: {
    alignSelf: 'center',
    gap: 32,
    maxWidth: 672,
    paddingHorizontal: 20,
    width: '100%',
  },
  footer: {
    alignItems: 'center',
    gap: 4,
    opacity: 0.64,
    paddingBottom: 10,
    paddingTop: 10,
  },
  footerText: {
    fontSize: 12,
    fontWeight: '800',
  },
  footerTextSmall: {
    fontSize: 10,
    fontWeight: '700',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  profileMark: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  profileMarkText: {
    fontSize: 12,
    fontWeight: '900',
  },
  screen: {
    flex: 1,
  },
  title: {
    flex: 1,
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 36,
  },
  topBar: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    left: 0,
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
  topRightControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
});
