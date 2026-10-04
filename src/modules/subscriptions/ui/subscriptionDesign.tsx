import React, { createContext, useContext } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextProps,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import type { AppTheme } from '../../settings';
import { STATUS_LABELS } from '../useCases/subscriptionPresentation';
import type { SubscriptionStatus, OccurrenceStatus } from '../types';

const palettes = {
  dark: {
    background: '#131314',
    card: '#201f20',
    raised: '#2a2a2b',
    text: '#e5e2e3',
    muted: '#c5c5d9',
    primary: '#bbc3ff',
    onPrimary: '#001d93',
    secondary: '#cdbdff',
    green: '#00e475',
    danger: '#ffb4ab',
    border: '#444656',
    tint: '#282941',
  },
  light: {
    background: '#f8f7fb',
    card: '#ffffff',
    raised: '#efedf6',
    text: '#19191d',
    muted: '#686678',
    primary: '#2848ee',
    onPrimary: '#ffffff',
    secondary: '#5203d5',
    green: '#007f3e',
    danger: '#a93932',
    border: '#dedce6',
    tint: '#e7eaff',
  },
};
const DesignContext = createContext(palettes.dark);
export function SubscriptionDesign({
  theme,
  children,
}: {
  theme: AppTheme;
  children: React.ReactNode;
}) {
  return (
    <DesignContext.Provider value={palettes[theme]}>
      {children}
    </DesignContext.Provider>
  );
}
export const useSubscriptionPalette = () => useContext(DesignContext);
export function SText({ style, ...props }: TextProps) {
  const p = useSubscriptionPalette();
  return <Text {...props} style={[s.text, { color: p.text }, style]} />;
}
export function SIcon({
  name,
  color,
  size = 22,
}: {
  name: string;
  color?: string;
  size?: number;
}) {
  const p = useSubscriptionPalette();
  return (
    <Icon
      name={name}
      size={size}
      color={color ?? p.primary}
      accessible={false}
    />
  );
}
export function Card({
  children,
  tint = false,
}: {
  children: React.ReactNode;
  tint?: boolean;
}) {
  const p = useSubscriptionPalette();
  return (
    <View style={[s.card, { backgroundColor: tint ? p.tint : p.card }]}>
      {children}
    </View>
  );
}
export function SButton({
  label,
  onPress,
  icon,
  disabled = false,
  secondary = false,
  danger = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const p = useSubscriptionPalette();
  const color = danger ? p.danger : secondary ? p.primary : p.onPrimary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor: danger ? p.raised : secondary ? p.raised : p.primary,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {icon ? <SIcon name={icon} color={color} /> : null}
      <SText style={[s.buttonText, { color }]}>{label}</SText>
    </Pressable>
  );
}
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const p = useSubscriptionPalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[s.chip, { backgroundColor: selected ? p.primary : p.raised }]}
    >
      <SText style={[s.label, { color: selected ? p.onPrimary : p.muted }]}>
        {label}
      </SText>
    </Pressable>
  );
}
export function Status({
  status,
}: {
  status: SubscriptionStatus | OccurrenceStatus;
}) {
  const p = useSubscriptionPalette();
  const color = ['active', 'paid'].includes(status)
    ? p.green
    : status === 'overdue'
    ? p.danger
    : p.muted;
  const name = ['active', 'paid'].includes(status)
    ? 'check-circle'
    : status === 'overdue'
    ? 'error-outline'
    : status === 'paused'
    ? 'pause-circle-outline'
    : status === 'pending'
    ? 'schedule'
    : 'remove-circle-outline';
  return (
    <View style={[s.status, { backgroundColor: p.raised }]}>
      <SIcon name={name} size={15} color={color} />
      <SText style={[s.label, { color }]}>{STATUS_LABELS[status]}</SText>
    </View>
  );
}
export function Message({
  text,
  action,
  onPress,
  error = false,
}: {
  text: string;
  action?: string;
  onPress?: () => void;
  error?: boolean;
}) {
  const p = useSubscriptionPalette();
  return (
    <Card>
      <View style={s.row}>
        <SIcon
          name={error ? 'error-outline' : 'info-outline'}
          color={error ? p.danger : p.primary}
        />
        <SText
          accessibilityLiveRegion="polite"
          style={[s.flex, { color: error ? p.danger : p.muted }]}
        >
          {text}
        </SText>
      </View>
      {action && onPress ? (
        <SButton label={action} secondary onPress={onPress} />
      ) : null}
    </Card>
  );
}
export function QueryState({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading: boolean;
  error?: string;
  empty?: string;
  onRetry: () => void;
}) {
  if (loading)
    return (
      <View style={s.loading}>
        <ActivityIndicator />
        <SText>Cargando…</SText>
      </View>
    );
  if (error)
    return <Message text={error} error action="Reintentar" onPress={onRetry} />;
  return empty ? <Message text={empty} /> : null;
}
export function Sheet({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const p = useSubscriptionPalette();
  return (
    <Modal
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.overlay}
      >
        <View
          accessibilityViewIsModal
          style={[s.sheet, { backgroundColor: p.background }]}
        >
          <View style={s.row}>
            <SText style={[s.title, s.flex]}>{title}</SText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
              disabled={busy}
              onPress={onClose}
              style={s.iconButton}
            >
              <SIcon name="close" />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.sheetContent}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export const s = StyleSheet.create({
  text: { fontFamily: 'Manrope-Regular', fontSize: 14, lineHeight: 21 },
  title: { fontFamily: 'Manrope-Bold', fontSize: 22, lineHeight: 30 },
  heading: { fontFamily: 'Manrope-Bold', fontSize: 18, lineHeight: 26 },
  money: {
    fontFamily: 'Manrope-ExtraBold',
    fontSize: 32,
    lineHeight: 42,
    fontVariant: ['tabular-nums'],
  },
  amount: {
    fontFamily: 'Manrope-Bold',
    fontSize: 19,
    lineHeight: 26,
    fontVariant: ['tabular-nums'],
  },
  label: { fontFamily: 'Manrope-SemiBold', fontSize: 12, lineHeight: 18 },
  eyebrow: {
    fontFamily: 'Manrope-SemiBold',
    fontSize: 11,
    letterSpacing: 0.8,
    lineHeight: 18,
  },
  root: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 16,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  flex: { flex: 1 },
  stack: { gap: 10 },
  card: { borderRadius: 24, padding: 18, gap: 12 },
  button: {
    minHeight: 46,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: {
    fontFamily: 'Manrope-Bold',
    fontSize: 14,
    lineHeight: 22,
    flexShrink: 1,
    textAlign: 'center',
  },
  chip: {
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  status: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceIcon: {
    height: 48,
    width: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { padding: 24, gap: 12, alignItems: 'center' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '92%',
    paddingTop: 16,
    paddingHorizontal: 20,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  sheetContent: { gap: 16, paddingBottom: 40, paddingTop: 16 },
  input: {
    fontFamily: 'Manrope-Regular',
    fontSize: 16,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  field: { gap: 8 },
  divider: { height: 1 },
});
