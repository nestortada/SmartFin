import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CreditCardSummary } from '../../types';
import { parseCreditCardVisualMetadata } from '../../useCases';
import {
  getDisplayLastDigits,
  parseMoneyInput,
  parseCreditLimitInput,
} from '../creditCardFormatters';
import type {
  CreditCardFormState,
  CreditCardsPalette,
} from '../creditCardUiTypes';

type CreditCardPreviewProps = {
  card: CreditCardSummary;
  isPrimary?: boolean;
  palette: CreditCardsPalette;
  variant?: 'compact' | 'form';
};

export function CreditCardPreview({
  card,
  isPrimary = false,
  palette,
  variant = 'compact',
}: CreditCardPreviewProps) {
  const metadata = parseCreditCardVisualMetadata(card.account.description);
  const isForm = variant === 'form';

  return (
    <>
      <View style={[styles.glow, styles.glowPrimary, { backgroundColor: palette.primary }]} />
      <View style={[styles.glow, styles.glowSecondary, { backgroundColor: palette.secondary }]} />
      <View style={[styles.orb, { borderColor: palette.primary }]} />
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={[styles.overline, { color: palette.muted }]}>
            {isPrimary ? 'SMARTFIN PLATINUM' : 'SMARTFIN CARD'}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.name, isForm ? styles.nameForm : undefined, { color: palette.text }]}>
            {card.account.name}
          </Text>
          <Text numberOfLines={1} style={[styles.bank, { color: palette.muted }]}>
            {card.account.institutionName || 'Banco de la tarjeta'}
          </Text>
        </View>
        <View style={[styles.contactlessRing, { borderColor: palette.primary }]}>
          <Text style={[styles.contactlessText, { color: palette.primary }]}>)))</Text>
        </View>
      </View>
      <View style={styles.footer}>
        <View style={styles.footerText}>
          <Text style={[styles.number, { color: palette.text }]}>
            **** **** **** {getDisplayLastDigits(card)}
          </Text>
          <Text style={[styles.dates, { color: palette.muted }]}>
            CORTE {metadata.closingDay ?? '--'} / PAGO {metadata.paymentDay ?? '--'}
          </Text>
        </View>
        <View style={[styles.chip, { backgroundColor: 'rgba(255,255,255,0.14)', borderColor: palette.border }]} />
      </View>
    </>
  );
}

export function buildPreviewCardFromForm(form: CreditCardFormState): CreditCardSummary {
  return {
    account: {
      id: 'form-preview',
      balance: { amount: 0, currency: 'COP' },
      createdAt: '',
      creditLimit: { amount: parseCreditLimitInput(form.creditLimit), currency: 'COP' },
      currency: 'COP',
      debtBalance: { amount: 0, currency: 'COP' },
      description: `smartfin:credit-card:${JSON.stringify({
        closingDay: Number(form.closingDay) || undefined,
        lastFourDigits: form.lastFourDigits,
        managementFee: parseMoneyInput(form.managementFee) || undefined,
        paymentDay: Number(form.paymentDay) || undefined,
      })}`,
      institutionName: form.bankName,
      name: form.name || 'Nombre del Titular',
      status: 'active',
      type: 'creditCard',
      updatedAt: '',
    },
    availableCredit: parseCreditLimitInput(form.creditLimit),
    installments: [],
    minimumPaymentSimulation: {
      additionalInterest: 0,
      amortizable: true,
      balance: 0,
      minimumPayment: 0,
      monthlyInterestRate: 0,
    },
    nextPaymentAmount: 0,
    recentTransactions: [],
    totalLimit: parseCreditLimitInput(form.creditLimit),
    usedCredit: 0,
    utilizationRatio: 0,
  };
}

export const CREDIT_CARD_PREVIEW_DIMENSIONS = {
  compactHeight: 136,
  compactWidth: 264,
  formHeight: 164,
};

const styles = StyleSheet.create({
  bank: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  chip: {
    borderRadius: 7,
    borderWidth: 1,
    height: 28,
    width: 44,
  },
  contactlessRing: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 3,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  contactlessText: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -4,
    marginLeft: -4,
    transform: [{ rotate: '90deg' }],
  },
  dates: {
    fontSize: 10,
    fontWeight: '900',
    marginTop: 5,
  },
  footer: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 1,
  },
  footerText: {
    flex: 1,
    paddingRight: 8,
  },
  glow: {
    opacity: 0.17,
    position: 'absolute',
  },
  glowPrimary: {
    borderRadius: 54,
    height: 108,
    right: -28,
    top: -28,
    width: 108,
  },
  glowSecondary: {
    borderRadius: 48,
    bottom: -28,
    height: 96,
    left: -30,
    width: 96,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 1,
  },
  name: {
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 24,
    marginTop: 4,
  },
  nameForm: {
    fontSize: 23,
    lineHeight: 29,
  },
  number: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  orb: {
    borderRadius: 48,
    borderWidth: 28,
    height: 96,
    opacity: 0.12,
    position: 'absolute',
    right: -12,
    top: -28,
    width: 96,
  },
  overline: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  titleBlock: {
    flex: 1,
    paddingRight: 12,
  },
});
