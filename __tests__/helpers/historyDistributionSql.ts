// Synthetic date distributions for phase 5E.2: pure SQL without Node or RN
// imports, so 100k rows stay cheap. No real financial data or random seed.
export const HISTORY_DISTRIBUTIONS = [
  'canonicalUtc', // full ISO with milliseconds
  'secondsUtc', // full ISO without milliseconds (length 20)
  'civil', // civil_date + local_time (phase 5E.1 Android fixture)
  'legacyDay', // valid YYYY-MM-DD spread over three years, no civil_date
  'legacyTied', // single YYYY-MM-DD and created_at (phase 5E.1 Android fixture)
  'legacyCivilDate', // civil_date with date precision only
  'legacyWithInvalid', // legacyDay plus a few invalid/impossible days
  'legacyWithCivil', // legacyDay mixed with civil date-time rows
  'legacyWithOffset', // legacyDay mixed with offset timestamps
  'legacyWithCivilTime', // legacyDay mixed with non-midnight civil times (no ties)
  'legacyWithSeconds', // legacyDay mixed with length-20 UTC keys
  'secondsAndMillis', // length-20 and length-24 UTC keys (not text-orderable)
  'mixed', // phase 5E.1 Android mixed fixture
] as const;
export type HistoryDistribution = (typeof HISTORY_DISTRIBUTIONS)[number];

const spreadDay = "date('2023-10-11', '+' || ((n * 37) % 1096) || ' days')";
function columns(distribution: HistoryDistribution) {
  let date = spreadDay;
  let civil = 'NULL';
  let time = 'NULL';
  let precision = 'NULL';
  switch (distribution) {
    case 'canonicalUtc':
      date = `strftime('%Y-%m-%dT%H:%M:%f', ${spreadDay}, '+' || (n % 86400) || ' seconds') || 'Z'`;
      break;
    case 'secondsUtc':
      date = `strftime('%Y-%m-%dT%H:%M:%S', ${spreadDay}, '+' || (n % 86400) || ' seconds') || 'Z'`;
      break;
    case 'civil':
      date = "printf('2026-%02d-%02dT%02d:00:00.000Z',9+n%2,1+n%28,5+n%18)";
      civil = "printf('2026-%02d-%02d',9+n%2,1+n%28)";
      time = "printf('%02d:00',n%18)";
      precision = "'dateTime'";
      break;
    case 'legacyTied':
      date = "'2026-10-24'";
      break;
    case 'legacyCivilDate':
      civil = spreadDay;
      precision = "'date'";
      break;
    case 'legacyWithInvalid':
      date = `CASE n % 997 WHEN 0 THEN 'invalid' WHEN 1 THEN '2026-02-31' WHEN 2 THEN '2026-13-01' ELSE ${spreadDay} END`;
      break;
    case 'legacyWithCivil':
      date = `CASE WHEN n % 11 = 0 THEN ${spreadDay} || 'T05:00:00.000Z' ELSE ${spreadDay} END`;
      civil = `CASE WHEN n % 11 = 0 THEN ${spreadDay} END`;
      time = "CASE WHEN n % 11 = 0 THEN '00:00' END";
      precision = "CASE WHEN n % 11 = 0 THEN 'dateTime' END";
      break;
    case 'legacyWithOffset':
      date = `CASE WHEN n % 13 = 0 THEN ${spreadDay} || 'T23:30:00-05:00' ELSE ${spreadDay} END`;
      break;
    case 'legacyWithCivilTime':
      date = `CASE WHEN n % 11 = 0 THEN strftime('%Y-%m-%dT%H:%M:%f', ${spreadDay}, '+14 hours', '+30 minutes') || 'Z' ELSE ${spreadDay} END`;
      civil = `CASE WHEN n % 11 = 0 THEN ${spreadDay} END`;
      time = "CASE WHEN n % 11 = 0 THEN '09:30' END";
      precision = "CASE WHEN n % 11 = 0 THEN 'dateTime' END";
      break;
    case 'legacyWithSeconds':
      date = `CASE WHEN n % 11 = 0 THEN ${spreadDay} || 'T' || printf('%02d', n % 24) || ':00:00Z' ELSE ${spreadDay} END`;
      break;
    case 'secondsAndMillis':
      date = `CASE WHEN n % 2 = 0 THEN ${spreadDay} || 'T05:00:00Z' ELSE ${spreadDay} || 'T05:00:00.500Z' END`;
      break;
    case 'mixed':
      date = "CASE n%5 WHEN 0 THEN '2026-10-24' WHEN 1 THEN '2026-10-24T04:00:00-05:00' WHEN 2 THEN 'invalid' WHEN 3 THEN '2026-02-31' ELSE '2026-10-24T00:00:00.000Z' END";
      break;
    case 'legacyDay':
      break;
  }
  return { date, civil, time, precision };
}

