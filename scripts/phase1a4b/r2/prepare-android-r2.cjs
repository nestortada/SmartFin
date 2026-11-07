'use strict';
// Phase 1a.4B r2 — DIAGNOSTIC workspace. Prepares a NEW isolated synthetic workspace from the audited r1 one. Copies files
// only: no adb, installs, dependency changes, database opens or compilation here.
// - Verifies r1: attestation 5cbf8940…, APK e65e614a… (pinned in docs/validacion-fase1a4b/authorization/apk-identity.json)
//   and every prepared file of the r1 workspace against its attestation.
// - Verifies the r2 inventory (docs/validacion-fase1a4b/r2/authorization) and that the checkout still matches every
//   production hash attested by r1 (the REAL 1a.4B code, unchanged; nothing under src/ is rewritten here).
// - Adds ONLY the diagnostic instrumentation: phase1a4bR2Diagnostic.ts, phase1a4bR2Harness.js, the Node diagnostic
//   reference (apkOrder part) and one dispatcher line for `phase1a4b-r2-`. Every r1 file stays byte-identical, including
//   phase1a4bProbes.ts and phase1a4bNodeExpected.json (the original 1a.4B oracle).
// - Writes a new attestation (phase '1a.4B r2-diagnostic'); build/ is never copied, so the r1 APK cannot be reused.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const base = 'C:/sf-1a4b-20261102';
const workspace = 'C:/sf-1a4b-r2b-20261106';
const R1_ATTESTATION = '5cbf894058ec96319b88981dd9bf2433fd79d7456ef3fe7f802f48843b753f4c';
const R1_APK = 'e65e614ab5689f240047df4f5e30c5fc5bcd52b1ee90f6fbaaaf8869a06621b7';
const NODE_DIAGNOSTIC = 'docs/validacion-fase1a4b/r2/node/diagnostic.json';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (dir, file) => fs.readFileSync(path.join(dir, file));
if (process.argv.length !== 2) throw Error('No arguments authorized');
if (fs.existsSync(workspace)) throw Error('Destination must be new; no overwrite or cleanup');

const inventory = JSON.parse(read(root, 'docs/validacion-fase1a4b/r2/authorization/inputs-b.sha256.json'));
if (inventory.phase !== '1a.4B r2-diagnostic') throw Error('Not the r2 inventory');
for (const [name, hash] of Object.entries(inventory.sources)) {
  if (name.startsWith('.claude/') || name.startsWith('.codex/')) continue; // guards: owner-managed, never altered here
  if (sha(read(root, name)) !== hash) throw Error('Reviewed input changed since the r2 inventory: ' + name);
}

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
const mismatched = Object.entries(record.originalHashes).filter(([name, hash]) => sha(read(root, name)) !== hash);
if (mismatched.length) throw Error('Checkout differs from the r1 attestation: ' + mismatched.map(([name]) => name).join(', '));

const excluded = new Set(['node_modules', 'build', '.gradle', '.cxx', '.git', '.codex', '.claude', '.agents', 'docs']);
fs.cpSync(base, workspace, {recursive: true, filter(file) {
  const parts = path.relative(base, file).split(path.sep);
  return !parts.some(part => excluded.has(part)) && !/\.(?:db|sqlite|sqlite3)(?:-|$)|\.jks$/i.test(file);
}});
fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
const r1Hashes = {...record.hashes};
record.workspace = workspace;
record.phase = '1a.4B r2-diagnostic';
record.attempt = 'b (driver SELECT 1 preamble separated in the trace; attempt 1: APK 5e68ea68…, attestation a93716e7…)';
record.r1 = {attestationSha256: R1_ATTESTATION, apkSha256: R1_APK, workspace: base};

function write(file, text, reason, originals) {
  fs.mkdirSync(path.dirname(path.join(workspace, file)), {recursive: true});
  fs.writeFileSync(path.join(workspace, file), text);
  record.hashes[file] = sha(text);
  record.adaptations[file] = reason;
  for (const original of originals) record.originalHashes[original] = sha(read(root, original));
}
const rewrite = bytes => bytes.toString().replaceAll("'../../../src/", "'./src/")
  .replaceAll("'../../phase6b/probes'", "'./phase6bProbes'").replaceAll("'../../phase1a2/probes'", "'./phase1a2Probes'");
