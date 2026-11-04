// Synthetic APK only (com.smartfin.snapshot5b2.tests). Phase 1a.4B campaigns on the real Android driver, with the probes
// of scripts/phase1a4b/probes.ts and the REAL production use cases (nothing neutralized). Every case must equal the Node
// reference (docs/validacion-fase1a4b/node/results.json, part phase1a4b) field by field, without tolerance:
// - phase1a4b-register: simple, two payments, surplus and zero estimate, cents, lazy revision 0, rejections before writes.
// - phase1a4b-reversal: D6 for amount, source, card, date, type and mixed edits; descriptive edits; deletion; a later
//   pending revision; a later confirmed revision and the rejection of a new allocation before any write (decision C).
// - phase1a4b-guards: destructive changes to a purchase with an active allocation, raw cascade, reassignment.
// - phase1a4b-idempotency: command_id after repetition, edit and deletion; other data under the same command.
// - phase1a4b-atomicity: every write of register (18), lazy register (19), edit with reversal (13) and deletion with
//   reversal (29) before/after = 158 points, confirmed rollback, the exact state restored and a next transaction.
// - phase1a4b-unknown: lost COMMIT response of a registration, no retry, connection retired (data kept for the restart).
// - phase1a4b-unknown-restart (PreserveData): one payment and one allocation; the command replays without writes.
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {
  checkPhase1A4BAfterRestart, PHASE1A4B_GUARD_CASES, PHASE1A4B_MATRICES, PHASE1A4B_REGISTER_CASES, PHASE1A4B_REVERSAL_CASES,
  runPhase1A4BGuard, runPhase1A4BIdempotency, runPhase1A4BMatrix, runPhase1A4BRegister, runPhase1A4BReversal, runPhase1A4BUnknown,
} from './phase1a4bProbes';
import expected from './phase1a4bNodeExpected.json';

const CAMPAIGNS = ['phase1a4b-register', 'phase1a4b-reversal', 'phase1a4b-guards', 'phase1a4b-idempotency',
  'phase1a4b-atomicity', 'phase1a4b-unknown', 'phase1a4b-unknown-restart'];
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

export async function runPhase1A4B(campaign, d) {
  check(CAMPAIGNS.includes(campaign), 'Unrecognized 1a.4B campaign');
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
    console.log('PHASE1A4B_CASE:' + JSON.stringify({campaign, label, fields: leaves(android)}));
    same(android, reference, label);
    fields += leaves(android);
    return {equalToNode: true, fields: leaves(android)};
  };
  const cases = (names, part, run) => {
    check(names.join() === Object.keys(expected[part]).join(), `Node reference does not match the ${part} case list`);
    return names.reduce((previous, name) => previous.then(() =>
      d.record(name, () => compared(`${part}.${name}`, expected[part][name])(() => run(name)))), Promise.resolve());
  };
  if (campaign === 'phase1a4b-register') {
    await cases(PHASE1A4B_REGISTER_CASES, 'register', name => runPhase1A4BRegister(database, name, androidFaults.countWrites));
  } else if (campaign === 'phase1a4b-reversal') {
    await cases(PHASE1A4B_REVERSAL_CASES, 'reversal', name => runPhase1A4BReversal(database, name, androidFaults.countWrites));
  } else if (campaign === 'phase1a4b-guards') {
    await cases(PHASE1A4B_GUARD_CASES, 'guards', name => runPhase1A4BGuard(database, name));
  } else if (campaign === 'phase1a4b-idempotency') {
    await d.record('idempotency', () => compared('idempotency', expected.idempotency)(() =>
      runPhase1A4BIdempotency(database, androidFaults.countWrites)));
  } else if (campaign === 'phase1a4b-atomicity') {
    for (const name of PHASE1A4B_MATRICES) {
      const record = (label, operation) => d.record(label, () => compared(label, expected.atomicity[label])(operation));
      const writes = await runPhase1A4BMatrix(database, name, androidFaults, record);
      check(writes === expected.writes[name], `${name}: ${writes} writes, Node ${expected.writes[name]}`);
    }
  } else if (campaign === 'phase1a4b-unknown') {
    // unknown is recorded as unknown: never a rollback, never retried.
    await d.record('unknown-no-retry', () => compared('unknown', expected.unknown)(() =>
      runPhase1A4BUnknown(database, lost => {global.__snapshotCommitLost = lost;})));
    return;
  } else {
    await d.record('persisted-once-after-unknown', () => compared('restart', expected.restart)(() =>
      checkPhase1A4BAfterRestart(database, androidFaults.countWrites)));
  }
  await d.record('equivalence-summary', async () => ({campaign, fieldsCompared: fields, differences: 0}));
}
