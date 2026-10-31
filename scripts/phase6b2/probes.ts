// Phase 6B.2 probes: dashboard aggregates (available, total debt, net worth with shared receivables
// and advances) against an independent BigInt decimal oracle built from the decimal TEXTS of each
// scenario (no exactCopCents, no production arithmetic). The same probes run in Node (node:sqlite)
// and in the isolated Android APK (real driver, Hermes). Each probe evaluates the frozen pre-6B.2
// dashboard and the production one on the same database and proves the dashboard read is read-only.
// Synthetic data only, fixed values.
import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import type { DashboardSummary } from '../../src/modules/dashboard/types/DashboardSummary';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteSharedExpenseRepository } from '../../src/modules/transactions/repositories/sqliteSharedExpenseRepository';
import { createSharedExpenseApi } from '../../src/modules/transactions/useCases/createSharedExpenseApi';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import {
  deleteManualTransactionSafely,
  saveManualTransaction,
  type SaveManualTransactionParams,
} from '../../src/modules/transactions/useCases/saveManualTransaction';
import { registerCreditCardPayment } from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { formatCurrency } from '../../src/shared/utils/formatCurrency';
import { getCopAggregateFallbacks, resetCopAggregateFallbacks } from '../../src/shared/utils/exactCopCents';
import type { Transaction } from '../../src/modules/transactions/types';

export const PHASE6B2_DATE = new Date('2026-10-11T12:00:00.000Z');
const OCCURRENCE = { kind: 'date' as const, date: '2026-10-05' };

export type Phase6B2Implementation = {
  name: 'previous' | 'next';
  getDashboardSummaryFromDb: (database: SmartFinSQLiteDatabase, date: Date) => Promise<DashboardSummary>;
  formatCurrency: (value: number, currency: 'COP') => string;
};

export const NEXT_DASHBOARD: Phase6B2Implementation = {
  name: 'next',
  getDashboardSummaryFromDb,
  formatCurrency: (value, currency) => formatCurrency(value, currency),
};

// ---------------------------------------------------------------- oracle (independent of production)

export function centsText(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Cents of a decimal text with at most two decimals. */
export function textCents(text: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw Error(`Not a two-decimal amount: ${text}`);
  const cents = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}

/** The double a correct decimal implementation shows: Number() of the exact decimal text. */
export const oracleDouble = (cents: bigint) => Number(centsText(cents));
const sum = (texts: readonly string[]) => texts.reduce((total, text) => total + textCents(text), 0n);

type Figure = {
  expected: string;
  expectedDisplay: string;
  previous: string;
  previousDisplay: string;
  next: string;
  nextDisplay: string;
  previousEqualsOracle: boolean;
  nextEqualsOracle: boolean;
  visibleChange: boolean;
};

const FIELDS = ['availableBalance', 'totalDebt', 'netWorth'] as const;
type Field = (typeof FIELDS)[number];
type Expected = Partial<Record<Field, bigint>>;

function figure(expected: bigint | undefined, previous: number, next: number, impls: Impls): Figure {
  const expectedDouble = expected === undefined ? NaN : oracleDouble(expected);
  return {
    expected: expected === undefined ? 'n/a' : centsText(expected),
    expectedDisplay: expected === undefined ? 'n/a' : impls.next.formatCurrency(expectedDouble, 'COP'),
    previous: String(previous),
    previousDisplay: impls.previous.formatCurrency(previous, 'COP'),
    next: String(next),
    nextDisplay: impls.next.formatCurrency(next, 'COP'),
    previousEqualsOracle: Object.is(previous, expectedDouble),
    nextEqualsOracle: Object.is(next, expectedDouble),
    visibleChange: impls.previous.formatCurrency(previous, 'COP') !== impls.next.formatCurrency(next, 'COP'),
  };
}

type Impls = { previous: Phase6B2Implementation; next: Phase6B2Implementation };

// ---------------------------------------------------------------- database helpers

const ACCOUNT_COLUMNS = '(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at)';

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
  await database.executeSql("INSERT OR IGNORE INTO categories(id,name,type,macro_category,color) VALUES('food','Alimentación','expense','food','#ffffff')");
}

