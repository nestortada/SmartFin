'use strict';
// Mechanical, reviewable derivative of the 1a.4A r1 runner for the r2 workspace. Writes a file only. Same isolation
// checks, campaigns, resets and PreserveData rules; only the workspace, evidence and identity paths change.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
if (process.argv.length !== 2) throw Error('No arguments');
const bytes = fs.readFileSync(path.join(root, 'scripts/phase1a4a/run-android.ps1'));
if (crypto.createHash('sha256').update(bytes).digest('hex') !== '52e466b89d9c67c277bde85f27066a61c73ca8630939179abb567714370c82c1') throw Error('Runner baseline changed');
const header = '# 1a.4A runner (derived by make-runner.cjs from the 1a.3B r5 runner); isolated synthetic package only.\n';
let text = bytes.toString();
for (const required of [header, 'C:/sf-1a4a-20261102', 'docs/validacion-fase1a4a/android', 'docs/validacion-fase1a4a/authorization/apk-identity.json',
  "'Only the 1a.4A synthetic workspace is authorized'"]) {
  if (!text.includes(required)) throw Error('Runner anchor missing: ' + required);
}
text = text.replace(header, '')
  .replaceAll('C:/sf-1a4a-20261102', 'C:/sf-1a4a-r2-20261102')
  .replaceAll('docs/validacion-fase1a4a/authorization/apk-identity.json', 'docs/validacion-fase1a4a/r2/authorization/apk-identity.json')
  .replaceAll('docs/validacion-fase1a4a/android', 'docs/validacion-fase1a4a/r2/android')
  .replace("'Only the 1a.4A synthetic workspace is authorized'", "'Only the 1a.4A r2 synthetic workspace is authorized'");
if (text.includes('sf-1a4a-20261102') || /validacion-fase1a4a\/(android|authorization)/.test(text)) throw Error('r1 path left in the derived runner');
const destination = path.join(root, 'scripts/phase1a4a/run-android-r2.ps1');
if (fs.existsSync(destination)) throw Error('Runner already written; review and delete it explicitly before regenerating');
fs.writeFileSync(destination, '# 1a.4A r2 runner (derived by make-runner-r2.cjs from the 1a.4A r1 runner); isolated synthetic package only.\n' + text);
console.log('1a.4A r2 runner written, no Android operation performed.');
