'use strict';
// Phase 1a.4A: prepares a NEW isolated synthetic workspace from the validated 1a.3B r5 one. Copies files only: no adb,
// installs, dependency changes, database opens or compilation here.
// - Verifies the 1a.3B r5 base (attestation and APK pinned in docs/validacion-fase1a3b/r5/authorization/apk-identity.json).
// - Verifies that every reviewed input still has the hash captured in docs/validacion-fase1a4a/authorization.
// - Copies code/config only, refreshes every production file under src/ from this checkout and pins its hash; the
//   synthetic database name of src/database/sqliteSchema.ts is re-applied over the checkout file.
// - Adds the 1a.4A harness and probes. The 1a.3A and 1a.3B harnesses stay byte for byte; the 1a.3B probes are the ones
//   derived by scripts/phase1a4a/derive-probes.cjs and both Node references come from docs/validacion-fase1a4a/node
//   (the current code writes revision 0). The 1a.2/6B.3/6A regression files and oracles are unchanged.
// - Writes a new attestation (phase '1a.4A'); no earlier attestation is reused.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const base = 'C:/sf-1a3b-r5-20261102';
const workspace = 'C:/sf-1a4a-20261102';
const BASE_ATTESTATION = '5ef8befd07803cf59505e7afc05cefa7f1b8ddf220beaff528e06fe2d1882433';
const BASE_APK = 'ec3f10125d95aca751e15e411e58b8a557b8a334b172af07c84b2c79ada2039a';
const SCHEMA = 'src/database/sqliteSchema.ts';
const PRODUCTION_NAME = "export const SMARTFIN_DATABASE_NAME = 'smartfin.db';";
const SYNTHETIC_NAME = "export const SMARTFIN_DATABASE_NAME = 'phase5b2_synthetic.db';";
const REFERENCE = 'docs/validacion-fase1a4a/node/results.json';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (dir, file) => fs.readFileSync(path.join(dir, file));
const once = (text, needle) => text.split(needle).length === 2;
if (process.argv.length !== 2) throw Error('No arguments authorized');
if (fs.existsSync(workspace)) throw Error('Destination must be new; no overwrite or cleanup');

const inventory = JSON.parse(read(root, 'docs/validacion-fase1a4a/authorization/inputs.sha256.json'));
if (inventory.phase !== '1a.4A') throw Error('Not the 1a.4A inventory');
for (const [name, hash] of Object.entries(inventory.sources)) {
  // Guards belong to their owner; this script neither certifies nor alters them.
  if (name.startsWith('.claude/') || name.startsWith('.codex/')) continue;
  if (sha(read(root, name)) !== hash) throw Error('Reviewed input changed: ' + name);
}

const identity = JSON.parse(read(root, 'docs/validacion-fase1a3b/r5/authorization/apk-identity.json'));
const attestation = read(base, 'source-fingerprints.json');
if (sha(attestation) !== BASE_ATTESTATION || sha(attestation) !== identity.attestationSha256) throw Error('Unrecognized 1a.3B r5 attestation');
if (sha(read(base, 'android/app/build/outputs/apk/release/app-release.apk')) !== BASE_APK || identity.sha256 !== BASE_APK) throw Error('1a.3B r5 APK mismatch');
const record = JSON.parse(attestation);
if (record.packageId !== 'com.smartfin.snapshot5b2.tests' || record.workspace !== base || record.phase !== '1a.3B r5') throw Error('Base identity mismatch');
for (const name of Object.keys(record.hashes)) {
  if (name.includes('..') || path.isAbsolute(name)) throw Error('Invalid base path');
  if (sha(read(base, name)) !== record.hashes[name]) throw Error('Base prepared source changed: ' + name);
}
// The previous adaptation of sqliteSchema.ts must be exactly the database name over the reviewed original.
const previousAdapted = read(base, SCHEMA).toString();
if (!once(previousAdapted, SYNTHETIC_NAME) || sha(previousAdapted.replace(SYNTHETIC_NAME, PRODUCTION_NAME)) !== record.originalHashes[SCHEMA])
  throw Error('Unexpected previous adaptation of ' + SCHEMA);

// Copy code/config only. Never carry financial files, keys, captures or generated builds.
const excluded = new Set(['node_modules', 'build', '.gradle', '.cxx', '.git', '.codex', '.claude', '.agents', 'docs']);
fs.cpSync(base, workspace, {recursive: true, filter(file) {
  const parts = path.relative(base, file).split(path.sep);
  return !parts.some(part => excluded.has(part)) && !/\.(?:db|sqlite|sqlite3)(?:-|$)|\.jks$/i.test(file);
}});
// The approved installed dependency tree is shared read-only by convention; no npm/install/postinstall.
fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
record.workspace = workspace;
record.phase = '1a.4A';

function write(file, text, reason, original) {
  fs.mkdirSync(path.dirname(path.join(workspace, file)), {recursive: true});
  fs.writeFileSync(path.join(workspace, file), text);
  record.hashes[file] = sha(text);
  record.adaptations[file] = reason;
  if (original) record.originalHashes[original] = sha(read(root, original));
}

const walk = dir => fs.readdirSync(path.join(root, dir), {withFileTypes: true})
  .flatMap(entry => entry.isDirectory() ? walk(dir + '/' + entry.name) : [dir + '/' + entry.name]);
