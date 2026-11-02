'use strict';
// Phase 1a.3B passive authorization evidence (derived from the 1a.3A script). Never launches adb, Gradle, a runner or a hook.
// capture: hashes of every reviewed input (sources, harness, Node reference, guards) before preparation.
// verify: after the campaigns, lists changed/added inputs and fails if a protected guard file changed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'docs/validacion-fase1a3b/r5/authorization');
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
    'docs/validacion-fase1a3b/node/results.json', 'docs/validacion-fase1a3a/node/results.json',
    'docs/validacion-fase1a2/node/results.json', 'docs/correccion-fase6b3/node/results.json',
    'docs/validacion-fase1a3a/authorization/apk-identity.json'];
  const inputs = [...names.map(name => path.join(root, name)),
    ...['src', 'android', 'scripts', '__tests__', '.claude/hooks', '.codex/hooks'].flatMap(name => files(path.join(root, name)))];
  return Object.fromEntries([...new Set(inputs)].filter(file => fs.existsSync(file) && !sensitiveData.test(relative(file)))
    .sort().map(file => [relative(file), sha(file)]));
}
function write(name, value) {
  fs.mkdirSync(output, {recursive: true});
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
}
const mode = process.argv[2];
if (process.argv.length !== 3 || !['capture', 'verify'].includes(mode)) throw Error('Use capture or verify');
if (mode === 'capture') {
  if (fs.existsSync(path.join(output, 'inputs.sha256.json'))) throw Error('Initial inventory already exists');
  write('inputs.sha256.json', {phase: '1a.3B r5', apk1A3B: null, sources: inventory()});
  console.log('Passive input inventory saved; no Android operation performed.');
} else {
  const before = JSON.parse(fs.readFileSync(path.join(output, 'inputs.sha256.json'), 'utf8'));
  const current = inventory();
  const protectedName = name => name === 'AGENTS.md' || name === 'CLAUDE.md' || name.startsWith('.claude/') || name.startsWith('.codex/');
  const changed = Object.entries(before.sources).filter(([name, digest]) => current[name] !== digest).map(([name]) => name);
  const added = Object.keys(current).filter(name => !(name in before.sources));
  const result = {protectedFilesUnchanged: !changed.some(protectedName) && !added.some(protectedName), changed, added};
  write('integrity-after.json', result);
  console.log(JSON.stringify(result));
  if (!result.protectedFilesUnchanged) process.exitCode = 1;
}
