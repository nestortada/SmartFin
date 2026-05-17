import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { DashboardPalette } from '../DashboardScreen';

type RecentTransactionsBannerProps = {
  palette: DashboardPalette;
  recentTransactionCount: number;
};

export function RecentTransactionsBanner({
  palette,
  recentTransactionCount,
}: RecentTransactionsBannerProps) {
  return (
    <View
      style={[
        styles.recentCard,
        { backgroundColor: palette.primarySoft, borderColor: palette.border },
      ]}>
      <View>
        <Text style={[styles.sectionKicker, { color: palette.primary }]}>
          Últimos 30 días
        </Text>
        <Text style={[styles.recentTitle, { color: palette.text }]}>
          Transacciones recientes
        </Text>
      </View>
      <Text style={[styles.recentCount, { color: palette.tertiary }]}>
        {recentTransactionCount}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  recentCard: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 18,
  },
  recentCount: {
    fontSize: 34,
    fontWeight: '800',
  },
  recentTitle: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
  },
  sectionKicker: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});
