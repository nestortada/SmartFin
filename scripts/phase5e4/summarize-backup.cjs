// Summarizes 5E.4 backup profiles: per label/API/size, the three rounds and their stages.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../docs/optimizacion-fase5e4/android');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
const r = v => typeof v === 'number' ? Math.round(v) : v;
const out = {};
for (const api of ['api24', 'api35']) {
  const dir = path.join(root, api);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir).filter(n => /^(baseline|optimized)-backup-\d+$/.test(n)).sort()) {
    const file = path.join(dir, name, 'result.json');
    if (!fs.existsSync(file)) continue;
    const result = read(file);
    const rounds = result.cases.filter(c => /-round-\d$/.test(c.name)).map(c => {
      const e = c.evidence, p = e.publishedTimings ?? {}, n = e.nativeCapture ?? {}, t = e.captureTimings ?? {};
      const annual = (p.csvFiles ?? []).filter(f => f.name.startsWith('movimientos-'));
      return {
        captureMs: r(e.times.captureMs), admissionWaitMs: r(e.times.financialAdmissionWaitMs), publicationMs: r(e.times.publicationMs),
        js: {checkpoint: r(t.checkpointMs), sourceVerification: r(t.sourceVerificationMs), fk: r(t.sourceDescribe?.foreignKeyCheckMs),
          integrity: r(t.sourceDescribe?.integrityCheckMs), metadata: r(t.sourceDescribe?.metadataMs), close: r(t.closeMs), reopen: r(t.reopenMs)},
        native: {total: r(n.nativeTotalMs), sourceValidation: r(n.sourceValidationMs), sourceIntegrity: r(n.sourceDescribe?.integrityCheckMs),
          sourceFk: r(n.sourceDescribe?.foreignKeyCheckMs), copy: r(n.copyMs), snapshotIntegrity: r(n.snapshotDescribe?.integrityCheckMs),
          snapshotFk: r(n.snapshotDescribe?.foreignKeyCheckMs), validationAndHash: r(n.validationAndHashMs), bytes: n.bytes},
        publish: {revalidation: r(p.snapshotRevalidationMs), revalidationHash: r(p.snapshotHashMs), revalidationIntegrity: r(p.snapshotDescribe?.integrityCheckMs),
          csv: r(p.csvExportMs), csvAnnual: r(annual.reduce((s, f) => s + f.ms, 0)), csvFixed: r((p.csvFiles ?? []).filter(f => !f.name.startsWith('movimientos-')).reduce((s, f) => s + f.ms, 0)),
          maxYearMs: r(Math.max(0, ...annual.map(f => f.ms))), hash: r(p.componentHashMs), safWrite: r(p.safWriteMs), safReadback: r(p.safReadbackMs),
          manifest: r(p.manifestWriteAndReadMs), finalValidation: r(p.finalComponentValidationMs), jobSave: r(p.jobSaveMs), jobSaves: p.jobSaves},
        legacyExportMs: r(e.legacyExportMs), files: e.fileCount, annualCsv: e.annualCsv, identical: e.csvIdenticalToFrozen5E3,
      };
    });
    out[`${api}/${name}`] = {passed: result.passed, rounds};
  }
}
fs.writeFileSync(path.join(root, 'backup-summary.json'), JSON.stringify(out, null, 2));
for (const [key, value] of Object.entries(out)) {
  console.log(key, value.passed ? '' : 'FAILED');
  for (const x of value.rounds) console.log('  capture', x.captureMs, 'wait', x.admissionWaitMs, 'pub', x.publicationMs, '| js', JSON.stringify(x.js), '| native', JSON.stringify(x.native), '| pub', JSON.stringify(x.publish), '| legacyCsv', x.legacyExportMs, 'files', x.files, 'identical', x.identical);
}
