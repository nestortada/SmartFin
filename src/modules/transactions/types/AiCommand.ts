import type { Account } from '../../accounts';
import type { Category, Subcategory } from '../../categories';
import type { Transaction, TransactionType } from './Transaction';

export type AiActionOperation = 'create' | 'update' | 'delete';
export type AiActionEntity =
  | 'transaction'
  | 'debitAccount'
  | 'creditCard'
  | 'category'
  | 'subcategory';

export type AiTransactionFields = {
  accountId?: string | null;
  accountName?: string | null;
  accountRef?: string | null;
  amount?: number | null;
  categoryId?: string | null;
  categoryName?: string | null;
  categoryRef?: string | null;
  date?: string | null;
  description?: string | null;
  installmentCount?: number | null;
  interestFreeInstallmentCount?: number | null;
  notes?: string | null;
  pendingAccountKind?: 'debitAccount' | 'creditCard' | null;
  pendingAccountName?: string | null;
  subcategoryId?: string | null;
  subcategoryName?: string | null;
  subcategoryRef?: string | null;
  targetAccountId?: string | null;
  targetAccountName?: string | null;
  targetAccountRef?: string | null;
  transactionType?: TransactionType | null;
  transferTaxCharged?: boolean | null;
};

export type AiDebitAccountFields = {
  initialBalance?: number | null;
  institutionName?: string | null;
  name?: string | null;
  recurringIncomeAmount?: number | null;
  recurringIncomeDay?: number | null;
  recurringIncomeEnabled?: boolean | null;
  recurringIncomeFrequency?: 'biweekly' | 'monthly' | 'specificDay' | null;
  recurringIncomeType?: 'salary' | 'allowance' | 'business' | 'other' | null;
};

export type AiCreditCardFields = {
  annualEffectiveInterestRate?: number | null;
  bankName?: string | null;
  closingDay?: number | null;
  creditLimit?: number | null;
  lastFourDigits?: string | null;
  managementFee?: number | null;
  name?: string | null;
  paymentDay?: number | null;
};

export type AiCategoryFields = {
  color?: string | null;
  name?: string | null;
  type?: 'expense' | 'income' | null;
};

export type AiSubcategoryFields = {
  categoryId?: string | null;
  categoryName?: string | null;
  categoryRef?: string | null;
  color?: string | null;
  name?: string | null;
};

type AiActionBase = {
  clientRef?: string;
  id: string;
  operation: AiActionOperation;
  targetId?: string | null;
  targetName?: string | null;
};

export type AiCommandAction =
  | (AiActionBase & { entity: 'transaction'; fields: AiTransactionFields })
  | (AiActionBase & { entity: 'debitAccount'; fields: AiDebitAccountFields })
  | (AiActionBase & { entity: 'creditCard'; fields: AiCreditCardFields })
  | (AiActionBase & { entity: 'category'; fields: AiCategoryFields })
  | (AiActionBase & { entity: 'subcategory'; fields: AiSubcategoryFields });

export type AiCommandPlan = {
  actions: AiCommandAction[];
  answeredFields: string[];
  summary: string;
  version: 1;
};

export type AiPlanningContext = {
  accounts: Account[];
  categories: Category[];
  subcategories: Subcategory[];
  transactions: Transaction[];
};

export type AiClarificationOption = {
  label: string;
  value: string;
};

export type AiClarificationQuestion = {
  actionId: string;
  allowCustom: boolean;
  field: string;
  id: string;
  optional?: boolean;
  options: AiClarificationOption[];
  prompt: string;
  valueType: 'boolean' | 'date' | 'number' | 'string';
};

export type AiDraftPhase = 'clarifying' | 'review';

export type AiCommandDraft = {
  id: string;
  rawInput: string;
  plan: AiCommandPlan;
  phase: AiDraftPhase;
  createdAt: string;
  updatedAt: string;
};
