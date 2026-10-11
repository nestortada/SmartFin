const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const workspace = path.resolve(process.argv[2]);
// Phase 1's preparer enforces a new external checkout and synthetic package isolation.
execFileSync(process.execPath, [path.join(__dirname, '../androidAtomicityPhase1/prepare.js'), workspace], { stdio: 'inherit' });
fs.copyFileSync(path.join(__dirname, 'ManualCampaign.js'), path.join(workspace, 'ManualCampaign.js'));
const harnessPath = path.join(workspace, 'Harness.jsx');
let harness = fs.readFileSync(harnessPath, 'utf8');
harness = "import { manualCampaign } from './ManualCampaign';\n" + harness;
harness = harness.replace("  if (campaign === 'native-probe') {", "  if (campaign === 'phase2') return manualCampaign({ fixture, reopen, config, check });\n  if (campaign === 'native-probe') {");
harness = harness.replace('const hit = fault && sql.includes(fault.sql);', 'const hit = fault && sql.includes(fault.sql) && --fault.remaining === 0;');
harness = harness.replace('inject: (sql, phase) => {\n      fault = { sql, phase };', 'inject: (sql, phase, occurrence = 1) => {\n      fault = { sql, phase, remaining: occurrence };');
if (!harness.includes('remaining: occurrence')) throw new Error('Fault occurrence instrumentation failed');
fs.writeFileSync(harnessPath, harness);
const activityPath = path.join(workspace, 'android/app/src/main/java/com/smartfin/MainActivity.kt');
fs.writeFileSync(activityPath, fs.readFileSync(activityPath, 'utf8').replace(
  'class MainActivity : ReactActivity() {',
  `class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }`,
));
const reportPath = path.join(workspace, 'source-fingerprints.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
for (const file of [
  'Harness.jsx', 'ManualCampaign.js', 'android/app/src/main/java/com/smartfin/MainActivity.kt', 'src/database/sqliteRepositoryScope.ts',
  'src/modules/transactions/useCases/manualTransactionScope.ts',
  'src/modules/transactions/useCases/saveManualTransaction.ts',
  'src/modules/transactions/useCases/updateTransactionQuickly.ts',
  'src/modules/transactions/repositories/sqliteTransactionRepository.ts',
  'src/modules/accounts/repositories/sqliteAccountRepository.ts',
  'src/modules/creditCards/repositories/sqliteCreditCardRepository.ts',
]) report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(workspace, file))).digest('hex');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
