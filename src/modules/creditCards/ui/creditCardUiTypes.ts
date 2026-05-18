export type CreditCardsPalette = {
  background: string;
  border: string;
  card: string;
  cardStrong: string;
  danger: string;
  dangerSoft: string;
  inverseText: string;
  muted: string;
  primary: string;
  primaryStrong: string;
  secondary: string;
  surface: string;
  tertiary: string;
  text: string;
};

export type CreditCardFormMode = 'create' | 'edit';

export type CreditCardFormState = {
  annualEffectiveInterestRate: string;
  bankName: string;
  closingDay: string;
  creditLimit: string;
  lastFourDigits: string;
  managementFee: string;
  name: string;
  paymentDay: string;
};

export const EMPTY_FORM_STATE: CreditCardFormState = {
  annualEffectiveInterestRate: '',
  bankName: '',
  closingDay: '',
  creditLimit: '',
  lastFourDigits: '',
  managementFee: '',
  name: '',
  paymentDay: '',
};
