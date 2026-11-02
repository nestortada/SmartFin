// Synthetic APK only (com.smartfin.snapshot5b2.tests). Phase 1a.2 campaign `phase1a2-statements`: the production
// use cases run the probes of scripts/phase1a2/probes.ts on the real Android driver; every probe also checks its
// independent BigInt oracle. Each observation must equal the Node reference field by field (no tolerance).
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {PHASE1A2_PROBES, runPhase1A2Probe} from './phase1a2Probes';
import expected from './phase1a2NodeExpected.json';
import {matrix} from './phase6b3Harness';

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
/** Number of leaf fields compared (the equivalence size reported per device). */
function leaves(value) {
  if (value && typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + leaves(item), 0);
  return 1;
}

export async function runPhase1A2(campaign, d) {
  if (campaign !== 'phase1a2-statements' && campaign !== 'phase1a2-atomicity-historical') throw Error('Unrecognized 1a.2 campaign');
  await d.control.recoveryEnabled(false);
  await d.record('isolation', () => d.control.isolation());
  await d.record('runtime', async () => {check(!!global.HermesInternal, 'Hermes release required'); return {hermes: true, api: d.control.getConstants().api};});
  // The 6B.3 rollback matrix with a pinned misaligned clock: the payment's cycle is history, so its statement is
  // never written (8 writes); every fault point must still be a confirmed rollback with the exact state restored.
  if (campaign === 'phase1a2-atomicity-historical') return matrix(await openSmartFinDatabase(), d.record, 'historical');
  check(PHASE1A2_PROBES.join() === Object.keys(expected.probes).join(), 'Node reference does not match the probe list');
  const database = await openSmartFinDatabase();
  let fields = 0;
  for (const name of PHASE1A2_PROBES) await d.record(name, async () => {
    const android = await runPhase1A2Probe(database, name);
    const reference = expected.probes[name];
    console.log('PHASE1A2_PROBE:' + JSON.stringify({name, fields: leaves(android)}));
    check(canonical(android) === canonical(reference), 'Android differs from Node: ' + name + ': ' + firstDifference(android, reference));
    fields += leaves(android);
    return {fields: leaves(android), equalToNode: true};
  });
  await d.record('equivalence-summary', async () => ({probes: PHASE1A2_PROBES.length, fieldsCompared: fields, differences: 0}));
}
