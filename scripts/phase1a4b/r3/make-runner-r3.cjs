'use strict';
// Mechanical, reviewable derivatives of the 1a.4B r1 runners for the r3 workspace. Writes files only (no adb, no build).
// run-android-r3.ps1 = scripts/phase1a4b/run-android.ps1 (pinned) with the r3 workspace, the r3 APK identity and the r3
// evidence path. Same two devices (emulator-5554 API 24, AXCC6R3919012932 API 35), same 32 campaigns, same isolation
// checks, same pm clear of com.smartfin.snapshot5b2.tests before every non-restart campaign and the same PreserveData rules.
// run-all-r3.ps1 = scripts/phase1a4b/run-all.ps1 (pinned) calling the r3 runner with the r3 evidence path.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
if (process.argv.length !== 2) throw Error('No arguments');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function derive(source, pinned, replacements, destination, banned) {
  const bytes = fs.readFileSync(path.join(root, source));
  if (sha(bytes) !== pinned) throw Error('Baseline changed: ' + source);
  let text = bytes.toString();
  for (const [from, to] of replacements) {
    if (text.split(from).length !== 2) throw Error('Anchor not found exactly once in ' + source + ': ' + from);
    text = text.replace(from, to);
  }
  for (const pattern of banned) if (text.includes(pattern)) throw Error('r1 path left in ' + destination + ': ' + pattern);
  const target = path.join(root, destination);
  if (fs.existsSync(target)) throw Error(destination + ' already written; review and delete it explicitly before regenerating');
  fs.writeFileSync(target, text);
}
derive('scripts/phase1a4b/run-android.ps1', '3b4986b1398fc42475c495034baad1eab8a98c8d4c5213043e53d996acc9dee5', [
  ['# 1a.4B runner (derived by make-runner.cjs from the 1a.4A r2 runner); isolated synthetic package only.\n',
    '# 1a.4B r3 runner (derived by scripts/phase1a4b/r3/make-runner-r3.cjs from the 1a.4B r1 runner); isolated synthetic package only.\n'],
  ["[string]$Harness='C:/sf-1a4b-20261102'", "[string]$Harness='C:/sf-1a4b-r3-20261107'"],
  ["[string]$Output='docs/validacion-fase1a4b/android/api24/probes'", "[string]$Output='docs/validacion-fase1a4b/r3/android/api24/probes'"],
  ["if($Harness -ne 'C:/sf-1a4b-20261102'){throw 'Only the 1a.4B synthetic workspace is authorized'}",
    "if($Harness -ne 'C:/sf-1a4b-r3-20261107'){throw 'Only the 1a.4B r3 synthetic workspace is authorized'}"],
  ['"docs/validacion-fase1a4b/android/api$expectedApi/$Campaign"', '"docs/validacion-fase1a4b/r3/android/api$expectedApi/$Campaign"'],
  ["'docs/validacion-fase1a4b/authorization/apk-identity.json'", "'docs/validacion-fase1a4b/r3/authorization/apk-identity.json'"],
  ["'C:/sf-1a4b-20261102/android/app/build/outputs/apk/release/app-release.apk'", "'C:/sf-1a4b-r3-20261107/android/app/build/outputs/apk/release/app-release.apk'"],
  ["'C:/sf-1a4b-20261102/source-fingerprints.json'", "'C:/sf-1a4b-r3-20261107/source-fingerprints.json'"],
], 'scripts/phase1a4b/r3/run-android-r3.ps1', ['sf-1a4b-20261102', "'docs/validacion-fase1a4b/android", '"docs/validacion-fase1a4b/android']);
derive('scripts/phase1a4b/run-all.ps1', sha(fs.readFileSync(path.join(root, 'scripts/phase1a4b/run-all.ps1'))) === RUN_ALL_R1() ? RUN_ALL_R1() : 'mismatch', [
  ['./scripts/phase1a4b/run-android.ps1 -Serial $Serial -Campaign $campaign -Output "docs/validacion-fase1a4b/android/api$Api/$campaign"',
    './scripts/phase1a4b/r3/run-android-r3.ps1 -Serial $Serial -Campaign $campaign -Output "docs/validacion-fase1a4b/r3/android/api$Api/$campaign"'],
], 'scripts/phase1a4b/r3/run-all-r3.ps1', ['scripts/phase1a4b/run-android.ps1', '"docs/validacion-fase1a4b/android']);
function RUN_ALL_R1() { return '489165671dc52b4c4172b2e3dd904a08996a32f6fef98c1eeac07f13ae5f7a9e'; }
console.log('1a.4B r3 runners written; no Android operation performed.');
