const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const workspace = path.resolve(process.argv[2] || 'C:/sf-5e1-20261024');
execFileSync(process.execPath, [path.join(__dirname, '../phase5e/prepare-android.cjs'), workspace], {stdio:'inherit'});
const record = JSON.parse(fs.readFileSync(path.join(workspace, 'source-fingerprints.json'), 'utf8'));
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const native = 'android/app/src/main/java/com/smartfin/';
function adapt(file, transform, reason) {
  const value = transform(fs.readFileSync(path.join(workspace, file), 'utf8'));
  fs.writeFileSync(path.join(workspace, file), value);
  record.hashes[file] = hash(value); record.adaptations[file] = reason;
}
function source(name) {
  const file = 'scripts/phase5e1/' + name;
  const value = fs.readFileSync(path.join(__dirname, name), 'utf8');
  record.originalHashes[file] = hash(value); return value;
}
const probe = source('RecoveryProbe.kt');
fs.writeFileSync(path.join(workspace, native + 'Phase5E1RecoveryProbe.kt'), probe);
record.hashes[native + 'Phase5E1RecoveryProbe.kt'] = hash(probe);
adapt(native + 'SmartFinFinancialDeletion.kt', s => s.replace('    try {\n      val pending = read(context)',
  '    try {\n      Phase5B2Probe.hit("cleanup.acquired")\n      val pending = read(context)'), 'Pause only after actual production cleanup mutex acquisition');
adapt(native + 'SmartFinSubscriptionReminderReceiver.kt', s => s
  .replace('try { SmartFinFinancialDeletion.recover(context)', 'try { Phase5E1RecoveryProbe.before(); SmartFinFinancialDeletion.recover(context)')
  .replace('executor.shutdown()', 'executor.shutdown(); Phase5E1RecoveryProbe.finished()'),
  'Unexpected exception injection before recover; completion observation only; no uncaught exception handler');
const methods = source('RecoveryMethods.kt.txt');
adapt(native + 'Phase5B2Package.kt', s => s.replace('  @ReactMethod fun inspect(', methods + '\n  @ReactMethod fun inspect('),
  'Real concurrent recover/receiver/WorkManager and read-only SQL diagnostic replay');
const harness = source('androidHarness.js');
fs.writeFileSync(path.join(workspace, 'fixHarness.js'), harness);
record.hashes['fixHarness.js'] = hash(harness);
const baseline = fs.readFileSync(path.join(__dirname, '../../__tests__/helpers/transactionHistoryBaseline.ts'), 'utf8');
record.originalHashes['__tests__/helpers/transactionHistoryBaseline.ts'] = hash(baseline);
fs.writeFileSync(path.join(workspace, 'historyBaseline.ts'), baseline.replace("'../../src/", "'./src/"));
record.hashes['historyBaseline.ts'] = hash(baseline.replace("'../../src/", "'./src/"));
adapt('Harness.jsx', s => "import {runFixes} from './fixHarness';\n" + s.replace('async function run(campaign) {',
  "async function run(campaign) {\n  if(campaign.startsWith('phase5e1-')) { await runFixes(campaign,{owned,record,control,backup}); return; }"), '5E.1 dispatcher; previous campaigns retained');
// Test-only timers. No SQL, decisions, driver or dependencies changed by instrumentation.
adapt('src/database/managedSQLite.ts', s => s.replace('    return withDatabaseMaintenance(async owner => {',
  '    const waiting = performance.now();\n    return withDatabaseMaintenance(async owner => {\n      if (global.__phase5e1Metrics) global.__phase5e1Metrics.connectionWaitMs += performance.now() - waiting;'), 'Measure managed admission wait in synthetic APK only');
adapt('src/modules/transactions/repositories/sqliteTransactionHistory.ts', s => s
  .replace('readString, resultSetToRows,', 'readString, resultSetToRows as originalRows,')
  .replace('export const HISTORY_PAGE_SIZE', `function resultSetToRows(result) {
    const start = performance.now(); const rows = originalRows(result);
    if (global.__phase5e1Metrics) global.__phase5e1Metrics.rowMaterializationMs += performance.now() - start;
    return rows;
  }
  export const HISTORY_PAGE_SIZE`)
  .replace('if (canonical === undefined) canonical = await hasCanonicalDates(database, dateFilter.where, dateFilter.values, checkCancelled);',
    'if (canonical === undefined) { const start = performance.now(); canonical = await hasCanonicalDates(database, dateFilter.where, dateFilter.values, checkCancelled); if (global.__phase5e1Metrics) global.__phase5e1Metrics.initialCheckMs += performance.now() - start; }'), 'Timers around initial check and JS row materialization only');
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(workspace);
