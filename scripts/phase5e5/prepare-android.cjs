// Prepares the isolated 5E.5 synthetic APK workspace from the 5E.4 chain. Adds the
// recoverability/failure/epoch harness, its shared read-only figures module and the
// test-only evidence export methods. Production sources keep their bytes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2] || 'C:/sf-5e5-20261025');
execFileSync(process.execPath, [path.join(root, 'scripts/phase5e4/prepare-android.cjs'), workspace], {stdio: 'inherit'});
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
  ['scripts/phase5e5/androidHarness.js', 'phase5e5Harness.js', '5E.5 recoverability, failure matrix and epoch campaigns'],
  ['scripts/phase5e5/recoverability.ts', 'phase5e5Recoverability.ts', 'Read-only figures and table digests shared with the Node verifier'],
]) write(to, fs.readFileSync(path.join(root, from), 'utf8').replaceAll("'../../src/", "'./src/"), reason, from);
const methods = fs.readFileSync(path.join(root, 'scripts/phase5e5/Phase5E5Methods.kt.txt'), 'utf8');
record.originalHashes['scripts/phase5e5/Phase5E5Methods.kt.txt'] = hash(methods);
adapt(native + 'Phase5B2Package.kt', '  @ReactMethod fun inspect(', methods + '\n  @ReactMethod fun inspect(', '5E.5 evidence export and synthetic document damage');
const harness = 'Harness.jsx';
adapt(harness, 'async function run(campaign) {', "async function run(campaign) {\n  if(campaign.startsWith('phase5e5-')) { await runPhase5E5(campaign,{owned,seed,record,control,backup}); return; }", '5E.5 dispatcher');
write(harness, "import {runPhase5E5} from './phase5e5Harness';\n" + fs.readFileSync(path.join(workspace, harness), 'utf8'), record.adaptations[harness]);
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(workspace);
