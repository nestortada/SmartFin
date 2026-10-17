/** Indexed civil-date range; always one row, no journal history crosses the bridge. */
export const SHARED_LOSS_PERIOD_SQL = `SELECT
  CAST(COALESCE(SUM(CASE WHEN kind = 'forgiveness' THEN amount_minor ELSE 0 END),0) AS TEXT) AS losses,
  CAST(COALESCE(SUM(CASE WHEN kind = 'forgivenessReversal' THEN amount_minor ELSE 0 END),0) AS TEXT) AS reversals,
  CAST(COALESCE(SUM(CASE WHEN kind = 'recovery' THEN amount_minor ELSE 0 END),0) AS TEXT) AS recoveries,
  CAST(COALESCE(SUM(CASE WHEN kind = 'recoveryReversal' THEN amount_minor ELSE 0 END),0) AS TEXT) AS recovery_reversals
  FROM shared_loss_events WHERE date >= ? AND date < ?;`;
