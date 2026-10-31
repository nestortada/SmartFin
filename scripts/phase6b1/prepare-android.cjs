// Prepares the isolated 6B.1 synthetic APK workspace from the verified 6B workspace (same chain as
// 6B over 6A): refreshes unadapted production sources under src/ from this checkout (refusing if an
// adapted or attested source changed; the 6B.1 production changes appear in `refreshed`) and adds
// the 6B.1 probes, the frozen pre-6B.1 use cases and their dispatcher.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const source = path.resolve(process.argv[3] || 'C:/sf-6b-20261026');
const workspace = path.resolve(process.argv[2] || 'C:/sf-6b1r-20261026');
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
  ['scripts/phase6b1/androidHarness.js', 'phase6b1Harness.js', '6B.1 campaigns: probes, production metric components, representative volumes'],
  ['scripts/phase6b1/probes.ts', 'phase6b1Probes.ts', '6B.1 probes and BigInt decimal oracle shared with Node'],
  ['__tests__/helpers/pre6B1SaveManualTransaction.ts', 'pre6B1SaveManualTransaction.ts', 'frozen pre-6B.1 manual transactions (before/after oracle)'],
  ['__tests__/helpers/pre6B1CreditCardRelations.ts', 'pre6B1CreditCardRelations.ts', 'frozen pre-6B.1 card relations (before/after oracle)'],
]) write(to, fs.readFileSync(path.join(root, from), 'utf8').replaceAll("'../../src/", "'./src/").replaceAll("'../phase6b/probes'", "'./phase6bProbes'"), reason, from);
const harness = 'Harness.jsx';
let value = fs.readFileSync(path.join(workspace, harness), 'utf8');
const anchor = 'async function run(campaign) {';
if (!value.includes(anchor)) throw Error(`Adaptation anchor missing in ${harness}`);
value = value.replace(anchor, `${anchor}\n  if(campaign.startsWith('phase6b1-')) { await runPhase6B1(campaign,{owned,seed,record,control,backup}); return; }`);
write(harness, "import {runPhase6B1} from './phase6b1Harness';\n" + value, record.adaptations[harness] + '; 6B.1 dispatcher');
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(JSON.stringify({workspace, refreshed}, null, 2));
