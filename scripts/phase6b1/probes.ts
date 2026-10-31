// Phase 6B.1 probes: exact cents for persisted balances (6B-D1) and card debt (6B-D2).
// The same synthetic scenarios run in Node (node:sqlite) and in the isolated Android APK (real
// driver) through the production use cases, and through the frozen pre-6B.1 implementation for
// the before/after comparison. Every persisted value is compared with an independent BigInt
// oracle over the decimal texts. Synthetic data, fixed seeds, no tolerance.
import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import * as next from '../../src/modules/transactions/useCases/saveManualTransaction';
import * as nextCards from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { deleteCreditCard } from '../../src/modules/creditCards/useCases/manageCreditCards';
import { formatCurrency } from '../../src/shared/utils/formatCurrency';
import { toExactCopCents, getCopArithmeticFallbacks, resetCopArithmeticFallbacks } from '../../src/shared/utils/exactCopCents';
import type { Transaction } from '../../src/modules/transactions/types';
import type { SaveManualTransactionParams } from '../../src/modules/transactions/useCases/saveManualTransaction';
import { centsText, textCents, resetSyntheticData } from '../phase6b/probes';

export const PHASE6B1_DATE = new Date('2026-10-11T12:00:00.000Z');

/** Use cases under test: production (6B.1) or the frozen pre-6B.1 copies. */
export type Phase6B1Implementation = {
  name: 'next' | 'previous';
  saveManualTransaction: typeof next.saveManualTransaction;
  deleteManualTransactionSafely: typeof next.deleteManualTransactionSafely;
  registerCreditCardPayment: typeof nextCards.registerCreditCardPayment;
  reconcileCreditCardTransactions: typeof nextCards.reconcileCreditCardTransactions;
};

export const NEXT_IMPLEMENTATION: Phase6B1Implementation = {
  name: 'next',
  saveManualTransaction: next.saveManualTransaction,
  deleteManualTransactionSafely: next.deleteManualTransactionSafely,
  registerCreditCardPayment: nextCards.registerCreditCardPayment,
  reconcileCreditCardTransactions: nextCards.reconcileCreditCardTransactions,
};

const ACCOUNT_COLUMNS = '(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at)';

async function seedAccounts(database: SmartFinSQLiteDatabase, rows: Array<[string, string, string, number, number | null]>) {
  for (const [id, name, type, balance, debt] of rows)
    await database.executeSql(`INSERT INTO accounts ${ACCOUNT_COLUMNS} VALUES (?,?,?,'active','COP',?,?,'2026-01-01','2026-01-01')`,
      [id, name, type, balance, debt]);
}

function context(database: SmartFinSQLiteDatabase, impl: Phase6B1Implementation) {
  const deps = {
    accountRepository: createSqliteAccountRepository(database),
    transactionRepository: createSqliteTransactionRepository(database),
    creditCardRepository: createSqliteCreditCardRepository(database),
  };
  const save = async (changes: Partial<SaveManualTransactionParams>) => impl.saveManualTransaction({
    ...deps, accounts: await deps.accountRepository.getAccounts(),
    accountId: 'bank', amount: 1, merchantName: 'Sintetico 6B.1', operationType: 'Débito', transactionType: 'expense',
    hasInterestFreeInstallments: false, installmentCountInput: '1', interestFreeInstallmentCountInput: '',
    currentDate: PHASE6B1_DATE, ...changes,
  });
  const remove = async (transaction: Transaction) => impl.deleteManualTransactionSafely({
    ...deps, accounts: await deps.accountRepository.getAccounts(), transaction,
  });
  const pay = async (amount: number, sourceAccountId = 'bank') => {
    try {
      const result = await impl.registerCreditCardPayment({ ...deps, accountId: 'card', sourceAccountId, amount, currentDate: PHASE6B1_DATE });
      return { requested: amount, paid: result.paidAmount, remainingDebt: result.remainingDebt, transaction: result.transaction };
    } catch (error) {
      return { requested: amount, rejected: (error as Error).message };
    }
  };
  const stored = async () => Object.fromEntries((await deps.accountRepository.getAccounts())
    .map(a => [a.id, { balance: a.balance.amount, debt: a.debtBalance?.amount }]));
  const close = async () => {
    try { await deleteCreditCard(deps.creditCardRepository, 'card'); return 'closed'; } catch (error) { return `rejected: ${(error as Error).message}`; }
  };
  return { deps, save, remove, pay, stored, close };
}

