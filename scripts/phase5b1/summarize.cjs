const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'docs/atomicidad-fase5b1');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const campaigns = ['core', 'restart-verify', 'close-lost', 'open-lost', 'host-destroyed', 'host-real'];
const results = [], performance = [], pending = [];
const allowPartial = process.argv.includes('--partial');
for (const api of [24, 35]) {
  for (const campaign of campaigns) {
    const directory = path.join(output, 'android', 'api' + api, campaign);
    if (!['result.json', 'environment.json', 'production-package-unchanged.json'].every(file => fs.existsSync(path.join(directory, file)))) {
      pending.push({ api, campaign });
      if (allowPartial) continue;
      throw new Error(`Campaign evidence missing: API ${api}/${campaign}`);
    }
    const report = read(path.join(directory, 'result.json'));
    const environment = read(path.join(directory, 'environment.json'));
    const unchanged = read(path.join(directory, 'production-package-unchanged.json'));
    assert(report.passed && report.cases.every(item => item.passed));
    assert.equal(report.campaign, campaign);
    assert.equal(report.config.api, api);
    assert.equal(report.config.packageId, 'com.smartfin.snapshot5b1.tests');
    assert.equal(String(report.config.uid), environment.uid);
    assert(unchanged.unchanged);
    results.push({ api, campaign, cases: report.cases.length, apkSha256: environment.apkSha256,
      report: path.relative(output, path.join(directory, 'result.json')).replaceAll('\\', '/') });
    if (campaign === 'core') {
      assert.deepEqual(report.samples.map(sample => sample.count), [1000, 10000, 100000]);
      for (const sample of report.samples) {
        assert.equal(sample.reader.count, sample.count);
        assert.equal(sample.financial.status, 'confirmed');
        performance.push(Object.assign({ api, count: sample.count, journal: sample.snapshot.journalBeforeClose },
          sample.timings, { sourceValidationMs: sample.snapshot.sourceValidationMs,
          copyMs: sample.snapshot.copyMs, validationAndHashMs: sample.snapshot.validationAndHashMs,
          readerWaitMs: sample.reader.waitMs, financialWaitMs: sample.financial.waitMs,
          bytes: sample.snapshot.bytes }));
      }
    }
  }
}
assert.equal(new Set(results.map(item => item.apkSha256)).size, 1);
const quality = read(path.join(output, 'final/quality-results.json'));
const jest = read(path.join(output, 'final/jest-results.json'));
assert(quality.results.every(item => item.exitCode === 0) && quality.changed.length === 0);
assert.equal(jest.numFailedTests, 0);
const scope = read(path.join(output, 'final/scope-audit.json'));
for (const [file, sha256] of Object.entries(scope.after))
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), sha256, 'Production changed after quality: ' + file);
const summary = { complete: pending.length === 0, pending, singleProcess: true, externalPublicationCertified: false,
  android: { campaigns: results.length, passedCases: results.reduce((sum, item) => sum + item.cases, 0), results },
  quality: { passedTests: jest.numPassedTests, passedSuites: jest.numPassedTestSuites,
    pendingTests: jest.numPendingTests, snapshots: jest.snapshot.matched, checks: quality.results },
  performance, sampleLimit: 'One synthetic instrumented sample per size/device; not percentiles or a production latency guarantee. Rollback journals skip WAL checkpoint. Reopen includes phase 1.1 verification.' };
fs.writeFileSync(path.join(output, 'validation-summary.json'), JSON.stringify(summary, null, 2));
const fmt = number => number.toFixed(2);
const rows = performance.map(item => `| ${item.api} | ${item.count.toLocaleString('es-CO')} | ${fmt(item.permissionWaitMs)} | ${item.journal === 'wal' ? fmt(item.checkpointMs) : 'n/a'} | ${fmt(item.closeMs)} | ${fmt(item.reopenMs)} | ${fmt(item.copyMs)} | ${fmt(item.sourceVerificationMs + item.sourceValidationMs + item.validationAndHashMs)} | ${fmt(item.totalMs)} | ${fmt(item.readerWaitMs)} | ${fmt(item.financialWaitMs)} |`);
fs.writeFileSync(path.join(output, 'performance.md'),
  '| API | Movimientos | Permisos ms | Checkpoint ms | Cierre ms | Reapertura ms | Copia ms | Validación previa/copia ms | Total ms | Lector ms | Financiera ms |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n' + rows.join('\n') + '\n');
console.log(JSON.stringify({ androidCampaigns: results.length, androidCases: summary.android.passedCases, jest: jest.numPassedTests, performance }, null, 2));
