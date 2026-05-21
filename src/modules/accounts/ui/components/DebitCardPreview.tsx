import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatCurrency } from '../../../../shared/utils/formatCurrency';
import type { DebitCardSummary } from '../../useCases';
import { debitCardsStyles as styles } from '../debitCardsStyles';
import type { DebitCardsPalette } from '../debitCardsPalette';

type DebitCardPreviewProps = {
  card: DebitCardSummary;
  onPress: () => void;
  palette: DebitCardsPalette;
  selected: boolean;
};

export function DebitCardPreview({
  card,
  onPress,
  palette,
  selected,
}: DebitCardPreviewProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.debitCard,
        {
          backgroundColor: palette.card,
          borderColor: selected ? palette.primary : palette.border,
        },
      ]}>
      <View style={styles.cardGlowPrimary} />
      <View style={styles.cardGlowSecondary} />
      <View style={styles.cardTopRow}>
        <View>
          <Text style={[styles.cardBrand, { color: palette.text }]}>SmartFin</Text>
          <Text style={[styles.cardType, { color: palette.muted }]}>Debito Gold</Text>
        </View>
        <Text style={[styles.contactless, { color: palette.muted }]}>)))</Text>
      </View>
      <View style={styles.cardChip} />
      <View style={styles.cardBottomRow}>
        <View>
          <Text style={[styles.cardNumber, { color: palette.text }]}>{card.maskedNumber}</Text>
          <Text style={[styles.cardHolder, { color: palette.muted }]} numberOfLines={1}>
            {card.account.name}
          </Text>
        </View>
        <Text style={[styles.cardBalance, { color: palette.tertiary }]}>
          {formatCurrency(card.account.balance.amount, card.account.currency)}
        </Text>
      </View>
    </Pressable>
  );
}
