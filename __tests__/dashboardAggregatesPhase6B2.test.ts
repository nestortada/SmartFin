import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import {
  PHASE6B2_DATE,
  PHASE6B2_PROBES,
  centsText,
  intlProbe,
  oracleDouble,
  runPhase6B2Probe,
  textCents,
  type Phase6B2Implementation,
  type Phase6B2Probe,
} from '../scripts/phase6b2/probes';
import * as previousDashboard from './helpers/pre6B2DashboardSummary';
import { getDashboardSummary, getDashboardSummaryFromDb } from '../src/modules/dashboard/useCases/getDashboardSummary';
import { formatCurrency } from '../src/shared/utils/formatCurrency';
import { formatCOP } from '../src/modules/transactions/ui/transactionsScreenFormatters';
import { buildDebitCardsOverview } from '../src/modules/accounts/useCases/getDebitCardsOverview';
import {
  addSafeCents,
  copAggregate,
  getCopAggregateFallbacks,
  resetCopAggregateFallbacks,
  sumCopAmounts,
} from '../src/shared/utils/exactCopCents';
import type { Account, AccountType } from '../src/modules/accounts';
import { REPRESENTATIVE_REFERENCE_DAY, representativeSeedStatements, type RepresentativeSize } from './helpers/representativeHistory';

// Phase 6B.2: dashboard aggregates (available, total debt, net worth with shared receivables and
// advances) accumulate exact cents and convert once; out-of-contract operands or totals keep the
// previous binary result bit for bit. Independent BigInt oracle over decimal texts; no tolerance.
// PHASE6B2_REPRODUCTION=1 writes the run as the pre-fix reproduction instead of the final results.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
const process = require('node:process') as { env: Record<string, string | undefined> };
const fs = require('node:fs') as { writeFileSync: (f: string, c: string) => void; mkdirSync: (p: string, o: object) => void };
const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };

const REPRODUCTION = process.env.PHASE6B2_REPRODUCTION === '1';
const PREVIOUS: Phase6B2Implementation = {
  name: 'previous',
  getDashboardSummaryFromDb: previousDashboard.getDashboardSummaryFromDb,
  formatCurrency: previousDashboard.formatCurrency,
};
const FIELDS = ['availableBalance', 'totalDebt', 'netWorth'] as const;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(PHASE6B2_DATE);
});
afterEach(() => jest.useRealTimers());

const results: Record<string, any> = { probes: {}, sweeps: {}, volume: {}, intl: intlProbe(formatCurrency), intlPrevious: intlProbe(previousDashboard.formatCurrency) };
afterAll(() => {
  fs.mkdirSync('docs/correccion-fase6b2/node', { recursive: true });
  const file = REPRODUCTION ? 'reproduction-before-fix.json' : 'results.json';
  fs.writeFileSync(`docs/correccion-fase6b2/node/${file}`, JSON.stringify(results, null, 2) + '\n');
});

async function freshDatabase() {
  const sql = realSQLite({ fixedSqlDate: PHASE6B2_DATE });
  sql.native.exec('PRAGMA foreign_keys = ON;');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  return sql;
}

async function probe(name: Phase6B2Probe): Promise<any> {
  const sql = await freshDatabase();
  try {
    const result = await runPhase6B2Probe(sql.database, name, PREVIOUS);
    expect(result.sqlite).toEqual({ integrity: 'ok', foreignKeyViolations: 0 });
    return (results.probes[name] = result);
  } finally { sql.native.close(); }
}

const nextMatchesOracle = (evaluation: any) => FIELDS.every(field => evaluation.figures[field].nextEqualsOracle);

