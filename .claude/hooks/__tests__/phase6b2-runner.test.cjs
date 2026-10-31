'use strict';
// Runner strings are only evaluated as data, and the device is simulated. This suite never
// starts the runner, runs adb, installs APKs or touches Android.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const crypto=require('node:crypto');
const core=require('../../../.codex/hooks/dangerous-command-guard.cjs');
const {evaluate,bashToPowerShell}=require('../dangerous-command-guard.cjs');
const {checkRunner,inspect,identity,command,pins}=require('../phase6b2-runner.cjs');
const root=path.resolve(__dirname,'../../..');
const event=(source,tool_name='PowerShell')=>({hook_event_name:'PreToolUse',cwd:root,tool_name,tool_input:{command:source}});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sf-runner-guard-'));
after(()=>fs.rmSync(temp,{recursive:true,force:true}));
let serial=0;
// A fresh copy of the audited layout with its own pins; each test may tamper with it.
function fixture(){
  const base=path.join(temp,String(serial++));
  const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);return sha(Buffer.from(value));};
  const repo=path.join(base,'repo'),harness=path.join(base,'harness'),sdk=path.join(base,'sdk');
  const runner={};
  for(const file of Object.keys(pins.runner))runner[file]=write(path.join(repo,file),'audited '+file);
  const record={packageId:pins.packageId,workspace:harness.replaceAll('\\','/'),
    originalHashes:{'src/modules/accounts/balance.ts':write(path.join(repo,'src/modules/accounts/balance.ts'),'export {}')},
    hashes:{'Harness.jsx':write(path.join(harness,'Harness.jsx'),'harness')},adaptations:{}};
  const fingerprints=write(path.join(harness,'source-fingerprints.json'),JSON.stringify(record));
  const p={...pins,repo,harness,sdk,runner,fingerprints,
    apk:[pins.apk[0],write(path.join(harness,pins.apk[0]),'synthetic apk')],
    tools:{adb:[path.join(sdk,'platform-tools/adb.exe'),write(path.join(sdk,'platform-tools/adb.exe'),'adb')],
      node:[path.join(base,'nodejs/node.exe'),write(path.join(base,'nodejs/node.exe'),'node')],
      aapt:[path.join(sdk,'build-tools/aapt.exe'),write(path.join(sdk,'build-tools/aapt.exe'),'aapt')]},
    avd:{...pins.avd,files:[[path.join(base,'avd/guard.ini'),write(path.join(base,'avd/guard.ini'),'ini')],
      [path.join(base,'avd/config.ini'),write(path.join(base,'avd/config.ini'),'config')]]},
    profiles:[path.join(base,'profiles/profile.ps1')],shadows:[path.join(base,'system')]};
  fs.mkdirSync(path.join(repo,'docs/correccion-fase6b2/android'),{recursive:true});
  const env={PATH:[path.dirname(p.tools.adb[0]),path.dirname(p.tools.node[0])].join(path.delimiter),ANDROID_HOME:sdk};
  return {p,env,cwd:repo,base,write,record};
}
const device=(overrides={})=>({
  devices:'List of devices attached\r\nemulator-5554          device product:sdk_google_phone_x86_64 model:Android_SDK_built_for_x86_64 device:generic_x86_64 transport_id:3\r\n',
  props:Object.entries(pins.avd.props).map(([key,value])=>'['+key+']: ['+value+']').join('\r\n'),
  avdName:pins.avd.name+'\r\r\nOK\r\r\n',
  ...overrides,
});
const run=(f,options={})=>inspect({io:fs,env:f.env,cwd:f.cwd,p:f.p,platform:'win32',query:()=>device(),...options});
const decide=failures=>checkRunner(command,'PowerShell',root,core,bashToPowerShell,()=>failures.length===0);

