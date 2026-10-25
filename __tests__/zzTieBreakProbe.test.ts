// TEMPORARY probe (deleted after use): plans and sums per tie-break candidate.
import { dashboardFixture } from './helpers/dashboardFixture';
import { PERSONAL_AMOUNT_SQL } from '../src/modules/transactions/repositories/sharedFinancialProjectionSql';
import { TRANSACTION_DAY_SQL } from '../src/shared/utils/transactionDate';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));

test('probe', async () => {
  const fixture = await dashboardFixture();
  fixture.native.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1000)
    INSERT INTO transactions(id, amount, currency, description, date, account_id, type, direction, status, created_at, updated_at)
    SELECT 'load-' || n, CASE WHEN n % 3 = 0 THEN 1.1 ELSE 1 END, 'COP', 'x', '2026-10-24', 'bank',
      CASE WHEN n % 4 = 0 THEN 'income' ELSE 'expense' END, CASE WHEN n % 4 = 0 THEN 'inflow' ELSE 'outflow' END,
      CASE WHEN n % 10 = 9 THEN 'pending' ELSE 'posted' END, '2026-10-24', '2026-10-24' FROM seq;`);
  const where = `WHERE ${TRANSACTION_DAY_SQL} >= '2026-10' AND ${TRANSACTION_DAY_SQL} < '2026-11' AND status = 'posted'
    AND substr(${TRANSACTION_DAY_SQL}, 1, 7) = '2026-10' AND ((type = 'income' AND direction = 'inflow') OR (type = 'expense' AND direction = 'outflow'))`;
  const out: Record<string, unknown> = {};
  const plan = (sql: string) => fixture.native.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(r => (r as { detail: string }).detail);
  const sums = (sql: string) => {
    const rows = fixture.native.prepare(sql).all() as { amount: number; type: string; id: string }[];
    const inc = rows.filter(r => r.type === 'income').reduce((t, r) => t + r.amount, 0);
    const exp = rows.filter(r => r.type === 'expense').reduce((t, r) => t + r.amount, 0);
    return { monthlyIncome: inc, monthlyExpenses: exp, monthlySavings: inc - exp, first: rows.slice(0, 3).map(r => r.id) };
  };
  for (const [name, tail] of Object.entries({
    current: 'date DESC, created_at DESC',
    rowidDesc: 'date DESC, created_at DESC, rowid DESC',
    rowidAsc: 'date DESC, created_at DESC, rowid ASC',
    idDesc: 'date DESC, created_at DESC, id DESC',
    idAsc: 'date DESC, created_at DESC, id ASC',
  })) {
    const sql = `SELECT id, amount, type, direction, ${PERSONAL_AMOUNT_SQL} AS personal_amount FROM transactions ${where} ORDER BY ${tail}`;
    out[`amounts.${name}`] = { plan: plan(sql), ...sums(sql) };
    const full = `SELECT id, amount, type FROM transactions ORDER BY ${tail}`;
    out[`full.${name}`] = { plan: plan(full) };
  }
  out.cardRecon = plan(`SELECT id FROM transactions INDEXED BY idx_transactions_date WHERE status != 'cancelled' ORDER BY date DESC, created_at DESC, rowid DESC`);
  console.log(JSON.stringify(out, null, 1));
  fixture.native.close();
});
