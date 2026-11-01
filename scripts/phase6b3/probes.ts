// Phase 6B.3 probes: exact settlement of a card debt with cents (6B-C1). The same synthetic
// scenarios run in Node (node:sqlite) and in the isolated Android APK (real driver), through the
// production use case and through the frozen pre-6B.3 copy. Every persisted value is compared with
// an independent BigInt oracle over decimal texts. Synthetic data, fixed date, no tolerance.
import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import { saveManualTransaction, type SaveManualTransactionParams } from '../../src/modules/transactions/useCases/saveManualTransaction';
import * as nextCards from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { deleteCreditCard } from '../../src/modules/creditCards/useCases/manageCreditCards';
import { formatCurrency } from '../../src/shared/utils/formatCurrency';
import { textCents, resetSyntheticData } from '../phase6b/probes';

export const PHASE6B3_DATE = new Date('2026-10-11T12:00:00.000Z');

type PaymentParams = Parameters<typeof nextCards.registerCreditCardPayment>[0];

/**
 * Payment use case under test: production (6B.3) or the frozen pre-6B.3 copy. The copy ignores the
 * settlement mode, exactly as the unmodified production code did in the reproduction.
 */
export type Phase6B3Implementation = {
  name: 'next' | 'previous';
  registerCreditCardPayment: (params: PaymentParams) => Promise<{ paidAmount: number; remainingDebt: number }>;
};

export const NEXT_IMPLEMENTATION: Phase6B3Implementation = {
  name: 'next', registerCreditCardPayment: nextCards.registerCreditCardPayment,
};

const ACCOUNT_COLUMNS = '(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at)';

async function seed(database: SmartFinSQLiteDatabase, bank: number) {
  await resetSyntheticData(database);
  await database.executeSql(`INSERT INTO accounts ${ACCOUNT_COLUMNS} VALUES
    ('bank','Banco','bankAccount','active','COP',?,NULL,'2026-01-01','2026-01-01'),
    ('card','Visa','creditCard','active','COP',0,0,'2026-01-01','2026-01-01')`, [bank]);
}

function context(database: SmartFinSQLiteDatabase, impl: Phase6B3Implementation) {
  const deps = {
    accountRepository: createSqliteAccountRepository(database),
    transactionRepository: createSqliteTransactionRepository(database),
    creditCardRepository: createSqliteCreditCardRepository(database),
  };
  const purchase = async (amount: string, changes: Partial<SaveManualTransactionParams> = {}) => saveManualTransaction({
    ...deps, accounts: await deps.accountRepository.getAccounts(),
    accountId: 'card', amount: Number(amount), merchantName: 'Sintetico 6B.3', operationType: 'Crédito', transactionType: 'expense',
    hasInterestFreeInstallments: false, installmentCountInput: '1', interestFreeInstallmentCountInput: '',
    currentDate: PHASE6B3_DATE, ...changes,
  });
  /** Partial payment (normal form) or explicit whole-debt settlement ("Pagar deuda total"). */
  const pay = async (amount: number, mode: 'partial' | 'fullDebt' = 'partial') => {
    try {
      const result = await impl.registerCreditCardPayment({
        ...deps, accountId: 'card', sourceAccountId: 'bank', amount, currentDate: PHASE6B3_DATE,
        ...(mode === 'fullDebt' ? { settlement: 'fullDebt' as const } : {}),
      });
      return { mode, requested: String(amount), paid: String(result.paidAmount), remainingDebt: String(result.remainingDebt) };
    } catch (error) {
      return { mode, requested: String(amount), rejected: (error as Error).message };
    }
  };
  const close = async () => {
    try { await deleteCreditCard(deps.creditCardRepository, 'card'); return 'closed'; } catch (error) { return `rejected: ${(error as Error).message}`; }
  };
  return { deps, purchase, pay, close };
}

/** Every financial figure of the state, as text, plus the visible text of the debt and bank. */
async function state(database: SmartFinSQLiteDatabase) {
  const [accounts] = await database.executeSql("SELECT id, balance_amount, debt_balance_amount, status FROM accounts ORDER BY id");
  const rows = Array.from({ length: accounts.rows.length }, (_, i) => accounts.rows.item(i));
  const bank = rows.find(row => row.id === 'bank')!;
  const card = rows.find(row => row.id === 'card')!;
  const summary = await getDashboardSummaryFromDb(database, PHASE6B3_DATE);
  const [statement] = await database.executeSql("SELECT total_amount, minimum_payment_amount, status FROM credit_card_statements WHERE account_id = 'card'");
  const [payments] = await database.executeSql("SELECT amount FROM transactions WHERE type = 'creditCardPayment' ORDER BY created_at, id");
  return {
    bank: String(bank.balance_amount), debt: String(card.debt_balance_amount), cardStatus: String(card.status),
    available: String(summary.availableBalance), totalDebt: String(summary.totalDebt), netWorth: String(summary.netWorth),
    monthlyExpenses: String(summary.monthlyExpenses),
    statement: statement.rows.length ? statement.rows.item(0) : null,
    payments: Array.from({ length: payments.rows.length }, (_, i) => String(payments.rows.item(i).amount)),
    display: { debt: formatCurrency(Number(card.debt_balance_amount), 'COP'), bank: formatCurrency(Number(bank.balance_amount), 'COP') },
  };
}

