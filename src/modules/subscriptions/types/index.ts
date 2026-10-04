import type { Transaction } from '../../transactions/types';

export type SubscriptionRecurrence =
  | {
      periodicity:
        | 'weekly'
        | 'biweekly'
        | 'monthly'
        | 'bimonthly'
        | 'quarterly'
        | 'semiannual'
        | 'yearly';
    }
  | {
      periodicity: 'custom';
      interval: number;
      unit: 'days' | 'weeks' | 'months';
    };
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';
export type OccurrenceStatus = 'pending' | 'paid' | 'skipped' | 'overdue';
export type SkipReason = 'manual' | 'pause' | 'cancellation' | 'rescheduled';
export type ReminderConfiguration = {
  enabled: boolean;
  offsets: number[];
  hour: number;
  minute: number;
};
export type Subscription = {
  id: string;
  name: string;
  merchantName?: string;
  amount: number;
  currency: 'COP';
  categoryId?: string;
  subcategoryId?: string;
  accountId?: string;
  recurrence: SubscriptionRecurrence;
  anchorDate: string;
  billingDay: number;
  nextChargeDate?: string;
  generationCursor: string;
  status: SubscriptionStatus;
  reminders: ReminderConfiguration;
  scheduleRevision: number;
  createdAt: string;
  updatedAt: string;
};
export type SubscriptionInput = {
  name: string;
  merchantName?: string;
  amount: number;
  currency?: 'COP';
  categoryId?: string;
  subcategoryId?: string;
  accountId?: string;
  recurrence: SubscriptionRecurrence;
  anchorDate: string;
  billingDay?: number;
  status?: SubscriptionStatus;
  reminders?: Partial<ReminderConfiguration>;
};
export type SubscriptionUpdate = Partial<Omit<SubscriptionInput, 'status'>>;
export type SubscriptionOccurrence = {
  id: string;
  subscriptionId: string;
  expectedDate: string;
  expectedAmount: number;
  actualAmount?: number;
  currency: 'COP';
  accountId?: string;
  status: OccurrenceStatus;
  transactionId?: string;
  paidAt?: string;
  skippedAt?: string;
  skipReason?: SkipReason;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};
export type SubscriptionCharge = SubscriptionOccurrence & {
  subscriptionName: string;
};
export type SubscriptionHistoryItem = SubscriptionOccurrence & {
  transaction?: Transaction;
};
export type SubscriptionMatch = {
  occurrenceId: string;
  score: number;
  reasons: string[];
};
export type SubscriptionDiagnostic = {
  subscriptionId: string;
  message: string;
};
export type SubscriptionSummary = {
  activeCount: number;
  monthlyEquivalent: number;
  annualEquivalent: number;
  nextCharge?: SubscriptionCharge;
  upcomingCount: number;
  overdueCount: number;
};
export type ReminderStatus = {
  available: boolean;
  permission: 'granted' | 'denied' | 'unsupported';
};
export type SubscriptionReminder = {
  id: string;
  occurrenceId: string;
  offsetDays: number;
  revision: number;
  fireAt: string;
  title: string;
  message: string;
  desired: 'scheduled' | 'cancelled';
  appliedRevision?: number;
  deliveryStatus:
    | 'pending'
    | 'scheduled'
    | 'cancelled'
    | 'delivered'
    | 'blocked'
    | 'failed';
  error?: string;
  updatedAt: string;
};
export type SubscriptionSyncResult = {
  diagnostics: SubscriptionDiagnostic[];
  reminders: ReminderStatus;
  reminderErrors: string[];
  hasMore: boolean;
};
export type SubscriptionMutationResult<T> = {
  value: T;
  sync: SubscriptionSyncResult;
};
export type SubscriptionClock = { now: () => Date };
export type SubscriptionFormOptions = {
  accounts: {
    id: string;
    name: string;
    type: string;
    status: string;
    currency: string;
  }[];
  categories: { id: string; name: string; type: string }[];
  subcategories: {
    id: string;
    name: string;
    categoryId: string;
    isActive: boolean;
  }[];
};
export type SubscriptionPaymentCandidate = {
  transaction: Transaction;
  score: number;
  reasons: string[];
};
