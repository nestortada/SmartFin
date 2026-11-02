/**
 * Migration 5 (phase 1a.3B): installment allocations, plan revision history and billing metadata.
 *
 * D5: history is never deleted by a foreign-key action. Allocations and revisions reference purchases and
 * payments by value (no FK to `transactions` or `installment_purchases`), so existing deletions keep
 * working and the history survives them. Consistency is enforced by triggers instead:
 * - a new row must reference an existing purchase/payment (checked on INSERT);
 * - an ACTIVE allocation blocks deleting or materially editing its payment, and deleting its purchase:
 *   the caller must reverse it explicitly first, in the same transaction;
 * - deleting a purchase that has revisions appends a terminal `purchaseRemoval` revision, and changing its
 *   terms appends a `purchaseEdit` revision pending verification (D6). Nothing is updated or removed.
 * Only the financial wipe deletes these rows. SQL limited to SQLite 3.9.2 (Android 7).
 */

const MAX_SAFE = 9007199254740991;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
/**
 * Exact civil date `YYYY-MM-DD`, years 0001-9999, Gregorian month lengths: the rules of `parseCivilDate`. No date()
 * function: SQLite 3.9.2 (Android 7) returns an impossible date such as 2026-02-30 unchanged, so `date(x) IS x`
 * accepted it there (r3). Plain text operations behave the same on every version. The CASE yields 1 or 0, never
 * NULL, because a NULL CHECK result would pass; nullable columns state `IS NULL OR` explicitly.
 */
export const CIVIL_DATE_CHECK = (column: string) => {
  const year = `CAST(substr(${column}, 1, 4) AS INTEGER)`;
  const month = `CAST(substr(${column}, 6, 2) AS INTEGER)`;
  const day = `CAST(substr(${column}, 9, 2) AS INTEGER)`;
  return `(CASE WHEN typeof(${column}) = 'text' AND length(${column}) = 10
      AND ${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND ${year} >= 1 AND ${month} BETWEEN 1 AND 12
      AND ${day} BETWEEN 1 AND (CASE ${month}
        WHEN 2 THEN (CASE WHEN (${year} % 4 = 0 AND ${year} % 100 <> 0) OR ${year} % 400 = 0 THEN 29 ELSE 28 END)
        WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END)
    THEN 1 ELSE 0 END) = 1`;
};
const CENTS_CHECK = (column: string, minimum: number) =>
  `${column} IS NULL OR (typeof(${column}) = 'integer' AND ${column} >= ${minimum} AND ${column} <= ${MAX_SAFE})`;

export const INSTALLMENT_HISTORY_TABLE_NAMES = [
  'installment_allocations',
  'installment_plan_revisions',
  'credit_card_billing_rules',
  'installment_first_cycles',
] as const;

