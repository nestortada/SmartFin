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
// The reviewer tests below assume the session already ran every check in CHECKS, so `stop` records that first;
// the verification tests at the end use `rawStop` to exercise the verification reminder itself.
const ALL_CHECKS = 'npm run typecheck && npm test -- --runInBand && node --test .claude/hooks/__tests__/x.test.cjs';
const verify = (session, command = ALL_CHECKS) => run('verified', {session_id: session, cwd: repo, tool_input: {command}});
const rawStop = (session, extra = {}) => run('stop', {session_id: session, cwd: repo, stop_hook_active: false, ...extra});
const stop = (session, extra = {}) => {
  verify(session);
  return rawStop(session, extra);
};
const baseline = session => run('baseline', {session_id: session, cwd: repo});
const reviewers = result => (result ? [...result.reason.matchAll(/^- ([\w-]+)/gm)].map(m => m[1]) : []);
const checks = result => (result ? [...result.reason.matchAll(/^• ([\w-]+)/gm)].map(m => m[1]) : []);

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
  // Skills are protected by the guard, so the owner-review reminder still fires for the .agents copy; what must not
  // appear once the copies are identical is the skills:sync reminder.
  const synced = stop('s10');
  assert.ok(synced, 'a changed .agents/skills file is control plane: the owner-review reminder fires');
  assert.match(synced.reason, /plano de control/);
  assert.doesNotMatch(synced.reason, /skills:sync/, 'identical copies need no skills:sync reminder');
  assert.deepEqual(reviewers(synced), []);
  assert.deepEqual(checks(synced), []);
  write('.claude/skills/demo/references/new.md', 'extra\n');
  // The owner-review reminder also names the file, so the difference itself is proven by the skills:sync request.
  const missing = stop('s10');
  assert.match(missing.reason, /skills:sync/, 'a file missing from one copy is a difference');
  assert.match(missing.reason, /references\/new\.md/);
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
  const tracked = execFileSync('git', ['-C', projectRoot, 'ls-files', '--', 'src', 'android', 'scripts', '__tests__',
    '.claude', '.codex', '.agents', '.github', 'AGENTS.md', 'CLAUDE.md'],
  {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\n').filter(Boolean);
  assert.ok(tracked.length > 100, 'expected the project file list');
  assert.ok(tracked.some(file => file.startsWith('.claude/agent-memory/')), 'expected the agent memory in the file list');
  const samples = ['src/shared/utils/copAmountInput.ts', 'src/shared/utils/transactionDate.ts', 'src/shared/types/finance.ts',
    'src/modules/loans/types/Loan.ts', 'scripts/patchReactNativeSqliteStorage.js', 'scripts/sqliteAndroidRecoveryPatch.js',
    'android/app/src/main/AndroidManifest.xml', 'src/modules/settings/ui/DriveBackupSection.tsx', '__tests__/x.test.ts', 'docs/a.md',
    '.claude/agent-memory/financial-reviewer/nuevo-tema.md', '.claude/agents/nuevo.md', '.claude/rules/nueva.md',
    '.claude/hooks/__tests__/nuevo.test.cjs', '.claude/settings.local.json', '.claude/workflows/otro.js', '.claude/skills/x/SKILL.md'];
  for (const file of [...tracked, ...samples])
    assert.deepEqual(select(workflow.REVIEWER_RULES, workflow.IGNORED, file), select(REVIEWERS, IGNORED, file), file);
});

test('agent memory, agents, rules, hooks, settings and workflows ask for security review and owner diff review', () => {
  write('.claude/agent-memory/demo/MEMORY.md', '- [Tema](tema.md)\n');
  write('.claude/agents/demo.md', '---\nname: demo\n---\n');
  write('.claude/rules/demo.md', 'regla\n');
  write('.claude/settings.json', '{}\n');
  write('.claude/workflows/demo.js', 'export const meta = {}\n');
  write('CLAUDE.md', 'instrucciones\n');
  git('add', '.');
  git('commit', '-q', '-m', 'control plane');
  for (const [file, text] of [['.claude/agent-memory/demo/MEMORY.md', '- [Tema](tema.md) v2\n'],
    ['.claude/agent-memory/demo/nuevo.md', 'recuerdo sintético\n'], ['.claude/agents/demo.md', '---\nname: demo2\n---\n'],
    ['.claude/rules/demo.md', 'regla v2\n'], ['.claude/settings.json', '{"x":1}\n'], ['.claude/workflows/demo.js', 'v2\n']]) {
    const session = `cp-${file}`;
    baseline(session);
    write(file, text);
    const result = stop(session);
    assert.ok(result, `${file} must be reminded`);
    assert.deepEqual(reviewers(result), ['security-privacy-reviewer'], file);
    assert.match(result.reason, /plano de control/, file);
    assert.match(result.reason, /revisar el diff/, file);
    assert.equal(stop(session), null, `${file}: the same version is reminded once`);
  }
  baseline('cp-delete');
  fs.rmSync(path.join(repo, '.claude/agent-memory/demo/MEMORY.md'));
  assert.deepEqual(reviewers(stop('cp-delete')), ['security-privacy-reviewer'], 'deleting a memory file is reminded too');
  baseline('cp-claude');
  write('CLAUDE.md', 'instrucciones v2\n');
  const instructions = stop('cp-claude');
  assert.deepEqual(reviewers(instructions), [], 'CLAUDE.md is protected but has no path reviewer');
  assert.match(instructions.reason, /revisar el diff/);
  git('checkout', '--', '.');
  fs.rmSync(path.join(repo, '.claude/agent-memory/demo/nuevo.md'), {force: true});
});

