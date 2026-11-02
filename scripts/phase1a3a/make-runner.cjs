'use strict';
// Mechanical, reviewable derivative of the validated 6B.3.1 runner for the 1a.3A workspace. Writes a file only.
// Same isolation checks; changes the workspace, evidence and identity paths, the allowed campaigns (four 1a.3A
// campaigns plus the seven 1a.2 r2 ones), the clean reset for phase1a3a-/phase1a2- campaigns and lets the two
// unknown-restart campaigns keep the synthetic data of their preceding unknown campaign.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
if (process.argv.length !== 2) throw Error('No arguments');
const bytes = fs.readFileSync(path.join(root, 'scripts/phase6b3/run-android.ps1'));
if (crypto.createHash('sha256').update(bytes).digest('hex') !== 'a2693a9b2c41128cf1c007a2147628dcccd2e5dc1199af08d9adb2511d5aa8a8') throw Error('Runner baseline changed');
const allowed6b3 = "$allowed=@('phase6b3-probes','phase6b3-atomicity','phase6b3-unknown','phase6b3-unknown-restart','phase6a-precision','phase6b3-presentation','phase6b3-ui-small','phase6b3-ui-cents','phase6b3-ui-insufficient','phase6b3-ui-stale','phase6b3-ui-unknown')";
const preserve6b3 = "if($PreserveData -and $Campaign -ne 'phase6b3-unknown-restart'){throw 'PreserveData is restricted to unknown restart'}";
let text = bytes.toString();
for (const required of [allowed6b3, preserve6b3, "'^phase6b3-|", 'C:/sf-6b3-20261101', 'docs/validacion-fase6b3-1/android',
  'docs/validacion-fase6b3-1/authorization/apk-identity.json', "'Only the 6B.3 synthetic workspace is authorized'", "[string]$Campaign='phase6b3-probes'"]) {
  if (!text.includes(required)) throw Error('Runner anchor missing: ' + required);
}
const campaigns = ['phase1a3a-identity', 'phase1a3a-atomicity', 'phase1a3a-unknown', 'phase1a3a-unknown-restart',
  'phase1a2-statements', 'phase1a2-atomicity-historical', 'phase6b3-probes', 'phase6b3-atomicity', 'phase6b3-unknown',
  'phase6b3-unknown-restart', 'phase6a-precision'];
text = text.replace('# 6B.3.1 owner-authorized runner; isolated synthetic package only.\n', '')
  .replaceAll('C:/sf-6b3-20261101', 'C:/sf-1a3a-20261102')
  .replaceAll('docs/validacion-fase6b3-1/authorization/apk-identity.json', 'docs/validacion-fase1a3a/authorization/apk-identity.json')
  .replaceAll('docs/validacion-fase6b3-1/android', 'docs/validacion-fase1a3a/android')
  .replace("'Only the 6B.3 synthetic workspace is authorized'", "'Only the 1a.3A synthetic workspace is authorized'")
  .replace("[string]$Campaign='phase6b3-probes'", "[string]$Campaign='phase1a3a-identity'")
  .replace(allowed6b3, `$allowed=@(${campaigns.map(name => `'${name}'`).join(',')})`)
  .replace(preserve6b3, "if($PreserveData -and $Campaign -notin @('phase6b3-unknown-restart','phase1a3a-unknown-restart')){throw 'PreserveData is restricted to unknown restart'}")
  .replaceAll("'^phase6b3-|", "'^phase1a3a-|^phase1a2-|^phase6b3-|");
if (text.includes('validacion-fase6b3-1') || text.includes('sf-6b3-')) throw Error('6B.3 path left in the derived runner');
const destination = path.join(root, 'scripts/phase1a3a/run-android.ps1');
if (fs.existsSync(destination)) throw Error('Runner already written; review and delete it explicitly before regenerating');
fs.writeFileSync(destination, '# 1a.3A runner (derived by make-runner.cjs from the 6B.3.1 runner); isolated synthetic package only.\n' + text);
console.log('1a.3A runner written, no Android operation performed.');
