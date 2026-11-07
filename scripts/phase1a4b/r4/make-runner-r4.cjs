'use strict';
// Mechanical, reviewable derivatives of the 1a.4B r3 runners (pinned hashes) for the r4 workspace. Writes files only.
// Only the workspace, the APK identity file, the evidence path and the runner path change: same two devices
// (emulator-5554 API 24, AXCC6R3919012932 API 35), same 32 campaigns in the same order, same isolation checks, same
// pm clear of com.smartfin.snapshot5b2.tests before every non-restart campaign and the same PreserveData rules.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
if (process.argv.length !== 2) throw Error('No arguments');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function derive(source, pinned, replacements, destination) {
  const bytes = fs.readFileSync(path.join(root, source));
  if (sha(bytes) !== pinned) throw Error('Baseline changed: ' + source);
  let text = bytes.toString();
  for (const [from, to, count] of replacements) {
    const found = text.split(from).length - 1;
    if (found !== count) throw Error(`Anchor found ${found} times (expected ${count}) in ${source}: ${from}`);
    text = text.split(from).join(to);
  }
  if (/sf-1a4b-r3-|validacion-fase1a4b\/r3\/|run-android-r3|r3 synthetic/.test(text)) throw Error('r3 path left in ' + destination);
  const target = path.join(root, destination);
  if (fs.existsSync(target)) throw Error(destination + ' already written; review and delete it explicitly before regenerating');
  fs.writeFileSync(target, text);
}
derive('scripts/phase1a4b/r3/run-android-r3.ps1', '9773f5a18860435e98b3122fe924e32a97930c6cfdc2eaa50ba3da9bbe6e88d4', [
  ['# 1a.4B r3 runner (derived by scripts/phase1a4b/r3/make-runner-r3.cjs from the 1a.4B r1 runner)',
    '# 1a.4B r4 runner (derived by scripts/phase1a4b/r4/make-runner-r4.cjs from the 1a.4B r3 runner)', 1],
  ['C:/sf-1a4b-r3-20261107', 'C:/sf-1a4b-r4-20261107', 4],
  ['docs/validacion-fase1a4b/r3/', 'docs/validacion-fase1a4b/r4/', 3],
  ['Only the 1a.4B r3 synthetic workspace is authorized', 'Only the 1a.4B r4 synthetic workspace is authorized', 1],
], 'scripts/phase1a4b/r4/run-android-r4.ps1');
derive('scripts/phase1a4b/r3/run-all-r3.ps1', 'de8ba053176fc9cf94951ca91a27380843107202523fda2b2606c3bf35b8fcd3', [
  ['./scripts/phase1a4b/r3/run-android-r3.ps1', './scripts/phase1a4b/r4/run-android-r4.ps1', 1],
  ['docs/validacion-fase1a4b/r3/android', 'docs/validacion-fase1a4b/r4/android', 1],
], 'scripts/phase1a4b/r4/run-all-r4.ps1');
console.log('1a.4B r4 runners written; no Android operation performed.');
