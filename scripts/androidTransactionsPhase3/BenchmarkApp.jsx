import React, { useEffect, useState } from 'react';
import { NativeModules, Text, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import SQLite from 'react-native-sqlite-storage';
import { SQLITE_SCHEMA_STATEMENTS } from './src/database/sqliteSchema';
import { applyVersionedMigrations } from './src/database/migrations';
import { TransactionsScreen } from './src/modules/transactions/ui/TransactionsScreen';
import { createSqliteTransactionRepository } from './src/modules/transactions/repositories/sqliteTransactionRepository';

const native = NativeModules.DashboardBenchmark;
let config = native.getConstants ? native.getConstants() : native;
if (config.packageId !== 'com.smartfin.transactionsphase3.bench' || !config.release || __DEV__ || !global.HermesInternal)
  throw new Error('Isolated release/Hermes guard failed');
global.__historyConfig = config;
SQLite.enablePromise(true);
SQLite.DEBUG(false);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const noop = () => {};
const clock = global.performance;
let latest;
let waiting;
let trace;
global.__historyViewable = ids => {
  if (trace?.type === 'scroll') trace.visible.push({ ms: clock.now() - trace.started, ids });
};
global.__historyProbe = value => {
  latest = value;
  if (waiting && (value.loading || value.loadingMore)) waiting.started = true;
  if (waiting?.started && !value.loading && !value.loadingMore && value.transactions !== waiting.previous) {
    if (value.error) waiting.reject(new Error(value.error));
    else waiting.resolve(value);
    waiting = undefined;
  }
};
function interaction(operation, expectLoading = true) {
  const done = new Promise((resolve, reject) => { waiting = { resolve, reject, started: !expectLoading, previous: latest?.transactions }; });
  operation();
  return done;
}
function instrument(database) {
  return new Proxy(database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return async (sql, values = []) => {
      const start = clock.now();
      const result = await target.executeSql(sql, values);
      if (trace?.active) trace.queries.push({ sql, values, returnedRows: result[0].rows.length,
        queryRoundtripMs: clock.now() - start, nativeQueryMs: result[0].__nativeQueryMs,
        sqlCursorMs: result[0].__sqlCursorMs });
      return result;
    };
  } });
}
async function functional(database, dataset) {
  const repo = createSqliteTransactionRepository(database);
  const before = await repo.getTransactions();
  const cases = [];
  for (const sort of ['newest', 'oldest']) for (const search of ['', 'merchant 49', 'not found']) {
    const query = { month: 'all', accountId: 'all', categoryId: 'all', search, sort };
    const expected = before.filter(tx => !search || [tx.description, tx.merchantName, tx.notes]
      .some(text => text?.toLowerCase().includes(search))).sort((a, b) => sort === 'newest'
      ? new Date(b.date) - new Date(a.date) : new Date(a.date) - new Date(b.date));
    let cursor;
    const actual = [];
    do { const page = await repo.getTransactionPage(query, cursor); actual.push(...page.transactions); cursor = page.nextCursor; } while (cursor);
    cases.push({ query, expectedCount: expected.length, actualCount: actual.length,
      exact: JSON.stringify(expected) === JSON.stringify(actual) });
  }
  if (cases.some(item => !item.exact)) throw new Error('Functional equivalence failed');
  await native.writeFunctional(JSON.stringify({ type: 'functional', dataset, size: Number(config.size), cases, allExact: true }));
}
export default function BenchmarkApp() {
  const [database, setDatabase] = useState();
  const [mount, setMount] = useState(0);
  const [status, setStatus] = useState('Synthetic database');
  useEffect(() => {
    async function run() {
      config = await native.readConfig();
      global.__historyConfig = config;
      const dataset = await native.seed(Number(config.size), SQLITE_SCHEMA_STATEMENTS);
      if (config.version === 'prepare') {
        await native.writeFunctional(JSON.stringify({ type: 'prepared', dataset, size: Number(config.size) })); return;
      }
      if (!dataset.name.startsWith('transactions_phase3_v3_')) throw new Error('Database guard failed');
      const opened = await SQLite.openDatabase({ name: dataset.name, location: 'default' });
      await applyVersionedMigrations(opened);
      const observed = instrument(opened);
      if (config.version === 'functional') { await functional(observed, dataset); setStatus('Functional complete'); return; }
      await interaction(() => setDatabase(observed));
      if (config.version === 'scroll') {
        setStatus('SCROLL READY');
        await native.beginSample();
        trace = { type: 'scroll', size: Number(config.size), version: config.version, dataset,
          hermes: true, active: true, started: clock.now(), visible: [], queries: [], rafGapsMs: [] };
        let last = trace.started;
        const frame = () => {
          if (!trace.active) return;
          const time = clock.now(); trace.rafGapsMs.push(time - last); last = time; requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        await native.writeFunctional(JSON.stringify({ type: 'scrollReady', size: Number(config.size) }));
        await delay(45000);
        trace.active = false;
        trace.retainedTransactions = latest.transactions.length;
        trace.uniqueTransactions = new Set(latest.transactions.map(tx => tx.id)).size;
        trace.maxJsRafGapMs = Math.max(...trace.rafGapsMs);
        await native.finishSample(JSON.stringify(trace));
        setStatus('SCROLL COMPLETE · ' + latest.transactions.length);
        return;
      }
      for (let iteration = -2; iteration < 5; iteration++) {
        await delay(500);
        await native.beginSample();
        trace = { type: iteration < 0 ? 'warmup' : 'sample', iteration, active: true,
          size: Number(config.size), version: config.version, dataset, hermes: true, queries: [],
          rafGapsMs: [], maxJsRafGapMs: 0 };
        let previous = clock.now();
        const frames = () => {
          if (!trace.active) return;
          const time = clock.now(); const gap = time - previous; previous = time;
          trace.rafGapsMs.push(gap); trace.maxJsRafGapMs = Math.max(trace.maxJsRafGapMs, gap);
          requestAnimationFrame(frames);
        };
        requestAnimationFrame(frames);
        const start = clock.now();
        await interaction(() => setMount(value => value + 1));
        trace.initialDataMs = clock.now() - start;
        trace.retainedTransactions = latest.transactions.length;
        trace.initialQueries = trace.queries.length;
        trace.initialReturnedRows = trace.queries.reduce((total, q) => total + q.returnedRows, 0);
        await paint();
        trace.initialPaintMs = clock.now() - start;
        trace.interactions = [];
        // All filters hit history outside the initial page. Measure actual hook/UI.
        for (const [name, action] of [
          ['combinedFilters', () => { latest.setSelectedMonth('2024-02'); latest.setSelectedAccount('bank'); latest.setSelectedCategory('cat_expense'); }],
          ['oldSearch', () => { latest.setSelectedMonth('all'); latest.setSelectedAccount('all'); latest.setSelectedCategory('all'); latest.setSearchQuery('merchant 49'); }],
          ['absentSearch', () => latest.setSearchQuery('not found')],
          ['reset', () => latest.setSearchQuery('')],
        ]) {
          const started = clock.now(); const q = trace.queries.length;
          await interaction(action, config.version === 'after'); await paint();
          trace.interactions.push({ name, ms: clock.now() - started, retained: latest.transactions.length,
            returnedRows: trace.queries.slice(q).reduce((total, entry) => total + entry.returnedRows, 0) });
        }
        // Progressive append cost, independent of native scrolling/frame claims.
        if (latest.loadMore) {
          const started = clock.now();
          for (let page = 0; page < 9; page++) await interaction(() => latest.loadMore());
          trace.ninePagesMs = clock.now() - started;
          trace.afterNinePages = latest.transactions.length;
        }
        trace.active = false;
        await native.finishSample(JSON.stringify(trace));
        setStatus(config.version + ' / ' + config.size + ' / ' + iteration);
      }
      setStatus('COMPLETE · synthetic only');
    }
    run().catch(async error => { setStatus(String(error)); await native.writeFunctional(JSON.stringify({ type: 'failure', error: String(error) })); });
  }, []);
  return <SafeAreaProvider><View style={styles.root}><Text style={styles.banner}>Phase 3 · {status}</Text>
    {database ? <TransactionsScreen key={mount} activeTheme="light" database={database} onForceRefresh={noop}
      onNavigateToHome={noop} onOpenCreditCards={noop} onOpenDebitCards={noop} onOpenSettings={noop} /> : null}
  </View></SafeAreaProvider>;
}
const styles = StyleSheet.create({ root: { flex: 1 }, banner: { padding: 8, backgroundColor: '#203040', color: 'white', fontSize: 12 } });
