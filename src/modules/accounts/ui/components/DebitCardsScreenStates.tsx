import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { formatCurrency } from '../../../../shared/utils/formatCurrency';
import { debitCardsStyles as styles } from '../debitCardsStyles';
import type { DebitCardsPalette } from '../debitCardsPalette';

type DebitCardsHeaderProps = {
  onOpenSettings: () => void;
  palette: DebitCardsPalette;
  totalAvailable: number;
};

export function DebitCardsHeader({
  onOpenSettings,
  palette,
  totalAvailable,
}: DebitCardsHeaderProps) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={[styles.eyebrow, { color: palette.muted }]}>Saldo total disponible</Text>
        <Text
          adjustsFontSizeToFit
          numberOfLines={1}
          style={[styles.totalBalance, { color: palette.text }]}>
          {formatCurrency(totalAvailable, 'COP')}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onOpenSettings}
        style={[styles.roundButton, { borderColor: palette.border }]}>
        <Text style={[styles.roundButtonText, { color: palette.primary }]}>AJ</Text>
      </Pressable>
    </View>
  );
}

export function DebitCardsLoadingState({ palette }: { palette: DebitCardsPalette }) {
  return (
    <View style={styles.statusRow}>
      <ActivityIndicator color={palette.primary} size="small" />
      <Text style={[styles.statusText, { color: palette.muted }]}>Cargando tarjetas...</Text>
    </View>
  );
}

export function DebitCardsErrorState({
  error,
  palette,
}: {
  error: string;
  palette: DebitCardsPalette;
}) {
  return <Text style={[styles.statusText, { color: palette.danger }]}>{error}</Text>;
}

export function DebitCardsEmptyState({ palette }: { palette: DebitCardsPalette }) {
  return (
    <View style={[styles.emptyCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <Text style={[styles.emptyTitle, { color: palette.text }]}>No hay tarjetas debito</Text>
      <Text style={[styles.emptyText, { color: palette.muted }]}>
        Crea una cuenta bancaria o de ahorro para verla aqui.
      </Text>
    </View>
  );
}
