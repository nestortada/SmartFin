import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { PHASE6B_DATE, runPhase6BProbe, type Phase6BProbe } from '../scripts/phase6b/probes';
import { formatCurrency } from '../src/shared/utils/formatCurrency';

// Phase 6B audit: production use cases on real SQLite against an independent BigInt oracle.
// The same probes run in the isolated Android APK (scripts/phase6b). No tolerance anywhere.
// Tests named "defect 6B-…" characterize the CURRENT incorrect result on purpose: they must be
// rewritten to the oracle value when the separate correction task is authorized.
// Phase 6B.1 corrected 6B-D1/6B-D2 (and therefore 6B-D4): those tests now require the oracle value.
// Phase 6B.2 corrected 6B-D3 (dashboard aggregates): its test now requires the oracle value too.
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

  test.each(['sequenceCents', 'sequenceCents1000'] as const)('%s: 6A monthly figures stay exact; balances/debt exact since 6B.1', async name => {
    const r = await probe(name);
    for (const field of ['monthlyIncome', 'monthlyExpenses', 'monthlySavings', 'totalDebt']) expect(r.dashboardMismatchFields[field]).toBeUndefined();
    // 6B.1: every persisted balance and debt is the canonical double of the decimal oracle.
    expect(r.counts).toMatchObject({ storedMismatch: 0, nonCanonicalStored: 0, paymentsRejected: 0 });
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
  test('6B-D1 corrected in 6B.1: persisted balance is the exact decimal and shows the same pesos as income', async () => {
    const r = await probe('balanceAccumulation');
    expect(r.accountBalance).toMatchObject({ stored: '97599.5', expected: '97599.50', exactDouble: true, display: formatCurrency(97600, 'COP'), visibleDifference: false });
    expect(r.availableBalance.visibleDifference).toBe(false);
    expect(r.netWorth.visibleDifference).toBe(false);
    expect(r.monthlyIncome).toMatchObject({ stored: '97599.5', exactDouble: true, visibleDifference: false });
  });

  test('6B-D1 corrected in 6B.1: deleting a movement restores the previous balance bit for bit', async () => {
    const r = await probe('reversalResidue');
    expect(r).toMatchObject({ before: '661275.68', restoredBitExact: true, transactionsLeft: 0, monthlyExpenses: 0 });
    expect(r.after).toMatchObject({ stored: '661275.68', exactDouble: true, visibleDifference: false });
    expect(r.during).toMatchObject({ stored: '567658.99', exactDouble: true });
  });

  test('6B-D2 corrected in 6B.1: paying the whole exact debt leaves exactly zero and the card can be closed', async () => {
    const above = await probe('cardResidueAbove');
    expect(above).toMatchObject({ exactTotal: '229831.00', debtAfterFullPayment: '0' });
    expect(above.debtAfterPurchases).toMatchObject({ stored: '229831', exactDouble: true });
    expect(above.fullPayment.paid).toBe(229831);
    expect(above.closure).toBe('closed');
    const below = await probe('cardResidueBelow');
    expect(below.debtAfterPurchases).toMatchObject({ stored: '94562', exactDouble: true });
    expect(below.fullPayment.paid).toBe(94562);
    expect(below.finalDebt).toMatchObject({ stored: '0', expected: '0.00', exactDouble: true });
    // The extra $1 attempt is rejected because there is no debt left, not because of a residue.
    expect(below.attempts.at(-1).rejected).toBe('La tarjeta no tiene saldo pendiente por pagar.');
    expect(below.closure).toBe('closed');
  });

  test('defect 6B-D2 (contract): a legitimate cents debt can never be settled or closed', async () => {
    const r = await probe('cardCentavosDebt');
    expect(r.attempts.map((a: any) => a.paid ?? 'rejected')).toEqual(['rejected', 10000, 'rejected', 'rejected', 'rejected']);
    expect(r.closure).toMatch(/^rejected/);
    expect(r.dashboardDebt.display).toBe(formatCurrency(0, 'COP'));
  });

  test('6B-D3 corrected in 6B.2: exact account balances are aggregated in exact cents by the dashboard', async () => {
    const r = await probe('aggregateBalances');
    expect(r.availableBalance).toMatchObject({ stored: '97599.5', exactDouble: true, display: formatCurrency(97600, 'COP'), visibleDifference: false });
    expect(r.netWorth).toMatchObject({ stored: '97599.5', exactDouble: true, visibleDifference: false });
  });

  test('6B-D4 no longer reproduced after 6B.1: a zero balance reached through cents is exactly zero', async () => {
    // The formatting cause (Intl signDisplay) remains for non-canonical values; see 6B.1 report.
    const r = await probe('negativeZero');
    expect(r.accountBalance).toMatchObject({ stored: '0', exactDouble: true, display: formatCurrency(0, 'COP') });
    expect(r.availableBalance.display).toBe(formatCurrency(0, 'COP'));
    expect(r.monthlySavings.stored).toBe('0');
  });

  test('defect 6B-D5 (legacy amounts): savings falls back to binary although income is exact', async () => {
    const r = await probe('mixedSavings');
    expect(r.monthlyIncome).toEqual({ value: '117650.51', display: formatCurrency(117651, 'COP') });
    expect(r.monthlySavings.value).toBe('117650.49999999999');
    expect(r.monthlySavings.display).not.toBe(r.savingsIntentDisplay);
  });
});
