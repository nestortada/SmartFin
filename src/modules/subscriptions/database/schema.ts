export const SUBSCRIPTION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS subscription_occurrences (
    id TEXT PRIMARY KEY NOT NULL, subscription_id TEXT NOT NULL,
    expected_date TEXT NOT NULL, expected_amount REAL NOT NULL CHECK(expected_amount > 0),
    actual_amount REAL, currency TEXT NOT NULL, account_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','overdue','paid','skipped')),
    transaction_id TEXT, paid_at TEXT, skipped_at TEXT, skip_reason TEXT, notes TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(subscription_id, expected_date),
    FOREIGN KEY(subscription_id) REFERENCES recurring_subscriptions(id) ON DELETE CASCADE,
    FOREIGN KEY(account_id) REFERENCES accounts(id),
    FOREIGN KEY(transaction_id) REFERENCES transactions(id)
  );`,
  `CREATE TABLE IF NOT EXISTS subscription_reminders (
    id TEXT PRIMARY KEY NOT NULL, occurrence_id TEXT NOT NULL, offset_days INTEGER NOT NULL,
    revision INTEGER NOT NULL, fire_at TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
    desired TEXT NOT NULL, applied_revision INTEGER, delivery_status TEXT NOT NULL,
    error TEXT, updated_at TEXT NOT NULL,
    UNIQUE(occurrence_id, offset_days),
    FOREIGN KEY(occurrence_id) REFERENCES subscription_occurrences(id) ON DELETE CASCADE
  );`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_occurrence_transaction ON subscription_occurrences(transaction_id) WHERE transaction_id IS NOT NULL;',
  'CREATE INDEX IF NOT EXISTS idx_subscription_occurrence_status_date ON subscription_occurrences(status, expected_date);',
  // UNIQUE(subscription_id, expected_date) already serves the history query.
  'CREATE INDEX IF NOT EXISTS idx_subscription_reminder_delivery ON subscription_reminders(delivery_status, desired);',
];
export const SUBSCRIPTION_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['anchor_date', 'TEXT'],
  ['custom_interval', 'INTEGER'],
  ['custom_unit', 'TEXT'],
  ['generation_cursor', 'TEXT'],
  [
    'reminders_json',
    'TEXT NOT NULL DEFAULT \'{"enabled":true,"offsets":[3,1,0],"hour":9,"minute":0}\'',
  ],
  ['schedule_revision', 'INTEGER NOT NULL DEFAULT 1'],
];
