const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'docs/performance/post3b');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const n = sorted.length; const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return { n, median: (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2,
    min: sorted[0], max: sorted[n - 1], mean,
    standardDeviation: Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n) };
}
const campaigns = []; const groups = new Map(); const probes = []; const transactionViolations = [];
for (const dir of fs.readdirSync(output).filter(name => /^final-api(24|35)-/.test(name))) {
  const file = path.join(output, dir, 'result.json');
  if (!fs.existsSync(file)) continue;
  const result = read(file); const environment = read(path.join(output, dir, 'environment.json'));
  const production = read(path.join(output, dir, 'production-package-unchanged.json'));
  campaigns.push({ directory: dir, api: environment.api, campaign: result.campaign, passed: result.passed,
    cases: result.cases?.length, failures: result.cases?.filter(c => !c.passed), sqlite: result.sqlite,
    productionPackageUnchanged: production.unchanged });
  for (const probe of result.probes ?? []) probes.push({ api: environment.api, campaign: result.campaign, ...probe });
  for (const sample of result.samples ?? []) {
    if (sample.variant === 'after') {
      const controls = word => Object.entries(sample.sql).filter(([label]) => label.endsWith(': ' + word)).reduce((sum, [, group]) => sum + group.count, 0);
      if (sample.error || controls('BEGIN') !== 1 || controls('COMMIT') !== 1 || controls('ROLLBACK') !== 0 || Object.values(sample.sql).some(group => group.maxParameters > 999)) {
        transactionViolations.push({ directory: dir, operation: sample.operation, spec: sample.spec, error: sample.error?.slice(0, 200), begin: controls('BEGIN'), commit: controls('COMMIT'), rollback: controls('ROLLBACK') });
      }
    }
    if (sample.warmup || sample.literalOracle) continue;
    const key = JSON.stringify({ api: environment.api, operation: sample.operation, spec: sample.spec, variant: sample.variant });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
}
const measurements = [...groups].map(([key, samples]) => {
  const stages = [...new Set(samples.flatMap(s => s.stages.map(stage => stage.name)))];
  const sql = [...new Set(samples.flatMap(s => Object.keys(s.sql)))];
  return { ...JSON.parse(key), errors: samples.filter(s => s.error).map(s => s.error.slice(0, 220)),
    operationMs: stats(samples.map(s => s.operationMs)), transactionMs: stats(samples.map(s => s.transactionMs)),
    readerMs: stats(samples.map(s => s.readerMs)), connectionWaitMs: stats(samples.map(s => s.connectionWaitMs)),
    readerTiming: samples.every(s => s.readerTiming === 'completion-captured') ? 'completion-captured' : 'legacy interval measured after awaiting writer; not proof of reader blocking',
    readerQueueMs: stats(samples.map(s => s.queueWaitsMs?.[1])),
    stages: Object.fromEntries(stages.map(name => [name, stats(samples.map(s => s.stages.filter(stage => stage.name === name).reduce((sum, stage) => sum + stage.ms, 0)))])),
    sql: Object.fromEntries(sql.map(name => [name, { ms: stats(samples.map(s => s.sql[name]?.ms ?? 0)),
      count: stats(samples.map(s => s.sql[name]?.count ?? 0)), rows: stats(samples.map(s => s.sql[name]?.rows ?? 0)),
      maxParameters: Math.max(...samples.map(s => s.sql[name]?.maxParameters ?? 0)) }])),
    memory: Object.fromEntries(['peakPssKb', 'peakJavaBytes', 'peakNativeAllocatedBytes', 'samples'].map(name => [name, stats(samples.map(s => s.memory?.[name]))])),
    jsMemoryAvailable: samples.every(s => s.jsMemoryAfter?.available),
    hermes: Object.fromEntries(['js_allocatedBytes', 'js_heapSize', 'js_totalAllocatedBytes', 'js_numGCs', 'js_gcTime', 'js_gcCPUTime'].map(name => [name, {
      after: stats(samples.map(s => s.jsMemoryAfter?.stats?.[name])),
      delta: stats(samples.map(s => typeof s.jsMemoryAfter?.stats?.[name] === 'number' && typeof s.jsMemoryBefore?.stats?.[name] === 'number' ? s.jsMemoryAfter.stats[name] - s.jsMemoryBefore.stats[name] : undefined)),
    }])),
  };
});
const baseline = read(path.join(output, 'baseline/source-hashes.json'));
const changedSinceBaseline = Object.entries(baseline).filter(([file, hash]) => fs.existsSync(path.join(root, file)) && crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') !== hash).map(([file]) => file);
const summary = { generatedAt: new Date().toISOString(), campaigns, measurements, probes, changedSinceBaseline, transactionViolations,
  notes: ['Warmups and synthetic literal oracle excluded from statistics.', 'Standard deviation is population SD of the recorded samples.',
    'Driver spans overlap and include scheduling/conversion/bridge; do not sum as exclusive CPU/SQLite components.',
    'PSS/Java/native process peaks are sampled every 100 ms; JavaScript counters may be unavailable.'] };
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
const fixed = value => Number.isFinite(value) ? value.toFixed(2) : '—';
const table = ['# Mediciones repetidas post-3B', '',
  'Milisegundos. Calentamientos y oráculo excluidos; las filas con error no representan una operación exitosa.', '',
  '| API | Operación | Fixture | Versión | n | Mediana | Mín.–máx. | DE | BEGIN/finalización | Intervalo lector | Cola inicial | Errores |',
  '|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
for (const m of measurements) table.push(`| ${m.api} | ${m.operation} | ${JSON.stringify(m.spec)} | ${m.variant} | ${m.operationMs.n} | ${fixed(m.operationMs.median)} | ${fixed(m.operationMs.min)}–${fixed(m.operationMs.max)} | ${fixed(m.operationMs.standardDeviation)} | ${fixed(m.transactionMs?.median)} | ${fixed(m.readerMs?.median)} | ${fixed(m.connectionWaitMs?.median)} | ${m.errors.length} |`);
table.push('', 'DE: desviación estándar poblacional de estas muestras; no es una estimación de percentiles.',
  'BEGIN/finalización incluye ROLLBACK en el original que falla por parámetros.',
  '**La duración real del lector solo se acredita cuando readerTiming en summary.json es completion-captured** (en los resultados archivados, las filas light:true). En las primeras campañas el intervalo lector se calculó después de esperar al escritor y no acredita que el lector permaneciese bloqueado; queda conservado como dato legado. Los tiempos de operación/commit y sus equivalencias siguen siendo válidos.',
  'Las etapas JS/driver, memoria y sondas nativas completas están en [summary.json](summary.json).', '');
fs.writeFileSync(path.join(output, 'timing-tables.md'), table.join('\n'));
console.log(JSON.stringify({ campaigns, changedSinceBaseline, measurements: measurements.map(m => ({ api: m.api, operation: m.operation, spec: m.spec, variant: m.variant, operationMs: m.operationMs, errors: m.errors.length })) }, null, 2));
if (transactionViolations.length || campaigns.some(c => !c.passed || !c.productionPackageUnchanged)) process.exitCode = 1;
