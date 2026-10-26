// Prepares the isolated 5E.6 synthetic APK workspace from the 5E.5 chain. Adds the 5E.6
// precision/order probe and historical re-export campaigns. Production sources (including the
// corrected SmartFinBackupCsv) keep their bytes; the pre-5E.6 exporter is the 5E.4 workspace's
// Phase5E4LegacyCsv, frozen from git HEAD: prepare before committing the 5E.6 exporter.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2] || 'C:/sf-5e6-20261025');
execFileSync(process.execPath, [path.join(root, 'scripts/phase5e5/prepare-android.cjs'), workspace], {stdio: 'inherit'});
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
const legacy = fs.readFileSync(path.join(workspace, native + 'Phase5E4LegacyCsv.kt'), 'utf8');
if (legacy.includes('exactReal') || legacy.includes('ORDER BY +')) throw Error('Frozen exporter is not the pre-5E.6 one: prepare before committing');
for (const [from, to, reason] of [
  ['scripts/phase5e6/androidHarness.js', 'phase5e6Harness.js', '5E.6 precision/order probe and historical re-export campaigns'],
  ['scripts/phase5e6/probes.ts', 'phase5e6Probes.ts', 'Precision and order probes shared with Node'],
]) write(to, fs.readFileSync(path.join(root, from), 'utf8').replaceAll("'../../src/", "'./src/"), reason, from);
const methods = fs.readFileSync(path.join(root, 'scripts/phase5e6/Phase5E6Methods.kt.txt'), 'utf8');
record.originalHashes['scripts/phase5e6/Phase5E6Methods.kt.txt'] = hash(methods);
adapt(native + 'Phase5B2Package.kt', '  @ReactMethod fun inspect(', methods + '\n  @ReactMethod fun inspect(', '5E.6 production exporter probes');
const harness = 'Harness.jsx';
adapt(harness, 'async function run(campaign) {', "async function run(campaign) {\n  if(campaign.startsWith('phase5e6-')) { await runPhase5E6(campaign,{owned,seed,record,control,backup}); return; }", '5E.6 dispatcher');
write(harness, "import {runPhase5E6} from './phase5e6Harness';\n" + fs.readFileSync(path.join(workspace, harness), 'utf8'), record.adaptations[harness]);
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(workspace);
