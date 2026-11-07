'use strict';
// Phase 1a.4B r5 passive inventory (derived from scripts/phase1a4b/r4/inventory-r4.cjs). Inventories the reviewed inputs
// (sources, harnesses, historical references, guards) plus EVERY r1, r2, r3 and r4 evidence file under
// docs/validacion-fase1a4b (except r5/), so `verify` proves they were kept. Writes ONLY under
// docs/validacion-fase1a4b/r5/authorization (never the r4 integrity file). Never launches adb, Gradle, a runner or a hook.
// capture: refuses unless the only reviewed inputs changed since the r4 inventory are the authorized r5 files (the probe
//   generator, the regenerated derived 1a.3B probes and the two r4 classifier assertions updated to the stricter class).
// verify: lists changed/added inputs; fails if a guard, production, a reference or r1-r4 evidence changed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'docs/validacion-fase1a4b/r5/authorization');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sensitiveData = /\.(?:db|sqlite|sqlite3)(?:-|$)|\.keystore$|\.jks$|(?:^|\/)\.env(?:\.|$)/i;
const HISTORICAL = ['docs/validacion-fase1a4a/r2/node/results.json', 'docs/validacion-fase1a4a/node/results.json',
  'docs/validacion-fase1a3b/node/results.json', 'docs/validacion-fase1a3a/node/results.json',
  'docs/validacion-fase1a2/node/results.json', 'docs/correccion-fase6b3/node/results.json'];
const REFERENCE = 'docs/validacion-fase1a4b/node/results.json';
const R5_CHANGED = ['__tests__/phase1a4bSqliteErrorClassification.test.ts', 'scripts/phase1a4b/derive-probes.cjs',
  'scripts/phase1a4b/phase1a3bProbes.ts'];
function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error('Linked input: ' + file);
    if (['build', '.gradle', '.cxx', 'node_modules'].includes(entry.name)) return [];
    return entry.isDirectory() ? files(file) : [file];
  });
}
const relative = file => path.relative(root, file).split(path.sep).join('/');
function inventory() {
  const names = ['AGENTS.md', 'CLAUDE.md', 'package.json', 'package-lock.json', 'babel.config.js', 'metro.config.js',
    'react-native.config.js', 'tsconfig.json', 'jest.config.js', 'jest.reproductions.config.js', '.eslintrc.js',
    '.claude/settings.json', '.codex/hooks.json', ...HISTORICAL, REFERENCE,
    'docs/validacion-fase1a3a/authorization/apk-identity.json', 'docs/validacion-fase1a3b/r5/authorization/apk-identity.json',
    'docs/validacion-fase1a3b/r5/authorization/inputs.sha256.json', 'docs/validacion-fase1a4a/authorization/apk-identity.json',
    'docs/validacion-fase1a4a/authorization/inputs.sha256.json', 'docs/validacion-fase1a4a/r2/authorization/apk-identity.json',
    'docs/validacion-fase1a4a/r2/authorization/inputs.sha256.json', 'docs/abonos-extraordinarios-fase1a4B.md'];
  const evidence = files(path.join(root, 'docs/validacion-fase1a4b')).filter(file => !relative(file).startsWith('docs/validacion-fase1a4b/r5/'));
  const inputs = [...names.map(name => path.join(root, name)), ...evidence,
    ...['src', 'android', 'scripts', '__tests__', '.claude/hooks', '.codex/hooks'].flatMap(name => files(path.join(root, name)))];
  return Object.fromEntries([...new Set(inputs)].filter(file => fs.existsSync(file) && !sensitiveData.test(relative(file)))
    .sort().map(file => [relative(file), sha(file)]));
}
const mode = process.argv[2];
if (process.argv.length !== 3 || !['capture', 'verify'].includes(mode)) throw Error('Use capture or verify');
fs.mkdirSync(output, {recursive: true});
if (mode === 'capture') {
  if (fs.existsSync(path.join(output, 'inputs.sha256.json'))) throw Error('r5 inventory already exists');
  const r4File = path.join(root, 'docs/validacion-fase1a4b/r4/authorization/inputs.sha256.json');
  const r4 = JSON.parse(fs.readFileSync(r4File, 'utf8'));
  if (r4.phase !== '1a.4B r4') throw Error('Not the r4 inventory');
  const current = inventory();
  const changedSinceR4 = Object.entries(r4.sources).filter(([name, digest]) => current[name] !== digest).map(([name]) => name).sort();
  if (JSON.stringify(changedSinceR4) !== JSON.stringify(R5_CHANGED)) throw Error('Unexpected changes since r4: ' + changedSinceR4.join(', '));
  const addedSinceR4 = Object.keys(current).filter(name => !(name in r4.sources)).sort();
  const unexpectedAdded = addedSinceR4.filter(name => !name.startsWith('docs/validacion-fase1a4b/r4/') && !name.startsWith('scripts/phase1a4b/r5/') &&
    name !== '__tests__/phase1a4bSqliteErrorClassificationR5.test.ts');
  if (unexpectedAdded.length) throw Error('Unexpected inputs added since r4: ' + unexpectedAdded.join(', '));
  fs.writeFileSync(path.join(output, 'inputs.sha256.json'), JSON.stringify({phase: '1a.4B r5', r4Inventory: sha(r4File),
    changedSinceR4, addedSinceR4: addedSinceR4.filter(name => !name.startsWith('docs/validacion-fase1a4b/r4/')),
    r4EvidenceFiles: addedSinceR4.filter(name => name.startsWith('docs/validacion-fase1a4b/r4/')).length, sources: current}, null, 2) + '\n');
  console.log(JSON.stringify({captured: Object.keys(current).length, changedSinceR4, addedSinceR4: addedSinceR4.length}));
} else {
  const before = JSON.parse(fs.readFileSync(path.join(output, 'inputs.sha256.json'), 'utf8'));
  const current = inventory();
  const protectedName = name => name === 'AGENTS.md' || name === 'CLAUDE.md' || name.startsWith('.claude/') || name.startsWith('.codex/');
  const changed = Object.entries(before.sources).filter(([name, digest]) => current[name] !== digest).map(([name]) => name);
  const added = Object.keys(current).filter(name => !(name in before.sources));
  const removed = Object.keys(before.sources).filter(name => !(name in current));
  const result = {
    protectedFilesUnchanged: !changed.some(protectedName) && !added.some(protectedName) && !removed.some(protectedName),
    productionUnchanged: ![...changed, ...added, ...removed].some(name => name.startsWith('src/')),
    historicalReferencesUnchanged: !changed.some(name => HISTORICAL.includes(name)),
    referenceUnchanged: !changed.includes(REFERENCE) && !removed.includes(REFERENCE),
    previousEvidenceUnchanged: ![...changed, ...removed].some(name => name.startsWith('docs/validacion-fase1a4b/')),
    changed, added, removed,
  };
  fs.writeFileSync(path.join(output, 'integrity-after.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (!result.protectedFilesUnchanged || !result.productionUnchanged || !result.historicalReferencesUnchanged ||
      !result.referenceUnchanged || !result.previousEvidenceUnchanged)
    process.exitCode = 1;
}
