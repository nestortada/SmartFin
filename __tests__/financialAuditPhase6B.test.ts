import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { PHASE6B_DATE, runPhase6BProbe, type Phase6BProbe } from '../scripts/phase6b/probes';
import { formatCurrency } from '../src/shared/utils/formatCurrency';

// Phase 6B audit: production use cases on real SQLite against an independent BigInt oracle.
// The same probes run in the isolated Android APK (scripts/phase6b). No tolerance anywhere.
// Tests named "defect 6B-…" characterize the CURRENT incorrect result on purpose: they must be
// rewritten to the oracle value when the separate correction task is authorized.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const fs = require('node:fs') as { writeFileSync: (f: string, c: string) => void; mkdirSync: (p: string, o: object) => void };

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(PHASE6B_DATE);
});
afterEach(() => jest.useRealTimers());

const results: Record<string, any> = {};
afterAll(() => {
  fs.mkdirSync('docs/auditoria-fase6b/node', { recursive: true });
  fs.writeFileSync('docs/auditoria-fase6b/node/probes.json', JSON.stringify(results, null, 2) + '\n');
});

async function probe(name: Phase6BProbe): Promise<any> {
  const sql = realSQLite({ fixedSqlDate: PHASE6B_DATE });
  try {
    sql.native.exec('PRAGMA foreign_keys = ON;');
    for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
    await applyVersionedMigrations(sql.database);
    const result = await runPhase6BProbe(sql.database, name);
    expect(sql.query('PRAGMA integrity_check').rows.raw()).toEqual([{ integrity_check: 'ok' }]);
    expect(sql.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
    return (results[name] = result);
  } finally { sql.native.close(); }
}

describe('invariants that hold', () => {
  test('whole-peso operation sequence matches the decimal oracle bit for bit', async () => {
    const r = await probe('sequenceIntegers');
    expect(r.counts).toMatchObject({ steps: 150, storedMismatch: 0, visibleMismatch: 0, dashboardMismatch: 0, dashboardVisibleMismatch: 0, paymentsRejected: 0 });
    expect(r.counts.payments).toBeGreaterThan(0);
    expect(r.final).toEqual({ bank: String(Number(r.oracle.bank)), target: String(Number(r.oracle.target)), debt: String(Number(r.oracle.debt)) });
  });

  test.each(['sequenceCents', 'sequenceCents1000'] as const)('%s: 6A monthly figures stay exact; only balances/debt drift', async name => {
    const r = await probe(name);
    for (const field of ['monthlyIncome', 'monthlyExpenses', 'monthlySavings']) expect(r.dashboardMismatchFields[field]).toBeUndefined();
    // Characterization of defects 6B-D1/6B-D3: persisted balances leave the two-decimal contract.
    expect(r.counts.nonCanonicalStored).toBeGreaterThan(0);
  });

  test('6A combined savings outside the safe range falls back without changing the decimal result', async () => {
    const r = await probe('unsafeCombinedSavings');
    expect(r).toMatchObject({ monthlyIncome: '60000000000000.01', monthlyExpenses: '-60000000000000.02', savingsCentsSafe: false });
    expect(r.monthlySavings).toBe(r.savingsExpected);
  });

  test('4x1000 on whole pesos equals the decimal half-up rounding at every half-peso tie', () => {
    // a ≡ 125 (mod 250) is exactly where a·4/1000 ends in ,5; checked up to 100 millones COP.
    const mismatches: number[] = [];
    for (let amount = 125; amount <= 100_000_000; amount += 250) {
      const decimal = Number((BigInt(amount) * 4n + 500n) / 1000n);
      if (Math.max(1, Math.round(amount * 0.004)) !== Math.max(1, decimal)) mismatches.push(amount);
    }
    expect(mismatches).toEqual([]);
  });

  test('canonical account balances are each stored exactly', async () => {
    expect((await probe('aggregateBalances')).eachAccountExact).toBe(true);
  });
});

describe('defects characterized by the audit (current results, not accepted behavior)', () => {
  test('defect 6B-D1: persisted balance accumulates binary error and shows $1 less than income', async () => {
    const r = await probe('balanceAccumulation');
    expect(r.accountBalance).toMatchObject({ stored: '97599.49999999999', expected: '97599.50', exactDouble: false, display: formatCurrency(97599, 'COP'), visibleDifference: true });
    expect(r.availableBalance.visibleDifference).toBe(true);
    expect(r.netWorth.visibleDifference).toBe(true);
    expect(r.monthlyIncome).toMatchObject({ stored: '97599.5', exactDouble: true, visibleDifference: false });
  });

  test('defect 6B-D1: deleting a movement does not restore the previous balance bit for bit', async () => {
    const r = await probe('reversalResidue');
    expect(r).toMatchObject({ before: '661275.68', restoredBitExact: false, transactionsLeft: 0, monthlyExpenses: 0 });
    expect(r.after).toMatchObject({ stored: '661275.6799999999', visibleDifference: false });
  });

  test('defect 6B-D2: binary debt residue after paying the whole debt blocks payments and closure', async () => {
    const above = await probe('cardResidueAbove');
    expect(above).toMatchObject({ exactTotal: '229831.00', debtAfterFullPayment: '2.9103830456733704e-11' });
    expect(above.fullPayment.paid).toBe(229831);
    expect(above.closure).toMatch(/^rejected/);
    const below = await probe('cardResidueBelow');
    expect(below.fullPayment.rejected).toBeDefined();
    expect(below.finalDebt).toMatchObject({ stored: '0.9999999999854481', expected: '1.00' });
    expect(below.attempts.at(-1).rejected).toBeDefined();
    expect(below.closure).toMatch(/^rejected/);
  });

  test('defect 6B-D2 (contract): a legitimate cents debt can never be settled or closed', async () => {
    const r = await probe('cardCentavosDebt');
    expect(r.attempts.map((a: any) => a.paid ?? 'rejected')).toEqual(['rejected', 10000, 'rejected', 'rejected', 'rejected']);
    expect(r.closure).toMatch(/^rejected/);
    expect(r.dashboardDebt.display).toBe(formatCurrency(0, 'COP'));
  });

  test('defect 6B-D3: exact account balances are aggregated in binary by the dashboard', async () => {
    const r = await probe('aggregateBalances');
    expect(r.availableBalance).toMatchObject({ stored: '97599.49999999999', expectedDisplay: formatCurrency(97600, 'COP'), visibleDifference: true });
    expect(r.netWorth.visibleDifference).toBe(true);
  });

  test('defect 6B-D4: a zero balance reached through cents shows a negative zero', async () => {
    const r = await probe('negativeZero');
    expect(r.accountBalance).toMatchObject({ stored: '-2.7755575615628914e-17', display: formatCurrency(-1e-17, 'COP') });
    expect(r.accountBalance.display).not.toBe(formatCurrency(0, 'COP'));
    expect(r.monthlySavings.stored).toBe('0');
  });

  test('defect 6B-D5 (legacy amounts): savings falls back to binary although income is exact', async () => {
    const r = await probe('mixedSavings');
    expect(r.monthlyIncome).toEqual({ value: '117650.51', display: formatCurrency(117651, 'COP') });
    expect(r.monthlySavings.value).toBe('117650.49999999999');
    expect(r.monthlySavings.display).not.toBe(r.savingsIntentDisplay);
  });
});
