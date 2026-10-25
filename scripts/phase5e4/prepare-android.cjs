// Prepares the isolated 5E.4 synthetic APK workspace from the 5E.3 chain (pass --ui for
// the UI copy). Adds the 5E.4 harness, representative fixtures and a frozen copy of
// the 5E.3 CSV exporter taken from git HEAD, used only to compare bytes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2] || 'C:/sf-5e4-20261025');
const ui = process.argv.includes('--ui');
execFileSync(process.execPath, [path.join(root, 'scripts/phase5e3/prepare-android.cjs'), workspace, ...(ui ? ['--ui'] : [])], {stdio: 'inherit'});
const record = JSON.parse(fs.readFileSync(path.join(workspace, 'source-fingerprints.json'), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const native = 'android/app/src/main/java/com/smartfin/';
function write(file, value, reason, original) {
  fs.mkdirSync(path.dirname(path.join(workspace, file)), {recursive: true});
  fs.writeFileSync(path.join(workspace, file), value);
  record.hashes[file] = hash(value);
  record.adaptations[file] = reason;
  if (original) record.originalHashes[original] = hash(fs.readFileSync(path.join(root, original), 'utf8'));
}
function adapt(file, from, to, reason) {
  const value = fs.readFileSync(path.join(workspace, file), 'utf8');
  if (!value.includes(from)) throw Error(`Adaptation anchor missing in ${file}`);
  write(file, value.replace(from, to), (record.adaptations[file] ? record.adaptations[file] + '; ' : '') + reason);
}
for (const [from, to, reason] of [
  ['__tests__/helpers/representativeHistory.ts', 'representativeHistory.ts', 'Representative 50-year/5-year/6-month fixtures shared with Node'],
  ['scripts/phase5e4/androidHarness.js', 'phase5e4Harness.js', '5E.4 backup profile and recovery contention campaigns'],
  ['scripts/phase5e4/Phase5E4Support.kt', native + 'Phase5E4Support.kt', 'Test-only holder for a real recover() owner'],
]) write(to, fs.readFileSync(path.join(root, from), 'utf8').replaceAll("'../../src/", "'./src/"), reason, from);
const frozen = execFileSync('git', ['show', 'HEAD:android/app/src/main/java/com/smartfin/SmartFinBackupCsv.kt'], {cwd: root, encoding: 'utf8'});
if (!frozen.includes('object SmartFinBackupCsv {')) throw Error('Frozen exporter anchor missing');
write(native + 'Phase5E4LegacyCsv.kt', frozen.replace('object SmartFinBackupCsv {', 'object Phase5E4LegacyCsv {'),
  `Frozen 5E.3 CSV exporter from git HEAD ${execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim()} (byte comparison only)`);
const methods = fs.readFileSync(path.join(root, 'scripts/phase5e4/Phase5E4Methods.kt.txt'), 'utf8');
record.originalHashes['scripts/phase5e4/Phase5E4Methods.kt.txt'] = hash(methods);
adapt(native + 'Phase5B2Package.kt', '  @ReactMethod fun inspect(', methods + '\n  @ReactMethod fun inspect(', '5E.4 cleanup holder and frozen CSV comparison');
const harness = 'Harness.jsx';
adapt(harness, 'async function run(campaign) {', "async function run(campaign) {\n  if(campaign.startsWith('phase5e4-')) { await runPhase5E4(campaign,{owned,seed,record,control,backup}); return; }", '5E.4 dispatcher');
write(harness, "import {runPhase5E4} from './phase5e4Harness';\n" + fs.readFileSync(path.join(workspace, harness), 'utf8'), record.adaptations[harness]);
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(workspace);
