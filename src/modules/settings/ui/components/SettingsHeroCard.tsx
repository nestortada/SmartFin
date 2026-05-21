import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';

import type { SettingsPalette } from './primitives';

type SettingsHeroCardProps = {
  palette: SettingsPalette;
};

export function SettingsHeroCard({ palette }: SettingsHeroCardProps) {
  return (
    <View
      style={[
        styles.heroCard,
        {
          backgroundColor: palette.cardStrong,
          borderColor: palette.border,
          borderLeftColor: 'rgba(255, 255, 255, 0.05)',
          borderTopColor: 'rgba(255, 255, 255, 0.1)',
        },
      ]}>
      <View style={[styles.heroGlow, { backgroundColor: palette.primary }]} />
      <View style={styles.heroContent}>
        <View
          style={[
            styles.heroIcon,
            {
              backgroundColor: palette.tertiarySoft,
              borderColor: 'rgba(0, 228, 117, 0.2)',
            },
          ]}>
          <MaterialIcons
            name="verified-user"
            size={32}
            color={palette.tertiary}
          />
        </View>

        <View style={styles.heroCopy}>
          <Text style={[styles.heroTitle, { color: palette.text }]}>
            Privacidad Total
          </Text>
          <Text style={[styles.heroDescription, { color: palette.muted }]}>
            Tus datos nunca salen de este dispositivo. Todo el procesamiento financiero es 100% on-device y cifrado.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: 24,
    paddingVertical: 28,
    position: 'relative',
  },
  heroContent: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
    zIndex: 2,
  },
  heroCopy: {
    flex: 1,
    gap: 4,
  },
  heroDescription: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  heroGlow: {
    borderRadius: 64,
    height: 128,
    opacity: 0.1,
    position: 'absolute',
    right: -16,
    top: -16,
    width: 128,
  },
  heroIcon: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 28,
  },
});
