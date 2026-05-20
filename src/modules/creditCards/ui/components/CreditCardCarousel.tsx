import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { CreditCardSummary } from '../../types';
import type { CreditCardsPalette } from '../creditCardUiTypes';
import {
  CREDIT_CARD_PREVIEW_DIMENSIONS,
  CreditCardPreview,
} from './CreditCardPreview';

type CreditCardCarouselProps = {
  cards: CreditCardSummary[];
  onAddCard: () => void;
  onCardPress: (card: CreditCardSummary) => void;
  palette: CreditCardsPalette;
  selectedCardId?: string;
};

export function CreditCardCarousel({
  cards,
  onAddCard,
  onCardPress,
  palette,
  selectedCardId,
}: CreditCardCarouselProps) {
  return (
    <View style={styles.carouselContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cardSelector}>
        {cards.map((card, index) => {
          const isSelected = card.account.id === selectedCardId;

          return (
            <Pressable
              key={card.account.id}
              onPress={() => onCardPress(card)}
              style={[
                styles.creditCardPreview,
                {
                  backgroundColor: isSelected ? palette.cardStrong : palette.card,
                  borderColor: isSelected ? palette.primary : palette.border,
                  borderWidth: isSelected ? 2 : 1,
                  opacity: isSelected ? 1 : 0.78,
                  shadowColor: isSelected ? palette.primary : '#000000',
                  shadowOpacity: isSelected ? 0.26 : 0.12,
                  shadowRadius: isSelected ? 16 : 8,
                  shadowOffset: { width: 0, height: isSelected ? 10 : 4 },
                  elevation: isSelected ? 10 : 3,
                },
              ]}>
              <CreditCardPreview card={card} isPrimary={index === 0} palette={palette} />
            </Pressable>
          );
        })}

        <Pressable
          onPress={onAddCard}
          style={[
            styles.addCardBtn,
            {
              borderColor: palette.border,
              backgroundColor: 'rgba(255,255,255,0.02)',
            },
          ]}>
          <Text style={[styles.addCardIcon, { color: palette.muted }]}>+</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  addCardBtn: {
    alignItems: 'center',
    borderRadius: 22,
    borderStyle: 'dashed',
    borderWidth: 2,
    height: CREDIT_CARD_PREVIEW_DIMENSIONS.compactHeight,
    justifyContent: 'center',
    width: 64,
  },
  addCardIcon: {
    fontSize: 24,
    fontWeight: '300',
  },
  cardSelector: {
    gap: 12,
    paddingBottom: 8,
    paddingHorizontal: 20,
  },
  carouselContainer: {
    marginHorizontal: -20,
  },
  creditCardPreview: {
    borderRadius: 22,
    borderWidth: 1,
    height: CREDIT_CARD_PREVIEW_DIMENSIONS.compactHeight,
    justifyContent: 'space-between',
    overflow: 'hidden',
    padding: 16,
    width: CREDIT_CARD_PREVIEW_DIMENSIONS.compactWidth,
  },
});
