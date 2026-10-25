import { dashboardFixture } from './helpers/dashboardFixture';
import { representativeSeedStatements } from './helpers/representativeHistory';
import { historySeedStatements } from './helpers/historyDistributionSql';

// Phase 5E.4: the annual CSV query adds a range on the indexed civil-day expression
// (idx_transactions_civil_day). The original predicate stays, so membership cannot
// change; this suite proves identical rows, columns and order against the frozen query.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
const process = require('node:process') as { env: Record<string, string | undefined> };
const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };

const SELECT = `SELECT t.id, COALESCE(t.civil_date, substr(t.date,1,10)) AS fecha, t.local_time AS hora, t.time_zone AS zona_horaria,
  t.date_precision AS precision_fecha, t.date AS fecha_original, t.description AS descripcion, t.amount AS monto, t.currency AS moneda,
  t.type AS tipo, t.direction AS direccion, t.status AS estado, a.name AS cuenta, ta.name AS cuenta_destino, c.name AS categoria,
  s.name AS subcategoria, t.merchant_name AS comercio, t.payment_method AS medio_pago, t.credit_card_hint AS tarjeta, t.notes AS notas,
  t.created_at AS creado_en, t.updated_at AS actualizado_en FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts ta ON ta.id = t.target_account_id LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN subcategories s ON s.id = t.subcategory_id `;
const ORDER = 'ORDER BY COALESCE(t.civil_date, substr(t.date,1,10)), t.local_time, t.created_at;';
// Frozen 5E.3 query (SmartFinBackupCsv.YEARLY_TRANSACTIONS_QUERY).
export const LEGACY_YEAR_QUERY = `${SELECT}WHERE substr(COALESCE(t.civil_date, t.date), 1, 4) = ? ${ORDER}`;
// Same predicate plus an indexable superset range [year, next year). Android binds
// only non-null strings, so year 9999 uses the variant without an upper bound.
export const RANGE_YEAR_QUERY = `${SELECT}WHERE COALESCE(t.civil_date, substr(t.date,1,10)) >= ?1
  AND COALESCE(t.civil_date, substr(t.date,1,10)) < ?2 AND substr(COALESCE(t.civil_date, t.date), 1, 4) = ?1 ${ORDER}`;
export const RANGE_LAST_YEAR_QUERY = `${SELECT}WHERE COALESCE(t.civil_date, substr(t.date,1,10)) >= ?1
  AND substr(COALESCE(t.civil_date, t.date), 1, 4) = ?1 ${ORDER}`;
const YEARS = "SELECT DISTINCT substr(COALESCE(civil_date, date), 1, 4) AS year FROM transactions WHERE date GLOB '[0-9][0-9][0-9][0-9]-*' ORDER BY year;";

type Fixture = Awaited<ReturnType<typeof dashboardFixture>>;
function compare(fixture: Fixture) {
  const years = (fixture.native.prepare(YEARS).all() as { year: string }[]).map(r => r.year);
  const legacy = fixture.native.prepare(LEGACY_YEAR_QUERY);
  const range = fixture.native.prepare(RANGE_YEAR_QUERY);
  const last = fixture.native.prepare(RANGE_LAST_YEAR_QUERY);
  let rows = 0; let legacyMs = 0; let rangeMs = 0;
  for (const year of years) {
    let start = performance.now();
    const expected = legacy.all(year);
    legacyMs += performance.now() - start;
    start = performance.now();
    const actual = year === '9999' ? last.all(year) : range.all(year, String(Number(year) + 1).padStart(4, '0'));
    rangeMs += performance.now() - start;
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
    rows += expected.length;
  }
  return { years: years.length, rows, legacyMs: Math.round(legacyMs), rangeMs: Math.round(rangeMs) };
}

test('range plan uses the civil-day index instead of a full scan per year', async () => {
  const fixture = await dashboardFixture([]);
  try {
    const plan = (sql: string) => (fixture.native.prepare('EXPLAIN QUERY PLAN ' + sql).all() as { detail: string }[]).map(r => r.detail).join(' | ');
    expect(plan(LEGACY_YEAR_QUERY.replace('?', "'2026'"))).toMatch(/SCAN t\b/);
    expect(plan(RANGE_YEAR_QUERY.replace(/\?1/g, "'2026'").replace(/\?2/g, "'2027'"))).toMatch(/idx_transactions_civil_day/);
  } finally { fixture.native.close(); }
});

test.each([1000, 10000] as const)('representative %i: identical rows and order per year', async size => {
  const fixture = await dashboardFixture([]);
  try {
    for (const s of representativeSeedStatements(size)) fixture.native.exec(s);
    expect(compare(fixture).rows).toBe(size);
  } finally { fixture.native.close(); }
}, 120000);

// Legacy YYYY-MM-DD, offsets, invalid and impossible dates, civil rows, and full ties
// of day/local_time/created_at, where only the engine's scan order decides.
test.each(['legacyWithInvalid', 'legacyWithOffset', 'legacyWithCivil', 'mixed', 'legacyTied', 'civil'] as const)(
  '%s: identical rows and order per year, including full ties', async distribution => {
    const fixture = await dashboardFixture([]);
    try {
      for (const s of historySeedStatements(distribution, 3000)) fixture.native.exec(s);
      fixture.native.exec("UPDATE transactions SET created_at = '2026-10-10' WHERE rowid % 4 = 0;");
      fixture.native.exec("UPDATE transactions SET civil_date = '9999-12-31', local_time = '00:00' WHERE rowid = 5;");
      fixture.native.exec("UPDATE transactions SET date = '0001-01-01', civil_date = NULL WHERE rowid = 6;");
      compare(fixture);
    } finally { fixture.native.close(); }
  }, 120000);

(process.env.SMARTFIN_5E4_LARGE === '1' ? test : test.skip)('representative 100000 (50 calendar years): identical and timed', async () => {
  const fixture = await dashboardFixture([]);
  try {
    for (const s of representativeSeedStatements(100000)) fixture.native.exec(s);
    const result = compare(fixture);
    expect(result).toEqual(expect.objectContaining({ years: 50, rows: 100000 }));
    console.log(JSON.stringify(result));
  } finally { fixture.native.close(); }
}, 600000);
