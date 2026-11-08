'use strict';
// SmartFin reviewer reminder (Claude Code SessionStart + Stop hooks).
//   baseline: on SessionStart, records the files already changed in the working tree, so the user's pending work
//             never triggers a reminder by itself.
//   stop:     on Stop, finds files changed since then in areas that need an independent reviewer and, once per
//             content version, asks Claude to run financial-reviewer, android-native-reviewer and/or
//             security-privacy-reviewer before finishing (decision "block" with the reason).
// Never blocks twice in a row (stop_hook_active), never runs Git commands that write, and fails open: any error
// ends silently, so the hook can never trap a session.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

const REVIEWERS = [
  {
    name: 'financial-reviewer',
    why: 'casos de uso, repositorios, SQL o migraciones',
    test: file => /^src\/database\//.test(file) || /^src\/modules\/[^/]+\/(?:useCases|repositories|database)\//.test(file),
  },
  {
    name: 'android-native-reviewer',
    why: 'código Android, servicios de plataforma o coordinación SQLite',
    test: file => /^android\//.test(file) || /^src\/native\//.test(file) || /^src\/services\//.test(file) ||
      /^src\/modules\/[^/]+\/services\//.test(file) || file === 'src/database/databaseCoordination.ts',
  },
  {
    name: 'security-privacy-reviewer',
    why: 'respaldo, restauración, exportación, autenticación, permisos o servicios externos',
    test: file => /^src\/modules\/security\//.test(file) || /AndroidManifest\.xml$/.test(file) || /^src\/services\//.test(file) ||
      (/^(?:src|android)\//.test(file) && /backup|snapshot|restor|security|csv|drive|gemini|publication|deletion/i.test(path.basename(file))),
  },
];
// Tests and documentation never need a reviewer by themselves.
const IGNORED = file => /(?:^|\/)__tests__\//.test(file) || /\.(?:md|test\.tsx?)$/.test(file);

const stateDir = () => process.env.SMARTFIN_REVIEWER_STATE_DIR || path.join(os.tmpdir(), 'smartfin-reviewer-reminder');
const stateFile = session => path.join(stateDir(), String(session).replace(/[^\w.-]/g, '_') + '.json');

function changedFiles(cwd) {
  const git = args => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000});
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const out = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const files = new Map();
  const entries = out.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const file = entry.slice(3).replaceAll('\\', '/');
    if (status[0] === 'R' || status[0] === 'C') i++; // the next entry is the original name
    if (IGNORED(file)) continue;
    let digest = 'deleted';
    try {
      digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    } catch {}
    files.set(file, digest);
  }
  return files;
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
  fs.writeFileSync(stateFile(session), JSON.stringify(state));
}

function run(mode, event) {
  const session = event.session_id;
  const cwd = typeof event.cwd === 'string' ? event.cwd : process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!session) return null;
  const known = readState(session);
  if (mode === 'baseline') {
    // A resumed or compacted session keeps its state; only a new one records the baseline.
    if (!known) writeState(session, {seen: Object.fromEntries(changedFiles(cwd))});
    return null;
  }
  if (event.stop_hook_active) return null;
  const current = changedFiles(cwd);
  if (!known) {
    // Hook loaded mid-session: take the current tree as the baseline instead of guessing.
    writeState(session, {seen: Object.fromEntries(current)});
    return null;
  }
  const fresh = [...current].filter(([file, digest]) => known.seen[file] !== digest).map(([file]) => file);
  for (const file of fresh) known.seen[file] = current.get(file);
  writeState(session, known);
  const needed = REVIEWERS.map(reviewer => ({...reviewer, files: fresh.filter(reviewer.test)})).filter(r => r.files.length);
  if (!needed.length) return null;
  const lines = needed.map(r => {
    const shown = r.files.slice(0, 6).join(', ') + (r.files.length > 6 ? ` y ${r.files.length - 6} más` : '');
    return `- ${r.name} (${r.why}): ${shown}`;
  });
  return {
    decision: 'block',
    reason: 'Recordatorio de SmartFin (CLAUDE.md, Delegación). Cambiaron archivos que requieren revisión independiente:\n' +
      lines.join('\n') +
      '\nInvoca esos revisores sobre el diff antes de terminar. Si ya los invocaste para estos mismos cambios, o el cambio es ' +
      'puramente mecánico y no altera comportamiento, termina indicando al usuario cuál es el caso.',
  };
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
module.exports = {run, REVIEWERS, IGNORED};
