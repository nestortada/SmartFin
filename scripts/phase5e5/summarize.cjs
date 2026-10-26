// Summarizes the 5E.5 Android campaigns (both serials) into summary.json / summary.md.
// Reads only result.json files written by the synthetic APK runner.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../docs/recuperabilidad-fase5e5/android');
const summary = {};
for (const api of ['api24', 'api35']) {
  const dir = path.join(root, api);
  if (!fs.existsSync(dir)) continue;
  summary[api] = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name, 'result.json');
    const error = path.join(dir, name, 'runner-error.txt');
    if (!fs.existsSync(file)) { summary[api][name] = { passed: false, error: fs.existsSync(error) ? fs.readFileSync(error, 'utf8').trim() : 'no result' }; continue; }
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    const environment = JSON.parse(fs.readFileSync(path.join(dir, name, 'environment.json'), 'utf8').replace(/^﻿/, ''));
    summary[api][name] = { passed: !!result.passed, cases: result.cases.length, failed: result.cases.filter(c => !c.passed).map(c => c.name),
      failure: result.failure || undefined, apkSha256: environment.apkSha256, model: environment.model, api: environment.api };
    const pick = (caseName) => result.cases.find(c => c.name === caseName)?.evidence;
    if (name.startsWith('recoverability-')) Object.assign(summary[api][name], {
      seed: pick('integrated-scenario-and-representative-history'),
      g1: pick('publish-g1-protocol-v2') && { ...pick('publish-g1-protocol-v2'), status: undefined },
      settled: pick('original-snapshot-g1')?.settled, orderProbe: pick('annual-csv-order-probe') });
    if (name === 'epochs') Object.assign(summary[api][name], {
      historical: pick('old-generation-recognized-historical-with-local-metadata')?.datasetCurrency,
      reactivation: pick('old-publication-recovery-cannot-reactivate-deleted-data'),
      newEpoch: pick('new-epoch-generation-current-old-stays-historical'),
      withoutLocalMetadata: pick('missing-local-metadata-is-unknown-not-current')?.datasetCurrency });
    if (name === 'failures') summary[api][name].matrix = result.cases.filter(c => c.name !== 'isolation')
      .map(c => ({ case: c.name, passed: c.passed, selected: c.evidence?.status?.generationId ? 'G1' : undefined }));
  }
}
const apks = new Set(Object.values(summary).flatMap(a => Object.values(a).map(c => c.apkSha256).filter(Boolean)));
fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify({ apkSha256: [...apks], summary }, null, 2));
const lines = ['| Campaña | API 24 | HONOR API 35 |', '|---|---|---|'];
const names = [...new Set(Object.values(summary).flatMap(a => Object.keys(a)))].sort();
const cell = c => !c ? '—' : c.passed ? `✓ ${c.cases}` : `✗ ${c.failed?.join(', ') || c.error || c.failure}`;
for (const name of names) lines.push(`| ${name} | ${cell(summary.api24?.[name])} | ${cell(summary.api35?.[name])} |`);
fs.writeFileSync(path.join(root, 'summary.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log('APK', [...apks].join(', '));
