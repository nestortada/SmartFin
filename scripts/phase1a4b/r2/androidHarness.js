// Synthetic APK only (com.smartfin.snapshot5b2.tests). Phase 1a.4B r2 — DIAGNOSTIC campaign phase1a4b-r2-editamount.
// Reproduces `phase1a4b-reversal / editAmount` on the real Android driver with the REAL production use cases, records
// EVERY difference (not only the first) and a statement-level SQL trace, and keeps the campaign FAILED while any
// difference with the original 1a.4B Node reference remains. Nothing is normalized or accepted here.
//
// Trace: the react-native-sqlite-storage native batch method is wrapped from this harness (no production file changes).
// Around each batch the wrapper sends ONE read-only statement on the same database queue (same connection and, inside
// BEGIN…COMMIT, the same transaction): SELECT revision, changes(), total_changes(). No writes, commits, rollbacks or
// nested transactions are added. The driver only starts the next batch after the previous callback, which the wrapper
// releases after the read, so the operating sequence is unchanged.
//
// Cases, in order on ONE database (the runner clears the synthetic package first, exactly as in r1):
//   tracer-installed, schema-facts, editAmount-fresh-traced (r1 conditions), editAmount-staged-warm, editAmount-warm-traced,
//   verdict (fails if any difference with the original reference or with the Node diagnostic remains).
import {NativeModules} from 'react-native';
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {runPhase1A4BReversal} from './phase1a4bProbes';
import {allDifferences, compareTraces, describeEvents, r2SchemaFacts, runEditAmountStaged, summarizeTrace} from './phase1a4bR2Diagnostic';
import reference from './phase1a4bNodeExpected.json';
import node from './phase1a4bR2NodeExpected.json';

const CAMPAIGN = 'phase1a4b-r2-editamount';
const DATABASE = 'phase5b2_synthetic.db';
const PROBE_SQL = 'SELECT (SELECT revision FROM financial_data_revision WHERE id = 1) AS revision, changes() AS changes, total_changes() AS total';
const check = (condition, message) => {if (!condition) throw Error(message);};
const countWrites = async run => {
  const counter = {write: Number.MAX_SAFE_INTEGER, count: 0, phase: 'before'};
  global.__deletionFault = counter;
  try {await run();} finally {global.__deletionFault = undefined;}
  return counter.count;
};

/** Wraps NativeModules.SQLite.backgroundExecuteSqlBatch; keeps a strong reference so the JS representation is kept. */
function installTracer() {
  const module = NativeModules.SQLite;
  check(module && typeof module.backgroundExecuteSqlBatch === 'function', 'SQLite native module not found');
  const original = module.backgroundExecuteSqlBatch;
  let events = [];
  let active = false;
  let paused = false;
  let stage = '';
  let inTransaction = false;
  let batches = {single: 0, multi: 0, preamble: 0, preambleErrors: 0};
  const read = dbargs => new Promise(resolve => original.call(module, {dbargs, executes: [{qid: 1111, sql: PROBE_SQL, params: []}]},
    results => {
      const first = results && results[0];
      resolve(first && first.type === 'success' && first.result.rows ? first.result.rows[0] : {error: JSON.stringify(results)});
    },
    error => resolve({error: String(error)})));
  const value = (probe, key) => (probe && !probe.error && typeof probe[key] === 'number' ? probe[key] : null);
  module.backgroundExecuteSqlBatch = function tracedBatch(options, success, error) {
    if (!active || paused || !options || !options.dbargs || options.dbargs.dbname !== DATABASE || !Array.isArray(options.executes))
      return original.call(module, options, success, error);
    const executes = options.executes;
    // react-native-sqlite-storage prepends its own read-only "SELECT 1" to every non-txlock executeSql (sqlite.core.js,
    // SQLitePluginTransaction). It is not a SmartFin statement: counted as driver preamble, kept out of the event list.
    const preamble = executes.length >= 2 && executes[0].sql === 'SELECT 1' && (executes[0].params || []).length === 0 ? 1 : 0;
    batches.preamble += preamble;
    batches[executes.length - preamble === 1 ? 'single' : 'multi']++;
    read(options.dbargs).then(before => {
      const entries = executes.slice(preamble).map((execute, index) => {
        const entry = {
          seq: events.length + 1, stage, sql: String(execute.sql),
          paramTypes: (execute.params || []).map(param => (param === null ? 'null' : typeof param)),
          outcome: 'ok', driverRowsAffected: null,
          // Granularity: one read before and one after each native batch (batches of one statement in this flow).
          revisionBefore: index === 0 ? value(before, 'revision') : null, revisionAfter: null, changesAfter: null,
          totalChangesBefore: index === 0 ? value(before, 'total') : null, totalChangesAfter: null,
          inTransactionBefore: inTransaction,
          ...(before && before.error ? {probeError: before.error} : {}),
        };
        events.push(entry);
        if (/^\s*BEGIN/i.test(entry.sql)) inTransaction = true;
        if (/^\s*(COMMIT|END|ROLLBACK)/i.test(entry.sql)) inTransaction = false;
        return entry;
      });
      const finish = (results, callback, payload) => read(options.dbargs).then(after => {
        (results || []).forEach((result, index) => {
          if (index < preamble) {
            if (result.type !== 'success') batches.preambleErrors++;
            return;
          }
          const entry = entries[index - preamble];
          if (!entry) return;
          entry.outcome = result.type === 'success' ? 'ok' : 'error';
          if (result.type !== 'success') entry.error = JSON.stringify(result.result);
          entry.driverRowsAffected = result.result && typeof result.result.rowsAffected === 'number' ? result.result.rowsAffected : null;
        });
        const last = entries[entries.length - 1];
        last.revisionAfter = value(after, 'revision');
        last.changesAfter = value(after, 'changes');
        last.totalChangesAfter = value(after, 'total');
        if (after && after.error) last.probeError = after.error;
        callback(payload);
      });
      original.call(module, options, results => finish(results, success, results), failure => finish([], error, failure));
    });
  };
  check(module.backgroundExecuteSqlBatch !== original, 'Tracer could not be installed');
  return {
    module,
    batches: () => ({...batches}),
    start: label => {events = []; active = true; paused = false; stage = label;},
    stage: label => {stage = label;},
    pause: () => {paused = true;},
    resume: () => {paused = false;},
    stop: () => {active = false; const result = events; events = []; return result;},
  };
}

