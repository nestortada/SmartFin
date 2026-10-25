// Phase 5E.3 acceptance volume (AGENTS.md "Performance Volumes"): 100,000
// movements are ~50 years of use, ~5-6 per day. Pure SQL applied after the
// 5E.2 legacyDay seed, so Node and the synthetic APK rewrite identical histories.
export const FIFTY_YEAR_SHAPES = [
  'civil', // current app format: civil_date + local_time over the whole span
  'legacy', // valid YYYY-MM-DD only, no civil_date
  'migrated', // first ~40 years legacy YYYY-MM-DD, last ~10 years civil date-time
] as const;
export type FiftyYearShape = (typeof FIFTY_YEAR_SHAPES)[number];

const DAYS = 18262; // 1976-10-26 .. 2026-10-25
// Permutation of days over rowid: every day receives ~size/18262 movements.
const day = `date('1976-10-26', '+' || ((rowid * 7919) % ${DAYS}) || ' days')`;
const dayIndex = `((rowid * 7919) % ${DAYS})`;
const time = "printf('%02d:%02d', 6 + rowid % 16, (rowid * 7) % 60)";

export function fiftyYearStatements(shape: FiftyYearShape): string[] {
  const civil = shape === 'civil' || shape === 'migrated';
  const civilWhere = shape === 'migrated' ? `${dayIndex} >= ${DAYS - 3653}` : '1';
  return [
    // Legacy day for every row first; civil rows get their civil fields below.
    `UPDATE transactions SET date = ${day}, civil_date = NULL, local_time = NULL, time_zone = NULL, date_precision = NULL;`,
    ...(civil ? [`UPDATE transactions SET civil_date = date, local_time = ${time}, time_zone = 'America/Bogota', date_precision = 'dateTime',
      date = strftime('%Y-%m-%dT%H:%M:00.000Z', date || ' ' || ${time}, '+5 hours') WHERE ${civilWhere};`] : []),
    // created_at follows the movement day (entry on the same day), with ties left to rowid.
    `UPDATE transactions SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(civil_date, date), '+' || (12 + rowid % 8) || ' hours'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(civil_date, date), '+' || (12 + rowid % 8) || ' hours');`,
  ];
}