type Seed = [id: string, name: string, type: string, balance: string, debt: string | null, status?: string];

async function seedAccounts(database: SmartFinSQLiteDatabase, rows: Seed[]) {
  for (const [id, name, type, balance, debt, status = 'active'] of rows)
    await database.executeSql(`INSERT INTO accounts ${ACCOUNT_COLUMNS} VALUES (?,?,?,?,'COP',?,?,'2026-01-01','2026-01-01')`,
      [id, name, type, status, Number(balance), debt === null ? null : Number(debt)]);
}

/** Every row of every table, in a fixed order: the dashboard read must leave it identical. */
async function snapshot(database: SmartFinSQLiteDatabase): Promise<string> {
  const [tables] = await database.executeSql("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const parts: string[] = [];
  for (let i = 0; i < tables.rows.length; i++) {
    const name = String(tables.rows.item(i).name);
    const [rows] = await database.executeSql(`SELECT * FROM "${name}" ORDER BY rowid`);
    parts.push(name, JSON.stringify(Array.from({ length: rows.rows.length }, (_, j) => rows.rows.item(j))));
  }
  return parts.join('\n');
}

async function sqliteHealth(database: SmartFinSQLiteDatabase) {
  const [integrity] = await database.executeSql('PRAGMA integrity_check');
  const [fk] = await database.executeSql('PRAGMA foreign_key_check');
  return { integrity: String(integrity.rows.item(0).integrity_check), foreignKeyViolations: fk.rows.length };
}

/** Evaluates both dashboards on the same database and compares the aggregates with the oracle. */
async function evaluate(database: SmartFinSQLiteDatabase, impls: Impls, expected: Expected, date = PHASE6B2_DATE) {
  const before = await snapshot(database);
  resetCopAggregateFallbacks();
  const previous = await impls.previous.getDashboardSummaryFromDb(database, date);
  const next = await impls.next.getDashboardSummaryFromDb(database, date);
  const fallbacks = getCopAggregateFallbacks();
  const unchanged = before === (await snapshot(database));
  const figures = Object.fromEntries(FIELDS.map(field => [field, figure(expected[field], previous[field], next[field], impls)])) as Record<Field, Figure>;
  const monthly = Object.fromEntries((['monthlyIncome', 'monthlyExpenses', 'monthlySavings', 'monthlyNetLosses'] as const)
    .map(field => [field, { previous: String(previous[field]), next: String(next[field]), identical: Object.is(previous[field], next[field]) }]));
  return { figures, monthly, dashboardFallbacks: fallbacks, databaseUnchanged: unchanged };
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
    accountId: 'bank', amount: 1, categoryId: 'food', merchantName: 'Sintetico 6B.2', operationType: 'Débito', transactionType: 'expense',
    hasInterestFreeInstallments: false, installmentCountInput: '1', interestFreeInstallmentCountInput: '',
    currentDate: PHASE6B2_DATE, occurrence: OCCURRENCE, ...changes,
  });
}

// ---------------------------------------------------------------- probes

/** 6B P4: four canonical balances in four accounts whose exact sum is 97.599,50. */
async function aggregateBalances(database: SmartFinSQLiteDatabase, impls: Impls) {
  await resetSyntheticData(database);
  const texts = ['36360.06', '36224.28', '19556.65', '5458.51'];
  // The repository reads accounts ORDER BY name: names fix the accumulation order.
  await seedAccounts(database, [
    ['cash', 'Cuenta 1', 'cash', texts[0]!, null], ['bank', 'Cuenta 2', 'bankAccount', texts[1]!, null],
    ['savings', 'Cuenta 3', 'savingsAccount', texts[2]!, null], ['bank2', 'Cuenta 4', 'bankAccount', texts[3]!, null],
  ]);
  const total = sum(texts);
  return { balances: texts, ...(await evaluate(database, impls, { availableBalance: total, totalDebt: 0n, netWorth: total })) };
}

