'use strict';
// Mechanical, reviewable derivative of the approved 1a.4A r2 runner for the 1a.4B workspace. Writes a file only. Same
// isolation checks, device identities, resets and PreserveData rules; changes: workspace, evidence and identity paths,
// the seven phase1a4b- campaigns allowed (clean synthetic package before each, PreserveData only for
// phase1a4b-unknown-restart).
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
if (process.argv.length !== 2) throw Error('No arguments');
const bytes = fs.readFileSync(path.join(root, 'scripts/phase1a4a/run-android-r2.ps1'));
if (crypto.createHash('sha256').update(bytes).digest('hex') !== '6337f150886331ff17b1d53424256ef8e3fdbeea0802c7dbee839a9010aac493') throw Error('Runner baseline changed');
const header = '# 1a.4A r2 runner (derived by make-runner-r2.cjs from the 1a.4A r1 runner); isolated synthetic package only.\n';
const NEW = "'phase1a4b-register','phase1a4b-reversal','phase1a4b-guards','phase1a4b-idempotency','phase1a4b-atomicity','phase1a4b-unknown','phase1a4b-unknown-restart'";
const replacements = [
  [header, ''],
  ["[string]$Campaign='phase1a4a-creation'", "[string]$Campaign='phase1a4b-register'"],
  ["$allowed=@('phase1a4a-creation',", `$allowed=@(${NEW},'phase1a4a-creation',`],
  ["'phase1a4a-unknown-restart')){throw 'PreserveData is restricted to restart campaigns'}",
    "'phase1a4a-unknown-restart','phase1a4b-unknown-restart')){throw 'PreserveData is restricted to restart campaigns'}"],
  ["$Campaign -match '^phase1a4a-|", "$Campaign -match '^phase1a4b-|^phase1a4a-|"],
  ["'Only the 1a.4A r2 synthetic workspace is authorized'", "'Only the 1a.4B synthetic workspace is authorized'"],
];
let text = bytes.toString();
for (const [from, to] of replacements) {
  if (text.split(from).length !== 2) throw Error('Runner anchor not found exactly once: ' + from);
  text = text.replace(from, to);
}
text = text.replaceAll('C:/sf-1a4a-r2-20261102', 'C:/sf-1a4b-20261102')
  .replaceAll('docs/validacion-fase1a4a/r2/authorization/apk-identity.json', 'docs/validacion-fase1a4b/authorization/apk-identity.json')
  .replaceAll('docs/validacion-fase1a4a/r2/android', 'docs/validacion-fase1a4b/android');
if (text.includes('sf-1a4a') || /validacion-fase1a4a\//.test(text)) throw Error('1a.4A path left in the derived runner');
const destination = path.join(root, 'scripts/phase1a4b/run-android.ps1');
if (fs.existsSync(destination)) throw Error('Runner already written; review and delete it explicitly before regenerating');
fs.writeFileSync(destination, '# 1a.4B runner (derived by make-runner.cjs from the 1a.4A r2 runner); isolated synthetic package only.\n' + text);
console.log('1a.4B runner written, no Android operation performed.');
