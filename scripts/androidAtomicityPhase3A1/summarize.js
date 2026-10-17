const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../docs/atomicidad-fase3a1');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const environments = [];
const benchmarksOnly = process.argv.includes('--benchmarks-only');
const expected = { phase3a:72, phase2:null, core:14, 'begin-after':1, 'commit-before':1, 'rollback-before':1 };
let fingerprint;
for (const api of [24,35]) {
  const prefix = `final-api${api}`;
  const benchmark = read(`${prefix}-benchmark/result.json`);
  if (!benchmark.passed || benchmark.cases.length !== 6) throw new Error('Incomplete Android benchmark');
  const campaigns = [];
  for (const campaign of benchmarksOnly ? ['benchmark'] : ['benchmark',...Object.keys(expected)]) {
    const directory = `${prefix}-${campaign}`;
    const report = read(`${directory}/result.json`);
    const phase2Points = campaign === 'phase2' ? report.matrix.reduce((n,m)=>n+m.points,0) : 0;
    if (campaign === 'phase2' && (report.matrix.length !== 10 || !report.matrix.every(m=>m.points===m.writes*2 && report.cases.filter(c=>c.name.startsWith(m.name+': write ')).length===m.points))) throw new Error('Incomplete manual write matrix');
    const expectedCases = campaign === 'phase2' ? phase2Points + 6 : expected[campaign];
    if (!report.passed || !report.cases.every(c=>c.passed) || (campaign !== 'benchmark' && report.cases.length !== expectedCases)) throw new Error(`Failed ${directory}`);
    if (!read(`${directory}/production-package-unchanged.json`).unchanged) throw new Error('Production package changed');
    const fp = fs.readFileSync(path.join(root,directory,'source-fingerprints.json'));
    const hash = crypto.createHash('sha256').update(fp).digest('hex');
    if (fingerprint && fingerprint !== hash) throw new Error('Different APK source fingerprints');
    fingerprint = hash;
    campaigns.push({ campaign:report.campaign,cases:report.cases.length,passed:true,result:`${directory}/result.json` });
  }
  const measurements = benchmark.cases.map(c => {
    if (c.warmups !== 1 || c.measuredSamples !== 3 || !c.comparison.equal || !c.cycles.every(v=>v.equal)) throw new Error('Incomplete paired comparison');
    for (const version of ['reference','optimized']) {
      if(c.samples[version].length !== 3 || c.diagnostic[version].nativeSQLite.samplesMs.length !== 3) throw new Error('Missing timing samples');
      if(c.diagnostic[version].nativeSQLite.columns !== (version === 'reference' ? 23 : 9)) throw new Error('Unexpected projection');
    }
    const before=c.distributions.reference;const after=c.distributions.optimized;
    return { rows:c.rows,shape:c.shape,warmups:1,samples:3,before,after,paymentReductionPercent:(1-after.operationMs.median/before.operationMs.median)*100,readerReductionPercent:(1-after.readerMs.median/before.readerMs.median)*100,native:c.diagnostic,exactTableRows:c.comparison.tableRows,exactCycles:4,nativeSQLiteMedianMs:{reference:median(c.diagnostic.reference.nativeSQLite.samplesMs),optimized:median(c.diagnostic.optimized.nativeSQLite.samplesMs)} };
  });
  environments.push({ api,environment:read(`${prefix}-benchmark/environment.json`),campaigns,measurements });
}
const jest = fs.readFileSync(path.join(root,'jest-full-final.log'),'utf8');
if(jest.includes('FAIL ') || !jest.includes('488 passed') || !jest.includes('8 passed, 8 total')) throw new Error('Jest is not green');
const scope=read('scope-audit.json');if(!Object.values(scope.protectedSources).every(Boolean))throw new Error('Protected sources changed');
const matrix=read('phase3a-fault-matrix.json');if(matrix.rollbackPoints.length!==52||!matrix.rollbackPoints.every(p=>p.completeSnapshotEqual))throw new Error('Missing Node rollback points');
const result={quality:{jestPassed:488,jestSkipped:3,jestFailed:0,suitesPassed:45,snapshotsPassed:8},scope,nodeEquivalence:read('node-equivalence.json'),nodeRollbackPoints:52,android:environments};
fs.writeFileSync(path.join(root,benchmarksOnly ? 'benchmark-summary.json' : 'validation-summary.json'),JSON.stringify(result,null,2));
const lines=['| API | Movimientos | Semilla | Pago antes/después (ms, mediana) | Lector antes/después (ms, mediana) | Reducción pago |','|---|---:|---|---:|---:|---:|'];
for(const env of environments)for(const m of env.measurements)lines.push(`| ${env.api} | ${m.rows} | ${m.shape} | ${m.before.operationMs.median.toFixed(1)} → ${m.after.operationMs.median.toFixed(1)} | ${m.before.readerMs.median.toFixed(1)} → ${m.after.readerMs.median.toFixed(1)} | ${m.paymentReductionPercent.toFixed(1)} % |`);
fs.writeFileSync(path.join(root,'comparison-table.md'),lines.join('\n')+'\n');
const stages=['| API | Semilla, 100.000 filas | SQLite/cursor por SELECT, sonda (ms) | Dos lecturas por driver/puente (ms) | Mapeo JS (ms) | Cálculo (ms) | Escrituras (ms) | Ámbito (ms) |','|---|---|---:|---:|---:|---:|---:|---:|'];
const pair=(a,b)=>`${a.toFixed(1)} → ${b.toFixed(1)}`;
for(const env of environments)for(const m of env.measurements.filter(v=>v.rows===100000))stages.push(`| ${env.api} | ${m.shape} | ${pair(m.nativeSQLiteMedianMs.reference,m.nativeSQLiteMedianMs.optimized)} | ${pair(m.before.sqliteBridgeReadMs.median,m.after.sqliteBridgeReadMs.median)} | ${pair(m.before.mappingMs.median,m.after.mappingMs.median)} | ${pair(m.before.calculationMs.median,m.after.calculationMs.median)} | ${pair(m.before.writeMs.median,m.after.writeMs.median)} | ${pair(m.before.scopeMs.median,m.after.scopeMs.median)} |`);
fs.writeFileSync(path.join(root,'stage-table.md'),stages.join('\n')+'\n');
const nodeLines=['| Movimientos | Semilla | Candidatos iniciales | Pago referencia/optimizado (ms, muestra Node) |','|---:|---|---:|---:|'];
for(const measurement of result.nodeEquivalence)nodeLines.push(`| ${measurement.rows} | ${measurement.shape} | ${measurement.candidates} | ${pair(measurement.oldMs,measurement.optimizedMs)} |`);
fs.writeFileSync(path.join(root,'node-comparison-table.md'),nodeLines.join('\n')+'\n');
process.stdout.write(lines.join('\n')+'\n');
