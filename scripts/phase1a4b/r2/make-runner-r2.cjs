'use strict';
// Mechanical, reviewable derivative of the 1a.4B r1 runner (scripts/phase1a4b/run-android.ps1, pinned hash) for the r2
// DIAGNOSTIC workspace. Writes a file only. Same isolation checks, AVD identity, synthetic reset (pm clear of
// com.smartfin.snapshot5b2.tests only), production-package check and evidence handling. Changes: r2 workspace, r2 identity
// and evidence paths, ONLY emulator-5554 (API 24) and ONLY the campaign phase1a4b-r2-editamount.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
if (process.argv.length !== 2) throw Error('No arguments');
const bytes = fs.readFileSync(path.join(root, 'scripts/phase1a4b/run-android.ps1'));
if (crypto.createHash('sha256').update(bytes).digest('hex') !== RUNNER_R1()) throw Error('r1 runner changed');
function RUNNER_R1() { return '3b4986b1398fc42475c495034baad1eab8a98c8d4c5213043e53d996acc9dee5'; }
const replacements = [
  ['# 1a.4B runner (derived by make-runner.cjs from the 1a.4A r2 runner); isolated synthetic package only.\n',
    '# 1a.4B r2 DIAGNOSTIC runner (derived by scripts/phase1a4b/r2/make-runner-r2.cjs from the 1a.4B r1 runner); isolated synthetic package only.\n'],
  ["[string]$Campaign='phase1a4b-register'", "[string]$Campaign='phase1a4b-r2-editamount'"],
  ["[string]$Output='docs/validacion-fase1a4b/android/api24/probes'", "[string]$Output='docs/validacion-fase1a4b/r2/android-b/api24/phase1a4b-r2-editamount'"],
  ["if($Harness -ne 'C:/sf-1a4b-20261102'){throw 'Only the 1a.4B synthetic workspace is authorized'}",
    "if($Harness -ne 'C:/sf-1a4b-r2b-20261106'){throw 'Only the 1a.4B r2 (attempt b) diagnostic workspace is authorized'}"],
  ["if(-not (($Serial -eq 'emulator-5554') -or ($Serial -eq 'AXCC6R3919012932'))){throw 'Unrecognized serial'}",
    "if($Serial -ne 'emulator-5554'){throw 'r2 diagnostic: only emulator-5554 (API 24) is authorized'}"],
  ['"docs/validacion-fase1a4b/android/api$expectedApi/$Campaign"', '"docs/validacion-fase1a4b/r2/android-b/api$expectedApi/$Campaign"'],
  ["'docs/validacion-fase1a4b/authorization/apk-identity.json'", "'docs/validacion-fase1a4b/r2/authorization/apk-identity-b.json'"],
];
let text = bytes.toString();
for (const [from, to] of replacements) {
  if (text.split(from).length !== 2) throw Error('Runner anchor not found exactly once: ' + from);
  text = text.replace(from, to);
}
const allowed = /^\$allowed=@\([^\r\n]*\)$/m;
if ((text.match(new RegExp(allowed.source, 'gm')) ?? []).length !== 1) throw Error('Allowed campaign list not found exactly once');
text = text.replace(allowed, "$allowed=@('phase1a4b-r2-editamount')");
text = text.replaceAll('C:/sf-1a4b-20261102', 'C:/sf-1a4b-r2b-20261106');
if (text.includes('sf-1a4b-20261102') || text.includes("'docs/validacion-fase1a4b/android") || text.includes('AXCC6R3919012932\')){'))
  throw Error('r1 path or second device left in the derived runner');
if (!text.includes("$Campaign -match '^phase1a4b-|")) throw Error('Synthetic reset rule missing');
const destination = path.join(root, 'scripts/phase1a4b/r2/run-android-r2b.ps1');
if (fs.existsSync(destination)) throw Error('Runner already written; review and delete it explicitly before regenerating');
fs.writeFileSync(destination, text);
console.log('1a.4B r2 diagnostic runner written, no Android operation performed.');
