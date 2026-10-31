'use strict';

// Infrastructure only. Never evaluates source commands or opens SQLite files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const ALLOW = Object.freeze({ decision: 'allow' });
const fail = (rule, message) => { throw new Error(`DG-${rule}: ${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const slash = value => value.replaceAll('\\', '/').toLowerCase();
const beneath = (candidate, parent) => candidate === parent || candidate.startsWith(parent + '/');
const executable = name => slash(name).split('/').at(-1).replace(/\.(exe|cmd|bat|com)$/i, '');

function loadPolicy() {
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'dangerous-command-policy.json'), 'utf8'));
  if (policy.version !== 1 || policy.maxCommandLength !== 131072 ||
      !Number.isInteger(policy.parserTimeoutMs) || policy.parserTimeoutMs < 100 || policy.parserTimeoutMs > 3000 ||
      !Array.isArray(policy.powerShellExecutables) || !policy.powerShellExecutables.length ||
      !Array.isArray(policy.generatedDirectories) || !object(policy.android) ||
      policy.android.productionPackage !== 'com.smartfin' || !Array.isArray(policy.android.syntheticPackages) ||
      !Array.isArray(policy.auditedFixtureGenerators)) fail('POLICY', 'Invalid guard policy');
  for (const dir of policy.generatedDirectories) {
    if (typeof dir !== 'string' || !/^[a-z0-9/-]+$/i.test(dir) || dir.includes('..') || dir.startsWith('/'))
      fail('POLICY', 'Invalid generated directory');
  }
  for (const pkg of policy.android.syntheticPackages) {
    if (!object(pkg) || !/^com\.smartfin\.[a-z0-9.]+$/.test(pkg.id) || !Array.isArray(pkg.databases))
      fail('POLICY', 'Invalid synthetic package');
  }
  for (const script of policy.auditedFixtureGenerators) {
    if (!object(script) || typeof script.path !== 'string' || script.path.includes('..') ||
        !script.path.startsWith('scripts/') || !/^[a-f0-9]{64}$/.test(script.sha256) ||
        !Array.isArray(script.arguments) || script.arguments.length) fail('POLICY', 'Invalid script identity');
  }
  return policy;
}

function parsePowerShell(command, policy = loadPolicy()) {
  const engine = policy.powerShellExecutables.find(candidate => fs.existsSync(candidate));
  if (!engine) fail('PARSE', 'Installed PowerShell parser is unavailable');
  const result = spawnSync(engine, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
    path.join(__dirname, 'parse-powershell.ps1')], {
    input: JSON.stringify({ command }), encoding: 'utf8', timeout: policy.parserTimeoutMs,
    maxBuffer: 2 * 1024 * 1024, windowsHide: true, shell: false,
  });
  if (result.error || result.status !== 0) fail('PARSE', 'PowerShell parser failed or timed out');
  const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
  if (!object(parsed) || parsed.error || !Array.isArray(parsed.commands) || !Array.isArray(parsed.redirects))
    fail('PARSE', 'PowerShell syntax is unsupported or invalid');
  return parsed;
}

// Supported CMD subset: literal argv, double quotes, &, &&, || and pipes.
// Expansion/escapes/grouping are denied instead of attempting CMD emulation.
function parseCmd(command) {
  if (/[\^%!`()\r\n]/.test(command)) fail('CMD', 'CMD expansion, escaping or grouping is unsupported');
  const commands = [], redirects = [];
  let args = [], word = '', quoted = false, active = false;
  const flush = () => { if (active) args.push(word); word = ''; active = false; };
  const finish = () => { flush(); if (args.length) commands.push({ name: args[0], args: args.slice(1) }); args = []; };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === '"') { quoted = !quoted; active = true; continue; }
    if (!quoted && (ch === '&' || ch === '|')) {
      finish(); if (command[i + 1] === ch) i++; continue;
    }
    if (!quoted && /[<>]/.test(ch)) fail('CMD', 'CMD redirection is unsupported; use a literal PowerShell destination');
    if (!quoted && /\s/.test(ch)) { flush(); continue; }
    active = true; word += ch;
  }
  if (quoted) fail('CMD', 'Unterminated CMD quote');
  finish();
  return { commands, redirects, opaque: false };
}

