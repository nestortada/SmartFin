'use strict';
// SmartFin reviewer reminder (Claude Code SessionStart + Stop hooks).
//   baseline: on SessionStart, records the files already changed in the working tree, so the user's pending work
//             never triggers a reminder by itself.
//   stop:     on Stop, finds files changed since then and, once per content version, asks Claude before finishing
//             (decision "block" with the reason) to:
//               - run financial-reviewer, android-native-reviewer and/or security-privacy-reviewer for changes in
//                 their areas (REVIEWERS, by path; the smartfin-development workflow replicates these rules);
//               - run test-reviewer when an existing tracked test under __tests__/ was modified or deleted
//                 (new test files alone do not trigger it);
//               - run `npm run skills:sync` when .claude/skills or .agents/skills changed and the copies differ;
//               - tell the user that the owner reviews the diff of changed control-plane files (PROTECTED, the
//                 paths the PreToolUse guard protects) before committing them;
//               - run the checks in CHECKS (typecheck, Jest, hook tests) for code changed in this session after
//                 the last time that check ran.
//   verified: on PostToolUse (Bash/PowerShell), when the command runs one of CHECKS, records the content of the
//             changed files at that moment. It records that the check ran, not whether it passed, and a command
//             sent to the background counts when it starts: Claude still reports the real result.
// Never blocks twice in a row (stop_hook_active), never runs Git commands that write, and fails open: any error
// ends silently, so the hook can never trap a session.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

// Agents' control plane that needs an independent security review: agent memory and definitions, rules, hooks,
// settings and workflows (their tests included). The smartfin-development workflow replicates it.
const CONTROL_REVIEW = file => /^\.claude\/(?:agent-memory(?:-local)?|agents|rules|hooks|workflows)\//.test(file) ||
  /^\.claude\/settings(?:\.local)?\.json$/.test(file) || file === '.mcp.json';
const REVIEWERS = [
  {
    name: 'financial-reviewer',
    why: 'casos de uso, repositorios, SQL, migraciones, tipos o utilidades monetarias',
    test: file => /^src\/database\//.test(file) || /^src\/modules\/[^/]+\/(?:useCases|repositories|database|types)\//.test(file) ||
      file === 'src/shared/types/finance.ts' || /^src\/shared\/utils\/(?:exactCopCents|copAmountInput|transactionDate)\.ts$/.test(file),
  },
  {
    name: 'android-native-reviewer',
    why: 'código Android, servicios de plataforma, coordinación SQLite o parches del driver',
    test: file => /^android\//.test(file) || /^src\/native\//.test(file) || /^src\/services\//.test(file) ||
      /^src\/modules\/[^/]+\/services\//.test(file) || file === 'src/database/databaseCoordination.ts' ||
      /^scripts\/(?:patchReactNativeSqliteStorage|sqlite[\w-]*Patch)\.js$/.test(file),
  },
  {
    name: 'security-privacy-reviewer',
    why: 'respaldo, restauración, exportación, autenticación, permisos, servicios externos o configuración de agentes (memoria, agentes, reglas, hooks, settings, workflows)',
    test: file => /^src\/modules\/security\//.test(file) || /AndroidManifest\.xml$/.test(file) || /^src\/services\//.test(file) ||
      (/^(?:src|android)\//.test(file) && /backup|snapshot|restor|security|csv|drive|gemini|publication|deletion/i.test(path.basename(file))) ||
      CONTROL_REVIEW(file),
  },
];
// Tests and documentation never need a path reviewer by themselves, except in the control plane: agent memory,
// agent definitions and rules are Markdown, and the hook tests are the guard's contract.
const IGNORED = file => !CONTROL_REVIEW(file) && (/(?:^|\/)__tests__\//.test(file) || /\.(?:md|test\.tsx?)$/.test(file));
// Paths the PreToolUse guard protects (controlPath in dangerous-command-guard.cjs; a test compares both): any change
// reminds that the owner reviews the diff before committing. It is a process control, not an authorization.
const PROTECTED = file => /^\.claude\/(?:agent-memory(?:-local)?|agents|rules|workflows|hooks|skills|commands)\//.test(file) ||
  /^\.claude\/settings(?:\.local)?\.json$/.test(file) || /^\.(?:codex|agents)\//.test(file) ||
  ['AGENTS.md', 'CLAUDE.md', '.mcp.json'].includes(file);
// Changing or deleting an existing product test can weaken what it proves; adding a new one cannot.
const TEST_REVIEWER = {
  name: 'test-reviewer',
  why: 'pruebas existentes modificadas o eliminadas',
  test: (file, status) => /^__tests__\//.test(file) && status !== '??' && !status.includes('A'),
};
// Verification Claude runs itself before finishing. `files` selects the session changes each check covers;
// `command` recognises a Bash/PowerShell command that runs it (in any working directory and with any pipes).
const CHECKS = [
  {
    name: 'typecheck',
    how: '`npm run typecheck`',
    files: file => /^(?:src|__tests__)\/.*\.tsx?$/.test(file),
    command: text => /\bnpm\s+run\s+typecheck\b|\btsc\b[^\n]*--noEmit\b/.test(text),
  },
  {
    name: 'jest',
    how: 'Jest de las pruebas afectadas (`npx jest <rutas>` o `npm test -- --runInBand`)',
    files: file => /^(?:src|__tests__)\/.*\.(?:tsx?|jsx?|cjs)$/.test(file) || /^scripts\/[^/]+\.js$/.test(file),
    command: text => /\b(?:npx\s+|node_modules[\\/]\.bin[\\/])jest\b|\bnpm\s+(?:run\s+)?test\b|\bnpm\s+t\b/.test(text),
  },
  {
    name: 'hooks',
    how: '`node --test .claude/hooks/__tests__/<archivo>.test.cjs`',
    files: file => /^\.claude\/(?:hooks|workflows)\/.*\.c?js$/.test(file),
    command: text => /\bnode\s+--test\b[^\n]*\.claude[\\/]hooks/.test(text),
  },
];
const SKILL_COPIES = ['.claude/skills', '.agents/skills'];
const touchesSkills = file => SKILL_COPIES.some(dir => file.startsWith(dir + '/'));

const stateDir = () => process.env.SMARTFIN_REVIEWER_STATE_DIR || path.join(os.tmpdir(), 'smartfin-reviewer-reminder');
const stateFile = session => path.join(stateDir(), String(session).replace(/[^\w.-]/g, '_') + '.json');
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000});

