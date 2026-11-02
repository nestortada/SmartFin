// Synthetic APK only. Production financial use cases and screens are imported unchanged.
import React, {useState} from 'react';
import {Dimensions, Pressable, ScrollView, Text, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {runSharedSQLiteTransaction, SQLiteCommandFailure} from './src/database/atomicSQLite';
import {createSqliteAccountRepository} from './src/modules/accounts/repositories/sqliteAccountRepository';
import {createSqliteTransactionRepository} from './src/modules/transactions/repositories/sqliteTransactionRepository';
import {createSqliteCreditCardRepository} from './src/modules/creditCards/repositories/sqliteCreditCardRepository';
import {saveManualTransaction} from './src/modules/transactions/useCases/saveManualTransaction';
import {registerCreditCardPayment} from './src/modules/creditCards/useCases/creditCardTransactionRelations';
import {getDashboardSummaryFromDb} from './src/modules/dashboard/useCases/getDashboardSummary';
import {CreditCardsScreen} from './src/modules/creditCards/ui/CreditCardsScreen';
import {NetWorthCard} from './src/modules/dashboard/ui/components/NetWorthCard';
import {MetricsGrid} from './src/modules/dashboard/ui/components/MetricsGrid';
import {TransactionCard} from './src/modules/transactions/ui/components/TransactionCard';
import {formatCurrency} from './src/shared/utils/formatCurrency';
import {resetSyntheticData} from './phase6bProbes';
import {PHASE6B3_DATE, PHASE6B3_PROBES, runPhase6B3Probe} from './phase6b3Probes';
import * as previousCards from './pre6B3CreditCardRelations';
import expected from './phase6b3NodeExpected.json';

const check = (condition, message) => {if (!condition) throw Error(message);};
const rows = r => Array.from({length: r.rows.length}, (_, i) => r.rows.item(i));
const canonical = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v)))
    : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
function firstDifference(a, b, at = '$') {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const difference = firstDifference(a[key], b[key], at + '.' + key);
      if (difference) return difference;
    }
    return undefined;
  }
  return JSON.stringify(a) === JSON.stringify(b) ? undefined : `${at}: Android=${JSON.stringify(a)} Node=${JSON.stringify(b)}`;
}
const same = (a, b, message) => check(canonical(a) === canonical(b), message + ': ' + firstDifference(a, b));
const deps = database => ({accountRepository: createSqliteAccountRepository(database),
  creditCardRepository: createSqliteCreditCardRepository(database), transactionRepository: createSqliteTransactionRepository(database)});
