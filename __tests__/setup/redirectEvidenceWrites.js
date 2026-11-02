// Phase 0: an ordinary Jest run must not rewrite the versioned evidence under docs/.
// Every write, rename or deletion aimed at docs/ is redirected to an artifact folder ignored by
// Git (artifacts/jest-evidence/docs/..., or SMARTFIN_EVIDENCE_DIR). Reads are untouched, so tests
// that compare against historical evidence keep reading the committed files.
// Refreshing the historical evidence on purpose: SMARTFIN_WRITE_EVIDENCE=1.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const PATCHED = Symbol.for('smartfin.phase0.evidenceRedirect');

if (process.env.SMARTFIN_WRITE_EVIDENCE !== '1' && !fs[PATCHED]) {
  const root = path.resolve(__dirname, '..', '..');
  const docs = path.join(root, 'docs');
  const artifacts = path.resolve(root, process.env.SMARTFIN_EVIDENCE_DIR || 'artifacts/jest-evidence');
  const original = {
    mkdirSync: fs.mkdirSync,
  };

  // Strings and file: URLs only; descriptors and buffers are passed through unchanged.
  const redirect = target => {
    if (typeof target !== 'string' && !(target instanceof URL)) return target;
    const absolute = path.resolve(target instanceof URL ? fileURLToPath(target) : target);
    const relative = path.relative(docs, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return target;
    return path.join(artifacts, 'docs', relative);
  };
  // Tests that write straight into an existing docs/ folder also find the folder in artifacts/.
  const redirectFile = target => {
    const redirected = redirect(target);
    if (redirected !== target) original.mkdirSync(path.dirname(redirected), { recursive: true });
    return redirected;
  };
  const wrap = (owner, name, map) => {
    const fn = owner[name];
    if (typeof fn !== 'function') return;
    owner[name] = function redirectedEvidenceWrite(...args) {
      return fn.apply(this, map(args));
    };
  };
  const first = mapper => args => [mapper(args[0]), ...args.slice(1)];
  const second = mapper => args => [args[0], mapper(args[1]), ...args.slice(2)];
  const both = mapper => args => [mapper(args[0]), mapper(args[1]), ...args.slice(2)];

  for (const owner of [fs, fs.promises]) {
    for (const name of ['writeFile', 'appendFile', 'writeFileSync', 'appendFileSync', 'createWriteStream'])
      wrap(owner, name, first(redirectFile));
    for (const name of ['mkdir', 'mkdirSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync'])
      wrap(owner, name, first(redirect));
    for (const name of ['copyFile', 'copyFileSync', 'cp', 'cpSync'])
      wrap(owner, name, second(redirectFile));
    for (const name of ['rename', 'renameSync'])
      wrap(owner, name, both(redirectFile));
  }
  Object.defineProperty(fs, PATCHED, { value: { docs, artifacts } });
}
