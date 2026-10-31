'use strict';

// Every command below is DATA. Neither this suite nor the guard executes it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const guardPath = path.join(__dirname, '../dangerous-command-guard.cjs');
const { evaluate, parsePowerShell, loadPolicy } = require(guardPath);
const policy = loadPolicy();
const event = (command, extra = {}) => ({
  hook_event_name: 'PreToolUse', cwd: root, tool_name: 'Bash',
  tool_input: { command }, ...extra,
});
const check = (command, options) => evaluate(event(command), options);

const allowed = [
  'git status --short', 'git diff --stat', 'git log -5 --oneline',
  'git clean -nd', 'git clean --dry-run -fdx', 'git clean -n -d',
  'git status; git diff', 'git status && git diff',
  'npm test -- --runInBand', 'npm run lint', 'npx tsc --noEmit',
  'node --version', 'node --test .codex/hooks/__tests__/dangerous-command-guard.test.cjs',
  'Write-Output "git reset --hard"',
  'git status 2>$null',
  'powershell -NoProfile -Command "git status; git diff"',
  'cmd /d /c "git status && git diff"',
  "cmd /c 'powershell -Command \"git status; git diff\"'",
  'sqlite3 -readonly unknown.db "SELECT count(*) FROM transactions;"',
  'sqlite3 :memory: "CREATE TABLE transactions(id); DELETE FROM transactions;"',
  'sqlite3 :memory: "SELECT \'--\', \'/*\', \'ATTACH\';"',
  'adb -s emulator-5554 shell pm clear com.smartfin.snapshot5b2.tests',
  'adb -s AXCC6R3919012932 uninstall com.smartfin.sharedcommands.bench',
  'adb -s emulator-5554 shell dumpsys package com.smartfin',
  'Set-Content -LiteralPath docs/ordinary-note.md -Value "hello"',
  'Remove-Item -LiteralPath coverage -Recurse -Force',
  'Get-Content .env', // read restrictions/exfiltration are outside this hook
];
for (const command of allowed) test(`allow: ${command}`, () => {
  assert.equal(check(command).decision, 'allow');
});

