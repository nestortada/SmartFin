import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { parseCivilDate } from '../../useCases/recurrence';
import { subscriptionDate } from '../../useCases/subscriptionPresentation';
import {
  Sheet,
  SButton,
  SIcon,
  SText,
  s,
  useSubscriptionPalette,
} from '../subscriptionDesign';

export function CivilDateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const p = useSubscriptionPalette();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value.slice(0, 7));
  let display = value;
  try {
    display = subscriptionDate(value, true);
  } catch {
    /* Preserve invalid text for correction. */
  }
  const validMonth =
    /^\d{4}-\d{2}$/.test(month) &&
    Number(month.slice(0, 4)) >= 1 &&
    Number(month.slice(5)) >= 1 &&
    Number(month.slice(5)) <= 12;
  const first = validMonth ? parseCivilDate(`${month}-01`) : new Date();
  const year = first.getUTCFullYear();
  const m = first.getUTCMonth();
  const count = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
  const blanks = (first.getUTCDay() + 6) % 7;
  const shift = (offset: number) => {
    const next = new Date(Date.UTC(year, m + offset, 1));
    setMonth(next.toISOString().slice(0, 7));
  };
  return (
    <>
      <SText style={s.label}>{label}</SText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          setMonth(value.slice(0, 7));
          setOpen(true);
        }}
        style={[
          s.input,
          s.between,
          { backgroundColor: p.card, borderColor: p.border },
        ]}
      >
        <SText style={s.flex}>{display}</SText>
        <SIcon name="calendar-today" />
      </Pressable>
      {open ? (
        <Sheet title={label} onClose={() => setOpen(false)}>
          <SText>También puedes escribir una fecha YYYY-MM-DD.</SText>
          <TextInput
            accessibilityLabel="Fecha YYYY-MM-DD"
            value={value}
            onChangeText={onChange}
            style={[s.input, { borderColor: p.border, color: p.text }]}
            placeholder="2026-10-15"
          />
          <View style={s.between}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mes anterior"
              style={s.iconButton}
              onPress={() => shift(-1)}
            >
              <SIcon name="chevron-left" />
            </Pressable>
            <SText>{month}</SText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mes siguiente"
              style={s.iconButton}
              onPress={() => shift(1)}
            >
              <SIcon name="chevron-right" />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(day => (
              <View
                key={day}
                style={{
                  width: '14.28%',
                  alignItems: 'center',
                  paddingVertical: 8,
                }}
              >
                <SText style={s.label}>{day}</SText>
              </View>
            ))}
            {Array.from({ length: blanks }, (_, index) => (
              <View key={`blank-${index}`} style={{ width: '14.28%' }} />
            ))}
            {Array.from({ length: count }, (_, index) => index + 1).map(day => {
              const date = `${month}-${String(day).padStart(2, '0')}`;
              return (
                <Pressable
                  key={day}
                  accessibilityRole="button"
                  accessibilityLabel={date}
                  accessibilityState={{ selected: date === value }}
                  onPress={() => {
                    onChange(date);
                    setOpen(false);
                  }}
                  style={{
                    width: '14.28%',
                    minHeight: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 12,
                    backgroundColor: date === value ? p.primary : undefined,
                  }}
                >
                  <SText
                    style={{ color: date === value ? p.onPrimary : p.text }}
                  >
                    {day}
                  </SText>
                </Pressable>
              );
            })}
          </View>
          <SButton label="Usar fecha" onPress={() => setOpen(false)} />
        </Sheet>
      ) : null}
    </>
  );
}
