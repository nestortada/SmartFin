'use strict';
// Phase 1a.4B: prepares a NEW isolated synthetic workspace from the audited and approved 1a.4A r2 one. Copies files only:
// no adb, installs, dependency changes, database opens or compilation here. Derived from
// scripts/phase1a4a/prepare-android-r2.cjs.
// - Verifies the r2 base (attestation and APK pinned in docs/validacion-fase1a4a/r2/authorization/apk-identity.json).
// - Verifies that every reviewed input still has the hash captured in docs/validacion-fase1a4b/authorization.
// - Copies code/config only, refreshes every production file under src/ from this checkout (the REAL 1a.4B logic, no
//   neutralization) and pins its hash; the synthetic database name of src/database/sqliteSchema.ts is re-applied.
// - Adds the 1a.4B harness and probes and the dispatcher line; replaces the 1a.3B probes with the ones derived by
//   scripts/phase1a4b/derive-probes.cjs. Every other harness and probe must be byte-identical to the r2 base.
// - Node references of the current code: the five parts of docs/validacion-fase1a4b/node/results.json.
// - Writes a new attestation (phase '1a.4B'); no earlier attestation or APK is reused (build/ is never copied).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const base = 'C:/sf-1a4a-r2-20261102';
const workspace = 'C:/sf-1a4b-20261102';
const BASE_ATTESTATION = '286642b3482d6b9b9baa3ebbec3b047697fb941f862c54ce2e06580786112465';
const BASE_APK = 'a3cba3a8233d245f24b715ec896eacf05cce58a122071ea164810770b7ba29ae';
const SCHEMA = 'src/database/sqliteSchema.ts';
const PRODUCTION_NAME = "export const SMARTFIN_DATABASE_NAME = 'smartfin.db';";
const SYNTHETIC_NAME = "export const SMARTFIN_DATABASE_NAME = 'phase5b2_synthetic.db';";
const REFERENCE = 'docs/validacion-fase1a4b/node/results.json';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (dir, file) => fs.readFileSync(path.join(dir, file));
const once = (text, needle) => text.split(needle).length === 2;
if (process.argv.length !== 2) throw Error('No arguments authorized');
if (fs.existsSync(workspace)) throw Error('Destination must be new; no overwrite or cleanup');

const inventory = JSON.parse(read(root, 'docs/validacion-fase1a4b/authorization/inputs.sha256.json'));
if (inventory.phase !== '1a.4B') throw Error('Not the 1a.4B inventory');
for (const [name, hash] of Object.entries(inventory.sources)) {
  // Guards belong to their owner; this script neither certifies nor alters them.
  if (name.startsWith('.claude/') || name.startsWith('.codex/')) continue;
  if (sha(read(root, name)) !== hash) throw Error('Reviewed input changed: ' + name);
}

