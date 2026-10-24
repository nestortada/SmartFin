const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const workspace = path.resolve(process.argv[2]);
const evidence = path.resolve('docs/atomicidad-fase4');
const fingerprint = JSON.parse(fs.readFileSync(path.join(workspace, 'source-fingerprints.json'), 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const [file, expected] of Object.entries(fingerprint.hashes)) {
  if (hash(path.join(workspace, file)) !== expected) throw new Error('Changed harness source: ' + file);
}
for (const [file, expected] of Object.entries(fingerprint.originalHashes)) {
  if (hash(path.resolve(file)) !== expected) throw new Error('Changed original source: ' + file);
}
for (const file of Object.keys(fingerprint.hashes).filter(name => name.startsWith('vendor/sqlite/'))) {
  const installed = path.resolve(file.replace('vendor/sqlite/', 'node_modules/react-native-sqlite-storage/'));
  if (hash(installed) !== fingerprint.hashes[file]) throw new Error('Installed driver differs: ' + file);
}
const campaigns = ['phase4', 'phase4-restart-create', 'phase4-restart-verify', 'core', 'begin-after', 'commit-before', 'rollback-before', 'phase2', 'phase3a'];
const expectedCounts = { phase4: 291, 'phase4-restart-create': 1, 'phase4-restart-verify': 1, core: 14, 'begin-after': 1, 'commit-before': 1, 'rollback-before': 1, phase2: 274, phase3a: 72 };
const results = [];
for (const api of ['api24', 'api35']) for (const campaign of campaigns) {
  const directory = path.join(evidence, `complete-${api}-${campaign}`);
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8').replace(/^\uFEFF/, ''));
  const result = read('result.json'); const sources = read('source-fingerprints.json'); const environment = read('environment.json');
  if (!result.passed || result.campaign !== campaign || !read('production-package-unchanged.json').unchanged)
    throw new Error('Missing/failed campaign: ' + directory);
  if (result.cases.length !== expectedCounts[campaign] || !result.cases.every(item => item.passed)) throw new Error('Incomplete case set: ' + directory);
  if (JSON.stringify(sources.hashes) !== JSON.stringify(fingerprint.hashes)) throw new Error('Stale APK campaign sources: ' + directory);
  if (campaign === 'phase4' && (result.matrix.length !== 280 || result.cases.length !== 291)) throw new Error('Unexpected phase4 coverage: ' + directory);
  if (campaign === 'phase4-restart-verify') {
    const created = JSON.parse(fs.readFileSync(path.join(evidence, `complete-${api}-phase4-restart-create/result.json`), 'utf8'));
    if (created.databaseName !== result.databaseName) throw new Error('Restart used another synthetic file');
  }
  const matrixPositions = (result.matrix ?? []).reduce((sum, item) => sum + (typeof item.points === 'number' ? item.points : 1), 0);
  if ((campaign === 'phase2' && matrixPositions !== 268) || (campaign === 'phase3a' && matrixPositions !== 52)) throw new Error('Incomplete fault matrix: ' + directory);
  results.push({ api, campaign, cases: result.cases.length, matrixPositions, environment, timings: result.timings,
    result: path.relative(evidence, path.join(directory, 'result.json')).replaceAll('\\', '/') });
}
const apk = path.join(workspace, 'android/app/build/outputs/apk/release/app-release.apk');
const installedBinaries = ['api24', 'api35'].map(api => {
  const proof = JSON.parse(fs.readFileSync(path.join(evidence, `complete-${api}-phase3a/installed-apk-verification.json`), 'utf8').replace(/^\uFEFF/, ''));
  const expected = crypto.createHash(proof.comparisonAlgorithm.toLowerCase()).update(fs.readFileSync(apk)).digest('hex');
  if (proof.installedBefore !== expected || proof.apkSha256 !== hash(apk)) throw new Error('Installed test APK differs: ' + api);
  return { api, comparisonAlgorithm: proof.comparisonAlgorithm, matches: true };
});
const report = { complete: true, package: fingerprint.packageId, apkSha256: hash(apk), installedBinaries,
  sourceFingerprintsVerified: true, installedDriverMatches: true, runtimeInjection: fingerprint.phase4RuntimeInjection,
  productionSourceFilesVerified: Object.keys(fingerprint.originalHashes).filter(file => file.startsWith('src/')).length,
  nativeReminders: 'Mocked in isolated app; production Kotlin receiver/worker not executed', results };
fs.writeFileSync(path.join(evidence, 'validation-summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ complete: true, campaigns: results.length, cases: results.reduce((sum, row) => sum + row.cases, 0), apkSha256: report.apkSha256 }));
