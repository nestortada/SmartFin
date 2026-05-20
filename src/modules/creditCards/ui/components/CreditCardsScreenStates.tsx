import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { CreditCardSummary } from '../../types';
import type { CreditCardsPalette } from '../creditCardUiTypes';

export function CreditCardsHeader({ palette }: { palette: CreditCardsPalette }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View style={[styles.avatar, { backgroundColor: palette.primaryStrong, borderColor: palette.border }]}>
          <Text style={[styles.avatarText, { color: palette.text }]}>SF</Text>
        </View>
        <View>
          <Text style={[styles.appName, { color: palette.primary }]}>SmartFin</Text>
          <Text style={[styles.screenLabel, { color: palette.muted }]}>Tarjetas de credito</Text>
        </View>
      </View>
      <View style={[styles.headerIcon, { borderColor: palette.border }]}>
        <Text style={[styles.headerIconText, { color: palette.primary }]}>!</Text>
      </View>
    </View>
  );
}

export function CreditCardsLoadingState({
  loading,
  palette,
}: {
  loading: boolean;
  palette: CreditCardsPalette;
}) {
  if (!loading) {
    return null;
  }

  return (
    <View style={styles.loadingRow}>
      <ActivityIndicator color={palette.primary} size="small" />
      <Text style={[styles.loadingText, { color: palette.muted }]}>Cargando tarjetas...</Text>
    </View>
  );
}

export function CreditCardsErrorState({
  error,
  palette,
}: {
  error?: string;
  palette: CreditCardsPalette;
}) {
  if (!error) {
    return null;
  }

  return (
    <View style={[styles.statusCard, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
      <Text style={[styles.statusText, { color: palette.danger }]}>{error}</Text>
    </View>
  );
}

export function CreditCardsEmptyState({
  loading,
  palette,
  selectedCard,
}: {
  loading: boolean;
  palette: CreditCardsPalette;
  selectedCard?: CreditCardSummary;
}) {
  if (loading || selectedCard) {
    return null;
  }

  return (
    <View style={[styles.emptyCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <Text style={[styles.emptyTitle, { color: palette.text }]}>No hay tarjetas activas</Text>
      <Text style={[styles.emptyBody, { color: palette.muted }]}>
        Agrega una cuenta de tipo tarjeta de credito para ver cupo, cuotas y pagos.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  appName: {
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 32,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '900',
  },
  emptyBody: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 21,
  },
  emptyCard: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 8,
    padding: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerIcon: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerIconText: {
    fontSize: 18,
    fontWeight: '900',
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 6,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '700',
  },
  screenLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 1,
    textTransform: 'uppercase',
  },
  statusCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 19,
  },
});
