'use strict';
// Mechanical, reviewable derivative of the validated 1a.3A runner for the 1a.3B workspace. Writes a file only.
// Same isolation checks; changes the workspace, evidence and identity paths, the allowed campaigns (seven 1a.3B
// campaigns plus the eleven 1a.3A/1a.2/6B.3/6A regressions), the clean reset for phase1a3b- campaigns and lets the
// two 1a.3B start-up campaigns keep the synthetic data of the campaign right before them (as the unknown restarts do).
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
if (process.argv.length !== 2) throw Error('No arguments');
const bytes = fs.readFileSync(path.join(root, 'scripts/phase1a3a/run-android.ps1'));
if (crypto.createHash('sha256').update(bytes).digest('hex') !== 'e02594b5d443b06c94118f2ec1d9083c578041eaef971e7cbcc390eb52a24eaa') throw Error('Runner baseline changed');
const regressions = ['phase1a3a-identity', 'phase1a3a-atomicity', 'phase1a3a-unknown', 'phase1a3a-unknown-restart',
  'phase1a2-statements', 'phase1a2-atomicity-historical', 'phase6b3-probes', 'phase6b3-atomicity', 'phase6b3-unknown',
  'phase6b3-unknown-restart', 'phase6a-precision'];
const allowed1a3a = `$allowed=@(${regressions.map(name => `'${name}'`).join(',')})`;
const preserve1a3a = "if($PreserveData -and $Campaign -notin @('phase6b3-unknown-restart','phase1a3a-unknown-restart')){throw 'PreserveData is restricted to unknown restart'}";
const header = '# 1a.3A runner (derived by make-runner.cjs from the 6B.3.1 runner); isolated synthetic package only.\n';
let text = bytes.toString();
for (const required of [header, allowed1a3a, preserve1a3a, "'^phase1a3a-|", 'C:/sf-1a3a-20261102', 'docs/validacion-fase1a3a/android',
  'docs/validacion-fase1a3a/authorization/apk-identity.json', "'Only the 1a.3A synthetic workspace is authorized'", "[string]$Campaign='phase1a3a-identity'"]) {
  if (!text.includes(required)) throw Error('Runner anchor missing: ' + required);
}
const campaigns = ['phase1a3b-upgrade', 'phase1a3b-startup-seed', 'phase1a3b-startup-upgrade', 'phase1a3b-upgrade-restart',
  'phase1a3b-migration-atomicity', 'phase1a3b-integrity', 'phase1a3b-flows', ...regressions];
const preserved = ['phase6b3-unknown-restart', 'phase1a3a-unknown-restart', 'phase1a3b-startup-upgrade', 'phase1a3b-upgrade-restart'];
text = text.replace(header, '')
  .replaceAll('C:/sf-1a3a-20261102', 'C:/sf-1a3b-r5-20261102')
  .replaceAll('docs/validacion-fase1a3a/authorization/apk-identity.json', 'docs/validacion-fase1a3b/r5/authorization/apk-identity.json')
  .replaceAll('docs/validacion-fase1a3a/android', 'docs/validacion-fase1a3b/r5/android')
  .replace("'Only the 1a.3A synthetic workspace is authorized'", "'Only the 1a.3B r5 synthetic workspace is authorized'")
  .replace("[string]$Campaign='phase1a3a-identity'", "[string]$Campaign='phase1a3b-upgrade'")
  .replace(allowed1a3a, `$allowed=@(${campaigns.map(name => `'${name}'`).join(',')})`)
  .replace(preserve1a3a, `if($PreserveData -and $Campaign -notin @(${preserved.map(name => `'${name}'`).join(',')})){throw 'PreserveData is restricted to restart campaigns'}`)
  .replaceAll("'^phase1a3a-|", "'^phase1a3b-|^phase1a3a-|");
if (text.includes('validacion-fase1a3a/android') || text.includes('sf-1a3a-')) throw Error('1a.3A path left in the derived runner');
const destination = path.join(root, 'scripts/phase1a3b/run-android.ps1');
if (fs.existsSync(destination)) throw Error('Runner already written; review and delete it explicitly before regenerating');
fs.writeFileSync(destination, '# 1a.3B r5 runner (derived by make-runner.cjs from the 1a.3A runner); isolated synthetic package only.\n' + text);
console.log('1a.3B r5 runner written, no Android operation performed.');
