import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatCurrency } from '../../../../shared/utils/formatCurrency';
import type { CurrencyCode } from '../../../../shared/types';
import type { DashboardPalette } from '../DashboardScreen';

type Metric = {
  id: string;
  label: string;
  value: string;
  tone: { backgroundColor: string };
};

type MetricsGridProps = {
  currency: CurrencyCode;
  monthlyExpenses: number;
  monthlyIncome: number;
  monthlySavings: number;
  palette: DashboardPalette;
  totalDebt: number;
};

export function MetricsGrid({
  currency,
  monthlyExpenses,
  monthlyIncome,
  monthlySavings,
  palette,
  totalDebt,
}: MetricsGridProps) {
  const metrics: Metric[] = [
    {
      id: 'income',
      label: 'Ingresos del mes',
      value: formatCurrency(monthlyIncome, currency),
      tone: { backgroundColor: palette.tertiary },
    },
    {
      id: 'expenses',
      label: 'Gastos del mes',
      value: formatCurrency(monthlyExpenses, currency),
      tone: { backgroundColor: palette.danger },
    },
    {
      id: 'savings',
      label: 'Ahorro neto',
      value: formatCurrency(monthlySavings, currency),
      tone: { backgroundColor: palette.primary },
    },
    {
      id: 'debt',
      label: 'Deuda total',
      value: formatCurrency(totalDebt, currency),
      tone: { backgroundColor: palette.secondary },
    },
  ];

  return (
    <View style={styles.metricsGrid}>
      {metrics.map(metric => (
        <View
          key={metric.id}
          style={[
            styles.metricCard,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}>
          <View style={[styles.metricAccent, metric.tone]} />
          <Text style={[styles.metricLabel, { color: palette.muted }]}>
            {metric.label}
          </Text>
          <Text style={[styles.metricValue, { color: palette.text }]}>
            {metric.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  metricAccent: {
    borderRadius: 999,
    height: 4,
    width: 34,
  },
  metricCard: {
    borderRadius: 22,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    gap: 9,
    minHeight: 122,
    padding: 18,
  },
  metricLabel: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
});
