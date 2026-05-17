/**
 * Shared primitive UI components for the Settings module.
 * Re-exported here so section files stay clean.
 */
import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export type SettingsPalette = {
  background: string;
  border: string;
  card: string;
  cardStrong: string;
  danger: string;
  dangerSoft: string;
  inverseText: string;
  muted: string;
  primary: string;
  primarySoft: string;
  secondary: string;
  secondarySoft: string;
  tertiary: string;
  tertiarySoft: string;
  text: string;
};

// ─── usePressMotion ───────────────────────────────────────────────────────────

function usePressMotion() {
  const scale = useRef(new Animated.Value(1)).current;

  return {
    animatedStyle: { transform: [{ scale }] },
    pressIn: () => {
      Animated.spring(scale, {
        friction: 7,
        tension: 130,
        toValue: 0.96,
        useNativeDriver: true,
      }).start();
    },
    pressOut: () => {
      Animated.spring(scale, {
        friction: 6,
        tension: 120,
        toValue: 1,
        useNativeDriver: true,
      }).start();
    },
  };
}

// ─── PressableMotion ──────────────────────────────────────────────────────────

export function PressableMotion({
  children,
  onPress,
}: {
  children: React.ReactNode;
  onPress?: () => void;
}) {
  const motion = usePressMotion();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={motion.pressIn}
      onPressOut={motion.pressOut}>
      <Animated.View style={motion.animatedStyle}>{children}</Animated.View>
    </Pressable>
  );
}

// ─── SettingsSection ──────────────────────────────────────────────────────────

export function SettingsSection({
  children,
  palette,
  title,
}: {
  children: React.ReactNode;
  palette: SettingsPalette;
  title: string;
}) {
  return (
    <View style={primitiveStyles.section}>
      <Text style={[primitiveStyles.sectionTitle, { color: palette.primary }]}>
        {title}
      </Text>
      <View
        style={[
          primitiveStyles.sectionCard,
          { backgroundColor: palette.cardStrong, borderColor: palette.border },
        ]}>
        {children}
      </View>
    </View>
  );
}

// ─── SettingsRow ──────────────────────────────────────────────────────────────

export function SettingsRow({
  icon,
  label,
  palette,
  supportingText,
  trailing,
}: {
  icon: string;
  label: string;
  palette: SettingsPalette;
  supportingText?: string;
  trailing: React.ReactNode;
}) {
  return (
    <View style={primitiveStyles.row}>
      <Text style={[primitiveStyles.rowIcon, { color: palette.muted }]}>
        {icon}
      </Text>
      <View style={primitiveStyles.rowCopy}>
        <Text style={[primitiveStyles.rowLabel, { color: palette.text }]}>
          {label}
        </Text>
        {supportingText ? (
          <Text style={[primitiveStyles.rowSupporting, { color: palette.muted }]}>
            {supportingText}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

// ─── GlassButton ─────────────────────────────────────────────────────────────

export function GlassButton({
  label,
  onPress,
  palette,
  variant = 'soft',
}: {
  label: string;
  onPress: () => void;
  palette: SettingsPalette;
  variant?: 'filled' | 'soft';
}) {
  return (
    <PressableMotion onPress={onPress}>
      <View
        style={[
          primitiveStyles.glassButton,
          {
            backgroundColor:
              variant === 'filled' ? palette.primary : palette.primarySoft,
            borderColor: palette.border,
          },
        ]}>
        <Text
          style={[
            primitiveStyles.glassButtonText,
            {
              color:
                variant === 'filled' ? palette.inverseText : palette.primary,
            },
          ]}>
          {label}
        </Text>
      </View>
    </PressableMotion>
  );
}

// ─── SegmentButton ────────────────────────────────────────────────────────────

export function SegmentButton({
  isActive,
  label,
  onPress,
  palette,
}: {
  isActive: boolean;
  label: string;
  onPress: () => void;
  palette: SettingsPalette;
}) {
  return (
    <PressableMotion onPress={onPress}>
      <View
        style={[
          primitiveStyles.segmentButton,
          isActive
            ? { backgroundColor: palette.primarySoft }
            : { backgroundColor: 'transparent' },
        ]}>
        <Text
          style={[
            primitiveStyles.segmentButtonText,
            { color: isActive ? palette.primary : palette.muted },
          ]}>
          {label}
        </Text>
      </View>
    </PressableMotion>
  );
}

// ─── StatusPill ───────────────────────────────────────────────────────────────

export function StatusPill({
  palette,
  text,
  tone,
}: {
  palette: SettingsPalette;
  text: string;
  tone: 'danger' | 'primary';
}) {
  const color = tone === 'danger' ? palette.danger : palette.primary;
  const backgroundColor =
    tone === 'danger' ? palette.dangerSoft : palette.primarySoft;

  return (
    <View style={[primitiveStyles.statusPill, { backgroundColor, borderColor: color }]}>
      <Text style={[primitiveStyles.statusPillText, { color }]}>{text}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

export const primitiveStyles = StyleSheet.create({
  glassButton: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  glassButtonText: {
    fontSize: 12,
    fontWeight: '900',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 58,
  },
  rowCopy: {
    flex: 1,
    gap: 3,
  },
  rowIcon: {
    fontSize: 21,
    fontWeight: '900',
    textAlign: 'center',
    width: 30,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  rowSupporting: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  section: {
    gap: 10,
  },
  sectionCard: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
    paddingLeft: 8,
    textTransform: 'uppercase',
  },
  segmentButton: {
    alignItems: 'center',
    borderRadius: 999,
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  segmentButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
});
