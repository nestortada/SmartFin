import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatCurrency } from '../../../../shared/utils/formatCurrency';
import type { CurrencyCode } from '../../../../shared/types';
import type { DashboardPalette } from '../DashboardScreen';

type NetWorthCardProps = {
  availableBalance: number;
  currency: CurrencyCode;
  netWorth: number;
  palette: DashboardPalette;
};

export function NetWorthCard({
  availableBalance,
  currency,
  netWorth,
  palette,
}: NetWorthCardProps) {
  return (
    <View
      style={[
        styles.heroCard,
        { backgroundColor: palette.cardStrong, borderColor: palette.border },
      ]}>
      <View
        style={[styles.heroGlow, { backgroundColor: palette.primarySoft }]}
      />
      <Text style={[styles.panelLabel, { color: palette.muted }]}>
        Patrimonio neto
      </Text>
      <Text style={[styles.netWorth, { color: palette.text }]}>
        {formatCurrency(netWorth, currency)}
      </Text>
      <View
        style={[
          styles.availablePanel,
          { backgroundColor: palette.card, borderColor: palette.border },
        ]}>
        <View>
          <Text style={[styles.availableLabel, { color: palette.muted }]}>
            Saldo disponible
          </Text>
          <Text style={[styles.availableValue, { color: palette.text }]}>
            {formatCurrency(availableBalance, currency)}
          </Text>
        </View>
        <View style={styles.localBadge}>
          <Text style={styles.localBadgeText}>Local</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  availableLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  availablePanel: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    padding: 16,
  },
  availableValue: {
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
  },
  heroCard: {
    borderRadius: 30,
    borderWidth: 1,
    gap: 10,
    overflow: 'hidden',
    padding: 24,
  },
  heroGlow: {
    borderRadius: 80,
    height: 120,
    position: 'absolute',
    right: -40,
    top: -38,
    width: 120,
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
    color: '#00a552',
    fontSize: 12,
    fontWeight: '800',
  },
  netWorth: {
    fontSize: 40,
    fontWeight: '800',
    lineHeight: 48,
  },
  panelLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