const purchase = async (database, amount, date = PHASE6B3_DATE) => {
  const d = deps(database);
  return saveManualTransaction({...d, accounts: await d.accountRepository.getAccounts(), accountId: 'card', amount,
    merchantName: 'Sintetico 6B.3.1', operationType: 'Crédito', transactionType: 'expense', hasInterestFreeInstallments: false,
    installmentCountInput: '1', interestFreeInstallmentCountInput: '', currentDate: date});
};
async function seed(database, purchases, bank = 1000000, date = PHASE6B3_DATE) {
  await resetSyntheticData(database);
  await database.executeSql(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES
    ('bank','Banco sintetico','bankAccount','active','COP',?,NULL,'2026-01-01','2026-01-01'),
    ('card','Visa sintetica','creditCard','active','COP',0,0,'2026-01-01','2026-01-01')`, [bank]);
  for (const amount of purchases) await purchase(database, amount, date);
}
async function integrity(database) {
  const [i] = await database.executeSql('PRAGMA integrity_check');
  const [f] = await database.executeSql('PRAGMA foreign_key_check');
  const [v] = await database.executeSql('SELECT sqlite_version() AS version');
  check(i.rows.item(0).integrity_check === 'ok' && f.rows.length === 0, 'SQLite integrity/foreign keys');
  return {integrity: 'ok', foreignKeyViolations: 0, sqliteVersion: v.rows.item(0).version};
}
async function state(database) {
  const [names] = await database.executeSql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const tables = {};
  for (const {name} of rows(names)) {
    check(/^[a-zA-Z0-9_]+$/.test(name), 'Unexpected table');
    const [r] = await database.executeSql(`SELECT * FROM "${name}" ORDER BY rowid`);
    tables[name] = rows(r);
  }
  return {tables, metrics: await getDashboardSummaryFromDb(database, PHASE6B3_DATE), sqlite: await integrity(database)};
}
const request = (database, amount) => ({...deps(database), accountId: 'card', sourceAccountId: 'bank', amount,
  settlement: 'fullDebt', currentDate: PHASE6B3_DATE});
// <rollback-oracle> 6B.3.1 r3. Production contract (creditCardPaymentScope): after a confirmed ROLLBACK the
// runner rethrows the original error; only an uncertain finalization becomes SQLiteCommandFailure('unknown').
// The error alone never proves the rollback: the injected write must have been reached, the connection must
// stay usable, a new owner must open and confirm a transaction (none was left open) and every table, metric
// and integrity check must equal the state before the request. 'unknown' fails at once: nothing else is run.
async function confirmedRollbackVerdict({failure, faultFired, injected, before, readState, openNextOwner, difference, CommandFailure}) {
  if (failure === undefined) throw Error('The injected fault did not make the payment fail');
  if (!faultFired) throw Error('The injected write was not reached');
  if (failure instanceof CommandFailure) throw Error('Rollback not confirmed: ' + failure.result.status);
  if (!(failure instanceof Error) || failure.message !== injected)
    throw Error('Unexpected payment error: ' + String(failure instanceof Error ? failure.message : failure));
  let after;
  try {after = await readState();} catch (error) {throw Error('Connection retired: rollback not confirmed: ' + String(error));}
  const nextOwner = await openNextOwner();
  if (nextOwner !== 'confirmed') throw Error('Transaction left open after the failure: ' + nextOwner);
  const changed = difference(after, before);
  if (changed) throw Error('Rollback changed tables, audit, revision or metrics: ' + changed);
  return 'rolledBack';
}
// </rollback-oracle>
async function matrix(database, record) {
  for (const [purchases, debt] of [[[0.4], 0.4], [[10000.4], 10000.4], [[4229.9, 89392.54, 939.56], 94562]]) {
    await seed(database, purchases);
    global.__deletionFault = {write: Number.MAX_SAFE_INTEGER, count: 0, phase: 'before'};
    await registerCreditCardPayment(request(database, debt));
    const count = global.__deletionFault.count;
    global.__deletionFault = undefined;
    check(count > 0, 'Write instrumentation missing');
    await record(`write-count-${debt}`, async () => ({writes: count, points: count * 2}));
    for (let write = 1; write <= count; write++) for (const phase of ['before', 'after']) {
      await record(`rollback-${debt}-${write}-${phase}`, async () => {
        await seed(database, purchases);
        const before = await state(database);
        const fault = {write, count: 0, phase};
        global.__deletionFault = fault;
        let failure;
        try {await registerCreditCardPayment(request(database, debt));} catch (error) {failure = error;}
        finally {global.__deletionFault = undefined;}
        const status = await confirmedRollbackVerdict({
          failure, faultFired: fault.count >= write, injected: `Injected ${phase} deletion write`, before,
          readState: () => state(database),
          openNextOwner: async () => (await runSharedSQLiteTransaction(database, async () => 'closed')).status,
          difference: firstDifference, CommandFailure: SQLiteCommandFailure,
        });
        return {write, phase, status, originalErrorPropagated: true, nextOwnerConfirmed: true, exactStateRestored: true};
      });
    }
  }
  await record('confirmed-same-request-no-duplicate', async () => {
    await seed(database, [0.4]);
    const command = request(database, 0.4);
    const first = await registerCreditCardPayment(command);
    global.__deletionFault = {write: Number.MAX_SAFE_INTEGER, count: 0, phase: 'before'};
    const second = await registerCreditCardPayment(command);
    const count = global.__deletionFault.count;
    global.__deletionFault = undefined;
    check(first === second && count === 0, 'Confirmed request was retried');
    return {sameResult: true, extraWrites: count, sqlite: await integrity(database)};
  });
}
const PALETTE = {background:'#f8f7fb', border:'#ddd', card:'#fff', cardStrong:'#eee', danger:'#a93932', muted:'#686678',
  primary:'#2848ee', primarySoft:'#dde', secondary:'#5203d5', tertiary:'#007f3e', text:'#19191d'};
const nothing = () => {};
function PaymentScreen({database, control, stale}) {
  const [inspection, setInspection] = useState('');
  const inspect = async () => {
    try {
      const value = await state(database);
      const [p] = await database.executeSql("SELECT amount,target_account_id,payment_method,status FROM transactions WHERE type='creditCardPayment'");
      const evidence = {state: value, payments: rows(p)};
      await control.report(JSON.stringify({campaign:'phase6b3-ui-inspection', passed:true, evidence}));
      setInspection(JSON.stringify({payments: rows(p), bank: value.tables.accounts.find(a => a.id === 'bank').balance_amount,
        debt: value.tables.accounts.find(a => a.id === 'card').debt_balance_amount}));
    } catch (error) {setInspection(String(error));}
  };
  return <View style={{height:Dimensions.get('window').height - 28}}>
    <SafeAreaProvider>
      <View style={{paddingTop:22, backgroundColor:'#fff'}}>
        <Pressable accessibilityRole="button" onPress={inspect}><Text>Control sintetico: inspeccionar</Text></Pressable>
        {stale ? <Pressable accessibilityRole="button" onPress={() => {
          setInspection('Compra adicional programada en 15 segundos');
          setTimeout(() => {purchase(database, 0.01, new Date()).then(() => setInspection('Deuda modificada +0,01')).catch(e => setInspection(String(e)));}, 15000);
        }}><Text>Control sintetico: cambiar deuda en 15 segundos</Text></Pressable> : null}
        <Text>{inspection}</Text>
      </View>
      <CreditCardsScreen activeTheme="light" database={database} onNavigateToHome={nothing}
        onNavigateToTransactions={nothing} onOpenDebitCards={nothing} onOpenSettings={nothing}/>
      <Toast/>
    </SafeAreaProvider>
  </View>;
}
function MoneyPresentation() {
  const values = [0.4, -0.4, 0.01, 0.5, 0, -0, 0.004, -2.78e-17, 0.3999999999996362];
  const tx = {id:'payment', amount:0.4, currency:'COP', description:'Pago sintetico', accountId:'bank', targetAccountId:'card',
    date:'2026-11-01', type:'creditCardPayment', direction:'outflow', status:'posted', paymentMethod:'debit', createdAt:'2026-11-01', updatedAt:'2026-11-01'};
  return <ScrollView style={{height:Dimensions.get('window').height - 28, backgroundColor:'#fff', padding:14}}>
    {values.map((value, index) => <Text key={index}>{index}: {Object.is(value, -0) ? '-0' : String(value)} = {formatCurrency(value, 'COP')}</Text>)}
    <NetWorthCard availableBalance={0.01} netWorth={-0.4} currency="COP" palette={PALETTE}/>
    <MetricsGrid monthlyIncome={0.01} monthlyExpenses={0.4} monthlySavings={-0.4} totalDebt={0.5} currency="COP" palette={PALETTE}/>
    <TransactionCard tx={tx} accounts={[{id:'bank',name:'Banco'},{id:'card',name:'Visa'}]} categories={[]}
      isDark={false} themeColors={PALETTE} onEditInstallments={nothing} onShowOpTypeDropdown={nothing}/>
  </ScrollView>;
}
export async function runPhase6B3(campaign, d) {
  await d.control.recoveryEnabled(false);
  await d.record('isolation', () => d.control.isolation());
  await d.record('runtime', async () => {check(!!global.HermesInternal, 'Hermes release required'); return {hermes:true, api:d.control.getConstants().api};});
  const database = await openSmartFinDatabase();
  if (campaign === 'phase6b3-probes') {
    for (const name of PHASE6B3_PROBES) await d.record(name, async () => {
      const previous = await runPhase6B3Probe(database, name, {name:'previous', registerCreditCardPayment:previousCards.registerCreditCardPayment});
      const next = await runPhase6B3Probe(database, name);
      console.log('PHASE6B3_PROBE:' + JSON.stringify({name, previous, next}));
      same({previous, next}, expected.probes[name], 'Android differs from Node / independent decimal probe: ' + name);
      return {previous, next, sqlite: await integrity(database)};
    });
    return;
  }
  if (campaign === 'phase6b3-atomicity') return matrix(database, d.record);
  if (campaign === 'phase6b3-unknown') return d.record('unknown-no-retry', async () => {
    await seed(database, [0.4]);
    const command = request(database, 0.4);
    global.__snapshotCommitLost = true;
    let failure;
    try {await registerCreditCardPayment(command);} catch (error) {failure = error;}
    finally {global.__snapshotCommitLost = false;}
    check(failure instanceof SQLiteCommandFailure && failure.result.status === 'unknown', 'COMMIT must stay unknown');
    let second;
    try {await registerCreditCardPayment(command);} catch (error) {second = error;}
    check(second === failure, 'Unknown request was retried');
    let unreadable = false;
    try {await deps(database).accountRepository.getAccounts();} catch {unreadable = true;}
    check(unreadable, 'Unknown connection not retired');
    return {status:'unknown', sameFailure:true, connectionRetired:true};
  });
  if (campaign === 'phase6b3-unknown-restart') return d.record('persisted-once-after-unknown', async () => {
    const [p] = await database.executeSql("SELECT amount,target_account_id,payment_method,status FROM transactions WHERE type='creditCardPayment'");
    const [a] = await database.executeSql('SELECT id,balance_amount,debt_balance_amount FROM accounts ORDER BY id');
    check(p.rows.length === 1 && p.rows.item(0).amount === 0.4, 'Unknown caused a duplicate / missing payment');
    check(rows(a).find(x => x.id === 'bank').balance_amount === 999999.6 && rows(a).find(x => x.id === 'card').debt_balance_amount === 0, 'Unknown final accounting');
    return {accounts:rows(a), payments:rows(p), sqlite: await integrity(database)};
  });
  if (campaign === 'phase6b3-presentation') {
    global.__phase6aUi = MoneyPresentation;
    return d.record('presentation-seeded-only', async () => ({visualAcceptancePending:true, sqlite:await integrity(database)}));
  }
  if (['phase6b3-ui-small', 'phase6b3-ui-cents', 'phase6b3-ui-insufficient', 'phase6b3-ui-stale', 'phase6b3-ui-unknown'].includes(campaign)) {
    const small = campaign.endsWith('small') || campaign.endsWith('unknown');
    await seed(database, [small ? 0.4 : 10000.4], campaign.endsWith('insufficient') ? 10000.39 : 1000000, new Date());
    if (campaign.endsWith('unknown')) global.__snapshotCommitLost = true;
    global.__phase6aUi = () => <PaymentScreen database={database} control={d.control} stale={campaign.endsWith('stale')}/>;
    return d.record('production-screen-seeded-only', async () => ({visualAcceptancePending:true, campaign, sqlite:await integrity(database)}));
  }
  throw Error('Unrecognized 6B.3 campaign');
}
