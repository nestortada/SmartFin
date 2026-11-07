'use strict';
// Phase 1a.4B r5: records the identity of the NEW synthetic APK after the authorized build, before any install.
// Derived from scripts/phase1a4b/r4/apk-identity-r4.cjs. Reads files only (no adb, Gradle or runner). Rejects the r1, r3, r4
// APKs, the r2 diagnostic APKs (attempts 1 and b), their attestations and every earlier one; lists the differences against r4.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const workspace = 'C:/sf-1a4b-r5-20261107';
const r4Workspace = 'C:/sf-1a4b-r4-20261107';
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (process.argv.length !== 2) throw Error('No arguments');
const output = path.join(root, 'docs/validacion-fase1a4b/r5/authorization/apk-identity.json');
if (fs.existsSync(output)) throw Error('APK identity already recorded; do not overwrite');
const apk = path.join(workspace, 'android/app/build/outputs/apk/release/app-release.apk');
const attestationFile = path.join(workspace, 'source-fingerprints.json');
const embeddedCopy = path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json');
const record = JSON.parse(fs.readFileSync(attestationFile, 'utf8'));
if (record.packageId !== 'com.smartfin.snapshot5b2.tests' || record.workspace !== workspace || record.phase !== '1a.4B r5')
  throw Error('Not the 1a.4B r5 attestation');
const previousAttestations = {
  '1352b7ddcb306df8ca5146899e1a5f66c089abb271833893d5870198720c0730': '6B.3',
  'a4a437d3fc8f0dcc00641231363ce5ca22f387efec29afd6cf5b79be4fcfa4e2': '1a.2 r1',
  'b7e3bb6042e3d7a9536345ad78e53661e6ea2601285479493fd1134aa21ea039': '1a.2 r2',
  'fe6d57895a37def3e6f26d7d60c636abe56e5173581b73c8294d1e417cd8417e': '1a.3A',
  '7a3fc303c1c6acf5f50a99cf16fb03ff065de8f10517c41d9c952e2a248d5bce': '1a.3B r1',
  '40b3c298a56fd4d6a65b0c83971ca3e1eee88a02a9539326709c3241ec14d32c': '1a.3B r2',
  '33cd4e3f7f5ba284452d8a99ee46431b69988030d7709bbfbd6ef9a9f3dfb13c': '1a.3B r3',
  '540c2c7b79e2386da867c10b2195fa1d8ef1e5dd8e4ea80c1d80f1bd9a7d4cd1': '1a.3B r4',
  '5ef8befd07803cf59505e7afc05cefa7f1b8ddf220beaff528e06fe2d1882433': '1a.3B r5',
  '27dd1ba6db65d41cacd517079fe18f63c4ed589b18ae4cd367ed65581b9d2268': '1a.4A r1',
  '286642b3482d6b9b9baa3ebbec3b047697fb941f862c54ce2e06580786112465': '1a.4A r2',
  '5cbf894058ec96319b88981dd9bf2433fd79d7456ef3fe7f802f48843b753f4c': '1a.4B r1',
  'a93716e79ee3edc810fac5486537ff585f67d93906a44bbf507a576c7283612a': '1a.4B r2 attempt 1',
  '05051e350c8e3b420cb57ff8363dee1b1ff267ea63221bd24dbbd799b3e8bfad': '1a.4B r2 attempt b',
  'bf4a27c0292c9832a86ad5d55180e0ec03bd760a30e8552c88ede485b85daf54': '1a.4B r3',
  '97e1a907b5a27442975938f70e4ce88b9f1be78cce7682f1f1c8f1d7cdb8831e': '1a.4B r4',
};
const previousApks = {
  '6ee559dd82b38565d979ecc08e07f2ac8986c98af1319ff9595b0b9dfc981834': '6B.3',
  '8d8a3e018463cd67fc65b6a0af27e4bc185ec47145d9633fdd959be03524d649': '1a.2 r1', 'fb5898e12375b7365c63c2da02e4e4d0a1c3b34c87394317eec808c1670b4478': '1a.2 r2',
  '2a5d613ff99be15a1a1b52759e98d0569a076c5a5fe7e1cb57679c4348f518a3': '1a.3A',
  'cb07e290e4b9fb89b60d017adf05940731c8db9eb5c803eb705a7ae71180a4ae': '1a.3B r1',
  '1423e8cea7ecfaaf8d5c611a32f30f747365b39e4363c3864719c91d0b917911': '1a.3B r2',
  'c46c22943cfdc5857ad95c0d720fcbd3a42ce8c1979cad2f1b6dc1d1d6b36369': '1a.3B r3',
  '3d1bfb2202d1da03ee9b12adcdfc556543144c77020dda2e00d1f95429ccaa1a': '1a.3B r4',
  'ec3f10125d95aca751e15e411e58b8a557b8a334b172af07c84b2c79ada2039a': '1a.3B r5',
  '825e48ce1da43f313c72b7f5babc8cc771e67ab9546ebf2f39fe92ea1db6fb73': '1a.4A r1',
  'a3cba3a8233d245f24b715ec896eacf05cce58a122071ea164810770b7ba29ae': '1a.4A r2',
  'e65e614ab5689f240047df4f5e30c5fc5bcd52b1ee90f6fbaaaf8869a06621b7': '1a.4B r1',
  '5e68ea6862a643224188bb5a731f71a8724e29a61f12fbe66662cfa6c6ba9ea5': '1a.4B r2 attempt 1',
  '69f3c11926fad64be6f143747d83a2d9c94bb4aa6c2eb99a3281dc74ded81716': '1a.4B r2 attempt b',
  'f4ffd9d8520cdd640be90f48031268040588f1bf2f060354c8e2562248696af5': '1a.4B r3',
  'aa720dd012d2b19b10fab7f4acb843d096f246dfe25e98531797974a0842dd11': '1a.4B r4',
};
if (previousAttestations[sha(attestationFile)]) throw Error(previousAttestations[sha(attestationFile)] + ' attestation reused');
const apkSha = sha(apk);
if (previousApks[apkSha]) throw Error(previousApks[apkSha] + ' APK reused');
if (sha(embeddedCopy) !== sha(attestationFile)) throw Error('Asset attestation differs from the workspace attestation');
for (const [name, digest] of Object.entries(record.hashes))
  if (name.includes('..') || path.isAbsolute(name) || sha(path.join(workspace, name)) !== digest) throw Error('Prepared input changed: ' + name);
