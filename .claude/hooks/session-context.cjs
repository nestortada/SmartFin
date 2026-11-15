'use strict';
// SmartFin session context (Claude Code SessionStart hook).
// Adds a short note to the session context so Claude can verify its own work without asking first:
//   - branch, commits ahead of / behind the local main, and how many files already have changes;
//   - in a Git worktree without node_modules, how to make typecheck, lint and Jest runnable: a junction to the
//     main checkout's node_modules when both package-lock.json files are identical, `npm ci` otherwise;
//   - a warning when Node does not resolve America/Bogota (the CI calendar for Jest).
// Read-only: it runs Git commands that only read and never creates or changes files. Fails open: any error
// ends silently, and it prints nothing when there is nothing useful to say.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

const TIME_ZONE = 'America/Bogota';
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000}).trim();
const tryGit = (cwd, args) => {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
};
const digest = file => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
};

// Main checkout of a linked worktree: the parent of the shared .git directory. null outside a linked worktree.
function mainCheckout(root) {
  const gitDir = tryGit(root, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const common = tryGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!gitDir || !common || path.resolve(gitDir) === path.resolve(common)) return null;
  return path.basename(common) === '.git' ? path.dirname(path.resolve(common)) : null;
}

function dependencyNote(root) {
  if (fs.existsSync(path.join(root, 'node_modules'))) return null;
  const main = mainCheckout(root);
  const target = main && path.join(main, 'node_modules');
  if (target && fs.existsSync(target)) {
    const same = digest(path.join(root, 'package-lock.json')) !== null &&
      digest(path.join(root, 'package-lock.json')) === digest(path.join(main, 'package-lock.json'));
    if (same) {
      return [
        'Este worktree no tiene node_modules, así que typecheck, lint y Jest fallarán hasta resolverlo. El package-lock.json coincide con el del checkout principal: puedes crear un junction sin preguntar (PowerShell):',
        `New-Item -ItemType Junction -Path node_modules -Target "${target}"`,
        'Antes de `git worktree remove --force`, borra el junction (`(Get-Item node_modules).Delete()`): si no, se puede vaciar el node_modules del checkout principal.',
      ].join('\n');
    }
    return 'Este worktree no tiene node_modules y su package-lock.json difiere del checkout principal: no enlaces el node_modules ajeno. Ejecuta `npm ci` (instala el lockfile y aplica los parches de postinstall; no añade dependencias) antes de typecheck, lint o Jest.';
  }
  return 'No hay node_modules: ejecuta `npm ci` antes de typecheck, lint o Jest (instala el lockfile; no añade dependencias).';
}

function build(event) {
  const cwd = typeof event.cwd === 'string' ? event.cwd : process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  const lines = [];

  const branch = tryGit(root, ['branch', '--show-current']) || '(HEAD separado)';
  let position = '';
  if (branch !== 'main' && tryGit(root, ['rev-parse', '--verify', '--quiet', 'refs/heads/main'])) {
    const counts = tryGit(root, ['rev-list', '--left-right', '--count', 'refs/heads/main...HEAD']);
    const [behind, ahead] = (counts || '').split(/\s+/).map(Number);
    if (Number.isInteger(ahead) && Number.isInteger(behind)) position = `, ${ahead} commit(s) por delante y ${behind} por detrás de main local`;
  }
  const status = tryGit(root, ['status', '--porcelain=v1', '--untracked-files=normal']);
  const dirty = status ? status.split('\n').filter(Boolean).length : 0;
  const worktree = mainCheckout(root) ? ' (worktree)' : '';
  // Only a new session can attribute existing changes to the user; after resume, clear or compact they may be Claude's.
  const startup = event.source === undefined || event.source === 'startup';
  const changes = startup ? `${dirty} archivo(s) con cambios previos a la sesión (trabajo del usuario: no lo reviertas)` : `${dirty} archivo(s) con cambios sin confirmar`;
  lines.push(`Rama ${branch}${worktree}${position}; ${dirty ? changes : 'árbol limpio'}.`);

  const dependencies = dependencyNote(root);
  if (dependencies) lines.push(dependencies);

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone !== TIME_ZONE) {
    lines.push(`Node resuelve la zona ${zone}, no ${TIME_ZONE} como la CI: ejecuta Jest con la variable TZ=${TIME_ZONE} (en PowerShell, $env:TZ='${TIME_ZONE}'; en Git Bash, TZ=... delante del comando no llega a Node).`);
  }
  return 'Contexto de SmartFin al iniciar la sesión (hook SessionStart):\n' + lines.map(line => '- ' + line.replaceAll('\n', '\n  ')).join('\n');
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { if (input.length < 1048576) input += chunk; });
  process.stdin.on('end', () => {
    try {
      const additionalContext = build(JSON.parse(input));
      process.stdout.write(JSON.stringify({hookSpecificOutput: {hookEventName: 'SessionStart', additionalContext}}));
    } catch {
      // Fail open: missing context must never block a session.
    }
  });
}
module.exports = {build, mainCheckout, dependencyNote};
