import type { Transaction } from './Transaction';

export type SharedContact = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};
export type SharedExpense = {
  id: string;
  transactionId?: string;
  totalMinor: number;
  date: string;
  description: string;
  distributionSnapshot: {
    id: string;
    contactId?: string;
    amountMinor: number;
  }[];
  status: 'active' | 'cancelled' | 'deleted';
  createdAt: string;
  updatedAt: string;
};
export type SharedParticipation = {
  id: string;
  expenseId: string;
  transactionId: string;
  contactId?: string;
  amountMinor: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};
export type ThirdPartyReceipt = {
  id: string;
  transactionId?: string;
  contactId: string;
  amountMinor: number;
  date: string;
  status: 'active' | 'deleted';
  createdAt: string;
  updatedAt: string;
};
export type SharedAllocation = {
  id: string;
  receiptId: string;
  participationId: string;
  amountMinor: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};
export type ThirdPartyReturn = {
  id: string;
  receiptId: string;
  transactionId?: string;
  amountMinor: number;
  date: string;
  status: 'active' | 'deleted';
  createdAt: string;
  updatedAt: string;
};
export type SharedExpenseState = {
  contacts: SharedContact[];
  expenses: SharedExpense[];
  participations: SharedParticipation[];
  receipts: ThirdPartyReceipt[];
  allocations: SharedAllocation[];
  returns: ThirdPartyReturn[];
  lossEvents: SharedLossEvent[];
};
/** Append-only accounting journal, separate from bank movements and reimbursements. */
export type SharedLossEvent = {
  id: string;
  kind: 'forgiveness' | 'forgivenessReversal' | 'recovery' | 'recoveryReversal';
  expenseId: string;
  participationId: string;
  contactId: string;
  amountMinor: number;
  date: string;
  reason?: string;
  relatedEventId?: string;
  receiptId?: string;
  createdAt: string;
};
export type SharedObligationStatus =
  | 'pending'
  | 'partiallyReimbursed'
  | 'completed'
  | 'partiallyForgiven'
  | 'fullyForgiven'
  | 'completedMixed';
export type SharedLossEntry = SharedLossEvent & {
  classification: 'unrecoveredSharedExpenseLoss';
  lossDelta: number;
  bankFlow: 0;
};
export type SharedLossPeriodTotals = {
  losses: number;
  reversals: number;
  recoveries: number;
  recoveryReversals: number;
  netLoss: number;
};
export type SharedDistribution =
  | {
      mode: 'amounts';
      personalAmount: number;
      participants: { contactId: string; amount: number }[];
    }
  | {
      mode: 'percentages';
      personalPercentage: number;
      participants: { contactId: string; percentage: number }[];
    };
export type SharedExpenseOverview = {
  expense: SharedExpense;
  personalAmount: number;
  receivedAmount: number;
  pendingAmount: number;
  forgivenAmount: number;
  recoveredAmount: number;
  status: SharedObligationStatus;
  participants: {
    participationId: string;
    contactId: string;
    name: string;
    amount: number;
    receivedAmount: number;
    pendingAmount: number;
    forgivenAmount: number;
    recoveredAmount: number;
    status: SharedObligationStatus;
  }[];
};
export type SharedFinancialPosition = {
  receivables: number;
  thirdPartyAdvances: number;
  contacts: {
    contactId: string;
    name: string;
    receivable: number;
    advance: number;
  }[];
};
export type SharedFinancialEffects = {
  accounts: { accountId: string; balanceDelta: number; debtDelta: number }[];
  availableDelta: number;
  debtDelta: number;
  netWorthDelta: number;
  receivableDelta: number;
  thirdPartyAdvanceDelta: number;
  personalIncomeDelta: number;
  personalExpenseDelta: number;
  bankInflowDelta: number;
  bankOutflowDelta: number;
  /** Optional for compatibility with commands confirmed before migration 4. */
  recognizedLossDelta?: number;
};
export type SharedCommandResult = {
  entityId: string;
  transaction?: Transaction;
  transactions?: Transaction[];
  deletedTransactionIds?: string[];
  effects?: SharedFinancialEffects;
};