export const INSTALLMENT_HISTORY_TABLES = [
  `CREATE TABLE IF NOT EXISTS installment_allocations (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(id) > 0),
    payment_transaction_id TEXT NOT NULL CHECK(length(payment_transaction_id) > 0),
    installment_purchase_id TEXT NOT NULL CHECK(length(installment_purchase_id) > 0),
    amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents) = 'integer' AND amount_cents > 0 AND amount_cents <= ${MAX_SAFE}),
    mode TEXT NOT NULL CHECK(mode IN ('unspecified','reduceTerm','reduceInstallment')),
    status TEXT NOT NULL CHECK(status IN ('active','reversed')),
    command_id TEXT NOT NULL CHECK(length(command_id) > 0),
    created_at TEXT NOT NULL,
    reversed_at TEXT,
    CHECK((status = 'active' AND reversed_at IS NULL) OR (status = 'reversed' AND reversed_at IS NOT NULL)),
    UNIQUE(id, installment_purchase_id),
    UNIQUE(command_id, installment_purchase_id));`,
  `CREATE TABLE IF NOT EXISTS installment_plan_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    installment_purchase_id TEXT NOT NULL CHECK(length(installment_purchase_id) > 0),
    revision_number INTEGER NOT NULL CHECK(typeof(revision_number) = 'integer' AND revision_number >= 0),
    source TEXT NOT NULL CHECK(source IN ('original','allocation','allocationReversal','statement','purchaseEdit','purchaseRemoval')),
    allocation_id TEXT,
    remaining_principal_cents INTEGER CHECK(${CENTS_CHECK('remaining_principal_cents', 0)}),
    remaining_installments INTEGER CHECK(remaining_installments IS NULL OR (typeof(remaining_installments) = 'integer' AND remaining_installments BETWEEN 0 AND 360)),
    installment_amount_cents INTEGER CHECK(${CENTS_CHECK('installment_amount_cents', 0)}),
    effective_cycle_end TEXT CHECK(effective_cycle_end IS NULL OR (${CIVIL_DATE_CHECK('effective_cycle_end')})),
    verification TEXT NOT NULL CHECK(verification IN ('confirmed','projected','pendingVerification','estimated')),
    pending_reasons TEXT,
    basis_total_amount REAL,
    basis_monthly_amount REAL,
    basis_installment_count INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE(installment_purchase_id, revision_number),
    FOREIGN KEY (allocation_id, installment_purchase_id) REFERENCES installment_allocations(id, installment_purchase_id),
    CHECK(id = installment_purchase_id || ':revision:' || revision_number),
    CHECK(revision_number > 0 OR source = 'original'),
    CHECK((source IN ('allocation','allocationReversal')) = (allocation_id IS NOT NULL)),
    CHECK((verification = 'pendingVerification') = (pending_reasons IS NOT NULL AND length(pending_reasons) > 0)),
    CHECK(verification NOT IN ('confirmed','projected') OR (remaining_principal_cents IS NOT NULL
      AND remaining_installments IS NOT NULL AND installment_amount_cents IS NOT NULL AND effective_cycle_end IS NOT NULL)),
    CHECK(source <> 'statement' OR effective_cycle_end IS NOT NULL),
    CHECK(source <> 'purchaseRemoval' OR (verification = 'pendingVerification' AND remaining_principal_cents IS NULL
      AND remaining_installments IS NULL AND installment_amount_cents IS NULL AND effective_cycle_end IS NULL)),
    CHECK(CASE WHEN source IN ('original','purchaseEdit')
      THEN basis_total_amount IS NOT NULL AND basis_monthly_amount IS NOT NULL AND basis_installment_count IS NOT NULL
      ELSE basis_total_amount IS NULL AND basis_monthly_amount IS NULL AND basis_installment_count IS NULL END));`,
  // D1: optional per-card rule for purchases made exactly on the closing day. No row or NULL = undefined.
  `CREATE TABLE IF NOT EXISTS credit_card_billing_rules (
    account_id TEXT PRIMARY KEY NOT NULL,
    closing_day_purchase_policy TEXT CHECK(closing_day_purchase_policy IS NULL OR closing_day_purchase_policy IN ('closingCycle','nextCycle')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE);`,
  // D1 exception: confirmed cycle of installment 1, per purchase. Same lifecycle as a purchase column
  // (CASCADE), so a recreated purchase with the same id never inherits a stale confirmation.
  `CREATE TABLE IF NOT EXISTS installment_first_cycles (
    installment_purchase_id TEXT PRIMARY KEY NOT NULL,
    cycle_end TEXT NOT NULL CHECK(${CIVIL_DATE_CHECK('cycle_end')}),
    source TEXT NOT NULL CHECK(source IN ('user','statement')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (installment_purchase_id) REFERENCES installment_purchases(id) ON DELETE CASCADE);`,
  'CREATE INDEX IF NOT EXISTS idx_installment_allocations_purchase ON installment_allocations(installment_purchase_id, status);',
  'CREATE INDEX IF NOT EXISTS idx_installment_allocations_payment ON installment_allocations(payment_transaction_id, status);',
  `CREATE TRIGGER IF NOT EXISTS installment_allocations_validate_insert BEFORE INSERT ON installment_allocations
    BEGIN
      SELECT RAISE(ABORT, 'Una imputación nueva debe estar activa') WHERE NEW.status <> 'active';
      SELECT RAISE(ABORT, 'La compra a cuotas imputada no existe')
        WHERE NOT EXISTS (SELECT 1 FROM installment_purchases WHERE id = NEW.installment_purchase_id);
      SELECT RAISE(ABORT, 'El pago imputado no existe o no corresponde a la tarjeta de la compra')
        WHERE NOT EXISTS (SELECT 1 FROM transactions t JOIN installment_purchases p ON p.id = NEW.installment_purchase_id
          WHERE t.id = NEW.payment_transaction_id AND t.type = 'creditCardPayment'
            AND t.target_account_id = p.account_id AND t.currency = p.currency);
      SELECT RAISE(ABORT, 'El comando ya imputó otro pago')
        WHERE EXISTS (SELECT 1 FROM installment_allocations
          WHERE command_id = NEW.command_id AND payment_transaction_id <> NEW.payment_transaction_id);
    END;`,
  `CREATE TRIGGER IF NOT EXISTS installment_allocations_transition BEFORE UPDATE ON installment_allocations
    WHEN NOT (OLD.status = 'active' AND NEW.status = 'reversed' AND NEW.reversed_at IS NOT NULL
      AND NEW.id IS OLD.id AND NEW.payment_transaction_id IS OLD.payment_transaction_id
      AND NEW.installment_purchase_id IS OLD.installment_purchase_id AND NEW.amount_cents IS OLD.amount_cents
      AND NEW.mode IS OLD.mode AND NEW.command_id IS OLD.command_id AND NEW.created_at IS OLD.created_at)
    BEGIN SELECT RAISE(ABORT, 'Una imputación solo puede pasar de activa a revertida'); END;`,
  `CREATE TRIGGER IF NOT EXISTS installment_plan_revisions_validate_insert BEFORE INSERT ON installment_plan_revisions
    BEGIN
      SELECT RAISE(ABORT, 'Número de revisión fuera de secuencia')
        WHERE NEW.revision_number IS NOT COALESCE((SELECT MAX(revision_number) + 1 FROM installment_plan_revisions
          WHERE installment_purchase_id = NEW.installment_purchase_id), 0);
      SELECT RAISE(ABORT, 'La compra a cuotas de la revisión no existe')
        WHERE NEW.source <> 'purchaseRemoval'
          AND NOT EXISTS (SELECT 1 FROM installment_purchases WHERE id = NEW.installment_purchase_id);
      SELECT RAISE(ABORT, 'Solo una compra eliminada admite una revisión de eliminación')
        WHERE NEW.source = 'purchaseRemoval'
          AND EXISTS (SELECT 1 FROM installment_purchases WHERE id = NEW.installment_purchase_id);
      SELECT RAISE(ABORT, 'Tras una eliminación el historial debe reiniciarse con una revisión original')
        WHERE NEW.source <> 'original' AND (SELECT source FROM installment_plan_revisions
          WHERE installment_purchase_id = NEW.installment_purchase_id
          ORDER BY revision_number DESC LIMIT 1) = 'purchaseRemoval';
    END;`,
  `CREATE TRIGGER IF NOT EXISTS installment_plan_revisions_no_update BEFORE UPDATE ON installment_plan_revisions
    BEGIN SELECT RAISE(ABORT, 'El historial de revisiones es de solo inserción'); END;`,
];

