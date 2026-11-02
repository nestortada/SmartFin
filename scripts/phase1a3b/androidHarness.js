// Synthetic APK only (com.smartfin.snapshot5b2.tests). Phase 1a.3B campaigns on the real Android driver, with the
// probes of scripts/phase1a3b/probes.ts and the unchanged production migration, use cases and repositories. Every case
// must equal the Node reference (docs/validacion-fase1a3b/node/results.json) field by field, without tolerance:
// - phase1a3b-upgrade: synthetic version 4 database with history -> migration 5 in process; repeated runs are no-ops.
// - phase1a3b-startup-seed: leaves a version 4 database with history for the next process (no migration yet).
// - phase1a3b-startup-upgrade (PreserveData): openSmartFinDatabase at process start migrated it; state checked.
// - phase1a3b-upgrade-restart (PreserveData): another start does not migrate again; no duplicate revision.
// - phase1a3b-migration-atomicity: 15 migration statements failed before/after (30 points), exact version 4
//   state restored, next start recovers.
// - phase1a3b-integrity: CHECK, cents, triggers, references, sequence, append-only, reversals, recreation, history,
//   repositories in a shared scope and the financial wipe, on SQLite 3.9.2 (API 24) and the device SQLite (API 35).
// - phase1a3b-flows: create -> edit terms -> pay -> delete payment -> delete purchase on version 4 and version 5.
// r3: numeric text '100' in amount_cents must be rejected or stored as the exact INTEGER 100 (common criterion,
// compared); the observed outcome per engine is kept as evidence (r2: SQLite 3.53 accepts, 3.9.2 rejects).
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {
  checkPhase1A3BAfterRestart, checkPhase1A3BStartupUpgrade, PHASE1A3B_INTEGRITY_PROBES, PHASE1A3B_MIGRATION_FAULTS,
  runPhase1A3BFlows, runPhase1A3BIntegrityProbe, runPhase1A3BMigrationFault, runPhase1A3BUpgrade, seedPhase1A3BStartupUpgrade,
} from './phase1a3bProbes';
import expected from './phase1a3bNodeExpected.json';

const CAMPAIGNS = ['phase1a3b-upgrade', 'phase1a3b-startup-seed', 'phase1a3b-startup-upgrade', 'phase1a3b-upgrade-restart',
  'phase1a3b-migration-atomicity', 'phase1a3b-integrity', 'phase1a3b-flows'];
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
/** The managed proxy of the synthetic APK counts INSERT/UPDATE/DELETE/REPLACE; never fails here (write = MAX). */
async function countWrites(run) {
  const counter = {write: Number.MAX_SAFE_INTEGER, count: 0, phase: 'before'};
  global.__deletionFault = counter;
  try {await run();} finally {global.__deletionFault = undefined;}
  return counter.count;
}

export async function runPhase1A3B(campaign, d) {
  check(CAMPAIGNS.includes(campaign), 'Unrecognized 1a.3B campaign');
  await d.control.recoveryEnabled(false);
  await d.record('isolation', () => d.control.isolation());
  // At process start this runs applySchema and the versioned migrations: the start-up campaigns depend on it.
  const database = await openSmartFinDatabase();
  await d.record('runtime', async () => {
    check(!!global.HermesInternal, 'Hermes release required');
    const [version] = await database.executeSql('SELECT sqlite_version() AS version');
    // Reported, never compared: API 24 is expected to run SQLite 3.9.2.
    return {hermes: true, api: d.control.getConstants().api, sqliteVersion: version.rows.item(0).version};
  });
  let fields = 0;
  // r3: `engineObserved` (only the constraints probe) holds engine-specific evidence; it is recorded, never compared.
  // Everything else, including the common safety criterion of the numeric text case, is compared field by field.
  const compared = (label, reference) => async operation => {
    check(reference !== undefined, 'Node reference missing: ' + label);
    const {engineObserved, ...android} = await operation();
    const {engineObserved: nodeObserved, ...node} = reference;
    check((engineObserved === undefined) === (nodeObserved === undefined), 'Engine evidence present on one runtime only: ' + label);
    console.log('PHASE1A3B_CASE:' + JSON.stringify({campaign, label, fields: leaves(android), engineObserved}));
    same(android, node, label);
    fields += leaves(android);
    return {equalToNode: true, fields: leaves(android), ...(engineObserved !== undefined ? {engineObserved, nodeObserved} : {})};
  };
  if (campaign === 'phase1a3b-upgrade') {
    await d.record('upgrade', () => compared('upgrade', expected.upgrade)(() => runPhase1A3BUpgrade(database)));
  } else if (campaign === 'phase1a3b-startup-seed') {
    await d.record('version4-seeded', () => compared('startup.seed', expected.startup.seed)(() => seedPhase1A3BStartupUpgrade(database)));
  } else if (campaign === 'phase1a3b-startup-upgrade') {
    await d.record('migrated-at-start', () => compared('startup.upgrade', expected.startup.upgrade)(() => checkPhase1A3BStartupUpgrade(database)));
  } else if (campaign === 'phase1a3b-upgrade-restart') {
    await d.record('not-repeated-after-restart', () => compared('startup.restart', expected.startup.restart)(() => checkPhase1A3BAfterRestart(database)));
  } else if (campaign === 'phase1a3b-migration-atomicity') {
    const labels = PHASE1A3B_MIGRATION_FAULTS.flatMap(target => ['before', 'after'].map(phase => [target, phase]));
    check(labels.length === 30 && labels.map(([t, p]) => `${t} (${p})`).join() === Object.keys(expected.atomicity).join(),
      'Node reference does not match the fault list');
    for (const [target, phase] of labels) {
      const label = `${target} (${phase})`;
      await d.record(label, () => compared(label, expected.atomicity[label])(() => runPhase1A3BMigrationFault(database, target, phase)));
    }
  } else if (campaign === 'phase1a3b-integrity') {
    check(PHASE1A3B_INTEGRITY_PROBES.join() === Object.keys(expected.integrity).join(), 'Node reference does not match the probe list');
    for (const name of PHASE1A3B_INTEGRITY_PROBES)
      await d.record(name, () => compared(name, expected.integrity[name])(() => runPhase1A3BIntegrityProbe(database, name)));
  } else {
    await d.record('v4-v5-flows', () => compared('flows', expected.flows)(() => runPhase1A3BFlows(database, countWrites)));
  }
  await d.record('equivalence-summary', async () => ({campaign, fieldsCompared: fields, differences: 0}));
}
