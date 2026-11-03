// Synthetic APK only (com.smartfin.snapshot5b2.tests). Phase 1a.4A campaigns on the real Android driver, with the probes
// of scripts/phase1a4a/probes.ts and the unchanged production use cases and repositories. Every case must equal the Node
// reference (docs/validacion-fase1a4a/node/results.json, part phase1a4a) field by field, without tolerance:
// - phase1a4a-creation: revision 0 of a new plan in 11 scenarios (cents, closing day and policy, inexact, zero-cent,
//   400 installments, confirmed first cycle, second original rejected and repeated use case without writes).
// - phase1a4a-lifecycle: ordinary edits, 3 -> 6, to one installment, recreation, debit, quick action and deletion, with
//   the write count of every step.
// - phase1a4a-compatibility: migrated v4 purchase, new purchase and a plan without history from the intermediate version.
// - phase1a4a-invariants: exact money after every step (BigInt cents); history only adds revision rows.
// - phase1a4a-atomicity: every write of a creation (7) and of a recreation (7) before/after = 28 points, confirmed
//   rollback and the exact state restored (history and backup counter included).
// - phase1a4a-unknown: lost COMMIT response of a creation, no retry, connection retired (data kept for the restart).
// - phase1a4a-unknown-restart (PreserveData): one purchase with exactly one revision 0 after reopening.
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {
  checkPhase1A4AAfterRestart, PHASE1A4A_CREATION_CASES, PHASE1A4A_MATRICES, runPhase1A4ACompatibility, runPhase1A4ACreation,
  runPhase1A4AInvariants, runPhase1A4ALifecycle, runPhase1A4AMatrix, runPhase1A4AUnknown,
} from './phase1a4aProbes';
import expected from './phase1a4aNodeExpected.json';

const CAMPAIGNS = ['phase1a4a-creation', 'phase1a4a-lifecycle', 'phase1a4a-compatibility', 'phase1a4a-invariants',
  'phase1a4a-atomicity', 'phase1a4a-unknown', 'phase1a4a-unknown-restart'];
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

export async function runPhase1A4A(campaign, d) {
  check(CAMPAIGNS.includes(campaign), 'Unrecognized 1a.4A campaign');
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
    check(reference !== undefined, 'Node reference missing: ' + label);
    const android = await operation();
    console.log('PHASE1A4A_CASE:' + JSON.stringify({campaign, label, fields: leaves(android)}));
    same(android, reference, label);
    fields += leaves(android);
    return {equalToNode: true, fields: leaves(android)};
  };
  if (campaign === 'phase1a4a-creation') {
    check(PHASE1A4A_CREATION_CASES.join() === Object.keys(expected.creation).join(), 'Node reference does not match the case list');
    for (const name of PHASE1A4A_CREATION_CASES)
      await d.record(name, () => compared(name, expected.creation[name])(() => runPhase1A4ACreation(database, name)));
  } else if (campaign === 'phase1a4a-lifecycle') {
    await d.record('lifecycle', () => compared('lifecycle', expected.lifecycle)(() => runPhase1A4ALifecycle(database, androidFaults.countWrites)));
  } else if (campaign === 'phase1a4a-compatibility') {
    await d.record('compatibility', () => compared('compatibility', expected.compatibility)(() => runPhase1A4ACompatibility(database)));
  } else if (campaign === 'phase1a4a-invariants') {
    await d.record('invariants', () => compared('invariants', expected.invariants)(() => runPhase1A4AInvariants(database)));
  } else if (campaign === 'phase1a4a-atomicity') {
    for (const name of PHASE1A4A_MATRICES) {
      const record = (label, operation) => d.record(label, () => compared(label, expected.atomicity[label])(operation));
      const writes = await runPhase1A4AMatrix(database, name, androidFaults, record);
      check(writes === expected.writes[name], `${name}: ${writes} writes, Node ${expected.writes[name]}`);
    }
  } else if (campaign === 'phase1a4a-unknown') {
    await d.record('unknown-no-retry', () => compared('unknown', expected.unknown)(() =>
      runPhase1A4AUnknown(database, lost => {global.__snapshotCommitLost = lost;})));
    return;
  } else {
    await d.record('persisted-once-after-unknown', () => compared('restart', expected.restart)(() => checkPhase1A4AAfterRestart(database)));
  }
  await d.record('equivalence-summary', async () => ({campaign, fieldsCompared: fields, differences: 0}));
}
