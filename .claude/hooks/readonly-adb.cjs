'use strict';
// Direct, literal read-only ADB calls only. Never connects to a device itself.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const core=require('../../.codex/hooks/dangerous-command-guard.cjs');
const executable='C:/Users/nesto/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const executableHash='b4a6b455702684652cccf7b46258b29e653538904359a58fd4931cf3ef286b3f';
const normalize=value=>value.replaceAll('\\','/').toLowerCase();
const isAdb=name=>typeof name==='string'&&/^adb(?:\.(?:exe|cmd|bat|com|ps1))?$/i.test(name.replaceAll('\\','/').split('/').at(-1));
const deny=()=>({decision:'deny',reason:'DG-CLAUDE-ADB: Only registered literal read-only ADB queries are allowed; device writes and runners require separate verification'});

function verifyExecutable(name){
  let resolved=name;
  if(/^(adb|adb.exe)$/i.test(name)){
    resolved='';
    for(const entry of (process.env.PATH||'').split(path.delimiter)){
      const dir=entry.replace(/^"|"$/g,'');
      if(!dir)continue;
      // Refuse a shim that could shadow the intended SDK executable.
      if(['adb.com','adb.cmd','adb.bat','adb.ps1'].some(file=>fs.existsSync(path.resolve(dir,file))))return false;
      const candidate=path.resolve(dir,'adb.exe');
      if(fs.existsSync(candidate)){resolved=candidate;break;}
    }
  }
  if(!path.isAbsolute(resolved)||normalize(resolved)!==normalize(executable))return false;
  for(let current=resolved;;current=path.dirname(current)){
    const stat=fs.lstatSync(current);
    if(stat.isSymbolicLink()||(stat.isFile()&&stat.nlink!==1))return false;
    if(current===path.dirname(current))break;
  }
  return crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex')===executableHash;
}

function checkReadOnlyAdb(source,tool,translateBash){
  const adbMention=/\badb(?:\.(?:exe|cmd|bat|com|ps1))?\b/i.test(source);
  const serialMention=/\bemulator-\d+\b/i.test(source);
  if(!adbMention&&!serialMention)return null;
  try{
    const parsed=core.parsePowerShell(tool==='Bash'?translateBash(source):source);
    const adbCalls=parsed.commands.filter(item=>isAdb(item.name));
    if(!adbCalls.length){
      // Removing the serial false positive must not newly admit indirect runners.
      const literalMessage=!parsed.opaque&&!parsed.redirects.length&&parsed.commands.length===1&&
        /^(echo|write-output|printf)$/i.test(parsed.commands[0].name)&&
        parsed.commands[0].args.every(arg=>typeof arg==='string');
      const indirect=parsed.commands.some(item=>/^(powershell|pwsh|cmd)(?:\.exe)?$/i.test((item.name||'').replaceAll('\\','/').split('/').at(-1)));
      if((serialMention&&!literalMessage)||(adbMention&&indirect))return deny();
      return null; // Text is not a call, and does not receive an ADB exception.
    }
    if(parsed.opaque||parsed.redirects.length||parsed.commands.length!==1)return deny();
    const {name,args}=adbCalls[0];
    let literal=source.trim();
    if(tool!=='Bash'&&literal.startsWith('& '))literal=literal.slice(2).trimStart();
    // Deliberately reject context changes, expansion, chaining and shell syntax.
    if(!/^[a-z0-9_ .:\/\\\t'"-]+$/i.test(literal)||
        (tool==='Bash'&&literal.includes('\\')))return deny();
    const first=/^(?:'([^']+)'|"([^"]+)"|([^ \t]+))(?:[ \t]+|$)/.exec(literal);
    if(!first||normalize(first[1]??first[2]??first[3])!==normalize(name))return deny();
    if(args.some(arg=>typeof arg!=='string')||!verifyExecutable(name))return deny();
    if(JSON.stringify(args)===JSON.stringify(['devices','-l']))return {decision:'allow'};
    if(args[0]!=='-s'||args[1]!=='emulator-5554')return deny();
    const query=args.slice(2);
    if(query.length===1&&query[0]==='get-state')return {decision:'allow'};
    if(query[0]==='shell'&&query[1]==='getprop'&&
       (query.length===2||(query.length===3&&/^[a-z0-9_][a-z0-9_.-]{0,127}$/i.test(query[2]))))
      return {decision:'allow'};
    // Even a correct serial and an isolated-looking package do not authorize writes.
    return deny();
  }catch{return deny();}
}
module.exports={checkReadOnlyAdb};
