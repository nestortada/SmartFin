// Phase 6B audit probes: the same synthetic scenarios run in Node (node:sqlite) and in the
// isolated Android APK (real driver), through the production use cases. Each probe compares
// the persisted and displayed COP figures with an independent BigInt decimal oracle.
// Audit only: nothing here changes production rules. Synthetic data, fixed seeds.
import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import {
  deleteManualTransactionSafely,
  saveManualTransaction,
  type SaveManualTransactionParams,
} from '../../src/modules/transactions/useCases/saveManualTransaction';
import { registerCreditCardPayment } from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { deleteCreditCard } from '../../src/modules/creditCards/useCases/manageCreditCards';
import { formatCurrency } from '../../src/shared/utils/formatCurrency';
import { toExactCopCents } from '../../src/shared/utils/exactCopCents';
import type { Transaction } from '../../src/modules/transactions/types';

export const PHASE6B_DATE = new Date('2026-10-11T12:00:00.000Z');

/** Decimal text of integer cents. */
export function centsText(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Cents of a two-decimal text; independent of production helpers. */
export function textCents(text: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw Error(`Not a two-decimal amount: ${text}`);
  const cents = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}

/** Half-up COP pesos of exact cents, as Intl would show the exact decimal (sign-symmetric). */
function oracleDisplay(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const pesos = (abs + 50n) / 100n;
  return formatCurrency(Number(negative && pesos > 0n ? -pesos : pesos), 'COP');
}

/** Classification of a stored/derived double against its exact decimal. */
function classify(value: number, expectedCents: bigint) {
  const exact = toExactCopCents(value);
  const display = formatCurrency(value, 'COP');
  const expectedDisplay = oracleDisplay(expectedCents);
  return {
    stored: String(value),
    expected: centsText(expectedCents),
    exactDouble: exact !== undefined && BigInt(exact) === expectedCents,
    display,
    expectedDisplay,
    visibleDifference: display !== expectedDisplay,
  };
}

const ACCOUNT_COLUMNS = '(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at)';

/** Deletes every row of every user table (discovered from sqlite_master) until empty. */
export async function resetSyntheticData(database: SmartFinSQLiteDatabase): Promise<void> {
  const [tablesResult] = await database.executeSql(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('schema_migrations', 'categories', 'subcategories', 'app_settings') ORDER BY name");
  let pending = Array.from({ length: tablesResult.rows.length }, (_, i) => String(tablesResult.rows.item(i).name));
  for (let round = 0; pending.length && round < pending.length + 2; round++) {
    const failed: string[] = [];
    for (const table of pending) {
      try { await database.executeSql(`DELETE FROM "${table}"`); } catch { failed.push(table); }
    }
    pending = failed;
  }
  if (pending.length) throw Error(`Could not reset: ${pending.join(',')}`);
}

async function seedAccounts(database: SmartFinSQLiteDatabase, rows: Array<[string, string, string, number, number | null]>) {
  for (const [id, name, type, balance, debt] of rows)
    await database.executeSql(`INSERT INTO accounts ${ACCOUNT_COLUMNS} VALUES (?,?,?,'active','COP',?,?,'2026-01-01','2026-01-01')`,
      [id, name, type, balance, debt]);
}

function dependencies(database: SmartFinSQLiteDatabase) {
  return {
    accountRepository: createSqliteAccountRepository(database),
    transactionRepository: createSqliteTransactionRepository(database),
    creditCardRepository: createSqliteCreditCardRepository(database),
  };
}

type Deps = ReturnType<typeof dependencies>;

async function save(deps: Deps, changes: Partial<SaveManualTransactionParams>) {
  return saveManualTransaction({
    ...deps, accounts: await deps.accountRepository.getAccounts(),
    accountId: 'bank', amount: 1, merchantName: 'Sintetico 6B', operationType: 'Débito', transactionType: 'expense',
    hasInterestFreeInstallments: false, installmentCountInput: '1', interestFreeInstallmentCountInput: '',
    currentDate: PHASE6B_DATE, ...changes,
  });
}

async function pay(deps: Deps, amount: number) {
  try {
    const result = await registerCreditCardPayment({ ...deps, accountId: 'card', sourceAccountId: 'bank', amount, currentDate: PHASE6B_DATE });
    return { requested: amount, paid: result.transaction.amount, transaction: result.transaction };
  } catch (error) {
    return { requested: amount, rejected: (error as Error).message };
  }
}

async function balances(deps: Deps) {
  const accounts = await deps.accountRepository.getAccounts();
  return Object.fromEntries(accounts.map(a => [a.id, { balance: a.balance.amount, debt: a.debtBalance?.amount }]));
}

async function foreignKeys(database: SmartFinSQLiteDatabase) {
  const [fk] = await database.executeSql('PRAGMA foreign_key_check');
  return fk.rows.length;
}

const sumCents = (values: string[]) => values.reduce((total, value) => total + textCents(value), 0n);

/** P1: four two-decimal incomes into one account; the persisted balance accumulates in binary. */
async function balanceAccumulation(database: SmartFinSQLiteDatabase) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 0, null]]);
  const deps = dependencies(database);
  const amounts = ['36360.06', '36224.28', '19556.65', '5458.51'];
  for (const amount of amounts) await save(deps, { transactionType: 'income', amount: Number(amount) });
  const expected = sumCents(amounts);
  const stored = (await balances(deps)).bank!.balance;
  const summary = await getDashboardSummaryFromDb(database, PHASE6B_DATE);
  return {
    amounts,
    accountBalance: classify(stored, expected),
    availableBalance: classify(summary.availableBalance, expected),
    netWorth: classify(summary.netWorth, expected),
    monthlyIncome: classify(summary.monthlyIncome, expected),
    monthlySavings: classify(summary.monthlySavings, expected),
    foreignKeyViolations: await foreignKeys(database),
  };
}

