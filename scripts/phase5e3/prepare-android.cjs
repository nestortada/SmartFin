// Prepares the isolated 5E.3 synthetic APK workspace from the 5E.2 chain.
// Production sources keep their bytes except the documented observation hooks.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2] || 'C:/sf-5e3-20261024');
execFileSync(process.execPath, [path.join(root, 'scripts/phase5e2/prepare-android.cjs'), workspace], {stdio: 'inherit'});
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
function adapt(file, replacements, reason) {
  let value = fs.readFileSync(path.join(workspace, file), 'utf8');
  for (const [from, to] of replacements) {
    if (!value.includes(from)) throw Error(`Adaptation anchor missing in ${file}: ${from}`);
    value = value.replace(from, to);
  }
  write(file, value, reason);
}
for (const [from, to, reason] of [
  ['__tests__/helpers/historyCreatedAtVariants.ts', 'historyCreatedAtVariants.ts', 'Synthetic created_at shapes shared with Node'],
  ['__tests__/helpers/historyFiftyYears.ts', 'historyFiftyYears.ts', 'Acceptance volume: 100k movements over 50 years, shared with Node'],
  ['scripts/phase5e3/androidHarness.js', 'phase5e3Harness.js', '5E.3 history, dashboard and recovery campaigns'],
  ['scripts/phase5e3/Phase5E3Observe.kt', native + 'Phase5E3Observe.kt', 'Observation log for receiver/Worker starts'],
]) {
  write(to, fs.readFileSync(path.join(root, from), 'utf8').replaceAll("'../../src/", "'./src/"), reason, from);
}
adapt(native + 'SmartFinSubscriptionReminderReceiver.kt', [
  ['    val pending = goAsync()\n    java.util.concurrent.Executors.newSingleThreadExecutor().also { executor -> executor.execute {\n      try {\n        try { Phase5E1RecoveryProbe.before(); SmartFinFinancialDeletion.recover(context) }',
    '    Phase5E3Observe.log(context, "receiver.start:" + intent.action)\n    val pending = goAsync()\n    java.util.concurrent.Executors.newSingleThreadExecutor().also { executor -> executor.execute {\n      try {\n        try { Phase5E1RecoveryProbe.before(); val recovered = SmartFinFinancialDeletion.recover(context); Phase5E3Observe.log(context, "receiver.recover:" + recovered.optString("status")) }'],
], 'Observation only: logs receiver action and recover status');
adapt(native + 'SmartFinSubscriptionWorker.kt', [
  ['  override fun doWork(): Result {\n', '  override fun doWork(): Result {\n    Phase5E3Observe.log(applicationContext, "worker.start:" + (inputData.getString("datasetEpoch") ?: "legacy"))\n    val outcome = doWork5E3()\n    Phase5E3Observe.log(applicationContext, "worker.result:" + outcome.javaClass.simpleName)\n    return outcome\n  }\n  private fun doWork5E3(): Result {\n'],
], 'Observation only: logs Worker start and result');
adapt(native + 'Phase5B2Package.kt', [
  ['  @ReactMethod fun readRestart(', '  @ReactMethod fun observeLog(promise: Promise) = run(promise) { Phase5E3Observe.read(context) }\n  @ReactMethod fun observeAppend(message: String, promise: Promise) = run(promise) { Phase5E3Observe.log(context, "js:" + message); true }\n  @ReactMethod fun readRestart('],
], 'Reads/appends the 5E.3 observation log');
if (process.argv.includes('--ui')) {
  // UI copy only: production App behind a test entry; publication UI enabled in this
  // isolated APK exactly as in 5B.3. Production keeps BACKUP_PUBLICATION_UI_ENABLED=false.
  write('UIHarness.jsx', fs.readFileSync(path.join(root, 'scripts/phase5e3/UIHarness.jsx'), 'utf8'), 'Test entry mounting the complete production App', 'scripts/phase5e3/UIHarness.jsx');
  adapt('index.js', [["import Harness from './Harness';", "import Harness from './UIHarness';"]], 'Routes ui-* URLs to the production App; campaigns to the instrument');
  adapt('src/modules/settings/services/backupPublicationPolicy.ts', [['BACKUP_PUBLICATION_UI_ENABLED = false', 'BACKUP_PUBLICATION_UI_ENABLED = true']],
    'USER AUTHORIZED TEST GATE: enables publication UI only in this isolated synthetic APK');
  for (const name of ['Phase5B2Package.kt', 'SyntheticBackupProvider.kt']) {
    let value = fs.readFileSync(path.join(workspace, native + name), 'utf8');
    value = value.replaceAll('proceed.await(30,', 'proceed.await(180,').replaceAll('proceed.await(60,', 'proceed.await(180,');
    write(native + name, value, (record.adaptations[native + name] ?? '') + '; UI gate timeout extended for inspection, excluded from performance');
  }
}
const harness = 'Harness.jsx';
const dispatcher = fs.readFileSync(path.join(workspace, harness), 'utf8');
if (!dispatcher.includes('async function run(campaign) {')) throw Error('Harness dispatcher changed');
write(harness, "import {runPhase5E3} from './phase5e3Harness';\n" + dispatcher.replace('async function run(campaign) {',
  "async function run(campaign) {\n  if(campaign.startsWith('phase5e3-')) { await runPhase5E3(campaign,{owned,seed,record,control,backup}); return; }"),
  '5E.3 dispatcher; previous campaigns retained');
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(workspace);
