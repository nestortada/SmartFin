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

test('money types and helpers ask for financial-reviewer; driver patches ask for android-native-reviewer', () => {
  baseline('s8');
  write('src/shared/utils/exactCopCents.ts', 'cents\n');
  write('src/modules/transactions/types/SharedExpense.ts', 'types\n');
  const money = stop('s8');
  assert.deepEqual(reviewers(money), ['financial-reviewer']);
  assert.match(money.reason, /exactCopCents\.ts/);
  assert.match(money.reason, /types\/SharedExpense\.ts/);
  write('scripts/sqliteAndroidOpenExistingPatch.js', 'patch\n');
  assert.deepEqual(reviewers(stop('s8')), ['android-native-reviewer']);
  write('scripts/syncAgentSkills.js', 'sync\n');
  assert.equal(stop('s8'), null, 'other scripts need no reviewer');
  fs.rmSync(path.join(repo, 'scripts'), {recursive: true});
  fs.rmSync(path.join(repo, 'src/shared'), {recursive: true});
  fs.rmSync(path.join(repo, 'src/modules/transactions/types'), {recursive: true});
});

test('modifying or deleting an existing test asks for test-reviewer; a new test does not', () => {
  write('__tests__/existing.test.ts', 'expect(1).toBe(1)\n');
  git('add', '.');
  git('commit', '-q', '-m', 'test');
  baseline('s9');
  write('__tests__/brandNew.test.ts', 'new\n');
  assert.equal(stop('s9'), null);
  write('__tests__/existing.test.ts', 'expect(1).toBeTruthy()\n');
  const changed = stop('s9');
  assert.deepEqual(reviewers(changed), ['test-reviewer']);
  assert.match(changed.reason, /__tests__\/existing\.test\.ts/);
  fs.rmSync(path.join(repo, '__tests__/existing.test.ts'));
  assert.deepEqual(reviewers(stop('s9')), ['test-reviewer'], 'deleting an existing test is reminded too');
  git('checkout', '--', '.');
  fs.rmSync(path.join(repo, '__tests__/brandNew.test.ts'));
});

test('a skill change reminds skills:sync only while the two copies differ', () => {
  write('.claude/skills/demo/SKILL.md', 'v0\n');
  write('.agents/skills/demo/SKILL.md', 'v0\n');
  git('add', '.');
  git('commit', '-q', '-m', 'skills');
  baseline('s10');
  write('.claude/skills/demo/SKILL.md', 'v1\n');
  const drift = stop('s10');
  assert.equal(drift.decision, 'block');
  assert.match(drift.reason, /npm run skills:sync/);
  assert.deepEqual(reviewers(drift), []);
  write('.agents/skills/demo/SKILL.md', 'v1\n');
  write('.claude/skills/demo/SKILL.md', 'v1\n');
  assert.equal(stop('s10'), null, 'identical copies need no reminder');
  write('.claude/skills/demo/references/new.md', 'extra\n');
  assert.match(stop('s10').reason, /references\/new\.md/, 'a file missing from one copy is a difference');
  git('checkout', '--', '.');
  fs.rmSync(path.join(repo, '.claude/skills/demo/references'), {recursive: true});
});

test('the smartfin-development workflow selects exactly the same reviewers as the hook', () => {
  const {REVIEWERS, IGNORED} = require(script);
  const source = fs.readFileSync(path.resolve(__dirname, '../../workflows/smartfin-development.js'), 'utf8');
  const start = source.indexOf('const baseName =');
  const end = source.indexOf('\n', source.indexOf('const IGNORED ='));
  assert.ok(start > 0 && end > start, 'workflow reviewer rules not found');
  const workflow = new Function(source.slice(start, end) + '\nreturn {REVIEWER_RULES, IGNORED};')();
  const select = (rules, ignored, file) => (ignored(file) ? [] : rules.filter(rule => rule.test(file)).map(rule => `${rule.name}: ${rule.why}`));
  const projectRoot = path.resolve(__dirname, '../../..');
  // Only the trees the rules can match; docs/ evidence alone lists megabytes of paths.
  const tracked = execFileSync('git', ['-C', projectRoot, 'ls-files', '--', 'src', 'android', 'scripts', '__tests__'],
    {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\n').filter(Boolean);
  assert.ok(tracked.length > 100, 'expected the project file list');
  const samples = ['src/shared/utils/copAmountInput.ts', 'src/shared/utils/transactionDate.ts', 'src/shared/types/finance.ts',
    'src/modules/loans/types/Loan.ts', 'scripts/patchReactNativeSqliteStorage.js', 'scripts/sqliteAndroidRecoveryPatch.js',
    'android/app/src/main/AndroidManifest.xml', 'src/modules/settings/ui/DriveBackupSection.tsx', '__tests__/x.test.ts', 'docs/a.md'];
  for (const file of [...tracked, ...samples])
    assert.deepEqual(select(workflow.REVIEWER_RULES, workflow.IGNORED, file), select(REVIEWERS, IGNORED, file), file);
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
