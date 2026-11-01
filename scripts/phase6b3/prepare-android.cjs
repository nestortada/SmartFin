'use strict';
// REVIEW ONLY until the owner approves preparation through the command guard.
// No adb, installs, dependency changes, database opens or compilation here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const source = 'C:/sf-6b2r-20261030';
const workspace = 'C:/sf-6b3-20261101';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (dir, file) => fs.readFileSync(path.join(dir, file));
if (process.argv.length !== 2) throw Error('No arguments authorized');
if (fs.existsSync(workspace)) throw Error('Destination must be new; no overwrite or cleanup');
const inventory = JSON.parse(read(root, 'docs/validacion-fase6b3-1/authorization/inputs.sha256.json'));
for (const [name, hash] of Object.entries(inventory.sources)) {
  // Guards may have been changed by their owner; this script must not certify or alter them.
  if (name.startsWith('.claude/') || name.startsWith('.codex/')) continue;
  if (sha(read(root, name)) !== hash) throw Error('Reviewed input changed: ' + name);
}
const attestation = read(source, 'source-fingerprints.json');
if (sha(attestation) !== 'df3e620bc751c36bb8f0c8fa51dd6061ddd87fd4c5555752f7cf8a62a5ae3388') throw Error('Unrecognized baseline attestation');
const record = JSON.parse(attestation);
if (record.packageId !== 'com.smartfin.snapshot5b2.tests' || record.workspace !== source) throw Error('Baseline identity mismatch');
if (sha(read(source, 'android/app/build/outputs/apk/release/app-release.apk')) !== '85af989be11c7a79c81e3b38c06905b4064f52648d5170f6a6ab1022ad0e42f6') throw Error('Baseline APK mismatch');
for (const [name, hash] of Object.entries(record.hashes)) {
  if (name.includes('..') || path.isAbsolute(name)) throw Error('Invalid baseline path');
  if (sha(read(source, name)) !== hash) throw Error('Baseline source changed: ' + name);
}
// Copy code/config only. Never carry financial files, keys, captures or generated builds.
const excluded = new Set(['node_modules', 'build', '.gradle', '.cxx', '.git', '.codex', '.claude', '.agents', 'docs']);
fs.cpSync(source, workspace, {recursive: true, filter(file) {
  const parts = path.relative(source, file).split(path.sep);
  return !parts.some(part => excluded.has(part)) && !/\.(?:db|sqlite|sqlite3)(?:-|$)|\.jks$/i.test(file);
}});
// Existing baseline debug.keystore is used by the inherited synthetic release configuration.
// The approved installed dependency tree is shared read-only by convention; no npm/install/postinstall.
fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
record.workspace = workspace;
const walk = dir => fs.readdirSync(path.join(root, dir), {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(dir + '/' + e.name) : [dir + '/' + e.name]);
for (const file of walk('src')) {
  const bytes = read(root, file);
  if (record.originalHashes[file] && record.hashes[file] !== record.originalHashes[file]) {
    if (sha(bytes) !== record.originalHashes[file]) throw Error('Adapted production input changed: ' + file);
    continue;
  }
  fs.mkdirSync(path.dirname(path.join(workspace, file)), {recursive: true});
  fs.writeFileSync(path.join(workspace, file), bytes);
  record.originalHashes[file] = record.hashes[file] = sha(bytes);
}
function write(file, text, reason, original) {
  fs.writeFileSync(path.join(workspace, file), text);
  record.hashes[file] = sha(text);
  record.adaptations[file] = reason;
  if (original) record.originalHashes[original] = sha(read(root, original));
}
for (const [from, to] of [
  ['scripts/phase6b3/androidHarness.js', 'phase6b3Harness.js'],
  ['scripts/phase6b3/probes.ts', 'phase6b3Probes.ts'],
  ['__tests__/helpers/pre6B3CreditCardRelations.ts', 'pre6B3CreditCardRelations.ts'],
  ['docs/correccion-fase6b3/node/results.json', 'phase6b3NodeExpected.json'],
  // Mandatory replacement: do not ship the stale 6A oracle from the restored 6B.2 APK.
  ['scripts/phase6a/androidHarness.js', 'phase6aHarness.js'],
]) write(to, read(root, from).toString().replaceAll("'../../src/", "'./src/")
  .replaceAll("'../phase6b/probes'", "'./phase6bProbes'"), '6B.3.1 reviewed harness / decimal oracle', from);
let harness = read(workspace, 'Harness.jsx').toString();
const anchor = 'async function run(campaign) {';
if (harness.split(anchor).length !== 2) throw Error('Harness dispatcher anchor changed');
harness = "import {runPhase6B3} from './phase6b3Harness';\n" + harness.replace(anchor,
  anchor + "\n  if(campaign.startsWith('phase6b3-')) { await runPhase6B3(campaign,{owned,seed,record,control,backup}); return; }");
write('Harness.jsx', harness, '6B.3 dispatcher; existing campaigns retained');
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(JSON.stringify({workspace, packageId: record.packageId, attestationSha256: sha(encoded), apkBuilt: false}));
