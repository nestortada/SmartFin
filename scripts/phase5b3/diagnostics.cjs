const fs=require('node:fs'),crypto=require('node:crypto');
const stat=values=>{const sorted=[...values].sort((a,b)=>a-b);return {n:sorted.length,min:sorted[0],median:sorted[Math.floor(sorted.length/2)],max:sorted.at(-1)};};
const rows=[];
for(const api of [24,35]) {
  const report=JSON.parse(fs.readFileSync(`docs/estabilizacion-fase5b3/diagnostic/api${api}/csv/result.json`,'utf8'));
  if(!report.passed) throw Error('Diagnostic did not pass');
  const pairs=report.cases[0].evidence.pairs.filter(p=>p.measured);
  if(pairs.length!==5) throw Error('Five measured pairs required');
  for(const p of pairs) if(JSON.stringify(p.baseline.components)!==JSON.stringify(p.candidate.components)) throw Error('Bytes differ');
  const baseline=stat(pairs.map(p=>p.baseline.wallMs)),candidate=stat(pairs.map(p=>p.candidate.wallMs));
  rows.push({api,count:100000,baseline,candidate,medianReductionPercent:100*(1-candidate.median/baseline.median),
    pairedWins:pairs.filter(p=>p.candidate.wallMs<p.baseline.wallMs).length,
    baselineCpu:stat(pairs.map(p=>p.baseline.threadCpuMs)),candidateCpu:stat(pairs.map(p=>p.candidate.threadCpuMs)),
    allCsvByteEquivalent:true});
}
const file='android/app/src/main/java/com/smartfin/SmartFinBackupCsv.kt';
const expected=JSON.parse(fs.readFileSync('docs/estabilizacion-fase5b3/baseline/scope-audit.json','utf8')).before[file];
const actual=crypto.createHash('sha256').update(fs.readFileSync('scripts/phase5b3/SmartFinBackupCsvBaseline.kt')).digest('hex');
if(expected!==actual)throw Error('CSV baseline is not the original product source');
fs.writeFileSync('docs/estabilizacion-fase5b3/diagnostic-comparison.json',JSON.stringify({baselineSha256:actual,baselineMatchesInitialProduct:true,rows},null,2));
console.log(JSON.stringify(rows));
