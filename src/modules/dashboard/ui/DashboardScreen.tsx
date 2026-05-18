import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation, type BottomNavigationTab } from '../../../shared/components';
import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import type { AppTheme } from '../../settings';
import { useDashboardSummary } from '../hooks/useDashboardSummary';

import { DashboardHeader } from './components/DashboardHeader';
import { MetricsGrid } from './components/MetricsGrid';
import { ModuleList } from './components/ModuleList';
import { NetWorthCard } from './components/NetWorthCard';
import { RecentTransactionsBanner } from './components/RecentTransactionsBanner';

export type DashboardPalette = {
  background: string;
  card: string;
  cardStrong: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primarySoft: string;
  secondary: string;
  tertiary: string;
  danger: string;
};

const palettes: Record<AppTheme, DashboardPalette> = {
  dark: {
    background: '#131314',
    border: 'rgba(255, 255, 255, 0.12)',
    card: 'rgba(255, 255, 255, 0.075)',
    cardStrong: 'rgba(255, 255, 255, 0.09)',
    danger: '#ffb4ab',
    muted: '#c5c5d9',
    primary: '#bbc3ff',
    primarySoft: 'rgba(187, 195, 255, 0.16)',
    secondary: '#cdbdff',
    tertiary: '#00e475',
    text: '#f1f0ff',
  },
  light: {
    background: '#f8f7fb',
    border: 'rgba(35, 42, 65, 0.12)',
    card: 'rgba(255, 255, 255, 0.78)',
    cardStrong: 'rgba(255, 255, 255, 0.92)',
    danger: '#a93932',
    muted: '#686678',
    primary: '#2848ee',
    primarySoft: 'rgba(61, 90, 254, 0.12)',
    secondary: '#5203d5',
    tertiary: '#007f3e',
    text: '#19191d',
  },
};

type DashboardScreenProps = {
  activeTheme: AppTheme;
  database?: SmartFinSQLiteDatabase;
  refreshKey?: number;
  onOpenCreditCards: () => void;
  onOpenSettings: () => void;
  onNavigateToTransactions: () => void;
};

export function DashboardScreen({
  activeTheme,
  database,
  refreshKey = 0,
  onOpenCreditCards,
  onOpenSettings,
  onNavigateToTransactions,
}: DashboardScreenProps) {
  const insets = useSafeAreaInsets();
  const palette = palettes[activeTheme];
  const { summary, loading, error } = useDashboardSummary(database, refreshKey);

  const handleTabPress = (tab: BottomNavigationTab) => {
    if (tab === 'more') {
      onOpenSettings();
    } else if (tab === 'transactions') {
      onNavigateToTransactions();
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 112 },
        ]}
        style={styles.scrollView}>

        <DashboardHeader currency={summary.currency} palette={palette} />

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator
              color={palette.primary}
              size="small"
            />
            <Text style={[styles.loadingText, { color: palette.muted }]}>
              Actualizando…
            </Text>
          </View>
        ) : null}

        {error ? (
          <View
            style={[
              styles.errorPill,
              { backgroundColor: 'rgba(255,100,100,0.10)', borderColor: palette.danger },
            ]}>
            <Text style={[styles.errorText, { color: palette.danger }]}>
              {error}
            </Text>
          </View>
        ) : null}

        <NetWorthCard
          availableBalance={summary.availableBalance}
          currency={summary.currency}
          netWorth={summary.netWorth}
          palette={palette}
        />

        <MetricsGrid
          currency={summary.currency}
          monthlyExpenses={summary.monthlyExpenses}
          monthlyIncome={summary.monthlyIncome}
          monthlySavings={summary.monthlySavings}
          palette={palette}
          totalDebt={summary.totalDebt}
        />

        <RecentTransactionsBanner
          palette={palette}
          recentTransactionCount={summary.recentTransactionCount}
        />

        <ModuleList modules={summary.modules} palette={palette} />
      </ScrollView>

      <BottomNavigation
        activeTab="home"
        bottomInset={insets.bottom}
        colorScheme={activeTheme}
        onMoreActionPress={action => {
          if (action === 'creditCards') {
            onOpenCreditCards();
          } else {
            onOpenSettings();
          }
        }}
        onTabPress={handleTabPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: 'center',
    gap: 22,
    maxWidth: 520,
    paddingHorizontal: 20,
    width: '100%',
  },
  errorPill: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 4,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  screen: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
});
