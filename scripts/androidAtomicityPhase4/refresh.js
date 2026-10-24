// Refresh an already prepared synthetic checkout before recompiling; never touches devices.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const workspace = path.resolve(process.argv[2]);
const reportPath = path.join(workspace, 'source-fingerprints.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.packageId !== 'com.smartfin.atomicityphase1.tests') throw new Error('Synthetic package required');
function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file.replaceAll('\\', '/')];
  });
}
for (const file of sourceFiles('src')) {
  const source = fs.readFileSync(path.resolve(file));
  report.originalHashes[file] = crypto.createHash('sha256').update(source).digest('hex');
  const content = file.endsWith('/subscriptionRuntime.ts')
    ? source.toString().replace("from '../../../database/sqliteDatabase'", "from '../../../database/phase4RuntimeDatabase'") : source;
  fs.writeFileSync(path.join(workspace, file), content);
  report.hashes[file] = crypto.createHash('sha256').update(content).digest('hex');
}
fs.copyFileSync(path.join(__dirname, 'AiSubscriptionCampaign.js'), path.join(workspace, 'AiSubscriptionCampaign.js'));
const harnessPath = path.join(workspace, 'Harness.jsx');
let harness = fs.readFileSync(harnessPath, 'utf8');
if (!harness.includes('receiptRestartCampaign')) {
  harness = harness.replace('import { aiSubscriptionCampaign }', 'import { aiSubscriptionCampaign, receiptRestartCampaign }');
  harness = harness.replace("const campaign = launch?.split('/').pop() || 'core';", "const campaign = (launch?.split('/').pop() || 'core').split('?')[0];");
  harness = harness.replace("  if (campaign === 'native-probe') {", "  if (campaign.startsWith('phase4-restart-')) return receiptRestartCampaign({ fixture: () => fixture(true), reopen, config, check, campaign, launch });\n  if (campaign === 'native-probe') {");
  fs.writeFileSync(harnessPath, harness);
}
for (const file of Object.keys(report.hashes)) report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(workspace, file))).digest('hex');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