function resolveTarget(raw, cwd) {
  if (typeof raw !== 'string' || !raw || /[\x00-\x1f$%!*?\[\]`~]/.test(raw) ||
      raw.startsWith('\\\\') || raw.startsWith('//') || /(^|[\\/])[^\\/]*[. ]([\\/]|$)/.test(raw.replace(/^[.]{1,2}(?=[\\/]|$)/, '')))
    fail('PATH', 'Destination is ambiguous or unsupported');
  // Deny device paths, alternate streams and drive-relative paths.
  if (raw.includes(':') && !/^[a-z]:[\\/][^:]*$/i.test(raw)) fail('PATH', 'Non-filesystem destination is unsupported');
  const resolved = path.resolve(cwd, raw);
  if (!beneath(slash(resolved), slash(ROOT))) fail('PATH', 'Destination is outside SmartFin');
  return resolved;
}

function sensitive(relative) {
  const rel = slash(relative), name = rel.split('/').at(-1);
  return rel === '' || ['.git', '.codex', '.agents'].some(dir => beneath(rel, dir)) ||
    name === 'agents.md' || /^\.env(?:\.|$)/.test(name) || /\.(keystore|jks|p12|pfx|pem|key)$/.test(name) ||
    /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/.test(name) ||
    /^smartfin-(?:generation-|manifest|deletion-admission|backup|[a-f0-9-]{36}--)/.test(name) ||
    /^(?:movimientos-\d{4}|cuentas|categorias|subcategorias|tarjetas-credito|compras-cuotas|personas|gastos-compartidos|participaciones|reembolsos|abonos-compartidos|devoluciones-anticipos)\.csv$/.test(name) ||
    ['smartfin-local-snapshots', 'smartfin-backup-jobs'].some(dir => rel.split('/').includes(dir));
}
function financialSource(relative) {
  const rel = slash(relative);
  return beneath(rel, 'src/database') || beneath(rel, 'src/modules/security') ||
    /(?:sqlitefinancialdatarepository|smartfin(?:security|localSnapshot|backupPublisher|financialDeletion))\./i.test(rel);
}

function inspectPath(target, scan) {
  // Walk every existing ancestor: realpath alone could hide a junction escape.
  let current = target;
  for (;;) {
    try {
      const info = fs.lstatSync(current);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1)) return { linked: true };
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (scan && fs.existsSync(target) && fs.lstatSync(target).isDirectory()) {
    const stack = [target]; let count = 0;
    while (stack.length) {
      for (const entry of fs.readdirSync(stack.pop(), { withFileTypes: true })) {
        if (++count > 10000) fail('PATH', 'Cleanup tree exceeds the bounded inspection limit');
        if (entry.isSymbolicLink() || sensitive(entry.name)) return { protectedDescendant: true };
        if (entry.isDirectory()) stack.push(path.join(entry.parentPath, entry.name));
      }
    }
  }
  return { linked: false, protectedDescendant: false };
}

function verifyScript(script) {
  const file = resolveTarget(script.path, ROOT);
  if (inspectPath(file, false).linked) return false;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === script.sha256;
}

function makeContext(event, options, policy) {
  const cwd = event.tool_input.workdir ?? event.tool_input.cwd ?? event.cwd;
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) fail('INPUT', 'An absolute working directory is required');
  const deadline = Date.now() + 4000;
  const parsePS = options.parse ?? (source => {
    const remaining = deadline - Date.now();
    if (remaining < 100) fail('TIMEOUT', 'Guard analysis budget exhausted');
    return parsePowerShell(source, { ...policy, parserTimeoutMs: Math.min(policy.parserTimeoutMs, remaining) });
  });
  return {
    cwd, policy, deadline, parse: parsePS, parsePS,
    inspect: options.inspectPath ?? inspectPath, verify: options.verifyScript ?? verifyScript,
    uncertainCwd: false, depth: 0,
  };
}

function protectTarget(raw, ctx, mode = 'write') {
  if (ctx.uncertainCwd) fail('PATH', 'Working directory changed within this command');
  const target = resolveTarget(raw, ctx.cwd);
  const relative = path.relative(ROOT, target);
  const state = ctx.inspect(target, mode === 'delete');
  if (!object(state) || state.linked || state.protectedDescendant) fail('PATH', 'Linked or protected destination');
  if (sensitive(relative)) fail('FILE', 'Secret, database or guard configuration is protected');
  if (mode !== 'patch' && financialSource(relative)) fail('FILE', 'Use a reviewable patch for sensitive source files');
  if (mode === 'delete' && !ctx.policy.generatedDirectories.some(dir => beneath(slash(relative), dir)))
    fail('DELETE', 'Deletion is limited to explicitly registered generated directories');
  return target;
}

function git(args, ctx) {
  if (args.some(arg => arg === null)) fail('GIT', 'Dynamic Git arguments are unsupported');
  let index = 0;
  const gitContext = { ...ctx };
  while (index < args.length && args[index].startsWith('-')) {
    if (args[index] === '-C') {
      if (!args[index + 1] || /[$%!*?`]/.test(args[index + 1])) fail('GIT', 'Missing or dynamic Git directory');
      gitContext.cwd = path.resolve(gitContext.cwd, args[index + 1]); index += 2;
    }
    else if (['--no-optional-locks', '--no-pager', '--literal-pathspecs'].includes(args[index])) index++;
    else if (['--version', '--help'].includes(args[index])) return;
    else fail('GIT', 'Git configuration overrides or unsupported global options');
  }
  const sub = args[index++], rest = args.slice(index);
  const reads = ['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'grep', 'blame',
    'describe', 'version', 'help', 'check-ignore', 'check-attr', 'cat-file', 'for-each-ref', 'merge-base', 'rev-list', 'shortlog'];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--output') protectTarget(rest[++i], gitContext);
    else if (rest[i].startsWith('--output=')) protectTarget(rest[i].slice(9), gitContext);
  }
  if (reads.includes(sub) || !sub) return;
  if (sub === 'clean') {
    let dry = false;
    for (let i = 0; i < rest.length && rest[i] !== '--'; i++) {
      if (rest[i] === '-e' || rest[i] === '--exclude') { i++; continue; }
      if (rest[i] === '--dry-run' || /^-[dfnxq]*n[dfnxq]*$/.test(rest[i])) dry = true;
      if (rest[i] === '--interactive' || /^-[a-z]*i/.test(rest[i])) fail('GIT', 'Interactive clean is unsupported');
    }
    if (!dry) fail('GIT', 'git clean can discard untracked or ignored work');
    return;
  }
  if (['reset', 'restore', 'rebase', 'reflog', 'gc', 'prune', 'filter-branch', 'update-ref'].includes(sub))
    fail('GIT', 'Git operation may discard local work or recovery history');
  if (sub === 'checkout' || sub === 'switch') {
    if (rest.some(arg => ['--', '-f', '--force', '--discard-changes', '-B', '-C', '-m', '--merge', '--orphan'].includes(arg)))
      fail('GIT', 'Forced or path-based checkout can discard work');
    // Legacy checkout path syntax is ambiguous; switch has explicit branch semantics.
    if (sub === 'checkout') fail('GIT', 'Use git switch for a non-forced branch change');
    return;
  }
  if (sub === 'stash' && !rest.some(arg => ['drop', 'clear'].includes(arg))) return;
  if (sub === 'branch' && !rest.some(arg => /^-(?:.*[dDfFM]|-delete|-force)/.test(arg))) return;
  if (sub === 'config' && rest.some(arg => ['--get', '--get-all', '--get-regexp', '--list', '-l'].includes(arg))) return;
  if (['add', 'commit', 'fetch', 'merge'].includes(sub) && !rest.includes('--abort')) return;
  fail('GIT', 'Unrecognized or destructive Git operation requires separate review');
}

