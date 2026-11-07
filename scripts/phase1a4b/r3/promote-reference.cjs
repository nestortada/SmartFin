'use strict';
// Phase 1a.4B r3 — EXCEPTIONAL, audited promotion of the current 1a.4B Node reference
// (docs/validacion-fase1a4b/node/results.json). Authorized only for the two leaves demonstrated by r2 (a fresh database
// per campaign, as on Android):
//   $.phase1a4b.reversal.editAmount.observation.backupRevision   31 -> 33
//   $.phase1a4b.guards.deletePurchase.observation.backupRevision 23 -> 25
// Refuses unless: the current file is the reviewed original (d26e3a53…, so a second run always fails), the candidate is a
// new file outside docs/, the structural comparison finds exactly those two differences, and the original with those two
// replacements serializes to the candidate byte for byte (no other leaf, key order or row order changed). The original
// is archived byte-identical and a difference report is kept. Never touches any other reference.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const REFERENCE = path.join(root, 'docs/validacion-fase1a4b/node/results.json');
const ORIGINAL_SHA256 = 'd26e3a53f5cb89d673a83886f5fd6af6932956615c42348e2e55c2b287ba675f';
const ARCHIVE = path.join(root, 'docs/validacion-fase1a4b/r3/reference-before/results.json');
const REPORT = path.join(root, 'docs/validacion-fase1a4b/r3/reference-update.json');
const ALLOWED = [
  {path: ['phase1a4b', 'reversal', 'editAmount', 'observation', 'backupRevision'], before: 31, after: 33},
  {path: ['phase1a4b', 'guards', 'deletePurchase', 'observation', 'backupRevision'], before: 23, after: 25},
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--candidate' || args[2] !== '--authorize-r3-two-leaves')
  throw Error('Usage: promote-reference.cjs --candidate <new file outside docs/> --authorize-r3-two-leaves');
const candidatePath = path.resolve(root, args[1]);
if (path.relative(path.join(root, 'docs'), candidatePath).split(path.sep)[0] !== '..') throw Error('Candidate must be outside docs/');
const originalBytes = fs.readFileSync(REFERENCE);
if (sha(originalBytes) !== ORIGINAL_SHA256) throw Error('Current reference is not the reviewed original (already promoted or changed): ' + sha(originalBytes));
if (fs.existsSync(ARCHIVE) || fs.existsSync(REPORT)) throw Error('Archive or report exists; review it explicitly');
const candidateBytes = fs.readFileSync(candidatePath);
const original = JSON.parse(originalBytes.toString());
const candidate = JSON.parse(candidateBytes.toString());

const differences = [];
let leaves = 0;
(function walk(a, b, at) {
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (JSON.stringify(ka) !== JSON.stringify(kb)) differences.push({path: at.join('.'), kind: 'keys', before: ka, after: kb});
    for (const key of [...new Set([...ka, ...kb])]) walk(a[key], b[key], [...at, key]);
    return;
  }
  leaves++;
  if (JSON.stringify(a) !== JSON.stringify(b)) differences.push({path: at.join('.'), kind: 'value', before: a, after: b});
})(original, candidate, ['$']);

const expected = ALLOWED.map(item => ({path: ['$', ...item.path].join('.'), kind: 'value', before: item.before, after: item.after}));
const sortByPath = list => [...list].sort((x, y) => x.path.localeCompare(y.path));
if (JSON.stringify(sortByPath(differences)) !== JSON.stringify(sortByPath(expected)))
  throw Error('Differences are not exactly the two authorized leaves: ' + JSON.stringify(differences.slice(0, 20)));
const patched = JSON.parse(originalBytes.toString());
for (const item of ALLOWED) {
  const parent = item.path.slice(0, -1).reduce((node, key) => node[key], patched);
  const key = item.path[item.path.length - 1];
  if (parent[key] !== item.before) throw Error('Unexpected original value at ' + item.path.join('.'));
  parent[key] = item.after;
}
const rebuilt = Buffer.from(JSON.stringify(patched, null, 2) + '\n');
if (!rebuilt.equals(candidateBytes)) throw Error('Candidate is not the original with exactly the two replacements (byte comparison)');
if (!Buffer.from(JSON.stringify(original, null, 2) + '\n').equals(originalBytes)) throw Error('Original serialization not canonical');

fs.mkdirSync(path.dirname(ARCHIVE), {recursive: true});
fs.writeFileSync(ARCHIVE, originalBytes, {flag: 'wx'});
if (sha(fs.readFileSync(ARCHIVE)) !== ORIGINAL_SHA256) throw Error('Archive copy differs');
fs.writeFileSync(REFERENCE, candidateBytes);
const newSha = sha(fs.readFileSync(REFERENCE));
if (newSha !== sha(candidateBytes)) throw Error('Promoted reference differs from the candidate');
const report = {phase: '1a.4B r3', operation: 'exceptional promotion of the current 1a.4B Node reference',
  reason: 'r2 demonstrated that Node shared one database across phase1a4b-register/-reversal/-guards while Android clears it per campaign',
  reference: 'docs/validacion-fase1a4b/node/results.json', originalSha256: ORIGINAL_SHA256, newSha256: newSha,
  archivedOriginal: 'docs/validacion-fase1a4b/r3/reference-before/results.json', leavesCompared: leaves, differences,
  sizeBytes: {before: originalBytes.length, after: candidateBytes.length}, runtime: {before: original.runtime, after: candidate.runtime}};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify(report, null, 2));
