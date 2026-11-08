'use strict';
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');

const script = path.resolve(__dirname, '../reviewer-reminder.cjs');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'smartfin-reviewer-'));
const repo = path.join(work, 'repo');
process.env.SMARTFIN_REVIEWER_STATE_DIR = path.join(work, 'state');
const {run} = require(script);

const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), {recursive: true});
  fs.writeFileSync(path.join(repo, file), text);
};
const git = (...args) => execFileSync('git', ['-C', repo, ...args], {stdio: 'ignore'});
const stop = (session, extra = {}) => run('stop', {session_id: session, cwd: repo, stop_hook_active: false, ...extra});
const baseline = session => run('baseline', {session_id: session, cwd: repo});
const reviewers = result => (result ? [...result.reason.matchAll(/^- ([\w-]+)/gm)].map(m => m[1]) : []);

before(() => {
  fs.mkdirSync(repo);
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'core.autocrlf', 'false');
  for (const file of ['src/modules/transactions/useCases/save.ts', 'src/modules/transactions/ui/Screen.tsx',
    'android/app/src/main/java/com/smartfin/Module.kt', 'src/modules/settings/services/localDatabaseSnapshot.ts',
    'src/database/databaseCoordination.ts', 'docs/fase.md'])
    write(file, 'original\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
});
after(() => fs.rmSync(work, {recursive: true, force: true}));

test('pending work present at session start never triggers a reminder', () => {
  write('src/modules/transactions/useCases/save.ts', 'user change\n');
  baseline('s1');
  assert.equal(stop('s1'), null);
  git('checkout', '--', '.');
});

test('a use case change asks for financial-reviewer once per content version', () => {
  baseline('s2');
  write('src/modules/transactions/useCases/save.ts', 'v1\n');
  const first = stop('s2');
  assert.equal(first.decision, 'block');
  assert.deepEqual(reviewers(first), ['financial-reviewer']);
  assert.match(first.reason, /useCases\/save\.ts/);
  assert.equal(stop('s2'), null, 'same content is not reminded again');
  write('src/modules/transactions/useCases/save.ts', 'v2\n');
  assert.deepEqual(reviewers(stop('s2')), ['financial-reviewer'], 'a new version is reminded again');
  git('checkout', '--', '.');
});

test('stop_hook_active never blocks, so the hook cannot loop', () => {
  baseline('s3');
  write('src/modules/transactions/useCases/save.ts', 'loop\n');
  assert.equal(stop('s3', {stop_hook_active: true}), null);
  git('checkout', '--', '.');
});

test('UI, docs and tests alone need no reviewer', () => {
  baseline('s4');
  write('src/modules/transactions/ui/Screen.tsx', 'ui\n');
  write('docs/fase.md', 'doc\n');
  write('__tests__/newPhase.test.ts', 'test\n');
  assert.equal(stop('s4'), null);
  git('checkout', '--', '.');
  fs.rmSync(path.join(repo, '__tests__'), {recursive: true, force: true});
});

test('Kotlin, backup services and coordination map to their reviewers', () => {
  baseline('s5');
  write('android/app/src/main/java/com/smartfin/Module.kt', 'kt\n');
  assert.deepEqual(reviewers(stop('s5')), ['android-native-reviewer']);
  write('src/modules/settings/services/localDatabaseSnapshot.ts', 'snapshot\n');
  assert.deepEqual(reviewers(stop('s5')), ['android-native-reviewer', 'security-privacy-reviewer']);
  write('src/database/databaseCoordination.ts', 'coord\n');
  assert.deepEqual(reviewers(stop('s5')), ['financial-reviewer', 'android-native-reviewer']);
  git('checkout', '--', '.');
});

test('new untracked and deleted files count as changes', () => {
  baseline('s6');
  write('src/modules/loans/repositories/sqliteLoanRepository.ts', 'new\n');
  assert.deepEqual(reviewers(stop('s6')), ['financial-reviewer']);
  fs.rmSync(path.join(repo, 'src/modules/loans'), {recursive: true});
  fs.rmSync(path.join(repo, 'src/modules/transactions/useCases/save.ts'));
  assert.deepEqual(reviewers(stop('s6')), ['financial-reviewer']);
  git('checkout', '--', '.');
});

test('a session without baseline adopts the current tree instead of guessing', () => {
  write('src/modules/transactions/useCases/save.ts', 'mid-session\n');
  assert.equal(stop('s7'), null);
  write('src/modules/transactions/useCases/save.ts', 'after\n');
  assert.deepEqual(reviewers(stop('s7')), ['financial-reviewer']);
  git('checkout', '--', '.');
});

test('CLI: silent when nothing is due, JSON block when a reviewer is due, silent on bad input', () => {
  const cli = (mode, input) => spawnSync(process.execPath, [script, mode], {input, encoding: 'utf8', timeout: 10000, env: process.env});
  const event = session => JSON.stringify({session_id: session, cwd: repo, stop_hook_active: false});
  assert.equal(cli('baseline', event('c1')).stdout, '');
  assert.equal(cli('stop', event('c1')).stdout, '');
  write('src/modules/transactions/useCases/save.ts', 'cli\n');
  const result = cli('stop', event('c1'));
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).decision, 'block');
  const broken = cli('stop', 'not json');
  assert.equal(broken.status, 0);
  assert.equal(broken.stdout, '');
  git('checkout', '--', '.');
});
