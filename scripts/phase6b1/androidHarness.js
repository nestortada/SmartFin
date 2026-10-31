/* global performance, BigInt */
// Phase 6B.1 synthetic APK campaigns: the 6B.1 probes (scripts/phase6b1/probes.ts) on the real
// react-native-sqlite-storage driver and Hermes, for the production use cases and the frozen
// pre-6B.1 copies; the production dashboard components for the visible COP text; and the
// representative volumes (1.000 / 6 months, 10.000 / 5 years, 100.000 / 50 calendar years).
// Only the isolated test package and synthetic data.
import React from 'react';
import {View} from 'react-native';
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {getDashboardSummaryFromDb} from './src/modules/dashboard/useCases/getDashboardSummary';
import {formatCurrency} from './src/shared/utils/formatCurrency';
import {MetricsGrid} from './src/modules/dashboard/ui/components/MetricsGrid';
import {NetWorthCard} from './src/modules/dashboard/ui/components/NetWorthCard';
import {createSqliteAccountRepository} from './src/modules/accounts/repositories/sqliteAccountRepository';
import {createSqliteTransactionRepository} from './src/modules/transactions/repositories/sqliteTransactionRepository';
import {createSqliteCreditCardRepository} from './src/modules/creditCards/repositories/sqliteCreditCardRepository';
import {NEXT_IMPLEMENTATION, PHASE6B1_DATE, PHASE6B1_PROBES, runPhase6B1Probe} from './phase6b1Probes';
import * as previousSave from './pre6B1SaveManualTransaction';
import * as previousCards from './pre6B1CreditCardRelations';
import {representativeSeedStatements, REPRESENTATIVE_REFERENCE_DAY} from './representativeHistory';

const PREVIOUS = {
  name: 'previous',
  saveManualTransaction: previousSave.saveManualTransaction,
  deleteManualTransactionSafely: previousSave.deleteManualTransactionSafely,
  registerCreditCardPayment: previousCards.registerCreditCardPayment,
  reconcileCreditCardTransactions: previousCards.reconcileCreditCardTransactions,
};
const PALETTE = {background: '#f8f7fb', border: 'rgba(35, 42, 65, 0.12)', card: 'rgba(255, 255, 255, 0.78)', cardStrong: 'rgba(255, 255, 255, 0.92)',
  danger: '#a93932', muted: '#686678', primary: '#2848ee', primarySoft: 'rgba(61, 90, 254, 0.12)', secondary: '#5203d5', tertiary: '#007f3e', text: '#19191d'};
const FIELDS = ['availableBalance', 'netWorth', 'totalDebt', 'monthlyIncome', 'monthlyExpenses', 'monthlySavings'];
const UI_PROBES = ['balanceAccumulation', 'zeroThroughCents', 'cardFullPaymentB'];

function Phase6B1Metrics({summary}) {
  return <View style={{padding: 16}}>
    <NetWorthCard availableBalance={summary.availableBalance} currency="COP" netWorth={summary.netWorth} palette={PALETTE}/>
    <MetricsGrid currency="COP" monthlyExpenses={summary.monthlyExpenses} monthlyIncome={summary.monthlyIncome}
      monthlySavings={summary.monthlySavings} palette={PALETTE} totalDebt={summary.totalDebt}/>
  </View>;
}

const check = (condition, message) => { if (!condition) throw Error(message); };
const rowsOf = result => Array.from({length: result.rows.length}, (_, i) => result.rows.item(i));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const centsText = cents => {
  const negative = cents < 0n, abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
};

async function sqliteChecks(database) {
  const [integrity] = await database.executeSql('PRAGMA integrity_check');
  const [fk] = await database.executeSql('PRAGMA foreign_key_check');
  const [version] = await database.executeSql('SELECT sqlite_version() AS v');
  check(integrity.rows.item(0).integrity_check === 'ok' && !fk.rows.length, 'SQLite integrity');
  return {integrity: 'ok', foreignKeyViolations: 0, sqliteVersion: version.rows.item(0).v};
}

function deps(database) {
  return {
    accountRepository: createSqliteAccountRepository(database),
    transactionRepository: createSqliteTransactionRepository(database),
    creditCardRepository: createSqliteCreditCardRepository(database),
  };
}

