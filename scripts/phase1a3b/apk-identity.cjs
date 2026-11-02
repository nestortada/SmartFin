'use strict';
// Records the identity of the NEW 1a.3B synthetic APK after an authorized build, before any install. Reads files
// only: no adb, Gradle or runner. The runner (run-android.ps1) refuses an APK or attestation that differs from this
// record and checks that the APK embeds exactly this attestation. Earlier APKs and attestations are rejected.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const workspace = 'C:/sf-1a3b-r5-20261102';
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (process.argv.length !== 2) throw Error('No arguments');
const output = path.join(root, 'docs/validacion-fase1a3b/r5/authorization/apk-identity.json');
if (fs.existsSync(output)) throw Error('APK identity already recorded; do not overwrite');
const apk = path.join(workspace, 'android/app/build/outputs/apk/release/app-release.apk');
const attestationFile = path.join(workspace, 'source-fingerprints.json');
const embeddedCopy = path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json');
const record = JSON.parse(fs.readFileSync(attestationFile, 'utf8'));
if (record.packageId !== 'com.smartfin.snapshot5b2.tests' || record.workspace !== workspace || record.phase !== '1a.3B r5') throw Error('Not the 1a.3B r5 attestation');
const previousAttestations = {
  '1352b7ddcb306df8ca5146899e1a5f66c089abb271833893d5870198720c0730': '6B.3',
  'a4a437d3fc8f0dcc00641231363ce5ca22f387efec29afd6cf5b79be4fcfa4e2': '1a.2 r1',
  'b7e3bb6042e3d7a9536345ad78e53661e6ea2601285479493fd1134aa21ea039': '1a.2 r2',
  'fe6d57895a37def3e6f26d7d60c636abe56e5173581b73c8294d1e417cd8417e': '1a.3A',
  '7a3fc303c1c6acf5f50a99cf16fb03ff065de8f10517c41d9c952e2a248d5bce': '1a.3B r1',
  '40b3c298a56fd4d6a65b0c83971ca3e1eee88a02a9539326709c3241ec14d32c': '1a.3B r2',
  '33cd4e3f7f5ba284452d8a99ee46431b69988030d7709bbfbd6ef9a9f3dfb13c': '1a.3B r3',
  '540c2c7b79e2386da867c10b2195fa1d8ef1e5dd8e4ea80c1d80f1bd9a7d4cd1': '1a.3B r4',
};
const previousApks = {
  '6ee559dd82b38565d979ecc08e07f2ac8986c98af1319ff9595b0b9dfc981834': '6B.3',
  '8d8a3e018463cd67fc65b6a0af27e4bc185ec47145d9633fdd959be03524d649': '1a.2 r1', 'fb5898e12375b7365c63c2da02e4e4d0a1c3b34c87394317eec808c1670b4478': '1a.2 r2',
  '2a5d613ff99be15a1a1b52759e98d0569a076c5a5fe7e1cb57679c4348f518a3': '1a.3A',
  'cb07e290e4b9fb89b60d017adf05940731c8db9eb5c803eb705a7ae71180a4ae': '1a.3B r1',
  '1423e8cea7ecfaaf8d5c611a32f30f747365b39e4363c3864719c91d0b917911': '1a.3B r2',
  'c46c22943cfdc5857ad95c0d720fcbd3a42ce8c1979cad2f1b6dc1d1d6b36369': '1a.3B r3',
  '3d1bfb2202d1da03ee9b12adcdfc556543144c77020dda2e00d1f95429ccaa1a': '1a.3B r4',
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
  phase1a3b: ['src/database/migrations.ts', 'src/database/sqliteDatabase.ts', 'src/database/sqliteSchema.ts',
    'src/modules/creditCards/database/installmentHistorySchema.ts', 'src/modules/creditCards/database/originalInstallmentRevisions.ts',
    'src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository.ts', 'src/modules/creditCards/types/InstallmentHistory.ts',
    'src/modules/creditCards/useCases/installmentPlanRevisions.ts', 'src/modules/settings/repositories/sqliteFinancialDataRepository.ts'].map(pins),
  harness: ['scripts/phase1a3b/androidHarness.js', 'scripts/phase1a3b/probes.ts', 'docs/validacion-fase1a3b/node/results.json',
    'scripts/phase1a3a/androidHarness.js', 'scripts/phase1a3a/probes.ts', 'docs/validacion-fase1a3a/node/results.json',
    'scripts/phase1a2/androidHarness.js', 'scripts/phase1a2/probes.ts', 'docs/validacion-fase1a2/node/results.json',
    'scripts/phase6b3/androidHarness.js', 'scripts/phase6b3/probes.ts', 'docs/correccion-fase6b3/node/results.json'].map(pins),
  buildCommand: "./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'",
  buildCwd: workspace + '/android',
  checksAtRun: 'run-android.ps1: APK and attestation hashes, embedded attestation, aapt package/non-debuggable, Hermes at runtime',
}, null, 2) + '\n');
console.log('1a.3B APK identity recorded; nothing installed.');