for (const [name, digest] of Object.entries(record.originalHashes))
  if (sha(path.join(root, name)) !== digest) throw Error('Checkout source changed after preparation: ' + name);
// Exact differences against r4 (prepared files; the attestation itself always differs).
const r4 = JSON.parse(fs.readFileSync(path.join(r4Workspace, 'source-fingerprints.json'), 'utf8'));
const names = [...new Set([...Object.keys(r4.hashes), ...Object.keys(record.hashes)])].sort();
const differencesFromR4 = names.filter(name => r4.hashes[name] !== record.hashes[name])
  .map(name => ({file: name, r4: r4.hashes[name] ?? null, r5: record.hashes[name] ?? null}));
const pins = file => ({source: file, sha256: sha(path.join(root, file))});
fs.writeFileSync(output, JSON.stringify({
  packageId: record.packageId, path: apk.split(path.sep).join('/'), sha256: apkSha, sizeBytes: fs.statSync(apk).size,
  builtAt: fs.statSync(apk).mtime.toISOString(), attestationSha256: sha(attestationFile), variant: 'release', purpose: '1a.4B r5 full validation (32 campaigns, 568 cases and 356 failure points per device)',
  productionSources: Object.keys(record.originalHashes).filter(name => name.startsWith('src/')).length,
  differencesFromR4,
  harness: ['scripts/phase1a4b/androidHarness.js', 'scripts/phase1a4b/phase1a3bProbes.ts', 'docs/validacion-fase1a4b/r3/reference-update.json', 'docs/validacion-fase1a4b/r5/baseline/phase1a3bProbes.r4.ts.txt', 'scripts/phase1a4b/derive-probes.cjs',
    'scripts/phase1a4b/probes.ts', 'docs/validacion-fase1a4b/node/results.json'].map(pins),
  buildCommand: "./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'",
  buildCwd: workspace + '/android',
  checksAtRun: 'run-android-r5.ps1: APK and attestation hashes, embedded attestation, aapt package/non-debuggable, Hermes at runtime',
}, null, 2) + '\n');
console.log(JSON.stringify({sha256: apkSha, sizeBytes: fs.statSync(apk).size, attestationSha256: sha(attestationFile), differencesFromR4}));
