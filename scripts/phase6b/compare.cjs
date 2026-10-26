// Phase 6B: compares the probe results of an Android campaign with the Node run, value by value.
// Usage: node scripts/phase6b/compare.cjs <api>. Writes docs/auditoria-fase6b/android/api<N>/compare.json.
const fs = require('node:fs'), path = require('node:path');
const api = process.argv[2];
if (!['24', '35'].includes(api)) throw Error('API 24 or 35 required');
const docs = path.resolve(__dirname, '../../docs/auditoria-fase6b');
const node = JSON.parse(fs.readFileSync(path.join(docs, 'node/probes.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(docs, `android/api${api}/probes/result.json`), 'utf8'));
const differences = [];
const walk = (a, b, at) => {
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], `${at}.${key}`);
  } else if (!Object.is(a, b)) differences.push({at, node: a, android: b});
};
const probes = {};
for (const c of report.cases.filter(c => c.name.startsWith('probe-'))) {
  const name = c.name.slice('probe-'.length);
  probes[name] = c.evidence.sqlite;
  walk(node[name], c.evidence.result, name);
}
const runtime = report.cases.find(c => c.name === 'runtime')?.evidence;
const result = {api, runtime, probes, compared: Object.keys(probes).length, identical: differences.length === 0, differences};
fs.writeFileSync(path.join(docs, `android/api${api}/compare.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({api, runtime, compared: result.compared, differences: differences.slice(0, 20)}, null, 1));
if (differences.length) process.exitCode = 1;