let productionFiles = 0;
for (const file of walk('src')) {
  const bytes = read(root, file);
  if (file === SCHEMA) {
    const text = bytes.toString();
    if (!once(text, PRODUCTION_NAME)) throw Error('Production database name anchor changed in ' + SCHEMA);
    write(SCHEMA, text.replace(PRODUCTION_NAME, SYNTHETIC_NAME), 'Synthetic database name only (re-applied over the checkout schema)', SCHEMA);
    productionFiles++;
    continue;
  }
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
const phase1a4aSources = [
  'src/modules/creditCards/useCases/initialInstallmentRevision.ts', 'src/modules/transactions/useCases/saveManualTransaction.ts',
  'src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository.ts', 'src/modules/creditCards/types/InstallmentHistory.ts',
  'src/database/migrations.ts', 'src/modules/creditCards/database/installmentHistorySchema.ts',
];
for (const file of phase1a4aSources)
  if (record.hashes[file] !== sha(read(root, file))) throw Error('1a.4A production source not carried: ' + file);
if (!read(workspace, 'src/modules/transactions/useCases/saveManualTransaction.ts').toString().includes('recordInitialInstallmentRevision'))
  throw Error('Revision 0 step missing');

const rewrite = bytes => bytes.toString().replaceAll("'../../src/", "'./src/")
  .replaceAll("'../phase6b/probes'", "'./phase6bProbes'").replaceAll("'../phase1a2/probes'", "'./phase1a2Probes'");
const changedIn1a4a = new Set(['phase1a4aHarness.js', 'phase1a4aProbes.ts', 'phase1a3bProbes.ts']);
for (const [from, to, reason] of [
  ['scripts/phase1a4a/androidHarness.js', 'phase1a4aHarness.js', '1a.4A revision 0 harness'],
  ['scripts/phase1a4a/probes.ts', 'phase1a4aProbes.ts', '1a.4A probes and oracles shared with Node'],
  // 1a.3B: reviewed harness byte for byte; probes derived by derive-probes.cjs (integrity preparation and recreation).
  ['scripts/phase1a3b/androidHarness.js', 'phase1a3bHarness.js', '1a.3B migration 5 harness (unchanged)'],
  ['scripts/phase1a4a/phase1a3bProbes.ts', 'phase1a3bProbes.ts', '1a.3B probes derived for revision 0 (derive-probes.cjs)'],
  // 1a.3A / 1a.2 / 6B.3 / 6A: the reviewed files, refreshed byte for byte.
  ['scripts/phase1a3a/androidHarness.js', 'phase1a3aHarness.js', '1a.3A identity, atomicity and unknown harness (unchanged)'],
  ['scripts/phase1a3a/probes.ts', 'phase1a3aProbes.ts', '1a.3A probes and rollback oracle (unchanged)'],
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
]) {
  const text = rewrite(read(root, from));
  // Files that 1a.4A does not change must be byte-identical to what the 1a.3B r5 workspace already validated.
  if (!changedIn1a4a.has(to) && record.hashes[to] !== undefined && record.hashes[to] !== sha(text)) throw Error('Regression file changed: ' + from);
  write(to, text, reason, from);
}
// Node references of the current code: the three parts of the 1a.4A reference, under the names the harnesses import.
const reference = JSON.parse(read(root, REFERENCE));
const { probes, atomicity, writes, unknown, restart } = reference.phase1a3a;
for (const [to, value, reason] of [
  ['phase1a4aNodeExpected.json', reference.phase1a4a, '1a.4A Node reference (part phase1a4a)'],
  ['phase1a3bNodeExpected.json', reference.phase1a3b, '1a.3B campaigns on the 1a.4A code (part phase1a3b of the 1a.4A reference)'],
  ['phase1a3aNodeExpected.json', { probes, atomicity, writes, unknown, restart },
    '1a.3A campaigns on the 1a.4A code (part phase1a3a of the 1a.4A reference)'],
]) write(to, JSON.stringify({ runtime: reference.runtime, ...value }, null, 2) + '\n', reason, REFERENCE);

let harness = read(workspace, 'Harness.jsx').toString();
const anchor = 'async function run(campaign) {';
if (harness.split(anchor).length !== 2) throw Error('Harness dispatcher anchor changed');
if (!harness.includes("if(campaign.startsWith('phase1a3b-'))")) throw Error('1a.3B dispatcher missing from the base');
harness = "import {runPhase1A4A} from './phase1a4aHarness';\n" + harness.replace(anchor,
  anchor + "\n  if(campaign.startsWith('phase1a4a-')) { await runPhase1A4A(campaign,{owned,seed,record,control,backup}); return; }");
write('Harness.jsx', harness, '1a.4A dispatcher; existing campaigns retained');

// The runner refuses any checkout file that differs from the attestation: fail here instead of after a build.
const mismatched = Object.entries(record.originalHashes).filter(([name, hash]) => sha(read(root, name)) !== hash);
if (mismatched.length) throw Error('Checkout differs from attestation: ' + mismatched.map(([name]) => name).join(', '));
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(JSON.stringify({workspace, packageId: record.packageId, phase: record.phase, productionFiles,
  attestationSha256: sha(encoded), apkBuilt: false}));
