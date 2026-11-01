import React from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import Toast from 'react-native-toast-message';
import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { SQLiteCommandFailure } from '../src/database/atomicSQLite';
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState, requireIntegralRollback } from './helpers/financialState';
import * as previousCards from './helpers/pre6B3CreditCardRelations';
import { registerCreditCardPayment } from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { getCreditCardsOverview } from '../src/modules/creditCards/useCases/getCreditCardsOverview';
import { deleteCreditCard } from '../src/modules/creditCards/useCases/manageCreditCards';
import { CreditCardsScreen } from '../src/modules/creditCards/ui/CreditCardsScreen';
import { CreditCardPaymentAction, CreditCardPaymentModal } from '../src/modules/creditCards/ui/components/CreditCardPayment';
import * as hooks from '../src/modules/creditCards/hooks';
import { formatCurrency, formatCurrencyWithCents } from '../src/shared/utils/formatCurrency';
import { formatCOP } from '../src/modules/transactions/ui/transactionsScreenFormatters';
import { formatExactCopAmountInput } from '../src/shared/utils/copAmountInput';
import {
  NEXT_IMPLEMENTATION, PHASE6B3_DATE, PHASE6B3_PROBES, runPhase6B3Probe, type Phase6B3Implementation, type Phase6B3Probe,
} from '../scripts/phase6b3/probes';
import { centsText, textCents } from '../scripts/phase6b/probes';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
jest.mock('react-native-config', () => ({}));
jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('../src/modules/creditCards/hooks', () => ({ useCreditCardsOverview: jest.fn() }));

// Phase 6B.3 (6B-C1): an explicit whole-debt settlement pays the exact debt with cents, also below
// $1; partial payments keep the phase 3B contract bit for bit against the frozen pre-6B.3 copy.
// Independent oracle: BigInt cents over decimal texts. No tolerance anywhere.
const fs = require('node:fs') as { writeFileSync: (f: string, c: string) => void; mkdirSync: (p: string, o: object) => void };

const PREVIOUS: Phase6B3Implementation = { name: 'previous', registerCreditCardPayment: previousCards.registerCreditCardPayment };
/** Intl separates the COP symbol from the digits with a no-break space (U+00A0). */
const cop = (text: string) => text.replace(/\$ /g, '$ ');

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(PHASE6B3_DATE);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

const evidence: Record<string, unknown> = {};
afterAll(() => {
  fs.mkdirSync('docs/correccion-fase6b3/node', { recursive: true });
  fs.writeFileSync('docs/correccion-fase6b3/node/results.json', JSON.stringify(evidence, null, 2) + '\n');
});

