import type { CreditCardFormInput, CreditCardSummary } from '../types';
import { parseCreditCardVisualMetadata } from '../useCases';
import {
  EMPTY_FORM_STATE,
  type CreditCardFormState,
} from './creditCardUiTypes';

export function formatShortDate(value?: string): string {
  if (!value) {
    return '--';
  }

  const parts = value.slice(0, 10).split('-');
  if (parts.length !== 3) {
    return value;
  }

  const monthNamesReal = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const monthIndex = Number(parts[1]) - 1;

  return `${Number(parts[2])} ${monthNamesReal[monthIndex] ?? ''}`.trim();
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function getCardLastDigits(cardId: string): string {
  if (cardId.includes('visa') || cardId.includes('nu')) {
    return '4582';
  }
  if (cardId.includes('amex')) {
    return '9012';
  }

  let sum = 0;
  for (let i = 0; i < cardId.length; i++) {
    sum += cardId.charCodeAt(i);
  }

  return String(1000 + (sum % 9000));
}

export function getDisplayLastDigits(card: CreditCardSummary): string {
  return parseCreditCardVisualMetadata(card.account.description).lastFourDigits || getCardLastDigits(card.account.id);
}

export function getBillingDayText(day?: number): string {
  return day ? `Dia ${day}` : '--';
}

export function formatCreditLimitInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  return Number(digits).toLocaleString('es-CO');
}

export function parseCreditLimitInput(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}

export const formatMoneyInput = formatCreditLimitInput;

export function parseMoneyInput(value: string): number {
  return parseCreditLimitInput(value);
}

export function formatPercentageInput(value: string): string {
  const normalized = value
    .replace(/\./g, ',')
    .replace(/[^\d,]/g, '');
  const separatorIndex = normalized.indexOf(',');
  const hasSeparator = separatorIndex >= 0;
  const integerPart = (hasSeparator
    ? normalized.slice(0, separatorIndex)
    : normalized).replace(/\D/g, '');
  const decimals = hasSeparator
    ? normalized.slice(separatorIndex + 1).replace(/\D/g, '').slice(0, 2)
    : '';

  if (!integerPart && !decimals && !hasSeparator) {
    return '';
  }

  if (hasSeparator) {
    return `${integerPart || '0'},${decimals}`;
  }

  return integerPart;
}

export function parsePercentageInput(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value.replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(parsed, 0) / 100;
}

export function monthlyInterestRateToAnnualEffective(monthlyRate?: number): string {
  if (monthlyRate === undefined || !Number.isFinite(monthlyRate) || monthlyRate <= 0) {
    return '';
  }

  const annualRate = (Math.pow(1 + monthlyRate, 12) - 1) * 100;
  return annualRate.toFixed(2).replace('.', ',');
}

function formatDay(value?: number): string {
  return value ? String(value) : '';
}

export function formStateFromCard(card?: CreditCardSummary): CreditCardFormState {
  if (!card) {
    return EMPTY_FORM_STATE;
  }

  const metadata = parseCreditCardVisualMetadata(card.account.description);

  return {
    annualEffectiveInterestRate: monthlyInterestRateToAnnualEffective(
      card.minimumPaymentSimulation.monthlyInterestRate,
    ),
    bankName: card.account.institutionName ?? '',
    closingDay: formatDay(metadata.closingDay),
    creditLimit: formatCreditLimitInput(String(card.totalLimit || '')),
    lastFourDigits: metadata.lastFourDigits ?? getCardLastDigits(card.account.id),
    managementFee: metadata.managementFee ? formatMoneyInput(String(metadata.managementFee)) : '',
    name: card.account.name,
    paymentDay: formatDay(metadata.paymentDay),
  };
}

export function parseOptionalDay(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const day = Number(value);
  if (!Number.isFinite(day)) {
    return undefined;
  }

  return Math.min(Math.max(Math.trunc(day), 1), 31);
}

export function toFormInput(form: CreditCardFormState, accountId?: string): CreditCardFormInput {
  return {
    accountId,
    annualEffectiveInterestRate: parsePercentageInput(form.annualEffectiveInterestRate),
    bankName: form.bankName.trim() || undefined,
    closingDay: parseOptionalDay(form.closingDay),
    creditLimit: parseCreditLimitInput(form.creditLimit),
    lastFourDigits: form.lastFourDigits.replace(/\D/g, '').slice(0, 4) || undefined,
    managementFee: form.managementFee ? parseMoneyInput(form.managementFee) : undefined,
    name: form.name.trim(),
    paymentDay: parseOptionalDay(form.paymentDay),
  };
}