const denied = [
  'git reset --hard HEAD', 'git reset --hard', 'git clean -fd',
  'git clean -f -d', 'git clean -ffdx', 'git.exe -C . reset --hard HEAD',
  'git restore --worktree src', 'git checkout -- src', 'git checkout -f HEAD',
  'git stash clear', 'git stash drop', 'git branch -D topic',
  'git status; git reset --hard HEAD', 'git status && git clean -fd',
  'git status || git reset --hard HEAD',
  'powershell -NoProfile -Command "git status; git reset --hard HEAD"',
  'pwsh -Command "cmd /c \"git clean -fd\""',
  'cmd /d /c "echo ok && rmdir /s /q src"',
  'cmd /c "del /f /q .env"',
  'Remove-Item -LiteralPath . -Recurse -Force', 'ri -r -fo ./src',
  'Get-ChildItem src | Remove-Item -Recurse -Force',
  'Remove-Item -Recurse $destination', 'Remove-Item -Recurse C:/unknown',
  'Remove-Item -Recurse ../SmartFin', 'Remove-Item -Recurse ./test-safe-data',
  'Remove-Item -Recurse ./coverage/../../src',
  'Remove-Item -Recurse ./coverage/*',
  'Set-Location ..; Remove-Item -Recurse coverage',
  'Remove-Item ./smartfin.db', 'Remove-Item ./smartfin.db-wal',
  'Remove-Item ./unknown.sqlite-shm', 'Remove-Item ./unknown.db-journal',
  'Set-Content ./smartfin.db anything', 'Copy-Item a.db ./smartfin.db -Force',
  'Move-Item ./smartfin.db ./backup.db',
  'sqlite3 smartfin.db "DELETE FROM transactions;"',
  'sqlite3 unknown.db "DELETE FROM transactions WHERE id=1;"',
  'sqlite3 unknown.db "SELECT 1; UPDATE accounts SET balance=0;"',
  'sqlite3 -readonly unknown.db "PRAGMA foreign_keys=OFF;"',
  'sqlite3 unknown.db "SELECT 1;"',
  'sqlite3 :memory: "ATTACH DATABASE \'smartfin.db\' AS real;"',
  'sqlite3 :memory: ".read cleanup.sql"',
  'sqlite3 :memory: "VACUUM INTO \'smartfin.db\';"',
  'sqlite3 :memory: "SELECT load_extension(\'something\');"',
  'sqlite3 :memory: "SELECT \'--\'; ATTACH DATABASE \'smartfin.db\' AS real;"',
  'sqlite3 :memory: "SELECT \'/*\'; ATTACH DATABASE \'smartfin.db\' AS real;"',
  'sqlite3 :memory: "SELECT 1 /* unterminated"',
  'adb shell pm clear com.smartfin', 'adb -s emulator-5554 uninstall com.smartfin',
  'adb -s emulator-5554 shell rm -rf /data/data/com.smartfin',
  'adb -s emulator-5554 shell pm clear com.example.test.safe',
  'adb shell pm clear com.smartfin.snapshot5b2.tests',
  'adb -s emulator-5554 shell pm clear $package',
  'adb -s emulator-5554 shell sqlite3 /data/data/com.smartfin/databases/smartfin.db "DELETE FROM accounts"',
  'adb -s emulator-5554 shell sh -c "pm clear com.smartfin"',
  'adb -s emulator-5554 push backup.db /data/user/0/com.smartfin/databases/smartfin.db',
  'adb restore all.ab', 'adb emu avd wipe-data',
  'adb -s emulator-5554 pull /sdcard/example.txt .env',
  'Set-Content .env "secret"', 'Clear-Content AGENTS.md',
  'Write-Output hello > .codex/hooks.json',
  'Remove-Item -WhatIf -LiteralPath .codex/hooks.json',
  'Set-Content src/database/sqliteSchema.ts ""',
  'Remove-Item android/app/debug.keystore',
  'Set-Content cuentas.csv ""',
  'Set-Content movimientos-2026.csv ""',
  'git -C C:/outside diff --output=ordinary.txt',
  "Remove-Item -LiteralPath '$null'",
  'Set-Location ..; Write-Output x > coverage/example.txt',
  'Copy-Item .env docs -Force',
  'Move-Item src coverage',
  'node', 'node --require ./preload.cjs --version',
  'node -e"require(\'fs\').rmSync(\'src\')"',
  'python -c"print(1)"', 'bash -lc "git reset --hard"',
  'cmd /c "call git reset --hard"',
  'cmd /c "if exist src rmdir /s /q src"',
  "cmd /c 'powershell -Command \"Write-Output ok; Remove-Item src -Recurse\"'",
  'node -e "require(\'fs\').rmSync(\'src\',{recursive:true})"',
  'python -c "import os; os.remove(\'smartfin.db\')"',
  'Invoke-Expression $command', '[IO.File]::Delete("smartfin.db")',
  '& $executable reset --hard', 'Set-Alias wipe Remove-Item; wipe src',
  'cmd /c "rmdir /s /q %TARGET%"',
  'Start-Process cmd -ArgumentList "/c rmdir /s /q src"',
];
for (const command of denied) test(`deny: ${command}`, () => {
  const result = check(command);
  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /^DG-/);
});

test('PowerShell AST distinguishes literal text, nested expressions and redirects', () => {
  const parsed = parsePowerShell('Write-Output "git clean -fd"; Remove-Item "$target"; Write-Output x > .env');
  assert.equal(parsed.commands[0].args[0], 'git clean -fd');
  assert.equal(parsed.commands[1].args[0], null);
  assert.equal(parsed.redirects[0], '.env');
});

test('git -c and aliases cannot replace the meaning of a safe command', () => {
  assert.equal(check('git -c alias.wipe="reset --hard" wipe').decision, 'deny');
  assert.equal(check('git mystery-subcommand').decision, 'deny');
});

for (const payload of [null, [], {}, { ...event('git status'), cwd: null },
  { ...event('git status'), tool_input: {} }, event('"unterminated'), event('x'.repeat(131073))]) {
  test(`malformed event ${JSON.stringify(payload).slice(0, 75)}`, () => {
    assert.equal(evaluate(payload).decision, 'deny');
  });
}

test('parser failure and filesystem failure return explicit denials', () => {
  assert.equal(check('git status', { parse: () => { throw Error('private detail'); } }).decision, 'deny');
  assert.equal(check('Remove-Item coverage -Recurse', {
    inspectPath: () => { throw Error('private detail'); },
  }).decision, 'deny');
});

test('symbolic-link destinations are denied (simulated, no links or files created)', () => {
  assert.equal(check('Remove-Item coverage -Recurse', {
    inspectPath: () => ({ linked: true }),
  }).decision, 'deny');
});

test('a generated directory containing database files is denied without opening them', () => {
  assert.equal(check('Remove-Item coverage -Recurse', {
    inspectPath: () => ({ linked: false, protectedDescendant: true }),
  }).decision, 'deny');
});

