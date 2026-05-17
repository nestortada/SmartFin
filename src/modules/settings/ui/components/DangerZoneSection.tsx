import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PressableMotion, SettingsSection, type SettingsPalette } from './primitives';

type DangerZoneSectionProps = {
  palette: SettingsPalette;
  onDeleteFinancialData: () => void;
};

export function DangerZoneSection({
  palette,
  onDeleteFinancialData,
}: DangerZoneSectionProps) {
  return (
    <SettingsSection palette={palette} title="Zona De Peligro">
      <PressableMotion onPress={onDeleteFinancialData}>
        <View
          style={[
            styles.dangerRow,
            {
              backgroundColor: palette.dangerSoft,
              borderColor: palette.danger,
            },
          ]}>
          <View style={[styles.dangerIconWrap, { backgroundColor: palette.dangerSoft }]}>
            <Text style={[styles.dangerIcon, { color: palette.danger }]}>⚠</Text>
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowLabel, { color: palette.danger }]}>
              Eliminar datos financieros
            </Text>
            <Text style={[styles.rowSupporting, { color: palette.muted }]}>
              Borra cuentas, movimientos, SMS y presupuestos. Conserva tema y seguridad.
            </Text>
          </View>
        </View>
      </PressableMotion>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  dangerIcon: {
    fontSize: 18,
    fontWeight: '900',
  },
  dangerIconWrap: {
    alignItems: 'center',
    borderRadius: 12,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  dangerRow: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  rowCopy: {
    flex: 1,
    gap: 3,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  rowSupporting: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
});