const diagnostic = rewrite(read(root, 'scripts/phase1a4b/r2/editAmountDiagnostic.ts'));
if (/\.\.\//.test(diagnostic)) throw Error('Unresolved relative import in the diagnostic probe');
write('phase1a4bR2Diagnostic.ts', diagnostic, '1a.4B r2 diagnostic: staged editAmount, trace post-processing, comparators (no writes)',
  ['scripts/phase1a4b/r2/editAmountDiagnostic.ts']);
write('phase1a4bR2Harness.js', read(root, 'scripts/phase1a4b/r2/androidHarness.js').toString(),
  '1a.4B r2 diagnostic harness: native batch trace, all differences, failing verdict', ['scripts/phase1a4b/r2/androidHarness.js']);
const nodeDiagnostic = JSON.parse(read(root, NODE_DIAGNOSTIC));
write('phase1a4bR2NodeExpected.json', JSON.stringify({runtime: nodeDiagnostic.runtime, referenceSha256: nodeDiagnostic.referenceSha256,
  apkOrder: nodeDiagnostic.apkOrder}, null, 2) + '\n', 'Node diagnostic reference (part apkOrder, same case order)', [NODE_DIAGNOSTIC]);
// No neutralization; the harness sends no write or transaction control at all; the only literal writes of the diagnostic
// probe are the synthetic fixture statements copied verbatim from scripts/phase1a4b/probes.ts (seed).
const originalProbes = read(root, 'scripts/phase1a4b/probes.ts').toString();
const literalWrites = text => [...text.matchAll(/executeSql\(\s*(['"`])([\s\S]*?)\1/g)].map(match => match[2])
  .filter(sql => /^\s*(INSERT|UPDATE|DELETE|REPLACE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END|DROP|CREATE|ALTER)/i.test(sql));
for (const file of ['phase1a4bR2Diagnostic.ts', 'phase1a4bR2Harness.js']) {
  const text = read(workspace, file).toString();
  if (/jest\.|reverseActivePaymentAllocations: async|requireNoActiveInstallmentAllocations: async/.test(text))
    throw Error('Neutralization found in ' + file);
  const writes = literalWrites(text);
  if (file === 'phase1a4bR2Harness.js' ? writes.length > 0 : writes.some(sql => !originalProbes.includes(sql)))
    throw Error('Diagnostic write found in ' + file + ': ' + JSON.stringify(writes.filter(sql => !originalProbes.includes(sql))));
}

let harness = read(workspace, 'Harness.jsx').toString();
const anchor = "  if(campaign.startsWith('phase1a4b-')) {";
if (harness.split(anchor).length !== 2 || harness.includes('phase1a4b-r2-')) throw Error('Unexpected r1 dispatcher');
harness = "import {runPhase1A4BR2} from './phase1a4bR2Harness';\n" + harness.replace(anchor,
  "  if(campaign.startsWith('phase1a4b-r2-')) { await runPhase1A4BR2(campaign,{owned,seed,record,control,backup}); return; }\n" + anchor);
write('Harness.jsx', harness, '1a.4B r2 dispatcher line; r1 dispatcher and campaigns retained', []);

// Only the four r2 files differ from r1; the real 1a.4B code is active and the use case stays unexported.
const r2Files = new Set(['phase1a4bR2Diagnostic.ts', 'phase1a4bR2Harness.js', 'phase1a4bR2NodeExpected.json', 'Harness.jsx']);
for (const [name, hash] of Object.entries(r1Hashes))
  if (!r2Files.has(name) && (record.hashes[name] !== hash || sha(read(workspace, name)) !== hash)) throw Error('r1 file changed: ' + name);
for (const file of ['phase1a4bProbes.ts', 'phase1a4bNodeExpected.json', 'phase1a4bHarness.js'])
  if (sha(read(workspace, file)) !== r1Hashes[file]) throw Error('Original 1a.4B oracle or harness changed: ' + file);
const manual = read(workspace, 'src/modules/transactions/useCases/saveManualTransaction.ts').toString();
if (!manual.includes('await reverseActivePaymentAllocations(') || !manual.includes('await requireNoActiveInstallmentAllocations('))
  throw Error('1a.4B step missing from the carried production code');
for (const index of ['src/modules/creditCards/index.ts', 'src/modules/creditCards/useCases/index.ts'])
  if (/extraordinaryInstallmentPayment|ExtraordinaryInstallmentPayment/.test(read(workspace, index).toString()))
    throw Error('The 1a.4B use case must not be exported by ' + index);
const stillMismatched = Object.entries(record.originalHashes).filter(([name, hash]) => sha(read(root, name)) !== hash);
if (stillMismatched.length) throw Error('Checkout differs from attestation: ' + stillMismatched.map(([name]) => name).join(', '));

const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(JSON.stringify({workspace, packageId: record.packageId, phase: record.phase,
  attestedFiles: Object.keys(record.hashes).length, addedOrChanged: [...r2Files], attestationSha256: sha(encoded), apkBuilt: false}));
