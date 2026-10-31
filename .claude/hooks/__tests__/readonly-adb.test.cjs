'use strict';
// All ADB strings are simulated. This suite never runs adb or starts Android.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const core=require('../../../.codex/hooks/dangerous-command-guard.cjs');
const {evaluate}=require('../dangerous-command-guard.cjs');
const root=path.resolve(__dirname,'../../..');
const event=(command,tool_name='Bash')=>({hook_event_name:'PreToolUse',cwd:root,tool_name,tool_input:{command}});
for(const tool of ['Bash','PowerShell'])for(const command of [
  'adb devices -l','adb -s emulator-5554 get-state',
  'adb -s emulator-5554 shell getprop',
  'adb -s emulator-5554 shell getprop sys.boot_completed',
  'adb -s emulator-5554 shell getprop ro.kernel.qemu.avd_name',
  'adb -s emulator-5554 shell getprop ro.product.emulator',
  '"C:/Users/nesto/AppData/Local/Android/Sdk/platform-tools/adb.exe" -s emulator-5554 get-state',
])test('allow '+tool+' '+command,()=>{
  // A quoted executable in native PowerShell needs its call operator.
  const source=tool==='PowerShell'&&command.startsWith('"')?'& '+command:command;
  assert.equal(evaluate(event(source,tool)).decision,'allow');
});
for(const command of [
  'adb devices -l extra','adb devices -l -H remote',
  'adb -s emulator-9999 get-state','adb -s emulator-9999 shell getprop',
  'adb -s emulator-5554 get-state extra',
  'adb -s emulator-5554 shell getprop sys.boot_completed extra',
  'adb -s emulator-5554 shell getprop "sys.boot_completed; setprop x y"',
  'adb -s emulator-5554 shell setprop sys.boot_completed 1',
  'adb -s emulator-5554 shell pm clear com.smartfin',
  'adb -s emulator-5554 uninstall com.smartfin',
  'adb -s emulator-5554 install test.apk',
  'adb -s emulator-5554 shell pm clear com.smartfin.snapshot5b2.tests',
  'adb -s emulator-9999 shell pm clear com.smartfin.snapshot5b2.tests',
  'adb -s emulator-5554 shell rm smartfin.db',
  'adb -s emulator-5554 shell rm /data/data/com.smartfin/databases/smartfin.db-wal',
  'adb -s emulator-5554 emu avd snapshot load old',
  'adb -s emulator-5554 restore backup.ab',
  'adb -s emulator-5554 push data.db /data/local/tmp/data.db',
  'adb -s emulator-5554 pull /data/data/com.smartfin/databases/smartfin.db local.db',
  'adb -s emulator-5554 shell dumpsys battery set level 100',
  'adb devices -l; git reset --hard',
  'echo harmless; adb -s emulator-5554 install test.apk',
  'adb -s emulator-5554 get-state && adb -s emulator-5554 shell pm clear com.smartfin',
  'adb -s emulator-5554 get-state > output.log',
  'C:/unknown/adb.exe -s emulator-5554 get-state',
  'powershell -Command "adb -s emulator-5554 install test.apk"',
  'powershell -Command "adb install test.apk"',
  'pwsh -File scripts/phase6b2/run-android.ps1 -Serial emulator-5554',
  'node scripts/phase6b2/ui.cjs emulator-5554',
  'unknown-runner.exe emulator-5554',
])test('deny '+command,()=>assert.equal(evaluate(event(command)).decision,'deny'));
test('a serial is not an executable or an authorization token',()=>{
  assert.equal(evaluate(event('echo emulator-5554')).decision,'allow');
  assert.equal(evaluate(event('"C:/Users/nesto/AppData/Local/Android/Sdk/emulator/emulator.exe" -avd unknown -no-snapshot')).decision,'deny');
});
test('PowerShell dynamic context and chains cannot turn a read into an exception',()=>{
  for(const command of ['$env:ADB_SERVER_SOCKET="tcp:unknown:5037"; adb devices -l',
    'adb -s emulator-5554 get-state; Remove-Item src -Recurse',
    'adb -s $serial shell getprop','adb -s emulator-5554 shell getprop | Out-File .env'])
    assert.equal(evaluate(event(command,'PowerShell')).decision,'deny');
});
test('Codex queries still work and production protection is preserved',()=>{
  for(const command of ['adb devices -l','adb -s emulator-5554 shell getprop sys.boot_completed'])
    assert.equal(core.evaluate(event(command)).decision,'allow');
  assert.equal(core.evaluate(event('adb -s emulator-5554 uninstall com.smartfin')).decision,'deny');
});