/** P2: add and delete the same expense; the reversal must restore the exact previous balance. */
async function reversalResidue(database: SmartFinSQLiteDatabase) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 661275.68, null]]);
  const deps = dependencies(database);
  const before = (await balances(deps)).bank!.balance;
  const created = await save(deps, { amount: 93616.69 });
  const during = (await balances(deps)).bank!.balance;
  await deleteManualTransactionSafely({ ...deps, accounts: await deps.accountRepository.getAccounts(), transaction: created.transaction });
  const after = (await balances(deps)).bank!.balance;
  const summary = await getDashboardSummaryFromDb(database, PHASE6B_DATE);
  return {
    before: String(before), during: classify(during, textCents('661275.68') - textCents('93616.69')),
    after: classify(after, textCents('661275.68')), restoredBitExact: Object.is(after, before),
    transactionsLeft: (await deps.transactionRepository.getTransactions()).length,
    monthlyExpenses: summary.monthlyExpenses,
  };
}

/** P3: two-decimal credit purchases whose exact total is whole pesos; pay the whole debt. */
async function cardResidue(database: SmartFinSQLiteDatabase, purchases: string[]) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 1000000, null], ['card', 'Visa', 'creditCard', 0, 0]]);
  const deps = dependencies(database);
  for (const amount of purchases) await save(deps, { accountId: 'card', operationType: 'Crédito', amount: Number(amount) });
  const total = sumCents(purchases);
  const debtAfterPurchases = (await balances(deps)).card!.debt!;
  const fullPayment = await pay(deps, Number(total / 100n));
  const afterFull = await balances(deps);
  const attempts = [];
  let expectedDebt = total - BigInt(Math.round(((fullPayment as { paid?: number }).paid ?? 0) * 100));
  if ((fullPayment as { rejected?: string }).rejected) {
    const partial = await pay(deps, Number(total / 100n) - 1);
    attempts.push({ ...partial, transaction: undefined });
    if ((partial as { paid?: number }).paid) expectedDebt = total - BigInt((partial as { paid: number }).paid) * 100n;
  }
  const lastPeso = await pay(deps, 1);
  attempts.push({ ...lastPeso, transaction: undefined });
  const final = await balances(deps);
  const summary = await getDashboardSummaryFromDb(database, PHASE6B_DATE);
  let closure: string;
  try { await deleteCreditCard(deps.creditCardRepository, 'card'); closure = 'closed'; } catch (error) { closure = `rejected: ${(error as Error).message}`; }
  return {
    purchases, exactTotal: centsText(total),
    debtAfterPurchases: classify(debtAfterPurchases, total),
    fullPayment: { ...fullPayment, transaction: undefined },
    debtAfterFullPayment: String(afterFull.card!.debt),
    attempts,
    finalDebt: classify(final.card!.debt!, expectedDebt < 0n ? 0n : expectedDebt),
    finalBank: String(final.bank!.balance),
    dashboardDebt: classify(summary.totalDebt, expectedDebt < 0n ? 0n : expectedDebt),
    monthlyExpenses: classify(summary.monthlyExpenses, total),
    closure,
    foreignKeyViolations: await foreignKeys(database),
  };
}