/** Persisted value against its exact decimal: text, canonical double and the double the oracle stores. */
function check(value: number, expected: bigint) {
  const oracleDouble = Number(centsText(expected));
  return {
    stored: String(value),
    expected: centsText(expected),
    canonical: toExactCopCents(value) !== undefined,
    equalsOracle: Object.is(value, oracleDouble),
    display: formatCurrency(value, 'COP'),
  };
}

async function sqliteChecks(database: SmartFinSQLiteDatabase) {
  const [integrity] = await database.executeSql('PRAGMA integrity_check');
  const [fk] = await database.executeSql('PRAGMA foreign_key_check');
  return { integrity: String(integrity.rows.item(0).integrity_check), foreignKeyViolations: fk.rows.length };
}

async function counts(database: SmartFinSQLiteDatabase) {
  const result: Record<string, number> = {};
  for (const table of ['transactions', 'installment_purchases', 'credit_card_statements']) {
    const [r] = await database.executeSql(`SELECT count(*) AS n FROM ${table}`);
    result[table] = Number(r.rows.item(0).n);
  }
  return result;
}

const sumCents = (values: string[]) => values.reduce((total, value) => total + textCents(value), 0n);

/** P1 (6B): four two-decimal incomes accumulate into one balance. */
async function balanceAccumulation(database: SmartFinSQLiteDatabase, impl: Phase6B1Implementation) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 0, null]]);
  const c = context(database, impl);
  const amounts = ['36360.06', '36224.28', '19556.65', '5458.51'];
  for (const amount of amounts) await c.save({ transactionType: 'income', amount: Number(amount) });
  const summary = await getDashboardSummaryFromDb(database, PHASE6B1_DATE);
  const expected = sumCents(amounts);
  return {
    amounts, balance: check((await c.stored()).bank!.balance, expected),
    availableBalance: check(summary.availableBalance, expected), netWorth: check(summary.netWorth, expected),
    monthlyIncome: check(summary.monthlyIncome, expected), sqlite: await sqliteChecks(database),
  };
}

/** P2 (6B): add and delete an expense; the reversal must restore the exact previous balance. */
async function reversal(database: SmartFinSQLiteDatabase, impl: Phase6B1Implementation) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 661275.68, null]]);
  const c = context(database, impl);
  const before = (await c.stored()).bank!.balance;
  const created = await c.save({ amount: 93616.69 });
  const during = (await c.stored()).bank!.balance;
  await c.remove(created.transaction);
  const after = (await c.stored()).bank!.balance;
  return {
    before: String(before), during: check(during, textCents('661275.68') - textCents('93616.69')),
    after: check(after, textCents('661275.68')), restoredBitExact: Object.is(after, before),
    transactionsLeft: (await counts(database)).transactions, sqlite: await sqliteChecks(database),
  };
}

/** P3 (6B): purchases whose exact total is whole pesos; pay the whole debt and close the card. */
async function cardFullPayment(database: SmartFinSQLiteDatabase, impl: Phase6B1Implementation, purchases: string[]) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 1000000, null], ['card', 'Visa', 'creditCard', 0, 0]]);
  const c = context(database, impl);
  for (const amount of purchases) await c.save({ accountId: 'card', operationType: 'Crédito', amount: Number(amount) });
  const total = sumCents(purchases);
  const debtAfterPurchases = (await c.stored()).card!.debt!;
  const before = await getDashboardSummaryFromDb(database, PHASE6B1_DATE);
  const fullPayment = await c.pay(Number(centsText(total)));
  const after = await c.stored();
  const summary = await getDashboardSummaryFromDb(database, PHASE6B1_DATE);
  const paid = 'paid' in fullPayment && fullPayment.paid !== undefined ? BigInt(fullPayment.paid) * 100n : 0n;
  const [statement] = await database.executeSql("SELECT total_amount, minimum_payment_amount, status FROM credit_card_statements WHERE account_id = 'card'");
  return {
    purchases, exactTotal: centsText(total),
    debtAfterPurchases: check(debtAfterPurchases, total),
    fullPayment: { ...fullPayment, transaction: undefined },
    debtAfterPayment: check(after.card!.debt!, total - paid),
    bankAfterPayment: check(after.bank!.balance, 100000000n - paid),
    statement: statement.rows.item(0),
    // The payment is not an expense: monthly expenses equal the purchases before and after paying.
    monthlyExpenses: { before: String(before.monthlyExpenses), after: String(summary.monthlyExpenses) },
    dashboardDebt: check(summary.totalDebt, total - paid),
    closure: await c.close(),
    sqlite: await sqliteChecks(database),
  };
}

