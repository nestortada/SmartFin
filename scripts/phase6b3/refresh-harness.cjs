'use strict';
// Rebuild-only helper: verifies the existing synthetic sources before refreshing test harness bytes.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..'), workspace = 'C:/sf-6b3-20261101';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (process.argv.length !== 2) throw Error('No arguments');
const record = JSON.parse(fs.readFileSync(path.join(workspace, 'source-fingerprints.json'), 'utf8'));
if (record.workspace !== workspace || record.packageId !== 'com.smartfin.snapshot5b2.tests') throw Error('Wrong workspace');
for (const [name, hash] of Object.entries(record.hashes)) {
  if (name.includes('..') || path.isAbsolute(name) || sha(fs.readFileSync(path.join(workspace, name))) !== hash) throw Error('Prepared input changed: ' + name);
}
// 6B.3.1 r2: the probes also pin the JS clock (device date leaked into the purchase reconciliation).
for (const [from, to] of [['scripts/phase6b3/androidHarness.js', 'phase6b3Harness.js'], ['scripts/phase6b3/probes.ts', 'phase6b3Probes.ts']]) {
  const original = fs.readFileSync(path.join(root, from));
  // Same import rewriting as prepare-android.cjs.
  const bytes = Buffer.from(original.toString().replaceAll("'../../src/", "'./src/").replaceAll("'../phase6b/probes'", "'./phase6bProbes'"));
  fs.writeFileSync(path.join(workspace, to), bytes);
  record.originalHashes[from] = sha(original);
  record.hashes[to] = sha(bytes);
}
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log('Synthetic harness refreshed; rebuild APK before running.');
