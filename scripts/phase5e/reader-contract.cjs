// Execute the existing binary v2 reader fixture without modifying its evidence.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const original = fs.readFileSync(path.join(root, 'scripts/phase5b3/reader-example.cjs'), 'utf8');
const output = path.join(root, 'docs/atomicidad-fase5e/reader');
fs.mkdirSync(output, { recursive: true });
assert(fs.existsSync(path.join(root, 'docs/estabilizacion-fase5b3/reader-example')), 'Read-only reader fixtures required');
let source = original.replace("path.join(root,'reader-example-results.json')", JSON.stringify(path.join(output, 'selection.json')));
source += `
const cutoff=Date.parse('2026-10-24T02:10:00.000Z');
function temporal(generatedAt,now,epochEvidence) {
  const age=now-Date.parse(generatedAt);
  return {ageMs:age,freshness:age<0?'clockAnomaly':age<=7*86400000?'withinSevenDays':'olderThanSevenDays',
    fileIntegrity:'verified',cloudSync:'unconfirmed',datasetCurrency:epochEvidence==='revoked'?'historical':'unknown'};
}
const cases=[
  ['same-instant',0,'withinSevenDays'],['seven-days-boundary',7*86400000,'withinSevenDays'],
  ['seven-days-plus-one-ms',7*86400000+1,'olderThanSevenDays'],['future',-1,'clockAnomaly']
].map(([name,age,expected])=>{
  const value=temporal(new Date(cutoff-age).toISOString(),cutoff);
  if(value.freshness!==expected||value.datasetCurrency!=='unknown'||value.cloudSync!=='unconfirmed')throw Error('Temporal contract: '+name);
  return {name,...value};
});
const historical=temporal(new Date(cutoff).toISOString(),cutoff,'revoked');
if(historical.datasetCurrency!=='historical'||historical.fileIntegrity!=='verified')throw Error('History lost integrity');
const bogota=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date('2026-10-24T02:30:00.000Z'));
if(!bogota.includes('2026-10-23')||!bogota.includes('21:30'))throw Error('Bogota civil day');
fs.writeFileSync(${JSON.stringify(path.join(output, 'contract.json'))},JSON.stringify({cases,historical,bogota,
  legacyStatus:'legacyUnverified',externalAnalystUpdated:false,externalIntegration:'pending',
  sevenDayRule:'Inclusive elapsed age <= 168h, independent of requested weekly cutoff and dataset epoch; fixture acceptance only',
  readerSourceSha256:${JSON.stringify(crypto.createHash('sha256').update(original).digest('hex'))},
  limitations:['Minimal reader database, not a restorable app snapshot','No external ChatGPT automation executed or modified','No duplicate JSON key detection by JSON.parse','No authorized external epoch channel implemented']},null,2));
`;
const runner = new Module(__filename, module);
runner.filename = __filename; runner.paths = module.paths;
runner._compile(source, __filename);
