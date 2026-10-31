/* global performance */
// Phase 6B.2 synthetic APK campaigns: the 6B.2 dashboard-aggregate probes (scripts/phase6b2/probes.ts)
// on the real react-native-sqlite-storage driver and Hermes, for the frozen pre-6B.2 dashboard and
// the production one; the production components for the visible COP text (dashboard NetWorthCard and
// MetricsGrid, Debit cards header); and the representative volumes (1.000 / 6 months, 10.000 /
// 5 years, 100.000 / 50 calendar years). Only the isolated test package and synthetic data.
import React from 'react';
import {View} from 'react-native';
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {getDashboardSummaryFromDb} from './src/modules/dashboard/useCases/getDashboardSummary';
import {getDebitCardsOverview} from './src/modules/accounts/useCases/getDebitCardsOverview';
import {formatCurrency} from './src/shared/utils/formatCurrency';
import {MetricsGrid} from './src/modules/dashboard/ui/components/MetricsGrid';
import {NetWorthCard} from './src/modules/dashboard/ui/components/NetWorthCard';
import {DebitCardsHeader} from './src/modules/accounts/ui/components/DebitCardsScreenStates';
import {debitCardsPalettes} from './src/modules/accounts/ui/debitCardsPalette';
import {createSqliteAccountRepository} from './src/modules/accounts/repositories/sqliteAccountRepository';
import {createSqliteTransactionRepository} from './src/modules/transactions/repositories/sqliteTransactionRepository';
import {PHASE6B2_DATE, PHASE6B2_PROBES, intlProbe, resetSyntheticData, runPhase6B2Probe} from './phase6b2Probes';
import * as previousDashboard from './pre6B2DashboardSummary';
import {representativeSeedStatements, REPRESENTATIVE_REFERENCE_DAY} from './representativeHistory';

const PREVIOUS = {
  name: 'previous',
  getDashboardSummaryFromDb: previousDashboard.getDashboardSummaryFromDb,
  formatCurrency: previousDashboard.formatCurrency,
};
const PALETTE = {background: '#f8f7fb', border: 'rgba(35, 42, 65, 0.12)', card: 'rgba(255, 255, 255, 0.78)', cardStrong: 'rgba(255, 255, 255, 0.92)',
  danger: '#a93932', muted: '#686678', primary: '#2848ee', primarySoft: 'rgba(61, 90, 254, 0.12)', secondary: '#5203d5', tertiary: '#007f3e', text: '#19191d'};
const FIELDS = ['availableBalance', 'netWorth', 'totalDebt', 'monthlyIncome', 'monthlyExpenses', 'monthlySavings'];
export const PHASE6B2_UI_PROBES = ['aggregateBalances', 'debtAggregate', 'sharedPosition', 'zeroThroughAggregation', 'negativeFortyCents'];

function Phase6B2Screens({summary, debitTotal}) {
  return <View style={{padding: 16}}>
    <DebitCardsHeader onOpenSettings={() => {}} palette={debitCardsPalettes.light} totalAvailable={debitTotal}/>
    <NetWorthCard availableBalance={summary.availableBalance} currency="COP" netWorth={summary.netWorth} palette={PALETTE}/>
    <MetricsGrid currency="COP" monthlyExpenses={summary.monthlyExpenses} monthlyIncome={summary.monthlyIncome}
      monthlySavings={summary.monthlySavings} palette={PALETTE} totalDebt={summary.totalDebt}/>
  </View>;
}

const check = (condition, message) => { if (!condition) throw Error(message); };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function sqliteChecks(database) {
  const [integrity] = await database.executeSql('PRAGMA integrity_check');
  const [fk] = await database.executeSql('PRAGMA foreign_key_check');
  const [version] = await database.executeSql('SELECT sqlite_version() AS v');
  check(integrity.rows.item(0).integrity_check === 'ok' && !fk.rows.length, 'SQLite integrity');
  return {integrity: 'ok', foreignKeyViolations: 0, sqliteVersion: version.rows.item(0).v};
}