const identity = JSON.parse(read(root, 'docs/validacion-fase1a4a/r2/authorization/apk-identity.json'));
const attestation = read(base, 'source-fingerprints.json');
if (sha(attestation) !== BASE_ATTESTATION || sha(attestation) !== identity.attestationSha256) throw Error('Unrecognized 1a.4A r2 attestation');
if (sha(read(base, 'android/app/build/outputs/apk/release/app-release.apk')) !== BASE_APK || identity.sha256 !== BASE_APK) throw Error('1a.4A r2 APK mismatch');
const record = JSON.parse(attestation);
if (record.packageId !== 'com.smartfin.snapshot5b2.tests' || record.workspace !== base || record.phase !== '1a.4A r2') throw Error('Base identity mismatch');
for (const name of Object.keys(record.hashes)) {
  if (name.includes('..') || path.isAbsolute(name)) throw Error('Invalid base path');
  if (sha(read(base, name)) !== record.hashes[name]) throw Error('Base prepared source changed: ' + name);
}
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
record.phase = '1a.4B';

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
  if (record.originalHashes[file] && record.hashes[file] !== record.originalHashes[file]) {
    if (sha(bytes) !== record.originalHashes[file]) throw Error('Adapted production input changed: ' + file);
    continue;
  }
  fs.mkdirSync(path.dirname(path.join(workspace, file)), {recursive: true});
  fs.writeFileSync(path.join(workspace, file), bytes);
  record.originalHashes[file] = record.hashes[file] = sha(bytes);
  productionFiles++;
}
const phase1a4bSources = [
  'src/modules/creditCards/useCases/extraordinaryInstallmentPayment.ts', 'src/modules/creditCards/useCases/installmentAllocationLedger.ts',
  'src/modules/creditCards/useCases/installmentAllocationReversal.ts', 'src/modules/creditCards/useCases/initialInstallmentRevision.ts',
  'src/modules/creditCards/useCases/creditCardTransactionRelations.ts', 'src/modules/transactions/useCases/saveManualTransaction.ts',
  'src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository.ts', 'src/modules/creditCards/types/InstallmentHistory.ts',
  'src/database/migrations.ts', 'src/modules/creditCards/database/installmentHistorySchema.ts',
];
for (const file of phase1a4bSources)
  if (record.hashes[file] !== sha(read(root, file))) throw Error('1a.4B production source not carried: ' + file);
const manual = read(workspace, 'src/modules/transactions/useCases/saveManualTransaction.ts').toString();
if (!manual.includes('await reverseActivePaymentAllocations(') || !manual.includes('await requireNoActiveInstallmentAllocations(') ||
    !manual.includes('await recordInitialInstallmentRevision('))
  throw Error('1a.4B or 1a.4A step missing from the carried production code');
for (const index of ['src/modules/creditCards/index.ts', 'src/modules/creditCards/useCases/index.ts'])
  if (/extraordinaryInstallmentPayment|ExtraordinaryInstallmentPayment/.test(read(workspace, index).toString()))
    throw Error('The 1a.4B use case must not be exported by ' + index);

const rewrite = bytes => bytes.toString().replaceAll("'../../src/", "'./src/")
  .replaceAll("'../phase6b/probes'", "'./phase6bProbes'").replaceAll("'../phase1a2/probes'", "'./phase1a2Probes'");
