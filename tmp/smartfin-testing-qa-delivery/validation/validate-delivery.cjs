'use strict';
// Delivery-only verifier. Reads project sources, never opens SQLite or changes hooks.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const delivery = path.resolve(__dirname, '..');
const payload = path.join(delivery, 'smartfin-testing-qa');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = folder => fs.readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
  const file = path.join(folder, entry.name);
  if (entry.isSymbolicLink()) throw new Error(`Unexpected link: ${file}`);
  return entry.isDirectory() ? walk(file) : [file];
});
const files = walk(payload);
const markdown = [...files.filter(file => file.endsWith('.md')),
  ...['AUDITORIA.md', 'INSTALACION.md', 'VALIDACION.md'].map(file => path.join(delivery, file))];
let links = 0;
const missingLinks = [];
const citedPaths = new Set();
const missingPaths = [];
for (const file of markdown) {
  const content = fs.readFileSync(file, 'utf8');
  for (const [, target] of content.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^https?:\/\//.test(target)) continue;
    links++;
    if (!fs.existsSync(path.resolve(path.dirname(file), target.split('#')[0]))) missingLinks.push({file,target});
  }
  for (const [, token] of content.matchAll(/`([^`\r\n]+)`/g)) {
    // Validate concrete project paths and abbreviated test/helper names only;
    // globs, illustrative commands and planned installation paths are not files.
    let candidate;
    if (/^(?:src|docs|scripts|__tests__|android|\.github)\/[\w./-]+\.[\w]+$/.test(token)) candidate=token;
    else if (/^[\w-]+\.(?:test|repro)\.(?:ts|tsx|js)$/.test(token)) {
      candidate=token.includes('.repro.') ? `__tests__/reproductions/${token}` : `__tests__/${token}`;
    } else if (/^(?:AGENTS\.md|CLAUDE\.md|package(?:-lock)?\.json|jest(?:\.reproductions)?\.config\.js|tsconfig\.json|\.eslintrc\.js|\.nvmrc)$/.test(token)) candidate=token;
    if (candidate) {
      citedPaths.add(candidate);
      if (!fs.existsSync(path.join(root,candidate))) missingPaths.push({file,candidate});
    }
  }
}
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname,'baseline.json'),'utf8'));
const changes=[];
for(const [file,digest] of Object.entries(baseline.hashes)) {
  if(!fs.existsSync(path.join(root,file)) || hash(path.join(root,file))!==digest) changes.push(file);
}
const manifest=JSON.parse(fs.readFileSync(path.join(delivery,'manifest.sha256.json'),'utf8'));
const manifestMismatch=manifest.files.filter(entry=>!fs.existsSync(path.join(payload,entry.path)) || hash(path.join(payload,entry.path))!==entry.sha256);
if(manifest.files.length!==files.length) manifestMismatch.push({error:'file count'});
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const scripts=Object.fromEntries(['test','test:reproductions','typecheck','lint'].map(name=>[name,pkg.scripts[name]]));
const commandsValid=scripts.test==='jest' && scripts['test:reproductions']==='jest --config jest.reproductions.config.js' && scripts.typecheck==='tsc --noEmit' && scripts.lint==='eslint .';
const inventory=JSON.parse(fs.readFileSync(path.join(__dirname,'inventory.json'),'utf8'));
const stable=require(path.join(root,'jest.config.js'));
const repro=require(path.join(root,'jest.reproductions.config.js'));
const discoveryValid=inventory.excludedJs.every(file=>!inventory.stable.includes(file)) && stable.setupFiles.includes('<rootDir>/__tests__/setup/redirectEvidenceWrites.js') && repro.testMatch.every(pattern=>pattern.includes('.repro.'));
const smoke=JSON.parse(fs.readFileSync(path.join(__dirname,'smoke/jest.json'),'utf8'));
const smokeValid=smoke.success && smoke.numPassedTestSuites===2 && smoke.numFailedTests===0 && smoke.numPendingTests===0 && smoke.numPassedTests>0;
const result={payloadFiles:files.length,internalLinksChecked:links,missingLinks,citedProjectPathsChecked:citedPaths.size,missingPaths,baselineFilesChecked:Object.keys(baseline.hashes).length,changedBaselineFiles:changes,manifestMismatch,commands:scripts,commandsValid,discovery:{stable:inventory.stable.length,reproductions:inventory.reproductions.length,excludedJs:inventory.excludedJs.length},discoveryValid,smoke:{suites:smoke.numPassedTestSuites,passed:smoke.numPassedTests,failed:smoke.numFailedTests,pending:smoke.numPendingTests},smokeValid,canonicalInstalled:fs.existsSync(path.join(root,'.agents/skills/smartfin-testing-qa')),claudeInstalled:fs.existsSync(path.join(root,'.claude/skills/smartfin-testing-qa'))};
result.success=!missingLinks.length&&!missingPaths.length&&!changes.length&&!manifestMismatch.length&&commandsValid&&discoveryValid&&smokeValid;
console.log(JSON.stringify(result,null,2));
if(!result.success) process.exitCode=1;
