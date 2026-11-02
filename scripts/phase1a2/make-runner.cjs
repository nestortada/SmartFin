'use strict';
// Mechanical, reviewable derivative of the validated 6B.3.1 runner for the 1a.2 workspace. Writes a file only.
// r1 (run-android.ps1): first 1a.2 campaign, evidence in docs/validacion-fase1a2/android/.
// r2 (run-android-r2.ps1): matrix with pinned clock plus phase1a2-atomicity-historical, evidence in android-r2/ and
// identity apk-identity-r2.json, so that no r1 evidence is overwritten.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const revision = process.argv[2];
if (process.argv.length !== 3 || !['r1', 'r2'].includes(revision)) throw Error('Use r1 or r2');
const bytes = fs.readFileSync(path.join(root, 'scripts/phase6b3/run-android.ps1'));
if (crypto.createHash('sha256').update(bytes).digest('hex') !== 'a2693a9b2c41128cf1c007a2147628dcccd2e5dc1199af08d9adb2511d5aa8a8') throw Error('Runner baseline changed');
const allowed6b3 = "$allowed=@('phase6b3-probes','phase6b3-atomicity','phase6b3-unknown','phase6b3-unknown-restart','phase6a-precision','phase6b3-presentation','phase6b3-ui-small','phase6b3-ui-cents','phase6b3-ui-insufficient','phase6b3-ui-stale','phase6b3-ui-unknown')";
let text = bytes.toString();
for (const required of [allowed6b3, "'^phase6b3-|", 'C:/sf-6b3-20261101', 'docs/validacion-fase6b3-1/android', 'docs/validacion-fase6b3-1/authorization/apk-identity.json']) {
  if (!text.includes(required)) throw Error('Runner anchor missing: ' + required);
}
const r2 = revision === 'r2';
const campaigns = ['phase1a2-statements', ...(r2 ? ['phase1a2-atomicity-historical'] : []),
  'phase6b3-probes', 'phase6b3-atomicity', 'phase6b3-unknown', 'phase6b3-unknown-restart', 'phase6a-precision'];
text = text.replace('# 6B.3.1 owner-authorized runner; isolated synthetic package only.\n', '')
  .replaceAll('C:/sf-6b3-20261101', 'C:/sf-1a2-20261101')
  .replaceAll('docs/validacion-fase6b3-1/android', r2 ? 'docs/validacion-fase1a2/android-r2' : 'docs/validacion-fase1a2/android')
  .replaceAll('docs/validacion-fase6b3-1/authorization/apk-identity.json',
    r2 ? 'docs/validacion-fase1a2/authorization/apk-identity-r2.json' : 'docs/validacion-fase1a2/authorization/apk-identity.json')
  .replace("'Only the 6B.3 synthetic workspace is authorized'", "'Only the 1a.2 synthetic workspace is authorized'")
  .replace("[string]$Campaign='phase6b3-probes'", "[string]$Campaign='phase1a2-statements'")
  .replace(allowed6b3, `$allowed=@(${campaigns.map(name => `'${name}'`).join(',')})`)
  .replaceAll("'^phase6b3-|", "'^phase1a2-|^phase6b3-|");
if (text.includes('validacion-fase6b3-1')) throw Error('6B.3 evidence path left in the derived runner');
const destination = path.join(root, r2 ? 'scripts/phase1a2/run-android-r2.ps1' : 'scripts/phase1a2/run-android.ps1');
const header = `# 1a.2 runner ${revision} (derived by make-runner.cjs from the 6B.3.1 runner); isolated synthetic package only.\n`;
const legacyHeader = '# 1a.2 runner (derived by make-runner.cjs from the 6B.3.1 runner); isolated synthetic package only.\n';
if (fs.existsSync(destination)) {
  const existing = fs.readFileSync(destination, 'utf8');
  if (!existing.startsWith(header) && !existing.startsWith(legacyHeader)) throw Error('Unrecognized existing runner');
  if (revision === 'r1') throw Error('r1 runner already written; it is kept as evidence of the first campaign');
}
fs.writeFileSync(destination, header + text);
console.log(`1a.2 runner ${revision} written, no Android operation performed.`);