const APPEND_REVISION = (
  purchase: 'OLD' | 'NEW',
  source: 'purchaseEdit' | 'purchaseRemoval',
  reason: string,
  basis: string,
) => `INSERT INTO installment_plan_revisions (id, installment_purchase_id, revision_number, source, allocation_id,
      remaining_principal_cents, remaining_installments, installment_amount_cents, effective_cycle_end, verification,
      pending_reasons, basis_total_amount, basis_monthly_amount, basis_installment_count, created_at)
    SELECT ${purchase}.id || ':revision:' || (MAX(revision_number) + 1), ${purchase}.id, MAX(revision_number) + 1,
      '${source}', NULL, NULL, NULL, NULL, NULL, 'pendingVerification', '${reason}', ${basis}, ${NOW}
    FROM installment_plan_revisions WHERE installment_purchase_id = ${purchase}.id;`;

/** Triggers on existing tables. Created after the initial revisions are inserted. */
export const INSTALLMENT_HISTORY_GUARDS = [
  `CREATE TRIGGER IF NOT EXISTS installment_allocations_guard_payment_delete BEFORE DELETE ON transactions
    WHEN EXISTS (SELECT 1 FROM installment_allocations WHERE payment_transaction_id = OLD.id AND status = 'active')
    BEGIN SELECT RAISE(ABORT, 'El pago tiene imputaciones activas: reviértelas antes de eliminarlo'); END;`,
  `CREATE TRIGGER IF NOT EXISTS installment_allocations_guard_payment_update BEFORE UPDATE ON transactions
    WHEN ((OLD.amount IS NOT NEW.amount OR OLD.currency IS NOT NEW.currency OR OLD.type IS NOT NEW.type
        OR OLD.direction IS NOT NEW.direction OR OLD.status IS NOT NEW.status OR OLD.account_id IS NOT NEW.account_id
        OR OLD.target_account_id IS NOT NEW.target_account_id)
      AND EXISTS (SELECT 1 FROM installment_allocations WHERE payment_transaction_id = OLD.id AND status = 'active'))
      OR (OLD.id IS NOT NEW.id
        AND EXISTS (SELECT 1 FROM installment_allocations WHERE payment_transaction_id = OLD.id))
    BEGIN SELECT RAISE(ABORT, 'El pago tiene imputaciones activas: reviértelas antes de modificarlo'); END;`,
  `CREATE TRIGGER IF NOT EXISTS installment_allocations_guard_purchase_delete BEFORE DELETE ON installment_purchases
    WHEN EXISTS (SELECT 1 FROM installment_allocations WHERE installment_purchase_id = OLD.id AND status = 'active')
    BEGIN SELECT RAISE(ABORT, 'La compra tiene imputaciones activas: reviértelas antes de eliminarla'); END;`,
  `CREATE TRIGGER IF NOT EXISTS installment_history_guard_purchase_id BEFORE UPDATE OF id ON installment_purchases
    WHEN OLD.id IS NOT NEW.id
      AND (EXISTS (SELECT 1 FROM installment_allocations WHERE installment_purchase_id = OLD.id)
        OR EXISTS (SELECT 1 FROM installment_plan_revisions WHERE installment_purchase_id = OLD.id))
    BEGIN SELECT RAISE(ABORT, 'La compra tiene historial de cuotas y no puede cambiar de identificador'); END;`,
  // D6: changed terms never rewrite history; the plan becomes pending verification instead.
  `CREATE TRIGGER IF NOT EXISTS installment_plan_revisions_purchase_edit AFTER UPDATE ON installment_purchases
    WHEN (OLD.total_amount IS NOT NEW.total_amount OR OLD.installment_count IS NOT NEW.installment_count
        OR OLD.currency IS NOT NEW.currency OR OLD.account_id IS NOT NEW.account_id
        OR OLD.transaction_id IS NOT NEW.transaction_id OR OLD.first_due_date IS NOT NEW.first_due_date)
      AND EXISTS (SELECT 1 FROM installment_plan_revisions WHERE installment_purchase_id = NEW.id)
    BEGIN ${APPEND_REVISION('NEW', 'purchaseEdit', 'termsChanged', 'NEW.total_amount, NEW.monthly_amount, NEW.installment_count')} END;`,
  `CREATE TRIGGER IF NOT EXISTS installment_plan_revisions_purchase_removal AFTER DELETE ON installment_purchases
    WHEN (SELECT source FROM installment_plan_revisions WHERE installment_purchase_id = OLD.id
      ORDER BY revision_number DESC LIMIT 1) IS NOT NULL
      AND (SELECT source FROM installment_plan_revisions WHERE installment_purchase_id = OLD.id
      ORDER BY revision_number DESC LIMIT 1) <> 'purchaseRemoval'
    BEGIN ${APPEND_REVISION('OLD', 'purchaseRemoval', 'purchaseRemoved', 'NULL, NULL, NULL')} END;`,
];

