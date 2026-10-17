import {
  TRANSACTION_DAY_SQL,
  TRANSACTION_SORT_SQL,
} from '../../../shared/utils/transactionDate';

export const MOVEMENT_DATE_COLUMNS = [
  ['civil_date', 'TEXT'],
  ['local_time', 'TEXT'],
  ['time_zone', 'TEXT'],
  ['date_precision', 'TEXT'],
] as const;
export const SHARED_SPLIT_COLUMNS = [
  ['shared_expense_id', 'TEXT REFERENCES shared_expenses(id)'],
  ['contact_id', 'TEXT REFERENCES shared_contacts(id)'],
  [
    'amount_minor',
    "INTEGER CHECK(amount_minor IS NULL OR (typeof(amount_minor) = 'integer' AND amount_minor >= 0 AND amount_minor <= 9007199254740991))",
  ],
  ['shared_active', 'INTEGER NOT NULL DEFAULT 1 CHECK(shared_active IN (0,1))'],
] as const;
export const SHARED_EXPENSE_TABLES = [
  'shared_contacts',
  'shared_expenses',
  'shared_receipts',
  'shared_allocations',
  'shared_returns',
  'shared_commands',
] as const;
export const SHARED_EXPENSE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shared_contacts (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL CHECK(length(trim(name)) > 0),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS shared_expenses (
    id TEXT PRIMARY KEY NOT NULL, transaction_id TEXT UNIQUE REFERENCES transactions(id),
    total_minor INTEGER NOT NULL CHECK(typeof(total_minor) = 'integer' AND total_minor > 0 AND total_minor <= 9007199254740991), date TEXT NOT NULL, description TEXT NOT NULL,
    distribution_snapshot TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK(status IN ('active','cancelled','deleted')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS shared_receipts (
    id TEXT PRIMARY KEY NOT NULL, transaction_id TEXT UNIQUE REFERENCES transactions(id),
    contact_id TEXT NOT NULL REFERENCES shared_contacts(id), amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor) = 'integer' AND amount_minor > 0 AND amount_minor <= 9007199254740991),
    date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','deleted')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS shared_allocations (
    id TEXT PRIMARY KEY NOT NULL, receipt_id TEXT NOT NULL REFERENCES shared_receipts(id),
    participation_id TEXT REFERENCES transaction_splits(id) ON DELETE SET NULL, participation_key TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor) = 'integer' AND amount_minor > 0 AND amount_minor <= 9007199254740991),
    active INTEGER NOT NULL CHECK(active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS shared_returns (
    id TEXT PRIMARY KEY NOT NULL, receipt_id TEXT NOT NULL REFERENCES shared_receipts(id),
    transaction_id TEXT UNIQUE REFERENCES transactions(id), amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor) = 'integer' AND amount_minor > 0 AND amount_minor <= 9007199254740991),
    date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','deleted')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS shared_commands (
    id TEXT PRIMARY KEY NOT NULL, request_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);`,
];
export const SHARED_EXPENSE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_shared_splits_expense ON transaction_splits(shared_expense_id, shared_active);',
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_splits_person ON transaction_splits(shared_expense_id, COALESCE(contact_id,'')) WHERE shared_expense_id IS NOT NULL AND shared_active = 1;",
  'CREATE INDEX IF NOT EXISTS idx_shared_allocations_split ON shared_allocations(participation_id, active);',
  'CREATE INDEX IF NOT EXISTS idx_shared_allocations_receipt ON shared_allocations(receipt_id, active);',
  'CREATE INDEX IF NOT EXISTS idx_shared_receipts_contact ON shared_receipts(contact_id, status);',
  `CREATE INDEX IF NOT EXISTS idx_transactions_civil_sort ON transactions(${TRANSACTION_SORT_SQL}, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_civil_day ON transactions(${TRANSACTION_DAY_SQL}, status);`,
];
export const SHARED_EXPENSE_TRIGGERS = SHARED_EXPENSE_TABLES.flatMap(table =>
  ['INSERT', 'UPDATE', 'DELETE'].map(
    event =>
      `CREATE TRIGGER IF NOT EXISTS backup_revision_${table}_${event.toLowerCase()} AFTER ${event} ON ${table}
  BEGIN UPDATE financial_data_revision SET revision = revision + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1; END;`,
  ),
);
