import React, { useEffect, useState } from 'react';
import { NativeModules, Text, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import SQLite from 'react-native-sqlite-storage';
import { SQLITE_SCHEMA_STATEMENTS } from './src/database/sqliteSchema';
import { DashboardScreen } from './src/modules/dashboard/ui/DashboardScreen';
import { getDashboardSummaryFromDb as before } from './src/modules/dashboard/useCases/getDashboardSummaryBaseline';
import { getDashboardSummaryFromDb as after } from './src/modules/dashboard/useCases/getDashboardSummary';

const native = NativeModules.DashboardBenchmark;
const clock = global.performance;
const config = native.getConstants ? native.getConstants() : native;
if (
  config.packageId !== 'com.smartfin.dashboardphase2.bench' ||
  !config.release ||
  __DEV__
) {
  throw new Error('Benchmark must run in the isolated release package.');
}
if (!global.HermesInternal) throw new Error('Hermes is required.');
global.__phase2Config = config;
SQLite.enablePromise(true);
SQLite.DEBUG(false);
let initialReady;
let sampleReady;
let dataset;
const nextPaint = () =>
  new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
const delay = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));
const noop = () => {};

function instrument(database) {
  const execute = database.executeSql.bind(database);
  return new Proxy(database, {
    get(target, key) {
      if (key !== 'executeSql') return Reflect.get(target, key);
      return async (sql, values = []) => {
        const started = clock.now();
        const results = await execute(sql, values);
        const trace = global.__phase2Trace;
        if (trace?.active) {
          const result = results[0];
          trace.queries.push({
            sql,
            values,
            returnedRows: result.rows.length,
            queryRoundtripMs: clock.now() - started,
            nativeQueryMs: result.__nativeQueryMs,
            sqlCursorMs: result.__sqlCursorMs,
          });
        }
        return results;
      };
    },
  });
}

global.__phase2Layout = async (loading, summary, error) => {
  if (
    !global.__phase2Trace &&
    !loading &&
    global.__phase2InitialResolved &&
    initialReady
  ) {
    const resolve = initialReady;
    initialReady = undefined;
    await nextPaint();
    resolve();
    return;
  }
  const trace = global.__phase2Trace;
  if (!trace?.active || !trace.resolved || loading || trace.finishing) return;
  trace.finishing = true;
  trace.layoutCommitMs = clock.now() - trace.started;
  await nextPaint();
  trace.fullRefreshMs = clock.now() - trace.started;
  trace.active = false;
  const record = {
    type: trace.type,
    size: Number(config.size),
    version: config.version,
    iteration: trace.iteration,
    hermes: Boolean(global.HermesInternal),
    dev: __DEV__,
    model: config.model,
    android: config.android,
    abi: config.abi,
    timezone: config.timezone,
    date: config.date,
    dataset,
    queries: trace.queries,
    computeMs: trace.computeMs,
    mappingMs: trace.mappingMs,
    dataReadyMs: trace.dataReadyMs,
    layoutCommitMs: trace.layoutCommitMs,
    fullRefreshMs: trace.fullRefreshMs,
    maxJsRafGapMs: trace.maxJsRafGapMs,
    rafGapsMs: trace.rafGapsMs,
    summary,
    error: error ?? null,
  };
  await native.finishSample(JSON.stringify(record));
  global.__phase2Trace = undefined;
  sampleReady?.();
  sampleReady = undefined;
};