/** P4: canonical two-decimal balances in several accounts; dashboard aggregates in binary. */
async function aggregateBalances(database: SmartFinSQLiteDatabase) {
  await resetSyntheticData(database);
  const balancesText = ['36360.06', '36224.28', '19556.65', '5458.51'];
  await seedAccounts(database, [
    // The repository reads accounts by name: names fix the dashboard accumulation order.
    ['cash', 'Cuenta 1', 'cash', Number(balancesText[0]), null],
    ['bank', 'Cuenta 2', 'bankAccount', Number(balancesText[1]), null],
    ['savings', 'Cuenta 3', 'savingsAccount', Number(balancesText[2]), null],
    ['bank2', 'Cuenta 4', 'bankAccount', Number(balancesText[3]), null],
  ]);
  const summary = await getDashboardSummaryFromDb(database, PHASE6B_DATE);
  const stored = await balances(dependencies(database));
  const expected = sumCents(balancesText);
  return {
    balances: balancesText,
    eachAccountExact: Object.entries(stored).every(([id, v]) =>
      toExactCopCents(v.balance) !== undefined && v.balance === Number(balancesText[['cash', 'bank', 'savings', 'bank2'].indexOf(id)])),
    availableBalance: classify(summary.availableBalance, expected),
    netWorth: classify(summary.netWorth, expected),
  };
}

/** P5: income 0,30 then expenses 0,10 and 0,20 leave a tiny negative stored balance. */
async function negativeZero(database: SmartFinSQLiteDatabase) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 0, null]]);
  const deps = dependencies(database);
  await save(deps, { transactionType: 'income', amount: 0.3 });
  await save(deps, { amount: 0.1 });
  await save(deps, { amount: 0.2 });
  const stored = (await balances(deps)).bank!.balance;
  const summary = await getDashboardSummaryFromDb(database, PHASE6B_DATE);
  return {
    accountBalance: classify(stored, 0n),
    availableBalance: classify(summary.availableBalance, 0n),
    netWorth: classify(summary.netWorth, 0n),
    monthlySavings: classify(summary.monthlySavings, 0n),
  };
}

/** P7: a single purchase with legitimate cents leaves a debt the payment contract cannot settle. */
async function cardCentavosDebt(database: SmartFinSQLiteDatabase) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 1000000, null], ['card', 'Visa', 'creditCard', 0, 0]]);
  const deps = dependencies(database);
  await save(deps, { accountId: 'card', operationType: 'Crédito', amount: 10000.4 });
  const attempts = [];
  for (const amount of [10001, 10000.4, 10000, 1, 0.4]) {
    const result = await pay(deps, amount);
    attempts.push({ ...result, transaction: undefined, debtAfter: String((await balances(deps)).card!.debt) });
  }
  let closure: string;
  try { await deleteCreditCard(deps.creditCardRepository, 'card'); closure = 'closed'; } catch (error) { closure = `rejected: ${(error as Error).message}`; }
  const summary = await getDashboardSummaryFromDb(database, PHASE6B_DATE);
  return { purchase: '10000.40', attempts, closure, dashboardDebt: classify(summary.totalDebt, 40n),
    bank: String((await balances(deps)).bank!.balance) };
}

