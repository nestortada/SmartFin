'use strict';
// Narrow, first-boot exception. No process launch, shell evaluation or Android I/O.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const exe='C:/Users/nesto/AppData/Local/Android/Sdk/emulator/emulator.exe';
const name='SmartFin_Guard_Synthetic_API24';
const home='C:/Users/nesto';
const avd=home+'/.android/avd/'+name+'.avd';
const args='-avd '+name+' -no-boot-anim -no-snapshot';
// Exact literal forms only: no generic Start-Process permission is introduced.
const commands=Object.freeze({
  Bash:'"'+exe+'" '+args,
  PowerShell:"Start-Process -FilePath '"+exe+"' -ArgumentList '"+args+"' -WindowStyle Hidden",
});
const receipt=Object.freeze([
  [exe,'dede05844d17902a7c74f2cee2bbe97ec9afaaf22ebc35a7cdc6d7c1eaa0b9dd'],
  [home+'/.android/avd/'+name+'.ini','ee3d8cbce27cce4737e96e73ff001d8c67ff082145a8ee9dc447788deaa3d278'],
  [avd+'/config.ini','998d8ef4e8271031a114f4beb25b05437e981d18ad92b1d8e12ab83af8a912af'],
  // Created by avdmanager from the installed API24 stock image, not copied from an AVD.
  [avd+'/userdata.img','0a7e2895dd1077cb45b89794f182e0e35284f2fae5611bada0e25416b6cadea9'],
]);
function noLinks(target,io){
  for(let current=target;;current=path.dirname(current)){
    const stat=io.lstatSync(current);
    if(stat.isSymbolicLink()||(stat.isFile()&&stat.nlink!==1))return false;
    if(path.dirname(current)===current)break;
  }
  return true;
}
function verifyIsolation(io=fs,env=process.env){
  try{
    if(process.platform!=='win32')return false;
    // Redirected AVD roots could resolve the same AVD name to a different device.
    for(const key of ['ANDROID_AVD_HOME','ANDROID_USER_HOME','ANDROID_EMULATOR_HOME','ANDROID_SDK_HOME'])
      if(env[key])return false;
    const normalize=value=>value.replace(/^\/c\//i,'C:/').replaceAll('\\','/').replace(/\/$/,'').toLowerCase();
    for(const key of ['ANDROID_HOME','ANDROID_SDK_ROOT'])
      if(env[key]&&normalize(env[key])!==normalize(path.dirname(path.dirname(exe))))return false;
    if(normalize(env.USERPROFILE||'')!==normalize(home))return false;
    if(env.HOME&&normalize(env.HOME)!==normalize(home))return false;
    if(!noLinks(avd,io))return false;
    // Fail closed after boot/import/added runtime state; no automatic recertification.
    const files=io.readdirSync(avd).sort();
    if(JSON.stringify(files)!==JSON.stringify(['config.ini','userdata.img']))return false;
    for(const [file,expected] of receipt){
      if(!noLinks(file,io)||!io.lstatSync(file).isFile())return false;
      const actual=crypto.createHash('sha256').update(io.readFileSync(file)).digest('hex');
      if(actual!==expected)return false;
    }
    return true;
  }catch{return false;}
}
function checkLaunch(command,tool,verify=verifyIsolation){
  // ADB serials (emulator-5554) are not Emulator executable tokens.
  if(!/(?:^|[\s'"\/\\])emulator(?:\.exe)?(?=$|[\s'"\/\\])|(?:^|\s)-avd(?:\s|$)/i.test(command))return null;
  try{
    const expected=tool==='Bash'?commands.Bash:commands.PowerShell;
    if(command.trim()!==expected||!verify())throw Error('not verified');
    return {decision:'allow'};
  }catch{return {decision:'deny',reason:'DG-CLAUDE-EMULATOR: Only the exact registered launch of the verified fresh synthetic AVD is allowed'};}
}
module.exports={checkLaunch,commands,verifyIsolation};
