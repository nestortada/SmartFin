const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const workspace = path.resolve(process.argv[2]);
execFileSync(process.execPath, [path.join(__dirname, '../androidAtomicityPhase2/prepare.js'), workspace], { stdio: 'inherit' });
fs.copyFileSync(path.join(__dirname, 'PaymentCampaign.js'), path.join(workspace, 'PaymentCampaign.js'));
const harnessPath = path.join(workspace, 'Harness.jsx');
let harness = fs.readFileSync(harnessPath, 'utf8');
harness = "import { paymentCampaign } from './PaymentCampaign';\n" + harness;
harness = harness.replace("  if (campaign === 'native-probe') {", "  if (campaign === 'phase3a') return paymentCampaign({ fixture, reopen, config, check });\n  if (campaign === 'native-probe') {");
fs.writeFileSync(harnessPath, harness);
const reportPath = path.join(workspace, 'source-fingerprints.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
for (const file of ['Harness.jsx', 'PaymentCampaign.js', 'src/modules/creditCards/useCases/creditCardPaymentScope.ts', 'src/modules/creditCards/useCases/creditCardTransactionRelations.ts', 'src/modules/creditCards/ui/CreditCardsScreen.tsx']) {
  report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(workspace, file))).digest('hex');
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
