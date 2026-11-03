'use strict';
// Mechanical, reviewable derivative of the validated 1a.3B r5 runner for the 1a.4A workspace. Writes a file only.
// Same isolation checks; changes the workspace, evidence and identity paths, adds the seven 1a.4A campaigns to the
// allowed list (the 1a.3B/1a.3A campaigns now run with the 1a.4A references, the 1a.2/6B.3/6A ones unchanged), the clean
// reset for phase1a4a- campaigns and lets phase1a4a-unknown-restart keep the data of phase1a4a-unknown.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
if (process.argv.length !== 2) throw Error('No arguments');
const bytes = fs.readFileSync(path.join(root, 'scripts/phase1a3b/run-android.ps1'));
if (crypto.createHash('sha256').update(bytes).digest('hex') !== 'bc0bc35336851da1d97793e91298ddb32601e4a1568d3578e7fbb5ec7a0c4daa') throw Error('Runner baseline changed');
const previous = ['phase1a3b-upgrade', 'phase1a3b-startup-seed', 'phase1a3b-startup-upgrade', 'phase1a3b-upgrade-restart',
  'phase1a3b-migration-atomicity', 'phase1a3b-integrity', 'phase1a3b-flows', 'phase1a3a-identity', 'phase1a3a-atomicity',
  'phase1a3a-unknown', 'phase1a3a-unknown-restart', 'phase1a2-statements', 'phase1a2-atomicity-historical', 'phase6b3-probes',
  'phase6b3-atomicity', 'phase6b3-unknown', 'phase6b3-unknown-restart', 'phase6a-precision'];
const allowed1a3b = `$allowed=@(${previous.map(name => `'${name}'`).join(',')})`;
const preserved1a3b = ['phase6b3-unknown-restart', 'phase1a3a-unknown-restart', 'phase1a3b-startup-upgrade', 'phase1a3b-upgrade-restart'];
const preserve1a3b = `if($PreserveData -and $Campaign -notin @(${preserved1a3b.map(name => `'${name}'`).join(',')})){throw 'PreserveData is restricted to restart campaigns'}`;
const header = '# 1a.3B r5 runner (derived by make-runner.cjs from the 1a.3A runner); isolated synthetic package only.\n';
let text = bytes.toString();
for (const required of [header, allowed1a3b, preserve1a3b, "'^phase1a3b-|^phase1a3a-|", 'C:/sf-1a3b-r5-20261102',
  'docs/validacion-fase1a3b/r5/android', 'docs/validacion-fase1a3b/r5/authorization/apk-identity.json',
  "'Only the 1a.3B r5 synthetic workspace is authorized'", "[string]$Campaign='phase1a3b-upgrade'"]) {
  if (!text.includes(required)) throw Error('Runner anchor missing: ' + required);
}
const campaigns = ['phase1a4a-creation', 'phase1a4a-lifecycle', 'phase1a4a-compatibility', 'phase1a4a-invariants',
  'phase1a4a-atomicity', 'phase1a4a-unknown', 'phase1a4a-unknown-restart', ...previous];
const preserved = [...preserved1a3b, 'phase1a4a-unknown-restart'];
text = text.replace(header, '')
  .replaceAll('C:/sf-1a3b-r5-20261102', 'C:/sf-1a4a-20261102')
  .replaceAll('docs/validacion-fase1a3b/r5/authorization/apk-identity.json', 'docs/validacion-fase1a4a/authorization/apk-identity.json')
  .replaceAll('docs/validacion-fase1a3b/r5/android', 'docs/validacion-fase1a4a/android')
  .replace("'Only the 1a.3B r5 synthetic workspace is authorized'", "'Only the 1a.4A synthetic workspace is authorized'")
  .replace("[string]$Campaign='phase1a3b-upgrade'", "[string]$Campaign='phase1a4a-creation'")
  .replace(allowed1a3b, `$allowed=@(${campaigns.map(name => `'${name}'`).join(',')})`)
  .replace(preserve1a3b, `if($PreserveData -and $Campaign -notin @(${preserved.map(name => `'${name}'`).join(',')})){throw 'PreserveData is restricted to restart campaigns'}`)
  .replaceAll("'^phase1a3b-|^phase1a3a-|", "'^phase1a4a-|^phase1a3b-|^phase1a3a-|");
if (text.includes('validacion-fase1a3b/r5') || text.includes('sf-1a3b-')) throw Error('1a.3B path left in the derived runner');
const destination = path.join(root, 'scripts/phase1a4a/run-android.ps1');
if (fs.existsSync(destination)) throw Error('Runner already written; review and delete it explicitly before regenerating');
fs.writeFileSync(destination, '# 1a.4A runner (derived by make-runner.cjs from the 1a.3B r5 runner); isolated synthetic package only.\n' + text);
console.log('1a.4A runner written, no Android operation performed.');
