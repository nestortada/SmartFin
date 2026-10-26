// Phase 6B synthetic APK campaigns: the audit probes of scripts/phase6b/probes.ts on the real
// react-native-sqlite-storage driver and Hermes, plus the production dashboard components so
// the visible COP text can be read with uiautomator. Only the isolated test package and
// synthetic data; nothing here changes production rules.
import React from 'react';
import {View} from 'react-native';
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {getDashboardSummaryFromDb} from './src/modules/dashboard/useCases/getDashboardSummary';
import {formatCurrency} from './src/shared/utils/formatCurrency';
import {MetricsGrid} from './src/modules/dashboard/ui/components/MetricsGrid';
import {NetWorthCard} from './src/modules/dashboard/ui/components/NetWorthCard';
import {PHASE6B_DATE, PHASE6B_PROBES, runPhase6BProbe} from './phase6bProbes';

const PALETTE = {background: '#f8f7fb', border: 'rgba(35, 42, 65, 0.12)', card: 'rgba(255, 255, 255, 0.78)', cardStrong: 'rgba(255, 255, 255, 0.92)',
  danger: '#a93932', muted: '#686678', primary: '#2848ee', primarySoft: 'rgba(61, 90, 254, 0.12)', secondary: '#5203d5', tertiary: '#007f3e', text: '#19191d'};
const FIELDS = ['availableBalance', 'netWorth', 'totalDebt', 'monthlyIncome', 'monthlyExpenses', 'monthlySavings'];

function Phase6BMetrics({summary}) {
  return <View style={{padding: 16}}>
    <NetWorthCard availableBalance={summary.availableBalance} currency="COP" netWorth={summary.netWorth} palette={PALETTE}/>
    <MetricsGrid currency="COP" monthlyExpenses={summary.monthlyExpenses} monthlyIncome={summary.monthlyIncome}
      monthlySavings={summary.monthlySavings} palette={PALETTE} totalDebt={summary.totalDebt}/>
  </View>;
}

async function sqliteChecks(database) {
  const [integrity] = await database.executeSql('PRAGMA integrity_check');
  const [fk] = await database.executeSql('PRAGMA foreign_key_check');
  const [version] = await database.executeSql('SELECT sqlite_version() AS v');
  if (integrity.rows.item(0).integrity_check !== 'ok' || fk.rows.length) throw Error('SQLite integrity');
  return {integrity: 'ok', foreignKeyViolations: 0, sqliteVersion: version.rows.item(0).v};
}

export async function runPhase6B(campaign, deps) {
  const baseRecord = deps.record;
  const record = (name, operation) => baseRecord(name, async () => {
    try { return await operation(); } catch (e) { throw e instanceof Error ? e : Error('Driver error: ' + JSON.stringify(e)); }
  });
  await deps.control.recoveryEnabled(false);
  await record('isolation', () => deps.control.isolation());
  await record('runtime', async () => ({api: deps.control.getConstants().api, hermes: !!global.HermesInternal,
    intl: [0.5, 2.5, -0.5, 0.49999999999999994, -0.49999999999999994, -2.7755575615628914e-17, 97599.49999999999, 97599.5]
      .map(v => formatCurrency(v, 'COP')).join('|')}));
  const database = await openSmartFinDatabase();
  if (campaign === 'phase6b-probes') {
    for (const name of PHASE6B_PROBES)
      await record(`probe-${name}`, async () => ({result: await runPhase6BProbe(database, name), sqlite: await sqliteChecks(database)}));
    return;
  }
  if (campaign.startsWith('phase6b-ui-')) {
    const name = campaign.slice('phase6b-ui-'.length);
    if (!PHASE6B_PROBES.includes(name)) throw Error('Unknown 6B UI probe');
    await record(`ui-${name}`, async () => {
      await runPhase6BProbe(database, name);
      const summary = await getDashboardSummaryFromDb(database, PHASE6B_DATE);
      const display = Object.fromEntries(FIELDS.map(k => [k, formatCurrency(summary[k], 'COP')]));
      const text = Object.fromEntries(FIELDS.map(k => [k, String(summary[k])]));
      // Rendered by Harness after the report; read with uiautomator by scripts/phase6b/ui.cjs.
      global.__phase6aUi = () => <Phase6BMetrics summary={summary}/>;
      return {probe: name, next: text, nextDisplay: display};
    });
    return;
  }
  throw Error('Unknown 6B campaign');
}
