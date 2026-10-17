const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const target = path.resolve(process.argv[2]);
if (fs.existsSync(target))
  throw Error('Choose a fresh baseline source directory');
const archive = path.join(
  root,
  'docs/performance/shared-commands/baseline/source.zip',
);
const expected = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      'docs/performance/shared-commands/baseline/archive-sha256.json',
    ),
    'utf8',
  ),
).Hash.toLowerCase();
if (
  createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !==
  expected
)
  throw Error('Baseline archive checksum mismatch');
child.execFileSync(
  path.join(
    process.env.SystemRoot,
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  ),
  [
    '-NoProfile',
    '-File',
    path.join(__dirname, 'restoreBaseline.ps1'),
    '-SourceArchive',
    archive,
    '-Target',
    target,
  ],
  { stdio: 'inherit' },
);
fs.symlinkSync(
  path.join(root, 'node_modules'),
  path.join(target, 'node_modules'),
  'junction',
);
