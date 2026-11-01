'use strict';
// PROPOSED, NOT INSTALLED. Owner review required before copying to .claude/hooks/.
// Exact, audited stage A of 6B.3.1 (proposal r2): the synthetic harness refresh and the offline
// release build, and nothing else. No adb, install, device, runner or Android campaign is admitted.
// The hook cannot see the internal writes of these two commands: they are admitted only through the
// pinned bytes of the refresher, its inputs, the prepared workspace and the Gradle wrapper.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
// Withdraw the authorization by setting this to false.
const ENABLED=true;
const home='C:/Users/nesto';
const repo=home+'/Proyectos/SmartFin';
const workspace='C:/sf-6b3-20261101';
const pins=Object.freeze({
  repo,
  workspace,
  refresh:{command:'node scripts/phase6b3/refresh-harness.cjs',cwd:repo},
  build:{command:"./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'",cwd:workspace+'/android'},
  node:['C:/Program Files/nodejs/node.exe','b3094d0b49f9ad602262a9921551737bb97637c05dd357a06ae98188d7290aa3'],
  packageId:'com.smartfin.snapshot5b2.tests',
  // Refresher and the two test files it copies (clock fix included in probes.ts).
  refresher:{
    'scripts/phase6b3/refresh-harness.cjs':'2596c4ea33d19aa632f2acbf84f872c3f03e1596b0b9a03e21aacfe2b8cfa3f4',
    'scripts/phase6b3/androidHarness.js':'b9dbdee746d2b9b6784ab00a551083e9d745b526bc1069674aeb3e8c6655ee5e',
    'scripts/phase6b3/probes.ts':'2d43bb02917abbbf80392b6507b81708b108db9ab1a307fabc312f475e7c5e6b',
  },
  // Attestation of attempt 02, before the refresh: the refresh is admitted once.
  attestationBeforeRefresh:'ff4932a2dec36fbd9bf5b7755ca4f8f3586b7cd565c51f55ead5e71301e116cb',
  // Production sources changed by 6B.3; the attestation must keep exactly these bytes.
  production:{
    'src/modules/creditCards/ui/CreditCardsScreen.tsx':'1622da55cea2a30d846b58bad9349993a4ca03a90b1a04115251c743d30e0e2d',
    'src/modules/creditCards/ui/components/CreditCardPayment.tsx':'e42b5f72aa840038d88c20fb23893ff83f634a7889853f3c3e4f453ed0fbfa5c',
    'src/modules/creditCards/useCases/creditCardTransactionRelations.ts':'03c0bc28023b2a8812b1086e54c8fefded36f1783aac85d5245e654f19444101',
    'src/modules/transactions/ui/components/CategorizationModal.tsx':'54d6a75fd2d55decf589950e3f875daa5e38237d5d020afe52e51c98531d9efe',
    'src/modules/transactions/ui/components/TransactionCard.tsx':'165ea64f09917dc427dec04f1242dc919d5862c9465d4e42b6974363a9ed11a5',
    'src/modules/transactions/ui/transactionsScreenFormatters.ts':'d7e797a0bd6e4385779d548e81bc724b9683cbd1bba1ccbd0ccf08547245e54f',
    'src/shared/utils/copAmountInput.ts':'444d47fa70214d4d996fe9c2cb56aee517815f9d53b90cc701ec81e613c61932',
    'src/shared/utils/formatCurrency.ts':'2a7ea3e45a12e40cd6df461ceacb63df1c6bd2fc966e748cd429ca2ff1358d9a',
  },
  gradle:{
    'android/gradlew.bat':'982f1b2979dd2d13505c11e92192ab43eef338242ca61587f86f8d7fbc86f67b',
    'android/gradle/wrapper/gradle-wrapper.jar':'b3a875ddc1f044746e1b1a55f645584505f4a10438c1afea9f15e92a7c42ec13',
    'android/gradle/wrapper/gradle-wrapper.properties':'5d974da23c1e708448f6abe5ccbb719a2fa8bfd5bd5351eaa41678875df5c0e4',
    'android/gradle.properties':'4366bcea1376d53e77c6b23dfd0b6dd7d7c1ab3402d123c9b27f2d520a9429c1',
    'android/build.gradle':'b38f1f1c4d96939fb6320ac08a1405e7c2d632b4e2e7bfd5ac4b6c895f9613f5',
    'android/settings.gradle':'15aa041c7f280adc3dad8e60472c36f49c277b62fa44bd0d1ff9368d3440e879',
    'android/app/build.gradle':'eda672bd8a9e725113ecc53a4daa6a9220761b504ba1e64cf0363c1e84f7686e',
  },
  // A user init script or property file could inject tasks into the build.
  gradleUserFiles:[home+'/.gradle/init.d',home+'/.gradle/init.gradle',home+'/.gradle/init.gradle.kts',home+'/.gradle/gradle.properties'],
  // Same profile list as the 6B.2 runner pin.
  profiles:[
    home+'/Documents/PowerShell',home+'/Documents/WindowsPowerShell',
    home+'/OneDrive/Documents/PowerShell',home+'/OneDrive/Documents/WindowsPowerShell',
    'C:/Program Files/PowerShell/7/profile.ps1','C:/Program Files/PowerShell/7/Microsoft.PowerShell_profile.ps1',
    'C:/Windows/System32/WindowsPowerShell/v1.0/profile.ps1','C:/Windows/System32/WindowsPowerShell/v1.0/Microsoft.PowerShell_profile.ps1',
  ],
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
function resolvePath(name,env,io){
  for(const entry of (env.PATH||env.Path||'').split(path.delimiter)){
    const dir=entry.replace(/^"|"$/g,'');
    if(!dir)continue;
    if(['.ps1','.cmd','.bat','.com'].some(ext=>io.existsSync(path.resolve(dir,name+ext))))return '';
    if(io.existsSync(path.resolve(dir,name+'.exe')))return path.resolve(dir,name+'.exe');
  }
  return '';
}
function readRecord(io,p){
  const file=path.join(p.workspace,'source-fingerprints.json');
  if(!noLinks(file,io))throw Error('linked attestation');
  return {bytes:io.readFileSync(file),record:JSON.parse(io.readFileSync(file,'utf8'))};
}
function common(check,io,env,p){
  check('profiles',()=>p.profiles.every(file=>!io.existsSync(file)));
  check('environment',()=>!env.NODE_OPTIONS);
  check('tool node',()=>pinned(io,p.node[0],p.node[1]));
  check('PATH node',()=>normalize(resolvePath('node',env,io))===normalize(p.node[0]));
  for(const [file,digest] of Object.entries(p.refresher))check('source '+file,()=>pinned(io,path.join(p.repo,file),digest));
  for(const [file,digest] of Object.entries(p.production))check('production '+file,()=>pinned(io,path.join(p.repo,file),digest));
}
function inspectRefresh({io=fs,env=process.env,p=pins}={}){
  const failures=[];
  const check=(label,test)=>{try{if(!test())failures.push(label);}catch{failures.push(label);}};
  common(check,io,env,p);
  check('attestation before refresh',()=>sha(io,path.join(p.workspace,'source-fingerprints.json'))===p.attestationBeforeRefresh);
  check('workspace identity',()=>{
    const {record}=readRecord(io,p);
    return record.packageId===p.packageId&&normalize(record.workspace)===normalize(p.workspace)&&
      Object.entries(p.production).every(([name,digest])=>record.originalHashes[name]===digest);
  });
  return failures;
}
function inspectBuild({io=fs,env=process.env,p=pins}={}){
  const failures=[];
  const check=(label,test)=>{try{if(!test())failures.push(label);}catch{failures.push(label);}};
  common(check,io,env,p);
  check('environment gradle',()=>!['GRADLE_OPTS','JAVA_TOOL_OPTIONS','_JAVA_OPTIONS','JDK_JAVA_OPTIONS','GRADLE_USER_HOME']
    .some(key=>env[key])&&!Object.keys(env).some(key=>/^ORG_GRADLE_/i.test(key)));
  check('gradle user files',()=>p.gradleUserFiles.every(file=>!io.existsSync(file)));
  for(const [file,digest] of Object.entries(p.gradle))check('gradle '+file,()=>pinned(io,path.join(p.workspace,file),digest));
  // Never build the pre-fix harness: the refreshed attestation must carry the clock fix.
  check('attestation refreshed',()=>{
    const {bytes,record}=readRecord(io,p);
    if(crypto.createHash('sha256').update(bytes).digest('hex')===p.attestationBeforeRefresh)return false;
    if(record.packageId!==p.packageId||normalize(record.workspace)!==normalize(p.workspace))return false;
    if(!Object.entries(p.refresher).filter(([name])=>name!=='scripts/phase6b3/refresh-harness.cjs')
      .every(([name,digest])=>record.originalHashes[name]===digest))return false;
    if(!Object.entries(p.production).every(([name,digest])=>record.originalHashes[name]===digest))return false;
    const embedded=io.readFileSync(path.join(p.workspace,'android/app/src/main/assets/phase5b2-source-fingerprints.json'));
    return embedded.equals(bytes)&&
      Object.entries(record.originalHashes).every(([name,digest])=>!name.includes('..')&&sha(io,path.join(p.repo,name))===digest)&&
      Object.entries(record.hashes).every(([name,digest])=>!name.includes('..')&&sha(io,path.join(p.workspace,name))===digest);
  });
  return failures;
}
function checkStageA(source,tool,cwd,{enabled=ENABLED,verifyRefresh=()=>inspectRefresh().length===0,verifyBuild=()=>inspectBuild().length===0}={}){
  const deny=reason=>({decision:'deny',reason:'DG-CLAUDE-6B3A: '+reason});
  const command=typeof source==='string'?source.trim():'';
  const target=command===pins.refresh.command?pins.refresh:command===pins.build.command?pins.build:null;
  if(!target)return null; // Not a stage A command: the rest of the guard decides.
  if(tool!=='PowerShell')return deny('Stage A commands are admitted only as the exact PowerShell call');
  if(!enabled)return deny('The 6B.3.1 stage A authorization is withdrawn');
  if(normalize(cwd)!==normalize(target.cwd))return deny('Stage A command outside its exact working directory');
  try{if((target===pins.refresh?verifyRefresh:verifyBuild)())return {decision:'allow'};}catch{}
  return deny('Refresher, inputs, workspace attestation, Gradle wrapper or environment are not the audited ones');
}
module.exports={checkStageA,inspectRefresh,inspectBuild,pins,ENABLED};
if(require.main===module){
  // Read-only diagnostic: lists failed checks without launching anything.
  console.log(JSON.stringify({enabled:ENABLED,refresh:inspectRefresh(),build:inspectBuild()}));
}
