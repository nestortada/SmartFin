const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const prefix = 'docs/aceptacion-fase5b2';
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const pending = [], samples = [], campaigns = [], rows = [];
const stat = values => {
  const ordered = [...values].sort((a,b) => a-b);
  return { n: values.length, min: ordered[0], median: ordered[Math.floor(ordered.length / 2)], max: ordered.at(-1), mean: values.reduce((a,b)=>a+b,0)/values.length };
};
for (const api of [24,35]) {
  for (const count of [1000,10000,100000]) {
    const names = ['seed-' + count, ...[1,2,3,4,5].map(index => 'cold-' + count + '-' + index), 'warm-' + count];
    for (const name of names) {
      const directory = `${prefix}/android/api${api}/${name}`;
      try {
        const result = read(directory + '/result.json');
        const environment = read(directory + '/environment.json');
        const unchanged = read(directory + '/production-package-unchanged.json');
        const fingerprint = read(directory + '/source-fingerprints.json');
        if (!result.passed || result.config.api !== api || !unchanged.unchanged || !result.config.processId ||
            result.config.packageId !== 'com.smartfin.snapshot5b2.tests' || environment.uid === environment.productionUid)
          throw Error('Campaign/isolation failed');
        for (const [file, expected] of Object.entries(fingerprint.originalHashes)) if (hash(file) !== expected) throw Error('Changed source: ' + file);
        if (name.startsWith('cold-') && result.samples.length !== 1) throw Error('One cold sample required');
        if (name.startsWith('warm-') && result.samples.length !== 5) throw Error('Five measured warm samples required');
        campaigns.push({ api, name, cases: result.cases.length, processId: result.config.processId, apkSha256: environment.apkSha256 });
        samples.push(...result.samples.map(sample => ({ api, ...sample })));
      } catch (error) { pending.push(directory + ': ' + String(error)); }
    }
  }
  try { const session = read(`${prefix}/android/api${api}/session.json`); if (!session.completed || !session.restored) throw Error('Session incomplete/not restored'); }
  catch (error) { pending.push(`api${api} session: ${error}`); }
}
const getters = {
  startupOpenMs: r=>r.startupOpenMs, captureMs: r=>r.timings.totalMs, permissionWaitMs: r=>r.timings.permissionWaitMs,
  checkpointBranchMs: r=>r.timings.checkpointMs, sourceJsMs: r=>r.timings.sourceVerificationMs,
  closeMs: r=>r.timings.closeMs, sourceKotlinMs: r=>r.snapshot.sourceValidationMs,
  copyAndSourceHashMs: r=>r.snapshot.copyMs, snapshotIntegrityMs: r=>r.snapshot.snapshotVerificationMs,
  destinationHashMs: r=>r.snapshot.hashMs, reopenMs: r=>r.timings.reopenMs,
  readerBarrierWaitMs: r=>r.reader.barrierWaitMs, financialBarrierWaitMs: r=>r.financial.barrierWaitMs,
  financialCompletionMs: r=>r.financial.completionMs, publicationMs: r=>r.publicationMs,
  privateRevalidationMs: r=>r.published.timings.snapshotRevalidationMs,
  csvExportMs: r=>r.published.timings.csvExportMs, componentHashMs: r=>r.published.timings.componentHashMs,
  safWriteMs: r=>r.published.timings.safWriteMs, safReadbackMs: r=>r.published.timings.safReadbackMs,
};
for (const api of [24,35]) for (const count of [1000,10000,100000]) for (const condition of ['cold','warm']) {
  const group = samples.filter(row => row.api === api && row.count === count && row.condition === condition);
  if (group.length !== 5) { pending.push(`api${api}/${count}/${condition}: five required, found ${group.length}`); continue; }
  const pids = new Set(group.map(row => row.processId));
  if ((condition === 'cold' && pids.size !== 5) || (condition === 'warm' && pids.size !== 1)) pending.push(`Process proof invalid: api${api}/${count}/${condition}`);
  for (const row of group) {
    for (const get of Object.values(getters)) if (!Number.isFinite(get(row)) || get(row) < 0) throw Error('Invalid timing');
    if (!row.measured || row.evidence.transactionRows !== count || row.evidence.cardRows !== 1 || row.evidence.receipts !== 1)
      pending.push(`Fixture mismatch api${api}/${count}/${condition}`);
  }
  rows.push({ api, count, condition, distinctProcesses: pids.size,
    stages: Object.fromEntries(Object.entries(getters).map(([key,get]) => [key, stat(group.map(get))])) });
}
let quality;
try {
  quality = read(prefix + '/quality/quality-results.json');
  if (quality.changed.length || quality.results.some(row=>row.exitCode !== 0)) pending.push('Quality incomplete');
} catch { pending.push('Quality missing'); }
const audit = read(prefix + '/source-audit.json');
if (audit.differences.length || audit.artifactDifferences.length || !audit.uiFlagFalse) pending.push('Prior evidence mismatch/flag enabled');
const output = { measurementsComplete: !pending.length, pending, measuredSamples: samples.length,
  campaigns, rows, priorEvidenceMatches: !audit.differences.length && !audit.artifactDifferences.length,
  uiFlagEnabled: false, acceptanceVerdict: 'condicionado', externalAnalystUpdated: false, phase5CImplemented: false };