async function functional(database) {
  const cases = [];
  for (const date of [
    '2026-10-10T12:00:00-05:00',
    '2026-01-01T12:00:00-05:00',
    '2026-12-31T12:00:00-05:00',
    '2024-02-29T12:00:00-05:00',
    '2026-03-31T12:00:00-05:00',
    '2026-11-15T12:00:00-05:00',
  ]) {
    const left = await before(database, new Date(date));
    const right = await after(database, new Date(date));
    cases.push({
      date,
      before: left,
      after: right,
      exact: JSON.stringify(left) === JSON.stringify(right),
    });
  }
  const [transfers] = await database.executeSql(
    "SELECT direction, status, COUNT(*) AS count, SUM(amount) AS amount FROM transactions WHERE type='internalTransfer' GROUP BY direction, status ORDER BY direction,status;",
  );
  await native.writeFunctional(
    JSON.stringify({
      type: 'functional',
      size: Number(config.size),
      release: config.release,
      hermes: Boolean(global.HermesInternal),
      timezone: config.timezone,
      dataset,
      cases,
      allExact: cases.every(item => item.exact),
      transferRows: transfers.rows.raw(),
    }),
  );
}

export default function BenchmarkApp() {
  const [database, setDatabase] = useState();
  const [refreshKey, setRefreshKey] = useState(0);
  const [status, setStatus] = useState('Preparing synthetic database');
  useEffect(() => {
    async function run() {
      dataset = await native.seed(
        Number(config.size),
        SQLITE_SCHEMA_STATEMENTS,
      );
      if (config.version === 'prepare') {
        await native.writeFunctional(
          JSON.stringify({
            type: 'prepared',
            dataset,
            size: Number(config.size),
          }),
        );
        setStatus('Synthetic dataset prepared');
        return;
      }
      if (
        !dataset.name.startsWith('dashboard_phase2_v3_') ||
        dataset.name === 'smartfin.db'
      )
        throw new Error('Synthetic database guard failed');
      const opened = await SQLite.openDatabase({
        name: dataset.name,
        location: 'default',
      });
      const traced = instrument(opened);
      if (config.version === 'functional') {
        await functional(traced);
        setStatus('Functional checks complete');
        return;
      }
      const initial = new Promise(resolve => {
        initialReady = resolve;
      });
      setDatabase(traced);
      await initial;
      for (let iteration = -2; iteration < 5; iteration += 1) {
        setStatus(
          `${config.version} / ${config.size} / ${
            iteration < 0 ? 'warmup' : 'sample ' + (iteration + 1)
          }`,
        );
        await delay(500);
        await native.beginSample();
        const complete = new Promise(resolve => {
          sampleReady = resolve;
        });
        const trace = {
          active: true,
          resolved: false,
          finishing: false,
          type: iteration < 0 ? 'warmup' : 'sample',
          iteration,
          started: clock.now(),
          computeMs: 0,
          mappingMs: 0,
          queries: [],
          rafGapsMs: [],
          maxJsRafGapMs: 0,
        };
        global.__phase2Trace = trace;
        let lastFrame = trace.started;
        const observeFrames = () => {
          if (!trace.active) return;
          const time = clock.now();
          const gap = time - lastFrame;
          trace.rafGapsMs.push(gap);
          trace.maxJsRafGapMs = Math.max(trace.maxJsRafGapMs, gap);
          lastFrame = time;
          requestAnimationFrame(observeFrames);
        };
        requestAnimationFrame(observeFrames);
        setRefreshKey(value => value + 1);
        await complete;
      }
      setStatus('COMPLETE — synthetic data only');
    }
    run().catch(async error => {
      setStatus(`ERROR: ${String(error)}`);
      await native.writeFunctional(
        JSON.stringify({
          type: 'failure',
          error: String(error),
          size: Number(config.size),
          version: config.version,
        }),
      );
    });
  }, []);
  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <Text style={styles.banner}>Phase 2 release benchmark · {status}</Text>
        {database ? (
          <DashboardScreen
            activeTheme="light"
            database={database}
            refreshKey={refreshKey}
            onOpenCreditCards={noop}
            onOpenDebitCards={noop}
            onOpenAiAssistant={noop}
            onOpenSettings={noop}
            onNavigateToTransactions={noop}
          />
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  banner: {
    padding: 8,
    backgroundColor: '#203040',
    color: 'white',
    fontSize: 12,
  },
});