/** Three cards whose debts come from production credit purchases (canonical since 6B.1). */
async function debtAggregate(database: SmartFinSQLiteDatabase, impls: Impls) {
  await resetSyntheticData(database);
  const purchases: Array<[string, string]> = [['card1', '18160.76'], ['card2', '76543.65'], ['card3', '28611.09']];
  await seedAccounts(database, [
    ['bank', 'Banco', 'bankAccount', '1000000', null],
    ['card1', 'Tarjeta 1', 'creditCard', '0', '0'], ['card2', 'Tarjeta 2', 'creditCard', '0', '0'], ['card3', 'Tarjeta 3', 'creditCard', '0', '0'],
  ]);
  const deps = dependencies(database);
  for (const [accountId, amount] of purchases) await save(deps, { accountId, operationType: 'Crédito', amount: Number(amount) });
  const debts = (await deps.accountRepository.getAccounts()).filter(a => a.type === 'creditCard').map(a => String(a.debtBalance?.amount));
  const debt = sum(purchases.map(p => p[1]));
  return {
    purchases, debts,
    ...(await evaluate(database, impls, { availableBalance: textCents('1000000'), totalDebt: debt, netWorth: textCents('1000000') - debt })),
  };
}

/** Assets of every included type (investment counts only in net worth), card and loan debt, closed accounts excluded. */
async function netWorthMixed(database: SmartFinSQLiteDatabase, impls: Impls) {
  await resetSyntheticData(database);
  const rows: Seed[] = [
    ['cash', 'A Efectivo', 'cash', '46554.46', null], ['bank', 'B Banco', 'bankAccount', '565664.30', null],
    ['savings', 'C Ahorro', 'savingsAccount', '441782.23', null], ['investment', 'D Inversion', 'investment', '21116090.88', null],
    ['card', 'E Tarjeta', 'creditCard', '0', '985.01'], ['loan', 'F Credito', 'loan', '0', '191377.36'],
    // Closed accounts with cents must stay outside every aggregate.
    ['closedBank', 'G Cerrada', 'bankAccount', '0.49', null, 'closed'], ['closedCard', 'H Cerrada', 'creditCard', '0', '0.51', 'closed'],
  ];
  await seedAccounts(database, rows);
  const available = sum(['46554.46', '565664.30', '441782.23']);
  const debt = sum(['985.01', '191377.36']);
  return {
    accounts: rows,
    ...(await evaluate(database, impls, { availableBalance: available, totalDebt: debt, netWorth: available + textCents('21116090.88') - debt })),
  };
}

/** Shared purchase (receivable) and an unapplied receipt (advance) with cents. */
async function sharedPosition(database: SmartFinSQLiteDatabase, impls: Impls) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['bank', 'Banco', 'bankAccount', '8957295.19', null], ['card', 'Visa', 'creditCard', '0', '0']]);
  const api = createSharedExpenseApi(createSqliteSharedExpenseRepository(database));
  const contactId = (await api.saveContact('contact-6b2', 'Amiga')).entityId;
  await api.createPurchase('purchase-6b2', {
    purchase: { accountId: 'bank', amount: 359745.73, categoryId: 'food', merchantName: 'Restaurante', operationType: 'Débito', occurrence: OCCURRENCE },
    distribution: { mode: 'amounts', personalAmount: 189939.69, participants: [{ contactId, amount: 169806.04 }] },
  });
  await api.recordReceipt('receipt-6b2', { contactId, accountId: 'bank', amount: 58752.99, occurrence: { kind: 'date', date: '2026-10-06' } });
  const bank = textCents('8957295.19') - textCents('359745.73') + textCents('58752.99');
  const receivable = textCents('169806.04');
  const advance = textCents('58752.99');
  const totals = await createSqliteSharedExpenseRepository(database).getFinancialTotals();
  return {
    position: { receivables: String(totals.receivables), thirdPartyAdvances: String(totals.thirdPartyAdvances),
      receivablesEqualOracle: Object.is(totals.receivables, oracleDouble(receivable)), advancesEqualOracle: Object.is(totals.thirdPartyAdvances, oracleDouble(advance)) },
    ...(await evaluate(database, impls, { availableBalance: bank, totalDebt: 0n, netWorth: bank + receivable - advance })),
  };
}

