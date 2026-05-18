import type { CurrencyCode, ISODateString } from '../../../shared/types';
import type { Account } from '../../accounts';

export type CreditCardStatementStatus = 'open' | 'pending' | 'paid' | 'overdue' | 'closed';

export type CreditCardStatement = {
  id: string;
  accountId: string;
  statementStartDate: ISODateString;
  statementEndDate: ISODateString;
  paymentDueDate: ISODateString;
  totalAmount: number;
  minimumPaymentAmount?: number;
  currency: CurrencyCode;
  status: CreditCardStatementStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type InstallmentPurchaseStatus = 'active' | 'paid' | 'cancelled';

export type InstallmentPurchase = {
  id: string;
  transactionId: string;
  accountId: string;
  merchantName?: string;
  totalAmount: number;
  currency: CurrencyCode;
  installmentCount: number;
  paidInstallments: number;
  monthlyAmount: number;
  firstDueDate?: ISODateString;
  status: InstallmentPurchaseStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type CreditCardProfile = {
  accountId: string;
  monthlyInterestRate: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type CreditCardVisualMetadata = {
  closingDay?: number;
  lastFourDigits?: string;
  managementFee?: number;
  paymentDay?: number;
};

export type CreditCardFormInput = {
  accountId?: string;
  annualEffectiveInterestRate?: number;
  bankName?: string;
  closingDay?: number;
  creditLimit: number;
  lastFourDigits?: string;
  managementFee?: number;
  name: string;
  paymentDay?: number;
};

export type CreditCardMinimumPaymentSimulation = {
  balance: number;
  minimumPayment: number;
  monthlyInterestRate: number;
  monthsToPayOff?: number;
  additionalInterest: number;
  amortizable: boolean;
};

export type CreditCardInstallmentSummary = InstallmentPurchase & {
  pendingInstallments: number;
  progressRatio: number;
};

export type CreditCardSummary = {
  account: Account;
  availableCredit: number;
  currentStatement?: CreditCardStatement;
  installments: CreditCardInstallmentSummary[];
  minimumPaymentSimulation: CreditCardMinimumPaymentSimulation;
  nextPaymentAmount: number;
  totalLimit: number;
  usedCredit: number;
  utilizationRatio: number;
};

export type CreditCardsOverview = {
  cards: CreditCardSummary[];
  generatedAt: ISODateString;
};
