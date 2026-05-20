import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { formatCurrency } from '../../../../shared/utils/formatCurrency';
import type { Account } from '../../../accounts';
import type { CreditCardSummary } from '../../types';
import type { CreditCardsPalette } from '../creditCardUiTypes';

export function CreditCardPaymentAction({
  card,
  onPress,
  palette,
  saving,
}: {
  card: CreditCardSummary;
  onPress: () => void;
  palette: CreditCardsPalette;
  saving: boolean;
}) {
  const disabled = saving || card.usedCredit <= 0;

  return (
    <View style={[styles.paymentActionCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={styles.paymentActionTextBlock}>
        <Text style={[styles.overline, { color: palette.muted }]}>Pago de tarjeta</Text>
        <Text style={[styles.paymentActionBody, { color: palette.text }]}>
          Saldo pendiente: {formatCurrency(card.usedCredit, card.account.currency)}
        </Text>
      </View>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={[
          styles.paymentActionButton,
          {
            backgroundColor: disabled ? palette.cardStrong : palette.primaryStrong,
            opacity: disabled ? 0.62 : 1,
          },
        ]}>
        <Text style={[styles.paymentActionButtonText, { color: disabled ? palette.muted : palette.text }]}>
          Pago de tarjeta de credito
        </Text>
      </Pressable>
    </View>
  );
}

export function CreditCardPaymentModal({
  accounts,
  amount,
  card,
  onAmountChange,
  onClose,
  onSave,
  onSelectAccount,
  palette,
  saving,
  selectedAccountId,
  visible,
}: {
  accounts: Account[];
  amount: string;
  card?: CreditCardSummary;
  onAmountChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onSelectAccount: (accountId: string) => void;
  palette: CreditCardsPalette;
  saving: boolean;
  selectedAccountId?: string;
  visible: boolean;
}) {
  if (!card) {
    return null;
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.paymentModalBackdrop}>
        <View style={[styles.paymentModalSheet, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <View style={styles.paymentModalHeader}>
            <View style={styles.paymentModalTitleBlock}>
              <Text style={[styles.paymentModalTitle, { color: palette.text }]}>Pago de tarjeta</Text>
              <Text style={[styles.paymentModalSubtitle, { color: palette.muted }]}>
                Registra el pago sin sumarlo como gasto del mes.
              </Text>
            </View>
            <Pressable onPress={onClose} style={[styles.closeButton, { borderColor: palette.border }]}>
              <Text style={[styles.closeButtonText, { color: palette.muted }]}>x</Text>
            </Pressable>
          </View>

          <View style={[styles.paymentSummaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.overline, { color: palette.muted }]}>Tarjeta</Text>
            <Text style={[styles.paymentSummaryTitle, { color: palette.text }]}>{card.account.name}</Text>
            <Text style={[styles.paymentSummaryBody, { color: palette.muted }]}>
              Deuda actual: {formatCurrency(card.usedCredit, card.account.currency)}
            </Text>
          </View>

          <View style={styles.paymentInputGroup}>
            <Text style={[styles.inputLabel, { color: palette.primary }]}>Monto del pago</Text>
            <View style={[styles.paymentInputShell, { borderColor: palette.border }]}>
              <Text style={[styles.inputPrefix, { color: palette.muted }]}>$</Text>
              <TextInput
                keyboardType="number-pad"
                onChangeText={onAmountChange}
                placeholder="0"
                placeholderTextColor={palette.muted}
                style={[styles.paymentInput, { color: palette.text }]}
                value={amount}
              />
            </View>
          </View>

          <View style={styles.paymentAccountsBlock}>
            <Text style={[styles.inputLabel, { color: palette.primary }]}>Cuenta origen</Text>
            {accounts.map(account => {
              const active = account.id === selectedAccountId;

              return (
                <Pressable
                  key={account.id}
                  onPress={() => onSelectAccount(account.id)}
                  style={[
                    styles.paymentAccountOption,
                    {
                      backgroundColor: active ? palette.cardStrong : palette.card,
                      borderColor: active ? palette.primary : palette.border,
                    },
                  ]}>
                  <View style={styles.paymentAccountText}>
                    <Text style={[styles.paymentAccountName, { color: palette.text }]}>{account.name}</Text>
                    <Text style={[styles.paymentAccountBalance, { color: palette.muted }]}>
                      {formatCurrency(account.balance.amount, account.currency)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.paymentAccountRadio,
                      { borderColor: active ? palette.primary : palette.border },
                      active ? { backgroundColor: palette.primary } : null,
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>

          <Pressable
            disabled={saving}
            onPress={onSave}
            style={[styles.paymentSaveButton, { backgroundColor: palette.primaryStrong, opacity: saving ? 0.6 : 1 }]}>
            <Text style={[styles.paymentSaveButtonText, { color: palette.text }]}>
              {saving ? 'Registrando...' : 'Registrar pago'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  overline: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  paymentAccountBalance: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  paymentAccountName: {
    fontSize: 15,
    fontWeight: '900',
  },
  paymentAccountOption: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 14,
  },
  paymentAccountRadio: {
    borderRadius: 8,
    borderWidth: 2,
    height: 16,
    width: 16,
  },
  paymentAccountText: {
    flex: 1,
    minWidth: 0,
  },
  paymentAccountsBlock: {
    gap: 10,
  },
  paymentActionBody: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 21,
    marginTop: 4,
  },
  paymentActionButton: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  paymentActionButtonText: {
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  paymentActionCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
    padding: 16,
  },
  paymentActionTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  paymentInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '900',
    minWidth: 0,
    paddingVertical: 10,
  },
  paymentInputGroup: {
    gap: 8,
  },
  paymentInputShell: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 54,
    paddingHorizontal: 14,
  },
  paymentModalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.62)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  paymentModalHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  paymentModalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    gap: 18,
    maxHeight: '90%',
    padding: 20,
  },
  paymentModalSubtitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 4,
  },
  paymentModalTitle: {
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 30,
  },
  paymentModalTitleBlock: {
    flex: 1,
    paddingRight: 12,
  },
  paymentSaveButton: {
    alignItems: 'center',
    borderRadius: 18,
    justifyContent: 'center',
    minHeight: 56,
  },
  paymentSaveButtonText: {
    fontSize: 18,
    fontWeight: '900',
  },
  paymentSummaryBody: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 4,
  },
  paymentSummaryCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  paymentSummaryTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 4,
  },
});
