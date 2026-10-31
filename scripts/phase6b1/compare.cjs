// Phase 6B.1: compares an Android campaign with the Node run, value by value (no tolerance).
// Usage: node scripts/phase6b1/compare.cjs <api>. Writes docs/correccion-fase6b1/android/api<N>/compare.json.
// - phase6b1-probes: every 6B.1 probe, frozen pre-6B.1 and production, against node/results.json.
// - phase6b-probes (6B probes on the corrected code): against node/probes-6b-after-fix.json.
// - phase6b1-volume-*: card debts and oracle cents against the Node representative volumes.
const fs = require('node:fs'), path = require('node:path');
const api = process.argv[2];
if (!['24', '35'].includes(api)) throw Error('API 24 or 35 required');
const docs = path.resolve(__dirname, '../../docs/correccion-fase6b1');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const node = read(path.join(docs, 'node/results.json'));
const node6b = read(path.join(docs, 'node/probes-6b-after-fix.json'));
const differences = [];
const walk = (a, b, at) => {
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], `${at}.${key}`);
  } else if (!Object.is(a, b)) differences.push({at, node: a, android: b});
};
const campaign = name => {
  const file = path.join(docs, `android/api${api}/${name}/result.json`);
  return fs.existsSync(file) ? read(file) : undefined;
};
const compared = {};
const probes = campaign('probes');
if (probes) for (const c of probes.cases.filter(c => c.name.startsWith('probe-'))) {
  const name = c.name.slice('probe-'.length);
  walk(node.probes[name], c.evidence.result, `6B.1.${name}`);
  compared[`6B.1.${name}`] = c.evidence.sqlite;
}
const probes6b = campaign('probes-6b');
if (probes6b) for (const c of probes6b.cases.filter(c => c.name.startsWith('probe-'))) {
  const name = c.name.slice('probe-'.length);
  walk(node6b[name], c.evidence.result, `6B.${name}`);
  compared[`6B.${name}`] = c.evidence.sqlite;
}
for (const key of Object.keys(node.volume ?? {})) {
  const report = campaign(`volume-${key}`);
  if (!report) continue;
  const evidence = report.cases.find(c => c.name === `volume-${key}`)?.evidence;
  const nodeVolume = node.volume[key];
  walk(nodeVolume.oracle, evidence.oracle, `volume-${key}.oracle`);
  walk(nodeVolume.nextDebts.map(d => ({id: d.id, debt: String(d.debt)})), evidence.debts.next, `volume-${key}.next`);
  walk(nodeVolume.previousDebts.map(d => ({id: d.id, debt: String(d.debt)})), evidence.debts.previous, `volume-${key}.previous`);
  compared[`volume-${key}`] = evidence.sqlite;
}
const runtime = (probes ?? probes6b)?.cases.find(c => c.name === 'runtime')?.evidence;
const result = {api, runtime, compared, count: Object.keys(compared).length, identical: differences.length === 0, differences};
fs.writeFileSync(path.join(docs, `android/api${api}/compare.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({api, runtime, count: result.count, differences: differences.slice(0, 20)}, null, 1));
if (differences.length) process.exitCode = 1;