test('file patches protect the guard, secrets and sensitive deletions', () => {
  for (const patch of [
    '*** Begin Patch\n*** Delete File: .codex/hooks.json\n*** End Patch',
    '*** Begin Patch\n*** Update File: .env\n@@\n-a\n+b\n*** End Patch',
    '*** Begin Patch\n*** Delete File: src/database/sqliteSchema.ts\n*** End Patch',
    '*** Begin Patch\n*** Update File: src/database/sqliteSchema.ts\n@@\n-old code\n*** End Patch',
    '*** Begin Patch\n*** Update File: src/database/sqliteSchema.ts\n@@\n-old\n+DROP TABLE accounts;\n*** End Patch',
  ]) assert.equal(evaluate(event(patch, { tool_name: 'apply_patch' })).decision, 'deny');
  assert.equal(evaluate(event('*** Begin Patch\n*** Update File: src/modules/dashboard/ui/Example.tsx\n@@\n-a\n+b\n*** End Patch',
    { tool_name: 'apply_patch' })).decision, 'allow');
});

test('documenting destructive examples is allowed, without executing those examples', () => {
  assert.equal(evaluate(event('*** Begin Patch\n*** Update File: docs/example.md\n@@\n+DROP TABLE accounts;\n*** End Patch',
    { tool_name: 'apply_patch' })).decision, 'allow');
});

test('CMD native shell arguments and literal path resolution', () => {
  assert.equal(evaluate(event('git status && git diff', {
    tool_input: { command: 'git status && git diff', shell: 'cmd.exe' },
  })).decision, 'allow');
  assert.equal(evaluate(event('rmdir /s /q src', {
    tool_input: { command: 'rmdir /s /q src', shell: 'cmd.exe' },
  })).decision, 'deny');
  for (const dest of ['C:coverage', '\\\\server\\share', './coverage/file.txt:stream', './coverage/file.']) {
    assert.equal(check(`Set-Content -LiteralPath '${dest}' -Value x`).decision, 'deny');
  }
});

test('PowerShell subexpressions are inspected even inside an output string', () => {
  assert.equal(check('Write-Output "$(git reset --hard HEAD)"').decision, 'deny');
  assert.equal(check("pwsh -Command 'powershell -Command \"git reset --hard\"'").decision, 'deny');
});

test('parser timeout is a denial, not permission to continue', () => {
  assert.throws(() => parsePowerShell('git status', { ...policy, parserTimeoutMs: 1 }), /DG-PARSE/);
});

test('unknown tools have no claimed coverage', () => {
  assert.equal(evaluate({ ...event('anything'), tool_name: 'mcp__unknown__tool' }).decision, 'allow');
});

test('policy has exact audited synthetic identities, not substring exceptions', () => {
  assert.ok(policy.android.syntheticPackages.some(p => p.id === 'com.smartfin.snapshot5b2.tests'));
  assert.equal(check('sqlite3 ./test-safe.db "DELETE FROM accounts;"').decision, 'deny');
});

test('the audited fixture generator is allowed only with its pinned bytes and no overrides', () => {
  const command = 'node scripts/phase5e3/reader-contract.cjs';
  assert.equal(check(command).decision, 'allow');
  assert.equal(check(command, { verifyScript: () => false }).decision, 'deny');
  assert.equal(check(command + ' --output ./src').decision, 'deny');
});

test('CLI protocol: success is silent, denials are JSON, malformed input fails closed', () => {
  for (const [input, expected] of [[JSON.stringify(event('git status')), 'allow'],
    [JSON.stringify(event('git reset --hard')), 'deny'], ['not json', 'deny']]) {
    const result = spawnSync(process.execPath, [guardPath], { input, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    if (expected === 'allow') assert.equal(result.stdout, '');
    else assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(result.stderr, '');
  }
});

test('guard error does not leak private details into its denial', () => {
  const result = check('git status', { parse: () => { throw Error('SECRET_VALUE'); } });
  assert.equal(result.decision, 'deny');
  assert.ok(!JSON.stringify(result).includes('SECRET_VALUE'));
});

test('latency: real parser plus protocol remains below the hook timeout', t => {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const before = performance.now();
    const result = spawnSync(process.execPath, [guardPath], {
      input: JSON.stringify(event(i % 2 ? 'git reset --hard' : 'git status')),
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0);
    samples.push(Math.round(performance.now() - before));
  }
  t.diagnostic(JSON.stringify({ latencyMs: samples, maxMs: Math.max(...samples) }));
  assert.ok(Math.max(...samples) < 4500);
});

test('config uses a synchronous documented handler and Windows override', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, '.codex/hooks.json'), 'utf8'));
  const handler = config.hooks.PreToolUse[0].hooks[0];
  assert.equal(handler.type, 'command');
  assert.notEqual(handler.async, true);
  assert.ok(handler.commandWindows);
});