const INSERT_TX = `INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at)
  VALUES (?,?,'COP','Sintetico 6B','2026-10-05','bank',?,?,'posted','2026-10-05T12:00:00.000Z','2026-10-05T12:00:00.000Z')`;

/**
 * P8: 6A mixed paths. Income is exact cents, expenses carry legacy sub-cent amounts (as an AI
 * command may persist), so savings falls back to the binary sum of every figure.
 */
async function mixedSavings(database: SmartFinSQLiteDatabase) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 0, null]]);
  const income = ['43377.24', '61500.34', '12772.93'];
  const expenses = ['0.005', '0.005'];
  let i = 0;
  for (const amount of income) await database.executeSql(INSERT_TX, [`in-${i++}`, Number(amount), 'income', 'inflow']);
  for (const amount of expenses) await database.executeSql(INSERT_TX, [`ex-${i++}`, Number(amount), 'expense', 'outflow']);
  const summary = await getDashboardSummaryFromDb(database, PHASE6B_DATE);
  // Decimal intention of the texts (thousandths): income 117.650,510 - 0,010 = 117.650,500.
  const incomeMilli = income.reduce((t, a) => t + BigInt(a.replace('.', '')) * 10n, 0n);
  const savingsMilli = incomeMilli - 10n;
  return {
    income, expenses,
    monthlyIncome: { value: String(summary.monthlyIncome), display: formatCurrency(summary.monthlyIncome, 'COP') },
    monthlyExpenses: { value: String(summary.monthlyExpenses), display: formatCurrency(summary.monthlyExpenses, 'COP') },
    monthlySavings: { value: String(summary.monthlySavings), display: formatCurrency(summary.monthlySavings, 'COP') },
    savingsDecimalIntent: `${savingsMilli / 1000n}.${(savingsMilli % 1000n).toString().padStart(3, '0')}`,
    savingsIntentDisplay: formatCurrency(Number((savingsMilli + 500n) / 1000n), 'COP'),
  };
}

/** P9: safe income/expense subtotals whose combined savings exceed the safe integer range. */
async function unsafeCombinedSavings(database: SmartFinSQLiteDatabase) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', 0, null]]);
  // 6e13 COP = 6e15 cents each (below 2^46 COP and below MAX_SAFE_INTEGER cents).
  await database.executeSql(INSERT_TX, ['in-big', 60000000000000.01, 'income', 'inflow']);
  await database.executeSql(INSERT_TX, ['ex-neg', -60000000000000.02, 'expense', 'outflow']);
  const summary = await getDashboardSummaryFromDb(database, PHASE6B_DATE);
  return {
    monthlyIncome: String(summary.monthlyIncome), monthlyExpenses: String(summary.monthlyExpenses),
    monthlySavings: String(summary.monthlySavings), savingsExpected: '120000000000000.03',
    savingsCentsSafe: Number.isSafeInteger(12000000000000003),
  };
}

/** Deterministic LCG shared by Node and Hermes. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * P6: seeded sequence of production operations (income, debit expense, taxed transfer, credit
 * purchase, card payment, deletion). After each step every persisted balance/debt and the
 * dashboard are compared with the BigInt oracle. `profile` decides whole pesos or cents.
 */
