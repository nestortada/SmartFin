// Prepares the isolated 5E.2 synthetic APK workspace from the 5E.1 chain.
// Production sources are copied unmodified; only the harness adds frozen comparators.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2] || 'C:/sf-5e2-20261024');
execFileSync(process.execPath, [path.join(root, 'scripts/phase5e1/prepare-android.cjs'), workspace], {stdio: 'inherit'});
const record = JSON.parse(fs.readFileSync(path.join(workspace, 'source-fingerprints.json'), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function write(file, value, reason, original) {
  fs.mkdirSync(path.dirname(path.join(workspace, file)), {recursive: true});
  fs.writeFileSync(path.join(workspace, file), value);
  record.hashes[file] = hash(value);
  if (reason) record.adaptations[file] = reason; else delete record.adaptations[file];
  if (original) record.originalHashes[original] = hash(fs.readFileSync(path.join(root, original), 'utf8'));
}
// 5E.1 instrumentation wrapped the history adapter; 5E.2 measures it from outside,
// identically for both versions, so restore the exact production bytes.
const history = 'src/modules/transactions/repositories/sqliteTransactionHistory.ts';
write(history, fs.readFileSync(path.join(root, history), 'utf8'), undefined, history);
for (const [from, to, reason] of [
  ['__tests__/helpers/transactionHistoryPhase5E1.ts', 'history5E1.ts', 'Frozen 5E.1 history comparator; imports relocated only'],
  ['__tests__/helpers/dashboardSummaryBaseline.ts', 'dashboardBaseline.ts', 'Frozen phase 2 dashboard comparator; imports relocated only'],
  ['__tests__/helpers/historyDistributionSql.ts', 'historyDistributionSql.ts', 'Synthetic SQL distributions shared with Node'],
  ['scripts/phase5e2/androidHarness.js', 'phase5e2Harness.js', '5E.2 history and dashboard campaigns'],
]) {
  const source = fs.readFileSync(path.join(root, from), 'utf8').replaceAll("'../../src/", "'./src/");
  write(to, source, reason, from);
}
const harness = 'Harness.jsx';
const dispatcher = fs.readFileSync(path.join(workspace, harness), 'utf8');
if (!dispatcher.includes('async function run(campaign) {')) throw Error('Harness dispatcher changed');
write(harness, "import {runPhase5E2} from './phase5e2Harness';\n" + dispatcher.replace('async function run(campaign) {',
  "async function run(campaign) {\n  if(campaign.startsWith('phase5e2-')) { await runPhase5E2(campaign,{owned,record,control,backup}); return; }"),
  '5E.2 dispatcher; previous campaigns retained');
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(workspace);
