import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  type DebitCardFormInput,
  type DebitCardIncomeFrequency,
  type DebitCardIncomeType,
} from '../../useCases';
import { debitCardsStyles as styles } from '../debitCardsStyles';
import type { DebitCardsPalette } from '../debitCardsPalette';

type DebitCardFormModalProps = {
  input: DebitCardFormInput;
  onChange: (input: DebitCardFormInput) => void;
  onClose: () => void;
  onSave: () => void;
  palette: DebitCardsPalette;
  saving: boolean;
  visible: boolean;
};

export function DebitCardFormModal({
  input,
  onChange,
  onClose,
  onSave,
  palette,
  saving,
  visible,
}: DebitCardFormModalProps) {
  const recurringIncome = input.recurringIncome ?? {
    amount: 0,
    frequency: 'none' as DebitCardIncomeFrequency,
    incomeType: 'salary' as DebitCardIncomeType,
  };
  const updateRecurringIncome = (nextIncome: Partial<NonNullable<DebitCardFormInput['recurringIncome']>>) => {
    onChange({
      ...input,
      recurringIncome: {
        ...recurringIncome,
        ...nextIncome,
      },
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.formSheet, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <View style={styles.formHeader}>
            <Text style={[styles.formTitle, { color: palette.text }]}>
              {input.accountId ? 'Modificar tarjeta debito' : 'Agregar tarjeta debito'}
            </Text>
            <Pressable accessibilityRole="button" onPress={onClose}>
              <Text style={[styles.formClose, { color: palette.muted }]}>x</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            <FormField
              label="Nombre"
              onChangeText={name => onChange({ ...input, name })}
              palette={palette}
              placeholder="Ej: Debito principal"
              value={input.name}
            />
            <FormField
              label="Banco"
              onChangeText={bankName => onChange({ ...input, bankName })}
              palette={palette}
              placeholder="Ej: Bancolombia"
              value={input.bankName ?? ''}
            />
            <FormField
              keyboardType="number-pad"
              label="Saldo actual"
              onChangeText={value => onChange({ ...input, currentBalance: parseMoneyInput(value) })}
              palette={palette}
              placeholder="0"
              value={input.currentBalance ? String(Math.round(input.currentBalance)) : ''}
            />

            <Text style={[styles.formSectionTitle, { color: palette.text }]}>Ingreso programado</Text>
            <SegmentedOptions
              options={[
                { label: 'No', value: 'none' },
                { label: '15 dias', value: 'biweekly' },
                { label: 'Mensual', value: 'monthly' },
                { label: 'Dia fijo', value: 'specificDay' },
              ]}
              onSelect={value => updateRecurringIncome({ frequency: value as DebitCardIncomeFrequency })}
              palette={palette}
              selected={recurringIncome.frequency}
            />
            {recurringIncome.frequency !== 'none' ? (
              <>
                <SegmentedOptions
                  options={[
                    { label: 'Salario', value: 'salary' },
                    { label: 'Mesada', value: 'allowance' },
                    { label: 'Negocio', value: 'business' },
                    { label: 'Otro', value: 'other' },
                  ]}
                  onSelect={value => updateRecurringIncome({ incomeType: value as DebitCardIncomeType })}
                  palette={palette}
                  selected={recurringIncome.incomeType}
                />
                <FormField
                  keyboardType="number-pad"
                  label="Monto esperado"
                  onChangeText={value => updateRecurringIncome({ amount: parseMoneyInput(value) })}
                  palette={palette}
                  placeholder="0"
                  value={recurringIncome.amount ? String(Math.round(recurringIncome.amount)) : ''}
                />
                {recurringIncome.frequency === 'specificDay' ? (
                  <FormField
                    keyboardType="number-pad"
                    label="Dia del mes"
                    onChangeText={value => updateRecurringIncome({ dayOfMonth: clampDay(Number(value) || 1) })}
                    palette={palette}
                    placeholder="1"
                    value={String(recurringIncome.dayOfMonth ?? 1)}
                  />
                ) : null}
              </>
            ) : null}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={onSave}
            style={[styles.saveButton, { backgroundColor: palette.primary }]}>
            <Text style={[styles.saveButtonText, { color: palette.inverseText }]}>
              {saving ? 'Guardando...' : 'Guardar tarjeta'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function FormField({
  keyboardType,
  label,
  onChangeText,
  palette,
  placeholder,
  value,
}: {
  keyboardType?: 'default' | 'number-pad';
  label: string;
  onChangeText: (value: string) => void;
  palette: DebitCardsPalette;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={[styles.formField, { borderColor: palette.border }]}>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
      <TextInput
        keyboardType={keyboardType ?? 'default'}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        style={[styles.formInput, { color: palette.text }]}
        value={value}
      />
    </View>
  );
}

function SegmentedOptions({
  onSelect,
  options,
  palette,
  selected,
}: {
  onSelect: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  palette: DebitCardsPalette;
  selected: string;
}) {
  return (
    <View style={styles.segmentedRow}>
      {options.map(option => (
        <Pressable
          accessibilityRole="button"
          key={option.value}
          onPress={() => onSelect(option.value)}
          style={[
            styles.segmentedButton,
            {
              backgroundColor: selected === option.value ? palette.primary : palette.card,
              borderColor: selected === option.value ? palette.primary : palette.border,
            },
          ]}>
          <Text
            adjustsFontSizeToFit
            numberOfLines={1}
            style={[
              styles.segmentedText,
              { color: selected === option.value ? palette.inverseText : palette.text },
            ]}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function parseMoneyInput(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}

function clampDay(day: number): number {
  return Math.min(31, Math.max(1, day));
}
