/** Amount for personal statistics only. Never use this to reconcile bank/card balances. */
export const PERSONAL_AMOUNT_SQL = `CASE
  WHEN EXISTS (SELECT 1 FROM shared_receipts r WHERE r.transaction_id = transactions.id AND r.status = 'active')
    OR EXISTS (SELECT 1 FROM shared_returns r WHERE r.transaction_id = transactions.id AND r.status = 'active') THEN 0
  ELSE COALESCE((SELECT s.amount_minor / 100.0 FROM shared_expenses e
    JOIN transaction_splits s ON s.shared_expense_id = e.id AND s.shared_active = 1 AND s.contact_id IS NULL
    WHERE e.transaction_id = transactions.id AND e.status = 'active'), amount) END`;