export async function runPhase1A4BR2(campaign, d) {
  check(campaign === CAMPAIGN, 'Unrecognized 1a.4B r2 campaign');
  await d.control.recoveryEnabled(false);
  await d.record('isolation', () => d.control.isolation());
  const database = await openSmartFinDatabase();
  await d.record('runtime', async () => {
    check(!!global.HermesInternal, 'Hermes release required');
    const [version] = await database.executeSql('SELECT sqlite_version() AS version');
    return {hermes: true, api: d.control.getConstants().api, sqliteVersion: version.rows.item(0).version};
  });
  const unexplained = [];
  let tracer;
  await d.record('tracer-installed', async () => {
    tracer = installTracer();
    tracer.start('selftest');
    await database.executeSql('SELECT 1 AS one');
    const events = tracer.stop();
    const batches = tracer.batches();
    check(events.length === 1 && events[0].sql === 'SELECT 1 AS one' && typeof events[0].revisionBefore === 'number' &&
      typeof events[0].revisionAfter === 'number' && !events[0].probeError && batches.preamble === 1 && batches.single === 1 &&
      batches.preambleErrors === 0, 'Tracer self-test failed: ' + JSON.stringify({events, batches}));
    return {selfTest: events[0], batches};
  });
  await d.record('schema-facts', async () => {
    const android = await r2SchemaFacts(database);
    // sqliteVersion is runtime information (3.9.2 expected on API 24), reported and excluded from this comparison.
    const differences = allDifferences({...android, sqliteVersion: undefined}, {...node.apkOrder.schema, sqliteVersion: undefined});
    if (differences.length) unexplained.push({case: 'schema-facts', against: 'node', count: differences.length});
    return {android, sqliteVersions: {android: android.sqliteVersion, node: node.apkOrder.schema.sqliteVersion}, differencesFromNode: differences};
  });
  const traced = async (label, name, expectedNode) => {
    tracer.start(name);
    let result;
    let failure = null;
    try {result = await runPhase1A4BReversal(database, 'editAmount', countWrites);} catch (error) {failure = String(error);}
    const trace = describeEvents(tracer.stop());
    const fromReference = result ? allDifferences(result, reference.reversal.editAmount) : [];
    const fromNode = result ? allDifferences(result, expectedNode.result) : [];
    const traceVsNode = compareTraces(trace, expectedNode.trace);
    console.log('PHASE1A4B_R2_CASE:' + JSON.stringify({label, failure, referenceDifferences: fromReference.length,
      nodeDifferences: fromNode.length, traceDifferences: traceVsNode.differenceCount}));
    if (failure) unexplained.push({case: label, failure});
    if (fromReference.length) unexplained.push({case: label, against: 'original 1a.4B reference', count: fromReference.length});
    if (fromNode.length) unexplained.push({case: label, against: 'node diagnostic', count: fromNode.length});
    if (traceVsNode.differenceCount) unexplained.push({case: label, against: 'node trace', count: traceVsNode.differenceCount});
    return {failure, result, differencesFromReference: fromReference, differencesFromNode: fromNode, trace,
      traceSummary: summarizeTrace(trace), traceVsNode, nativeBatches: tracer.batches()};
  };
  await d.record('editAmount-fresh-traced', () => traced('editAmount-fresh-traced', 'fresh:originalProbe', node.apkOrder.freshTraced));
  await d.record('editAmount-staged-warm', async () => {
    const staged = await runEditAmountStaged(database, tracer, 'warm');
    const expected = node.apkOrder.stagedWarm;
    const stageDifferences = allDifferences({editError: staged.editError, stages: staged.stages},
      {editError: expected.editError, stages: expected.stages});
    const traceVsNode = compareTraces(staged.trace, expected.trace);
    if (stageDifferences.length) unexplained.push({case: 'editAmount-staged-warm', against: 'node stages', count: stageDifferences.length});
    if (traceVsNode.differenceCount) unexplained.push({case: 'editAmount-staged-warm', against: 'node trace', count: traceVsNode.differenceCount});
    return {...staged, stageDifferencesFromNode: stageDifferences, traceVsNode};
  });
  await d.record('editAmount-warm-traced', () => traced('editAmount-warm-traced', 'warm:originalProbe', node.apkOrder.warmTraced));
  // The campaign stays failed while any difference is unexplained by this harness (no automatic acceptance).
  await d.record('verdict', async () => {
    check(unexplained.length === 0, 'Unresolved differences (diagnostic, not accepted): ' + JSON.stringify(unexplained));
    return {differences: 0};
  });
}
