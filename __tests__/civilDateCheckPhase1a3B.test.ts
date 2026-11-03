// Phase 1a.3B after r3: the migration 5 civil-date CHECK must equal parseCivilDate without SQLite's date() function,
// whose result differs between SQLite 3.9.2 (Android 7 returned 2026-02-30 unchanged) and later versions.
// Synthetic in-memory SQLite only.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { financialIntegrityFixture } from './helpers/financialIntegrityFixture';
import { realSQLite } from './helpers/realSQLite';
import { CIVIL_DATE_CHECK, INSTALLMENT_HISTORY_SCHEMA } from '../src/modules/creditCards/database/installmentHistorySchema';
import { parseCivilDate } from '../src/modules/creditCards/useCases/installmentPlan';

const YEARS = [0, 1, 4, 99, 100, 400, 1600, 1900, 2000, 2023, 2024, 2026, 2100, 2400, 9996, 9999];
const pad = (value: number, size: number) => String(value).padStart(size, '0');
const MALFORMED = ['2026-2-01', '2026-02-1', '26-02-01', '2026/02/01', '2026-02-01T00:00:00Z', ' 2026-02-01', '2026-02-01 ',
  '2026-0a-01', 'abcd-ef-gh', '2026--2-01', '+026-02-01', '2026-02-0١', '２０２６-02-01', '', '2026-02-01\n',
  '20261020', '2026-02-1\u0000'];

function checker() {
  const sql = realSQLite();
  sql.native.exec(`CREATE TABLE civil (x TEXT CHECK(${CIVIL_DATE_CHECK('x')}))`);
  const accepts = (value: string | number | null) => {
    try { sql.native.prepare('INSERT INTO civil (x) VALUES (?)').run(value); return true; } catch { return false; }
  };
  return { sql, accepts };
}

test('the CHECK accepts exactly the dates parseCivilDate accepts (Gregorian leap years, 30/31-day months)', () => {
  const { sql, accepts } = checker();
  try {
    let compared = 0;
    for (const year of YEARS) for (let month = 0; month <= 13; month++) for (let day = 0; day <= 32; day++) {
      const value = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
      expect([value, accepts(value)]).toEqual([value, parseCivilDate(value) !== undefined]);
      compared++;
    }
    for (const value of MALFORMED) expect([value, accepts(value)]).toEqual([value, parseCivilDate(value) !== undefined]);
    expect(compared).toBe(YEARS.length * 14 * 33);
  } finally { sql.native.close(); }
});

test('boundary cases named by the correction', () => {
  const { sql, accepts } = checker();
  try {
    const cases: [string, boolean][] = [
      ['2026-04-30', true], ['2026-04-31', false], ['2026-01-31', true], ['2026-12-31', true],
      ['2026-02-28', true], ['2026-02-29', false], ['2026-02-30', false], ['2024-02-29', true], ['2024-02-30', false],
      ['1900-02-29', false], ['2100-02-29', false], ['2000-02-29', true], ['2400-02-29', true],
      ['2026-00-10', false], ['2026-13-10', false], ['2026-10-00', false], ['0000-01-01', false], ['0001-01-01', true],
      ['9999-12-31', true],
    ];
    for (const [value, valid] of cases) expect([value, accepts(value)]).toEqual([value, valid]);
    // Non-text values never pass: TEXT affinity makes 20261020 an 8-character text, or the CHECK sees an integer.
    expect(accepts(20261020)).toBe(false);
    // The expression itself rejects NULL (CASE -> 0): a NULL CHECK result, which SQLite would treat as a pass, cannot occur.
    expect(accepts(null)).toBe(false);
  } finally { sql.native.close(); }
});

test('NULL is allowed only where migration 5 allows it; direct inserts and updates are checked', async () => {
  const f = await financialIntegrityFixture();
  try {
    const created = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3', amount: 300000 });
    const purchaseId = `installment-${created.transaction.id}`;
    // 1a.4A: the purchase is saved with its revision 0; this probe inserts revision 0 by hand instead.
    f.native.exec('DELETE FROM installment_plan_revisions');
    const run =(sql: string, values: (string | number | null)[] = []) => {
      try { f.native.prepare(sql).run(...values); return 'accepted'; }
      catch (error) { return /CHECK|NOT NULL/.exec(String(error))?.[0] ?? String(error); }
    };
    const firstCycle = (value: string | null) => run("INSERT INTO installment_first_cycles VALUES (?, ?, 'user', 'x', 'x')", [purchaseId, value]);
    expect(firstCycle(null)).toBe('NOT NULL');
    expect(firstCycle('2026-02-29')).toBe('CHECK');
    expect(firstCycle('2026-10-20')).toBe('accepted');
    expect(run('UPDATE installment_first_cycles SET cycle_end = ? WHERE installment_purchase_id = ?', ['2026-02-30', purchaseId])).toBe('CHECK');
    expect(run('UPDATE installment_first_cycles SET cycle_end = ? WHERE installment_purchase_id = ?', ['2028-02-29', purchaseId])).toBe('accepted');
    const revision = (cycle: string | null) => run(`INSERT INTO installment_plan_revisions
      (id, installment_purchase_id, revision_number, source, verification, pending_reasons, effective_cycle_end, basis_total_amount,
      basis_monthly_amount, basis_installment_count, created_at)
      VALUES (?, ?, 0, 'original', 'pendingVerification', 'manualReview', ?, 1, 1, 1, 'x')`, [`${purchaseId}:revision:0`, purchaseId, cycle]);
    // pendingVerification keeps a NULL effective cycle; impossible dates are rejected and leave no row.
    expect(revision('2026-02-30')).toBe('CHECK');
    expect(revision('2026-13-01')).toBe('CHECK');
    expect(revision(null)).toBe('accepted');
    expect(f.query('SELECT effective_cycle_end FROM installment_plan_revisions').rows.raw()).toEqual([{ effective_cycle_end: null }]);
  } finally { f.native.close(); }
});

test('migration 5 no longer uses date() and keeps the CASE guard against NULL results', () => {
  const schema = INSTALLMENT_HISTORY_SCHEMA.join('\n');
  expect(schema).not.toMatch(/\bdate\s*\(/i);
  expect(schema.match(/GLOB '\[0-9\]\[0-9\]\[0-9\]\[0-9\]-\[0-9\]\[0-9\]-\[0-9\]\[0-9\]'/g)).toHaveLength(2);
  expect(schema.match(/THEN 1 ELSE 0 END\) = 1/g)).toHaveLength(2);
});

test('r3 reproduction: the previous date() CHECK rejects these dates on Node SQLite (Android 3.9.2 accepted them)', () => {
  const sql = realSQLite();
  try {
    sql.native.exec('CREATE TABLE previous (x TEXT CHECK(length(x) = 10 AND date(x) IS x))');
    const accepts = (value: string) => { try { sql.native.prepare('INSERT INTO previous VALUES (?)').run(value); return true; } catch { return false; } };
    expect([accepts('2026-02-30'), accepts('2026-02-29'), accepts('2026-02-28')]).toEqual([false, false, true]);
    // Node's engine normalizes or rejects the impossible date instead of echoing it.
    const [row] = sql.native.prepare("SELECT date('2026-02-30') AS d").all();
    expect(row!.d).not.toBe('2026-02-30');
  } finally { sql.native.close(); }
});
