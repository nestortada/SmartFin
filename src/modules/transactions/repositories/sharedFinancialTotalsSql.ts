/**
 * Dashboard-only projection of getSharedFinancialPosition(state).
 * Aggregate each relation separately: joining raw receipts/returns/allocations
 * would multiply money. participation_key is the domain's historical identity;
 * participation_id may be NULL after deletion and must not replace it here.
 * All arithmetic stays INTEGER. CAST at the final boundary prevents the native
 * driver from rounding a total beyond JS's safe range before it is validated.
 * Uses SQLite syntax supported by Android API 24; no windows or schema changes.
 */
export const SHARED_FINANCIAL_TOTALS_SQL = `WITH
  forgiven_by_participation AS (
    SELECT participation_key, SUM(CASE kind WHEN 'forgiveness' THEN amount_minor ELSE -amount_minor END) AS forgiven_minor
    FROM shared_loss_events WHERE kind IN ('forgiveness','forgivenessReversal') GROUP BY participation_key
  ),
  recovered_by_contact AS (
    SELECT r.contact_id, SUM(CASE l.kind WHEN 'recovery' THEN l.amount_minor ELSE -l.amount_minor END) AS recovered_minor
    FROM shared_loss_events l JOIN shared_receipts r ON r.id = l.receipt_id AND r.status = 'active'
    WHERE l.kind IN ('recovery','recoveryReversal') GROUP BY r.contact_id
  ),
  applied_by_participation AS (
    SELECT a.participation_key, SUM(a.amount_minor) AS applied_minor
    FROM shared_allocations a
    JOIN shared_receipts r ON r.id = a.receipt_id AND r.status = 'active'
    JOIN transaction_splits p ON p.id = a.participation_key AND p.shared_active = 1
      AND p.contact_id IS NOT NULL
    JOIN shared_expenses e ON e.id = p.shared_expense_id AND e.status = 'active'
    WHERE a.active = 1
    GROUP BY a.participation_key
  ),
  participations_by_contact AS (
    SELECT s.contact_id,
      SUM(s.amount_minor - COALESCE(a.applied_minor, 0) - COALESCE(f.forgiven_minor, 0)) AS receivable_minor,
      SUM(COALESCE(a.applied_minor, 0)) AS applied_minor,
      MIN(s.amount_minor - COALESCE(a.applied_minor, 0) - COALESCE(f.forgiven_minor, 0)) AS smallest_pending,
      MAX(CASE WHEN typeof(s.amount_minor) <> 'integer' OR s.amount_minor < 0
        OR s.amount_minor > 9007199254740991 THEN 1 ELSE 0 END) AS invalid_amount
    FROM transaction_splits s
    JOIN shared_expenses e ON e.id = s.shared_expense_id AND e.status = 'active'
    LEFT JOIN applied_by_participation a ON a.participation_key = s.id
    LEFT JOIN forgiven_by_participation f ON f.participation_key = s.id
    WHERE s.shared_active = 1 AND s.contact_id IS NOT NULL
    GROUP BY s.contact_id
  ),
  receipts_by_contact AS (
    SELECT contact_id, SUM(amount_minor) AS received_minor
    FROM shared_receipts WHERE status = 'active'
    GROUP BY contact_id
  ),
  returns_by_contact AS (
    SELECT r.contact_id, SUM(t.amount_minor) AS returned_minor
    FROM shared_returns t
    JOIN shared_receipts r ON r.id = t.receipt_id AND r.status = 'active'
    WHERE t.status = 'active'
    GROUP BY r.contact_id
  ),
  contact_amounts AS (
    SELECT COALESCE(p.receivable_minor, 0) AS receivable_minor,
      COALESCE(p.applied_minor, 0) AS applied_minor,
      COALESCE(r.received_minor, 0) AS received_minor,
      COALESCE(t.returned_minor, 0) AS returned_minor,
      COALESCE(l.recovered_minor, 0) AS recovered_minor,
      COALESCE(p.smallest_pending, 0) AS smallest_pending,
      COALESCE(p.invalid_amount, 0) AS invalid_amount
    FROM shared_contacts c
    LEFT JOIN participations_by_contact p ON p.contact_id = c.id
    LEFT JOIN receipts_by_contact r ON r.contact_id = c.id
    LEFT JOIN returns_by_contact t ON t.contact_id = c.id
    LEFT JOIN recovered_by_contact l ON l.contact_id = c.id
  ),
  checked_amounts AS (
    SELECT receivable_minor, received_minor - applied_minor - returned_minor - recovered_minor AS advance_minor,
      CASE WHEN invalid_amount = 1 OR smallest_pending < 0
        OR receivable_minor < 0 OR receivable_minor > 9007199254740991
        OR applied_minor > 9007199254740991 OR received_minor > 9007199254740991
        OR returned_minor > 9007199254740991
        OR recovered_minor < 0 OR recovered_minor > 9007199254740991
        OR received_minor - applied_minor - returned_minor - recovered_minor < 0
        THEN 1 ELSE 0 END AS invalid
    FROM contact_amounts
  )
SELECT CAST(COALESCE(SUM(receivable_minor), 0) AS TEXT) AS receivable_minor,
  CAST(COALESCE(SUM(advance_minor), 0) AS TEXT) AS advance_minor,
  COALESCE(MAX(invalid), 0) AS invalid
FROM checked_amounts;`;