/** Canonical balances 0,30, −0,10 and −0,20: the exact aggregate is zero; binary leaves −2,78·10⁻¹⁷ («−$ 0»). */
async function zeroThroughAggregation(database: SmartFinSQLiteDatabase, impls: Impls) {
  await resetSyntheticData(database);
  await seedAccounts(database, [['a', 'Cuenta 1', 'bankAccount', '0.30', null], ['b', 'Cuenta 2', 'cash', '-0.10', null], ['c', 'Cuenta 3', 'savingsAccount', '-0.20', null]]);
  return evaluate(database, impls, { availableBalance: 0n, totalDebt: 0n, netWorth: 0n });
}

/** Legitimate small and half amounts: never hidden or rounded by the aggregate. */
async function smallAmounts(database: SmartFinSQLiteDatabase, impls: Impls) {
  const cases: Array<{ name: string; rows: Seed[]; expected: Expected }> = [
    { name: 'negativeFortyCents', rows: [['a', 'Cuenta', 'bankAccount', '-0.40', null]], expected: { availableBalance: -40n, totalDebt: 0n, netWorth: -40n } },
    { name: 'debtFortyCents', rows: [['a', 'Banco', 'bankAccount', '0', null], ['card', 'Visa', 'creditCard', '0', '0.40']], expected: { availableBalance: 0n, totalDebt: 40n, netWorth: -40n } },
    { name: 'halfPositive', rows: [['a', 'Cuenta 1', 'bankAccount', '1234.20', null], ['b', 'Cuenta 2', 'cash', '0.30', null]], expected: { availableBalance: 123450n, totalDebt: 0n, netWorth: 123450n } },
    { name: 'halfNegative', rows: [['a', 'Cuenta 1', 'bankAccount', '-0.20', null], ['b', 'Cuenta 2', 'cash', '-0.30', null]], expected: { availableBalance: -50n, totalDebt: 0n, netWorth: -50n } },
    { name: 'overdraftAndDebt', rows: [['a', 'Cuenta', 'bankAccount', '-15000.25', null], ['card', 'Visa', 'creditCard', '0', '84999.25']], expected: { availableBalance: -1500025n, totalDebt: 8499925n, netWorth: -1500025n - 8499925n } },
  ];
  const results: Record<string, unknown> = {};
  for (const c of cases) {
    await resetSyntheticData(database);
    await seedAccounts(database, c.rows);
    results[c.name] = await evaluate(database, impls, c.expected);
  }
  return results;
}

/** Out-of-contract operands or totals: the production aggregate must equal the previous binary one bit for bit. */
async function outOfContract(database: SmartFinSQLiteDatabase, impls: Impls) {
  const cases: Array<{ name: string; rows: Seed[] }> = [
    // A balance drifted by pre-6B.1 code (not the double of any two-decimal amount).
    { name: 'historicalDrift', rows: [['a', 'Cuenta 1', 'bankAccount', '97599.49999999999', null], ['b', 'Cuenta 2', 'cash', '100.25', null]] },
    { name: 'historicalResidueZero', rows: [['a', 'Cuenta', 'bankAccount', '-2.7755575615628914e-17', null]] },
    // Legacy/AI amounts with more than two decimals.
    { name: 'threeDecimals', rows: [['a', 'Cuenta 1', 'bankAccount', '0.005', null], ['b', 'Cuenta 2', 'cash', '1.115', null], ['card', 'Visa', 'creditCard', '0', '0.105']] },
    // Beyond 2^46 COP a double no longer distinguishes cents.
    { name: 'beyond2pow46', rows: [['a', 'Cuenta 1', 'investment', '70368744177664.5', null], ['b', 'Cuenta 2', 'bankAccount', '0.25', null]] },
    // Every operand exact, but the total in cents exceeds Number.MAX_SAFE_INTEGER.
    { name: 'unsafeTotal', rows: [['a', 'Cuenta 1', 'bankAccount', '40000000000000.01', null], ['b', 'Cuenta 2', 'savingsAccount', '40000000000000.01', null], ['c', 'Cuenta 3', 'cash', '40000000000000.01', null]] },
    // Assets and debt each safe, net worth intermediate unsafe (assets − debt in cents).
    { name: 'unsafeNetWorth', rows: [['a', 'Cuenta 1', 'investment', '-50000000000000.01', null], ['card', 'Visa', 'creditCard', '0', '50000000000000.02']] },
  ];
  const results: Record<string, unknown> = {};
  for (const c of cases) {
    await resetSyntheticData(database);
    await seedAccounts(database, c.rows);
    const evaluation = await evaluate(database, impls, {});
    const bitIdentical = FIELDS.every(field => evaluation.figures[field].previous === evaluation.figures[field].next);
    results[c.name] = { ...evaluation, bitIdentical };
  }
  return results;
}

