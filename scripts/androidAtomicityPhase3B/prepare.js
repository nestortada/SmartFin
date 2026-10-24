const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const workspace = path.resolve(process.argv[2]);
execFileSync(process.execPath, [path.join(__dirname, '../androidAtomicityPhase3A/prepare.js'), workspace], { stdio: 'inherit' });
fs.copyFileSync(path.join(__dirname, 'ManagementCampaign.js'), path.join(workspace, 'ManagementCampaign.js'));
fs.copyFileSync(path.join(__dirname, '../androidAtomicityPhase3A1/SqlProfile.js'), path.join(workspace, 'SqlProfile.js'));
fs.mkdirSync(path.join(workspace, 'baseline'));
for (const file of ['phase3BManageCreditCards.ts', 'phase3BCreditCardRelations.ts']) {
  fs.writeFileSync(path.join(workspace, 'baseline', file), fs.readFileSync(path.resolve('__tests__/helpers', file), 'utf8').replaceAll("'../../src/", "'../src/"));
}
const harnessPath = path.join(workspace, 'Harness.jsx');
let harness = fs.readFileSync(harnessPath, 'utf8').replace(/\r\n/g, '\n');
harness = "import { managementCampaign } from './ManagementCampaign';\nimport { profileDatabase, wallClockNow } from './SqlProfile';\n" + harness;
harness = harness.replace('async function fixture() {', 'async function fixture(deterministic = false) {');
harness = harness.replace('${Date.now()}_${sequence++}', '${wallClockNow()}_${sequence++}');
const split = harness.indexOf('async function reopen(');
harness = harness.slice(0, split).replace('const raw = await openConfirmedSQLiteConnection({', 'const opened = await openConfirmedSQLiteConnection({') + harness.slice(split);
harness = harness.replace('  for (const sql of SQLITE_SCHEMA_STATEMENTS)', '  const raw = profileDatabase(opened, deterministic);\n  for (const sql of SQLITE_SCHEMA_STATEMENTS)');
harness = harness.replace("  if (campaign === 'native-probe') {", "  if (campaign === 'phase3b') return managementCampaign({ fixture: () => fixture(true), reopen, config, check });\n  if (campaign === 'native-probe') {");
if (!harness.includes('const raw = profileDatabase(opened, deterministic)')) throw new Error('Clock instrumentation failed');
fs.writeFileSync(harnessPath, harness);
const reportPath = path.join(workspace, 'source-fingerprints.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
report.testOnlyClock = true;
report.originalHashes = {};
for (const file of ['Harness.jsx', 'ManagementCampaign.js', 'SqlProfile.js',
  'baseline/phase3BManageCreditCards.ts', 'baseline/phase3BCreditCardRelations.ts',
  'src/modules/creditCards/useCases/creditCardManagementScope.ts',
  'src/modules/creditCards/useCases/creditCardManagementCommands.ts',
  'src/modules/creditCards/useCases/manageCreditCards.ts',
  'src/modules/creditCards/repositories/readUnclassifiedCreditTransactions.ts',
  'src/modules/creditCards/repositories/readCreditCardReconciliationTransactions.ts',
  'src/modules/creditCards/repositories/sqliteCreditCardAlertRepository.ts',
  'src/modules/creditCards/ui/components/CreditCardPayment.tsx',
  'src/modules/transactions/ui/TransactionsScreen.tsx']) {
  report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(workspace, file))).digest('hex');
  if (fs.existsSync(path.resolve(file))) report.originalHashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
