import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatCurrency } from '../../../shared/utils/formatCurrency';
import { getDashboardSummary } from '../useCases/getDashboardSummary';

const bottomNavigationItems = [
  {
    id: 'home',
    icon: '⌂',
    label: 'Inicio',
    isActive: true,
  },
  {
    id: 'transactions',
    icon: '▤',
    label: 'Movimientos',
    isActive: false,
  },
  {
    id: 'budgets',
    icon: '▣',
    label: 'Presupuestos',
    isActive: false,
  },
  {
    id: 'net-worth',
    icon: '↗',
    label: 'Patrimonio',
    isActive: false,
  },
  {
    id: 'more',
    icon: '•••',
    label: 'Más',
    isActive: false,
  },
];

export function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const summary = getDashboardSummary();
  const metrics = [
    {
      id: 'income',
      label: 'Ingresos del mes',
      value: formatCurrency(summary.monthlyIncome, summary.currency),
      tone: styles.positiveAccent,
    },
    {
      id: 'expenses',
      label: 'Gastos del mes',
      value: formatCurrency(summary.monthlyExpenses, summary.currency),
      tone: styles.warningAccent,
    },
    {
      id: 'savings',
      label: 'Ahorro neto',
      value: formatCurrency(summary.monthlySavings, summary.currency),
      tone: styles.primaryAccent,
    },
    {
      id: 'debt',
      label: 'Deuda total',
      value: formatCurrency(summary.totalDebt, summary.currency),
      tone: styles.secondaryAccent,
    },
  ];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 112 },
        ]}
        style={styles.scrollView}>
        <View style={styles.header}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>SF</Text>
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.brand}>SmartFin</Text>
            <Text style={styles.headerCaption}>Finanzas privadas en COP</Text>
          </View>
          <View style={styles.currencyPill}>
            <Text style={styles.currencyPillText}>{summary.currency}</Text>
          </View>
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroGlow} />
          <Text style={styles.panelLabel}>Patrimonio neto</Text>
          <Text style={styles.netWorth}>
            {formatCurrency(summary.netWorth, summary.currency)}
          </Text>
          <View style={styles.availablePanel}>
            <View>
              <Text style={styles.availableLabel}>Saldo disponible</Text>
              <Text style={styles.availableValue}>
                {formatCurrency(summary.availableBalance, summary.currency)}
              </Text>
            </View>
            <View style={styles.localBadge}>
              <Text style={styles.localBadgeText}>Local</Text>
            </View>
          </View>
        </View>

        <View style={styles.metricsGrid}>
          {metrics.map(metric => (
            <View key={metric.id} style={styles.metricCard}>
              <View style={[styles.metricAccent, metric.tone]} />
              <Text style={styles.metricLabel}>{metric.label}</Text>
              <Text style={styles.metricValue}>{metric.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.recentCard}>
          <View>
            <Text style={styles.sectionKicker}>Últimos 30 días</Text>
            <Text style={styles.recentTitle}>Transacciones recientes</Text>
          </View>
          <Text style={styles.recentCount}>{summary.recentTransactionCount}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Módulos principales</Text>
          <View style={styles.modulesList}>
            {summary.modules.map(module => (
              <View key={module.id} style={styles.moduleCard}>
                <View style={styles.moduleDot} />
                <View style={styles.moduleCopy}>
                  <Text style={styles.moduleTitle}>{module.title}</Text>
                  <Text style={styles.moduleDescription}>
                    {module.description}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.bottomNavigation,
          { paddingBottom: Math.max(insets.bottom, 10) },
        ]}>
        {bottomNavigationItems.map(item => (
          <View key={item.id} style={styles.bottomNavigationItem}>
            <View
              style={[
                styles.bottomNavigationIcon,
                item.isActive ? styles.bottomNavigationIconActive : null,
              ]}>
              <Text
                style={[
                  styles.bottomNavigationIconText,
                  item.isActive ? styles.bottomNavigationIconTextActive : null,
                ]}>
                {item.icon}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.bottomNavigationLabel,
                item.isActive ? styles.bottomNavigationLabelActive : null,
              ]}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#131314',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    gap: 22,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: '#201f20',
    borderColor: 'rgba(187, 195, 255, 0.28)',
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  brandMarkText: {
    color: '#bbc3ff',
    fontSize: 15,
    fontWeight: '800',
  },
  headerCopy: {
    flex: 1,
  },
  brand: {
    color: '#e5e2e3',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },
  headerCaption: {
    color: '#c5c5d9',
    fontSize: 13,
    lineHeight: 18,
  },
  currencyPill: {
    backgroundColor: 'rgba(187, 195, 255, 0.14)',
    borderColor: 'rgba(187, 195, 255, 0.28)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  currencyPillText: {
    color: '#bbc3ff',
    fontSize: 12,
    fontWeight: '800',
  },
  heroCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 30,
    borderWidth: 1,
    gap: 10,
    overflow: 'hidden',
    padding: 24,
  },
  heroGlow: {
    backgroundColor: 'rgba(187, 195, 255, 0.16)',
    borderRadius: 80,
    height: 120,
    position: 'absolute',
    right: -40,
    top: -38,
    width: 120,
  },
  panelLabel: {
    color: '#c5c5d9',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  netWorth: {
    color: '#f1f0ff',
    fontSize: 40,
    fontWeight: '800',
    lineHeight: 48,
  },
  availablePanel: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    padding: 16,
  },
  availableLabel: {
    color: '#c5c5d9',
    fontSize: 13,
    fontWeight: '700',
  },
  availableValue: {
    color: '#e5e2e3',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
  },
  localBadge: {
    backgroundColor: 'rgba(0, 228, 117, 0.14)',
    borderColor: 'rgba(0, 228, 117, 0.28)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  localBadgeText: {
    color: '#00e475',
    fontSize: 12,
    fontWeight: '800',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.075)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 22,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    gap: 9,
    minHeight: 122,
    padding: 18,
  },
  metricAccent: {
    borderRadius: 999,
    height: 4,
    width: 34,
  },
  positiveAccent: {
    backgroundColor: '#00e475',
  },
  warningAccent: {
    backgroundColor: '#ffb4ab',
  },
  primaryAccent: {
    backgroundColor: '#bbc3ff',
  },
  secondaryAccent: {
    backgroundColor: '#cdbdff',
  },
  metricLabel: {
    color: '#c5c5d9',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  metricValue: {
    color: '#f1f0ff',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  recentCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(61, 90, 254, 0.18)',
    borderColor: 'rgba(187, 195, 255, 0.24)',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 18,
  },
  sectionKicker: {
    color: '#bbc3ff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  recentTitle: {
    color: '#f1f0ff',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
  },
  recentCount: {
    color: '#00e475',
    fontSize: 34,
    fontWeight: '800',
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: '#e5e2e3',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  modulesList: {
    gap: 10,
  },
  moduleCard: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  moduleDot: {
    backgroundColor: '#bbc3ff',
    borderRadius: 999,
    height: 10,
    marginTop: 6,
    width: 10,
  },
  moduleCopy: {
    flex: 1,
    gap: 3,
  },
  moduleTitle: {
    color: '#f1f0ff',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  moduleDescription: {
    color: '#c5c5d9',
    fontSize: 14,
    lineHeight: 21,
  },
  bottomNavigation: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#252427',
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1,
    borderRadius: 34,
    bottom: 10,
    flexDirection: 'row',
    gap: 2,
    justifyContent: 'space-between',
    left: 12,
    maxWidth: 520,
    paddingHorizontal: 10,
    paddingTop: 12,
    position: 'absolute',
    right: 12,
    shadowColor: '#000000',
    shadowOffset: {
      height: 12,
      width: 0,
    },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 18,
  },
  bottomNavigationItem: {
    alignItems: 'center',
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  bottomNavigationIcon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 48,
  },
  bottomNavigationIconActive: {
    backgroundColor: '#c7c0ff',
  },
  bottomNavigationIconText: {
    color: '#9f9da6',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 22,
  },
  bottomNavigationIconTextActive: {
    color: '#001d93',
  },
  bottomNavigationLabel: {
    color: '#aaa7b1',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
    maxWidth: 82,
  },
  bottomNavigationLabelActive: {
    color: '#ffffff',
  },
});
