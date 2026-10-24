const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/atomicidad-fase5b2');
const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const campaigns = ['publication', 'publication-restart-verify', 'publication-after-verify', 'core', 'restart-verify',
  'close-lost', 'open-lost', 'host-destroyed', 'host-real', 'publication-performance',
  ...['before', 'after', 'captured'].flatMap(stage => ['publication-kill-' + stage, 'publication-recover-' + stage])];
const pending = [], completed = [], samples = [];
const quality = json('docs/atomicidad-fase5b2/final/quality-results.json');
const finalSources = json('docs/atomicidad-fase5b2/final/scope-audit.json').after;
const baseline = json('docs/atomicidad-fase5b2/baseline/scope-audit.json').before;
const sourceChanges = Object.keys(finalSources).filter(file => baseline[file] !== finalSources[file])
  .map(file => ({ file, added: !baseline[file], before: baseline[file], after: finalSources[file] }));
for (const [file, sha] of Object.entries(finalSources)) if (hash(file) !== sha) pending.push('Source changed since quality: ' + file);
for (const api of [24, 35]) {
  for (const campaign of campaigns) {
    const directory = 'docs/atomicidad-fase5b2/android/api' + api + '/' + campaign;
    try {
      const result = json(directory + '/result.json');
      const environment = json(directory + '/environment.json');
      const unchanged = json(directory + '/production-package-unchanged.json');
      const fingerprints = json(directory + '/source-fingerprints.json');
      if (!result.passed || result.config.api !== api || !unchanged.unchanged || environment.uid === environment.productionUid ||
          result.config.packageId !== 'com.smartfin.snapshot5b2.tests') throw Error('Campaign/isolation failed');
      // Several instrumented APKs are allowed; every production source and driver
      // must match final bytes. Frozen harness adaptations remain in each attestation.
      const mismatches = Object.entries(fingerprints.originalHashes)
        .filter(([file]) => file.startsWith('src/') || file.startsWith('android/app/src/') || file.startsWith('node_modules/react-native-sqlite-storage/'))
        .filter(([file, sha]) => hash(file) !== sha);
      if (mismatches.length) throw Error('Production sources differ: ' + mismatches.map(([file]) => file).join(', '));
      completed.push({ api, campaign, cases: result.cases.length, apkSha256: environment.apkSha256, uid: environment.uid });
      if (campaign === 'publication-performance') {
        if (result.samples.length !== 9) throw Error('Nine performance samples required');
        samples.push(...result.samples.map(sample => ({ api, ...sample })));
      }
    } catch (error) { pending.push(directory + ': ' + String(error)); }
  }
}
if (quality.results.some(result => result.exitCode !== 0) || quality.changed.length) pending.push('Quality incomplete');
const summary = { complete: !pending.length, pending, campaigns: completed, totalCases: completed.reduce((sum, row) => sum + row.cases, 0),
  sourceChanges, uiEnabled: false, phase5CStarted: false };
fs.writeFileSync(path.join(out, 'validation-summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(out, 'performance-samples.json'), JSON.stringify(samples, null, 2));
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
const range = values => Math.min(...values).toFixed(2) + '–' + Math.max(...values).toFixed(2);
let report = '# Mediciones sintéticas de fase 5B.2\n\nTres muestras consecutivas por tamaño/API, sin optimizar ni reducir la barrera. Rangos en ms; no son percentiles ni un SLA.\n\n';
report += '| API | Movimientos | Captura total | Lector | Operación financiera | Publicación (fuera de barrera) |\n|---|---:|---:|---:|---:|---:|\n';
for (const api of [24,35]) for (const count of [1000,10000,100000]) {
  const rows = samples.filter(row => row.api === api && row.count === count);
  if (rows.length !== 3) continue;
  report += `| ${api} | ${count} | ${range(rows.map(r => r.timings.totalMs))} | ${range(rows.map(r => r.reader.waitMs))} | ${range(rows.map(r => r.financial.waitMs))} | ${range(rows.map(r => r.publicationMs))} |\n`;
}
report += '\nMediana de cada etapa en ms (medianas independientes; no sumarlas como si fueran una muestra):\n\n';
report += '| API | Movimientos | Espera permiso | Checkpoint | Fuente JS | Cierre | Fuente Kotlin | Copia + hash origen | Integridad snapshot | Hash destino | Reapertura | Revalidación privada posterior | CSV | Hash componentes | SAF escritura | SAF relecturas |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n';
for (const api of [24,35]) for (const count of [1000,10000,100000]) {
  const rows = samples.filter(row => row.api === api && row.count === count);
  if (rows.length !== 3) continue;
  const value = fn => median(rows.map(fn)).toFixed(2);
  report += `| ${api} | ${count} | ` + [r=>r.timings.permissionWaitMs, r=>r.timings.checkpointMs, r=>r.timings.sourceVerificationMs,
    r=>r.timings.closeMs, r=>r.snapshot.sourceValidationMs, r=>r.snapshot.copyMs, r=>r.snapshot.snapshotVerificationMs,
    r=>r.snapshot.hashMs, r=>r.timings.reopenMs, r=>r.published.timings.snapshotRevalidationMs,
    r=>r.published.timings.csvExportMs, r=>r.published.timings.componentHashMs, r=>r.published.timings.safWriteMs,
    r=>r.published.timings.safReadbackMs].map(value).join(' | ') + ' |\n';
}
report += '\nEl checkpoint de estas muestras es el coste de comprobar un journal rollback; no se ejecutó WAL checkpoint. La campaña core conserva el escenario WAL aparte. Fuente JS incluye puente, integridad/FK y metadatos. La reapertura incluye la recuperación verificada de 1.1. SAF se mide contra un proveedor sintético local, sin red. El total de publicación incluye staging, metadatos y descubrimiento además de sus etapas. La relectura SAF incluye la pasada final de todos los componentes.\n\n';
report += 'Las diferencias respecto a la muestra histórica HONOR de 16.820,74 ms no acreditan una optimización: se conserva el algoritmo, y no se controlaron energía, cachés, temperatura o carga de igual forma. Persisten esperas perceptibles. La UI requiere aceptación explícita; no se declara lista para distribución ni mejora de FPS/TTI.\n';
fs.writeFileSync(path.join(out, 'performance.md'), report);
process.stdout.write(JSON.stringify({ complete: summary.complete, cases: summary.totalCases, pending }, null, 2) + '\n');
if (pending.length && !process.argv.includes('--partial')) process.exitCode = 1;
