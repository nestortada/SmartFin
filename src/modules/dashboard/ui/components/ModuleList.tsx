import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { DashboardModuleSummary } from '../../types/DashboardSummary';
import type { DashboardPalette } from '../DashboardScreen';

type ModuleListProps = {
  modules: DashboardModuleSummary[];
  palette: DashboardPalette;
};

export function ModuleList({ modules, palette }: ModuleListProps) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.text }]}>
        Módulos principales
      </Text>
      <View style={styles.modulesList}>
        {modules.map(module => (
          <View
            key={module.id}
            style={[
              styles.moduleCard,
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}>
            <View
              style={[styles.moduleDot, { backgroundColor: palette.primary }]}
            />
            <View style={styles.moduleCopy}>
              <Text style={[styles.moduleTitle, { color: palette.text }]}>
                {module.title}
              </Text>
              <Text
                style={[styles.moduleDescription, { color: palette.muted }]}>
                {module.description}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  moduleCard: {
    alignItems: 'flex-start',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  moduleCopy: {
    flex: 1,
    gap: 3,
  },
  moduleDescription: {
    fontSize: 14,
    lineHeight: 21,
  },
  moduleDot: {
    borderRadius: 999,
    height: 10,
    marginTop: 6,
    width: 10,
  },
  moduleTitle: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  modulesList: {
    gap: 10,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
});