/** Economic rules over production operations; the dashboard is compared with the oracle after every step. */
async function economicSequence(database: SmartFinSQLiteDatabase, impls: Impls) {
  await resetSyntheticData(database);
  await seedAccounts(database, [
    ['bank', 'Banco', 'bankAccount', '1500000.35', null], ['target', 'Nequi', 'bankAccount', '0', null],
    ['savings', 'Ahorro', 'savingsAccount', '250000.15', null], ['card', 'Visa', 'creditCard', '0', '0'],
  ]);
  const deps = dependencies(database);
  const api = createSharedExpenseApi(createSqliteSharedExpenseRepository(database));
  const contactId = (await api.saveContact('contact-seq', 'Amiga')).entityId;
  const o = { bank: textCents('1500000.35'), target: 0n, savings: textCents('250000.15'), debt: 0n, receivable: 0n, advance: 0n, income: 0n };
  const steps: unknown[] = [];
  const counts = { steps: 0, nextMismatch: 0, previousMismatch: 0, previousVisible: 0, ruleViolations: 0, databaseChanged: 0 };
  let previousWorth = o.bank + o.target + o.savings;
  let participationId = '';
  let removable: Transaction | undefined;
  const step = async (name: string, expectedWorthDelta: bigint, run: () => Promise<void>) => {
    await run();
    const available = o.bank + o.target + o.savings;
    const worth = available - o.debt + o.receivable - o.advance;
    const evaluation = await evaluate(database, impls, { availableBalance: available, totalDebt: o.debt, netWorth: worth });
    const ruleHolds = worth - previousWorth === expectedWorthDelta;
    previousWorth = worth;
    counts.steps++;
    for (const field of FIELDS) {
      const f = evaluation.figures[field];
      if (!f.nextEqualsOracle) counts.nextMismatch++;
      if (!f.previousEqualsOracle) counts.previousMismatch++;
      if (f.previousDisplay !== f.expectedDisplay) counts.previousVisible++;
    }
    if (!ruleHolds) counts.ruleViolations++;
    if (!evaluation.databaseUnchanged) counts.databaseChanged++;
    steps.push({ name, netWorthDelta: centsText(expectedWorthDelta), ruleHolds, figures: evaluation.figures,
      monthlyIncome: evaluation.monthly.monthlyIncome, monthlyNetLosses: evaluation.monthly.monthlyNetLosses });
  };
  await step('income', textCents('36360.06'), async () => { await save(deps, { transactionType: 'income', amount: 36360.06 }); o.bank += textCents('36360.06'); });
  await step('expense', -textCents('19556.65'), async () => {
    removable = (await save(deps, { amount: 19556.65 })).transaction; o.bank -= textCents('19556.65');
  });
  await step('ownTransfer', 0n, async () => {
    await save(deps, { transactionType: 'internalTransfer', targetAccountId: 'target', amount: 1234.56 }); o.bank -= textCents('1234.56'); o.target += textCents('1234.56');
  });
  // 4×1000 = max(1, round(80000.33 · 0,004)) = 320: the tax is the only net worth change.
  await step('transferWithTax', -32000n, async () => {
    await save(deps, { transactionType: 'internalTransfer', targetAccountId: 'target', amount: 80000.33, transferTaxCharged: true });
    o.bank -= textCents('80000.33') + 32000n; o.target += textCents('80000.33');
  });
  await step('creditPurchase', -textCents('76543.65'), async () => {
    await save(deps, { accountId: 'card', operationType: 'Crédito', amount: 76543.65 }); o.debt += textCents('76543.65');
  });
  await step('cardPayment', 0n, async () => {
    await registerCreditCardPayment({ ...deps, accountId: 'card', sourceAccountId: 'bank', amount: 50000, currentDate: PHASE6B2_DATE });
    o.bank -= 5000000n; o.debt -= 5000000n;
  });
  await step('sharedPurchase', -textCents('15000.15'), async () => {
    const result = await api.createPurchase('seq-purchase', {
      purchase: { accountId: 'bank', amount: 30000.3, categoryId: 'food', merchantName: 'Restaurante', operationType: 'Débito', occurrence: OCCURRENCE },
      distribution: { mode: 'amounts', personalAmount: 15000.15, participants: [{ contactId, amount: 15000.15 }] },
    });
    participationId = (await api.getExpense(result.entityId)).participants[0]!.participationId;
    o.bank -= textCents('30000.30'); o.receivable += textCents('15000.15');
  });
  await step('sharedReimbursement', 0n, async () => {
    await api.recordReceipt('seq-reimbursement', { contactId, accountId: 'bank', amount: 5000.05, occurrence: { kind: 'date', date: '2026-10-06' },
      applications: [{ participationId, amount: 5000.05 }] });
    o.bank += textCents('5000.05'); o.receivable -= textCents('5000.05');
  });
  await step('forgiveness', -textCents('4000.04'), async () => {
    await api.forgiveParticipation('seq-forgiveness', { participationId, amount: 4000.04, date: '2026-10-07', reason: 'Asumo el saldo' });
    o.receivable -= textCents('4000.04');
  });
  let receiptId = '';
  await step('advanceReceived', 0n, async () => {
    receiptId = (await api.recordReceipt('seq-advance', { contactId, accountId: 'bank', amount: 20000.07, occurrence: { kind: 'date', date: '2026-10-08' } })).entityId!;
    o.bank += textCents('20000.07'); o.advance += textCents('20000.07');
  });
  await step('advanceReturned', 0n, async () => {
    await api.returnAdvance('seq-return', { receiptId, accountId: 'bank', amount: 4999.92, occurrence: { kind: 'date', date: '2026-10-09' } });
    o.bank -= textCents('4999.92'); o.advance -= textCents('4999.92');
  });
  await step('deleteExpense', textCents('19556.65'), async () => {
    await deleteManualTransactionSafely({ ...deps, accounts: await deps.accountRepository.getAccounts(), transaction: removable! });
    o.bank += textCents('19556.65');
  });
  return { counts, steps, sqlite: await sqliteHealth(database) };
}

