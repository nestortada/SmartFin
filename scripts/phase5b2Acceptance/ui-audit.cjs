// Review probe: executes the exact runSettingsTask callback extracted from the
// current navigator, with synthetic deferred tasks. Does not enable the flag.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const parser = require('@babel/parser');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');
const file = 'src/navigation/AppNavigator.tsx';
const source = fs.readFileSync(path.join(root, file), 'utf8');
const tree = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
let callback;
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'VariableDeclarator' && value.id.name === 'runSettingsTask') callback = value.init.arguments[0];
  for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else visit(child);
}
visit(tree);
if (!callback) throw Error('Current task wrapper not found');
const code = babel.transformSync('module.exports=' + source.slice(callback.start, callback.end), {
  filename: 'acceptance-review.ts', presets: ['module:@react-native/babel-preset'],
}).code;
const events = [];
let busy;
const context = { module: { exports: {} }, require, Error,
  setBusyMessage(value) { busy = value; events.push({ kind: 'busy', value: value ?? null }); },
  setErrorMessage(value) { events.push({ kind: 'error', value: value ?? null }); } };
vm.runInNewContext(code, context);
(async () => {
  const run = context.module.exports;
  let complete;
  let firstPending = true;
  const first = run('Capturando SQLite. Las operaciones financieras esperan...', () => new Promise(resolve => { complete = resolve; }));
  await run('Actualizando respaldo en Google Drive...', async () => { throw new Error('Ya hay un respaldo en curso.'); });
  const busyHiddenWhileFirstStillPending = busy === undefined && firstPending;
  complete(); firstPending = false; await first;
  if (!busyHiddenWhileFirstStillPending) throw Error('Expected characterization changed; review UI source');
  const captions = source.match(/const messages = (\{[\s\S]*?\n        \});/);
  if (!captions) throw Error('Progress mapping absent');
  const messages = vm.runInNewContext('(' + captions[1] + ')');
  const output = path.join(root, 'docs/aceptacion-fase5b2');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'ui-audit.json'), JSON.stringify({ file,
    sha256: crypto.createHash('sha256').update(source).digest('hex'),
    method: 'Extracted current callback, synthetic promises; not a mounted device UI test',
    busyHiddenWhileFirstStillPending, messages, events,
    findings: ['Second request is financially blocked by the service, but its task wrapper clears the shared progress indicator.',
      'Recovery calls verifyDriveBackupJob without an onProgress callback; only its generic busy message is shown.',
      'Production flag remains false; end-to-end activated UI is not certified.'] }, null, 2));
  console.log(JSON.stringify({ busyHiddenWhileFirstStillPending, financialWrites: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