// Map of changed file -> {digest, status}, including untracked files.
function changedFiles(root) {
  const out = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const files = new Map();
  const entries = out.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const file = entry.slice(3).replaceAll('\\', '/');
    if (status[0] === 'R' || status[0] === 'C') i++; // the next entry is the original name
    let digest = 'deleted';
    try {
      digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    } catch {}
    files.set(file, {digest, status});
  }
  return files;
}

// Relative path -> content digest for every file under dir (empty map if dir is missing).
function treeDigests(dir) {
  const result = new Map();
  const walk = rel => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(dir, rel), {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) result.set(child, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, child))).digest('hex'));
    }
  };
  walk('');
  return result;
}
function skillCopiesDiffer(root) {
  const [a, b] = SKILL_COPIES.map(dir => treeDigests(path.join(root, dir)));
  if (a.size !== b.size) return true;
  for (const [file, digest] of a) if (b.get(file) !== digest) return true;
  return false;
}

function readState(session) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(session), 'utf8'));
  } catch {
    return null;
  }
}
function writeState(session, state) {
  fs.mkdirSync(stateDir(), {recursive: true});
  // Write and rename, so a parallel PostToolUse never reads a half-written file.
  const target = stateFile(session);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state));
  fs.renameSync(temporary, target);
}
const digests = files => Object.fromEntries([...files].map(([file, info]) => [file, info.digest]));
const shown = files => files.slice(0, 6).join(', ') + (files.length > 6 ? ` y ${files.length - 6} más` : '');

