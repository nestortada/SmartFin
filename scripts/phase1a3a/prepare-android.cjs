'use strict';
// Phase 1a.3A: prepares a NEW isolated synthetic workspace from the validated 1a.2 r2 one. REVIEW ONLY until the
// owner authorizes it. No adb, installs, dependency changes, database opens or compilation here.
// - Verifies the 1a.2 r2 base (attestation and APK pinned in docs/validacion-fase1a2/authorization/apk-identity-r2.json).
// - Verifies that every reviewed input still has the hash captured in docs/validacion-fase1a3a/authorization.
// - Copies code/config only, refreshes every production file under src/ from this checkout and pins its hash.
// - Adds the 1a.3A harness, probes and Node reference, refreshes the 1a.2/6B.3/6A regression files byte for byte
//   (oracles unchanged) and writes a new attestation (phase '1a.3A'); no earlier attestation is reused.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const base = 'C:/sf-1a2-20261101';
const workspace = 'C:/sf-1a3a-20261102';
const BASE_ATTESTATION = 'b7e3bb6042e3d7a9536345ad78e53661e6ea2601285479493fd1134aa21ea039';
const BASE_APK = 'fb5898e12375b7365c63c2da02e4e4d0a1c3b34c87394317eec808c1670b4478';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (dir, file) => fs.readFileSync(path.join(dir, file));
if (process.argv.length !== 2) throw Error('No arguments authorized');
if (fs.existsSync(workspace)) throw Error('Destination must be new; no overwrite or cleanup');

const inventory = JSON.parse(read(root, 'docs/validacion-fase1a3a/authorization/inputs.sha256.json'));
for (const [name, hash] of Object.entries(inventory.sources)) {
  // Guards belong to their owner; this script neither certifies nor alters them.
  if (name.startsWith('.claude/') || name.startsWith('.codex/')) continue;
  if (sha(read(root, name)) !== hash) throw Error('Reviewed input changed: ' + name);
}

const identity = JSON.parse(read(root, 'docs/validacion-fase1a2/authorization/apk-identity-r2.json'));
const attestation = read(base, 'source-fingerprints.json');
if (sha(attestation) !== BASE_ATTESTATION || sha(attestation) !== identity.attestationSha256) throw Error('Unrecognized 1a.2 r2 attestation');
if (sha(read(base, 'android/app/build/outputs/apk/release/app-release.apk')) !== BASE_APK || identity.sha256 !== BASE_APK) throw Error('1a.2 r2 APK mismatch');
const record = JSON.parse(attestation);
if (record.packageId !== 'com.smartfin.snapshot5b2.tests' || record.workspace !== base || record.phase !== '1a.2') throw Error('Base identity mismatch');
for (const name of Object.keys(record.hashes)) {
  if (name.includes('..') || path.isAbsolute(name)) throw Error('Invalid base path');
  if (sha(read(base, name)) !== record.hashes[name]) throw Error('Base prepared source changed: ' + name);
}

// Copy code/config only. Never carry financial files, keys, captures or generated builds.
const excluded = new Set(['node_modules', 'build', '.gradle', '.cxx', '.git', '.codex', '.claude', '.agents', 'docs']);
fs.cpSync(base, workspace, {recursive: true, filter(file) {
  const parts = path.relative(base, file).split(path.sep);
  return !parts.some(part => excluded.has(part)) && !/\.(?:db|sqlite|sqlite3)(?:-|$)|\.jks$/i.test(file);
}});
// The approved installed dependency tree is shared read-only by convention; no npm/install/postinstall.
fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
record.workspace = workspace;
record.phase = '1a.3A';

const walk = dir => fs.readdirSync(path.join(root, dir), {withFileTypes: true})
  .flatMap(entry => entry.isDirectory() ? walk(dir + '/' + entry.name) : [dir + '/' + entry.name]);
