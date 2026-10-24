const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve('docs/atomicidad-fase3b');
const workspace = process.argv[2] || 'C:/sfatomicity-phase3b-20261017';
const disconnected35 = process.argv.includes('--allow-disconnected-api35');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const campaigns = ['phase3b', 'phase3a', 'phase2', 'core', 'begin-after', 'commit-before', 'rollback-before'];
const summary = [];
for (const api of [24, 35]) for (const campaign of campaigns) {
  const folder = path.join(root, `final-api${api}-${campaign}`);
  if (!fs.existsSync(path.join(folder, 'result.json')) && api === 35 && disconnected35) {
    summary.push({ api, campaign, status: 'pending', reason: 'User disconnected the physical device; no completed result collected.' });
    continue;
  }
  const result = read(path.join(folder, 'result.json'));
  const environment = read(path.join(folder, 'environment.json'));
  const production = read(path.join(folder, 'production-package-unchanged.json'));
  if (!result.passed || result.campaign !== campaign || !production.unchanged || Number(environment.api) !== api) {
    throw new Error(`Failed validation API ${api} ${campaign}`);
  }
  summary.push({ api, campaign, status: 'passed', passed: true, cases: result.cases.length,
    rollbackPoints: result.matrix?.reduce((total, entry) => total + entry.points, 0),
    timings: result.timings, result: path.relative(root, path.join(folder, 'result.json')).replace(/\\/g, '/') });
}
const completed = summary.filter(entry => entry.passed).length;
const pending = summary.length - completed;
fs.writeFileSync(path.join(root, 'validation-summary.json'), JSON.stringify({ campaigns: summary.length, completed, pending, complete: pending === 0, summary }, null, 2));
const sources = {};
function visit(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) visit(file);
    else {
      const compiled = path.join(workspace, file);
      const original = hash(file); const included = hash(compiled);
      if (original !== included) throw new Error(`Source differs from final APK checkout: ${file}`);
      sources[file.replace(/\\/g, '/')] = original;
    }
  }
}
visit('src');
const fingerprints = read(path.join(workspace, 'source-fingerprints.json'));
for (const [file, expected] of Object.entries(fingerprints.hashes)) {
  if (hash(path.join(workspace, file)) !== expected) throw new Error(`Harness fingerprint changed: ${file}`);
}
const driver = {};
for (const file of ['sqlite.js', 'lib/sqlite.core.js', 'platforms/android/src/main/java/org/pgsqlite/SQLitePlugin.java']) {
  const installed = hash(path.join('node_modules/react-native-sqlite-storage', file));
  if (installed !== hash(path.join(workspace, 'vendor/sqlite', file))) throw new Error(`Driver differs: ${file}`);
  driver[file] = installed;
}
fs.writeFileSync(path.join(root, 'current-source-verification.json'), JSON.stringify({ sources, driver, unchanged: true }, null, 2));
const apk = path.join(workspace, 'android/app/build/outputs/apk/release/app-release.apk');
fs.writeFileSync(path.join(root, 'apk-hash.json'), JSON.stringify({ workspace, apk, sha256: hash(apk), bytes: fs.statSync(apk).size }, null, 2));
process.stdout.write(`Verified ${completed} campaigns, ${pending} pending, ${Object.keys(sources).length} sources, installed driver and APK.\n`);