fs.writeFileSync(path.join(root, prefix, 'summary.json'), JSON.stringify(output, null, 2));
fs.writeFileSync(path.join(root, prefix, 'samples.json'), JSON.stringify(samples, null, 2));
let report = '# Mediciones de aceptación 5B.2\n\nCinco primeras capturas en cinco procesos nuevos y cinco capturas tras calentamiento en un único proceso por tamaño/API. No se purgó la caché del SO ni se reinició el dispositivo. No son muestras de disco frío ni de TTI. El control evita el hash completo de inicio del harness previo para no precalentar todos los bytes. Apertura inicial y comprobación de volumen ocurren antes de capturar.\n\n';
const format = stat => `${stat.min.toFixed(2)} / ${stat.median.toFixed(2)} / ${stat.max.toFixed(2)}`;
report += '| API | Movimientos | Condición | n | Apertura inicial | Captura | Espera escritor | Fin escritor | Publicación |\n|---|---:|---|---:|---:|---:|---:|---:|---:|\n';
for (const row of rows) report += `| ${row.api} | ${row.count} | ${row.condition} | 5 | ` + ['startupOpenMs','captureMs','financialBarrierWaitMs','financialCompletionMs','publicationMs'].map(key=>format(row.stages[key])).join(' | ') + ' |\n';
report += '\nCada celda: mínimo / mediana / máximo en ms. No se estima p95 con n=5. Warm-up completo separado, no contado entre las cinco mediciones. Las cinco aperturas iniciales warm pertenecen al mismo proceso y comparten su valor de contexto; no son cinco arranques.\n\n';
report += '| API | Movimientos | Condición | Espera permiso | Checkpoint* | Fuente JS | Cierre | Fuente Kotlin | Copia+hash origen | Integridad snapshot | Hash destino | Reapertura |\n|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n';
for (const row of rows) report += `| ${row.api} | ${row.count} | ${row.condition} | ` + ['permissionWaitMs','checkpointBranchMs','sourceJsMs','closeMs','sourceKotlinMs','copyAndSourceHashMs','snapshotIntegrityMs','destinationHashMs','reopenMs'].map(key=>row.stages[key].median.toFixed(2)).join(' | ') + ' |\n';
report += '\n| API | Movimientos | Condición | Revalidación posterior | CSV | Hash componentes | Escritura SAF | Relectura SAF |\n|---|---:|---|---:|---:|---:|---:|---:|\n';
for (const row of rows) report += `| ${row.api} | ${row.count} | ${row.condition} | ` + ['privateRevalidationMs','csvExportMs','componentHashMs','safWriteMs','safReadbackMs'].map(key=>row.stages[key].median.toFixed(2)).join(' | ') + ' |\n';
report += '\nEtapas: medianas independientes, no deben sumarse como una muestra real. *Checkpoint es el coste de la rama de journal rollback; no se ejecutó WAL checkpoint en esta campaña. La validación WAL pertenece a las regresiones previas atestadas, no a una medición omitida. Fuente JS incluye puente/FK/metadatos; reapertura incluye recuperación 1.1. Publicación incluye staging, comprobaciones, metadatos y proveedor SAF local sintético; no mide Drive remoto.\n\n';
report += 'El escritor de contención es una transacción sintética que suma 1 COP a la cuenta banco después de liberar la captura. Se mide la espera antes de obtener el singleton y el tiempo hasta COMMIT; no es una medición del formulario de pago. Cada respaldo mantiene el saldo anterior, sus tablas, su tarjeta y un comprobante IA; la base viva queda exactamente +1 COP respecto a ese snapshot. No se cambiaron las verificaciones ni la exclusión de producción.\n';
fs.writeFileSync(path.join(root, prefix, 'performance.md'), report);
console.log(JSON.stringify({ measurementsComplete: output.measurementsComplete, samples: samples.length, pending }, null, 2));
if (pending.length && !process.argv.includes('--partial')) process.exitCode = 1;