async function sqliteChecks(database: SmartFinSQLiteDatabase) {
  const [integrity] = await database.executeSql('PRAGMA integrity_check');
  const [fk] = await database.executeSql('PRAGMA foreign_key_check');
  return { integrity: String(integrity.rows.item(0).integrity_check), foreignKeyViolations: fk.rows.length };
}

/**
 * Independent oracle in cents: the bank loses exactly what was paid, the debt drops by the same
 * amount, net worth does not move with a payment and monthly expenses stay at the purchases.
 */
function oracle(initialBank: string, purchases: string[], before: Awaited<ReturnType<typeof state>>, after: Awaited<ReturnType<typeof state>>) {
  const decimal = /^-?\d+(?:\.\d{1,2})?$/;
  if (![initialBank, before.bank, after.bank].every(text => decimal.test(text))) {
    // A drifted (non two-decimal) balance has no exact decimal: report it, never approximate it.
    return { ok: false, nonCanonicalBank: true };
  }
  const purchased = purchases.reduce((total, amount) => total + textCents(amount), 0n);
  const paid = after.payments.reduce((total, amount) => total + textCents(amount), 0n);
  const stepPaid = paid - before.payments.reduce((total, amount) => total + textCents(amount), 0n);
  const checks = {
    bank: textCents(after.bank) === textCents(initialBank) - paid,
    debt: decimal.test(after.debt) && textCents(after.debt) === purchased - paid,
    bankDelta: textCents(before.bank) - textCents(after.bank) === stepPaid,
    debtDelta: textCents(before.debt) - textCents(after.debt) === stepPaid,
    netWorthUnchanged: after.netWorth === before.netWorth,
    expensesUnchanged: after.monthlyExpenses === before.monthlyExpenses && textCents(after.monthlyExpenses) === purchased,
    dashboardDebt: after.totalDebt === after.debt,
  };
  return { ...checks, ok: Object.values(checks).every(Boolean) };
}

type Step = { label: string; amount: string; mode: 'partial' | 'fullDebt' };

async function scenario(database: SmartFinSQLiteDatabase, impl: Phase6B3Implementation, purchases: string[], steps: Step[], bank = '1000000') {
  await seed(database, Number(bank));
  const c = context(database, impl);
  for (const amount of purchases) await c.purchase(amount);
  const initial = await state(database);
  const trace = [];
  let previous = initial;
  for (const step of steps) {
    const result = await c.pay(Number(step.amount), step.mode);
    const after = await state(database);
    trace.push({ label: step.label, ...result, after, oracle: oracle(bank, purchases, previous, after) });
    previous = after;
  }
  return { purchases, initial, steps: trace, closure: await c.close(), final: await state(database), sqlite: await sqliteChecks(database) };
}

export const PHASE6B3_PROBES = [
  'scenarioA', 'scenarioB', 'scenarioC', 'scenarioD', 'settleWholePesos', 'partialSmallRejected',
  'insufficientBalance', 'staleExpectedDebt', 'driftedSource', 'settleAfterInstallments',
] as const;
export type Phase6B3Probe = (typeof PHASE6B3_PROBES)[number];

/**
 * Node runs the probes under jest.setSystemTime(PHASE6B3_DATE). saveManualTransaction reconciles the
 * card with the wall clock (it does not forward currentDate), so on a device the real date selected
 * another statement period (6B.3.1, API 24 and API 35: minimum 0 instead of 1000). Pin the JS clock.
 */
export async function withPhase6B3Clock<T>(run: () => Promise<T>): Promise<T> {
  const RealDate = globalThis.Date;
  const fixed = PHASE6B3_DATE.getTime();
  const ProbeDate = Object.assign(
    function ProbeDate(...args: unknown[]) { return Reflect.construct(RealDate, args.length ? args : [fixed]) as Date; },
    { now: () => fixed, parse: RealDate.parse, UTC: RealDate.UTC, prototype: RealDate.prototype },
  ) as unknown as DateConstructor;
  globalThis.Date = ProbeDate;
  try { return await run(); } finally { globalThis.Date = RealDate; }
}

