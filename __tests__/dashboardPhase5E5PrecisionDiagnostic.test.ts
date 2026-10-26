import { getDashboardSummaryFromDb } from '../src/modules/dashboard/useCases/getDashboardSummary';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { PERSONAL_AMOUNT_SQL } from '../src/modules/transactions/repositories/sharedFinancialProjectionSql';
import { TRANSACTION_DAY_SQL } from '../src/shared/utils/transactionDate';
import { formatCurrency } from '../src/shared/utils/formatCurrency';
import { realSQLite } from './helpers/realSQLite';
import { representativeSeedStatements, type RepresentativeSize } from './helpers/representativeHistory';

// Phase 5E.5 monetary precision diagnostic over the representative histories
// (100k/50 calendar years, 10k/5 years, 1k/6 months), month by month. Diagnostic only:
// the dashboard, its accumulation order and the monetary model are not changed and
// no tolerance is applied. The "centavos" profile rewrites amounts of the same dated
// history to two decimals; it is a separate amount distribution, not a volume benchmark.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
const process = require('node:process') as { env: Record<string, string | undefined>; version: string; versions: Record<string, string> };
const fs = require('node:fs') as { writeFileSync: (f: string, c: string) => void; mkdirSync: (p: string, o: object) => void };

const ORDERS = {
  current: 'date DESC, created_at DESC',
  rowidAsc: 'date DESC, created_at DESC, rowid ASC',
  rowidDesc: 'date DESC, created_at DESC, rowid DESC',
} as const;
const exactFormat = new Intl.NumberFormat('es-CO', { currency: 'COP', maximumFractionDigits: 0, minimumFractionDigits: 0, style: 'currency' });
const centsText = (cents: bigint) => {
  const sign = cents < 0n ? '-' : '', abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};

async function fixture(size: RepresentativeSize, centavos: boolean) {
  const sql = realSQLite();
  sql.native.exec('PRAGMA foreign_keys=ON');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  for (const statement of representativeSeedStatements(size)) sql.native.exec(statement);
  if (centavos) sql.native.exec("UPDATE transactions SET amount = amount + ((rowid * 7919) % 100) / 100.0 WHERE id LIKE 'rep-%'");
  return sql;
}

async function diagnose(size: RepresentativeSize, centavos: boolean) {
  const sql = await fixture(size, centavos);
  try {
    const months = (sql.native.prepare(`SELECT DISTINCT substr(${TRANSACTION_DAY_SQL},1,7) AS m FROM transactions ORDER BY m`).all() as { m: string }[]).map(r => r.m);
    const totals = { months: months.length, productionEqualsCurrentOrder: 0, binaryDiffersFromExact: 0, displayV8DiffersFromExact: 0,
      exactEndsInHalfPeso: 0, rowidDescDiffersBinary: 0, rowidDescDiffersDisplay: 0, maxAbsErrorPesos: 0 };
    const examples: unknown[] = [];
    for (const month of months) {
      const summary = await getDashboardSummaryFromDb(sql.database, new Date(`${month}-15T17:00:00.000Z`));
      const where = `WHERE status = 'posted' AND substr(${TRANSACTION_DAY_SQL}, 1, 7) = '${month}'
        AND ((type = 'income' AND direction = 'inflow') OR (type = 'expense' AND direction = 'outflow'))`;
      const sums = Object.fromEntries(Object.entries(ORDERS).map(([name, order]) => {
        const rows = sql.native.prepare(`SELECT type, ${PERSONAL_AMOUNT_SQL} AS amount FROM transactions ${where} ORDER BY ${order}`).all() as { type: string; amount: number }[];
        return [name, { income: rows.filter(r => r.type === 'income').reduce((t, r) => t + r.amount, 0),
          expenses: rows.filter(r => r.type === 'expense').reduce((t, r) => t + r.amount, 0), rows }];
      })) as Record<keyof typeof ORDERS, { income: number; expenses: number; rows: { type: string; amount: number }[] }>;
      // Exact decimal reference: every amount has at most two decimals.
      const cents = (type: string) => sums.current.rows.filter(r => r.type === type).reduce((t, r) => {
        const value = Math.round(r.amount * 100);
        expect(value / 100).toBe(r.amount);
        return t + BigInt(value);
      }, 0n);
      const exact = { income: cents('income'), expenses: cents('expense') };
      if (summary.monthlyIncome === sums.current.income && summary.monthlyExpenses === sums.current.expenses) totals.productionEqualsCurrentOrder++;
      const fieldsOf = (s: { income: number; expenses: number }) => ({ income: s.income, expenses: s.expenses, savings: s.income - s.expenses });
      const exactFields = { income: exact.income, expenses: exact.expenses, savings: exact.income - exact.expenses };
      const production = fieldsOf({ income: summary.monthlyIncome, expenses: summary.monthlyExpenses });
      let binary = false, display = false, half = false;
      for (const key of ['income', 'expenses', 'savings'] as const) {
        const text = centsText(exactFields[key]);
        if (production[key] !== Number(text)) binary = true;
        totals.maxAbsErrorPesos = Math.max(totals.maxAbsErrorPesos, Math.abs(production[key] - Number(text)));
        // V8 (Node/HONOR) formats the binary double; API 24 formats the exact decimal (5E.3).
        if (formatCurrency(production[key], 'COP') !== exactFormat.format(text as unknown as number)) display = true;
        if (text.endsWith('.50')) half = true;
      }
      if (binary) totals.binaryDiffersFromExact++;
      if (display) { totals.displayV8DiffersFromExact++; if (examples.length < 5) examples.push({ month, production, exact: Object.fromEntries(Object.entries(exactFields).map(([k, v]) => [k, centsText(v)])) }); }
      if (half) totals.exactEndsInHalfPeso++;
      const desc = fieldsOf(sums.rowidDesc);
      if (JSON.stringify(desc) !== JSON.stringify(production)) totals.rowidDescDiffersBinary++;
      if ((['income', 'expenses', 'savings'] as const).some(k => formatCurrency(desc[k], 'COP') !== formatCurrency(production[k], 'COP'))) totals.rowidDescDiffersDisplay++;
      expect(fieldsOf(sums.rowidAsc)).toEqual(production);
    }
    return { size, profile: centavos ? 'centavos' : 'representative', ...totals, examples };
  } finally { sql.native.close(); }
}

test('5E.5 precision diagnostic: representative histories are exact; centavo amounts expose binary and display differences', async () => {
  const results = [];
  // 100k/50 years takes minutes in Node: always run 1k and 10k, 100k on request.
  const sizes: RepresentativeSize[] = process.env.SMARTFIN_5E5_DIAGNOSTIC ? [1000, 10000, 100000] : [1000, 10000];
  for (const size of sizes) for (const centavos of [false, true]) results.push(await diagnose(size, centavos));
  for (const r of results) {
    // Production equals the current effective accumulation order in every month.
    expect(r.productionEqualsCurrentOrder).toBe(r.months);
    if (r.profile === 'representative') {
      // Whole and half pesos are dyadic: every order is exact and the display matches.
      expect(r.binaryDiffersFromExact).toBe(0);
      expect(r.displayV8DiffersFromExact).toBe(0);
      expect(r.rowidDescDiffersBinary).toBe(0);
    }
  }
  if (process.env.SMARTFIN_5E5_DIAGNOSTIC) {
    fs.mkdirSync('docs/recuperabilidad-fase5e5/node', { recursive: true });
    fs.writeFileSync('docs/recuperabilidad-fase5e5/node/precision.json', JSON.stringify({ runtime: process.version, icu: process.versions.icu, results }, null, 2));
  }
}, 600000);