/** 6B-C1 kept: a legitimate cents debt (0,40 after paying 10.000) is still unpayable. */
async function cardCentavosDebt(database: SmartFinSQLiteDatabase, impl: Phase6B1Implementation) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 1000000, null], ['card', 'Visa', 'creditCard', 0, 0]]);
  const c = context(database, impl);
  await c.save({ accountId: 'card', operationType: 'Crédito', amount: 10000.4 });
  const attempts = [];
  for (const amount of [10001, 10000.4, 10000, 1, 0.4]) {
    const result = await c.pay(amount);
    attempts.push({ ...result, transaction: undefined, debtAfter: String((await c.stored()).card!.debt) });
  }
  return { attempts, bank: String((await c.stored()).bank!.balance), closure: await c.close(), sqlite: await sqliteChecks(database) };
}

/** P5 (6B): income 0,30 and expenses 0,10 + 0,20 must leave exactly zero (no negative zero). */
async function zeroThroughCents(database: SmartFinSQLiteDatabase, impl: Phase6B1Implementation) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 0, null]]);
  const c = context(database, impl);
  await c.save({ transactionType: 'income', amount: 0.3 });
  await c.save({ amount: 0.1 });
  await c.save({ amount: 0.2 });
  const balance = (await c.stored()).bank!.balance;
  return { balance: check(balance, 0n), isPositiveZero: Object.is(balance, 0), sqlite: await sqliteChecks(database) };
}

/** Transfers with and without 4x1000 on cents, then deletion of one of them. */
async function transfersCents(database: SmartFinSQLiteDatabase, impl: Phase6B1Implementation) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 1000000, null], ['target', 'Ahorro', 'savingsAccount', 0.07, null]]);
  const c = context(database, impl);
  const plan: Array<[string, boolean]> = [['1234.56', true], ['99.99', false], ['250.05', true], ['80000.33', true]];
  let bank = 100000000n, target = 7n, taxes = 0n;
  const saved = [];
  for (const [amount, taxed] of plan) {
    const r = await c.save({ transactionType: 'internalTransfer', targetAccountId: 'target', amount: Number(amount), transferTaxCharged: taxed });
    // Documented 4x1000 contract, unchanged: Math.max(1, Math.round(amount * 0.004)) pesos.
    const tax = taxed ? BigInt(Math.max(1, Math.round(Number(amount) * 0.004))) * 100n : 0n;
    bank -= textCents(amount) + tax; target += textCents(amount); taxes += tax;
    saved.push({ transaction: r.transaction, cents: textCents(amount), tax });
  }
  const removed = saved[1]!;
  await c.remove(removed.transaction);
  bank += removed.cents + removed.tax; target -= removed.cents; taxes -= removed.tax;
  const s = await c.stored();
  const summary = await getDashboardSummaryFromDb(database, PHASE6B1_DATE);
  return {
    bank: check(s.bank!.balance, bank), target: check(s.target!.balance, target),
    monthlyExpenses: check(summary.monthlyExpenses, taxes), monthlyIncome: String(summary.monthlyIncome),
    sqlite: await sqliteChecks(database),
  };
}

