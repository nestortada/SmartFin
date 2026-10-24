const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2] || 'C:/sfpost3b-performance-20261018');
const output = path.join(root, 'docs/performance/post3b');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const baseline = read(path.join(output, 'baseline/source-hashes.json'));
const fingerprint = read(path.join(workspace, 'source-fingerprints.json'));
const instrumentedMismatches = Object.entries(fingerprint.hashes).filter(([file, expected]) => hash(path.join(workspace, file)) !== expected).map(([file]) => file);
const productionMismatches = Object.entries(fingerprint.originalSourceHashes).filter(([file, expected]) => hash(path.join(root, file)) !== expected).map(([file]) => file);
const changedSinceBaseline = Object.entries(baseline).filter(([file, expected]) => hash(path.join(root, file)) !== expected).map(([file]) => file);
const protectedFiles = Object.keys(baseline).filter(file => !file.startsWith('src/'));
const driverMismatches = Object.keys(fingerprint.hashes).filter(file => file.startsWith('vendor/sqlite/')).filter(file => hash(path.join(root, 'node_modules/react-native-sqlite-storage', file.slice('vendor/sqlite/'.length))) !== fingerprint.hashes[file]);
const mainArtifact = path.join(workspace, 'main-artifact');
let mainMeasurement;
if (fs.existsSync(path.join(mainArtifact, 'ready'))) {
  const original = read(path.join(mainArtifact, 'source-fingerprints.json'));
  const mismatches = Object.entries(original.hashes).filter(([file, expected]) => {
    const frozen = file === 'PostCampaign.js' ? 'Campaign.js.txt' : file === 'PostProfile.js' ? 'Profile.js.txt' : undefined;
    return hash(frozen ? path.join(output, 'main-instrumentation', frozen) : path.join(workspace, file)) !== expected;
  }).map(([file]) => file);
  const apkSha256 = hash(path.join(mainArtifact, 'android/app/build/outputs/apk/release/app-release.apk'));
  mainMeasurement = { mismatches, apkSha256, matchesRecordedApk: apkSha256 === read(path.join(output, 'apk-hash.json')).Hash.toLowerCase() };
}
const expectedChange = 'src/modules/creditCards/repositories/sqliteCreditCardRepository.ts';
const result = { workspace, sourceFiles: Object.keys(fingerprint.originalSourceHashes).length,
  instrumentedMismatches, productionMismatches, driverMismatches, changedSinceBaseline, protectedFiles, mainMeasurement,
  apkSha256: hash(path.join(workspace, 'android/app/build/outputs/apk/release/app-release.apk')),
  passed: !instrumentedMismatches.length && !productionMismatches.length && !driverMismatches.length && (!mainMeasurement || (!mainMeasurement.mismatches.length && mainMeasurement.matchesRecordedApk)) && changedSinceBaseline.length === 1 && changedSinceBaseline[0] === expectedChange };
fs.writeFileSync(path.join(output, 'scope-audit.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
