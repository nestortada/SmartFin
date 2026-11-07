'use strict';
// Phase 1a.4B r2 (diagnostic) passive inventory. Same inventory as scripts/phase1a4b/authorization-inventory.cjs plus every
// r1 evidence file under docs/validacion-fase1a4b (except r2/), so `verify` also proves that the r1 evidence was kept.
// Writes ONLY under docs/validacion-fase1a4b/r2/authorization (the r1 inventory and integrity-after.json are never
// rewritten). Never launches adb, Gradle, a runner or a hook.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'docs/validacion-fase1a4b/r2/authorization');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sensitiveData = /\.(?:db|sqlite|sqlite3)(?:-|$)|\.keystore$|\.jks$|(?:^|\/)\.env(?:\.|$)/i;
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
    'react-native.config.js', 'tsconfig.json', 'jest.config.js', '.eslintrc.js', '.claude/settings.json', '.codex/hooks.json',
    'docs/validacion-fase1a4a/r2/node/results.json', 'docs/validacion-fase1a4a/node/results.json',
    'docs/validacion-fase1a3b/node/results.json', 'docs/validacion-fase1a3a/node/results.json',
    'docs/validacion-fase1a2/node/results.json', 'docs/correccion-fase6b3/node/results.json',
    'docs/validacion-fase1a3a/authorization/apk-identity.json', 'docs/validacion-fase1a3b/r5/authorization/apk-identity.json',
    'docs/validacion-fase1a3b/r5/authorization/inputs.sha256.json', 'docs/validacion-fase1a4a/authorization/apk-identity.json',
    'docs/validacion-fase1a4a/authorization/inputs.sha256.json', 'docs/validacion-fase1a4a/r2/authorization/apk-identity.json',
    'docs/validacion-fase1a4a/r2/authorization/inputs.sha256.json', 'docs/abonos-extraordinarios-fase1a4B.md'];
  const r1Evidence = files(path.join(root, 'docs/validacion-fase1a4b')).filter(file => !relative(file).startsWith('docs/validacion-fase1a4b/r2/'));
  const inputs = [...names.map(name => path.join(root, name)), ...r1Evidence,
    ...['src', 'android', 'scripts', '__tests__', '.claude/hooks', '.codex/hooks'].flatMap(name => files(path.join(root, name)))];
  return Object.fromEntries([...new Set(inputs)].filter(file => fs.existsSync(file) && !sensitiveData.test(relative(file)))
    .sort().map(file => [relative(file), sha(file)]));
}
const mode = process.argv[2];
if (process.argv.length !== 3 || !['capture', 'verify'].includes(mode)) throw Error('Use capture or verify');
fs.mkdirSync(output, {recursive: true});
if (mode === 'capture') {
  if (fs.existsSync(path.join(output, 'inputs-b.sha256.json'))) throw Error('r2 (attempt b) inventory already exists');
  // The r1 inventory must still describe every reviewed input (guards included, read only).
  const r1 = JSON.parse(fs.readFileSync(path.join(root, 'docs/validacion-fase1a4b/authorization/inputs.sha256.json'), 'utf8'));
  const current = inventory();
  const changedSinceR1 = Object.entries(r1.sources).filter(([name, digest]) => current[name] !== digest).map(([name]) => name);
  if (changedSinceR1.length) throw Error('Inputs changed since r1: ' + changedSinceR1.join(', '));
  fs.writeFileSync(path.join(output, 'inputs-b.sha256.json'), JSON.stringify({phase: '1a.4B r2-diagnostic', r1Inventory:
    sha(path.join(root, 'docs/validacion-fase1a4b/authorization/inputs.sha256.json')), sources: current}, null, 2) + '\n');
  console.log(JSON.stringify({captured: Object.keys(current).length, changedSinceR1: 0, addedSinceR1:
    Object.keys(current).filter(name => !(name in r1.sources))}));
} else {
  const before = JSON.parse(fs.readFileSync(path.join(output, 'inputs-b.sha256.json'), 'utf8'));
  const current = inventory();
  const protectedName = name => name === 'AGENTS.md' || name === 'CLAUDE.md' || name.startsWith('.claude/') || name.startsWith('.codex/');
  const changed = Object.entries(before.sources).filter(([name, digest]) => current[name] !== digest).map(([name]) => name);
  const added = Object.keys(current).filter(name => !(name in before.sources));
  const r1EvidenceChanged = changed.filter(name => name.startsWith('docs/validacion-fase1a4b/'));
  const productionChanged = [...changed, ...added].filter(name => name.startsWith('src/'));
  const result = {protectedFilesUnchanged: !changed.some(protectedName) && !added.some(protectedName),
    r1EvidenceUnchanged: r1EvidenceChanged.length === 0, productionUnchanged: productionChanged.length === 0, changed, added};
  fs.writeFileSync(path.join(output, 'integrity-after-b.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (!result.protectedFilesUnchanged || !result.r1EvidenceUnchanged || !result.productionUnchanged) process.exitCode = 1;
}
