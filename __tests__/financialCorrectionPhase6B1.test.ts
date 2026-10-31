jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
jest.mock('react-native-config', () => ({}));

import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { SQLiteCommandFailure } from '../src/database/atomicSQLite';
import {
  addCopAmounts, differenceOfCopSums, getCopArithmeticFallbacks, resetCopArithmeticFallbacks, toExactCopCents,
} from '../src/shared/utils/exactCopCents';
import { formatCurrency } from '../src/shared/utils/formatCurrency';
import {
  NEXT_IMPLEMENTATION, PHASE6B1_DATE, PHASE6B1_PROBES, runPhase6B1Probe, type Phase6B1Implementation, type Phase6B1Probe,
} from '../scripts/phase6b1/probes';
import { centsText, textCents } from '../scripts/phase6b/probes';
import * as previousSave from './helpers/pre6B1SaveManualTransaction';
import * as previousCards from './helpers/pre6B1CreditCardRelations';
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState, requireIntegralRollback } from './helpers/financialState';
import { sharedExpenseFixture, SHARED_TEST_DATE } from './helpers/sharedExpenseFixture';
import { representativeSeedStatements, REPRESENTATIVE_REFERENCE_DAY } from './helpers/representativeHistory';
import { registerCreditCardPayment } from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { executeAiCommandPlan } from '../src/modules/transactions/useCases/executeAiCommandPlan';
import { updateTransactionQuickly } from '../src/modules/transactions/useCases/updateTransactionQuickly';
import { getDashboardSummaryFromDb } from '../src/modules/dashboard/useCases/getDashboardSummary';
import { buildCreditCardsOverview } from '../src/modules/creditCards/useCases/getCreditCardsOverview';
import type { AiCommandPlan } from '../src/modules/transactions/types';

// Phase 6B.1: exact cents for persisted balances (6B-D1) and card debt (6B-D2). Independent oracle:
// BigInt cents over decimal texts. Whole-peso results must equal the frozen pre-6B.1 implementation
// bit for bit; two-decimal results must equal the canonical double of the exact decimal. No tolerance.
const fs = require('node:fs') as { writeFileSync: (f: string, c: string) => void; mkdirSync: (p: string, o: object) => void };
const { performance: monotonic } = require('node:perf_hooks') as { performance: { now: () => number } };

const PREVIOUS: Phase6B1Implementation = {
  name: 'previous',
  saveManualTransaction: previousSave.saveManualTransaction,
  deleteManualTransactionSafely: previousSave.deleteManualTransactionSafely,
  registerCreditCardPayment: previousCards.registerCreditCardPayment,
  reconcileCreditCardTransactions: previousCards.reconcileCreditCardTransactions,
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(PHASE6B1_DATE);
});
afterEach(() => jest.useRealTimers());

const evidence: Record<string, unknown> = {};
afterAll(() => {
  fs.mkdirSync('docs/correccion-fase6b1/node', { recursive: true });
  fs.writeFileSync('docs/correccion-fase6b1/node/results.json', JSON.stringify(evidence, null, 2) + '\n');
});

