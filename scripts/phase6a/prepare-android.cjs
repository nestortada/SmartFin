// Prepares the isolated 6A synthetic APK workspace. The 5E.6 chain cannot be replayed from
// git HEAD (its frozen pre-5E.6 CSV exporter came from the previous HEAD), so this copies the
// verified 5E.6 workspace, refreshes the unadapted production sources under src/ from this
// checkout (refusing if an adapted one or any other attested source changed) and adds the 6A
// harness, the frozen pre-6A dashboard and the shared scenarios.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const source = path.resolve(process.argv[3] || 'C:/sf-5e6-20261025');
const workspace = path.resolve(process.argv[2] || 'C:/sf-6a-20261026');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const relative = file => path.relative(root, file).split(path.sep).join('/');
if (fs.existsSync(workspace)) throw Error(`Workspace exists: ${workspace}`);
const skipped = ['node_modules', 'android/app/build', 'android/build', 'android/.gradle', 'android/app/.cxx'].map(p => path.join(source, p));
fs.cpSync(source, workspace, {recursive: true, filter: file => !skipped.some(s => file === s || file.startsWith(s + path.sep))});
fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
const record = JSON.parse(fs.readFileSync(path.join(workspace, 'source-fingerprints.json'), 'utf8'));
record.workspace = workspace.split(path.sep).join('/');
for (const [file, digest] of Object.entries(record.originalHashes))
  if (!file.startsWith('src/') && hash(fs.readFileSync(path.join(root, file))) !== digest) throw Error(`Attested source changed: ${file}`);
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const current = new Set(walk(path.join(root, 'src')).map(relative));
for (const file of Object.keys(record.originalHashes))
  if (file.startsWith('src/') && !current.has(file)) throw Error(`Production source removed: ${file}`);
const refreshed = [];
for (const file of current) {
  const bytes = fs.readFileSync(path.join(root, file));
  const adapted = record.originalHashes[file] && record.hashes[file] !== record.originalHashes[file];
  if (adapted) {
    if (hash(bytes) !== record.originalHashes[file]) throw Error(`Adapted production source changed: ${file}`);
    continue;
  }
  if (record.originalHashes[file] !== hash(bytes)) refreshed.push(file);
  fs.mkdirSync(path.dirname(path.join(workspace, file)), {recursive: true});
  fs.writeFileSync(path.join(workspace, file), bytes);
  record.originalHashes[file] = record.hashes[file] = hash(bytes);
}
function write(file, value, reason, original) {
  fs.writeFileSync(path.join(workspace, file), value);
  record.hashes[file] = hash(value);
  record.adaptations[file] = reason;
  if (original) record.originalHashes[original] = hash(fs.readFileSync(path.join(root, original), 'utf8'));
}
for (const [from, to, reason] of [
  ['scripts/phase6a/androidHarness.js', 'phase6aHarness.js', '6A exact-cents dashboard campaigns and production metric components'],
  ['scripts/phase6a/scenarios.ts', 'phase6aScenarios.ts', '6A scenarios and BigInt decimal reference shared with Node'],
  ['__tests__/helpers/dashboardSummaryPrePhase6A.ts', 'phase6aPre6A.ts', 'Frozen pre-6A dashboard (binary accumulation) for comparison only'],
  ['__tests__/helpers/phase6AExpectedSummary.ts', 'phase6aExpected.ts', '6A contract oracle shared with Node'],
]) write(to, fs.readFileSync(path.join(root, from), 'utf8').replaceAll("'../../src/", "'./src/"), reason, from);
const harness = 'Harness.jsx';
let value = fs.readFileSync(path.join(workspace, harness), 'utf8');
for (const [from, to] of [
  ['async function run(campaign) {', "async function run(campaign) {\n  if(campaign.startsWith('phase6a-')) { await runPhase6A(campaign,{owned,seed,record,control,backup}); return; }"],
  ['  return <View><Text>{status}</Text></View>;', '  return <View><Text>{status}</Text>{global.__phase6aUi ? global.__phase6aUi() : null}</View>;'],
]) {
  if (!value.includes(from)) throw Error(`Adaptation anchor missing in ${harness}: ${from}`);
  value = value.replace(from, to);
}
write(harness, "import {runPhase6A} from './phase6aHarness';\n" + value, record.adaptations[harness] + '; 6A dispatcher and metric view after the report');
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(JSON.stringify({workspace, refreshed}, null, 2));