export function runPhase6B3Probe(database: SmartFinSQLiteDatabase, probe: Phase6B3Probe, impl: Phase6B3Implementation = NEXT_IMPLEMENTATION) {
  return withPhase6B3Clock(() => runProbe(database, probe, impl));
}

async function runProbe(database: SmartFinSQLiteDatabase, probe: Phase6B3Probe, impl: Phase6B3Implementation) {
  switch (probe) {
    // A: purchase 10.000,40, partial 10.000, remaining 0,40, then "Pagar deuda total".
    case 'scenarioA': return scenario(database, impl, ['10000.4'], [
      { label: 'partial 10000', amount: '10000', mode: 'partial' },
      { label: 'partial 0,40', amount: '0.4', mode: 'partial' },
      { label: 'fullDebt 0,40', amount: '0.4', mode: 'fullDebt' },
      { label: 'repeat fullDebt on zero debt', amount: '0.4', mode: 'fullDebt' },
    ]);
    // B: a single 0,40 purchase.
    case 'scenarioB': return scenario(database, impl, ['0.4'], [
      { label: 'partial 0,40', amount: '0.4', mode: 'partial' },
      { label: 'fullDebt 0,40', amount: '0.4', mode: 'fullDebt' },
    ]);
    // C: purchase 10.000,40; the whole amount in one operation, partial (form) and explicit settlement.
    case 'scenarioC': return {
      partial: await scenario(database, impl, ['10000.4'], [{ label: 'partial 10000,40', amount: '10000.4', mode: 'partial' }]),
      fullDebt: await scenario(database, impl, ['10000.4'], [{ label: 'fullDebt 10000,40', amount: '10000.4', mode: 'fullDebt' }]),
    };
    // D: purchases totalling exactly 94.562 (6B.1 case B), partial and settlement.
    case 'scenarioD': return {
      partial: await scenario(database, impl, ['4229.9', '89392.54', '939.56'], [{ label: 'partial 94562', amount: '94562', mode: 'partial' }]),
      fullDebt: await scenario(database, impl, ['4229.9', '89392.54', '939.56'], [{ label: 'fullDebt 94562', amount: '94562', mode: 'fullDebt' }]),
    };
    case 'settleWholePesos': return scenario(database, impl, ['250000'], [{ label: 'fullDebt 250000', amount: '250000', mode: 'fullDebt' }]);
    // The normal form keeps the 3B contract for small amounts, also when they equal the debt.
    case 'partialSmallRejected': return scenario(database, impl, ['0.01', '0.49'], [
      { label: 'partial 0,01', amount: '0.01', mode: 'partial' },
      { label: 'partial 0,50 = debt', amount: '0.5', mode: 'partial' },
      { label: 'fullDebt 0,50', amount: '0.5', mode: 'fullDebt' },
    ]);
    case 'insufficientBalance': return scenario(database, impl, ['10000.4'], [
      { label: 'fullDebt 10000,40 from 10000,39', amount: '10000.4', mode: 'fullDebt' },
    ], '10000.39');
    // The debt changed after the user chose "Pagar deuda total": the shown amount is no longer the debt.
    case 'staleExpectedDebt': return scenario(database, impl, ['10000.4'], [
      { label: 'fullDebt with a stale 10000', amount: '10000', mode: 'fullDebt' },
      { label: 'fullDebt with a stale 10000,41', amount: '10000.41', mode: 'fullDebt' },
    ]);
    // A bank balance drifted by pre-6B.1 code cannot be debited by an exact amount with cents.
    case 'driftedSource': return {
      cents: await scenario(database, impl, ['0.4'], [{ label: 'fullDebt 0,40', amount: '0.4', mode: 'fullDebt' }], '97599.49999999999'),
      wholePesos: await scenario(database, impl, ['5000'], [{ label: 'fullDebt 5000', amount: '5000', mode: 'fullDebt' }], '97599.49999999999'),
    };
    // Installment purchase: the debt is the full purchase; settlement clears debt and statement,
    // but installment progress is not changed by payments, so closure keeps the existing guard.
    case 'settleAfterInstallments': {
      await seed(database, 1000000);
      const c = context(database, impl);
      await c.purchase('30000.3', { installmentCountInput: '3' });
      const before = await state(database);
      const result = await c.pay(30000.3, 'fullDebt');
      const after = await state(database);
      return { before, result, after, oracle: oracle('1000000', ['30000.3'], before, after), closure: await c.close(), sqlite: await sqliteChecks(database) };
    }
  }
}
