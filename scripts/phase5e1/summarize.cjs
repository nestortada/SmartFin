const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const base = path.join(root, 'docs/atomicidad-fase5e1');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expected = ['final-recovery','final-integrated','final-restart','final-performance','final-history-mixed-1000','final-financial-contention','final-receiver-worker',
  ...[1000,10000,100000].flatMap(n => ['civil','legacy'].map(mode => `final-history-${mode}-${n}`)),
  ...['notifications','denied','worker-headless','kill-beforeNotify','restart-beforeNotify','kill-afterNotify',
    'restart-afterNotify','kill-afterAck','restart-afterAck','process-stage','process-restart','notification-epoch',
    'deletion-rollback','cleanup-faults','deletion-lost-before','deletion-unknown-restart','deletion-lost-after',
    'deletion-confirmed-restart','core','restart-verify','publication','publication-restart-verify',
    'publication-after-verify','close-lost','open-lost'].map(name => 'regression-' + name)];
const platforms = {};
for (const api of [24,35]) {
  const dir = path.join(base, 'android/api' + api);
  const accepted = [], missing = [], excluded = [];
  const metrics = [], paired = [];
  for (const name of expected) {
    const file = path.join(dir, name, 'result.json');
    if (!fs.existsSync(file)) { missing.push(name); continue; }
    const result = read(file), env = read(path.join(dir,name,'environment.json'));
    const fingerprint = read(path.join(dir,name,'source-fingerprints.json'));
    const mismatches = Object.entries(fingerprint.originalHashes).filter(([relative,digest]) => hash(path.join(root,relative)) !== digest).map(([relative]) => relative);
    const productionUnchanged = read(path.join(dir,name,'production-package-unchanged.json')).unchanged;
    const deliveredHistory = result.cases.filter(c=>c.evidence?.historyOutcome)
      .every(c=>c.evidence.historyOutcome.status==='passed');
    accepted.push({name,passed:result.passed,cases:result.cases.length,apkSha256:env.apkSha256,
      resultSha256:hash(file),sourceFingerprintsSha256:hash(path.join(dir,name,'source-fingerprints.json')),
      mismatches,productionUnchanged,deliveredHistory,pid:result.config?.pid});
    for (const c of result.cases) {
      if (c.evidence?.firstPage) metrics.push({campaign:name,name:c.name,...c.evidence});
    }
    const prior=result.cases.find(c=>c.name==='original-production-page-sql-reproduction');
    const next=result.cases.find(c=>c.name.endsWith('traversal-newest'));
    if(prior && next) paired.push({campaign:name,original:prior.evidence,corrected:next.evidence.firstPage});
  }
  for (const name of fs.readdirSync(dir)) if (!expected.includes(name)) {
    const file = path.join(dir,name,'result.json');
    excluded.push({name,reported:fs.existsSync(file),passed:fs.existsSync(file)?read(file).passed:undefined});
  }
  platforms[api] = {accepted,missing,excluded,metrics,paired,campaigns:accepted.length,cases:accepted.reduce((sum,r)=>sum+r.cases,0),
    passed:missing.length===0 && accepted.every(r=>r.passed && r.deliveredHistory && !r.mismatches.length && r.productionUnchanged)};
}
const summary = {scope:'Only 5E-001/5E-002; no full 5E launch acceptance',platforms,
  passed:Object.values(platforms).every(p=>p.passed)};