/** Deterministic LCG, identical in Node and Hermes. */
function lcg(seed: number) {
  // Same sequence as the 6B generator (Math.imul … >>> 0): the products stay below 2^53.
  let state = seed % 4294967296;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const oracleDouble = (cents: bigint) => Number(centsText(cents));

describe('exact COP arithmetic against the BigInt decimal oracle', () => {
  test('whole pesos: identical to the previous binary arithmetic, bit for bit, up to and beyond 2^46', () => {
    const random = lcg(6101);
    const values = [0, 1, -1, 2 ** 30, 2 ** 46 - 1, 2 ** 46, 2 ** 53 - 1, -(2 ** 46) + 1, Number.MAX_SAFE_INTEGER - 1, 999999999999];
    for (let i = 0; i < 20000; i++) values.push(Math.floor((random() - 0.5) * 2 * 1e13));
    let compared = 0;
    for (const base of values) for (const delta of [1, -1, 250000, -250000, 2 ** 45, Math.floor(random() * 1e9)]) {
      const result = addCopAmounts(base, delta);
      expect(Object.is(result.amount, base + delta)).toBe(true);
      compared++;
    }
    evidence.wholePesoEquivalence = { compared, mismatches: 0 };
  });

  test('one and two decimals, negatives, repeated operations: canonical double of the exact decimal', () => {
    const random = lcg(6102);
    let exact = 0, previousWrong = 0, comparisons = 0;
    for (let i = 0; i < 50000; i++) {
      const decimals = i % 3;
      const make = () => {
        const whole = BigInt(Math.floor(random() * 1e9)) * 100n;
        const fraction = decimals === 0 ? 0n : decimals === 1 ? BigInt(Math.floor(random() * 10)) * 10n : BigInt(Math.floor(random() * 100));
        return random() < 0.3 ? -(whole + fraction) : whole + fraction;
      };
      const a = make(), b = make();
      const result = addCopAmounts(oracleDouble(a), oracleDouble(b));
      expect(result.path).toBe('exactCents');
      expect(Object.is(result.amount, oracleDouble(a + b))).toBe(true);
      if (!Object.is(oracleDouble(a) + oracleDouble(b), oracleDouble(a + b))) previousWrong++;
      exact++;
      comparisons++;
    }
    // Repeated accumulation and full reversal return exactly to the start.
    let balance = 661275.68, oracle = textCents('661275.68');
    const deltas: bigint[] = [];
    for (let i = 0; i < 10000; i++) {
      const delta = BigInt(Math.floor((random() - 0.5) * 2e9));
      deltas.push(delta);
      balance = addCopAmounts(balance, oracleDouble(delta)).amount;
      oracle += delta;
      expect(Object.is(balance, oracleDouble(oracle))).toBe(true);
    }
    for (const delta of deltas.reverse()) balance = addCopAmounts(balance, -oracleDouble(delta)).amount;
    expect(Object.is(balance, 661275.68)).toBe(true);
    evidence.decimalOracle = { comparisons, exact, previousBinaryWouldDiffer: previousWrong, repeatedOperations: 20000, restoredBitExact: true };
  });

  test('negative zero and zero results are positive zero on the exact path', () => {
    expect(Object.is(addCopAmounts(0.3, -0.3).amount, 0)).toBe(true);
    expect(Object.is(addCopAmounts(-0, -0).amount, 0)).toBe(true);
    expect(Object.is(differenceOfCopSums([0.1, 0.2], [0.3]).amount, 0)).toBe(true);
    expect(0.1 + 0.2 - 0.3).not.toBe(0);
  });

  test('out of contract keeps the previous binary result and records the fallback', () => {
    resetCopArithmeticFallbacks();
    const cases: Array<[number, number]> = [
      [1000, -0.005], [0.125, 10], [1 / 3, 1], [97599.49999999999, -100.25], [2 ** 46 - 1, 1], [2 ** 46, 0.5],
      [70368744177663.5, 0.5], [Number.MAX_SAFE_INTEGER, -1], [-(2 ** 46), -1], [Number.NaN, 1], [Infinity, 1],
    ];
    for (const [base, delta] of cases) {
      const result = addCopAmounts(base, delta, 'test.site');
      expect(result.path).toBe('binaryLegacy');
      expect(Object.is(result.amount, base + delta)).toBe(true);
    }
    expect(getCopArithmeticFallbacks()).toEqual({ 'test.site': cases.length });
    // Exact sums whose result reaches 2^46 also fall back (MAX_SAFE_INTEGER cents is above 2^46 COP).
    expect(differenceOfCopSums([2 ** 45, 2 ** 45], [], 'sum').path).toBe('binaryLegacy');
    expect(differenceOfCopSums([2 ** 45, 2 ** 45 - 0.01], [], 'sum')).toEqual({ amount: 2 ** 46 - 0.01, path: 'exactCents' });
    expect(differenceOfCopSums([0.005, 1], [], 'sum')).toEqual({ amount: 0.005 + 1, path: 'binaryLegacy' });
    resetCopArithmeticFallbacks();
  });
});

async function freshDatabase() {
  const sql = realSQLite({ fixedSqlDate: PHASE6B1_DATE });
  sql.native.exec('PRAGMA foreign_keys = ON;');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  return sql;
}

async function probe(name: Phase6B1Probe, impl: Phase6B1Implementation = NEXT_IMPLEMENTATION): Promise<any> {
  const sql = await freshDatabase();
  try {
    const result = await runPhase6B1Probe(sql.database, name, impl);
    expect(sql.query('PRAGMA integrity_check').rows.raw()).toEqual([{ integrity_check: 'ok' }]);
    expect(sql.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
    return result;
  } finally { sql.native.close(); }
}

describe('6B probes P1, P2, P3, P5, P6 and 6B.1 scenarios: before (frozen) and after', () => {
  const results: Record<string, { previous: any; next: any }> = {};
  afterAll(() => {
    for (const value of Object.values(results)) { delete value.previous?.trace; delete value.next?.trace; }
    evidence.probes = results;
  });
  const both = async (name: Phase6B1Probe) => {
    const value = { previous: await probe(name, PREVIOUS), next: await probe(name) };
    results[name] = value;
    return value;
  };

  test('P1 (D1): four two-decimal incomes accumulate to the exact decimal', async () => {
    const { previous, next } = await both('balanceAccumulation');
    expect(previous.balance).toMatchObject({ stored: '97599.49999999999', equalsOracle: false, display: formatCurrency(97599, 'COP') });
    expect(next.balance).toMatchObject({ stored: '97599.5', equalsOracle: true, canonical: true, display: formatCurrency(97600, 'COP') });
    expect(next.availableBalance.equalsOracle && next.netWorth.equalsOracle && next.monthlyIncome.equalsOracle).toBe(true);
  });

  test('P2 (D1): deleting a movement restores the previous balance bit for bit', async () => {
    const { previous, next } = await both('reversal');
    expect(previous).toMatchObject({ restoredBitExact: false, after: { stored: '661275.6799999999' } });
    expect(next).toMatchObject({ restoredBitExact: true, during: { equalsOracle: true }, after: { stored: '661275.68', equalsOracle: true }, transactionsLeft: 0 });
  });

  test('Case A (D2): purchases totalling 229.831 and a full payment leave zero debt; the card closes', async () => {
    const { previous, next } = await both('cardFullPaymentA');
    expect(previous).toMatchObject({ debtAfterPayment: { stored: '2.9103830456733704e-11' }, closure: expect.stringMatching(/^rejected/) });
    expect(next).toMatchObject({
      debtAfterPurchases: { stored: '229831', equalsOracle: true },
      fullPayment: { paid: 229831, remainingDebt: 0 },
      debtAfterPayment: { stored: '0', equalsOracle: true }, bankAfterPayment: { stored: '770169', equalsOracle: true },
      statement: { total_amount: 0, minimum_payment_amount: 0, status: 'paid' },
      monthlyExpenses: { before: '229831', after: '229831' }, dashboardDebt: { stored: '0' }, closure: 'closed',
    });
  });

  test('Case B (D2): purchases totalling 94.562 accept a 94.562 payment that clears the debt', async () => {
    const { previous, next } = await both('cardFullPaymentB');
    expect(previous.fullPayment.rejected).toMatch(/pesos enteros/);
    expect(previous.debtAfterPurchases.stored).toBe('94561.99999999999');
    expect(next).toMatchObject({
      debtAfterPurchases: { stored: '94562', equalsOracle: true },
      fullPayment: { paid: 94562, remainingDebt: 0 }, debtAfterPayment: { stored: '0', equalsOracle: true },
      statement: { total_amount: 0, status: 'paid' }, monthlyExpenses: { before: '94562', after: '94562' }, closure: 'closed',
    });
  });

  test('6B-C1 unchanged: a legitimate 0,40 debt is still rejected and blocks closure; now it is exactly 0,40', async () => {
    const { previous, next } = await both('cardCentavosDebt');
    const shape = (r: any) => r.attempts.map((a: any) => a.paid ?? 'rejected');
    expect(shape(previous)).toEqual(['rejected', 10000, 'rejected', 'rejected', 'rejected']);
    expect(shape(next)).toEqual(shape(previous));
    expect(next.attempts.map((a: any) => a.rejected)).toEqual(previous.attempts.map((a: any) => a.rejected));
    expect(previous.attempts[1].debtAfter).toBe('0.3999999999996362');
    expect(next.attempts.slice(1).map((a: any) => a.debtAfter)).toEqual(['0.4', '0.4', '0.4', '0.4']);
    expect(next.bank).toBe('990000');
    expect(next.closure).toMatch(/^rejected/);
  });

  test('P5: a zero reached through cents is +0 (no "−$ 0")', async () => {
    const { previous, next } = await both('zeroThroughCents');
    expect(previous.balance.display).toBe(formatCurrency(-2.7755575615628914e-17, 'COP'));
    expect(next).toMatchObject({ isPositiveZero: true, balance: { stored: '0', equalsOracle: true, display: formatCurrency(0, 'COP') } });
  });

  test('transfers with cents and 4x1000 keep the tax contract and are exact', async () => {
    const { previous, next } = await both('transfersCents');
    expect(previous.bank.equalsOracle).toBe(false);
    expect(next).toMatchObject({ bank: { equalsOracle: true }, target: { equalsOracle: true }, monthlyExpenses: { equalsOracle: true }, monthlyIncome: '0' });
    // Same tax amounts as before: only the balance accumulation changed.
    expect(next.monthlyExpenses.stored).toBe(previous.monthlyExpenses.stored);
  });

  test('edits and 200 random add/delete operations restore both balances bit for bit', async () => {
    const { previous, next } = await both('editsAndRepeatedReversal');
    expect(previous.restoredBitExact).toBe(false);
    expect(next).toMatchObject({ restoredBitExact: true, transactionsLeft: 0,
      editCheck: { bank: { equalsOracle: true }, bank2: { equalsOracle: true } }, finalBank: { equalsOracle: true } });
  });

  test('card cycle: installments, partial/full payments and reversals; statements exact', async () => {
    const { previous, next } = await both('cardCycle');
    for (const step of next.steps) expect([step.label, step.debt.equalsOracle, step.bank.equalsOracle]).toEqual([step.label, true, true]);
    expect(previous.steps.some((s: any) => !s.debt.equalsOracle)).toBe(true);
    const statements = next.steps.map((s: any) => s.statement.total_amount);
    // 300.000,30 in 3 cuotas → monthly 100.000; plus 4.229,90 + 89.392,54 (installment only in statement).
    expect(statements).toEqual([193622.44, 93622.44, 193622.44, 93622.44, 93622.44, 0.44, 0]);
    expect(next.fullAttempt.rejected).toMatch(/pesos enteros/); // 6B-C1: 93.622,44 is not whole pesos.
    expect(next.whole).toMatchObject({ paid: 93622, remainingDebt: 0.44 });
    expect(next.closure).toBe('closed');
  });

  test('historical drift: balances are detected and never repaired; derived debt is recomputed on reconciliation', async () => {
    const { previous, next } = await both('historicalDrift');
    expect(next.detection).toEqual({ bankCanonical: false, debtCanonical: false, bankDisplay: formatCurrency(97599, 'COP') });
    expect(next.expenseOnDriftedBalance).toEqual({ stored: '97499.24999999999', equalsPreviousBinary: true, canonical: false });
    expect(next.bankAfterPayment).toBe(previous.bankAfterPayment);
    expect(previous.debtAfterReconciliation.equalsOracle).toBe(false);
    expect(next.debtAfterReconciliation).toMatchObject({ stored: '44562', equalsOracle: true });
    // Only the expense and the payment rows are added (plus the statement upsert of the existing flow).
    expect(next.rowsAdded).toEqual({ transactions: 2, installment_purchases: 0, credit_card_statements: 1 });
    expect(next.rowsAdded).toEqual(previous.rowsAdded);
    expect(next.fallbacks).toEqual({ 'manualTransaction.balance': 1, 'creditCardPayment.source': 1 });
  });

  test('out-of-contract amounts and limits keep the previous result', async () => {
    const { previous, next } = await both('outOfContract');
    expect(next.results.map((r: any) => [r.label, r.stored, r.equalsPreviousBinary]))
      .toEqual(previous.results.map((r: any) => [r.label, r.stored, true]));
    expect(next.results.find((r: any) => r.label === 'whole pesos below 2^46').fallbacks).toEqual({});
    expect(next.results.find((r: any) => r.label === 'sub-cent amount').fallbacks).toEqual({ 'manualTransaction.balance': 1 });
  });

  test('P6 whole pesos: identical persisted values after every one of 150 steps', async () => {
    const { previous, next } = await both('sequenceIntegers');
    expect(next.trace).toEqual(previous.trace);
    expect(next.counts).toEqual(previous.counts);
    expect(next.counts).toMatchObject({ storedMismatch: 0, monthlyMismatch: 0, wealthMismatch: 0, paymentsRejected: 0 });
  });

  test.each(['sequenceCents', 'sequenceCents1000'] as const)('P6 %s: every persisted value equals the oracle', async name => {
    const { previous, next } = await both(name);
    expect(previous.counts.storedMismatch).toBeGreaterThan(0);
    expect(next.counts).toMatchObject({ storedMismatch: 0, nonCanonicalStored: 0, monthlyMismatch: 0, wealthMismatch: 0, paymentsRejected: 0 });
  });
});

describe('integration paths', () => {
  test('shared expense purchase, reimbursement and advance return with cents are exact', async () => {
    jest.setSystemTime(SHARED_TEST_DATE);
    const f = await sharedExpenseFixture();
    try {
      const contact = f.contactId;
      const purchase = await f.api.createPurchase('p', {
        purchase: { accountId: 'bank', amount: 30000.3, categoryId: 'food', merchantName: 'Restaurante', operationType: 'Débito',
          occurrence: { kind: 'date', date: '2026-10-05' } },
        distribution: { mode: 'amounts', personalAmount: 15000.15, participants: [{ contactId: contact, amount: 15000.15 }] },
      });
      const receipt = await f.api.recordReceipt('r', { contactId: contact, accountId: 'bank', amount: 20000.07, occurrence: { kind: 'date', date: '2026-10-06' } });
      await f.api.returnAdvance('a', { receiptId: receipt.entityId, accountId: 'bank', amount: 4999.92, occurrence: { kind: 'date', date: '2026-10-07' } });
      const bank = (await f.balances()).bank!;
      const expected = 100000000n - textCents('30000.30') + textCents('20000.07') - textCents('4999.92');
      expect(Object.is(bank, oracleDouble(expected))).toBe(true);
      expect(purchase.entityId).toBeDefined();
      f.verifyForeignKeys();
      evidence.shared = { bank: String(bank), expected: centsText(expected) };
    } finally { f.native.close(); }
  });

  test('AI plan with two-decimal amounts is exact; sub-cent AI amounts keep the previous arithmetic', async () => {
    jest.setSystemTime(FINANCIAL_TEST_DATE);
    const f = await financialIntegrityFixture();
    try {
      const plan = (id: string, amount: number, extra: Record<string, unknown> = {}): AiCommandPlan => ({
        version: 1, summary: 'Movimiento', answeredFields: [],
        actions: [{ id, entity: 'transaction', operation: 'create',
          fields: { accountId: 'bank', amount, date: '2026-10-11', description: 'Sintético', transactionType: 'expense', ...extra } }],
      } as AiCommandPlan);
      await executeAiCommandPlan(f.database, 'ai-1', plan('a', 36360.06, { transactionType: 'income' }));
      await executeAiCommandPlan(f.database, 'ai-2', plan('b', 19556.65));
      await executeAiCommandPlan(f.database, 'ai-3', plan('c', 1234.56, { transactionType: 'internalTransfer', targetAccountId: 'target', transferTaxCharged: true }));
      const tax = BigInt(Math.max(1, Math.round(1234.56 * 0.004))) * 100n;
      const expected = 100000000n + textCents('36360.06') - textCents('19556.65') - textCents('1234.56') - tax;
      let snapshot = await f.snapshot();
      expect(Object.is(snapshot.balances.bank, oracleDouble(expected))).toBe(true);
      expect(snapshot.balances.target).toBe(1234.56);
      // Replaying a confirmed AI receipt makes no new writes (phase 4 idempotence preserved).
      await executeAiCommandPlan(f.database, 'ai-2', plan('b', 19556.65));
      expect(await f.snapshot()).toEqual(snapshot);
      resetCopArithmeticFallbacks();
      const before = snapshot.balances.bank!;
      await executeAiCommandPlan(f.database, 'ai-4', plan('d', 0.005));
      snapshot = await f.snapshot();
      expect(Object.is(snapshot.balances.bank, before - 0.005)).toBe(true);
      expect(getCopArithmeticFallbacks()).toEqual({ 'manualTransaction.balance': 1 });
      evidence.ai = { bank: String(snapshot.balances.bank), exactBeforeSubCent: centsText(expected) };
    } finally { f.native.close(); }
  });

  test('quick payment-method changes debit↔credit with cents restore balance and debt exactly', async () => {
    jest.setSystemTime(FINANCIAL_TEST_DATE);
    const f = await financialIntegrityFixture({ managed: true });
    try {
      await f.save({ amount: 36224.28 });
      const tx = (await f.transactionRepository.getTransactions())[0]!;
      await updateTransactionQuickly(f, tx.id, { kind: 'paymentMethod', operationType: 'Crédito' });
      let s = await f.snapshot();
      expect([s.balances.bank, s.debt]).toEqual([1000000, 36224.28]);
      await updateTransactionQuickly(f, tx.id, { kind: 'paymentMethod', operationType: 'Débito' });
      s = await f.snapshot();
      expect(Object.is(s.balances.bank, oracleDouble(100000000n - textCents('36224.28')))).toBe(true);
      expect(s.debt).toBe(0);
      expect(s.expense).toBe(36224.28);
    } finally { f.native.close(); }
  });

  test('card overview: used credit is the exact debt; available credit is a display-only subtraction', async () => {
    jest.setSystemTime(FINANCIAL_TEST_DATE);
    const f = await financialIntegrityFixture();
    try {
      for (const amount of [4229.9, 89392.54, 939.56]) await f.save({ accountId: 'card', operationType: 'Crédito', amount });
      const accounts = (await f.accountRepository.getAccounts()).map(a => a.id === 'card' ? { ...a, creditLimit: { amount: 1000000, currency: 'COP' as const } } : a);
      const overview = buildCreditCardsOverview({ accounts, currentDate: FINANCIAL_TEST_DATE, installments: [], profiles: [],
        statements: await f.creditCardRepository.getStatements(['card']) });
      expect(overview.cards[0]).toMatchObject({ usedCredit: 94562, availableCredit: 905438, nextPaymentAmount: 94562 });
    } finally { f.native.close(); }
  });
});

describe('atomicity with cents is preserved', () => {
  async function centsCard() {
    const f = await financialIntegrityFixture({ managed: true });
    for (const amount of [4229.9, 89392.54, 939.56]) await f.save({ accountId: 'card', operationType: 'Crédito', amount });
    return f;
  }

  test('payment of the whole exact debt: fault before/after every write rolls back everything', async () => {
    const success = await centsCard();
    let writes: number;
    try {
      success.resetTrace();
      const result = await registerCreditCardPayment({ ...success, accountId: 'card', sourceAccountId: 'bank', amount: 94562, currentDate: FINANCIAL_TEST_DATE });
      expect(result).toMatchObject({ paidAmount: 94562, previousDebt: 94562, remainingDebt: 0 });
      writes = success.trace.filter(e => e.write !== undefined).length;
    } finally { success.native.close(); }
    let points = 0;
    for (let write = 1; write <= writes; write++) for (const phase of ['before', 'after'] as const) {
      const f = await centsCard();
      try {
        const before = await financialState(f);
        f.resetTrace(); f.injectFault({ write, phase });
        await expect(registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount: 94562, currentDate: FINANCIAL_TEST_DATE })).rejects.toBeDefined();
        f.injectFault();
        expect(f.trace.filter(e => e.sql.startsWith('ROLLBACK') && e.outcome === 'ok')).toHaveLength(1);
        requireIntegralRollback(before, await financialState(f));
        points++;
      } finally { f.native.close(); }
    }
    evidence.paymentRollback = { writes, points };
    expect(points).toBe(writes * 2);
  });

  test('two-decimal credit purchase: fault before/after every write rolls back everything', async () => {
    const run = async (fault?: { write: number; phase: 'before' | 'after' }) => {
      const f = await centsCard();
      try {
        const before = await financialState(f);
        f.resetTrace(); f.injectFault(fault);
        let error: unknown;
        try { await f.save({ accountId: 'card', operationType: 'Crédito', amount: 0.01, installmentCountInput: '3' }); } catch (e) { error = e; }
        f.injectFault();
        return { before, after: await financialState(f), writes: f.trace.filter(e => e.write !== undefined).length, error };
      } finally { f.native.close(); }
    };
    const success = await run();
    expect(success.error).toBeUndefined();
    expect(success.after.metrics.debt).toBe(94562.01);
    let points = 0;
    for (let write = 1; write <= success.writes; write++) for (const phase of ['before', 'after'] as const) {
      const failed = await run({ write, phase });
      expect(failed.error).toBeDefined();
      requireIntegralRollback(failed.before, failed.after);
      points++;
    }
    evidence.purchaseRollback = { writes: success.writes, points };
  });

  test('unknown COMMIT result is never retried for the same payment request', async () => {
    const f = await centsCard();
    const command = { ...f, accountId: 'card', sourceAccountId: 'bank', amount: 94562, currentDate: FINANCIAL_TEST_DATE };
    f.resetTrace(); f.injectFault({ sql: 'COMMIT', phase: 'after' });
    let failure: unknown;
    try { await registerCreditCardPayment(command); } catch (error) { failure = error; }
    expect((failure as SQLiteCommandFailure).result.status).toBe('unknown');
    const count = f.trace.length;
    await expect(registerCreditCardPayment(command)).rejects.toBe(failure);
    expect(f.trace).toHaveLength(count);
    // The managed connection is retired after unknown (phase 3A policy): no further financial writes.
    await expect(f.accountRepository.getAccounts()).rejects.toThrow('not usable');
  });
});