const revisionTrigger = (table: string, event: 'INSERT' | 'UPDATE' | 'DELETE') =>
  `CREATE TRIGGER IF NOT EXISTS backup_revision_${table}_${event.toLowerCase()} AFTER ${event} ON ${table}
    BEGIN UPDATE financial_data_revision SET revision = revision + 1, updated_at = ${NOW} WHERE id = 1; END;`;

/** Created last, so the migration's baseline revisions do not mark the backup as outdated. */
export const INSTALLMENT_HISTORY_BACKUP_TRIGGERS = [
  ...(['INSERT', 'UPDATE', 'DELETE'] as const).map(event => revisionTrigger('installment_allocations', event)),
  // Revisions are append-only: an UPDATE is aborted before it can change anything.
  ...(['INSERT', 'DELETE'] as const).map(event => revisionTrigger('installment_plan_revisions', event)),
  ...(['INSERT', 'UPDATE', 'DELETE'] as const).map(event => revisionTrigger('credit_card_billing_rules', event)),
  ...(['INSERT', 'UPDATE', 'DELETE'] as const).map(event => revisionTrigger('installment_first_cycles', event)),
];

export const INSTALLMENT_HISTORY_SCHEMA = [
  ...INSTALLMENT_HISTORY_TABLES,
  ...INSTALLMENT_HISTORY_GUARDS,
  ...INSTALLMENT_HISTORY_BACKUP_TRIGGERS,
];

/** 9 bound values per row: 100 rows stay under the 999 parameters allowed on Android 7 (API 24). */
export const ORIGINAL_REVISIONS_PER_INSERT = 100;

export function insertOriginalRevisionsSql(count: number): string {
  if (!Number.isInteger(count) || count < 1 || count > ORIGINAL_REVISIONS_PER_INSERT)
    throw new Error('Lote de revisiones iniciales inválido.');
  const row = `(?, ?, 0, 'original', NULL, ?, ?, ?, NULL, 'pendingVerification', ?, ?, ?, ?, ${NOW})`;
  return `INSERT INTO installment_plan_revisions (id, installment_purchase_id, revision_number, source, allocation_id,
    remaining_principal_cents, remaining_installments, installment_amount_cents, effective_cycle_end, verification,
    pending_reasons, basis_total_amount, basis_monthly_amount, basis_installment_count, created_at)
  VALUES ${Array.from({ length: count }, () => row).join(', ')};`;
}