fs.writeFileSync(path.join(base,'summary.json'),JSON.stringify(summary,null,2));
function performanceRows(api, phase, folder) {
  const file=path.join(root,`docs/${phase}/android/api${api}/${folder}/result.json`);
  return fs.existsSync(file)?read(file).cases.filter(c=>c.evidence?.count).map(c=>c.evidence):[];
}
let md='# Rendimiento 5E.1\n\nMuestras instrumentadas, sin percentiles ni promesas OEM. Tiempos en ms.\n\n';
for(const api of [24,35]) {
  md+=`## API ${api}: fixture integrado 5E repetido\n\n| Movimientos | Historial 5E | Historial 5E.1 | Dashboard 5E.1 | Captura 5E.1 | Admisión 5E.1 |\n|---|---:|---:|---:|---:|---:|\n`;
  const before=performanceRows(api,'atomicidad-fase5e',api===24?'performance-final':'performance-repeat');
  for(const after of performanceRows(api,'atomicidad-fase5e1','final-performance')) {
    const old=before.find(r=>r.count===after.count);
    const time=n=>n===undefined?'falla 5E-001':n.toFixed(2);
    md+=`| ${after.count} | ${time(old?.times.historyPageMs)} | ${time(after.times.historyPageMs)} | ${time(after.times.dashboardMs)} | ${time(after.times.captureMs)} | ${time(after.times.concurrentAdmissionWaitMs)} |\n`;
  }
  md+='\n## Mismo fixture, SQL anterior y corregido, API '+api+'\n\n| Fixture newest | Antes | Después |\n|---|---:|---:|\n';
  for(const pair of platforms[api].paired) {
    md+=`| ${pair.campaign.replace('final-history-','')} | ${pair.original.outcome.status==='failed'?'falla; intento de '+pair.original.totalMs.toFixed(2)+' ms':pair.original.totalMs.toFixed(2)} | ${pair.corrected.totalMs.toFixed(2)} |\n`;
  }
  md+='\nEl SQL anterior se ejecuta primero sobre otro proxy sin caché de pruebas; el cache de páginas del SO puede calentarse. Son pares secuenciales, no un experimento aleatorizado. No se atribuyen diferencias pequeñas al parche.\n';
  if(api===35 && fs.existsSync(path.join(base,'honor-power-adjustment.json'))) {
    md+='\nEn las campañas detalladas HONOR no se mantuvo la pantalla inicialmente. Se observó Asleep a las 18:51 Bogotá y se pasó a Awake/stayOn a las 18:52, conservando el proceso 24404. Las muestras previas o que cruzan ese cambio son diagnósticas, no una comparación causal controlada. La campaña integrada posterior usa pantalla mantenida, como la muestra 5E anterior. El estado previo se restaura al cierre.\n';
  }
  md+='\n## Páginas frías y búsquedas, API '+api+'\n\n| Fixture | Consulta | Check inicial | Await SQL/puente | Filas JS | Admisión | Construcción/resto JS | Total |\n|---|---|---:|---:|---:|---:|---:|---:|\n';
  for(const m of platforms[api].metrics) {
    const v=m.firstPage;
    md+=`| ${m.campaign.replace('final-history-','')} | ${m.name.includes('-search-')?m.query.search + (m.query.accountId!=='all'?' + filtros':''):m.name.endsWith('newest')?'newest':'oldest'} | ${v.initialCheckMs.toFixed(2)} | ${v.sqlAwaitMs.toFixed(2)} | ${v.rowMaterializationMs.toFixed(2)} | ${v.connectionWaitMs.toFixed(2)} | ${v.pageConstructionAndJsMs.toFixed(2)} | ${v.totalMs.toFixed(2)} |\n`;
  }
  md+='\n## Replay nativo independiente, API '+api+'\n\n| Fixture | Caso | Admisión/apertura | SQL hasta primera fila | Cursor/filas | Sentencias |\n|---|---|---:|---:|---:|---:|\n';
  for(const m of platforms[api].metrics) {
    const n=m.nativeReplay;if(!n)continue;
    md+=`| ${m.campaign.replace('final-history-','')} | ${m.name.includes('-search-')?m.query.search:m.name.endsWith('newest')?'newest':'oldest'} | ${n.admissionAndOpenMs.toFixed(2)} | ${n.queryToFirstRowMs.toFixed(2)} | ${n.cursorMaterializationMs.toFixed(2)} | ${n.statements} |\n`;
  }
  md+='\n';
}
md+='La comprobación inicial incluye SQL/materialización. La admisión es parte del await. No sumar columnas superpuestas. El replay usa los mismos SELECT/bindings en una conexión nativa distinta; no mide dentro del driver y no se resta del total entregado. Avanzar el cursor puede ejecutar SQLite. Los componentes JS se miden en la página real; construcción/resto JS es un residual, no un perfil de CPU.\n';
fs.writeFileSync(path.join(base,'rendimiento.md'),md);
console.log(JSON.stringify({passed:summary.passed,platforms:Object.fromEntries(Object.entries(platforms).map(([api,p])=>[api,{campaigns:p.campaigns,cases:p.cases,missing:p.missing,passed:p.passed}]))}));
if (!summary.passed) process.exitCode=1;