function run(mode, event) {
  const session = event.session_id;
  const cwd = typeof event.cwd === 'string' ? event.cwd : process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!session) return null;
  if (mode === 'verified') {
    // Cheap test first: most commands are not checks and must not pay for git status.
    const command = typeof event.tool_input?.command === 'string' ? event.tool_input.command : '';
    const ran = CHECKS.filter(check => check.command(command));
    if (!ran.length) return null;
    const root = git(cwd, ['rev-parse', '--show-toplevel']).trim();
    const known = readState(session);
    if (!known) return null; // Hook loaded mid-session: Stop adopts the tree first.
    const snapshot = digests(changedFiles(root));
    known.verified = known.verified || {};
    for (const check of ran) known.verified[check.name] = snapshot;
    writeState(session, known);
    return null;
  }
  const root = git(cwd, ['rev-parse', '--show-toplevel']).trim();
  const known = readState(session);
  if (mode === 'baseline') {
    // A resumed or compacted session keeps its state; only a new one records the baseline.
    if (!known) {
      const seen = digests(changedFiles(root));
      writeState(session, {seen, base: {...seen}});
    }
    return null;
  }
  if (event.stop_hook_active) return null;
  const current = changedFiles(root);
  if (!known) {
    // Hook loaded mid-session: take the current tree as the baseline instead of guessing.
    const seen = digests(current);
    writeState(session, {seen, base: {...seen}});
    return null;
  }
  const fresh = [...current].filter(([file, info]) => known.seen[file] !== info.digest);
  for (const [file, info] of fresh) known.seen[file] = info.digest;
  const unverified = pendingChecks(known, current);
  writeState(session, known);

  const reviewed = fresh.map(([file]) => file).filter(file => !IGNORED(file));
  const needed = REVIEWERS.map(reviewer => ({...reviewer, files: reviewed.filter(reviewer.test)}));
  needed.push({...TEST_REVIEWER, files: fresh.filter(([file, info]) => TEST_REVIEWER.test(file, info.status)).map(([file]) => file)});
  const due = needed.filter(r => r.files.length);
  const skillFiles = fresh.map(([file]) => file).filter(touchesSkills);
  const skillsDrift = skillFiles.length > 0 && skillCopiesDiffer(root);
  const controlFiles = fresh.map(([file]) => file).filter(PROTECTED);
  if (!due.length && !skillsDrift && !unverified.length && !controlFiles.length) return null;

  const parts = ['Recordatorio de SmartFin (CLAUDE.md, Delegación).'];
  if (due.length) {
    parts.push('Cambiaron archivos que requieren revisión independiente:\n' +
      due.map(r => `- ${r.name} (${r.why}): ${shown(r.files)}`).join('\n') +
      '\nInvoca esos revisores sobre el diff antes de terminar. Si ya los invocaste para estos mismos cambios, o el cambio es ' +
      'puramente mecánico y no altera comportamiento, termina indicando al usuario cuál es el caso.');
  }
  if (controlFiles.length) {
    parts.push(`Cambiaron archivos del plano de control de los agentes (protegidos por el guard): ${shown(controlFiles)}. ` +
      'Indica al usuario que el propietario debe revisar el diff de esos archivos antes de confirmarlos (commit). ' +
      'Este recordatorio es un control de proceso: no autoriza ni valida el cambio.');
  }
  if (skillsDrift) {
    parts.push(`Las copias de skills difieren (${SKILL_COPIES.join(' y ')}) tras cambiar: ${shown(skillFiles)}. ` +
      'La fuente es .claude/skills: ejecuta `npm run skills:sync` y comprueba con `npm run skills:check` (la CI falla si difieren). ' +
      'Si editaste .agents/skills directamente, lleva el cambio a .claude/skills antes de sincronizar.');
  }
  if (unverified.length) {
    const production = unverified.some(check => check.files.some(file => /^src\//.test(file)));
    parts.push('Cambiaste código en esta sesión después de la última vez que se ejecutaron estas comprobaciones:\n' +
      unverified.map(check => `• ${check.name}, con ${check.how}: ${shown(check.files)}`).join('\n') +
      '\nEjecútalas y reporta su resultado real antes de terminar (el hook registra que se ejecutaron, no si pasaron). ' +
      'Si ya se verificaron por otra vía (por ejemplo, dentro de /smartfin-development), no pueden ejecutarse (por ejemplo, ' +
      'sin node_modules) o el cambio no puede afectarlas, termina indicando al usuario cuál es el caso.' +
      (production ? ' Si el cambio en src/ no es trivial, invoca también code-quality-reviewer con los archivos cambiados y su estado.' : ''));
  }
  return {decision: 'block', reason: parts.join('\n')};
}

// Checks whose covered files changed in this session (against `base`) after the check last ran. Each file
// version is reminded once per check, so finishing without running a check that cannot apply never loops.
function pendingChecks(known, current) {
  if (!known.base) return []; // State written by an earlier version of this hook.
  const session = [...current].filter(([file, info]) => known.base[file] !== info.digest);
  known.verified = known.verified || {};
  known.reminded = known.reminded || {};
  const pending = [];
  for (const check of CHECKS) {
    const verified = known.verified[check.name] || {};
    const reminded = known.reminded[check.name] = known.reminded[check.name] || {};
    const files = session.filter(([file, info]) => check.files(file) && verified[file] !== info.digest && reminded[file] !== info.digest);
    for (const [file, info] of files) reminded[file] = info.digest;
    if (files.length) pending.push({...check, files: files.map(([file]) => file)});
  }
  return pending;
}

if (require.main === module) {
  const mode = process.argv[2];
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { if (input.length < 1048576) input += chunk; });
  process.stdin.on('end', () => {
    try {
      const result = run(mode, JSON.parse(input));
      if (result) process.stdout.write(JSON.stringify(result));
    } catch {
      // Fail open: a reminder must never trap the session.
    }
  });
}
module.exports = {run, REVIEWERS, IGNORED, TEST_REVIEWER, CHECKS, CONTROL_REVIEW, PROTECTED};
