const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
const current = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const prior = read('docs/atomicidad-fase5b2/final/scope-audit.json').after;
const differences = Object.entries(prior).filter(([file, hash]) => current(file) !== hash).map(([file]) => file);
const summary = read('docs/atomicidad-fase5b2/validation-summary.json');
const artifactDifferences = [];
for (const campaign of summary.campaigns) {
  const fingerprint = read(`docs/atomicidad-fase5b2/android/api${campaign.api}/${campaign.campaign}/source-fingerprints.json`);
  for (const [file, hash] of Object.entries(fingerprint.originalHashes))
    if (current(file) !== hash) artifactDifferences.push({ api: campaign.api, campaign: campaign.campaign, file });
}
const flag = fs.readFileSync(path.join(root, 'src/modules/settings/services/backupPublicationPolicy.ts'), 'utf8');
const output = { priorComplete: summary.complete, priorCases: summary.totalCases, priorCampaigns: summary.campaigns.length,
  comparedFiles: Object.keys(prior).length, differences, artifactDifferences,
  uiFlagFalse: /export const BACKUP_PUBLICATION_UI_ENABLED = false;/.test(flag),
  productionChangesAuthorized: false, financialDeltasExpected: 0 };
fs.mkdirSync(path.join(root, 'docs/aceptacion-fase5b2'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/aceptacion-fase5b2/source-audit.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output));
if (differences.length || artifactDifferences.length || !output.uiFlagFalse || !summary.complete) process.exitCode = 1;