async function probe(name: Phase6B3Probe, impl: Phase6B3Implementation): Promise<any> {
  const sql = realSQLite({ fixedSqlDate: PHASE6B3_DATE });
  try {
    sql.native.exec('PRAGMA foreign_keys = ON;');
    for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
    await applyVersionedMigrations(sql.database);
    const result = await runPhase6B3Probe(sql.database, name, impl);
    expect(sql.query('PRAGMA integrity_check').rows.raw()).toEqual([{ integrity_check: 'ok' }]);
    expect(sql.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
    return result;
  } finally { sql.native.close(); }
}

const outcome = (step: any) => step.rejected ? 'rejected' : step.paid;

describe('6B-C1 probes: before (frozen pre-6B.3) and after', () => {
  const results: Record<string, { previous: any; next: any }> = {};
  afterAll(() => { evidence.probes = results; });
  const both = async (name: Phase6B3Probe) => (results[name] = { previous: await probe(name, PREVIOUS), next: await probe(name, NEXT_IMPLEMENTATION) });

  test('A: 10.000,40, partial 10.000 leaves 0,40; partial 0,40 still rejected; "Pagar deuda total" pays 0,40 and the card closes', async () => {
    const { previous, next } = await both('scenarioA');
    expect(previous.steps.map(outcome)).toEqual(['10000', 'rejected', 'rejected', 'rejected']);
    expect(previous.closure).toMatch(/^rejected/);
    expect(previous.final.display.debt).toBe(cop('$ 0,40')); // 6B.3 display of the unpaid 0,40 debt
    expect(next.steps.map(outcome)).toEqual(['10000', 'rejected', '0.4', 'rejected']);
    expect(next.steps[1].rejected).toBe(previous.steps[1].rejected);
    expect(next.steps[2]).toMatchObject({ remainingDebt: '0', after: { debt: '0', bank: '989999.6', netWorth: '989999.6', monthlyExpenses: '10000.4', statement: { total_amount: 0, status: 'paid' }, payments: ['10000', '0.4'] } });
    expect(next.steps[3].rejected).toBe('La tarjeta no tiene saldo pendiente por pagar.');
    expect(next.steps.every((step: any) => step.oracle.ok)).toBe(true);
    expect(next.closure).toBe('closed');
  });

  test('B: a single 0,40 debt is settled exactly; the partial form keeps rejecting it', async () => {
    const { previous, next } = await both('scenarioB');
    expect(previous.steps.map(outcome)).toEqual(['rejected', 'rejected']);
    expect(next.steps.map(outcome)).toEqual(['rejected', '0.4']);
    expect(next.steps[0].rejected).toBe('El importe del pago debe ser de al menos $1 COP.');
    expect(next.steps[1].after).toMatchObject({ debt: '0', bank: '999999.6', netWorth: '999999.6', payments: ['0.4'] });
    expect(next.initial.display.debt).toBe(cop('$ 0,40'));
    expect(next.steps.every((step: any) => step.oracle.ok) && next.closure === 'closed').toBe(true);
  });

  test('C: 10.000,40 in one operation: partial keeps paying 10.000 (3B); settlement pays 10.000,40', async () => {
    const { previous, next } = await both('scenarioC');
    expect(next.partial.steps).toEqual(previous.partial.steps);
    expect(next.partial.steps[0]).toMatchObject({ paid: '10000', remainingDebt: '0.4' });
    expect(next.partial.closure).toMatch(/^rejected/);
    expect(next.fullDebt.steps[0]).toMatchObject({ paid: '10000.4', remainingDebt: '0', after: { debt: '0', bank: '989999.6', netWorth: '989999.6' } });
    expect(next.fullDebt.steps[0].oracle.ok && next.fullDebt.closure === 'closed').toBe(true);
  });

  test('D: 94.562 (6B.1) is identical through partial and settlement', async () => {
    const { previous, next } = await both('scenarioD');
    expect(next.partial).toEqual(previous.partial);
    expect(next.fullDebt.steps[0]).toMatchObject({ paid: '94562', remainingDebt: '0', after: next.partial.steps[0].after });
    expect(next.fullDebt.closure).toBe('closed');
  });

  test('edge cases: small partials, insufficient balance, stale debt, drifted source, installments', async () => {
    const whole = (await both('settleWholePesos')).next;
    expect(whole.steps[0]).toMatchObject({ paid: '250000', oracle: { ok: true } });

    const small = await both('partialSmallRejected');
    expect(small.next.steps.slice(0, 2)).toEqual(small.previous.steps.slice(0, 2));
    expect(small.next.steps[2]).toMatchObject({ paid: '0.5', after: { debt: '0', bank: '999999.5' } });

    const insufficient = await both('insufficientBalance');
    expect(insufficient.previous.steps[0]).toMatchObject({ paid: '10000', remainingDebt: '0.4' });
    expect(insufficient.next.steps[0]).toMatchObject({ rejected: 'La cuenta origen no tiene saldo suficiente para ese pago.', after: { bank: '10000.39', debt: '10000.4' } });

    const stale = (await both('staleExpectedDebt')).next;
    expect(stale.steps.map((step: any) => step.rejected)).toEqual([
      'La deuda de la tarjeta cambio. Revisa el saldo pendiente antes de pagar el total.',
      'La deuda de la tarjeta cambio. Revisa el saldo pendiente antes de pagar el total.',
    ]);
    expect(stale.final).toMatchObject({ debt: '10000.4', bank: '1000000', payments: [] });

    const drifted = (await both('driftedSource')).next;
    expect(drifted.cents.steps[0]).toMatchObject({ rejected: expect.stringMatching(/cuenta origen tiene un saldo con fracciones/), after: { bank: '97599.49999999999', debt: '0.4' } });
    expect(drifted.wholePesos.steps[0]).toMatchObject({ paid: '5000', after: { debt: '0' } });

    const installments = await both('settleAfterInstallments');
    expect(installments.previous.result).toMatchObject({ paid: '30000', remainingDebt: '0.3' });
    expect(installments.next.result).toMatchObject({ paid: '30000.3', remainingDebt: '0' });
    expect(installments.next.after).toMatchObject({ debt: '0', bank: '969999.7', statement: { status: 'paid' } });
    expect(installments.next.oracle.ok).toBe(true);
    // Payments do not advance installment progress (unchanged rule); closure keeps its guard.
    expect(installments.next.closure).toBe('rejected: No puedes eliminar la tarjeta porque tiene compras a cuotas vigentes.');
  });

  test('every probe was compared', () => {
    expect(Object.keys(results).sort()).toEqual([...PHASE6B3_PROBES].sort());
  });
});

describe('partial payments keep the phase 3B contract against the frozen copy', () => {
  test('random debts (pesos and cents) and requested amounts: identical outcome, message and persisted state', async () => {
    let state = 6203;
    const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
    const cases: Array<{ purchase: string; amount: string }> = [];
    for (let i = 0; i < 40; i++) {
      const cents = BigInt(Math.floor(next() * 5000000) + 1);
      const purchase = centsText(i % 2 ? cents : cents * 100n);
      const pick = Math.floor(next() * 6);
      const debt = textCents(purchase);
      const amount = [centsText(debt), centsText(debt + 99n), '0.01', '0.49', '0.5', centsText(debt / 3n)][pick]!;
      cases.push({ purchase, amount });
    }
    const run = async (pay: typeof registerCreditCardPayment, c: { purchase: string; amount: string }) => {
      const f = await financialIntegrityFixture({ managed: true });
      try {
        await f.save({ accountId: 'card', operationType: 'Crédito', amount: Number(c.purchase) });
        let result: unknown;
        try {
          const r = await pay({ ...f, accountId: 'card', sourceAccountId: 'bank', amount: Number(c.amount), currentDate: FINANCIAL_TEST_DATE });
          result = { paid: r.paidAmount, remaining: r.remainingDebt, amount: r.transaction.amount };
        } catch (error) { result = { rejected: (error as Error).message }; }
        return { result, snapshot: await f.snapshot() };
      } finally { f.native.close(); }
    };
    let compared = 0;
    for (const c of cases) {
      expect(await run(registerCreditCardPayment, c)).toEqual(await run(previousCards.registerCreditCardPayment, c));
      compared++;
    }
    evidence.partialEquivalence = { compared, cases };
  });
});

describe('settlement validation, atomicity and unknown results', () => {
  async function card(purchases: number[]) {
    const f = await financialIntegrityFixture({ managed: true });
    for (const amount of purchases) await f.save({ accountId: 'card', operationType: 'Crédito', amount });
    return f;
  }
  const settle = (f: Awaited<ReturnType<typeof card>>, amount: number) =>
    registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount, settlement: 'fullDebt', currentDate: FINANCIAL_TEST_DATE });

  test.each([Infinity, -Infinity, NaN, 0, -0.4, 0.001, 0.405, 2 ** 46])('settlement amount %p is rejected before any write', async amount => {
    const f = await card([0.4]);
    try {
      const before = await financialState(f);
      f.resetTrace();
      await expect(settle(f, amount)).rejects.toThrow();
      expect(f.trace.some(entry => entry.write !== undefined)).toBe(false);
      requireIntegralRollback(before, await financialState(f));
    } finally { f.native.close(); }
  });

  test('an unknown settlement kind is rejected before any write', async () => {
    const f = await card([0.4]);
    try {
      f.resetTrace();
      await expect(registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount: 0.4, settlement: 'total' as never }))
        .rejects.toThrow('Tipo de pago de tarjeta no valido.');
      expect(f.trace).toHaveLength(0);
    } finally { f.native.close(); }
  });

  test.each([[[0.4], 0.4], [[10000.4], 10000.4], [[4229.9, 89392.54, 939.56], 94562]])(
    'settlement of %p: fault before/after every write rolls back everything', async (purchases, debt) => {
      const success = await card(purchases);
      let writes: number;
      try {
        success.resetTrace();
        await expect(settle(success, debt)).resolves.toMatchObject({ paidAmount: debt, previousDebt: debt, remainingDebt: 0 });
        writes = success.trace.filter(entry => entry.write !== undefined).length;
        expect(await success.snapshot()).toMatchObject({ debt: 0, balances: { bank: Number(centsText(100000000n - textCents(String(debt)))) } });
      } finally { success.native.close(); }
      let points = 0;
      for (let write = 1; write <= writes; write++) for (const phase of ['before', 'after'] as const) {
        const f = await card(purchases);
        try {
          const before = await financialState(f);
          f.resetTrace(); f.injectFault({ write, phase });
          await expect(settle(f, debt)).rejects.toBeDefined();
          f.injectFault();
          expect(f.trace.filter(entry => entry.sql.startsWith('ROLLBACK') && entry.outcome === 'ok')).toHaveLength(1);
          requireIntegralRollback(before, await financialState(f));
          points++;
        } finally { f.native.close(); }
      }
      (evidence.settlementRollback ??= {} as Record<string, unknown>);
      (evidence.settlementRollback as Record<string, unknown>)[String(debt)] = { writes, points };
      expect(points).toBe(writes * 2);
    });

  test('a rejection after the initial reconciliation (stale debt) rolls back its writes', async () => {
    const f = await card([10000.4]);
    try {
      const before = await financialState(f);
      f.resetTrace();
      await expect(settle(f, 10000)).rejects.toThrow('La deuda de la tarjeta cambio');
      expect(f.trace.filter(entry => entry.sql.startsWith('ROLLBACK') && entry.outcome === 'ok')).toHaveLength(1);
      requireIntegralRollback(before, await financialState(f));
    } finally { f.native.close(); }
  });

  test('the same confirmed request is not paid twice; a new request finds no debt', async () => {
    const f = await card([0.4]);
    try {
      const command = { ...f, accountId: 'card', sourceAccountId: 'bank', amount: 0.4, settlement: 'fullDebt' as const, currentDate: FINANCIAL_TEST_DATE };
      const first = await registerCreditCardPayment(command);
      f.resetTrace();
      expect(await registerCreditCardPayment(command)).toBe(first);
      expect(f.trace).toHaveLength(0);
      await expect(registerCreditCardPayment({ ...command })).rejects.toThrow('La tarjeta no tiene saldo pendiente por pagar.');
      const payments = (await f.transactionRepository.getTransactions()).filter(tx => tx.type === 'creditCardPayment');
      expect(payments.map(tx => [tx.amount, tx.targetAccountId, tx.paymentMethod, tx.status])).toEqual([[0.4, 'card', 'debit', 'posted']]);
      expect(await f.snapshot()).toMatchObject({ balances: { bank: 999999.6 }, debt: 0, expense: 0.4, wealth: 999999.6 });
    } finally { f.native.close(); }
  });

  test('unknown COMMIT of a settlement is never retried for the same request', async () => {
    const f = await card([0.4]);
    const command = { ...f, accountId: 'card', sourceAccountId: 'bank', amount: 0.4, settlement: 'fullDebt' as const, currentDate: FINANCIAL_TEST_DATE };
    f.resetTrace(); f.injectFault({ sql: 'COMMIT', phase: 'after' });
    let failure: unknown;
    try { await registerCreditCardPayment(command); } catch (error) { failure = error; }
    expect((failure as SQLiteCommandFailure).result.status).toBe('unknown');
    const count = f.trace.length;
    await expect(registerCreditCardPayment(command)).rejects.toBe(failure);
    expect(f.trace).toHaveLength(count);
    await expect(f.accountRepository.getAccounts()).rejects.toThrow('not usable');
  });

  test('closure after settlement leaves no debt, pending statement or installments', async () => {
    const f = await card([0.4]);
    try {
      await settle(f, 0.4);
      const overview = await getCreditCardsOverview(f.creditCardRepository, f.transactionRepository, FINANCIAL_TEST_DATE);
      const summary = overview.cards.find(c => c.account.id === 'card')!;
      expect(summary).toMatchObject({ usedCredit: 0, utilizationRatio: 0, installments: [] });
      expect(f.query("SELECT total_amount, status FROM credit_card_statements WHERE account_id = 'card'").rows.raw())
        .toEqual([{ total_amount: 0, status: 'paid' }]);
      await deleteCreditCard(f.creditCardRepository, 'card');
      expect((await f.accountRepository.getAccounts()).find(a => a.id === 'card')?.status).toBe('closed');
      expect(f.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
    } finally { f.native.close(); }
  });
});

