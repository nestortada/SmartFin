import type { Transaction } from '../../transactions/types';
import type {
  Subscription,
  SubscriptionOccurrence,
  SubscriptionReminder,
  SubscriptionDiagnostic,
  SubscriptionCharge,
  SubscriptionHistoryItem,
  SubscriptionFormOptions,
} from '../types';

export type SubscriptionReference = {
  id: string;
  type?: string;
  status?: string;
  currency?: string;
  categoryId?: string;
  isActive?: boolean;
};
export type SubscriptionProjection = {
  id: string;
  name: string;
  eventType: string;
  amount: number;
  currency: string;
  expectedDate: string;
  accountId?: string;
  sourceEntityType: string;
  sourceEntityId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};
export type SubscriptionAlert = {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  message: string;
  relatedEntityType: string;
  relatedEntityId: string;
  status: string;
  triggeredAt: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
};
export type SubscriptionState = {
  subscriptions: Subscription[];
  occurrences: SubscriptionOccurrence[];
  reminders: SubscriptionReminder[];
  projections: SubscriptionProjection[];
  alerts: SubscriptionAlert[];
  accounts: SubscriptionReference[];
  categories: SubscriptionReference[];
  subcategories: SubscriptionReference[];
  transactions: Transaction[];
  diagnostics: SubscriptionDiagnostic[];
};
export type SubscriptionScope = {
  today: string;
  occurrenceId?: string;
  transactionId?: string;
  transactionIds?: string[];
};
export type SubscriptionRepository = {
  mutate: <T>(
    scope: SubscriptionScope,
    operation: (state: SubscriptionState) => T,
  ) => Promise<T>;
  getSubscriptions: () => Promise<Subscription[]>;
  getDiagnostics: () => Promise<SubscriptionDiagnostic[]>;
  getFormOptions: () => Promise<SubscriptionFormOptions>;
  getPaymentContext: (
    occurrenceId: string,
    query: string,
    suggestedOnly: boolean,
  ) => Promise<SubscriptionState>;
  getCharges: (
    from: string,
    to: string,
    statuses: string[],
    pagination?: { limit: number; offset: number },
  ) => Promise<SubscriptionCharge[]>;
  getHistory: (
    subscriptionId: string,
    limit: number,
    offset: number,
  ) => Promise<SubscriptionHistoryItem[]>;
  getReminders: () => Promise<SubscriptionReminder[]>;
  acknowledgeReminder: (
    id: string,
    revision: number,
    status: SubscriptionReminder['deliveryStatus'],
    error?: string,
  ) => Promise<void>;
};