describe('representative volumes (6 months / 5 years / 50 calendar years)', () => {
  test.each([[1000, 'cents'], [10000, 'cents'], [100000, 'cents'], [1000, 'pesos'], [10000, 'pesos'], [100000, 'pesos']] as const)(
    '%s movements (%s): exact debt from the whole history and reconciliation time', async (size, variant) => {
    const setup = async (impl: Phase6B1Implementation) => {
      const sql = await freshDatabase();
      for (const statement of representativeSeedStatements(size)) sql.native.exec(statement);
      // Same cents variant as 6A: every representative amount gets a deterministic 0–99 cents part.
      if (variant === 'cents') sql.native.exec("UPDATE transactions SET amount = amount + ((rowid * 7919) % 100) / 100.0 WHERE id LIKE 'rep-%'");
      const deps = {
        accountRepository: require('../src/modules/accounts/repositories/sqliteAccountRepository').createSqliteAccountRepository(sql.database),
        transactionRepository: require('../src/modules/transactions/repositories/sqliteTransactionRepository').createSqliteTransactionRepository(sql.database),
        creditCardRepository: require('../src/modules/creditCards/repositories/sqliteCreditCardRepository').createSqliteCreditCardRepository(sql.database),
      };
      return { sql, deps, impl };
    };
    const date = new Date(`${REPRESENTATIVE_REFERENCE_DAY}T17:00:00.000Z`);
    jest.setSystemTime(date);
    const next = await setup(NEXT_IMPLEMENTATION);
    const previous = await setup(PREVIOUS);
    try {
      const runs = { next: [] as number[], previous: [] as number[] };
      for (let i = 0; i < 7; i++) for (const s of i % 2 ? [previous, next] : [next, previous]) {
        const start = monotonic.now();
        await s.impl.reconcileCreditCardTransactions({ ...s.deps, currentDate: date });
        runs[s.impl.name].push(monotonic.now() - start);
      }
      // Independent oracle in SQLite integers: cents recovered from each stored two-decimal REAL.
      const oracle = next.sql.query(`SELECT a.id, coalesce((SELECT sum(CAST(round(t.amount * 100) AS INTEGER)) FROM transactions t
          WHERE t.account_id = a.id AND t.type = 'expense' AND t.direction = 'outflow' AND t.status <> 'cancelled'), 0)
        - coalesce((SELECT sum(CAST(round(t.amount * 100) AS INTEGER)) FROM transactions t WHERE t.type = 'creditCardPayment'
          AND t.status <> 'cancelled' AND (t.target_account_id = a.id OR t.account_id = a.id)), 0) AS cents
        FROM accounts a WHERE a.type = 'creditCard' ORDER BY a.id`).rows.raw();
      const read = (s: typeof next) => s.sql.query("SELECT id, debt_balance_amount AS debt FROM accounts WHERE type = 'creditCard' ORDER BY id").rows.raw();
      const nextDebts = read(next), previousDebts = read(previous);
      for (const [index, row] of oracle.entries()) {
        const cents = BigInt(Number(row.cents));
        expect(Object.is(nextDebts[index]!.debt, oracleDouble(cents < 0n ? 0n : cents))).toBe(true);
      }
      // Whole pesos (and the representative ,50 amounts): bit for bit equal to the previous implementation.
      if (variant === 'pesos') expect(nextDebts).toEqual(previousDebts);
      const summary = await getDashboardSummaryFromDb(next.sql.database, date);
      const previousSummary = await getDashboardSummaryFromDb(previous.sql.database, date);
      // Monthly 6A figures do not depend on the stored debt: identical in both databases.
      expect([summary.monthlyIncome, summary.monthlyExpenses, summary.monthlySavings])
        .toEqual([previousSummary.monthlyIncome, previousSummary.monthlyExpenses, previousSummary.monthlySavings]);
      const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
      const span = next.sql.query('SELECT count(*) AS n, min(date) AS first, max(date) AS last FROM transactions').rows.raw()[0];
      (evidence.volume ??= {} as Record<string, unknown>);
      (evidence.volume as Record<string, unknown>)[`${size}-${variant}`] = {
        rows: span, oracle: oracle.map(r => ({ id: r.id, cents: String(r.cents) })),
        nextDebts, previousDebts, medianMs: { next: median(runs.next), previous: median(runs.previous) }, runs,
        totalDebt: { next: String(summary.totalDebt), previous: String(previousSummary.totalDebt) },
      };
    } finally { next.sql.native.close(); previous.sql.native.close(); }
  }, 300000);
});

