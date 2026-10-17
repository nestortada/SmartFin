/** Migration 4: loss journal. No rows in the bank ledger are synthesized. */
export const SHARED_LOSS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shared_loss_events (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('forgiveness','forgivenessReversal','recovery','recoveryReversal')),
    expense_id TEXT NOT NULL REFERENCES shared_expenses(id),
    participation_key TEXT NOT NULL,
    contact_id TEXT NOT NULL REFERENCES shared_contacts(id),
    amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor) = 'integer' AND amount_minor > 0 AND amount_minor <= 9007199254740991),
    date TEXT NOT NULL CHECK(length(date) = 10), reason TEXT,
    related_event_id TEXT REFERENCES shared_loss_events(id) DEFERRABLE INITIALLY DEFERRED,
    receipt_id TEXT REFERENCES shared_receipts(id), created_at TEXT NOT NULL,
    CHECK((kind = 'forgiveness' AND related_event_id IS NULL AND receipt_id IS NULL)
      OR (kind = 'forgivenessReversal' AND related_event_id IS NOT NULL AND receipt_id IS NULL)
      OR (kind IN ('recovery','recoveryReversal') AND related_event_id IS NOT NULL AND receipt_id IS NOT NULL)));`,
  'CREATE INDEX IF NOT EXISTS idx_shared_loss_participation ON shared_loss_events(participation_key, kind);',
  'CREATE INDEX IF NOT EXISTS idx_shared_loss_receipt ON shared_loss_events(receipt_id, kind);',
  'CREATE INDEX IF NOT EXISTS idx_shared_loss_date ON shared_loss_events(date, kind);',
  'CREATE INDEX IF NOT EXISTS idx_shared_loss_related ON shared_loss_events(related_event_id, kind);',
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_loss_reversal ON shared_loss_events(related_event_id)
    WHERE kind IN ('forgivenessReversal','recoveryReversal');`,
  // Domain uses INSERT only; UPDATE is forbidden even for callers outside the API.
  `CREATE TRIGGER IF NOT EXISTS shared_loss_no_update BEFORE UPDATE ON shared_loss_events
    BEGIN SELECT RAISE(ABORT, 'Loss journal is append-only'); END;`,
  ...['INSERT', 'DELETE'].map(
    event =>
      `CREATE TRIGGER IF NOT EXISTS backup_revision_shared_loss_events_${event.toLowerCase()} AFTER ${event} ON shared_loss_events
    BEGIN UPDATE financial_data_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1; END;`,
  ),
];