/** Edition of amount and account, and repeated add/delete in random order back to the start. */
async function editsAndRepeatedReversal(database: SmartFinSQLiteDatabase, impl: Phase6B1Implementation, seed: number) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 123456.78, null], ['bank2', 'Banco 2', 'bankAccount', 0.01, null]]);
  const c = context(database, impl);
  const random = lcg(seed);
  const initial = await c.stored();
  const live: Transaction[] = [];
  let bank = textCents('123456.78'), bank2 = 1n;
  for (let i = 0; i < 200; i++) {
    const cents = BigInt(1 + Math.floor(random() * 50000000));
    const income = random() < 0.4;
    const r = await c.save({ transactionType: income ? 'income' : 'expense', amount: Number(centsText(cents)) });
    bank += income ? cents : -cents;
    live.push(r.transaction);
  }
  // Edit one movement: new amount and new account; the previous impact is reversed exactly.
  const edited = live[7]!;
  const editedCents = textCents(String(edited.amount));
  const editedIncome = edited.type === 'income';
  const r = await c.save({ editingTransaction: edited, accountId: 'bank2', transactionType: edited.type, amount: 0.99 });
  bank -= editedIncome ? editedCents : -editedCents;
  bank2 += editedIncome ? 99n : -99n;
  live[7] = r.transaction;
  const afterEdit = await c.stored();
  const editCheck = { bank: check(afterEdit.bank!.balance, bank), bank2: check(afterEdit.bank2!.balance, bank2) };
  while (live.length) await c.remove(live.splice(Math.floor(random() * live.length), 1)[0]!);
  const final = await c.stored();
  return {
    operations: 200, editCheck,
    finalBank: check(final.bank!.balance, textCents('123456.78')), finalBank2: check(final.bank2!.balance, 1n),
    restoredBitExact: Object.is(final.bank!.balance, initial.bank!.balance) && Object.is(final.bank2!.balance, initial.bank2!.balance),
    transactionsLeft: (await counts(database)).transactions, sqlite: await sqliteChecks(database),
  };
}

/** Card cycle: installments, partial and full payments, reversal of a payment and of a purchase. */
async function cardCycle(database: SmartFinSQLiteDatabase, impl: Phase6B1Implementation) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 2000000.5, null], ['card', 'Visa', 'creditCard', 0, 0]]);
  const c = context(database, impl);
  const steps: unknown[] = [];
  let debt = 0n, bank = textCents('2000000.50');
  const record = async (label: string) => {
    const s = await c.stored();
    const [st] = await database.executeSql("SELECT total_amount, minimum_payment_amount, status FROM credit_card_statements WHERE account_id = 'card'");
    steps.push({ label, debt: check(s.card!.debt!, debt), bank: check(s.bank!.balance, bank), statement: st.rows.item(0) });
  };
  const p1 = await c.save({ accountId: 'card', operationType: 'Crédito', amount: 300000.3, installmentCountInput: '3' });
  debt += textCents('300000.30');
  const p2 = await c.save({ accountId: 'card', operationType: 'Crédito', amount: 4229.9 });
  debt += textCents('4229.90');
  await c.save({ accountId: 'card', operationType: 'Crédito', amount: 89392.54 });
  debt += textCents('89392.54');
  await record('purchases');
  const partial = await c.pay(100000);
  debt -= 10000000n; bank -= 10000000n;
  await record('partial payment');
  await c.remove(partial.transaction!);
  debt += 10000000n; bank += 10000000n;
  await record('payment reversed');
  await c.remove(p1.transaction);
  debt -= textCents('300000.30');
  await record('installment purchase reversed');
  // Remaining exact debt 4229,90 + 89392,54 = 93622,44: the whole debt is not whole pesos (6B-C1).
  const full = await c.pay(93623);
  await record('full-amount attempt');
  const whole = await c.pay(93622);
  if ('paid' in whole && whole.paid) { debt -= BigInt(whole.paid) * 100n; bank -= BigInt(whole.paid) * 100n; }
  await record('whole pesos paid');
  await c.remove(p2.transaction);
  debt -= textCents('4229.90');
  debt = debt < 0n ? 0n : debt;
  await record('purchase reversed after payment');
  return {
    steps, fullAttempt: { ...full, transaction: undefined }, whole: { ...whole, transaction: undefined },
    closure: await c.close(), sqlite: await sqliteChecks(database),
  };
}

