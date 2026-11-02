'use strict';
// Rebuild-only helper for the 1a.2 workspace (same pattern as scripts/phase6b3/refresh-harness.cjs). It verifies
// every prepared input before refreshing harness bytes. 1a.2 changed only the TypeScript type of
// reconcileCreditCardTransactions in scripts/phase6b1/probes.ts (the 6B.1 probes shipped in the bundle); the
// inherited attestation still pinned the old bytes, so the runner would refuse the checkout. Rebuild after this.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..'), workspace = 'C:/sf-1a2-20261101';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (process.argv.length !== 2) throw Error('No arguments');
const record = JSON.parse(fs.readFileSync(path.join(workspace, 'source-fingerprints.json'), 'utf8'));
if (record.workspace !== workspace || record.packageId !== 'com.smartfin.snapshot5b2.tests' || record.phase !== '1a.2') throw Error('Wrong workspace');
for (const [name, hash] of Object.entries(record.hashes)) {
  if (name.includes('..') || path.isAbsolute(name) || sha(fs.readFileSync(path.join(workspace, name))) !== hash) throw Error('Prepared input changed: ' + name);
}
// r2: the 6B.3 matrix pins the JS clock and exports itself for phase1a2-atomicity-historical.
for (const [from, to] of [['scripts/phase6b1/probes.ts', 'phase6b1Probes.ts'],
  ['scripts/phase6b3/androidHarness.js', 'phase6b3Harness.js'], ['scripts/phase1a2/androidHarness.js', 'phase1a2Harness.js']]) {
  const original = fs.readFileSync(path.join(root, from));
  // Same import rewriting as prepare-android.cjs.
  const bytes = Buffer.from(original.toString().replaceAll("'../../src/", "'./src/").replaceAll("'../phase6b/probes'", "'./phase6bProbes'"));
  fs.writeFileSync(path.join(workspace, to), bytes);
  record.originalHashes[from] = sha(original);
  record.hashes[to] = sha(bytes);
}
const mismatched = Object.entries(record.originalHashes).filter(([name, hash]) => sha(fs.readFileSync(path.join(root, name))) !== hash);
if (mismatched.length) throw Error('Checkout still differs from attestation: ' + mismatched.map(([name]) => name).join(', '));
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(JSON.stringify({refreshed: ['phase6b1Probes.ts', 'phase6b3Harness.js', 'phase1a2Harness.js'], attestationSha256: sha(encoded), rebuildRequired: true}));