const changedIn1a4b = new Set(['phase1a4bHarness.js', 'phase1a4bProbes.ts', 'phase1a3bProbes.ts']);
for (const [from, to, reason] of [
  ['scripts/phase1a4b/androidHarness.js', 'phase1a4bHarness.js', '1a.4B extraordinary payment harness'],
  ['scripts/phase1a4b/probes.ts', 'phase1a4bProbes.ts', '1a.4B probes and oracles shared with Node (real logic)'],
  ['scripts/phase1a4b/phase1a3bProbes.ts', 'phase1a3bProbes.ts', '1a.3B probes derived for 1a.4B (derive-probes.cjs: D6 guard, version 4 flows)'],
  // Unchanged against the r2 base, refreshed byte for byte.
  ['scripts/phase1a4a/androidHarness.js', 'phase1a4aHarness.js', '1a.4A revision 0 harness (unchanged)'],
  ['scripts/phase1a4a/probes.ts', 'phase1a4aProbes.ts', '1a.4A probes and oracles (unchanged)'],
  ['scripts/phase1a3b/androidHarness.js', 'phase1a3bHarness.js', '1a.3B migration 5 harness (unchanged)'],
  ['scripts/phase1a3a/androidHarness.js', 'phase1a3aHarness.js', '1a.3A identity, atomicity and unknown harness (unchanged)'],
  ['scripts/phase1a3a/probes.ts', 'phase1a3aProbes.ts', '1a.3A probes and rollback oracle (unchanged)'],
  ['scripts/phase1a2/androidHarness.js', 'phase1a2Harness.js', '1a.2 statements harness (unchanged)'],
  ['scripts/phase1a2/probes.ts', 'phase1a2Probes.ts', '1a.2 probes and BigInt oracle (unchanged)'],
  ['scripts/phase6b3/androidHarness.js', 'phase6b3Harness.js', '6B.3.1 reviewed harness / decimal oracle'],
  ['scripts/phase6b3/probes.ts', 'phase6b3Probes.ts', '6B.3.1 reviewed harness / decimal oracle'],
  ['__tests__/helpers/pre6B3CreditCardRelations.ts', 'pre6B3CreditCardRelations.ts', '6B.3.1 reviewed harness / decimal oracle'],
  ['docs/correccion-fase6b3/node/results.json', 'phase6b3NodeExpected.json', '6B.3.1 Node reference (unchanged)'],
  ['scripts/phase6a/androidHarness.js', 'phase6aHarness.js', '6B.3.1 reviewed harness / decimal oracle'],
  ['scripts/phase6b/probes.ts', 'phase6bProbes.ts', 'shared synthetic reset and decimal helpers'],
  ['scripts/phase6b1/probes.ts', 'phase6b1Probes.ts', '6B.1 probes and BigInt decimal oracle shared with Node'],
]) {
  const text = rewrite(read(root, from));
  if (!changedIn1a4b.has(to) && record.hashes[to] !== undefined && record.hashes[to] !== sha(text)) throw Error('Regression file changed: ' + from);
  write(to, text, reason, from);
}
for (const file of ['phase1a4bProbes.ts', 'phase1a3bProbes.ts', 'phase1a4bHarness.js']) {
  const text = read(workspace, file).toString();
  if (/jest\.|reverseActivePaymentAllocations: async|requireNoActiveInstallmentAllocations: async/.test(text))
    throw Error('Neutralization found in ' + file);
}
// Node references of the 1a.4B code, under the names the harnesses import.
const reference = JSON.parse(read(root, REFERENCE));
const { probes, atomicity, writes, unknown, restart } = reference.phase1a3a;
for (const [to, value, reason] of [
  ['phase1a4bNodeExpected.json', reference.phase1a4b, '1a.4B Node reference (part phase1a4b)'],
  ['phase1a4aNodeExpected.json', reference.phase1a4a, '1a.4A campaigns on the 1a.4B code (part phase1a4a; equal to the r2 part)'],
  ['phase1a3bNodeExpected.json', reference.phase1a3b, '1a.3B campaigns on the 1a.4B code (derived probes; part phase1a3b)'],
  ['phase1a3aNodeExpected.json', { probes, atomicity, writes, unknown, restart }, '1a.3A campaigns on the 1a.4B code (part phase1a3a; equal to the r2 part)'],
  ['phase1a2NodeExpected.json', { probes: reference.phase1a2.probes }, '1a.2 statements on the 1a.4B code (part phase1a2; equal to the r2 part)'],
]) write(to, JSON.stringify({ runtime: reference.runtime, ...value }, null, 2) + '\n', reason, REFERENCE);

let harness = read(workspace, 'Harness.jsx').toString();
const anchor = 'async function run(campaign) {';
if (harness.split(anchor).length !== 2) throw Error('Harness dispatcher anchor changed');
if (!harness.includes("if(campaign.startsWith('phase1a4a-'))") || harness.includes('phase1a4b-')) throw Error('Unexpected r2 dispatcher');
harness = "import {runPhase1A4B} from './phase1a4bHarness';\n" + harness.replace(anchor,
  anchor + "\n  if(campaign.startsWith('phase1a4b-')) { await runPhase1A4B(campaign,{owned,seed,record,control,backup}); return; }");
write('Harness.jsx', harness, '1a.4B dispatcher; existing campaigns retained');

const mismatched = Object.entries(record.originalHashes).filter(([name, hash]) => sha(read(root, name)) !== hash);
if (mismatched.length) throw Error('Checkout differs from attestation: ' + mismatched.map(([name]) => name).join(', '));
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(JSON.stringify({workspace, packageId: record.packageId, phase: record.phase, productionFiles,
  attestedFiles: Object.keys(record.hashes).length, attestationSha256: sha(encoded), apkBuilt: false}));