/**
 * Historical values already drifted by the previous implementation: an operation on a drifted
 * balance keeps the previous binary arithmetic (no silent repair); a card debt is a derived value
 * recomputed from its movements, so it becomes exact when a reconciliation runs.
 */
async function historicalDrift(database: SmartFinSQLiteDatabase, impl: Phase6B1Implementation) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 97599.49999999999, null], ['card', 'Visa', 'creditCard', 0, 94561.99999999999]]);
  const INSERT = `INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,payment_method,created_at,updated_at)
    VALUES (?,?,'COP','Sintetico 6B.1','2026-10-05','card','expense','outflow','posted','credit','2026-10-05T12:00:00.000Z','2026-10-05T12:00:00.000Z')`;
  for (const [id, amount] of [['h1', 4229.9], ['h2', 89392.54], ['h3', 939.56]] as const) await database.executeSql(INSERT, [id, amount]);
  const c = context(database, impl);
  resetCopArithmeticFallbacks();
  const before = await c.stored();
  const countsBefore = await counts(database);
  const detection = {
    bankCanonical: toExactCopCents(before.bank!.balance) !== undefined,
    debtCanonical: toExactCopCents(before.card!.debt!) !== undefined,
    bankDisplay: formatCurrency(before.bank!.balance, 'COP'),
  };
  await c.save({ amount: 100.25 });
  const afterExpense = (await c.stored()).bank!.balance;
  const payment = await c.pay(50000);
  const after = await c.stored();
  return {
    detection,
    expenseOnDriftedBalance: {
      stored: String(afterExpense),
      equalsPreviousBinary: Object.is(afterExpense, 97599.49999999999 - 100.25),
      canonical: toExactCopCents(afterExpense) !== undefined,
    },
    payment: { ...payment, transaction: undefined },
    bankAfterPayment: String(after.bank!.balance),
    debtAfterReconciliation: check(after.card!.debt!, textCents('94562.00') - 5000000n),
    rowsAdded: Object.fromEntries(Object.entries(await counts(database)).map(([k, v]) => [k, v - countsBefore[k]!])),
    fallbacks: getCopArithmeticFallbacks(),
    sqlite: await sqliteChecks(database),
  };
}

/** Amounts outside the contract (sub-cent, at/above 2^46, MAX_SAFE_INTEGER) keep the previous arithmetic. */
async function outOfContract(database: SmartFinSQLiteDatabase, impl: Phase6B1Implementation) {
  const cases: Array<[string, number, number, 'income' | 'expense']> = [
    ['sub-cent amount', 1000, 0.005, 'expense'],
    ['sub-cent balance', 0.125, 10, 'income'],
    ['whole pesos below 2^46', 2 ** 46 - 2, 1, 'income'],
    ['whole pesos reaching 2^46', 2 ** 46 - 1, 1, 'income'],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER - 1, 1, 'income'],
    ['cents near 2^46', 70368744177663.5, 0.5, 'income'],
  ];
  const results = [];
  for (const [label, balance, amount, type] of cases) {
    await resetSyntheticData(database);
    await seedAccounts(database, [['bank', 'Banco', 'bankAccount', balance, null]]);
    const c = context(database, impl);
    resetCopArithmeticFallbacks();
    await c.save({ transactionType: type, amount });
    const stored = (await c.stored()).bank!.balance;
    const binary = type === 'income' ? balance + amount : balance - amount;
    results.push({ label, balance: String(balance), amount: String(amount), stored: String(stored),
      equalsPreviousBinary: Object.is(stored, binary), fallbacks: getCopArithmeticFallbacks() });
  }
  return { results, sqlite: await sqliteChecks(database) };
}