let productionFiles = 0;
for (const file of walk('src')) {
  const bytes = read(root, file);
  // Production files adapted for the synthetic APK in earlier phases keep their reviewed adaptation, provided the
  // checkout still has the reviewed original bytes; a changed original stops the preparation.
  if (record.originalHashes[file] && record.hashes[file] !== record.originalHashes[file]) {
    if (sha(bytes) !== record.originalHashes[file]) throw Error('Adapted production input changed: ' + file);
    continue;
  }
  fs.mkdirSync(path.dirname(path.join(workspace, file)), {recursive: true});
  fs.writeFileSync(path.join(workspace, file), bytes);
  record.originalHashes[file] = record.hashes[file] = sha(bytes);
  productionFiles++;
}
const phase1a3aSources = ['src/database/saveSQLiteRowPreservingIdentity.ts', 'src/modules/creditCards/repositories/sqliteCreditCardRepository.ts'];
for (const file of phase1a3aSources) {
  if (record.hashes[file] !== sha(read(root, file))) throw Error('1a.3A production source not carried: ' + file);
}
if (/INSERT\s+OR\s+REPLACE\s+INTO/i.test(read(workspace, 'src/modules/creditCards/repositories/sqliteCreditCardRepository.ts').toString()))
  throw Error('Card repository still uses INSERT OR REPLACE');

function write(file, text, reason, original) {
  fs.writeFileSync(path.join(workspace, file), text);
  record.hashes[file] = sha(text);
  record.adaptations[file] = reason;
  if (original) record.originalHashes[original] = sha(read(root, original));
}
const rewrite = bytes => bytes.toString().replaceAll("'../../src/", "'./src/")
  .replaceAll("'../phase6b/probes'", "'./phase6bProbes'").replaceAll("'../phase1a2/probes'", "'./phase1a2Probes'");
for (const [from, to, reason] of [
  ['scripts/phase1a3a/androidHarness.js', 'phase1a3aHarness.js', '1a.3A identity, atomicity and unknown harness'],
  ['scripts/phase1a3a/probes.ts', 'phase1a3aProbes.ts', '1a.3A probes and rollback oracle shared with Node'],
  ['docs/validacion-fase1a3a/node/results.json', 'phase1a3aNodeExpected.json', '1a.3A Node reference'],
  // 1a.2 / 6B.3 / 6A regressions: the reviewed files, refreshed byte for byte (oracles unchanged).
  ['scripts/phase1a2/androidHarness.js', 'phase1a2Harness.js', '1a.2 statements harness (unchanged)'],
  ['scripts/phase1a2/probes.ts', 'phase1a2Probes.ts', '1a.2 probes and BigInt oracle (unchanged)'],
  ['docs/validacion-fase1a2/node/results.json', 'phase1a2NodeExpected.json', '1a.2 Node reference (unchanged)'],
  ['scripts/phase6b3/androidHarness.js', 'phase6b3Harness.js', '6B.3.1 reviewed harness / decimal oracle'],
  ['scripts/phase6b3/probes.ts', 'phase6b3Probes.ts', '6B.3.1 reviewed harness / decimal oracle'],
  ['__tests__/helpers/pre6B3CreditCardRelations.ts', 'pre6B3CreditCardRelations.ts', '6B.3.1 reviewed harness / decimal oracle'],
  ['docs/correccion-fase6b3/node/results.json', 'phase6b3NodeExpected.json', '6B.3.1 Node reference (unchanged)'],
  ['scripts/phase6a/androidHarness.js', 'phase6aHarness.js', '6B.3.1 reviewed harness / decimal oracle'],
  ['scripts/phase6b/probes.ts', 'phase6bProbes.ts', 'shared synthetic reset and decimal helpers'],
  ['scripts/phase6b1/probes.ts', 'phase6b1Probes.ts', '6B.1 probes and BigInt decimal oracle shared with Node'],
]) write(to, rewrite(read(root, from)), reason, from);

let harness = read(workspace, 'Harness.jsx').toString();
const anchor = 'async function run(campaign) {';
if (harness.split(anchor).length !== 2) throw Error('Harness dispatcher anchor changed');
if (!harness.includes("if(campaign.startsWith('phase1a2-'))")) throw Error('1a.2 dispatcher missing from the base');
harness = "import {runPhase1A3A} from './phase1a3aHarness';\n" + harness.replace(anchor,
  anchor + "\n  if(campaign.startsWith('phase1a3a-')) { await runPhase1A3A(campaign,{owned,seed,record,control,backup}); return; }");
write('Harness.jsx', harness, '1a.3A dispatcher; existing campaigns retained');

// The runner refuses any checkout file that differs from the attestation: fail here instead of after a build.
const mismatched = Object.entries(record.originalHashes).filter(([name, hash]) => sha(read(root, name)) !== hash);
if (mismatched.length) throw Error('Checkout differs from attestation: ' + mismatched.map(([name]) => name).join(', '));
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(JSON.stringify({workspace, packageId: record.packageId, phase: record.phase, productionFiles,
  attestationSha256: sha(encoded), apkBuilt: false}));