test('exact audited runner launch is authorized',()=>{
  const failures=run(fixture());
  assert.deepEqual(failures,[]);
  assert.equal(decide(failures).decision,'allow');
  assert.equal(command,'./scripts/phase6b2/run-all.ps1 -Serial emulator-5554 -Api 24');
});
for(const file of Object.keys(pins.runner))test('modified runner file is rejected: '+file,()=>{
  const f=fixture();
  fs.appendFileSync(path.join(f.p.repo,file),'\n& adb -s emulator-5554 shell pm clear com.smartfin');
  const failures=run(f);
  assert.ok(failures.includes('runner '+file));
  assert.equal(decide(failures).decision,'deny');
});
test('APK with a different hash is rejected',()=>{
  const f=fixture();
  fs.writeFileSync(path.join(f.p.harness,f.p.apk[0]),'rebuilt apk');
  assert.deepEqual(run(f),['apk']);
});
test('modified attested source, harness file or attestation is rejected',()=>{
  for(const tamper of [
    f=>fs.appendFileSync(path.join(f.p.repo,'src/modules/accounts/balance.ts'),'export const balance=1;'),
    f=>fs.appendFileSync(path.join(f.p.harness,'Harness.jsx'),'changed'),
    f=>fs.rmSync(path.join(f.p.repo,'src/modules/accounts/balance.ts')),
    f=>fs.appendFileSync(path.join(f.p.harness,'source-fingerprints.json'),' '),
  ]){const f=fixture();tamper(f);assert.deepEqual(run(f),['attestation']);}
});
test('attestation for another package or workspace is rejected even with matching pins',()=>{
  for(const change of [{packageId:'com.smartfin'},{workspace:'C:/other'}]){
    const f=fixture();
    const fingerprints=f.write(path.join(f.p.harness,'source-fingerprints.json'),JSON.stringify({...f.record,...change}));
    assert.deepEqual(run({...f,p:{...f.p,fingerprints}}),['attestation']);
  }
});
test('modified tools, PATH shims, profiles, shadows and redirected ADB servers are rejected',()=>{
  const cases=[
    [f=>fs.appendFileSync(f.p.tools.aapt[0],'x'),'tool aapt'],
    [f=>fs.appendFileSync(f.p.tools.adb[0],'x'),'tool adb'],
    [f=>fs.appendFileSync(f.p.tools.node[0],'x'),'tool node'],
    [f=>f.write(path.join(path.dirname(f.p.tools.adb[0]),'adb.cmd'),'shim'),'PATH adb'],
    [f=>{f.env.PATH=path.join(f.base,'other')+path.delimiter+f.env.PATH;f.write(path.join(f.base,'other/node.ps1'),'shim');},'PATH node'],
    [f=>f.write(f.p.profiles[0],'function adb {}'),'profiles'],
    [f=>f.write(path.join(f.p.repo,'adb.exe'),'shadow'),'adb shadows'],
    [f=>f.write(path.join(f.p.shadows[0],'adb.exe'),'shadow'),'adb shadows'],
    [f=>{f.env.ADB_SERVER_SOCKET='tcp:remote:5037';},'environment'],
    [f=>{f.env.ANDROID_SERIAL='AXCC6R3919012932';},'environment'],
    [f=>{f.env.ANDROID_HOME='C:/other-sdk';},'environment'],
    [f=>{f.env.NODE_OPTIONS='--require x';},'environment'],
  ];
  for(const [tamper,label] of cases){const f=fixture();tamper(f);assert.deepEqual(run(f),[label],label);}
});
test('wrong serial, AVD, API or image identity is rejected',()=>{
  const prop=(key,value)=>device().props.replace('['+key+']: ['+pins.avd.props[key]+']','['+key+']: ['+value+']');
  for(const bad of [
    {devices:'List of devices attached\r\nemulator-5556 device product:sdk_google_phone_x86_64\r\n'},
    {devices:'List of devices attached\r\nemulator-5554 offline product:sdk_google_phone_x86_64\r\n'},
    {devices:'List of devices attached\r\nemulator-5554 device product:CRT-NX3 model:CRT_NX3\r\n'},
    {props:prop('ro.kernel.qemu.avd_name','SmartFin_Atomicity_API24')},
    {props:prop('ro.build.version.sdk','35')},
    {props:prop('ro.kernel.qemu','0')},
    {props:prop('ro.build.fingerprint','HONOR/CRT-NX3/HNCRT-M2:15/user/release-keys')},
    {avdName:'SmartFin_Atomicity_API24\r\nOK\r\n'},
    {avdName:'KO: unknown command\r\n'},
  ])assert.equal(identity(pins,device(bad)),false,JSON.stringify(bad));
  assert.equal(identity(pins,device()),true);
  assert.deepEqual(run(fixture(),{query:()=>device({avdName:'other\r\nOK'})}),['device identity']);
  assert.deepEqual(run(fixture(),{query:()=>{throw Error('adb timeout');}}),['device identity']);
  const f=fixture();fs.appendFileSync(f.p.avd.files[1][0],'hw.ramSize=8192');
  assert.deepEqual(run(f),['avd config.ini']);
});
test('device is not queried while any local check fails',()=>{
  const f=fixture();fs.appendFileSync(path.join(f.p.harness,f.p.apk[0]),'x');
  let queried=false;
  run(f,{query:()=>{queried=true;return device();}});
  assert.equal(queried,false);
});
test('wrong cwd or platform is rejected',()=>{
  assert.deepEqual(run(fixture(),{cwd:os.tmpdir()}),['cwd']);
  assert.deepEqual(run(fixture(),{platform:'linux'}),['platform']);
});
test('output folder must be absent or hold only runner evidence without links',()=>{
  const f=fixture();
  const out=path.join(f.p.repo,f.p.output);
  for(const name of ['probes','probes-attempt-101112','ui-debtAggregate','volume-100000','regression-6b1-probes'])
    f.write(path.join(out,name,'result.json'),'{}');
  f.write(path.join(out,'ui/debtAggregate.xml'),'<hierarchy/>');
  assert.deepEqual(run(f),[]);
  f.write(path.join(out,'smartfin.db'),'');
  assert.deepEqual(run(f),['output']);
  const g=fixture();
  const linked=Object.create(fs);
  linked.lstatSync=file=>path.resolve(file)===path.resolve(g.p.repo,'docs')?{isSymbolicLink:()=>true}:fs.lstatSync(file);
  assert.deepEqual(run(g,{io:linked}),['output']);
});
test('verifier failure, exception or withdrawn authorization denies the exact command',()=>{
  assert.equal(checkRunner(command,'PowerShell',root,core,bashToPowerShell,()=>false).decision,'deny');
  assert.equal(checkRunner(command,'PowerShell',root,core,bashToPowerShell,()=>{throw Error('private');}).decision,'deny');
  const withdrawn=checkRunner(command,'PowerShell',root,core,bashToPowerShell,()=>true,false);
  assert.equal(withdrawn.decision,'deny');
  assert.match(withdrawn.reason,/withdrawn/);
});
for(const [source,tool] of [
  [command,'Bash'],
  [command+' -Only probes'],[command+' -Harness C:/other'],[command+' -Api 24'],
  [command.replace('emulator-5554','emulator-5556')],[command.replace('emulator-5554','AXCC6R3919012932')],
  [command.replace('-Api 24','-Api 35')],[command.replace(' -Api 24','')],
  ['./scripts/phase6b2/run-all.ps1'],['./scripts/phase6b2/run-all.ps1 -Api 24'],
  ['.\\scripts\\phase6b2\\run-all.ps1 -Serial emulator-5554 -Api 24'],
  ['& '+command],['. '+command],[command+'; Write-Output done'],[command+' | Out-Null'],
  [command+'; adb -s emulator-5554 shell pm clear com.smartfin'],
  ['pwsh -NoProfile -File scripts/phase6b2/run-all.ps1 -Serial emulator-5554 -Api 24'],
  ['pwsh -File scripts/phase6b2/run-all.ps1','Bash'],
  ["Start-Process pwsh -ArgumentList '-File scripts/phase6b2/run-all.ps1'"],
  ['./scripts/phase6b2/run-android.ps1 -Campaign phase6b2-probes'],
  ['./scripts/phase6b1/run-all.ps1 -Serial emulator-5554 -Api 24'],
  ['./scripts/phase6b2/run-all.ps1 -Serial AXCC6R3919012932 -Api 35'],
  ['./scripts/sharedCommands/restoreBaseline.ps1'],
  ['node scripts/phase6b2/ui.cjs emulator-5554 24 debtAggregate'],
  ['node scripts/phase6b2/ui.cjs emulator-5554 24 debtAggregate','Bash'],
  ['Invoke-Expression (Get-Content scripts/phase6b2/run-all.ps1 -Raw)'],
])test('deny runner variant '+(tool||'PowerShell')+' '+source,()=>assert.equal(evaluate(event(source,tool)).decision,'deny'));
for(const [source,tool] of [
  ['git diff scripts/phase6b2/run-all.ps1','Bash'],['git status','Bash'],
  ['Get-Content scripts/phase6b2/run-android.ps1'],['Get-FileHash scripts/phase6b2/run-all.ps1'],
  ['cat scripts/phase6b2/ui.cjs','Bash'],
])test('reading runner files still delegates '+source,()=>assert.equal(evaluate(event(source,tool)).decision,'allow'));
for(const source of [
  'adb -s emulator-5554 install C:/sf-6b2r-20261030/android/app/build/outputs/apk/release/app-release.apk',
  'adb -s emulator-5554 shell pm clear com.smartfin.snapshot5b2.tests',
  'adb -s emulator-5554 shell pm clear com.smartfin',
  'adb -s emulator-5554 uninstall com.smartfin',
  'adb -s emulator-5554 shell am force-stop com.smartfin.snapshot5b2.tests',
  'adb -s emulator-5554 shell appops set com.smartfin.snapshot5b2.tests POST_NOTIFICATION allow',
  'adb -s emulator-5554 shell rm -f /sdcard/Android/data/com.smartfin.snapshot5b2.tests/files/snapshot5b2-results/result.json',
  'adb -s emulator-5554 shell rm /data/data/com.smartfin/databases/smartfin.db',
  'adb -s emulator-5554 shell am start -n com.smartfin.snapshot5b2.tests/com.smartfin.MainActivity',
  'adb -s emulator-5554 pull /sdcard/Android/data/com.smartfin.snapshot5b2.tests/files/snapshot5b2-results/result.json',
  'adb -s emulator-5554 shell uiautomator dump /sdcard/x.xml',
  'adb -s emulator-5554 emu kill','adb -s emulator-5554 reboot',
  'adb -s AXCC6R3919012932 shell pm clear com.smartfin.snapshot5b2.tests',
])for(const tool of ['Bash','PowerShell'])test('arbitrary ADB write stays blocked '+tool+' '+source,()=>assert.equal(evaluate(event(source,tool)).decision,'deny'));
test('financial, backup and package protections of the core are unchanged',()=>{
  for(const source of ['git reset --hard','sqlite3 smartfin.db "DELETE FROM accounts;"','rm smartfin.db-wal','rm smartfin-backup.db',
    'Remove-Item -Recurse docs/correccion-fase6b2','Remove-Item C:/sf-6b2r-20261030/android/app/build/outputs/apk/release/app-release.apk'])
    assert.equal(evaluate(event(source,'Bash')).decision,'deny',source);
});