async function operationSequence(database: SmartFinSQLiteDatabase, profile: 'integers' | 'cents', steps: number, seed: number) {
  await resetSyntheticData(database);
  await seedAccounts(database, [
    ['bank', 'Banco', 'bankAccount', 5000000, null], ['target', 'Ahorro', 'savingsAccount', 0, null],
    ['card', 'Visa', 'creditCard', 0, 0],
  ]);
  const deps = dependencies(database);
  const next = random(seed);
  const oracle = { bank: 500000000n, target: 0n, debt: 0n, income: 0n, expenses: 0n };
  type Live = { transaction: Transaction; undo: () => void };
  const live: Live[] = [];
  const amountCents = (max: number) => {
    const pesos = BigInt(1 + Math.floor(next() * max));
    return profile === 'integers' ? pesos * 100n : pesos * 100n + BigInt(Math.floor(next() * 100));
  };
  const counts = { steps: 0, storedMismatch: 0, visibleMismatch: 0, dashboardMismatch: 0, dashboardVisibleMismatch: 0,
    paymentsRejected: 0, payments: 0, nonCanonicalStored: 0 };
  const firstMismatches: unknown[] = [];
  const dashboardMismatchFields: Record<string, number> = {};
  const visibleFields: Record<string, number> = {};
  for (let step = 0; step < steps; step++) {
    const choice = next();
    if (choice < 0.2) {
      const c = amountCents(400000);
      const r = await save(deps, { transactionType: 'income', amount: Number(centsText(c)) });
      oracle.bank += c; oracle.income += c;
      live.push({ transaction: r.transaction, undo: () => { oracle.bank -= c; oracle.income -= c; } });
    } else if (choice < 0.45) {
      const c = amountCents(150000);
      const r = await save(deps, { amount: Number(centsText(c)) });
      oracle.bank -= c; oracle.expenses += c;
      live.push({ transaction: r.transaction, undo: () => { oracle.bank += c; oracle.expenses -= c; } });
    } else if (choice < 0.6) {
      const c = amountCents(200000);
      const amount = Number(centsText(c));
      // Oracle of the documented contract: Math.max(1, Math.round(amount * 0.004)) in pesos.
      const tax = BigInt(Math.max(1, Math.round(amount * 0.004))) * 100n;
      const r = await save(deps, { transactionType: 'internalTransfer', targetAccountId: 'target', amount, transferTaxCharged: true });
      oracle.bank -= c + tax; oracle.target += c; oracle.expenses += tax;
      live.push({ transaction: r.transaction, undo: () => { oracle.bank += c + tax; oracle.target -= c; oracle.expenses -= tax; } });
    } else if (choice < 0.85) {
      const c = amountCents(120000);
      const r = await save(deps, { accountId: 'card', operationType: 'Crédito', amount: Number(centsText(c)) });
      oracle.debt += c; oracle.expenses += c;
      live.push({ transaction: r.transaction, undo: () => { oracle.debt -= c; oracle.expenses -= c; } });
    } else if (choice < 0.95) {
      if (oracle.debt >= 100n) {
        const wholeDebt = oracle.debt / 100n;
        const pesos = next() < 0.3 ? wholeDebt : BigInt(1 + Math.floor(next() * Number(wholeDebt)));
        counts.payments++;
        const p = await pay(deps, Number(pesos));
        if ('paid' in p && p.paid !== undefined) {
          const paid = BigInt(p.paid) * 100n;
          oracle.bank -= paid; oracle.debt -= paid;
          live.push({ transaction: p.transaction!, undo: () => { oracle.bank += paid; oracle.debt += paid; } });
        } else counts.paymentsRejected++;
      }
    } else if (live.length) {
      const index = Math.floor(next() * live.length);
      const [entry] = live.splice(index, 1);
      await deleteManualTransactionSafely({ ...deps, accounts: await deps.accountRepository.getAccounts(), transaction: entry!.transaction });
      entry!.undo();
    }
    counts.steps++;
    const stored = await balances(deps);
    const checks: Array<[string, number, bigint]> = [
      ['bank', stored.bank!.balance, oracle.bank], ['target', stored.target!.balance, oracle.target],
      ['debt', stored.card!.debt ?? 0, oracle.debt < 0n ? 0n : oracle.debt],
    ];
    for (const [name, value, expected] of checks) {
      const c = classify(value, expected);
      if (!c.exactDouble) {
        counts.storedMismatch++;
        if (toExactCopCents(value) === undefined) counts.nonCanonicalStored++;
        if (firstMismatches.length < 5) firstMismatches.push({ step, name, ...c });
      }
      if (c.visibleDifference) counts.visibleMismatch++;
    }
    const summary = await getDashboardSummaryFromDb(database, PHASE6B_DATE);
    const debt = oracle.debt < 0n ? 0n : oracle.debt;
    // Available includes cash/bank/savings: the transfer target is a savings account.
    for (const [name, value, expected] of [
      ['availableBalance', summary.availableBalance, oracle.bank + oracle.target],
      ['netWorth', summary.netWorth, oracle.bank + oracle.target - debt],
      ['totalDebt', summary.totalDebt, debt],
      ['monthlyIncome', summary.monthlyIncome, oracle.income],
      ['monthlyExpenses', summary.monthlyExpenses, oracle.expenses],
      ['monthlySavings', summary.monthlySavings, oracle.income - oracle.expenses],
    ] as Array<[string, number, bigint]>) {
      const c = classify(value, expected);
      if (value !== Number(centsText(expected))) {
        counts.dashboardMismatch++;
        dashboardMismatchFields[name] = (dashboardMismatchFields[name] ?? 0) + 1;
        if (firstMismatches.length < 10) firstMismatches.push({ step, name, ...c });
      }
      if (c.visibleDifference) {
        counts.dashboardVisibleMismatch++;
        visibleFields[name] = (visibleFields[name] ?? 0) + 1;
      }
    }
  }
  const final = await balances(deps);
  return {
    profile, steps, seed, counts, dashboardMismatchFields, visibleFields, firstMismatches,
    final: { bank: String(final.bank!.balance), target: String(final.target!.balance), debt: String(final.card!.debt) },
    oracle: { bank: centsText(oracle.bank), target: centsText(oracle.target), debt: centsText(oracle.debt) },
    foreignKeyViolations: await foreignKeys(database),
  };
}

