import type { ReminderStatus, SubscriptionReminder } from '../types';

export type SubscriptionReminderService = {
  getStatus: () => Promise<ReminderStatus>;
  requestPermission: () => Promise<ReminderStatus>;
  schedule: (reminder: SubscriptionReminder) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  cancelAll: () => Promise<void>;
  ensureMaintenance: () => Promise<void>;
};
