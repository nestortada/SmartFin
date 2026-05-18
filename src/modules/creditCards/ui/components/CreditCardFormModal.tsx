import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  formatCreditLimitInput,
  formatMoneyInput,
  formatPercentageInput,
} from '../creditCardFormatters';
import type {
  CreditCardFormMode,
  CreditCardFormState,
  CreditCardsPalette,
} from '../creditCardUiTypes';
import {
  buildPreviewCardFromForm,
  CreditCardPreview,
  CREDIT_CARD_PREVIEW_DIMENSIONS,
} from './CreditCardPreview';

type CreditCardFormModalProps = {
  form: CreditCardFormState;
  mode: CreditCardFormMode;
  onChange: (form: CreditCardFormState) => void;
  onClose: () => void;
  onDelete: () => void;
  onSave: () => void;
  palette: CreditCardsPalette;
  saving: boolean;
  visible: boolean;
};

export function CreditCardFormModal({
  form,
  mode,
  onChange,
  onClose,
  onDelete,
  onSave,
  palette,
  saving,
  visible,
}: CreditCardFormModalProps) {
  const update = (key: keyof CreditCardFormState, value: string) => {
    onChange({
      ...form,
      [key]: value,
    });
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalKeyboard}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: palette.background, borderColor: palette.border }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleBlock}>
                <Text style={[styles.modalTitle, { color: palette.text }]}>
                  {mode === 'create' ? 'Gestionar Tarjeta' : 'Modificar Tarjeta'}
                </Text>
                <Text style={[styles.modalSubtitle, { color: palette.muted }]}>
                  Configura tu medio de pago localmente.
                </Text>
              </View>
              <Pressable onPress={onClose} style={[styles.closeButton, { borderColor: palette.border }]}>
                <Text style={[styles.closeButtonText, { color: palette.muted }]}>x</Text>
              </Pressable>
            </View>

            <View style={[styles.formPreviewCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <CreditCardPreview
                card={buildPreviewCardFromForm(form)}
                isPrimary
                palette={palette}
                variant="form"
              />
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.formGrid}>
                <LiquidInput
                  label="Nombre de la Tarjeta"
                  onChangeText={value => update('name', value)}
                  palette={palette}
                  placeholder="Ej: Gastos Personales"
                  value={form.name}
                />
                <LiquidInput
                  label="Banco de la Tarjeta"
                  onChangeText={value => update('bankName', value)}
                  palette={palette}
                  placeholder="Selecciona Banco"
                  rightIcon="bank"
                  value={form.bankName}
                />
                <View style={styles.formTwoColumns}>
                  <LiquidInput
                    keyboardType="number-pad"
                    label="Ultimos 4 numeros"
                    maxLength={4}
                    onChangeText={value => update('lastFourDigits', value.replace(/\D/g, '').slice(0, 4))}
                    palette={palette}
                    placeholder="0000"
                    value={form.lastFourDigits}
                  />
                  <LiquidInput
                    keyboardType="number-pad"
                    label="Cupo Total"
                    onChangeText={value => update('creditLimit', formatCreditLimitInput(value))}
                    palette={palette}
                    placeholder="0"
                    prefix="$"
                    value={form.creditLimit}
                  />
                </View>
                <View style={styles.formTwoColumns}>
                  <LiquidInput
                    keyboardType="number-pad"
                    label="Fecha de Corte"
                    maxLength={2}
                    onChangeText={value => update('closingDay', value.replace(/\D/g, '').slice(0, 2))}
                    palette={palette}
                    placeholder="Dia"
                    rightIcon="cal"
                    value={form.closingDay}
                  />
                  <LiquidInput
                    keyboardType="number-pad"
                    label="Fecha de Pago"
                    maxLength={2}
                    onChangeText={value => update('paymentDay', value.replace(/\D/g, '').slice(0, 2))}
                    palette={palette}
                    placeholder="Dia"
                    rightIcon="pay"
                    value={form.paymentDay}
                  />
                </View>
                <View style={styles.formTwoColumns}>
                  <LiquidInput
                    keyboardType="decimal-pad"
                    label="Tasa E.A."
                    onChangeText={value => update('annualEffectiveInterestRate', formatPercentageInput(value))}
                    palette={palette}
                    placeholder="Ej: 34.40"
                    suffix="%"
                    value={form.annualEffectiveInterestRate}
                  />
                  <LiquidInput
                    keyboardType="number-pad"
                    label="Cuota de manejo"
                    onChangeText={value => update('managementFee', formatMoneyInput(value))}
                    palette={palette}
                    placeholder="0"
                    prefix="$"
                    value={form.managementFee}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.formActions}>
              <Pressable
                disabled={saving}
                onPress={onSave}
                style={[styles.saveButton, { backgroundColor: palette.primaryStrong, opacity: saving ? 0.6 : 1 }]}>
                <Text style={[styles.actionIcon, { color: palette.text }]}>[]</Text>
                <Text style={[styles.saveButtonText, { color: palette.text }]}>
                  {saving ? 'Guardando...' : 'Guardar Tarjeta'}
                </Text>
              </Pressable>
              {mode === 'edit' ? (
                <Pressable
                  disabled={saving}
                  onPress={onDelete}
                  style={[styles.deleteButton, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
                  <Text style={[styles.actionIcon, { color: palette.danger }]}>del</Text>
                  <Text style={[styles.deleteButtonText, { color: palette.danger }]}>Eliminar Tarjeta</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function LiquidInput({
  keyboardType,
  label,
  maxLength,
  onChangeText,
  palette,
  placeholder,
  prefix,
  rightIcon,
  suffix,
  value,
}: {
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
  label: string;
  maxLength?: number;
  onChangeText: (value: string) => void;
  palette: CreditCardsPalette;
  placeholder: string;
  prefix?: string;
  rightIcon?: string;
  suffix?: string;
  value: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={[styles.inputLabel, { color: palette.primary }]}>{label}</Text>
      <View style={[styles.inputShell, { borderBottomColor: palette.border }]}>
        {prefix ? <Text style={[styles.inputPrefix, { color: palette.muted }]}>{prefix}</Text> : null}
        <TextInput
          keyboardType={keyboardType}
          maxLength={maxLength}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.muted}
          style={[styles.liquidInput, { color: palette.text }]}
          value={value}
        />
        {rightIcon ? <Text style={[styles.inputIcon, { color: palette.muted }]}>{rightIcon}</Text> : null}
        {suffix ? <Text style={[styles.inputSuffix, { color: palette.muted }]}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionIcon: {
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  closeButtonText: {
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 20,
  },
  deleteButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    minHeight: 58,
  },
  deleteButtonText: {
    fontSize: 18,
    fontWeight: '800',
  },
  formActions: {
    gap: 14,
    paddingTop: 8,
  },
  formGrid: {
    gap: 20,
    paddingBottom: 18,
  },
  formPreviewCard: {
    borderRadius: 22,
    borderWidth: 1,
    height: CREDIT_CARD_PREVIEW_DIMENSIONS.formHeight,
    justifyContent: 'space-between',
    marginBottom: 24,
    overflow: 'hidden',
    padding: 18,
  },
  formTwoColumns: {
    flexDirection: 'row',
    gap: 14,
  },
  inputGroup: {
    flex: 1,
    gap: 8,
  },
  inputIcon: {
    fontSize: 12,
    fontWeight: '900',
    paddingLeft: 8,
    textTransform: 'uppercase',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  inputPrefix: {
    fontSize: 18,
    fontWeight: '800',
    paddingRight: 8,
  },
  inputShell: {
    alignItems: 'center',
    borderBottomWidth: 2,
    flexDirection: 'row',
    minHeight: 52,
  },
  inputSuffix: {
    fontSize: 18,
    fontWeight: '800',
    paddingLeft: 8,
  },
  liquidInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    minWidth: 0,
    paddingVertical: 10,
  },
  modalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.62)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalHandle: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 3,
    height: 5,
    marginBottom: 18,
    width: 48,
  },
  modalHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  modalKeyboard: {
    flex: 1,
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    maxHeight: '94%',
    padding: 20,
  },
  modalSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 6,
  },
  modalTitle: {
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 34,
  },
  modalTitleBlock: {
    flex: 1,
    paddingRight: 12,
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    minHeight: 58,
  },
  saveButtonText: {
    fontSize: 18,
    fontWeight: '800',
  },
});