export const PHASE6B_PROBES = [
  'balanceAccumulation', 'reversalResidue', 'cardResidueAbove', 'cardResidueBelow', 'aggregateBalances', 'negativeZero',
  'cardCentavosDebt', 'mixedSavings', 'unsafeCombinedSavings', 'sequenceIntegers', 'sequenceCents', 'sequenceCents1000',
] as const;
export type Phase6BProbe = (typeof PHASE6B_PROBES)[number];

export async function runPhase6BProbe(database: SmartFinSQLiteDatabase, probe: Phase6BProbe) {
  switch (probe) {
    case 'balanceAccumulation': return balanceAccumulation(database);
    case 'reversalResidue': return reversalResidue(database);
    case 'cardResidueAbove': return cardResidue(database, ['96496.10', '64804.55', '68530.35']);
    case 'cardResidueBelow': return cardResidue(database, ['4229.90', '89392.54', '939.56']);
    case 'aggregateBalances': return aggregateBalances(database);
    case 'negativeZero': return negativeZero(database);
    case 'cardCentavosDebt': return cardCentavosDebt(database);
    case 'mixedSavings': return mixedSavings(database);
    case 'unsafeCombinedSavings': return unsafeCombinedSavings(database);
    case 'sequenceIntegers': return operationSequence(database, 'integers', 150, 61);
    case 'sequenceCents': return operationSequence(database, 'cents', 150, 62);
    // 1.000 operations on one day: a correctness test, not a performance reference.
    case 'sequenceCents1000': return operationSequence(database, 'cents', 1000, 63);
  }
}
