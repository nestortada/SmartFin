import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';

import {
  SegmentButton,
  SettingsRow,
  SettingsSection,
  type SettingsPalette,
} from './primitives';
import type { AppTheme } from '../../types';

type PersonalizationSectionProps = {
  palette: SettingsPalette;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => Promise<void>;
  onDeleteFinancialData: () => void;
};

export function PersonalizationSection({
  palette,
  theme,
  onThemeChange,
  onDeleteFinancialData,
}: PersonalizationSectionProps) {
  const isDark = theme === 'dark';

  return (
    <SettingsSection palette={palette} title="Personalización">
      {/* Tema de la App Row */}
      <SettingsRow
        icon="🌙"
        label="Tema de la App"
        palette={palette}
        trailing={
          <View
            style={[
              styles.segmentedControl,
              { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderColor: palette.border },
            ]}>
            <SegmentButton
              isActive={theme === 'dark'}
              label="Oscuro"
              onPress={() => { void onThemeChange('dark'); }}
              palette={palette}
            />
            <SegmentButton
              isActive={theme === 'light'}
              label="Claro"
              onPress={() => { void onThemeChange('light'); }}
              palette={palette}
            />
          </View>
        }
      />

      <View style={styles.divider} />

      {/* Eliminar datos financieros Row (Danger action item in same card) */}
      <Pressable onPress={onDeleteFinancialData} style={styles.dangerRow}>
        <View style={styles.dangerLabelWrap}>
          <Text style={styles.dangerIcon}>🗑️</Text>
          <Text style={[styles.dangerText, { color: palette.danger }]}>
            Eliminar datos financieros
          </Text>
        </View>
        <Text style={[styles.chevron, { color: palette.danger }]}>›</Text>
      </Pressable>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  chevron: {
    fontSize: 22,
    fontWeight: '300',
  },
  dangerIcon: {
    fontSize: 20,
    marginRight: 12,
    textAlign: 'center',
    width: 30,
  },
  dangerLabelWrap: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  dangerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 2,
  },
  dangerText: {
    fontSize: 16,
    fontWeight: '700',
  },
  divider: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    height: 1,
    marginHorizontal: 8,
  },
  segmentedControl: {
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2,
    padding: 3,
  },
});
