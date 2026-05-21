import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';

import type { AppTheme } from '../../types';
import {
  SegmentButton,
  SettingsRow,
  SettingsSection,
  type SettingsPalette,
} from './primitives';

type PersonalizationSectionProps = {
  palette: SettingsPalette;
  theme: AppTheme;
  onDeleteFinancialData: () => void;
  onOpenCategories: () => void;
  onThemeChange: (theme: AppTheme) => Promise<void>;
};

export function PersonalizationSection({
  palette,
  theme,
  onDeleteFinancialData,
  onOpenCategories,
  onThemeChange,
}: PersonalizationSectionProps) {
  return (
    <SettingsSection palette={palette} title={'Personalizaci\u00f3n'}>
      <Pressable onPress={onOpenCategories}>
        <SettingsRow
          icon={<MaterialIcons name="category" size={24} color={palette.muted} />}
          label={'Administrar categor\u00edas'}
          palette={palette}
          trailing={<MaterialIcons name="chevron-right" size={24} color={palette.muted} />}
        />
      </Pressable>

      <View style={styles.divider} />

      <SettingsRow
        icon={<MaterialIcons name="dark-mode" size={24} color={palette.muted} />}
        label="Tema de la App"
        palette={palette}
        trailing={
          <View
            style={[
              styles.segmentedControl,
              { backgroundColor: '#201f20', borderColor: palette.border },
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

      <Pressable onPress={onDeleteFinancialData} style={styles.dangerRow}>
        <View style={styles.dangerLabelWrap}>
          <MaterialIcons name="delete-forever" size={24} color={palette.danger} />
          <Text style={[styles.dangerText, { color: palette.danger }]}>
            Eliminar datos financieros
          </Text>
        </View>
        <MaterialIcons name="chevron-right" size={24} color={palette.danger} style={{ opacity: 0.5 }} />
      </Pressable>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  chevron: {
    fontSize: 22,
    fontWeight: '500',
  },
  dangerIcon: {
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 24,
    marginRight: 16,
    textAlign: 'center',
    width: 24,
  },
  dangerLabelWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  dangerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dangerText: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 24,
  },
  divider: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    height: 1,
  },
  segmentedControl: {
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2,
    padding: 3,
  },
});