const ORACLE_SQL = `SELECT a.id, coalesce((SELECT sum(CAST(round(t.amount * 100) AS INTEGER)) FROM transactions t
    WHERE t.account_id = a.id AND t.type = 'expense' AND t.direction = 'outflow' AND t.status <> 'cancelled'), 0)
  - coalesce((SELECT sum(CAST(round(t.amount * 100) AS INTEGER)) FROM transactions t WHERE t.type = 'creditCardPayment'
    AND t.status <> 'cancelled' AND (t.target_account_id = a.id OR t.account_id = a.id)), 0) AS cents
  FROM accounts a WHERE a.type = 'creditCard' ORDER BY a.id`;

async function cardDebts(database) {
  const [r] = await database.executeSql("SELECT id, debt_balance_amount AS debt FROM accounts WHERE type = 'creditCard' ORDER BY id");
  return rowsOf(r).map(row => ({id: row.id, debt: String(row.debt)}));
}

/**
 * Representative history (AGENTS.md volumes). Reconciles the whole history with the frozen and the
 * production implementation (alternating, same process and database), checks the production debt
 * against SQLite integer cents and then runs production operations with cents on top of it.
 */
async function volume(size, variant, {owned, record}) {
  await record(`volume-${size}-${variant}`, async () => {
    await owned(async db => {
      for (const statement of representativeSeedStatements(size)) await db.executeSql(statement);
      if (variant === 'cents') await db.executeSql("UPDATE transactions SET amount = amount + ((rowid * 7919) % 100) / 100.0 WHERE id LIKE 'rep-%'");
    });
    const database = await openSmartFinDatabase();
    const d = deps(database);
    const date = new Date(`${REPRESENTATIVE_REFERENCE_DAY}T17:00:00.000Z`);
    const runs = {next: [], previous: []};
    const debts = {};
    for (let i = 0; i < 9; i++) {
      for (const impl of i % 2 ? [PREVIOUS, NEXT_IMPLEMENTATION] : [NEXT_IMPLEMENTATION, PREVIOUS]) {
        const start = performance.now();
        await impl.reconcileCreditCardTransactions({...d, currentDate: date});
        runs[impl.name].push(performance.now() - start);
        debts[impl.name] = await cardDebts(database);
      }
    }
    const [o] = await database.executeSql(ORACLE_SQL);
    const oracle = rowsOf(o).map(row => ({id: row.id, cents: String(row.cents)}));
    for (const [index, row] of oracle.entries()) {
      const cents = BigInt(row.cents);
      check(debts.next[index].debt === String(Number(centsText(cents < 0n ? 0n : cents))), `debt ${row.id} differs from oracle`);
    }
    if (variant === 'pesos') check(JSON.stringify(debts.next) === JSON.stringify(debts.previous), 'whole pesos changed');
    // Production operations with cents on top of the history (each credit operation reconciles all of it).
    const before = await d.accountRepository.getAccounts();
    let bank = BigInt(Math.round(before.find(a => a.id === 'rep-bank').balance.amount * 100));
    const bankCanonicalBefore = String(before.find(a => a.id === 'rep-bank').balance.amount);
    const save = async changes => NEXT_IMPLEMENTATION.saveManualTransaction({
      ...d, accounts: await d.accountRepository.getAccounts(), accountId: 'rep-bank', amount: 1, merchantName: 'Sintetico 6B.1',
      operationType: 'Débito', transactionType: 'expense', hasInterestFreeInstallments: false, installmentCountInput: '1',
      interestFreeInstallmentCountInput: '', currentDate: date, ...changes,
    });
    const operations = {};
    const time = async (name, operation) => {
      const start = performance.now();
      const value = await operation();
      (operations[name] ??= []).push(performance.now() - start);
      return value;
    };
    for (let i = 0; i < 5; i++) {
      await time('income', () => save({transactionType: 'income', amount: 36360.06}));
      bank += 3636006n;
      await time('expense', () => save({amount: 19556.65}));
      bank -= 1955665n;
      const purchase = await time('creditPurchase', () => save({accountId: 'rep-card', operationType: 'Crédito', amount: 4229.9}));
      await time('deleteCreditPurchase', () => NEXT_IMPLEMENTATION.deleteManualTransactionSafely({...d, accounts: [], transaction: purchase.transaction}));
      await time('payment', () => NEXT_IMPLEMENTATION.registerCreditCardPayment({...d, accountId: 'rep-card', sourceAccountId: 'rep-bank', amount: 1000, currentDate: date}));
      bank -= 100000n;
    }
    const after = await d.accountRepository.getAccounts();
    const [o2] = await database.executeSql(ORACLE_SQL);
    const debtAfter = (await cardDebts(database)).find(c => c.id === 'rep-card').debt;
    const oracleAfter = BigInt(rowsOf(o2).find(row => row.id === 'rep-card').cents);
    const bankAfter = after.find(a => a.id === 'rep-bank').balance.amount;
    // The seeded bank balance (4.500.000) is whole pesos, so every later value is exact.
    check(String(bankAfter) === String(Number(centsText(bank))), 'bank after operations differs from oracle');
    check(debtAfter === String(Number(centsText(oracleAfter < 0n ? 0n : oracleAfter))), 'card debt after operations differs from oracle');
    const summary = await getDashboardSummaryFromDb(database, date);
    const [c] = await database.executeSql('SELECT count(*) AS n, min(date) AS first, max(date) AS last FROM transactions');
    return {
      rows: c.rows.item(0), oracle, debts, medianMs: {next: median(runs.next), previous: median(runs.previous)}, runs,
      operationsMedianMs: Object.fromEntries(Object.entries(operations).map(([k, v]) => [k, median(v)])),
      bank: {before: bankCanonicalBefore, after: String(bankAfter)}, debtAfter,
      summary: Object.fromEntries(FIELDS.map(k => [k, String(summary[k])])), sqlite: await sqliteChecks(database),
    };
  });
}

