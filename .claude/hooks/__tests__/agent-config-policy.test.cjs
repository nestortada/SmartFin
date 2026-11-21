'use strict';
// Invariants of the agents' control plane (PR 2 memory protection and PR 3 guard). It reads the committed
// configuration and fails if a protection disappears: the ask rule for agent memory, financial-reviewer's memory and
// denied write tools, the sensitive read denials, the four hooks, the guard's fail-closed registration, the protected
// paths, the pinned content of the hook suites, the workflow's agent_config decision and the reviewer parity between
// hook and workflow.
// Only Node built-ins and synthetic paths: nothing is written to the repository.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
// Normalized line endings: a Windows checkout may use CRLF.
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const settings = JSON.parse(read('.claude/settings.json'));
const guard = require('../dangerous-command-guard.cjs');
const reminder = require('../reviewer-reminder.cjs');
const workflowSource = read('.claude/workflows/smartfin-development.js');

// Frontmatter of an agent definition as {key: raw value}; list values (skills:) are not needed here.
function frontmatter(file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(file));
  assert.ok(match, `${file} has no frontmatter`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([\w-]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2].trim();
  }
  return fields;
}
const list = value => (value || '').split(',').map(item => item.trim()).filter(Boolean);

test('1. permissions.ask keeps the PR 2 protection of agent memory', () => {
  assert.ok(settings.permissions.ask.includes('Edit(/.claude/agent-memory/**)'));
});

test('2-3. financial-reviewer keeps memory: project and cannot Write, Edit or NotebookEdit', () => {
  const agent = frontmatter('.claude/agents/financial-reviewer.md');
  assert.equal(agent.name, 'financial-reviewer');
  assert.equal(agent.memory, 'project');
  const denied = list(agent.disallowedTools);
  for (const tool of ['Write', 'Edit', 'NotebookEdit']) assert.ok(denied.includes(tool), `disallowedTools must include ${tool}`);
  for (const tool of list(agent.tools)) assert.ok(!['Write', 'Edit', 'NotebookEdit', 'MultiEdit'].includes(tool), `tools must not grant ${tool}`);
  assert.ok(fs.existsSync(path.join(root, '.claude/agent-memory/financial-reviewer/MEMORY.md')), 'the memory index exists');
  assert.ok(fs.existsSync(path.join(root, '.claude/agent-memory/README.md')), 'the memory rules exist');
});

