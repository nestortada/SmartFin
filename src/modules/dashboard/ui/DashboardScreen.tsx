import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ModulePlaceholder } from '../../../shared/components/ModulePlaceholder';
import { formatCurrency } from '../../../shared/utils/formatCurrency';
import { getDashboardSummary } from '../useCases/getDashboardSummary';

export function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const summary = getDashboardSummary();

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}
      style={styles.screen}>
      <Text style={styles.eyebrow}>SmartFin</Text>
      <Text style={styles.title}>Finanzas personales, local-first</Text>

      <View style={styles.summaryPanel}>
        <Text style={styles.panelLabel}>Balance estimado</Text>
        <Text style={styles.balance}>
          {formatCurrency(summary.currentBalance, summary.currency)}
        </Text>
        <Text style={styles.panelCaption}>
          Tus datos viven primero en el dispositivo. La sincronizacion puede
          agregarse mas adelante sin mezclarla con la UI.
        </Text>
      </View>

      <View style={styles.grid}>
        {summary.modules.map(module => (
          <ModulePlaceholder
            key={module.id}
            description={module.description}
            title={module.title}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f6f7f9',
  },
  content: {
    paddingHorizontal: 20,
    gap: 18,
  },
  eyebrow: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    color: '#111827',
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
  },
  summaryPanel: {
    backgroundColor: '#111827',
    borderRadius: 8,
    padding: 20,
    gap: 8,
  },
  panelLabel: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
  balance: {
    color: '#ffffff',
    fontSize: 36,
    fontWeight: '800',
  },
  panelCaption: {
    color: '#d1d5db',
    fontSize: 14,
    lineHeight: 20,
  },
  grid: {
    gap: 12,
  },
});
