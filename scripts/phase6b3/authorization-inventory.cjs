'use strict';
// Passive authorization evidence only. Never launches adb, Gradle, a runner or a hook.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'docs/validacion-fase6b3-1/authorization');
const baseline = 'C:/sf-6b2r-20261030';
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
const relative = file => path.relative(root, file).replaceAll('\\', '/');
function inventory() {
  const names = ['AGENTS.md', 'CLAUDE.md', 'package.json', 'package-lock.json', 'babel.config.js',
    'metro.config.js', 'react-native.config.js', 'tsconfig.json', 'jest.config.js', '.eslintrc.js',
    '.claude/settings.json', '.codex/hooks.json'];
  const inputs = [...names.map(name => path.join(root, name)),
    ...['src', 'android', 'scripts', '__tests__', '.claude/hooks', '.codex/hooks']
      .flatMap(name => files(path.join(root, name)))];
  return Object.fromEntries([...new Set(inputs)].filter(file => fs.existsSync(file) && !sensitiveData.test(relative(file)))
    .sort().map(file => [relative(file), sha(file)]));
}
function baselineEvidence() {
  const file = path.join(baseline, 'source-fingerprints.json');
  const apk = path.join(baseline, 'android/app/build/outputs/apk/release/app-release.apk');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const mismatch = [], checkoutDifferences = [];
  for (const [name, digest] of Object.entries(record.hashes)) {
    if (name.includes('..') || path.isAbsolute(name) || sensitiveData.test(name)) throw Error('Unexpected attested path');
    const target = path.join(baseline, name);
    if (!fs.existsSync(target) || sha(target) !== digest) mismatch.push(name);
  }
  for (const [name, digest] of Object.entries(record.originalHashes)) {
    if (name.includes('..') || path.isAbsolute(name) || sensitiveData.test(name)) throw Error('Unexpected source path');
    const target = path.join(root, name);
    if (!fs.existsSync(target) || sha(target) !== digest) checkoutDifferences.push(name);
  }
  return {workspace: baseline, packageId: record.packageId, attestationSha256: sha(file),
    attestationMatchesHistoricalPin: sha(file) === 'df3e620bc751c36bb8f0c8fa51dd6061ddd87fd4c5555752f7cf8a62a5ae3388',
    apk: {path: apk, sha256: fs.existsSync(apk) ? sha(apk) : null,
      expectedHistoricalSha256: '85af989be11c7a79c81e3b38c06905b4064f52648d5170f6a6ab1022ad0e42f6',
      phase: '6B.2 only; not a 6B.3 acceptance artifact'},
    preparedInputsMatchAttestation: mismatch.length === 0, mismatch, checkoutDifferences};
}
function write(name, value) {
  fs.mkdirSync(output, {recursive: true});
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
}
const mode = process.argv[2];
if (process.argv.length !== 3 || !['capture', 'verify'].includes(mode)) throw Error('Use capture or verify');
if (mode === 'capture') {
  if (fs.existsSync(path.join(output, 'inputs.sha256.json'))) throw Error('Initial inventory already exists');
  write('inputs.sha256.json', {phase: '6B.3.1', apk6B3: null, sources: inventory(), baseline: baselineEvidence()});
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