describe('presentation of amounts below $1 (6B.3)', () => {
  const plain = (value: number) => new Intl.NumberFormat('es-CO', { currency: 'COP', maximumFractionDigits: 0, minimumFractionDigits: 0, style: 'currency' }).format(value === 0 ? 0 : value);

  test('0 < |amount| < 1 shows two decimals; zero stays $ 0', () => {
    const table = Object.fromEntries([0.4, -0.4, 0.01, -0.01, 0.99, 0.5, 0, -0].map(v => [String(Object.is(v, -0) ? '-0' : v), [formatCurrency(v, 'COP'), formatCOP(v)]]));
    expect(JSON.parse(cop(JSON.stringify({
      '0.4': ['$ 0,40', '$ 0,40'], '-0.4': ['-$ 0,40', '-$ 0,40'], '0.01': ['$ 0,01', '$ 0,01'], '-0.01': ['-$ 0,01', '-$ 0,01'],
      '0.99': ['$ 0,99', '$ 0,99'], '0.5': ['$ 0,50', '$ 0,50'], '0': ['$ 0', '$ 0'], '-0': ['$ 0', '$ 0'],
    })))).toEqual(table);
    evidence.display = table;
  });

  test('legacy residues are never shown as zero', () => {
    expect(formatCurrency(0.004, 'COP')).toBe(cop('< $ 0,01'));
    expect(formatCurrency(-2.7755575615628914e-17, 'COP')).toBe(cop('> -$ 0,01'));
    expect(formatCurrency(0.3999999999996362, 'COP')).toBe(cop('$ 0,40'));
    expect(formatCurrency(0.49999999999999994, 'COP')).toBe(cop('$ 0,50'));
  });

  test('|amount| >= 1 and non-finite values are unchanged: cent by cent 1,00–1.000,00, a seeded sample and the limits', () => {
    let compared = 0;
    let seed = 6303;
    const sample = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const values: number[] = [];
    for (let cents = 100; cents <= 100000; cents++) values.push(cents / 100);
    for (let i = 0; i < 20000; i++) values.push(Math.floor(sample() * 1e13 + 100) / 100);
    for (const magnitude of values) for (const sign of [1, -1]) {
      const value = sign * magnitude;
      if (formatCurrency(value, 'COP') !== plain(value) || formatCOP(value) !== plain(value)) throw new Error(`changed ${value}`);
      compared++;
    }
    for (const value of [1, -1, 1.4, 1e15, -1e15, Number.MAX_SAFE_INTEGER, Infinity, -Infinity, NaN])
      expect([formatCurrency(value, 'COP'), formatCOP(value)]).toEqual([plain(value), plain(value)]);
    evidence.displayUnchanged = { compared };
  });

  test('payment surfaces show the exact debt and fill the exact input text', () => {
    expect(formatCurrencyWithCents(10000.4, 'COP')).toBe(cop('$ 10.000,40'));
    expect(formatCurrencyWithCents(94562, 'COP')).toBe(cop('$ 94.562'));
    expect(formatCurrencyWithCents(0.4, 'COP')).toBe(cop('$ 0,40'));
    expect([10000.4, 0.4, 0.01, 94562, 1.05, 1234567.89].map(formatExactCopAmountInput)).toEqual(['10.000,40', '0,40', '0,01', '94.562', '1,05', '1.234.567,89']);
    expect([0.3999999999996362, -0.4, NaN].map(formatExactCopAmountInput)).toEqual([undefined, undefined, undefined]);
  });
});

