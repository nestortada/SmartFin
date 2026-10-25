// Separate API 35 attestation; preserve the already accepted API 24 evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'docs/atomicidad-fase5e');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const previous = read(path.join(output, 'summary.json'));
const android = path.join(output, 'android/api35');
const required = previous.campaigns.map(c => c.name === 'reboot-verify' ? 'reboot-verify-final2' : c.name);
// The repeat is a separately retained diagnostic campaign, never a replacement
// for the original slow sample.
if (fs.existsSync(path.join(android, 'performance-repeat/result.json'))) required.push('performance-repeat');
if (fs.existsSync(path.join(android, 'recovery-contention/result.json'))) required.push('recovery-contention');
const campaigns = [], pending = [], errors = [];
let primaryApk;
for (const name of required) {
  const folder = path.join(android, name);
  if (!fs.existsSync(path.join(folder, 'result.json'))) { pending.push(name); continue; }
  const r = read(path.join(folder, 'result.json'));
  const env = read(path.join(folder, 'environment.json'));
  const fingerprints = read(path.join(folder, 'source-fingerprints.json'));
  const production = read(path.join(folder, 'production-package-unchanged.json'));
  if (!r.passed || r.cases.some(c => !c.passed)) errors.push(name + ': ' + r.failure);
  if (Number(env.api) !== 35 || env.serial !== 'AXCC6R3919012932' || env.package !== 'com.smartfin.snapshot5b2.tests' ||
      env.uid === env.productionUid || !production.unchanged ||
      r.config.database !== '/data/user/0/com.smartfin.snapshot5b2.tests/databases/phase5b2_synthetic.db') errors.push(name + ': isolation');
  if (name !== 'contender-payment' && name !== 'recovery-contention') {
    if (primaryApk && primaryApk !== env.apkSha256) errors.push(name + ': primary APK mismatch');
    primaryApk = env.apkSha256;
  }
  for (const [file, digest] of Object.entries(fingerprints.originalHashes)) if (sha(path.join(root, file)) !== digest) errors.push(name + ': source changed ' + file);
  const failedMeasurements = r.cases.filter(c => c.evidence && c.evidence.historyOutcome && c.evidence.historyOutcome.status === 'failed').map(c => ({ case: c.name, ...c.evidence.historyOutcome }));
  for (const c of r.cases.filter(item => item.evidence && item.evidence.count && item.evidence.times)) {
    const e = c.evidence;
    if (Math.max(e.times.captureMs, e.times.concurrentAdmissionWaitMs) > (e.count <= 10000 ? 2000 : 6000) || e.times.publicationMs > 20000) {
      failedMeasurements.push({ case: c.name, status: 'exceeded-provisional-budget', count: e.count, times: e.times });
    }
  }
  const observedDefects = r.cases.filter(c => c.evidence && c.evidence.expectedProductionDefect).map(c => c.evidence.expectedProductionDefect);
  campaigns.push({ name, campaign: r.campaign, group: name === 'contender-payment' ? 'supplemental-real-financial-contender' : name === 'recovery-contention' ? 'diagnostic-production-defect' : 'primary',
    harnessCompleted: r.passed, fullAcceptancePassed: r.passed && !failedMeasurements.length && !observedDefects.length, failedMeasurements, observedDefects, controls: r.cases.length, apkSha256: env.apkSha256 });
}
function performanceSamples(file) {
  return fs.existsSync(file) ? read(file).cases.filter(c => c.name.startsWith('integrated-performance-')).map(c => {
  const e = c.evidence;
  return { count: e.count, times: e.times, historyOutcome: e.historyOutcome, captureTimings: e.captured.timings,
    publicationTimings: e.publication.timings, datasetCounts: e.after.allTables && e.after.allTables.transactions && e.after.allTables.transactions.count,
    budgets: { captureAndAdmissionWithinProvisional: Math.max(e.times.captureMs, e.times.concurrentAdmissionWaitMs) <= (e.count <= 10000 ? 2000 : 6000), publicationWithinProvisional: e.times.publicationMs <= 20000 } };
  }) : [];
}
const samples = performanceSamples(path.join(android, 'performance-final/result.json'));
const repeatSamples = performanceSamples(path.join(android, 'performance-repeat/result.json'));
const provisionalBudgetBreaches = [
  ...samples.map(sample => ({ campaign: 'performance-final', sample })),
  ...repeatSamples.map(sample => ({ campaign: 'performance-repeat', sample })),
].filter(({ sample }) => !sample.budgets.captureAndAdmissionWithinProvisional || !sample.budgets.publicationWithinProvisional);
const qualityPath = path.join(output, 'honor-final/quality-results.json');
const quality = fs.existsSync(qualityPath) ? read(qualityPath) : null;
if (!quality) pending.push('Final HONOR quality run not recorded');
else if (quality.changed.length || quality.results.some(r => r.exitCode !== 0)) errors.push('Final quality checks failed');
const rebootPath = path.join(android, 'reboot-verify-final2/result.json');
const rebootCase = fs.existsSync(rebootPath) ? read(rebootPath).cases.find(c => c.evidence && c.evidence.automaticAlarm !== undefined) : undefined;
const reboot = rebootCase && rebootCase.evidence;
const bootBefore = path.join(output, 'honor-boot-before.json'), bootAfter = path.join(output, 'honor-boot-after.json');
let bootVerified = false, automaticRecoveryCredited = false;
if (fs.existsSync(bootBefore) && fs.existsSync(bootAfter)) {
  const before = read(bootBefore), after = read(bootAfter);
  bootVerified = before.physicalRebootAuthorized === true && after.completed === '1' && before.bootId !== after.bootId;
  automaticRecoveryCredited = bootVerified && after.beforeHarnessLaunch === true && after.automaticRecoveryCredited === true;
}
if (!bootVerified) pending.push('Physical reboot not yet verified');
if (!automaticRecoveryCredited) pending.push('HONOR automatic reboot repair not credited; explicit harness recovery is separate');
if (samples.length !== 3) pending.push('Incomplete 1k/10k/100k measurements');
const baseline = read(path.join(output, 'baseline/scope-audit.json'));
const changedInitialFiles = Object.keys(baseline.before).filter(file => sha(path.join(root, file)) !== baseline.before[file]);
if (changedInitialFiles.length) errors.push('Initial protected source changed');
const summary = { verdict: 'bloqueado', complete: false, device: 'HONOR CRT-NX3 API 35', campaigns, nativeApi35Campaigns: campaigns.length,
  campaignExecutionComplete: required.every(name => campaigns.some(c => c.name === name)),
  nativeApi35Controls: campaigns.reduce((sum, c) => sum + c.controls, 0), samples, repeatSamples, provisionalBudgetBreaches, quality, bootVerified,
  rebootObservation: reboot ? { automaticAlarm: reboot.automaticAlarm, automaticRecoveryCredited, explicitRecoveryMs: reboot.recoveryMs } : null,
  pending, errors, changedInitialFiles, productionDefects: ['5E-001 remains open in API 24', '5E-002 unhandled recovery contention crashes process'],
  excludedAttempt: { folder: 'android/api35/reboot-verify', reason: 'Actual APP CRASH: Cleanup already running; no accepted result',
    evidence: 'honor-reboot-dropbox.txt', successfulExplicitRetry: 'android/api35/reboot-verify-final2' },
  unresolvedSharedConditions: ['External weekly analyst and authorized epoch context', 'Production AppNavigator foreground UI recovery end-to-end', 'API 24 automatic reboot repair not credited',
    '100k history/dashboard latency needs acceptance; HONOR 100k admission exceeded provisional 6s in one of two samples'],
  backupPublicationUiEnabled: false, distributionAuthorized: false, externalAnalystUpdated: false };
fs.writeFileSync(path.join(output, 'summary-api35.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(output, 'summary-integrated.json'), JSON.stringify({ verdict: 'bloqueado', complete: false,
  api24: { campaigns: previous.nativeApi24Campaigns, controls: previous.nativeApi24Controls, source: 'summary.json' },
  api35: { campaigns: summary.nativeApi35Campaigns, controls: summary.nativeApi35Controls, source: 'summary-api35.json' },
  totalCampaigns: previous.nativeApi24Campaigns + summary.nativeApi35Campaigns,
  totalControls: previous.nativeApi24Controls + summary.nativeApi35Controls,
  errors: [...previous.errors, ...errors], productionDefects: ['5E-001', '5E-002'], pending: [...pending, ...summary.unresolvedSharedConditions],
  backupPublicationUiEnabled: false, distributionAuthorized: false, externalAnalystUpdated: false }, null, 2));
console.log(JSON.stringify({ campaigns: campaigns.length, controls: summary.nativeApi35Controls, errors, pending }));
if (errors.length) process.exitCode = 1;
