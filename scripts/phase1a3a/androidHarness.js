// Synthetic APK only (com.smartfin.snapshot5b2.tests). Phase 1a.3A campaigns on the real Android driver, with the
// probes of scripts/phase1a3a/probes.ts and the unchanged production use cases. Every case must equal the Node
// reference (docs/validacion-fase1a3a/node/results.json) field by field, without tolerance:
// - phase1a3a-identity: inserts, in-place updates, id/rowid/created_at/updated_at, CASCADE and SET NULL dependents,
//   unlisted columns, revision counter, foreign keys, rejected missing references, repeated reconciliation.
// - phase1a3a-atomicity: write count of a plan edit and of a statement payment (both with dependents), then every
//   write before/after with a confirmed rollback and the exact state restored (rowids and dependents included).
// - phase1a3a-unknown: lost COMMIT response, no retry, connection retired (data preserved for the restart).
// - phase1a3a-unknown-restart: after reopening, the edit is there once with identity, dependents and money intact.
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {
  checkPhase1A3AAfterRestart, PHASE1A3A_MATRICES, PHASE1A3A_PROBES, runPhase1A3AMatrix, runPhase1A3AProbe, runPhase1A3AUnknown,
} from './phase1a3aProbes';
import expected from './phase1a3aNodeExpected.json';

const CAMPAIGNS = ['phase1a3a-identity', 'phase1a3a-atomicity', 'phase1a3a-unknown', 'phase1a3a-unknown-restart'];
const check = (condition, message) => {if (!condition) throw Error(message);};
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
const same = (android, node, label) => check(canonical(android) === canonical(node),
  'Android differs from Node: ' + label + ': ' + firstDifference(android, node));
function leaves(value) {
  if (value && typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + leaves(item), 0);
  return 1;
}
/** The managed proxy of the synthetic APK counts INSERT/UPDATE/DELETE/REPLACE and fails the selected one. */
const androidFaults = {
  countWrites: async run => {
    const counter = {write: Number.MAX_SAFE_INTEGER, count: 0, phase: 'before'};
    global.__deletionFault = counter;
    try {await run();} finally {global.__deletionFault = undefined;}
    return counter.count;
  },
  arm: (write, phase) => {
    const fault = {write, count: 0, phase};
    global.__deletionFault = fault;
    return {fired: () => fault.count >= write,
      isInjected: error => error instanceof Error && error.message === `Injected ${phase} deletion write`};
  },
  disarm: () => {global.__deletionFault = undefined;},
};

export async function runPhase1A3A(campaign, d) {
  check(CAMPAIGNS.includes(campaign), 'Unrecognized 1a.3A campaign');
  await d.control.recoveryEnabled(false);
  await d.record('isolation', () => d.control.isolation());
  const database = await openSmartFinDatabase();
  await d.record('runtime', async () => {
    check(!!global.HermesInternal, 'Hermes release required');
    const [version] = await database.executeSql('SELECT sqlite_version() AS version');
    // Reported, never compared: API 24 is expected to run SQLite 3.9.2.
    return {hermes: true, api: d.control.getConstants().api, sqliteVersion: version.rows.item(0).version};
  });
  let fields = 0;
  const compared = (label, reference) => async operation => {
    const android = await operation();
    console.log('PHASE1A3A_CASE:' + JSON.stringify({campaign, label, fields: leaves(android)}));
    same(android, reference, label);
    fields += leaves(android);
    return {equalToNode: true, fields: leaves(android), android};
  };
  if (campaign === 'phase1a3a-identity') {
    check(PHASE1A3A_PROBES.join() === Object.keys(expected.probes).join(), 'Node reference does not match the probe list');
    for (const name of PHASE1A3A_PROBES)
      await d.record(name, () => compared(name, expected.probes[name])(() => runPhase1A3AProbe(database, name)));
  } else if (campaign === 'phase1a3a-atomicity') {
    for (const name of PHASE1A3A_MATRICES) {
      const record = (label, operation) => d.record(label, () => compared(label, expected.atomicity[label])(operation));
      const writes = await runPhase1A3AMatrix(database, name, androidFaults, record);
      check(writes === expected.writes[name], `${name}: ${writes} writes, Node ${expected.writes[name]}`);
    }
  } else if (campaign === 'phase1a3a-unknown') {
    await d.record('unknown-no-retry', () => compared('unknown', expected.unknown)(() =>
      runPhase1A3AUnknown(database, lost => {global.__snapshotCommitLost = lost;})));
    return;
  } else {
    await d.record('persisted-once-after-unknown', () => compared('restart', expected.restart)(() => checkPhase1A3AAfterRestart(database)));
  }
  await d.record('equivalence-summary', async () => ({campaign, fieldsCompared: fields, differences: 0}));
}