describe('payment screen: partial form vs "Pagar deuda total"', () => {
  async function setup(purchases: number[]) {
    const f = await financialIntegrityFixture({ managed: true });
    for (const amount of purchases) await f.save({ accountId: 'card', operationType: 'Crédito', amount });
    const overview = await getCreditCardsOverview(f.creditCardRepository, f.transactionRepository, FINANCIAL_TEST_DATE);
    jest.mocked(hooks.useCreditCardsOverview).mockReturnValue({ loading: false, overview });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let view!: ReactTestRenderer;
    await act(async () => { view = create(<CreditCardsScreen activeTheme="dark" database={f.database} onNavigateToHome={() => {}} onNavigateToTransactions={() => {}} onOpenDebitCards={() => {}} onOpenSettings={() => {}} />); });
    await act(async () => view.root.findByType(CreditCardPaymentAction).props.onPress());
    const modal = () => view.root.findByType(CreditCardPaymentModal);
    const texts = () => view.root.findAll(node => typeof node.type === 'string' && String(node.type) === 'Text')
      .map(node => [node.props.children].flat().join(''));
    const close = async () => { await act(async () => view.unmount()); consoleError.mockRestore(); f.native.close(); };
    return { ...f, view, alert, modal, texts, close };
  }

  test('a 0,40 debt is visible, the partial form rejects it, and "Pagar deuda total" pays it exactly', async () => {
    const f = await setup([0.4]);
    try {
      expect(f.texts()).toEqual(expect.arrayContaining(['Saldo pendiente: $ 0,40', 'Deuda actual: $ 0,40', 'Pagar deuda total: $ 0,40'].map(cop)));
      expect(f.modal().props).toMatchObject({ amount: '', fullDebtSelected: false });
      await act(async () => f.modal().props.onAmountChange('0,40'));
      await act(async () => f.modal().props.onSave());
      expect(f.alert).toHaveBeenLastCalledWith('SmartFin', 'El importe del pago debe ser de al menos $1 COP.');
      await act(async () => f.modal().props.onSelectFullDebt());
      expect(f.modal().props).toMatchObject({ amount: '0,40', fullDebtSelected: true });
      await act(async () => f.modal().props.onSave());
      expect(Toast.show).toHaveBeenLastCalledWith(expect.objectContaining({ text2: cop('Se restauro $ 0,40 de cupo disponible.') }));
      expect(await f.snapshot()).toMatchObject({ balances: { bank: 999999.6 }, debt: 0, wealth: 999999.6, expense: 0.4 });
      await act(async () => f.modal().props.onSave());
      expect((await f.transactionRepository.getTransactions()).filter(tx => tx.type === 'creditCardPayment')).toHaveLength(1);
    } finally { await f.close(); }
  });

  test('editing the amount after choosing the total returns to a partial payment', async () => {
    const f = await setup([10000.4]);
    try {
      expect(f.modal().props.amount).toBe('');
      await act(async () => f.modal().props.onSelectFullDebt());
      expect(f.modal().props).toMatchObject({ amount: '10.000,40', fullDebtSelected: true });
      await act(async () => f.modal().props.onAmountChange('10.000,40'));
      expect(f.modal().props.fullDebtSelected).toBe(false);
      await act(async () => f.modal().props.onSave());
      expect(await f.snapshot()).toMatchObject({ balances: { bank: 990000 }, debt: 0.4 });
    } finally { await f.close(); }
  });

  test('whole-peso debts keep the previous prefill; settlement with insufficient balance is explained without effects', async () => {
    const f = await setup([250000]);
    try {
      expect(f.modal().props.amount).toBe('250.000');
      await f.save({ amount: 800000 });
      await act(async () => f.modal().props.onSelectFullDebt());
      const before = await financialState(f);
      f.resetTrace();
      await act(async () => f.modal().props.onSave());
      expect(f.alert).toHaveBeenLastCalledWith('SmartFin', 'La cuenta origen no tiene saldo suficiente para ese pago.');
      requireIntegralRollback(before, await financialState(f));
    } finally { await f.close(); }
  });

  test('an unknown settlement blocks a second press without SQL', async () => {
    const f = await setup([0.4]);
    try {
      await act(async () => f.modal().props.onSelectFullDebt());
      f.injectFault({ sql: 'COMMIT', phase: 'after' });
      await act(async () => f.modal().props.onSave());
      expect(f.alert).toHaveBeenLastCalledWith('SmartFin', expect.stringContaining('No se pudo confirmar'));
      const count = f.trace.length;
      await act(async () => f.modal().props.onSave());
      expect(f.alert).toHaveBeenLastCalledWith('SmartFin', expect.stringContaining('Verifica su estado'));
      expect(f.trace).toHaveLength(count);
    } finally { await act(async () => f.view.unmount()); }
  });
});
