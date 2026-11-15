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
//               - run `npm run skills:sync` when .claude/skills or .agents/skills changed and the copies differ.
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
    why: 'respaldo, restauración, exportación, autenticación, permisos o servicios externos',
    test: file => /^src\/modules\/security\//.test(file) || /AndroidManifest\.xml$/.test(file) || /^src\/services\//.test(file) ||
      (/^(?:src|android)\//.test(file) && /backup|snapshot|restor|security|csv|drive|gemini|publication|deletion/i.test(path.basename(file))),
  },
];
// Tests and documentation never need a path reviewer by themselves.
const IGNORED = file => /(?:^|\/)__tests__\//.test(file) || /\.(?:md|test\.tsx?)$/.test(file);
// Changing or deleting an existing product test can weaken what it proves; adding a new one cannot.
const TEST_REVIEWER = {
  name: 'test-reviewer',
  why: 'pruebas existentes modificadas o eliminadas',
  test: (file, status) => /^__tests__\//.test(file) && status !== '??' && !status.includes('A'),
};
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
  fs.writeFileSync(stateFile(session), JSON.stringify(state));
}
const digests = files => Object.fromEntries([...files].map(([file, info]) => [file, info.digest]));
const shown = files => files.slice(0, 6).join(', ') + (files.length > 6 ? ` y ${files.length - 6} más` : '');

function run(mode, event) {
  const session = event.session_id;
  const cwd = typeof event.cwd === 'string' ? event.cwd : process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!session) return null;
  const root = git(cwd, ['rev-parse', '--show-toplevel']).trim();
  const known = readState(session);
  if (mode === 'baseline') {
    // A resumed or compacted session keeps its state; only a new one records the baseline.
    if (!known) writeState(session, {seen: digests(changedFiles(root))});
    return null;
  }
  if (event.stop_hook_active) return null;
  const current = changedFiles(root);
  if (!known) {
    // Hook loaded mid-session: take the current tree as the baseline instead of guessing.
    writeState(session, {seen: digests(current)});
    return null;
  }
  const fresh = [...current].filter(([file, info]) => known.seen[file] !== info.digest);
  for (const [file, info] of fresh) known.seen[file] = info.digest;
  writeState(session, known);

  const reviewed = fresh.map(([file]) => file).filter(file => !IGNORED(file));
  const needed = REVIEWERS.map(reviewer => ({...reviewer, files: reviewed.filter(reviewer.test)}));
  needed.push({...TEST_REVIEWER, files: fresh.filter(([file, info]) => TEST_REVIEWER.test(file, info.status)).map(([file]) => file)});
  const due = needed.filter(r => r.files.length);
  const skillFiles = fresh.map(([file]) => file).filter(touchesSkills);
  const skillsDrift = skillFiles.length > 0 && skillCopiesDiffer(root);
  if (!due.length && !skillsDrift) return null;

  const parts = ['Recordatorio de SmartFin (CLAUDE.md, Delegación).'];
  if (due.length) {
    parts.push('Cambiaron archivos que requieren revisión independiente:\n' +
      due.map(r => `- ${r.name} (${r.why}): ${shown(r.files)}`).join('\n') +
      '\nInvoca esos revisores sobre el diff antes de terminar. Si ya los invocaste para estos mismos cambios, o el cambio es ' +
      'puramente mecánico y no altera comportamiento, termina indicando al usuario cuál es el caso.');
  }
  if (skillsDrift) {
    parts.push(`Las copias de skills difieren (${SKILL_COPIES.join(' y ')}) tras cambiar: ${shown(skillFiles)}. ` +
      'La fuente es .claude/skills: ejecuta `npm run skills:sync` y comprueba con `npm run skills:check` (la CI falla si difieren). ' +
      'Si editaste .agents/skills directamente, lleva el cambio a .claude/skills antes de sincronizar.');
  }
  return {decision: 'block', reason: parts.join('\n')};
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
module.exports = {run, REVIEWERS, IGNORED, TEST_REVIEWER};
