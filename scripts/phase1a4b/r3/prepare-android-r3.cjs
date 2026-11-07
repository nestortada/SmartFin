'use strict';
// Phase 1a.4B r3: prepares a NEW isolated synthetic workspace from the audited r1 one (the validated production code and
// harness). Copies files only: no adb, installs, dependency changes, database opens or compilation here.
// - Verifies r1 (attestation 5cbf8940…, APK e65e614a…) and every prepared r1 file against its attestation.
// - Verifies the r3 inventory and that the checkout matches every r1 pin except the promoted 1a.4B reference
//   (docs/validacion-fase1a4b/node/results.json, 1faa2192…, two backupRevision leaves; docs/validacion-fase1a4b/r3).
// - Incorporates ONLY the corrected reference: phase1a4bNodeExpected.json is regenerated exactly as r1 did and must differ
//   from r1 in exactly those two leaves; the other four Node parts must be byte-identical to r1. No harness, probe or
//   production file changes (no r2 diagnostic files are carried).
// - Writes a new attestation (phase '1a.4B r3'); build/ is never copied, so no earlier APK can be reused.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const base = 'C:/sf-1a4b-20261102';
const workspace = 'C:/sf-1a4b-r3-20261107';
const R1_ATTESTATION = '5cbf894058ec96319b88981dd9bf2433fd79d7456ef3fe7f802f48843b753f4c';
const R1_APK = 'e65e614ab5689f240047df4f5e30c5fc5bcd52b1ee90f6fbaaaf8869a06621b7';
const REFERENCE = 'docs/validacion-fase1a4b/node/results.json';
const REFERENCE_SHA256 = '1faa219207d86d95f7b55f3e3446243d3d6194bbd974e7018089e7acce41bd1b';
const ALLOWED = ['$.reversal.editAmount.observation.backupRevision:31->33', '$.guards.deletePurchase.observation.backupRevision:23->25'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (dir, file) => fs.readFileSync(path.join(dir, file));
if (process.argv.length !== 2) throw Error('No arguments authorized');
if (fs.existsSync(workspace)) throw Error('Destination must be new; no overwrite or cleanup');

const inventory = JSON.parse(read(root, 'docs/validacion-fase1a4b/r3/authorization/inputs.sha256.json'));
if (inventory.phase !== '1a.4B r3') throw Error('Not the r3 inventory');
for (const [name, hash] of Object.entries(inventory.sources)) {
  if (name.startsWith('.claude/') || name.startsWith('.codex/')) continue; // guards: owner-managed, never altered here
  if (sha(read(root, name)) !== hash) throw Error('Reviewed input changed since the r3 inventory: ' + name);
}
if (sha(read(root, REFERENCE)) !== REFERENCE_SHA256) throw Error('Not the promoted 1a.4B reference');

const identity = JSON.parse(read(root, 'docs/validacion-fase1a4b/authorization/apk-identity.json'));
const attestation = read(base, 'source-fingerprints.json');
if (sha(attestation) !== R1_ATTESTATION || identity.attestationSha256 !== R1_ATTESTATION) throw Error('Unrecognized r1 attestation');
if (sha(read(base, 'android/app/build/outputs/apk/release/app-release.apk')) !== R1_APK || identity.sha256 !== R1_APK) throw Error('r1 APK mismatch');
const record = JSON.parse(attestation);
if (record.packageId !== 'com.smartfin.snapshot5b2.tests' || record.workspace !== base || record.phase !== '1a.4B') throw Error('r1 identity mismatch');
for (const name of Object.keys(record.hashes)) {
  if (name.includes('..') || path.isAbsolute(name)) throw Error('Invalid r1 path');
  if (sha(read(base, name)) !== record.hashes[name]) throw Error('r1 prepared source changed: ' + name);
}
const drift = Object.entries(record.originalHashes).filter(([name, hash]) => sha(read(root, name)) !== hash).map(([name]) => name);
if (JSON.stringify(drift) !== JSON.stringify([REFERENCE])) throw Error('Checkout differs from r1 beyond the promoted reference: ' + drift.join(', '));

const excluded = new Set(['node_modules', 'build', '.gradle', '.cxx', '.git', '.codex', '.claude', '.agents', 'docs']);
fs.cpSync(base, workspace, {recursive: true, filter(file) {
  const parts = path.relative(base, file).split(path.sep);
  return !parts.some(part => excluded.has(part)) && !/\.(?:db|sqlite|sqlite3)(?:-|$)|\.jks$/i.test(file);
}});
fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
const r1Hashes = {...record.hashes};
record.workspace = workspace;
record.phase = '1a.4B r3';
record.r1 = {attestationSha256: R1_ATTESTATION, apkSha256: R1_APK, workspace: base};

// The five Node parts, generated exactly as scripts/phase1a4b/prepare-android.cjs (r1) did.
const reference = JSON.parse(read(root, REFERENCE));
const {probes, atomicity, writes, unknown, restart} = reference.phase1a3a;
const parts = [
  ['phase1a4bNodeExpected.json', reference.phase1a4b],
  ['phase1a4aNodeExpected.json', reference.phase1a4a],
  ['phase1a3bNodeExpected.json', reference.phase1a3b],
  ['phase1a3aNodeExpected.json', {probes, atomicity, writes, unknown, restart}],
  ['phase1a2NodeExpected.json', {probes: reference.phase1a2.probes}],
];
for (const [file, value] of parts) {
  const text = JSON.stringify({runtime: reference.runtime, ...value}, null, 2) + '\n';
  if (file !== 'phase1a4bNodeExpected.json') {
    if (sha(text) !== r1Hashes[file]) throw Error('Unchanged Node part differs from r1: ' + file);
    continue;
  }
  const before = JSON.parse(read(base, file));
  const after = JSON.parse(text);
  const differences = [];
  (function walk(a, b, at) {
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      if (JSON.stringify(Object.keys(a)) !== JSON.stringify(Object.keys(b))) differences.push(at + ':keys');
      for (const key of Object.keys(a)) walk(a[key], b[key], at + '.' + key);
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) differences.push(`${at}:${JSON.stringify(a)}->${JSON.stringify(b)}`);
  })(before, after, '$');
  if (JSON.stringify(differences.sort()) !== JSON.stringify([...ALLOWED].sort())) throw Error('1a.4B Node part differs beyond the two leaves: ' + differences.join(', '));
  if (after.reversal.editAmount.observation.backupRevision !== 33 || after.guards.deletePurchase.observation.backupRevision !== 25)
    throw Error('Corrected expectations missing');
  fs.writeFileSync(path.join(workspace, file), text);
  record.hashes[file] = sha(text);
  record.adaptations[file] = '1a.4B Node reference (part phase1a4b), r3: one new database per campaign (two backupRevision leaves)';
  record.originalHashes[REFERENCE] = REFERENCE_SHA256;
}

