'use strict';
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');

const script = path.resolve(__dirname, '../session-context.cjs');
const {build} = require(script);
// The native realpath expands Windows 8.3 short names (C:\Users\RUNNER~1 on CI), as Git does in its output.
const work = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'smartfin-context-')));
const main = path.join(work, 'main');
const tree = path.join(work, 'tree');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {stdio: 'ignore'});

before(() => {
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.email', 'test@example.invalid');
  git(main, 'config', 'user.name', 'Test');
  git(main, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(main, 'package-lock.json'), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(main, '.gitignore'), 'node_modules/\n');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'base');
  fs.mkdirSync(path.join(main, 'node_modules'));
  git(main, 'worktree', 'add', '-q', '-b', 'feature', tree);
});
after(() => fs.rmSync(work, {recursive: true, force: true}));

test('the main checkout with dependencies only reports branch and a clean tree', () => {
  const text = build({cwd: main});
  assert.match(text, /Rama main;/);
  assert.match(text, /árbol limpio/);
  assert.doesNotMatch(text, /node_modules/);
  assert.doesNotMatch(text, /worktree/);
});

test('a worktree with the same lockfile is told to link the main node_modules and to remove the junction first', () => {
  const text = build({cwd: tree});
  assert.match(text, /Rama feature \(worktree\), 0 commit\(s\) por delante y 0 por detrás de main local/);
  assert.match(text, /New-Item -ItemType Junction -Path node_modules -Target/);
  assert.ok(text.includes(path.join(main, 'node_modules')), text);
  assert.match(text, /Antes de `git worktree remove --force`, borra el junction/);
});

test('a worktree whose lockfile differs is sent to npm ci, never to the other node_modules', () => {
  fs.writeFileSync(path.join(tree, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n');
  const text = build({cwd: tree});
  assert.match(text, /npm ci/);
  assert.doesNotMatch(text, /Junction/);
  assert.match(text, /1 archivo\(s\) con cambios previos a la sesión \(trabajo del usuario/);
  for (const source of ['resume', 'compact', 'clear']) {
    const later = build({cwd: tree, source});
    assert.match(later, /1 archivo\(s\) con cambios sin confirmar/, source);
    assert.doesNotMatch(later, /usuario/, `${source}: the changes may be Claude's own`);
  }
  git(tree, 'checkout', '--', 'package-lock.json');
});

test('commits on the branch are counted against the local main', () => {
  fs.writeFileSync(path.join(tree, 'feature.txt'), 'x\n');
  git(tree, 'add', '.');
  git(tree, 'commit', '-q', '-m', 'feature');
  assert.match(build({cwd: tree}), /1 commit\(s\) por delante y 0 por detrás/);
});

test('a worktree that already has node_modules gets no dependency note', () => {
  fs.mkdirSync(path.join(tree, 'node_modules'));
  assert.doesNotMatch(build({cwd: tree}), /node_modules/);
  fs.rmSync(path.join(tree, 'node_modules'), {recursive: true});
});

test('CLI: SessionStart JSON on valid input, silent exit 0 on bad input or outside Git', () => {
  const cli = input => spawnSync(process.execPath, [script], {input, encoding: 'utf8', timeout: 10000});
  const ok = cli(JSON.stringify({session_id: 'c1', cwd: main}));
  assert.equal(ok.status, 0);
  const output = JSON.parse(ok.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, 'SessionStart');
  assert.match(output.additionalContext, /^Contexto de SmartFin/);
  for (const input of ['not json', JSON.stringify({session_id: 'c2', cwd: work})]) {
    const broken = cli(input);
    assert.equal(broken.status, 0);
    assert.equal(broken.stdout, '');
  }
});