export async function runPhase6B1(campaign, baseDeps) {
  const record = (name, operation) => baseDeps.record(name, async () => {
    try { return await operation(); } catch (e) { throw e instanceof Error ? e : Error('Driver error: ' + JSON.stringify(e)); }
  });
  const d = {...baseDeps, record};
  await d.control.recoveryEnabled(false);
  await record('isolation', () => d.control.isolation());
  await record('runtime', async () => ({api: d.control.getConstants().api, hermes: !!global.HermesInternal,
    intl: [0.5, 2.5, -0.5, -2.7755575615628914e-17, 0, 97599.49999999999, 97599.5].map(v => formatCurrency(v, 'COP')).join('|')}));
  if (campaign === 'phase6b1-probes') {
    const database = await openSmartFinDatabase();
    for (const name of PHASE6B1_PROBES)
      await record(`probe-${name}`, async () => {
        const previous = await runPhase6B1Probe(database, name, PREVIOUS);
        const next = await runPhase6B1Probe(database, name, NEXT_IMPLEMENTATION);
        delete previous.trace; delete next.trace;
        return {result: {previous, next}, sqlite: await sqliteChecks(database)};
      });
    return;
  }
  if (campaign.startsWith('phase6b1-ui-')) {
    const name = campaign.slice('phase6b1-ui-'.length);
    check(UI_PROBES.includes(name), 'Unknown 6B.1 UI probe');
    const database = await openSmartFinDatabase();
    await record(`ui-${name}`, async () => {
      await runPhase6B1Probe(database, name, NEXT_IMPLEMENTATION);
      const summary = await getDashboardSummaryFromDb(database, PHASE6B1_DATE);
      // Rendered by Harness after the report; read with uiautomator by scripts/phase6b1/ui.cjs.
      global.__phase6aUi = () => <Phase6B1Metrics summary={summary}/>;
      return {probe: name, next: Object.fromEntries(FIELDS.map(k => [k, String(summary[k])])),
        nextDisplay: Object.fromEntries(FIELDS.map(k => [k, formatCurrency(summary[k], 'COP')]))};
    });
    return;
  }
  const match = /^phase6b1-volume-(1000|10000|100000)-(cents|pesos)$/.exec(campaign);
  if (match) return volume(Number(match[1]), match[2], d);
  throw Error('Unknown 6B.1 campaign');
}