test('the reminder protects exactly the control-plane paths of the guard', () => {
  const {PROTECTED} = require(script);
  const {controlPath} = require(path.resolve(__dirname, '../dangerous-command-guard.cjs'));
  const projectRoot = path.resolve(__dirname, '../../..');
  const tracked = execFileSync('git', ['-C', projectRoot, 'ls-files'], {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024})
    .split('\n').filter(Boolean);
  // Git reports paths with their real case (CLAUDE.md), and PROTECTED compares that form; the guard compares lower
  // case because Windows paths are case-insensitive. The samples use the repository's real spelling.
  const samples = ['.claude/agent-memory/x/MEMORY.md', '.claude/commands/x.md', '.mcp.json', '.claude/settings.local.json',
    '.codex/hooks.json', '.agents/skills/x/SKILL.md', 'docs/CLAUDE.md', 'src/AGENTS.md', '.claude/worktrees/x/CLAUDE.md'];
  for (const file of [...tracked, ...samples]) assert.equal(PROTECTED(file), controlPath(file.toLowerCase()), file);
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

test('code changed in the session asks for typecheck and Jest once per version, without listing them as reviewers', () => {
  baseline('v1');
  write('src/modules/transactions/ui/Screen.tsx', 'unverified\n');
  const first = rawStop('v1');
  assert.equal(first.decision, 'block');
  assert.deepEqual(checks(first), ['typecheck', 'jest']);
  assert.deepEqual(reviewers(first), [], 'checks are not reviewers');
  assert.match(first.reason, /ui\/Screen\.tsx/);
  assert.match(first.reason, /code-quality-reviewer/, 'production code mentions the quality reviewer');
  assert.equal(rawStop('v1'), null, 'the same version is not reminded again even if no check ran');
  write('src/modules/transactions/ui/Screen.tsx', 'edited again\n');
  assert.deepEqual(checks(rawStop('v1')), ['typecheck', 'jest'], 'a new version is reminded again');
  git('checkout', '--', '.');
});

test('a check that ran after the last edit is not reminded; one that ran before it is', () => {
  baseline('v2');
  write('src/modules/transactions/ui/Screen.tsx', 'a\n');
  verify('v2', 'npm run typecheck 2>&1 | Select-Object -Last 20');
  assert.deepEqual(checks(rawStop('v2')), ['jest'], 'typecheck ran on this version');
  write('src/modules/transactions/ui/Screen.tsx', 'b\n');
  verify('v2', 'npx jest __tests__/screen.test.tsx');
  assert.deepEqual(checks(rawStop('v2')), ['typecheck'], 'typecheck ran on the previous version only');
  write('src/modules/transactions/ui/Screen.tsx', 'c\n');
  verify('v2', 'npx tsc --noEmit');
  verify('v2', 'npm run test:reproductions -- --runInBand');
  assert.equal(rawStop('v2'), null);
  git('checkout', '--', '.');
});

test('commands that do not run a check, and changes no check covers, never count', () => {
  baseline('v3');
  write('src/modules/transactions/ui/Screen.tsx', 'x\n');
  for (const command of ['git status', 'cat jest.config.js', 'grep -rn tsc src', 'node --test other/x.test.cjs']) verify('v3', command);
  assert.deepEqual(checks(rawStop('v3')), ['typecheck', 'jest']);
  git('checkout', '--', '.');
  baseline('v4');
  write('docs/fase.md', 'doc only\n');
  write('android/app/src/main/java/com/smartfin/Module.kt', 'kotlin\n');
  assert.deepEqual(checks(rawStop('v4')), [], 'docs and Kotlin are outside typecheck, Jest and hook tests');
  git('checkout', '--', '.');
});

test('test-only and hook changes ask only for the checks that cover them', () => {
  baseline('v5');
  write('__tests__/newCase.test.ts', 'new\n');
  const testOnly = rawStop('v5');
  assert.deepEqual(checks(testOnly), ['typecheck', 'jest']);
  assert.doesNotMatch(testOnly.reason, /code-quality-reviewer/, 'tests alone are not production code');
  fs.rmSync(path.join(repo, '__tests__/newCase.test.ts'));
  write('.claude/hooks/demo.cjs', 'hook\n');
  assert.deepEqual(checks(rawStop('v5')), ['hooks']);
  write('.claude/hooks/demo.cjs', 'hook v2\n');
  verify('v5', 'node --test .claude/hooks/__tests__/demo.test.cjs');
  // A hook is control plane: the new version still asks for the security review, but no longer for the hook tests.
  const afterTests = rawStop('v5');
  assert.deepEqual(checks(afterTests), []);
  assert.deepEqual(reviewers(afterTests), ['security-privacy-reviewer']);
  assert.match(afterTests.reason, /plano de control/);
  fs.rmSync(path.join(repo, '.claude/hooks'), {recursive: true});
});

test('pending work from before the session never asks for checks, and a reminder is merged with reviewers', () => {
  write('src/modules/transactions/useCases/save.ts', 'user change\n');
  baseline('v6');
  assert.equal(rawStop('v6'), null);
  write('src/modules/transactions/useCases/save.ts', 'claude change\n');
  const both = rawStop('v6');
  assert.deepEqual(reviewers(both), ['financial-reviewer']);
  assert.deepEqual(checks(both), ['typecheck', 'jest']);
  git('checkout', '--', '.');
});

test('CLI verified mode is silent, ignores unrelated commands and survives bad input', () => {
  const cli = input => spawnSync(process.execPath, [script, 'verified'], {input, encoding: 'utf8', timeout: 10000, env: process.env});
  for (const input of [JSON.stringify({session_id: 'c9', cwd: repo, tool_input: {command: 'npm run typecheck'}}),
    JSON.stringify({session_id: 'c9', cwd: repo, tool_input: {command: 'git status'}}), 'not json']) {
    const result = cli(input);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  }
});