/** Dashboard reads on the representative history, frozen and production alternating (same process and database). */
async function volume(size, {owned, record}) {
  await record(`volume-${size}`, async () => {
    await owned(async db => { for (const statement of representativeSeedStatements(size)) await db.executeSql(statement); });
    const database = await openSmartFinDatabase();
    const date = new Date(`${REPRESENTATIVE_REFERENCE_DAY}T17:00:00.000Z`);
    const timing = async () => {
      const runs = {previous: [], next: []};
      const summaries = {};
      for (let i = 0; i < 9; i++) {
        for (const [name, read] of i % 2 ? [['previous', PREVIOUS.getDashboardSummaryFromDb], ['next', getDashboardSummaryFromDb]]
          : [['next', getDashboardSummaryFromDb], ['previous', PREVIOUS.getDashboardSummaryFromDb]]) {
          const start = performance.now();
          summaries[name] = await read(database, date);
          runs[name].push(performance.now() - start);
        }
      }
      return {medianMs: {previous: median(runs.previous), next: median(runs.next)}, runs, summaries};
    };
    const pick = s => Object.fromEntries(FIELDS.map(k => [k, String(s[k])]));
    const pesos = await timing();
    for (const k of FIELDS) check(Object.is(pesos.summaries.next[k], pesos.summaries.previous[k]), `whole pesos changed ${k}`);
    const balances = {'rep-bank': 4500000.15, 'rep-bank2': 820000.2, 'rep-savings': 12000000.05, 'rep-cash': 150000.1, 'rep-card': 1250000.35, 'rep-card2': 380000.14};
    for (const [id, value] of Object.entries(balances))
      await database.executeSql(`UPDATE accounts SET ${id.includes('card') ? 'debt_balance_amount' : 'balance_amount'} = ? WHERE id = ?`, [value, id]);
    const cents = await timing();
    check(cents.summaries.next.availableBalance === 17470000.5 && cents.summaries.next.totalDebt === 1630000.49
      && cents.summaries.next.netWorth === 15840000.01, 'cents aggregates differ from oracle');
    for (const k of ['monthlyIncome', 'monthlyExpenses', 'monthlySavings']) check(Object.is(cents.summaries.next[k], cents.summaries.previous[k]), `monthly changed ${k}`);
    const [c] = await database.executeSql('SELECT count(*) AS n, min(date) AS first, max(date) AS last FROM transactions');
    return {rows: c.rows.item(0), pesos: {medianMs: pesos.medianMs, runs: pesos.runs, next: pick(pesos.summaries.next)},
      cents: {medianMs: cents.medianMs, runs: cents.runs, next: pick(cents.summaries.next), previous: pick(cents.summaries.previous)}, sqlite: await sqliteChecks(database)};
  });
}

/** Seeds the UI scene: a probe of scripts/phase6b2/probes.ts, or one small-amount case. */
async function seedUi(database, name) {
  if (name !== 'negativeFortyCents') return runPhase6B2Probe(database, name, PREVIOUS);
  await resetSyntheticData(database);
  await database.executeSql("INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES ('a','Cuenta','bankAccount','active','COP',-0.4,NULL,'2026-01-01','2026-01-01')");
  return undefined;
}

export async function runPhase6B2(campaign, baseDeps) {
  const record = (name, operation) => baseDeps.record(name, async () => {
    try { return await operation(); } catch (e) { throw e instanceof Error ? e : Error('Driver error: ' + JSON.stringify(e)); }
  });
  const d = {...baseDeps, record};
  await d.control.recoveryEnabled(false);
  await record('isolation', () => d.control.isolation());
  await record('runtime', async () => ({api: d.control.getConstants().api, hermes: !!global.HermesInternal,
    intl: intlProbe(formatCurrency), intlPrevious: intlProbe(previousDashboard.formatCurrency)}));
  if (campaign === 'phase6b2-probes') {
    const database = await openSmartFinDatabase();
    for (const name of PHASE6B2_PROBES)
      await record(`probe-${name}`, async () => ({result: await runPhase6B2Probe(database, name, PREVIOUS), sqlite: await sqliteChecks(database)}));
    return;
  }
  if (campaign.startsWith('phase6b2-ui-')) {
    const name = campaign.slice('phase6b2-ui-'.length);
    check(PHASE6B2_UI_PROBES.includes(name), 'Unknown 6B.2 UI probe');
    const database = await openSmartFinDatabase();
    await record(`ui-${name}`, async () => {
      await seedUi(database, name);
      const summary = await getDashboardSummaryFromDb(database, PHASE6B2_DATE);
      const previous = await PREVIOUS.getDashboardSummaryFromDb(database, PHASE6B2_DATE);
      const debit = await getDebitCardsOverview({accountRepository: createSqliteAccountRepository(database),
        transactionRepository: createSqliteTransactionRepository(database)}, PHASE6B2_DATE);
      // Rendered by Harness after the report; read with uiautomator by scripts/phase6b2/ui.cjs.
      global.__phase6aUi = () => <Phase6B2Screens summary={summary} debitTotal={debit.totalAvailable}/>;
      return {probe: name, next: Object.fromEntries(FIELDS.map(k => [k, String(summary[k])])),
        nextDisplay: Object.fromEntries(FIELDS.map(k => [k, formatCurrency(summary[k], 'COP')])),
        previous: Object.fromEntries(FIELDS.map(k => [k, String(previous[k])])),
        previousDisplay: Object.fromEntries(FIELDS.map(k => [k, previousDashboard.formatCurrency(previous[k], 'COP')])),
        debitTotal: String(debit.totalAvailable), debitTotalDisplay: formatCurrency(debit.totalAvailable, 'COP'), sqlite: await sqliteChecks(database)};
    });
    return;
  }
  const match = /^phase6b2-volume-(1000|10000|100000)$/.exec(campaign);
  if (match) return volume(Number(match[1]), d);
  throw Error('Unknown 6B.2 campaign');
}
