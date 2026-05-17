import type { CurrencyCode, ISODateString, Money } from '../../../shared/types';

export type AccountType =
  | 'cash'
  | 'bankAccount'
  | 'savingsAccount'
  | 'creditCard'
  | 'loan'
  | 'investment';

export type AccountStatus = 'active' | 'inactive' | 'closed';

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  status: AccountStatus;
  currency: CurrencyCode;
  balance: Money;
  debtBalance?: Money;
  creditLimit?: Money;
  institutionName?: string;
  description?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};