export const PHASE6B2_PROBES = [
  'aggregateBalances', 'debtAggregate', 'netWorthMixed', 'sharedPosition', 'zeroThroughAggregation', 'smallAmounts', 'outOfContract', 'economicSequence',
] as const;
export type Phase6B2Probe = (typeof PHASE6B2_PROBES)[number];

export async function runPhase6B2Probe(database: SmartFinSQLiteDatabase, probe: Phase6B2Probe, previous: Phase6B2Implementation) {
  const impls = { previous, next: NEXT_DASHBOARD };
  const result = await (async () => {
    switch (probe) {
      case 'aggregateBalances': return aggregateBalances(database, impls);
      case 'debtAggregate': return debtAggregate(database, impls);
      case 'netWorthMixed': return netWorthMixed(database, impls);
      case 'sharedPosition': return sharedPosition(database, impls);
      case 'zeroThroughAggregation': return zeroThroughAggregation(database, impls);
      case 'smallAmounts': return smallAmounts(database, impls);
      case 'outOfContract': return outOfContract(database, impls);
      case 'economicSequence': return economicSequence(database, impls);
    }
  })();
  return { ...result, sqlite: await sqliteHealth(database) };
}

/** Intl strings of the cases that matter for −$ 0, as the platform renders them. */
export function intlProbe(format: (value: number, currency: 'COP') => string) {
  const values: Array<[string, number]> = [
    ['+0', 0], ['-0', -0], ['-2.78e-17', -2.7755575615628914e-17], ['-0.004', -0.004], ['-0.40', -0.4], ['0.40', 0.4],
    ['-0.49999999999999994', -0.49999999999999994], ['-0.50', -0.5], ['0.50', 0.5], ['2.50', 2.5], ['97599.49999999999', 97599.49999999999], ['97599.50', 97599.5],
  ];
  return Object.fromEntries(values.map(([label, value]) => [label, format(value, 'COP')]));
}