test('the seven agents keep a loadable definition', () => {
  const expected = ['android-native-reviewer', 'code-quality-reviewer', 'financial-reviewer', 'mechanical', 'scout',
    'security-privacy-reviewer', 'test-reviewer'];
  const files = fs.readdirSync(path.join(root, '.claude/agents')).filter(file => file.endsWith('.md')).sort();
  assert.deepEqual(files, expected.map(name => `${name}.md`));
  for (const name of expected) {
    const agent = frontmatter(`.claude/agents/${name}.md`);
    assert.equal(agent.name, name);
    assert.ok(agent.description, `${name} has a description`);
    // An unquoted description containing ": " is invalid YAML and Claude Code drops the agent silently.
    if (agent.description.includes(': ')) assert.match(agent.description, /^["'].*["']$/, `${name}: quote the description`);
  }
  // Reviewers stay without edit tools (memory: project would add them otherwise).
  for (const name of expected.filter(n => n.endsWith('reviewer') || n === 'scout')) {
    const agent = frontmatter(`.claude/agents/${name}.md`);
    for (const tool of list(agent.tools)) assert.ok(!['Write', 'Edit', 'NotebookEdit'].includes(tool), `${name} must not have ${tool}`);
    if (agent.memory) for (const tool of ['Write', 'Edit', 'NotebookEdit']) assert.ok(list(agent.disallowedTools).includes(tool), `${name} with memory must deny ${tool}`);
  }
});

test('4. permissions.deny keeps the sensitive read denials', () => {
  for (const rule of ['Read(**/.env)', 'Read(**/.env.local)', 'Read(**/.env.*.local)', 'Read(**/.env.development)',
    'Read(**/.env.production)', 'Read(**/.env.staging)', 'Read(**/*.keystore)', 'Read(**/*.jks)', 'Read(**/*.p12)',
    'Read(**/*.pfx)', 'Read(**/*.pem)', 'Read(**/*.key)', 'Read(**/*.db)', 'Read(**/*.db-wal)', 'Read(**/*.db-shm)',
    'Read(**/*.db-journal)', 'Read(**/*.sqlite)', 'Read(**/*.sqlite3)', 'Read(**/smartfin-local-snapshots/**)',
    'Read(**/smartfin-backup-jobs/**)'])
    assert.ok(settings.permissions.deny.includes(rule), `permissions.deny must keep ${rule}`);
});

test('permissions.allow holds only read-only or local verification commands; writing variants ask', () => {
  const approved = new Set(['git status *', 'git diff *', 'git log *', 'git show *', 'npm test *', 'npm run typecheck *',
    'npm run lint *', 'npm run test:reproductions *', 'npm run skills:check *', 'npm run skills:sync *', 'npx tsc --noEmit *',
    'node --test .claude/hooks/__tests__/*', 'node --test .codex/hooks/__tests__/*', 'npx jest *', 'npx eslint *',
    'git branch --show-current', 'git rev-parse *', 'git merge-base *', 'git ls-files *', 'git blame *', 'git worktree list *']);
  for (const rule of settings.permissions.allow) {
    const match = /^(Bash|PowerShell)\((.*)\)$/.exec(rule);
    assert.ok(match && approved.has(match[2]), `unexpected permissions.allow entry ${rule}: allow only read-only or verification commands`);
  }
  for (const shell of ['Bash', 'PowerShell'])
    for (const rule of ['npx jest -u*', 'npx jest * -u*', 'npx jest *--updateSnapshot*', 'npm test * -u*', 'npm test *--updateSnapshot*',
      'npx eslint *--fix*', 'npm run lint *--fix*', 'git diff *--output*', 'git log *--output*', 'git show *--output*'])
      assert.ok(settings.permissions.ask.includes(`${shell}(${rule})`), `permissions.ask must include ${shell}(${rule})`);
});

test('5-6. the four hooks stay registered and the guard fails closed', () => {
  const hooks = settings.hooks;
  const pre = hooks.PreToolUse.flatMap(entry => entry.hooks.map(hook => ({...hook, matcher: entry.matcher})))
    .find(hook => /dangerous-command-guard\.cjs/.test(hook.command));
  assert.ok(pre, 'PreToolUse runs dangerous-command-guard.cjs');
  assert.equal(pre.onFailure, 'block');
  const matcher = new RegExp(pre.matcher);
  for (const tool of ['Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']) assert.ok(matcher.test(tool), `the guard covers ${tool}`);
  const commands = event => (hooks[event] || []).flatMap(entry => entry.hooks.map(hook => hook.command)).join('\n');
  assert.match(commands('PostToolUse'), /reviewer-reminder\.cjs" verified/);
  assert.match(commands('SessionStart'), /reviewer-reminder\.cjs" baseline/);
  assert.match(commands('SessionStart'), /session-context\.cjs/);
  assert.match(commands('Stop'), /reviewer-reminder\.cjs" stop/);
});

test('7. the guard protects every control-plane path and asks before writing it', () => {
  // Exact lists: removing (or adding) a protected path must be a deliberate change that also updates this test and the
  // documentation (docs/dangerous-command-guard-claude.md, .claude/rules/agent-config.md).
  assert.deepEqual([...guard.CONTROL_DIRS].sort(), ['.agents', '.claude/agent-memory', '.claude/agent-memory-local', '.claude/agents',
    '.claude/commands', '.claude/hooks', '.claude/rules', '.claude/skills', '.claude/workflows', '.codex']);
  assert.deepEqual([...guard.CONTROL_FILES].sort(), ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json', 'agents.md', 'claude.md']);
  const decideGit = command => guard.evaluate({tool_name: 'Bash', cwd: root, tool_input: {command}}).decision;
  assert.equal(decideGit('echo x > .git/info/exclude'), 'ask', '.git stays protected as well');
  const targets = ['.claude/agent-memory/financial-reviewer/MEMORY.md', '.claude/agent-memory/financial-reviewer/sintetico.md',
    '.claude/agents/sintetico.md', '.claude/rules/sintetica.md', '.claude/workflows/sintetico.js', '.claude/hooks/sintetico.cjs',
    '.claude/skills/sintetico/SKILL.md', '.claude/settings.json', '.claude/settings.local.json', 'CLAUDE.md', 'AGENTS.md',
    '.codex/sintetico.json', '.agents/skills/sintetico/SKILL.md', '.claude/commands/sintetico.md', '.mcp.json',
    '.claude/agent-memory-local/financial-reviewer/MEMORY.md'];
  const decide = (tool_name, tool_input) => guard.evaluate({tool_name, cwd: root, tool_input}).decision;
  for (const file of targets) {
    assert.equal(decide('Write', {file_path: file, content: 'x'}), 'ask', `Write ${file}`);
    assert.equal(decide('Edit', {file_path: file, old_string: 'a', new_string: 'b'}), 'ask', `Edit ${file}`);
    assert.equal(decide('NotebookEdit', {notebook_path: file, new_source: 'x'}), 'ask', `NotebookEdit ${file}`);
    assert.equal(decide('Bash', {command: `echo x > ${file}`}), 'ask', `Bash > ${file}`);
    assert.equal(decide('Bash', {command: `rm ${file}`}), 'ask', `Bash rm ${file}`);
    assert.equal(decide('PowerShell', {command: `Set-Content -Path ${file} -Value x`}), 'ask', `PowerShell ${file}`);
    assert.equal(decide('Bash', {command: `cat ${file}`}), 'allow', `reading ${file} stays allowed`);
  }
});

test('7b. the guard runs only the reviewed content of the four hook suites without analysing it', () => {
  // The suites that CI runs (guard-hooks job) are the only scripts the guard lets node --test run unread, and only with
  // the pinned content (SHA-256 with LF endings). Changing a suite means updating its pin in the guard, a reviewed change.
  const ci = read('.github/workflows/ci.yml');
  const suites = [...new Set(ci.match(/\.claude\/hooks\/__tests__\/[\w-]+\.test\.cjs/g))].sort();
  assert.deepEqual(Object.keys(guard.HOOK_SUITES).sort(), suites, 'pinned suites = suites run by CI');
  for (const file of suites) {
    const digest = crypto.createHash('sha256').update(read(file)).digest('hex');
    assert.equal(guard.HOOK_SUITES[file], digest, `pin of ${file} (update it in dangerous-command-guard.cjs after reviewing the change)`);
    assert.equal(guard.evaluate({tool_name: 'Bash', cwd: root, tool_input: {command: `node --test ${file}`}}).decision, 'allow', file);
  }
  assert.equal(guard.evaluate({tool_name: 'Bash', cwd: root, tool_input: {command: 'node --test'}}).decision, 'ask', 'discovery asks');
});

// The workflow is an ES module run by Claude Code: its decision helpers are evaluated from the source text.
function workflowDecisions() {
  const slice = (from, to) => {
    const start = workflowSource.indexOf(from);
    const end = workflowSource.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `workflow section not found: ${from}`);
    return workflowSource.slice(start, end + to.length);
  };
  const code = [
    slice('const baseName =', '\n'),
    slice('const uniq =', '\n'),
    slice('const OWNER_DECISIONS =', '\n}\n'),
    slice('const DECISION_KEYS =', '\n'),
    slice('const PATH_DECISIONS =', '\n]\n'),
    slice('function decisionsForPaths(', '\n}\n'),
    slice('function validAuthorizations(', '\n}\n'),
    'return {OWNER_DECISIONS, decisionsForPaths, validAuthorizations};',
  ].join('\n');
  return new Function(code)();
}

test('8. the workflow requires agent_config for memory, agents, rules and the rest of the agent configuration', () => {
  const {decisionsForPaths, validAuthorizations} = workflowDecisions();
  for (const file of ['.claude/agent-memory/financial-reviewer/MEMORY.md', '.claude/agent-memory/financial-reviewer/nuevo.md',
    '.claude/agent-memory-local/financial-reviewer/MEMORY.md', '.mcp.json', '.claude/agents/financial-reviewer.md', '.claude/rules/agent-config.md', '.claude/hooks/dangerous-command-guard.cjs',
    '.claude/workflows/smartfin-development.js', '.claude/settings.json', '.claude/settings.local.json', 'CLAUDE.md', 'AGENTS.md',
    '.codex/hooks.json', '.github/workflows/ci.yml'])
    assert.ok(decisionsForPaths([file]).includes('agent_config'), `${file} requires agent_config`);
  for (const file of ['src/modules/transactions/ui/Screen.tsx', 'docs/a.md', '__tests__/x.test.ts'])
    assert.ok(!decisionsForPaths([file]).includes('agent_config'), `${file} does not require agent_config`);
  // agent_config repeats the paths of CONTROL_REVIEW: every path that needs the security review also needs the owner's
  // decision, so the two lists cannot drift apart unnoticed.
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '--', '.claude', '.mcp.json'], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
    .split('\n').filter(Boolean);
  for (const file of [...tracked, '.claude/agent-memory-local/x/MEMORY.md', '.claude/agents/nuevo.md', '.claude/rules/nueva.md', '.mcp.json'])
    if (reminder.CONTROL_REVIEW(file)) assert.ok(decisionsForPaths([file]).includes('agent_config'), `${file}: CONTROL_REVIEW without agent_config`);
  const task = 'Ajusta la regla. Autorizo cambios de configuración de agentes y memoria para esta tarea. No toques los hooks.';
  assert.ok(validAuthorizations([{key: 'agent_config', quote: 'Autorizo cambios de configuración de agentes y memoria para esta tarea.'}], task).has('agent_config'));
  assert.ok(!validAuthorizations([{key: 'agent_config', quote: 'No toques los hooks.'}], task).has('agent_config'), 'a negative quote never authorizes');
  assert.ok(!validAuthorizations([{key: 'agent_config', quote: 'Autorizo modificar la memoria de agentes'}], task).has('agent_config'), 'the quote must be literal');
  assert.ok(!validAuthorizations([{key: 'agent_config', quote: 'Ajusta'}], task).has('agent_config'), 'a quote under 8 characters never authorizes');
  // Path decisions are added to the classifier's and checked again on the real diff; missing ones end in blocked.
  assert.match(workflowSource, /neededBefore = uniq\(\[\.\.\.classification\.requiredDecisions, \.\.\.decisionsForPaths\(scopeFiles\)\]\)/);
  assert.match(workflowSource, /if \(missingBefore\.length\)\s*\n\s*return finish\('blocked'/);
  assert.match(workflowSource, /const neededAfter = decisionsForPaths\(changed\)\.filter\(k => !authorized\.has\(k\)\)/);
  assert.match(workflowSource, /if \(neededAfter\.length\)\s*\n\s*return finish\('blocked'/);
  assert.match(workflowSource, /const stillOk = decisionsForPaths\(changed\)\.filter\(k => !authorized\.has\(k\)\)/);
  assert.match(workflowSource, /const WORKFLOW_REVISION = '\d{4}-\d{2}-\d{2}\.\d+'/);
});

test('9. hook and workflow select the same reviewers, control plane included', () => {
  const start = workflowSource.indexOf('const baseName =');
  const end = workflowSource.indexOf('\n', workflowSource.indexOf('const IGNORED ='));
  const workflow = new Function(workflowSource.slice(start, end) + '\nreturn {REVIEWER_RULES, IGNORED};')();
  const select = (rules, ignored, file) => (ignored(file) ? [] : rules.filter(rule => rule.test(file)).map(rule => `${rule.name}: ${rule.why}`));
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '--', '.claude', '.codex', '.agents', 'AGENTS.md', 'CLAUDE.md', '.github'],
    {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\n').filter(Boolean);
  for (const file of [...tracked, '.claude/agent-memory/financial-reviewer/nuevo.md', '.claude/agents/nuevo.md', '.claude/rules/nueva.md']) {
    assert.deepEqual(select(workflow.REVIEWER_RULES, workflow.IGNORED, file), select(reminder.REVIEWERS, reminder.IGNORED, file), file);
  }
  for (const file of ['.claude/agent-memory/financial-reviewer/MEMORY.md', '.claude/agents/financial-reviewer.md', '.claude/rules/agent-config.md',
    '.claude/hooks/dangerous-command-guard.cjs', '.claude/hooks/__tests__/dangerous-command-guard.test.cjs', '.claude/settings.json',
    '.claude/workflows/smartfin-development.js'])
    assert.ok(select(reminder.REVIEWERS, reminder.IGNORED, file).some(r => r.startsWith('security-privacy-reviewer')), `${file} needs security review`);
});
