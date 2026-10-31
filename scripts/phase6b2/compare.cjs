// Phase 6B.2: compares an Android campaign with the Node run, value by value (no tolerance).
// Usage: node scripts/phase6b2/compare.cjs <api>. Writes docs/correccion-fase6b2/android/api<N>/compare.json.
// - phase6b2-probes: every 6B.2 probe (frozen pre-6B.2 and production dashboards) against node/results.json.
// - phase6b2-volume-*: aggregate and monthly figures of the representative volumes against Node.
// Intl strings are reported, not compared: they are platform data (see the report).
const fs = require('node:fs'), path = require('node:path');
const api = process.argv[2];
if (!['24', '35'].includes(api)) throw Error('API 24 or 35 required');
const docs = path.resolve(__dirname, '../../docs/correccion-fase6b2');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const node = read(path.join(docs, 'node/results.json'));
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
  walk(node.probes[name], c.evidence.result, `6B.2.${name}`);
  compared[`6B.2.${name}`] = c.evidence.sqlite;
}
for (const size of Object.keys(node.volume ?? {})) {
  const report = campaign(`volume-${size}`);
  if (!report) continue;
  const evidence = report.cases.find(c => c.name === `volume-${size}`)?.evidence;
  for (const variant of ['pesos', 'cents']) walk(node.volume[size][variant].next, evidence[variant].next, `volume-${size}.${variant}.next`);
  walk(node.volume[size].cents.previous, evidence.cents.previous, `volume-${size}.cents.previous`);
  compared[`volume-${size}`] = evidence.sqlite;
}
// Previous phases' probes on the 6B.2 code against their Node run on the same code (saved from Jest).
for (const [folder, file, label] of [['regression-6b1-probes', 'probes-6b1-on-6b2.json', '6B.1'], ['regression-6b-probes', 'probes-6b-on-6b2.json', '6B']]) {
  const report = campaign(folder);
  if (!report) continue;
  const saved = read(path.join(docs, 'node', file));
  for (const c of report.cases.filter(c => c.name.startsWith('probe-'))) {
    const name = c.name.slice('probe-'.length);
    if (label === '6B.1') {
      for (const side of ['previous', 'next']) {
        const nodeSide = {...saved.probes[name][side]};
        delete nodeSide.trace;
        walk(nodeSide, c.evidence.result[side], `${label}.${name}.${side}`);
      }
    } else walk(saved[name], c.evidence.result, `${label}.${name}`);
    compared[`${label}.${name}`] = c.evidence.sqlite;
  }
}
const runtime = probes?.cases.find(c => c.name === 'runtime')?.evidence;
const result = {api, runtime, nodeIntl: node.intl, compared, count: Object.keys(compared).length, identical: differences.length === 0, differences};
fs.writeFileSync(path.join(docs, `android/api${api}/compare.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({api, runtime, count: result.count, differences: differences.slice(0, 20)}, null, 1));
if (differences.length) process.exitCode = 1;
