import type { Account } from '../../accounts';
import type { Category, Subcategory } from '../../categories';
import type { Transaction, TransactionType } from './Transaction';
import type { SubscriptionRecurrence } from '../../subscriptions/types';

export type AiActionOperation = 'create' | 'update' | 'delete';
export type AiActionEntity =
  | 'transaction'
  | 'debitAccount'
  | 'creditCard'
  | 'category'
  | 'subcategory'
  | 'subscription';

export type AiSubscriptionFields = Pick<AiTransactionFields,
  'accountId' | 'accountName' | 'accountRef' | 'categoryId' | 'categoryName' | 'categoryRef' |
  'subcategoryId' | 'subcategoryName' | 'subcategoryRef' | 'amount'> & {
  name?: string | null;
  merchantName?: string | null;
  anchorDate?: string | null;
  billingDay?: number | null;
  periodicity?: SubscriptionRecurrence['periodicity'] | null;
  customInterval?: number | null;
  customUnit?: 'days' | 'weeks' | 'months' | null;
  remindersEnabled?: boolean | null;
  reminderOffsets?: string | null;
  reminderHour?: number | null;
  reminderMinute?: number | null;
};

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
  | (AiActionBase & { entity: 'subcategory'; fields: AiSubcategoryFields })
  | (AiActionBase & { entity: 'subscription'; fields: AiSubscriptionFields });

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
  contextLabel: string;
  field: string;
  helpText?: string;
  id: string;
  optional?: boolean;
  options: AiClarificationOption[];
  prompt: string;
  valueType: 'boolean' | 'date' | 'number' | 'string';
};

export type AiAssistantMessage = {
  createdAt: string;
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

export type AiClarificationExchange = {
  actionId: string;
  answerLabel: string;
  answerValue: string;
  answeredAt: string;
  contextLabel: string;
  field: string;
  id: string;
  prompt: string;
};

export type AiEditableField = {
  actionId: string;
  allowCustom: boolean;
  field: string;
  label: string;
  options: AiClarificationOption[];
  value: string;
  valueType: AiClarificationQuestion['valueType'];
};

export type AiDraftPhase = 'clarifying' | 'review';

export type AiCommandDraft = {
  clarificationHistory: AiClarificationExchange[];
  id: string;
  messages: AiAssistantMessage[];
  rawInput: string;
  plan: AiCommandPlan;
  phase: AiDraftPhase;
  createdAt: string;
  updatedAt: string;
};
