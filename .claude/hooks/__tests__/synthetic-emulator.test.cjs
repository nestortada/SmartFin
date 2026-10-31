'use strict';
// Launch strings are only evaluated as data. This suite never starts Android.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {evaluate}=require('../dangerous-command-guard.cjs');
const {checkLaunch,commands,verifyIsolation}=require('../synthetic-emulator.cjs');
const root=path.resolve(__dirname,'../../..');
const event=(command,tool_name='Bash')=>({hook_event_name:'PreToolUse',cwd:root,tool_name,tool_input:{command}});
for(const [tool,command] of Object.entries(commands))test('allow fresh synthetic launch '+tool,()=>{
  // The real AVD has booted. Model a fresh identity here, not the live disk.
  assert.equal(checkLaunch(command,tool,()=>true).decision,'allow');
});
for(const command of [
  commands.Bash.replace('SmartFin_Guard_Synthetic_API24','SmartFin_Atomicity_API24'),
  commands.Bash.replace('SmartFin_Guard_Synthetic_API24','unknown'),
  commands.Bash.replace('emulator.exe','other.exe'),
  commands.Bash.replace('C:/Users/nesto/AppData/Local/Android/Sdk/emulator/','C:/untrusted/'),
  commands.Bash+' -wipe-data', commands.Bash+' -snapshot old',
  commands.Bash.replace('-no-snapshot','-no-snapshot-save'),
  commands.Bash+' -data unknown.img',commands.Bash+' -datadir C:/unknown',
  commands.Bash+' -initdata old.img',commands.Bash+' -snapstorage old.img',
  commands.Bash+' -qemu -hda old.img',commands.Bash+' -no-audio',
  commands.Bash+'; git reset --hard',commands.Bash+' && echo extra',
  commands.Bash+' | cat',commands.Bash+' > output.log',
  commands.Bash.replace('C:/Users/nesto/AppData/Local/Android/Sdk','$ANDROID_HOME'),
  commands.PowerShell+'; Write-Output extra',
  commands.PowerShell.replace('-WindowStyle Hidden','-WindowStyle Minimized'),
  "Start-Process cmd -ArgumentList '/c echo hello'",
])test('deny launch variant '+command,()=>assert.equal(evaluate(event(command,command.startsWith('Start-Process')?'PowerShell':'Bash')).decision,'deny'));
test('missing, changed or linked isolation metadata fails closed',()=>{
  for(const verify of [()=>false,()=>{throw Error('private');}])
    assert.equal(checkLaunch(commands.Bash,'Bash',verify).decision,'deny');
  const fresh=Object.create(fs);
  fresh.readdirSync=()=>['config.ini','userdata.img'];
  assert.equal(verifyIsolation(fresh),true);
  assert.equal(verifyIsolation(),false); // live AVD is no longer eligible for first boot
});
test('unrelated commands still delegate to the unmodified core',()=>{
  for(const command of ['git reset --hard','sqlite3 smartfin.db "DELETE FROM accounts;"','adb uninstall com.smartfin','rm smartfin.db-wal','rm smartfin-backup.db'])
    assert.equal(evaluate(event(command)).decision,'deny');
  assert.equal(evaluate(event('git status')).decision,'allow');
});
test('actual verifier rejects simulated links, runtime state, modified bytes and redirected roots',()=>{
  const linked=Object.create(fs);
  linked.lstatSync=()=>({isSymbolicLink:()=>true});
  assert.equal(verifyIsolation(linked),false);
  const booted=Object.create(fs);
  booted.readdirSync=()=>['config.ini','userdata.img','userdata-qemu.img'];
  assert.equal(verifyIsolation(booted),false);
  const changed=Object.create(fs);
  changed.readFileSync=()=>Buffer.from('modified');
  assert.equal(verifyIsolation(changed),false);
  assert.equal(verifyIsolation(fs,{...process.env,ANDROID_AVD_HOME:'C:/unknown'}),false);
  assert.equal(verifyIsolation(fs,{...process.env,ANDROID_SDK_ROOT:'C:/unknown'}),false);
});