function lcg(seed: number) {
  // Same sequence as the 6B generator (Math.imul … >>> 0): the products stay below 2^53.
  let state = seed % 4294967296;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * P6 (6B) sequence on one implementation: income, debit expense, taxed transfer, credit purchase,
 * card payment and random deletion; after each step the persisted balances and debt are compared
 * with the BigInt oracle (canonical double of the exact decimal). Single day: correctness only.
 */
async function sequence(database: SmartFinSQLiteDatabase, impl: Phase6B1Implementation, profile: 'integers' | 'cents', steps: number, seed: number) {
  await resetSyntheticData(database);
  await seedAccounts(database, [
    ['bank', 'Banco', 'bankAccount', 5000000, null], ['target', 'Ahorro', 'savingsAccount', 0, null], ['card', 'Visa', 'creditCard', 0, 0],
  ]);
  const c = context(database, impl);
  const random = lcg(seed);
  const oracle = { bank: 500000000n, target: 0n, debt: 0n, income: 0n, expenses: 0n };
  const live: Array<{ transaction: Transaction; undo: () => void }> = [];
  const amountCents = (max: number) => {
    const pesos = BigInt(1 + Math.floor(random() * max));
    return profile === 'integers' ? pesos * 100n : pesos * 100n + BigInt(Math.floor(random() * 100));
  };
  const result = { steps: 0, storedMismatch: 0, nonCanonicalStored: 0, payments: 0, paymentsRejected: 0, fullPayments: 0,
    fullPaymentsToZero: 0, monthlyMismatch: 0, wealthMismatch: 0 };
  const firstMismatches: unknown[] = [];
  const trace: string[] = [];
  for (let step = 0; step < steps; step++) {
    const choice = random();
    if (choice < 0.2) {
      const cents = amountCents(400000);
      const r = await c.save({ transactionType: 'income', amount: Number(centsText(cents)) });
      oracle.bank += cents; oracle.income += cents;
      live.push({ transaction: r.transaction, undo: () => { oracle.bank -= cents; oracle.income -= cents; } });
    } else if (choice < 0.45) {
      const cents = amountCents(150000);
      const r = await c.save({ amount: Number(centsText(cents)) });
      oracle.bank -= cents; oracle.expenses += cents;
      live.push({ transaction: r.transaction, undo: () => { oracle.bank += cents; oracle.expenses -= cents; } });
    } else if (choice < 0.6) {
      const cents = amountCents(200000);
      const amount = Number(centsText(cents));
      const tax = BigInt(Math.max(1, Math.round(amount * 0.004))) * 100n;
      const r = await c.save({ transactionType: 'internalTransfer', targetAccountId: 'target', amount, transferTaxCharged: true });
      oracle.bank -= cents + tax; oracle.target += cents; oracle.expenses += tax;
      live.push({ transaction: r.transaction, undo: () => { oracle.bank += cents + tax; oracle.target -= cents; oracle.expenses -= tax; } });
    } else if (choice < 0.85) {
      const cents = amountCents(120000);
      const r = await c.save({ accountId: 'card', operationType: 'Crédito', amount: Number(centsText(cents)) });
      oracle.debt += cents; oracle.expenses += cents;
      live.push({ transaction: r.transaction, undo: () => { oracle.debt -= cents; oracle.expenses -= cents; } });
    } else if (choice < 0.95) {
      if (oracle.debt >= 100n) {
        const wholeDebt = oracle.debt / 100n;
        const full = random() < 0.3;
        const pesos = full ? wholeDebt : BigInt(1 + Math.floor(random() * Number(wholeDebt)));
        result.payments++;
        const p = await c.pay(Number(pesos));
        if ('paid' in p && p.paid !== undefined) {
          const paid = BigInt(p.paid) * 100n;
          oracle.bank -= paid; oracle.debt -= paid;
          if (full && oracle.debt % 100n === 0n) { result.fullPayments++; if (oracle.debt === 0n) result.fullPaymentsToZero++; }
          live.push({ transaction: p.transaction!, undo: () => { oracle.bank += paid; oracle.debt += paid; } });
        } else result.paymentsRejected++;
      }
    } else if (live.length) {
      const [entry] = live.splice(Math.floor(random() * live.length), 1);
      await c.remove(entry!.transaction);
      entry!.undo();
    }
    result.steps++;
    const s = await c.stored();
    const debt = oracle.debt < 0n ? 0n : oracle.debt;
    for (const [name, value, expected] of [['bank', s.bank!.balance, oracle.bank], ['target', s.target!.balance, oracle.target],
      ['debt', s.card!.debt ?? 0, debt]] as Array<[string, number, bigint]>) {
      const v = check(value, expected);
      if (!v.equalsOracle) {
        result.storedMismatch++;
        if (!v.canonical) result.nonCanonicalStored++;
        if (firstMismatches.length < 5) firstMismatches.push({ step, name, ...v });
      }
    }
    // Decimal identity assets − debt = wealth on the persisted values (dashboard sums are 6B-D3).
    const wealthCents = [s.bank!.balance, s.target!.balance].map(toExactCopCents);
    const debtCents = toExactCopCents(s.card!.debt ?? 0);
    if (wealthCents.some(v => v === undefined) || debtCents === undefined ||
        BigInt(wealthCents[0]! + wealthCents[1]!) - BigInt(debtCents) !== oracle.bank + oracle.target - debt) result.wealthMismatch++;
    const summary = await getDashboardSummaryFromDb(database, PHASE6B1_DATE);
    for (const [value, expected] of [[summary.monthlyIncome, oracle.income], [summary.monthlyExpenses, oracle.expenses],
      [summary.monthlySavings, oracle.income - oracle.expenses]] as Array<[number, bigint]>)
      if (!Object.is(value, Number(centsText(expected)))) result.monthlyMismatch++;
    trace.push(`${s.bank!.balance}|${s.target!.balance}|${s.card!.debt}`);
  }
  return {
    profile, seed, counts: result, firstMismatches, trace,
    final: Object.fromEntries(Object.entries(await c.stored()).map(([k, v]) => [k, { balance: String(v.balance), debt: String(v.debt) }])),
    oracle: { bank: centsText(oracle.bank), target: centsText(oracle.target), debt: centsText(oracle.debt) },
    sqlite: await sqliteChecks(database),
  };
}

export const PHASE6B1_PROBES = [
  'balanceAccumulation', 'reversal', 'cardFullPaymentA', 'cardFullPaymentB', 'cardCentavosDebt', 'zeroThroughCents',
  'transfersCents', 'editsAndRepeatedReversal', 'cardCycle', 'historicalDrift', 'outOfContract',
  'sequenceIntegers', 'sequenceCents', 'sequenceCents1000',
] as const;
export type Phase6B1Probe = (typeof PHASE6B1_PROBES)[number];

export async function runPhase6B1Probe(database: SmartFinSQLiteDatabase, probe: Phase6B1Probe, impl: Phase6B1Implementation = NEXT_IMPLEMENTATION) {
  switch (probe) {
    case 'balanceAccumulation': return balanceAccumulation(database, impl);
    case 'reversal': return reversal(database, impl);
    // Case A: 96.496,10 + 64.804,55 + 68.530,35 = 229.831; Case B: 4.229,90 + 89.392,54 + 939,56 = 94.562.
    case 'cardFullPaymentA': return cardFullPayment(database, impl, ['96496.10', '64804.55', '68530.35']);
    case 'cardFullPaymentB': return cardFullPayment(database, impl, ['4229.90', '89392.54', '939.56']);
    case 'cardCentavosDebt': return cardCentavosDebt(database, impl);
    case 'zeroThroughCents': return zeroThroughCents(database, impl);
    case 'transfersCents': return transfersCents(database, impl);
    case 'editsAndRepeatedReversal': return editsAndRepeatedReversal(database, impl, 611);
    case 'cardCycle': return cardCycle(database, impl);
    case 'historicalDrift': return historicalDrift(database, impl);
    case 'outOfContract': return outOfContract(database, impl);
    case 'sequenceIntegers': return sequence(database, impl, 'integers', 150, 61);
    case 'sequenceCents': return sequence(database, impl, 'cents', 150, 62);
    // 1.000 operations on one day: a correctness stress test, not a performance reference.
    case 'sequenceCents1000': return sequence(database, impl, 'cents', 1000, 63);
  }
}
