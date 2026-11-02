'use strict';
// r2 (apk-identity.json keeps the first 1a.2 APK). Records the identity of the NEW 1a.2 synthetic APK after an authorized build, before any install. Reads files only:
// no adb, Gradle or runner. The runner (run-android.ps1) refuses an APK or attestation that differs from this record
// and checks that the APK embeds exactly this attestation.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const workspace = 'C:/sf-1a2-20261101';
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (process.argv.length !== 2) throw Error('No arguments');
const output = path.join(root, 'docs/validacion-fase1a2/authorization/apk-identity-r2.json');
if (fs.existsSync(output)) throw Error('APK identity already recorded; do not overwrite');
const apk = path.join(workspace, 'android/app/build/outputs/apk/release/app-release.apk');
const attestationFile = path.join(workspace, 'source-fingerprints.json');
const embeddedCopy = path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json');
const record = JSON.parse(fs.readFileSync(attestationFile, 'utf8'));
if (record.packageId !== 'com.smartfin.snapshot5b2.tests' || record.workspace !== workspace || record.phase !== '1a.2') throw Error('Not the 1a.2 attestation');
if (sha(attestationFile) === '1352b7ddcb306df8ca5146899e1a5f66c089abb271833893d5870198720c0730') throw Error('6B.3 attestation reused');
if (sha(attestationFile) === 'a4a437d3fc8f0dcc00641231363ce5ca22f387efec29afd6cf5b79be4fcfa4e2') throw Error('1a.2 r1 attestation reused');
if (sha(embeddedCopy) !== sha(attestationFile)) throw Error('Asset attestation differs from the workspace attestation');
for (const [name, digest] of Object.entries(record.hashes)) {
  if (name.includes('..') || path.isAbsolute(name) || sha(path.join(workspace, name)) !== digest) throw Error('Prepared input changed: ' + name);
}
for (const [name, digest] of Object.entries(record.originalHashes)) {
  if (sha(path.join(root, name)) !== digest) throw Error('Checkout source changed after preparation: ' + name);
}
const pins = file => ({source: file, sha256: sha(path.join(root, file))});
fs.writeFileSync(output, JSON.stringify({
  packageId: record.packageId, path: apk.split(path.sep).join('/'), sha256: sha(apk), sizeBytes: fs.statSync(apk).size,
  builtAt: fs.statSync(apk).mtime.toISOString(), attestationSha256: sha(attestationFile), variant: 'release',
  productionSources: Object.keys(record.originalHashes).filter(name => name.startsWith('src/')).length,
  phase1a2: ['src/modules/creditCards/useCases/installmentPlan.ts', 'src/modules/creditCards/useCases/creditCardStatementCharges.ts',
    'src/modules/creditCards/useCases/creditCardTransactionRelations.ts', 'src/modules/creditCards/repositories/sqliteCreditCardRepository.ts'].map(pins),
  harness: ['scripts/phase1a2/androidHarness.js', 'scripts/phase1a2/probes.ts', 'docs/validacion-fase1a2/node/results.json',
    'scripts/phase6b3/androidHarness.js', 'scripts/phase6b3/probes.ts', 'docs/correccion-fase6b3/node/results.json'].map(pins),
  buildCommand: "./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'",
  buildCwd: workspace + '/android',
  checksAtRun: 'run-android.ps1: APK and attestation hashes, embedded attestation, aapt package/non-debuggable, Hermes at runtime',
}, null, 2) + '\n');
console.log('1a.2 APK identity recorded; nothing installed.');