// Pure SQL so Node and the synthetic Android APK seed byte-identical histories.
export function historySeedStatements(distribution: HistoryDistribution, size: number): string[] {
  const { date, civil, time, precision } = columns(distribution);
  const createdAt = distribution === 'legacyTied' || distribution === 'mixed'
    ? "'2026-10-24'"
    // Groups of three share created_at, so rowid decides some ties.
    : "strftime('%Y-%m-%dT%H:%M:%fZ', '2026-10-10', '+' || (n / 3) || ' seconds')";
  return [`INSERT OR IGNORE INTO accounts (id, name, type, status, currency, balance_amount, debt_balance_amount, created_at, updated_at)
    VALUES ('bank', 'bank', 'bankAccount', 'active', 'COP', 1000, NULL, '2026-01-01', '2026-01-01'),
      ('cash', 'cash', 'cash', 'active', 'COP', 100, NULL, '2026-01-01', '2026-01-01'),
      ('savings', 'savings', 'savingsAccount', 'active', 'COP', 2000, NULL, '2026-01-01', '2026-01-01'),
      ('card', 'card', 'creditCard', 'active', 'COP', 900, 400, '2026-01-01', '2026-01-01');`,
  `INSERT OR IGNORE INTO categories(id, name, type, macro_category, color) VALUES
    ('food', 'Comida', 'expense', 'needs', '#000000'), ('transport', 'Transporte', 'expense', 'needs', '#000000');`,
  `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${size})
    INSERT INTO transactions(id, amount, currency, description, date, civil_date, local_time, time_zone,
      date_precision, account_id, category_id, type, direction, status, target_account_id, merchant_name,
      notes, created_at, updated_at)
    SELECT 'history-' || n, (n % 10000) + CASE WHEN n % 3 = 0 THEN 0.1 ELSE 0.2 END, 'COP',
      CASE WHEN n % 7 = 0 THEN 'ÁRBOL Σ café %_' WHEN n % 101 = 0 THEN 'Nul' || char(0) || 'merchant'
        ELSE 'Synthetic merchant ' || (n % 50) END,
      ${date}, ${civil}, ${time}, CASE WHEN ${time} IS NULL THEN NULL ELSE 'America/Bogota' END, ${precision},
      CASE n % 4 WHEN 0 THEN 'bank' WHEN 1 THEN 'cash' WHEN 2 THEN 'savings' ELSE 'card' END,
      CASE WHEN n % 3 = 0 THEN 'food' WHEN n % 3 = 1 THEN 'transport' ELSE NULL END,
      CASE WHEN n % 5 = 0 THEN 'internalTransfer' WHEN n % 5 = 1 THEN 'income' ELSE 'expense' END,
      CASE WHEN n % 5 = 1 THEN 'inflow' ELSE 'outflow' END,
      CASE WHEN n % 10 < 8 THEN 'posted' WHEN n % 10 = 8 THEN 'pending' ELSE 'cancelled' END,
      CASE WHEN n % 5 = 0 THEN 'savings' WHEN n % 9 = 0 THEN 'bank' ELSE NULL END,
      CASE WHEN n % 4 = 0 THEN 'Tienda İΩ ' || (n % 50) ELSE NULL END,
      CASE WHEN n % 6 = 0 THEN 'Literal %_ Unicode İΩ' ELSE 'Synthetic notes used to represent the full-history payload.' END,
      ${createdAt}, ${createdAt} FROM seq WHERE n <= ${size};`];
}