if (REPRODUCTION) {
  // Before the fix both implementations are the same code: record the binary results only.
  test.each(PHASE6B2_PROBES)('reproduction %s', async name => { await probe(name); });
} else {
  describe('6B-D3 corrected: dashboard aggregates equal the decimal oracle', () => {
    test('P4: four exact balances that add up to 97.599,50 are shown as $ 97.600', async () => {
      const r = await probe('aggregateBalances');
      expect(r.figures.availableBalance).toMatchObject({ previous: '97599.49999999999', previousDisplay: formatCurrency(97599, 'COP'),
        next: '97599.5', nextDisplay: formatCurrency(97600, 'COP'), expected: '97599.50', nextEqualsOracle: true, visibleChange: true });
      expect(r.figures.netWorth).toMatchObject({ previous: '97599.49999999999', next: '97599.5', nextEqualsOracle: true });
      expect(r.databaseUnchanged).toBe(true);
    });

    test('total debt of three cards (production purchases) and the net worth it reduces', async () => {
      const r = await probe('debtAggregate');
      expect(r.debts).toEqual(['18160.76', '76543.65', '28611.09']);
      expect(r.figures.totalDebt).toMatchObject({ previous: '123315.49999999999', next: '123315.5', nextEqualsOracle: true, visibleChange: true });
      expect(nextMatchesOracle(r)).toBe(true);
    });

    test('net worth of every asset type minus card and loan debt; closed accounts excluded', async () => {
      const r = await probe('netWorthMixed');
      expect(r.figures.netWorth).toMatchObject({ previous: '21977729.499999996', expected: '21977729.50', nextEqualsOracle: true, visibleChange: true });
      expect(nextMatchesOracle(r)).toBe(true);
    });

    test('shared receivables and advances enter net worth exactly, once', async () => {
      const r = await probe('sharedPosition');
      expect(r.position).toMatchObject({ receivables: '169806.04', thirdPartyAdvances: '58752.99', receivablesEqualOracle: true, advancesEqualOracle: true });
      expect(r.figures.netWorth).toMatchObject({ previous: '8767355.499999998', expected: '8767355.50', nextEqualsOracle: true, visibleChange: true });
      expect(nextMatchesOracle(r)).toBe(true);
    });

    test('6B-D4 through aggregation: exact zero is +0 and shows $ 0 (previously −$ 0)', async () => {
      const r = await probe('zeroThroughAggregation');
      expect(r.figures.availableBalance).toMatchObject({ previous: '-2.7755575615628914e-17', previousDisplay: '-$ 0', next: '0', nextDisplay: '$ 0', nextEqualsOracle: true });
      expect(nextMatchesOracle(r)).toBe(true);
    });

    test('legitimate small and half amounts are neither hidden nor rounded by the aggregate', async () => {
      const r = await probe('smallAmounts');
      for (const evaluation of Object.values<any>(r).filter(v => v.figures)) expect(nextMatchesOracle(evaluation)).toBe(true);
      // A real −0,40 keeps its sign; a real 0,40 debt keeps its value (presentation policy unchanged, see report).
      expect(r.negativeFortyCents.figures.availableBalance).toMatchObject({ next: '-0.4', nextDisplay: '-$ 0', previousDisplay: '-$ 0' });
      expect(r.debtFortyCents.figures.totalDebt).toMatchObject({ next: '0.4', nextDisplay: '$ 0', visibleChange: false });
      expect(r.debtFortyCents.figures.netWorth).toMatchObject({ next: '-0.4', nextDisplay: '-$ 0' });
      expect(r.halfPositive.figures.availableBalance).toMatchObject({ next: '1234.5', nextDisplay: formatCurrency(1235, 'COP') });
      expect(r.halfNegative.figures.availableBalance).toMatchObject({ next: '-0.5', nextDisplay: formatCurrency(-1, 'COP') });
    });

    test('out-of-contract operands or totals keep the previous binary aggregate bit for bit', async () => {
      const r = await probe('outOfContract');
      for (const [name, evaluation] of Object.entries<any>(r).filter(([, v]) => v.figures)) {
        expect([name, evaluation.bitIdentical]).toEqual([name, true]);
        expect(evaluation.databaseUnchanged).toBe(true);
      }
      expect(r.historicalDrift.dashboardFallbacks).toMatchObject({ 'dashboard.availableBalance': 1, 'dashboard.netWorth': 1 });
      expect(r.historicalDrift.dashboardFallbacks['dashboard.totalDebt']).toBeUndefined();
      // The pre-6B.1 residue is not an exact zero: it stays visible as before.
      expect(r.historicalResidueZero.figures.availableBalance.nextDisplay).toBe('-$ 0');
      expect(r.unsafeTotal.dashboardFallbacks).toMatchObject({ 'dashboard.availableBalance': 1, 'dashboard.netWorth': 1 });
      expect(r.unsafeNetWorth.dashboardFallbacks).toEqual({ 'dashboard.netWorth': 1 });
    });

    test('economic rules hold step by step and the dashboard equals the oracle after every operation', async () => {
      const r = await probe('economicSequence');
      expect(r.counts).toMatchObject({ steps: 12, nextMismatch: 0, ruleViolations: 0, databaseChanged: 0 });
      expect(r.counts.previousMismatch).toBeGreaterThan(0);
      const byName = Object.fromEntries(r.steps.map((s: any) => [s.name, s]));
      // A reimbursement or forgiveness is not income; forgiveness is recognized as a loss.
      expect(byName.sharedReimbursement.monthlyIncome.next).toBe(byName.income.monthlyIncome.next);
      expect(byName.forgiveness.monthlyIncome.next).toBe(byName.income.monthlyIncome.next);
      expect(byName.forgiveness.monthlyNetLosses.next).toBe('4000.04');
    });
  });

  describe('sweeps against the oracle and the frozen pre-6B.2 dashboard', () => {
    const TYPES: AccountType[] = ['cash', 'bankAccount', 'savingsAccount', 'investment', 'creditCard', 'loan'];
    let seed = 6202;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const account = (index: number, type: AccountType, text: string, status: Account['status'] = 'active'): Account => ({
      id: `a${index}`, name: `Cuenta ${index}`, type, status, currency: 'COP', createdAt: '2026-01-01', updatedAt: '2026-01-01',
      balance: { amount: type === 'creditCard' || type === 'loan' ? 0 : Number(text), currency: 'COP' },
      debtBalance: type === 'creditCard' || type === 'loan' ? { amount: Number(text), currency: 'COP' } : undefined,
    });
    const both = (accounts: Account[]) => {
      const accountRepository = { getAccounts: () => accounts.map(a => ({ ...a })) } as any;
      return { next: getDashboardSummary({ accountRepository, currentDate: PHASE6B2_DATE }), previous: previousDashboard.getDashboardSummary({ accountRepository, currentDate: PHASE6B2_DATE }) };
    };
    const oracle = (rows: Array<[AccountType, string, Account['status']]>) => {
      const active = rows.filter(r => r[2] === 'active');
      const of = (types: AccountType[]) => active.filter(r => types.includes(r[0])).reduce((t, r) => t + textCents(r[1]), 0n);
      const available = of(['cash', 'bankAccount', 'savingsAccount']);
      const debt = of(['creditCard', 'loan']);
      return { availableBalance: available, totalDebt: debt, netWorth: available + of(['investment']) - debt };
    };
    const randomText = (decimals: boolean) => {
      const magnitude = 10 ** Math.floor(random() * 10);
      const cents = BigInt(Math.floor(random() * magnitude * 100)) * (random() < 0.15 ? -1n : 1n);
      return centsText(decimals ? cents : (cents / 100n) * 100n);
    };
    const randomRows = (decimals: boolean) => Array.from({ length: 1 + Math.floor(random() * 8) }, (): [AccountType, string, Account['status']] =>
      [TYPES[Math.floor(random() * TYPES.length)]!, randomText(decimals), random() < 0.1 ? 'closed' : 'active']);

    test('20.000 random account sets with cents: available, debt and net worth equal the oracle', () => {
      const counts = { sets: 0, nextMismatch: 0, previousMismatch: 0, previousVisible: 0 };
      for (let i = 0; i < 20000; i++) {
        const rows = randomRows(true);
        const { next, previous } = both(rows.map(([type, text, status], index) => account(index, type, text, status)));
        const expected = oracle(rows);
        counts.sets++;
        for (const field of FIELDS) {
          if (!Object.is(next[field], oracleDouble(expected[field]))) counts.nextMismatch++;
          if (!Object.is(previous[field], oracleDouble(expected[field]))) counts.previousMismatch++;
          if (formatCurrency(previous[field], 'COP') !== formatCurrency(oracleDouble(expected[field]), 'COP')) counts.previousVisible++;
        }
      }
      results.sweeps.cents = counts;
      expect(counts.nextMismatch).toBe(0);
      expect(counts.previousMismatch).toBeGreaterThan(0);
    });

    test('20.000 random whole-peso sets: identical bit for bit to the previous dashboard', () => {
      let different = 0;
      for (let i = 0; i < 20000; i++) {
        const rows = randomRows(false);
        const { next, previous } = both(rows.map(([type, text, status], index) => account(index, type, text, status)));
        for (const field of FIELDS) if (!Object.is(next[field], previous[field])) different++;
      }
      results.sweeps.pesos = { sets: 20000, different };
      expect(different).toBe(0);
    });

    test('5.000 sets with one out-of-contract operand: identical bit for bit to the previous dashboard', () => {
      const outside = [97599.49999999999, 0.005, -2.7755575615628914e-17, 70368744177664.5, 1.115];
      let different = 0;
      for (let i = 0; i < 5000; i++) {
        const accounts = randomRows(true).map(([type, text, status], index) => account(index, type, text, status));
        const type = TYPES[i % 4]!; // asset types, so the operand enters every aggregate it belongs to
        accounts.splice(Math.floor(random() * (accounts.length + 1)), 0, account(99, type, '0'));
        accounts.find(a => a.id === 'a99')!.balance.amount = outside[i % outside.length]!;
        const { next, previous } = both(accounts);
        // Only the aggregates that contain the operand fall back; the others stay exact.
        const affected: Array<(typeof FIELDS)[number]> = type === 'investment' ? ['netWorth'] : ['availableBalance', 'netWorth'];
        for (const field of affected) if (!Object.is(next[field], previous[field])) different++;
      }
      results.sweeps.outOfContract = { sets: 5000, different };
      expect(different).toBe(0);
    });

    test('mock repository dashboard (synchronous fallback) is unchanged', () => {
      const next = getDashboardSummary({ currentDate: PHASE6B2_DATE });
      const previous = previousDashboard.getDashboardSummary({ currentDate: PHASE6B2_DATE });
      expect(next).toEqual(previous);
    });
  });

  describe('previous-phase campaign whose "unchanged net worth" check 6B.2 intentionally changes', () => {
    test('6A Android shared scenario (scripts/phase6a/androidHarness.js): net worth is now the exact decimal', async () => {
      const sql = await freshDatabase();
      try {
        sql.native.exec(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES
          ('bank','Banco','bankAccount','active','COP',1000000.1,NULL,'2026-01-01','2026-01-01'),
          ('savings','Ahorro','savingsAccount','active','COP',2000.25,NULL,'2026-01-01','2026-01-01'),
          ('investment','Inversion','investment','active','COP',5000.35,NULL,'2026-01-01','2026-01-01'),
          ('card','Visa','creditCard','active','COP',0,400.15,'2026-01-01','2026-01-01'),
          ('loan','Prestamo','loan','active','COP',0,600.2,'2026-01-01','2026-01-01');
          INSERT OR IGNORE INTO categories(id,name,type,macro_category,color) VALUES('food','Alimentacion','expense','food','#ffffff');`);
        const { createSharedExpenseApi } = require('../src/modules/transactions/useCases/createSharedExpenseApi');
        const { createSqliteSharedExpenseRepository } = require('../src/modules/transactions/repositories/sqliteSharedExpenseRepository');
        const api = createSharedExpenseApi(createSqliteSharedExpenseRepository(sql.database));
        const contactId = (await api.saveContact('person', 'Amiga 6A')).entityId;
        const created = await api.createPurchase('phase6a-purchase', {
          purchase: { accountId: 'bank', amount: 30000.15, categoryId: 'food', merchantName: 'Restaurante', operationType: 'Débito', occurrence: { kind: 'date', date: '2026-10-05' } },
          distribution: { mode: 'amounts', personalAmount: 15000.07, participants: [{ contactId, amount: 15000.08 }] } });
        const overview = await api.getExpense(created.entityId);
        await api.forgiveParticipation('phase6a-forgive', { participationId: overview.participants[0].participationId, amount: 1000.01, date: '2026-10-06' });
        const date = new Date('2026-10-24T12:00:00.000Z');
        const previous = await previousDashboard.getDashboardSummaryFromDb(sql.database, date);
        const next = await getDashboardSummaryFromDb(sql.database, date);
        const assets = textCents('1000000.10') - textCents('30000.15') + textCents('2000.25') + textCents('5000.35');
        const debt = textCents('400.15') + textCents('600.20');
        const worth = assets - debt + textCents('15000.08') - textCents('1000.01');
        expect(next.netWorth).toBe(oracleDouble(worth));
        expect(next.availableBalance).toBe(oracleDouble(textCents('1000000.10') - textCents('30000.15') + textCents('2000.25')));
        expect(next.totalDebt).toBe(oracleDouble(debt));
        expect(Object.is(previous.netWorth, next.netWorth)).toBe(false);
        expect(formatCurrency(next.netWorth, 'COP')).toBe(previousDashboard.formatCurrency(previous.netWorth, 'COP'));
        results.phase6aSharedScenario = { previous: String(previous.netWorth), next: String(next.netWorth), expected: centsText(worth),
          display: formatCurrency(next.netWorth, 'COP'), availableBalance: String(next.availableBalance), totalDebt: String(next.totalDebt) };
      } finally { sql.native.close(); }
    });
  });

  describe('aggregate helpers', () => {
    test('addSafeCents is exact inside the safe range and refuses totals beyond it', () => {
      const max = Number.MAX_SAFE_INTEGER;
      expect(addSafeCents(max - 1, 1)).toBe(max);
      expect(addSafeCents(max, 1)).toBeUndefined();
      expect(addSafeCents(-max, -1)).toBeUndefined();
      expect(addSafeCents(max, -max)).toBe(0);
      expect(addSafeCents(undefined, 1)).toBeUndefined();
      expect(addSafeCents(1, undefined)).toBeUndefined();
      // Two safe operands whose exact total exceeds the range never round back to a safe integer.
      expect(addSafeCents(max, max)).toBeUndefined();
    });

    test('copAggregate converts exact cents once (never −0) and records each binary fallback', () => {
      resetCopAggregateFallbacks();
      expect(Object.is(copAggregate(0, -0, 'x').amount, 0)).toBe(true);
      expect(copAggregate(9759950, 97599.49999999999, 'x')).toEqual({ amount: 97599.5, path: 'exactCents' });
      expect(copAggregate(undefined, 97599.49999999999, 'x')).toEqual({ amount: 97599.49999999999, path: 'binaryLegacy' });
      expect(copAggregate(Number.MAX_SAFE_INTEGER + 1, 7, 'y')).toEqual({ amount: 7, path: 'binaryLegacy' });
      expect(getCopAggregateFallbacks()).toEqual({ x: 1, y: 1 });
      expect(sumCopAmounts([0.1, 0.2], 'z')).toEqual({ amount: 0.3, path: 'exactCents' });
      expect(sumCopAmounts([0.1, 0.005], 'z')).toEqual({ amount: 0.1 + 0.005, path: 'binaryLegacy' });
      expect(sumCopAmounts([], 'z')).toEqual({ amount: 0, path: 'exactCents' });
      resetCopAggregateFallbacks();
    });
  });

  describe('presentation (6B-D4) and consistency between screens', () => {
    test('only the IEEE negative zero changes: −0 shows $ 0; every non-zero value is formatted as before', () => {
      expect(formatCurrency(-0, 'COP')).toBe(formatCurrency(0, 'COP'));
      expect(formatCOP(-0)).toBe(formatCOP(0));
      expect(previousDashboard.formatCurrency(-0, 'COP')).toBe('-$ 0');
      const values = [-2.7755575615628914e-17, -0.004, -0.4, 0.4, -0.49999999999999994, -0.5, 0.5, 2.5, 97599.49999999999, 97599.5, -97599.5, 1e15, -1e15, Number.MAX_SAFE_INTEGER];
      for (let cents = -20000; cents <= 20000; cents++) values.push(cents / 100);
      for (const value of values.filter(v => !Object.is(v, -0))) {
        expect(formatCurrency(value, 'COP')).toBe(previousDashboard.formatCurrency(value, 'COP'));
      }
      expect(formatCurrency(-0.4, 'COP')).toBe('-$ 0');
      expect(formatCurrency(-2.7755575615628914e-17, 'COP')).toBe('-$ 0');
    });

    test('Movements and Debit cards show the same exact available balance as the dashboard', async () => {
      const texts = ['36360.06', '36224.28', '19556.65', '5458.51'];
      const accounts = texts.map((text, index): Account => ({ id: `a${index}`, name: `Cuenta ${index}`, type: index % 2 ? 'bankAccount' : 'savingsAccount',
        status: 'active', currency: 'COP', balance: { amount: Number(text), currency: 'COP' }, createdAt: '2026-01-01', updatedAt: '2026-01-01' }));
      const expected = oracleDouble(texts.reduce((t, x) => t + textCents(x), 0n));
      expect(buildDebitCardsOverview(accounts, [], PHASE6B2_DATE).totalAvailable).toBe(expected);
      expect(sumCopAmounts(accounts.map(a => a.balance.amount), 'test').amount).toBe(expected);
      const previousBinary = accounts.reduce((t, a) => t + a.balance.amount, 0);
      expect(previousBinary).toBe(97599.49999999999);
      results.screens = { expected: String(expected), debitCards: String(buildDebitCardsOverview(accounts, [], PHASE6B2_DATE).totalAvailable), previousBinary: String(previousBinary) };
    });
  });

  describe('representative volumes (AGENTS.md distributions)', () => {
    const sizes: RepresentativeSize[] = [1000, 10000, 100000];
    test.each(sizes)('%s movements: aggregates equal the oracle with cents balances; monthly figures unchanged; timing', async size => {
      const sql = await freshDatabase();
      try {
        for (const statement of representativeSeedStatements(size)) sql.native.exec(statement);
        const { first, last, count } = sql.query('SELECT min(date) AS first, max(date) AS last, count(*) AS count FROM transactions').rows.raw()[0] as Record<string, unknown>;
        const date = new Date(`${REPRESENTATIVE_REFERENCE_DAY}T17:00:00.000Z`);
        const timing = async (variant: string) => {
          const runs: Record<string, number[]> = { previous: [], next: [] };
          let summaries: Record<string, any> = {};
          for (let i = 0; i < 11; i++) {
            for (const [name, read] of (i % 2 ? [['previous', previousDashboard.getDashboardSummaryFromDb], ['next', getDashboardSummaryFromDb]] : [['next', getDashboardSummaryFromDb], ['previous', previousDashboard.getDashboardSummaryFromDb]]) as Array<[string, typeof getDashboardSummaryFromDb]>) {
              const start = performance.now();
              summaries[name] = await read(sql.database, date);
              runs[name]!.push(performance.now() - start);
            }
          }
          const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
          return { variant, medianMs: { previous: median(runs.previous!), next: median(runs.next!) }, summaries };
        };
        const pesos = await timing('pesos');
        for (const field of ['availableBalance', 'totalDebt', 'netWorth', 'monthlyIncome', 'monthlyExpenses', 'monthlySavings', 'recentTransactionCount'] as const)
          expect(Object.is(pesos.summaries.next[field], pesos.summaries.previous[field])).toBe(true);
        // Same history with canonical cents balances (as 6B.1 writes them).
        const balances: Record<string, string> = { 'rep-bank': '4500000.15', 'rep-bank2': '820000.20', 'rep-savings': '12000000.05', 'rep-cash': '150000.10', 'rep-card': '1250000.35', 'rep-card2': '380000.14' };
        for (const [id, text] of Object.entries(balances)) {
          const column = id.includes('card') ? 'debt_balance_amount' : 'balance_amount';
          sql.native.exec(`UPDATE accounts SET ${column} = ${Number(text)} WHERE id = '${id}'`);
        }
        const cents = await timing('cents');
        const available = textCents('4500000.15') + textCents('820000.20') + textCents('12000000.05') + textCents('150000.10');
        const debt = textCents('1250000.35') + textCents('380000.14');
        expect(cents.summaries.next.availableBalance).toBe(oracleDouble(available));
        expect(cents.summaries.next.totalDebt).toBe(oracleDouble(debt));
        expect(cents.summaries.next.netWorth).toBe(oracleDouble(available - debt));
        for (const field of ['monthlyIncome', 'monthlyExpenses', 'monthlySavings', 'recentTransactionCount'] as const)
          expect(Object.is(cents.summaries.next[field], cents.summaries.previous[field])).toBe(true);
        const pick = (s: any) => Object.fromEntries(['availableBalance', 'totalDebt', 'netWorth', 'monthlyIncome', 'monthlyExpenses', 'monthlySavings'].map(k => [k, String(s[k])]));
        results.volume[size] = { rows: { count, first, last }, pesos: { medianMs: pesos.medianMs, next: pick(pesos.summaries.next) },
          cents: { medianMs: cents.medianMs, next: pick(cents.summaries.next), previous: pick(cents.summaries.previous) } };
      } finally { sql.native.close(); }
    }, 120000);
  });
}