// A small SQL lexer is used only to validate explicitly READONLY CLI requests.
function sqlStatements(sql) {
  // Comments must be recognized AFTER quotes: SELECT '--'; ATTACH ... must
  // never hide the ATTACH behind a regex which mistakes a literal for a comment.
  let tokens = '';
  for (let i = 0; i < sql.length;) {
    if (sql.slice(i, i + 2) === '--') {
      while (i < sql.length && !/[\r\n]/.test(sql[i])) i++;
      tokens += ' '; continue;
    }
    if (sql.slice(i, i + 2) === '/*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) fail('SQL', 'Unterminated SQL comment');
      i = end + 2; tokens += ' '; continue;
    }
    if (['\'', '"', '`', '['].includes(sql[i])) {
      const close = sql[i] === '[' ? ']' : sql[i];
      let closed = false; i++;
      while (i < sql.length) {
        if (sql[i++] !== close) continue;
        if (close !== ']' && sql[i] === close) { i++; continue; }
        closed = true; break;
      }
      if (!closed) fail('SQL', 'Unterminated SQL quote');
      tokens += ' literal '; continue;
    }
    tokens += sql[i++];
  }
  if (/\b(attach|detach|load_extension|writefile|readfile|eval)\b|\bvacuum\s+into\b|(^|[\r\n])\s*\./i.test(tokens))
    fail('SQL', 'SQLite file access, extensions and dot commands are unsupported');
  return tokens.split(';').map(s => s.trim()).filter(Boolean);
}

