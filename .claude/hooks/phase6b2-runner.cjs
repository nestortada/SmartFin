'use strict';
// Exact, audited launch of the 6B.2 runner on the synthetic API24 AVD, and nothing else.
// The hook cannot see the runner's internal ADB calls: they are admitted only through the
// pinned bytes of the runner, its dependencies, the attested harness and the APK.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
// Withdraw the authorization by setting this to false (see docs/dangerous-command-guard-claude.md).
const ENABLED=true;
const command='./scripts/phase6b2/run-all.ps1 -Serial emulator-5554 -Api 24';
const home='C:/Users/nesto';
const sdk=home+'/AppData/Local/Android/Sdk';
const avdName='SmartFin_Guard_Synthetic_API24';
const pins=Object.freeze({
  repo:home+'/Proyectos/SmartFin',
  harness:'C:/sf-6b2r-20261030',
  sdk,
  serial:'emulator-5554',
  packageId:'com.smartfin.snapshot5b2.tests',
  runner:{
    'scripts/phase6b2/run-all.ps1':'f83b4099ad5e47d5de1e9874a8c87d28f6ca7e5fa4ad4bd11ca6dfe9a7a3e23c',
    // First-install fix: a missing test package no longer aborts at `pm path`.
    'scripts/phase6b2/run-android.ps1':'3004dd0d94bb7e706ffbefac901e854f16173ac2901f8ecadc31c88ba2fc40a0',
    'scripts/phase6b2/ui.cjs':'fd0e918fa1ea15727a6744f469b7c39d76fc776a33b942dbabeb0eef914e6423',
  },
  fingerprints:'df3e620bc751c36bb8f0c8fa51dd6061ddd87fd4c5555752f7cf8a62a5ae3388',
  // Same APK as the API35 6B.2 evidence; it embeds exactly the fingerprints above (audited).
  apk:['android/app/build/outputs/apk/release/app-release.apk','85af989be11c7a79c81e3b38c06905b4064f52648d5170f6a6ab1022ad0e42f6'],
  tools:{
    adb:[sdk+'/platform-tools/adb.exe','b4a6b455702684652cccf7b46258b29e653538904359a58fd4931cf3ef286b3f'],
    node:['C:/Program Files/nodejs/node.exe','b3094d0b49f9ad602262a9921551737bb97637c05dd357a06ae98188d7290aa3'],
    aapt:[sdk+'/build-tools/36.0.0/aapt.exe','c528418af0c5152650d9532485f371e8eed98e1436d1ab1a197580b97917b561'],
  },
  avd:{
    name:avdName,
    files:[
      [home+'/.android/avd/'+avdName+'.ini','ee3d8cbce27cce4737e96e73ff001d8c67ff082145a8ee9dc447788deaa3d278'],
      [home+'/.android/avd/'+avdName+'.avd/config.ini','998d8ef4e8271031a114f4beb25b05437e981d18ad92b1d8e12ab83af8a912af'],
    ],
    props:{
      'ro.kernel.qemu':'1',
      'ro.kernel.qemu.avd_name':avdName,
      'ro.build.version.sdk':'24',
      'ro.product.name':'sdk_google_phone_x86_64',
      'ro.build.fingerprint':'Android/sdk_google_phone_x86_64/generic_x86_64:7.0/NYC/6696031:userdebug/dev-keys',
    },
  },
  output:'docs/correccion-fase6b2/android/api24',
  // A profile could redefine adb/node or Get-FileHash before the runner starts.
  profiles:[
    home+'/Documents/PowerShell',home+'/Documents/WindowsPowerShell',
    home+'/OneDrive/Documents/PowerShell',home+'/OneDrive/Documents/WindowsPowerShell',
    'C:/Program Files/PowerShell/7/profile.ps1','C:/Program Files/PowerShell/7/Microsoft.PowerShell_profile.ps1',
    'C:/Windows/System32/WindowsPowerShell/v1.0/profile.ps1','C:/Windows/System32/WindowsPowerShell/v1.0/Microsoft.PowerShell_profile.ps1',
  ],
  // Node's execFileSync('adb') searches the cwd and system folders before PATH.
  shadows:['C:/Windows/System32','C:/Windows'],
});
const normalize=value=>String(value).replace(/^\/c\//i,'C:/').replaceAll('\\','/').replace(/\/$/,'').toLowerCase();
const sha=(io,file)=>crypto.createHash('sha256').update(io.readFileSync(file)).digest('hex');
function noLinks(target,io){
  for(let current=path.resolve(target);;current=path.dirname(current)){
    const stat=io.lstatSync(current);
    if(stat.isSymbolicLink()||(stat.isFile()&&stat.nlink!==1))return false;
    if(path.dirname(current)===current)break;
  }
  return true;
}
function pinned(io,file,expected){return noLinks(file,io)&&io.lstatSync(file).isFile()&&sha(io,file)===expected;}
// PowerShell (and Node) would run a .ps1/.cmd/.bat shim found earlier in PATH.
function resolvePath(name,env,io){
  for(const entry of (env.PATH||env.Path||'').split(path.delimiter)){
    const dir=entry.replace(/^"|"$/g,'');
    if(!dir)continue;
    if(['.ps1','.cmd','.bat','.com'].some(ext=>io.existsSync(path.resolve(dir,name+ext))))return '';
    if(io.existsSync(path.resolve(dir,name+'.exe')))return path.resolve(dir,name+'.exe');
  }
  return '';
}
const allowedOutput=/^(?:(?:probes|ui-[A-Za-z]+|volume-\d+|regression-[a-z0-9-]+)(?:-attempt-\d{6})?|ui|compare\.json)$/;
function outputSafe(p,io){
  const target=path.join(p.repo,p.output);
  if(!noLinks(path.dirname(target),io))return false;
  if(!io.existsSync(target))return true;
  if(!noLinks(target,io)||!io.lstatSync(target).isDirectory())return false;
  const walk=dir=>io.readdirSync(dir).every(entry=>{
    const stat=io.lstatSync(path.join(dir,entry));
    if(stat.isSymbolicLink()||(stat.isFile()&&stat.nlink!==1))return false;
    return stat.isDirectory()?walk(path.join(dir,entry)):stat.isFile();
  });
  return io.readdirSync(target).every(entry=>allowedOutput.test(entry))&&walk(target);
}
function identity(p,device){
  const props={};
  for(const match of String(device.props).matchAll(/^\[([^\]]+)\]: \[([^\]]*)\]\r?$/gm))props[match[1]]=match[2];
  const listed=String(device.devices).split(/\r?\n/).filter(line=>line.split(/\s+/)[0]===p.serial);
  const reply=String(device.avdName).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  return listed.length===1&&/^\S+\s+device\s.*\bproduct:sdk_google_phone_x86_64\b/.test(listed[0])&&
    Object.entries(p.avd.props).every(([key,value])=>props[key]===value)&&
    // The console name comes from the emulator process, not from the guest image.
    reply.length===2&&reply[0]===p.avd.name&&reply[1]==='OK';
}
// Read-only queries with the pinned executable; failures and timeouts deny.
function queryDevice(p){
  const run=args=>execFileSync(p.tools.adb[0],args,{encoding:'utf8',timeout:2000,windowsHide:true,shell:false});
  return {
    devices:run(['devices','-l']),
    props:run(['-s',p.serial,'shell','getprop']),
    avdName:run(['-s',p.serial,'emu','avd','name']),
  };
}
function inspect({io=fs,env=process.env,cwd=process.cwd(),query=queryDevice,p=pins,platform=process.platform}={}){
  const failures=[];
  const check=(label,test)=>{try{if(!test())failures.push(label);}catch{failures.push(label);}};
  check('platform',()=>platform==='win32');
  check('cwd',()=>normalize(cwd)===normalize(p.repo));
  check('environment',()=>{
    for(const key of ['ADB_SERVER_SOCKET','ANDROID_ADB_SERVER_PORT','ANDROID_ADB_SERVER_ADDRESS','ANDROID_SERIAL',
      'ANDROID_AVD_HOME','ANDROID_USER_HOME','ANDROID_EMULATOR_HOME','ANDROID_SDK_HOME','NODE_OPTIONS'])if(env[key])return false;
    if(normalize(env.ANDROID_HOME||'')!==normalize(p.sdk))return false;
    return !env.ANDROID_SDK_ROOT||normalize(env.ANDROID_SDK_ROOT)===normalize(p.sdk);
  });
  check('profiles',()=>p.profiles.every(file=>!io.existsSync(file)));
  for(const [tool,[file,digest]] of Object.entries(p.tools))check('tool '+tool,()=>pinned(io,file,digest));
  for(const tool of ['adb','node'])check('PATH '+tool,()=>normalize(resolvePath(tool,env,io))===normalize(p.tools[tool][0]));
  check('adb shadows',()=>[p.repo,path.dirname(p.tools.node[0]),...p.shadows].every(dir=>!['adb.exe','adb'].some(f=>io.existsSync(path.join(dir,f)))));
  for(const [file,digest] of Object.entries(p.runner))check('runner '+file,()=>pinned(io,path.join(p.repo,file),digest));
  check('attestation',()=>{
    const file=path.join(p.harness,'source-fingerprints.json');
    if(!noLinks(p.harness,io)||!pinned(io,file,p.fingerprints))return false;
    const record=JSON.parse(io.readFileSync(file,'utf8'));
    if(record.packageId!==p.packageId||normalize(record.workspace)!==normalize(p.harness))return false;
    // Same checks as the runner, done before launch so a modified source never starts it.
    return Object.entries(record.originalHashes).every(([name,digest])=>!name.includes('..')&&sha(io,path.join(p.repo,name))===digest)&&
      Object.entries(record.hashes).every(([name,digest])=>!name.includes('..')&&sha(io,path.join(p.harness,name))===digest);
  });
  check('apk',()=>pinned(io,path.join(p.harness,p.apk[0]),p.apk[1]));
  for(const [file,digest] of p.avd.files)check('avd '+path.basename(file),()=>pinned(io,file,digest));
  check('output',()=>outputSafe(p,io));
  if(!failures.length)check('device identity',()=>identity(p,query(p)));
  return failures;
}
const runnerScript=/\.ps1\b|(?:^|[\\/\s'"])ui\.cjs\b/i;
// Commands that only read a file name; anything else that names a runner is a launch.
const readers=new Set(['git','get-content','gc','cat','type','select-string','sls','rg','grep','get-filehash','test-path',
  'get-item','gi','get-childitem','gci','ls','dir','head','tail','wc','echo','write-output','printf']);
function checkRunner(source,tool,cwd,core,translateBash,verify=()=>inspect({cwd}).length===0,enabled=ENABLED){
  const deny=reason=>({decision:'deny',reason:'DG-CLAUDE-RUNNER: '+reason});
  if(source.trim()===command&&tool!=='Bash'){
    if(!enabled)return deny('The 6B.2 API24 runner authorization is withdrawn');
    try{if(verify())return {decision:'allow'};}catch{}
    return deny('Runner, dependencies, attestation, APK, outputs or AVD identity are not the audited ones');
  }
  if(!runnerScript.test(source))return null;
  try{
    const parsed=core.parsePowerShell(tool==='Bash'?translateBash(source):source);
    const names=parsed.commands.map(item=>String(item.name||'').replaceAll('\\','/').split('/').at(-1).toLowerCase());
    if(!parsed.opaque&&names.length&&names.every(name=>readers.has(name)))return null;
  }catch{}
  return deny('Only the exact audited 6B.2 API24 runner launch is allowed; other runners and scripts need separate review');
}
module.exports={checkRunner,inspect,identity,command,pins,ENABLED};
if(require.main===module){
  // Read-only diagnostic: lists failed checks without launching anything.
  const failures=inspect();
  console.log(JSON.stringify({enabled:ENABLED,command,authorized:ENABLED&&!failures.length,failures}));
}
