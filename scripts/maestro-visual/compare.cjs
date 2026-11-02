'use strict';
// Compare evidence produced independently by Codex and Claude Code.
// This script does not communicate with Android, Codex or Claude.
const fs=require('node:fs');
const path=require('node:path');
const [aPath,bPath,outPath]=process.argv.slice(2);
if(!aPath||!bPath) {
  console.error('Usage: node scripts/maestro-visual/compare.cjs codex.json claude.json [report.md]');
  process.exit(2);
}
function read(file, expected) {
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(data.agent!==expected) throw new Error(file+': expected agent '+expected);
  if(data.appId!=='com.smartfin.visualtests') throw new Error('Unexpected appId: '+data.appId);
  if(data.device!=='emulator-5554') throw new Error('Unexpected device: '+data.device);
  if(!/^[a-f0-9]{64}$/.test(data.apkSha256||'')) throw new Error('Missing APK SHA256: '+file);
  if(!Array.isArray(data.flows)) throw new Error('Expected flows array: '+file);
  const names=new Set();
  for(const f of data.flows) {
    if(!['01-dashboard','02-navigation','03-form-readonly','04-expense-draft'].includes(f.id)) throw new Error('Unknown flow: '+f.id);
    if(names.has(f.id)) throw new Error('Duplicate flow: '+f.id);
    names.add(f.id);
    if(!['passed','failed','not_run'].includes(f.status)) throw new Error('Invalid flow status: '+f.status);
    if(f.status==='passed' && (!Array.isArray(f.screenshots)||!f.screenshots.length))
      throw new Error('Passed flow has no screenshot evidence: '+f.id);
    for(const screenshot of f.screenshots||[]) {
      if(typeof screenshot!=='string'||!screenshot.trim()) throw new Error('Invalid screenshot');
      const resolved=path.resolve(path.dirname(file),screenshot);
      if(!fs.existsSync(resolved) || !fs.statSync(resolved).isFile())
        throw new Error('Screenshot evidence not found: '+resolved);
    }
  }
  return data;
}
const codex=read(aPath,'codex'),claude=read(bPath,'claude');
const sameApk=codex.apkSha256===claude.apkSha256;
const ids=['01-dashboard','02-navigation','03-form-readonly','04-expense-draft'];
const fmt=(data,id)=>data.flows.find(f=>f.id===id)?.status||'not_run';
const rows=ids.map(id=>[id,fmt(codex,id),fmt(claude,id)]);
const allPassed=sameApk && rows.every(([,c,d])=>c==='passed'&&d==='passed');
const lines=[
  '# Comparación de evidencia Maestro: Codex vs Claude Code','',
  'Paquete: \`com.smartfin.visualtests\`. Dispositivo: \`emulator-5554\`.','',
  '- SHA256 APK idéntico: '+(sameApk?'SÍ':'NO'),
  '- Resultado global: '+(allPassed?'APROBADO (flujos reportados y evidencia presente)':'INCOMPLETO O CON FALLOS'),
  '',
  '| Flujo | Codex | Claude Code |','|---|---|---|',
  ...rows.map(r=>'| '+r.join(' | ')+' |'),
  '',
  'Cada resultado corresponde a evidencia local declarada por el agente. La revisión visual humana y TalkBack son evaluaciones adicionales.',
  '',
];
const output=lines.join('\n');
if(outPath)fs.writeFileSync(outPath,output,'utf8');
process.stdout.write(output);
if(!allPassed)process.exitCode=1;