function sqlite(args, synthetic = false) {
  if (args.some(arg => arg === null)) fail('SQL', 'Dynamic SQLite invocation');
  let index = 0, readonly = false;
  while (args[index]?.startsWith('-')) {
    const option = args[index++];
    if (option === '-readonly') readonly = true;
    else if (!['-batch', '-header', '-noheader', '-csv', '-json', '-list', '-line'].includes(option))
      fail('SQL', 'Unsupported SQLite option');
  }
  const database = args[index++], sql = args[index++];
  if (!database || !sql || index !== args.length) fail('SQL', 'Interactive or ambiguous SQLite invocation');
  const statements = sqlStatements(sql);
  if (database === ':memory:' || synthetic) return;
  if (!readonly) fail('SQL', 'Real or unknown databases require explicit read-only mode');
  for (const statement of statements) {
    if (/^(SELECT|EXPLAIN\s+(?:QUERY\s+PLAN\s+)?SELECT)\b/i.test(statement)) continue;
    if (/^PRAGMA\s+(?:integrity_check|quick_check|foreign_key_check|table_info\([^)]*\)|index_list\([^)]*\))$/i.test(statement)) continue;
    fail('SQL', 'Only recognized read-only SQL is allowed on real or unknown databases');
  }
}

function android(args, ctx) {
  if (args.some(arg => arg === null)) fail('ANDROID', 'Dynamic Android command');
  let index = 0, serial;
  if (args[index] === '-s') { serial = args[index + 1]; index += 2; }
  const op = args[index++], rest = args.slice(index);
  const approved = id => ctx.policy.android.syntheticPackages.find(pkg => pkg.id === id);
  const selected = () => { if (!serial || !/^[a-z0-9_.:-]+$/i.test(serial)) fail('ANDROID', 'Explicit device serial required for mutation'); };
  if (op === 'uninstall') {
    selected(); if (rest.length !== 1 || !approved(rest[0])) fail('ANDROID', 'Only registered isolated packages may be uninstalled');
    return;
  }
  if (op === 'push') {
    const destination = rest.at(-1) ?? '';
    if (/\/data\/|com\.smartfin(?:\/|$)/i.test(destination)) fail('ANDROID', 'Private application storage is protected');
    return;
  }
  if (op !== 'shell') {
    if (!['devices', 'version', 'get-state', 'get-serialno', 'wait-for-device', 'logcat', 'pull', 'forward', 'reverse', 'install'].includes(op))
      fail('ANDROID', 'Unrecognized Android operation requires separate review');
    // Pull writes locally; protect both an explicit destination and its directory.
    if (op === 'pull') {
      if (rest.length !== 2) fail('ANDROID', 'Pull requires an explicit local destination');
      protectTarget(rest[1], ctx);
    }
    return;
  }
  // Android shell is not PowerShell. Reject shell syntax rather than misparse it.
  const remote = rest.length === 1 ? rest[0].trim().split(/\s+/) : rest;
  if (remote.some(arg => /[;&|$`<>\\\r\n]/.test(arg))) fail('ANDROID', 'Android shell expansion or chaining is unsupported');
  if (remote[0] === 'pm' && remote[1] === 'clear') {
    selected(); if (remote.length !== 3 || !approved(remote[2])) fail('ANDROID', 'Financial or unknown Android package is protected');
    return;
  }
  if (remote[0] === 'sqlite3') {
    selected();
    const database = remote[1];
    const match = /^\/data\/(?:data|user\/0)\/([^/]+)\/databases\/([^/]+)$/.exec(database ?? '');
    const pkg = match && approved(match[1]);
    if (!pkg || !pkg.databases.includes(match[2])) fail('ANDROID', 'Only registered synthetic Android databases may be mutated');
    sqlite(remote.slice(1), true); return;
  }
  if (['getprop', 'dumpsys', 'wm', 'input', 'logcat'].includes(remote[0]) ||
      (remote[0] === 'pm' && ['list', 'path'].includes(remote[1])) ||
      (remote[0] === 'am' && ['start', 'force-stop'].includes(remote[1]))) return;
  fail('ANDROID', 'Unrecognized Android shell operation requires separate review');
}

function fileCommand(name, args, ctx) {
  const remove = ['remove-item', 'ri', 'rm', 'rmdir', 'rd', 'del', 'erase', 'clear-content'];
  const writers = ['set-content', 'add-content', 'out-file', 'copy-item', 'cp', 'copy', 'move-item', 'mv', 'move', 'rename-item', 'ren', 'new-item'];
  if (![...remove, ...writers].includes(name)) return false;
  if (args.some(arg => arg === null)) fail('PATH', 'Dynamic filesystem destination');
  const valueOptions = ['-value', '-encoding', '-filter', '-include', '-exclude', '-itemtype', '-erroraction', '-ea', '-stream'];
  const switches = ['-recurse', '-r', '-force', '-fo', '-f', '-rf', '-fr', '-confirm', '-whatif', '-verbose', '-v',
    '-n', '-nonewline', '-append', '-noclobber', '-passThru', '/s', '/q', '/f', '/a'];
  const targets = [], named = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i], lower = arg.toLowerCase();
    if (['-path', '-literalpath', '-destination', '-newname', '-filepath', '-file'].includes(lower)) {
      if (!args[i + 1]) fail('PATH', 'Missing destination');
      named[lower] = args[++i]; targets.push(named[lower]);
    } else if (valueOptions.includes(lower)) {
      // Streams could modify a protected alternate stream; refuse that feature.
      if (lower === '-stream') fail('PATH', 'Alternate streams are unsupported');
      i++;
    } else if (switches.some(value => value.toLowerCase() === lower)) continue;
    else if (arg.startsWith('-') || /^\/[a-z]$/i.test(arg)) fail('PATH', 'Unsupported filesystem option');
    else targets.push(arg);
  }
  if (!targets.length) fail('PATH', 'Filesystem destination is unresolved (possibly pipeline input)');
  if (remove.includes(name)) {
    for (const target of targets) protectTarget(target, ctx, 'delete');
  } else if (['copy-item', 'cp', 'copy', 'move-item', 'mv', 'move', 'rename-item', 'ren'].includes(name)) {
    // Moves change their source too; destinations are always checked, even without -Force.
    const source = resolveTarget(targets[0], ctx.cwd);
    const moving = !['copy-item', 'cp', 'copy'].includes(name);
    if (moving) {
      protectTarget(targets[0], ctx);
      if (fs.existsSync(source) && fs.lstatSync(source).isDirectory()) fail('PATH', 'Directory moves require separate review');
    }
    if (targets.length < 2) fail('PATH', 'Both source and destination are required');
    const destination = protectTarget(named['-destination'] ?? named['-newname'] ?? targets.at(-1), ctx);
    // Copy/move to a directory uses the source basename as the actual destination.
    if (fs.existsSync(destination) && fs.lstatSync(destination).isDirectory()) {
      protectTarget(path.join(destination, path.basename(source)), ctx);
      // Recursively merging directory contents cannot be verified from argv alone.
      if (fs.existsSync(source) && fs.lstatSync(source).isDirectory()) fail('PATH', 'Directory merges require separate review');
    }
  } else {
    protectTarget(named['-path'] ?? named['-literalpath'] ?? named['-filepath'] ?? targets[0], ctx);
  }
  return true;
}

function inspectCommand(command, ctx) {
  if (Date.now() >= ctx.deadline) fail('TIMEOUT', 'Guard analysis budget exhausted');
  if (ctx.depth > 6) fail('PARSE', 'Nested process limit exceeded');
  const parsed = ctx.parse(command);
  if (parsed.opaque) fail('OPAQUE', 'Inline member invocation or dot-sourcing requires separate review');
  // A location change anywhere makes relative redirection order ambiguous.
  if (parsed.commands.some(item => typeof item.name === 'string' &&
      ['set-location', 'cd', 'chdir', 'push-location', 'pop-location', 'pushd', 'popd'].includes(executable(item.name))))
    ctx.uncertainCwd = true;
  for (const destination of parsed.redirects) {
    if (object(destination) && destination.discard === true) continue;
    protectTarget(destination, ctx);
  }
  for (const item of parsed.commands) {
    if (typeof item.name !== 'string' || !item.name || !Array.isArray(item.args)) fail('PARSE', 'Dynamic executable is unsupported');
    const name = executable(item.name), args = item.args;
    if (name === 'git') git(args, ctx);
    else if (name === 'sqlite3' || name === 'sqlite') sqlite(args);
    else if (name === 'adb') android(args, ctx);
    else if (['powershell', 'pwsh', 'cmd'].includes(name)) {
      if (args.some(arg => arg === null)) fail('PARSE', 'Dynamic nested shell');
      const cmdIndex = args.findIndex(arg => /^(?:-command|-c|\/c|\/k)$/i.test(arg));
      if (cmdIndex >= 0) {
        const nested = args.slice(cmdIndex + 1).join(' ');
        const before = args.slice(0, cmdIndex).map(arg => arg.toLowerCase());
        if (!nested || before.some(arg => !['-nologo', '-noprofile', '-noninteractive', '/d', '/s'].includes(arg)))
          fail('PARSE', 'Unsupported nested-shell option');
        const nestedContext = { ...ctx, depth: ctx.depth + 1 };
        nestedContext.parse = name === 'cmd' ? parseCmd : ctx.parsePS;
        inspectCommand(nested, nestedContext);
      } else if (args.some(arg => /^-(?:encodedcommand|enc|e|encodedarguments)$/i.test(arg)) || !args.some(arg => /^-file$/i.test(arg))) {
        fail('OPAQUE', 'Interactive or encoded nested shells are unsupported');
      }
      // Script files are execution boundaries; their internal effects are not inspected.
    } else if (['node', 'python', 'python3', 'py', 'ruby', 'perl', 'bash', 'sh', 'wsl'].includes(name)) {
      if (['bash', 'sh', 'wsl'].includes(name)) fail('OPAQUE', 'POSIX and WSL interpreters are outside the supported parser');
      if (!args.length || args.some(arg => arg === null || /^-[epc]/i.test(arg) ||
          /^--(?:eval|print|require|import|loader|experimental-loader|input-type)(?:=|$)/i.test(arg) ||
          (name === 'node' && /^-r/.test(arg)) || arg === '-'))
        fail('OPAQUE', 'Inline interpreter code requires separate review');
      if (name === 'node') {
        const generator = ctx.policy.auditedFixtureGenerators.find(script => args.some(arg =>
          typeof arg === 'string' && slash(path.resolve(ctx.cwd, arg)) === slash(path.join(ROOT, script.path))));
        if (generator && (args.length !== 1 || !ctx.verify(generator)))
          fail('FIXTURE', 'Fixture generator changed or received unsupported overrides');
      }
    } else if (['invoke-expression', 'iex', 'invoke-command', 'start-process', 'saps', 'start', 'set-alias', 'new-alias', 'call', 'if', 'for',
      'sal', 'nal', 'format-volume', 'format', 'diskpart', 'clear-disk', 'remove-partition', 'stop-process'].includes(name)) {
      fail('OPAQUE', 'Indirect execution or destructive system operation requires separate review');
    } else if (['set-location', 'cd', 'chdir', 'push-location', 'pop-location', 'pushd', 'popd'].includes(name)) {
      ctx.uncertainCwd = true;
    } else fileCommand(name, args, ctx);
  }
}

function patch(command, ctx) {
  if (!command.startsWith('*** Begin Patch') || !command.trimEnd().endsWith('*** End Patch'))
    fail('PATCH', 'Unsupported patch format');
  const files = [...command.matchAll(/^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/gm)];
  if (!files.length) fail('PATCH', 'Patch has no recognized destinations');
  let financialPatch = false;
  for (const [, kind, file] of files) {
    const target = protectTarget(file.trim(), ctx, 'patch');
    if (financialSource(path.relative(ROOT, target))) {
      financialPatch = true;
      if (kind === 'Delete File') fail('PATCH', 'Sensitive source deletion');
    }
  }
  if (financialPatch && /^-/m.test(command) && !/^\+\s*\S/m.test(command))
    fail('PATCH', 'Sensitive source removal without a replacement requires review');
  if (financialPatch && /^\+.*\b(?:DROP\s+(?:TABLE|TRIGGER)|PRAGMA\s+(?:foreign_keys|writable_schema)\s*=\s*(?:OFF|0|ON|1))/im.test(command))
    fail('PATCH', 'Patch introduces a recognized destructive database control');
}

function evaluate(event, options = {}) {
  try {
    if (!object(event) || event.hook_event_name !== 'PreToolUse' || typeof event.tool_name !== 'string' ||
        typeof event.cwd !== 'string' || !object(event.tool_input)) fail('INPUT', 'Malformed PreToolUse event');
    const policy = loadPolicy();
    const ctx = makeContext(event, options, policy);
    if (!['Bash', 'apply_patch', 'exec_command'].includes(event.tool_name)) return ALLOW;
    const command = event.tool_input.command ?? (event.tool_name === 'exec_command' ? event.tool_input.cmd : undefined);
    if (typeof command !== 'string' || !command.trim() || command.includes('\0') || command.length > policy.maxCommandLength)
      fail('INPUT', 'Missing, empty or oversized command');
    if (event.tool_name === 'apply_patch') patch(command, ctx);
    else {
      if (event.tool_input.shell && /cmd(?:\.exe)?$/i.test(event.tool_input.shell)) ctx.parse = parseCmd;
      else if (event.tool_input.shell && !/(?:pwsh|powershell)(?:\.exe)?$/i.test(event.tool_input.shell))
        fail('PARSE', 'This guard supports PowerShell and CMD execution only');
      inspectCommand(command, ctx);
    }
    return ALLOW;
  } catch (error) {
    return { decision: 'deny', reason: error instanceof Error && /^DG-[A-Z]+:/.test(error.message)
      ? error.message : 'DG-ERROR: Guard could not verify this operation' };
  }
}

function denial(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

if (require.main === module) {
  // Bound input before JSON parsing. No transcript reads or persistent logs.
  let input = '', oversized = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (input.length + chunk.length > 1024 * 1024) oversized = true;
    else if (!oversized) input += chunk;
  });
  process.stdin.on('error', () => { process.stdout.write(JSON.stringify(denial('DG-INPUT: Input stream failed'))); });
  process.stdin.on('end', () => {
    let result;
    try { result = oversized ? { decision: 'deny', reason: 'DG-INPUT: Event too large' } : evaluate(JSON.parse(input)); }
    catch { result = { decision: 'deny', reason: 'DG-INPUT: Invalid JSON event' }; }
    if (result.decision === 'deny') process.stdout.write(JSON.stringify(denial(result.reason)));
  });
}

module.exports = { evaluate, parsePowerShell, loadPolicy };
