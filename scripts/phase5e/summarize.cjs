const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'docs/atomicidad-fase5e');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const android = path.join(output, 'android/api24');
const names = fs.existsSync(android) ? fs.readdirSync(android).filter(name => name.startsWith('regression-') || ['integrated-final2', 'restart-final2', 'performance-final', 'reboot-stage', 'reboot-verify', 'contender-payment'].includes(name)) : [];
const campaigns = [], pending = [], errors = [];
let apk;
for (const name of names) {
  const folder = path.join(android, name);
  if (!fs.existsSync(path.join(folder, 'result.json'))) { pending.push(name + ': no result'); continue; }
  const result = read(path.join(folder, 'result.json'));
  const environment = read(path.join(folder, 'environment.json'));
  const source = read(path.join(folder, 'source-fingerprints.json'));
  const unchanged = read(path.join(folder, 'production-package-unchanged.json'));
  if (!result.passed || result.cases.some(c => !c.passed)) errors.push(name + ': ' + result.failure);
  if (environment.package !== 'com.smartfin.snapshot5b2.tests' || Number(environment.api) !== 24 ||
      environment.uid === environment.productionUid || !unchanged.unchanged ||
      result.config.database !== '/data/user/0/com.smartfin.snapshot5b2.tests/databases/phase5b2_synthetic.db') errors.push(name + ': isolation');
  if (name !== 'contender-payment') {
    if (apk && apk !== environment.apkSha256) errors.push(name + ': different primary APK');
    apk = environment.apkSha256;
  }
  for (const [file, digest] of Object.entries(source.originalHashes)) {
    if (hash(path.join(root, file)) !== digest) errors.push(name + ': stale source ' + file);
  }
  const failedMeasurements = result.cases.filter(c => c.evidence?.historyOutcome?.status === 'failed').map(c => ({ case: c.name, ...c.evidence.historyOutcome }));
  campaigns.push({ name, campaign: result.campaign, group: name === 'contender-payment' ? 'supplemental-real-financial-contender' : 'primary', harnessCompleted: result.passed, failedMeasurements,
    fullAcceptancePassed: result.passed && failedMeasurements.length === 0, controls: result.cases.length, apkSha256: environment.apkSha256 });
}
const required = ['integrated-final2', 'restart-final2', 'performance-final', 'reboot-stage', 'reboot-verify', 'contender-payment',
  ...['notifications','denied','worker-headless','kill-beforeNotify','restart-beforeNotify','kill-afterNotify','restart-afterNotify','kill-afterAck','restart-afterAck',
    'process-stage','process-restart','notification-epoch','deletion-rollback','cleanup-faults','deletion-lost-before','deletion-unknown-restart','deletion-lost-after','deletion-confirmed-restart',
    'core','restart-verify','publication','publication-restart-verify','publication-after-verify','close-lost','open-lost'].map(name => 'regression-' + name)];
for (const name of required) {
  if (!campaigns.some(c => c.name === name)) pending.push(name);
}
const baseline = read(path.join(output, 'baseline/scope-audit.json'));
const changedInitialFiles = Object.keys(baseline.before).filter(file => hash(path.join(root, file)) !== baseline.before[file]);
if (changedInitialFiles.length) errors.push('Initial protected source changed');
const quality = read(path.join(output, 'closure/quality-results.json'));
if (quality.results.some(r => r.exitCode !== 0)) errors.push('Final quality');
const node = read(path.join(output, 'node/integration.json'));
const nodeMatrices = Object.fromEntries(Object.entries(node).filter(([, v]) => v.positions).map(([k, v]) => [k, { writes: Array.isArray(v.writes) ? v.writes.length : v.writes, positions: v.positions.length }]));
const performanceFile = path.join(android, 'performance-final/result.json');
const samples = fs.existsSync(performanceFile) ? read(performanceFile).cases.filter(c => c.name.startsWith('integrated-performance-')).map(c => {
  const e = c.evidence;
  return { count: e.count, times: e.times, historyOutcome: e.historyOutcome, captureTimings: e.captured.timings,
    publicationTimings: e.publication.timings,
    budgets: { captureAndAdmissionWithinProvisional: Math.max(e.times.captureMs, e.times.concurrentAdmissionWaitMs) <= (e.count <= 10000 ? 2000 : 6000), publicationWithinProvisional: e.times.publicationMs <= 20000 },
    datasetCounts: e.after.allTables?.transactions?.count };
}) : [];
if (samples.length !== 3) pending.push('Incomplete 1k/10k/100k measurement campaign');
pending.push('5E-001: API 24 paginated history expression-index hint fails with no query solution; production fix not applied',
  'External weekly analyst integration and authorized external epoch context',
  'Production AppNavigator foreground recovery end-to-end in isolated UI not exercised');
const rebootFile = path.join(android, 'reboot-verify/result.json');
const reboot = fs.existsSync(rebootFile) ? read(rebootFile).cases.find(c => c.evidence?.automaticAlarm !== undefined)?.evidence : undefined;
if (reboot?.automaticAlarm === false) pending.push('API 24 automatic alarm repair was not observed before explicit harness recovery; no automatic success claimed');
const gate = fs.readFileSync(path.join(root, 'src/modules/settings/services/backupPublicationPolicy.ts'), 'utf8');
if (!/BACKUP_PUBLICATION_UI_ENABLED\s*=\s*false/.test(gate)) errors.push('Publication gate');
const summary = { verdict: 'bloqueado', complete: false, nativeApi24Campaigns: campaigns.length,
  productionDefects: ['5E-001'],
  nativeApi24Controls: campaigns.reduce((n, c) => n + c.controls, 0), campaigns, nodeMatrices,
  nodeUnknownResults: Object.fromEntries(Object.entries(node).filter(([key]) => key.startsWith('unknown-'))),
  financialFinalMetrics: node.scenario?.at(-1)?.state.metrics, samples, pending, errors,
  rebootObservation: reboot ? { automaticAlarm: reboot.automaticAlarm, explicitRecoveryMs: reboot.recoveryMs } : null,
  initialProtectedFiles: Object.keys(baseline.before).length, changedInitialFiles,
  sourceCodeEffect: 'Acceptance harness and documentation only; no production changes',
  backupPublicationUiEnabled: false, distributionAuthorized: false, externalAnalystUpdated: false,
  scopeNote: 'API 24 inventory; subsequent HONOR results are tracked in summary-api35.json and summary-integrated.json. Historical phase evidence is context, not counted as a new 5E campaign. Provisional latency targets are not universal guarantees.' };
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ verdict: summary.verdict, campaigns: campaigns.length, controls: summary.nativeApi24Controls, errors, pending }));
if (errors.length) process.exitCode = 1;