test('read-only detection of drifted balances: no false positives on canonical amounts', async () => {
  const sql = await freshDatabase();
  try {
    const random = lcg(6103);
    const canonical = Array.from({ length: 20000 }, () => Math.floor((random() - 0.5) * 2e15) / 100);
    const drifted = [97599.49999999999, 661275.6799999999, -2.7755575615628914e-17, 94561.99999999999, 2.9103830456733704e-11, 123456.78000000717];
    const insert = sql.native.prepare("INSERT INTO accounts (id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES (?,?,'bankAccount','active','COP',?,'2026-01-01','2026-01-01')");
    [...canonical, ...drifted].forEach((value, index) => insert.run(`a${index}`, `a${index}`, value));
    const found = sql.query(`SELECT balance_amount AS v FROM accounts WHERE balance_amount <> round(balance_amount, 2)
      OR (debt_balance_amount IS NOT NULL AND debt_balance_amount <> round(debt_balance_amount, 2))`).rows.raw().map(r => r.v);
    expect(found.sort()).toEqual([...drifted].sort());
    expect(drifted.every(v => toExactCopCents(v) === undefined)).toBe(true);
  } finally { sql.native.close(); }
});

test('evidence covers every 6B.1 probe', () => {
  expect(PHASE6B1_PROBES.length).toBe(14);
});