// Only phase1a4bNodeExpected.json differs from r1; the real 1a.4B code is active and the use case stays internal.
for (const [name, hash] of Object.entries(r1Hashes))
  if (name !== 'phase1a4bNodeExpected.json' && (record.hashes[name] !== hash || sha(read(workspace, name)) !== hash)) throw Error('r1 file changed: ' + name);
if (Object.keys(record.hashes).length !== Object.keys(r1Hashes).length) throw Error('Unexpected added file');
const manual = read(workspace, 'src/modules/transactions/useCases/saveManualTransaction.ts').toString();
if (!manual.includes('await reverseActivePaymentAllocations(') || !manual.includes('await requireNoActiveInstallmentAllocations(') ||
    !manual.includes('await recordInitialInstallmentRevision('))
  throw Error('1a.4B or 1a.4A step missing from the carried production code');
const walk = dir => fs.readdirSync(path.join(workspace, dir), {withFileTypes: true})
  .flatMap(entry => entry.isDirectory() ? walk(dir + '/' + entry.name) : [dir + '/' + entry.name]);
const users = walk('src').filter(file => /\.(tsx?|jsx?)$/.test(file) &&
  /extraordinaryInstallmentPayment|registerExtraordinaryInstallmentPayment/.test(read(workspace, file).toString()));
if (JSON.stringify(users) !== JSON.stringify(['src/modules/creditCards/useCases/extraordinaryInstallmentPayment.ts']))
  throw Error('The 1a.4B use case is referenced from production code: ' + users.join(', '));
for (const file of ['phase1a4bProbes.ts', 'phase1a4bHarness.js', 'phase1a3bProbes.ts']) {
  const text = read(workspace, file).toString();
  if (/jest\.|reverseActivePaymentAllocations: async|requireNoActiveInstallmentAllocations: async/.test(text)) throw Error('Neutralization found in ' + file);
}
const stillMismatched = Object.entries(record.originalHashes).filter(([name, hash]) => sha(read(root, name)) !== hash);
if (stillMismatched.length) throw Error('Checkout differs from attestation: ' + stillMismatched.map(([name]) => name).join(', '));

// Expected Android cases and failure points of the 1a.4B campaigns, from the corrected part and the r1 harness.
const p = reference.phase1a4b;
const rollbacks = Object.keys(p.atomicity).filter(label => label.includes('-rollback-')).length;
const newCases = {
  'phase1a4b-register': Object.keys(p.register).length + 3, 'phase1a4b-reversal': Object.keys(p.reversal).length + 3,
  'phase1a4b-guards': Object.keys(p.guards).length + 3, 'phase1a4b-idempotency': 1 + 3,
  'phase1a4b-atomicity': Object.keys(p.atomicity).length + 3, 'phase1a4b-unknown': 3, 'phase1a4b-unknown-restart': 4,
};
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(JSON.stringify({workspace, packageId: record.packageId, phase: record.phase, attestedFiles: Object.keys(record.hashes).length,
  changedFromR1: ['phase1a4bNodeExpected.json'], attestationSha256: sha(encoded), apkBuilt: false,
  expectations: {editAmount: p.reversal.editAmount.observation.backupRevision, deletePurchase: p.guards.deletePurchase.observation.backupRevision},
  newCampaignCases: newCases, newCases: Object.values(newCases).reduce((a, b) => a + b, 0), newFailurePoints: rollbacks,
  writes: p.writes}, null, 1));
