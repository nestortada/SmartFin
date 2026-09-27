import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';

import type { DashboardPalette } from '../DashboardScreen';

type DashboardHeaderProps = {
  currency: string;
  onOpenAiAssistant: () => void;
  palette: DashboardPalette;
};

export function DashboardHeader({ currency, onOpenAiAssistant, palette }: DashboardHeaderProps) {
  return (
    <View style={styles.header}>
      <View
        style={[
          styles.brandMark,
          { backgroundColor: palette.cardStrong, borderColor: palette.border },
        ]}>
        <Text style={[styles.brandMarkText, { color: palette.primary }]}>
          SF
        </Text>
      </View>
      <View style={styles.headerCopy}>
        <Text style={[styles.brand, { color: palette.text }]}>SmartFin</Text>
        <Text style={[styles.headerCaption, { color: palette.muted }]}>
          Finanzas privadas en COP
        </Text>
      </View>
      <View style={styles.headerActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onOpenAiAssistant}
          style={[styles.aiButton, { backgroundColor: palette.primary, borderColor: palette.primary }]}>
          <Text style={styles.aiButtonText}>Hablar con IA</Text>
        </Pressable>
        <View
          style={[
            styles.currencyPill,
            { backgroundColor: palette.primarySoft, borderColor: palette.border },
          ]}>
          <Text style={[styles.currencyPillText, { color: palette.primary }]}>
            {currency}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  aiButton: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  aiButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  brand: {
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },
  brandMark: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  brandMarkText: {
    fontSize: 15,
    fontWeight: '800',
  },
  currencyPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  currencyPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  headerCaption: {
    fontSize: 13,
    lineHeight: 18,
  },
  headerCopy: {
    flex: 1,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
});
