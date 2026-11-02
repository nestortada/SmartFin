'use strict';
// Records the identity of the NEW 1a.3A synthetic APK after an authorized build, before any install. Reads files
// only: no adb, Gradle or runner. The runner (run-android.ps1) refuses an APK or attestation that differs from this
// record and checks that the APK embeds exactly this attestation. Earlier APKs and attestations are rejected.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const workspace = 'C:/sf-1a3a-20261102';
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (process.argv.length !== 2) throw Error('No arguments');
const output = path.join(root, 'docs/validacion-fase1a3a/authorization/apk-identity.json');
if (fs.existsSync(output)) throw Error('APK identity already recorded; do not overwrite');
const apk = path.join(workspace, 'android/app/build/outputs/apk/release/app-release.apk');
const attestationFile = path.join(workspace, 'source-fingerprints.json');
const embeddedCopy = path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json');
const record = JSON.parse(fs.readFileSync(attestationFile, 'utf8'));
if (record.packageId !== 'com.smartfin.snapshot5b2.tests' || record.workspace !== workspace || record.phase !== '1a.3A') throw Error('Not the 1a.3A attestation');
const previousAttestations = {
  '1352b7ddcb306df8ca5146899e1a5f66c089abb271833893d5870198720c0730': '6B.3',
  'a4a437d3fc8f0dcc00641231363ce5ca22f387efec29afd6cf5b79be4fcfa4e2': '1a.2 r1',
  'b7e3bb6042e3d7a9536345ad78e53661e6ea2601285479493fd1134aa21ea039': '1a.2 r2',
};
const previousApks = {
  '6ee559dd82b38565d979ecc08e07f2ac8986c98af1319ff9595b0b9dfc981834': '6B.3',
  '8d8a3e018463cd67fc65b6a0af27e4bc185ec47145d9633fdd959be03524d649': '1a.2 r1', 'fb5898e12375b7365c63c2da02e4e4d0a1c3b34c87394317eec808c1670b4478': '1a.2 r2',
};
if (previousAttestations[sha(attestationFile)]) throw Error(previousAttestations[sha(attestationFile)] + ' attestation reused');
const apkSha = sha(apk);
if (previousApks[apkSha]) throw Error(previousApks[apkSha] + ' APK reused');
if (sha(embeddedCopy) !== sha(attestationFile)) throw Error('Asset attestation differs from the workspace attestation');
for (const [name, digest] of Object.entries(record.hashes)) {
  if (name.includes('..') || path.isAbsolute(name) || sha(path.join(workspace, name)) !== digest) throw Error('Prepared input changed: ' + name);
}
for (const [name, digest] of Object.entries(record.originalHashes)) {
  if (sha(path.join(root, name)) !== digest) throw Error('Checkout source changed after preparation: ' + name);
}
const pins = file => ({source: file, sha256: sha(path.join(root, file))});
fs.writeFileSync(output, JSON.stringify({
  packageId: record.packageId, path: apk.split(path.sep).join('/'), sha256: apkSha, sizeBytes: fs.statSync(apk).size,
  builtAt: fs.statSync(apk).mtime.toISOString(), attestationSha256: sha(attestationFile), variant: 'release',
  productionSources: Object.keys(record.originalHashes).filter(name => name.startsWith('src/')).length,
  phase1a3a: ['src/database/saveSQLiteRowPreservingIdentity.ts', 'src/modules/creditCards/repositories/sqliteCreditCardRepository.ts'].map(pins),
  harness: ['scripts/phase1a3a/androidHarness.js', 'scripts/phase1a3a/probes.ts', 'docs/validacion-fase1a3a/node/results.json',
    'scripts/phase1a2/androidHarness.js', 'scripts/phase1a2/probes.ts', 'docs/validacion-fase1a2/node/results.json',
    'scripts/phase6b3/androidHarness.js', 'scripts/phase6b3/probes.ts', 'docs/correccion-fase6b3/node/results.json'].map(pins),
  buildCommand: "./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'",
  buildCwd: workspace + '/android',
  checksAtRun: 'run-android.ps1: APK and attestation hashes, embedded attestation, aapt package/non-debuggable, Hermes at runtime',
}, null, 2) + '\n');
console.log('1a.3A APK identity recorded; nothing installed.');
