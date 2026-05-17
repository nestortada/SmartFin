import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { SettingsPalette } from './primitives';

type SettingsHeroCardProps = {
  palette: SettingsPalette;
};

export function SettingsHeroCard({ palette }: SettingsHeroCardProps) {
  return (
    <View
      style={[
        styles.heroCard,
        { backgroundColor: palette.cardStrong, borderColor: palette.border },
      ]}>
      {/* Visual background gradient liquid glow circle */}
      <View style={[styles.heroGlow, { backgroundColor: palette.primarySoft }]} />

      <View style={styles.heroContent}>
        {/* Shield with heart container */}
        <View
          style={[
            styles.heroIcon,
            { backgroundColor: palette.tertiarySoft, borderColor: 'rgba(0, 228, 117, 0.25)' },
          ]}>
          <Text style={[styles.heroIconText, { color: palette.tertiary }]}>
            🛡️
          </Text>
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
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 20,
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
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  heroGlow: {
    borderRadius: 60,
    height: 120,
    opacity: 0.8,
    position: 'absolute',
    right: -20,
    top: -20,
    width: 120,
    zIndex: 1,
  },
  heroIcon: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  heroIconText: {
    fontSize: 24,
    fontWeight: '900',
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
  },
});
