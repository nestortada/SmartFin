'use strict';

// Explicit, opt-in integration test. Starts one ephemeral Codex session, not a
// destructive shell command. Requires the installed/authenticated Codex runtime.
// Native per-process trust is pinned to the definition reviewed for this version;
// it is NOT a bypass and is never persisted to config.toml.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../..');
const USER_CONFIG = path.join(process.env.USERPROFILE, '.codex/config.toml');
const REVIEWED_HASH = 'sha256:f817c22dd8e721c81bc016f46c2a6a4e50960716a2576223cd982a1efbf65da2';
const ALLOWED = "Write-Output 'DG_INTEGRATION_ALLOWED'";
const BLOCKED = 'Remove-Item -WhatIf -LiteralPath .codex/hooks.json';
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  const before = hashFile(USER_CONFIG);
  const guardFile = path.join(ROOT, '.codex/hooks.json');
  const guardBefore = hashFile(guardFile);
  const key = guardFile + ':pre_tool_use:0:0';
  // The path is a TOML literal key, not shell source. Reject unrepresentable paths.
  assert.ok(!key.includes("'"));
  const nativeTrust = `hooks.state={ '${key}' = { trusted_hash = "${REVIEWED_HASH}" } }`;
  const child = spawn('codex.exe', ['app-server', '--strict-config', '-c', nativeTrust, '--listen', 'stdio://'], {
    cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
  });
  let buffer = '', threadId, complete = false, failed = false;
  const runs = [], executed = [], pending = new Map();
  const send = (id, method, params) => child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  const stop = () => { child.stdin.end(); child.kill(); };
  const reportError = error => {
    if (failed) return;
    failed = true;
    console.error(error.message);
    process.exitCode = 1;
    stop();
  };
  const timer = setTimeout(() => reportError(Error('Integration exceeded 55 seconds')), 55000);
  child.on('error', reportError);
  child.stderr.on('data', () => { /* no credential diagnostics/transcripts in test output */ });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        if (message.error) throw Error(`Codex RPC failed: ${message.error.message}`);
        if (message.id === 1) {
          child.stdin.write('{"method":"initialized"}\n');
          send(2, 'hooks/list', { cwds: [ROOT] });
        } else if (message.id === 2) {
          const hooks = message.result.data.flatMap(row => row.hooks);
          const hook = hooks.find(row => row.key === key);
          assert.ok(hook, 'Project hook was not discovered');
          assert.equal(hook.currentHash, REVIEWED_HASH, 'Definition changed: review it before updating the pinned hash');
          assert.equal(hook.trustStatus, 'trusted');
          assert.equal(hook.enabled, true);
          assert.equal(hook.source, 'project');
          assert.equal(hook.async, false);
          console.log(JSON.stringify({ projectHook: true, trust: hook.trustStatus, hash: hook.currentHash }));
          send(3, 'thread/start', {
            cwd: ROOT, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only',
            developerInstructions: `Authorized harmless hook integration test. Run exactly two shell tool calls sequentially: first ${ALLOWED}; second ${BLOCKED}. Keep -WhatIf. Never combine them. Do not inspect files, modify files, access financial databases, call network tools, or run any other commands. If denied, do not retry, change syntax, or work around it. Report actual outcomes.`,
          });
        } else if (message.id === 3) {
          threadId = message.result.thread.id;
          send(4, 'turn/start', { threadId, input: [{ type: 'text', text: 'Perform the two authorized harmless probes exactly as specified.' }] });
        }
        if (message.method === 'hook/started') pending.set(message.params.run.id, true);
        if (message.method === 'hook/completed') runs.push(message.params.run);
        if (message.method === 'item/completed' && message.params.item?.type === 'commandExecution')
          executed.push(message.params.item);
        if (message.method === 'turn/completed') {
          assert.equal(message.params.turn.status, 'completed');
          assert.equal(runs.length, 2, 'Expected exactly two checked calls');
          assert.equal(pending.size, 2);
          assert.equal(runs[0].status, 'completed');
          assert.equal(runs[1].status, 'blocked');
          assert.ok(runs[1].entries.some(entry => /DG-FILE/.test(entry.text)));
          assert.equal(executed.length, 1, 'Denied command must never reach execution');
          assert.equal(executed[0].exitCode, 0);
          assert.equal(executed[0].aggregatedOutput.trim(), 'DG_INTEGRATION_ALLOWED');
          assert.equal(hashFile(guardFile), guardBefore);
          complete = true;
          console.log(JSON.stringify({ allowed: true, blocked: true, blockedCommandWasNotExecuted: true,
            hookLatencyMs: runs.map(run => run.durationMs), ephemeral: true }));
          stop();
        }
      } catch (error) { reportError(error); }
    }
  });
  child.on('exit', () => {
    clearTimeout(timer);
    const unchanged = hashFile(USER_CONFIG) === before;
    console.log(JSON.stringify({ globalConfigUnchanged: unchanged }));
    if (!complete || !unchanged || failed) process.exitCode = 1;
  });
  send(1, 'initialize', { clientInfo: { name: 'smartfin_guard_integration', version: '1.0' }, capabilities: { experimentalApi: true } });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
