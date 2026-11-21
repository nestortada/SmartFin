'use strict';
// SmartFin PreToolUse guard, version 2 (Claude Code), with control-plane protection (2026-11-16).
// Default-allow with a short deny list. Three outcomes:
//   deny  - irreversible loss of financial data, uncommitted Git work or the production app's data on a device;
//   ask   - risky or impossible to analyse, or a change to the agents' control plane (agent memory, agents, rules,
//           hooks, workflows, skills, settings, CLAUDE.md, AGENTS.md, .codex, .agents): the owner approves that
//           single call in the permission prompt;
//   allow - silent; Claude Code's own permission rules still apply.
// Self-contained: no PowerShell parser process and no per-phase hash pins, so new scripts,
// Gradle tasks and phases do not require editing the guard (only the four hook suites are pinned, see HOOK_SUITES).
// It only sees the tool calls Claude Code sends it: processes started outside the session, MCP tools and other
// applications are out of its reach.
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

// Windows ignores trailing dots and spaces in a name and treats "name:stream" as the same file; \\?\ and \\.\
// prefixes name the same paths. Comparisons use that canonical, lower-case form with forward slashes.
function canonical(value){
  const p=value.replace(/^\/\/[?.]\/unc\//,'//').replace(/^\/\/[?.]\/(?=[a-z]:)/,'');
  return p.split('/').map((seg,i)=>(i===0&&/^[a-z]:$/.test(seg))||seg===''||seg==='.'||seg==='..'?seg:
    seg.replace(/:.*$/,'').replace(/[. ]+$/,'')||seg).join('/');
}
const norm=value=>canonical(value.replaceAll('\\','/').replace(/\/+$/,'').toLowerCase());
const beneath=(candidate,parent)=>candidate===parent||candidate.startsWith(parent+'/');
function findRoot(){
  if(process.env.SMARTFIN_ROOT)return path.resolve(process.env.SMARTFIN_ROOT);
  for(let dir=__dirname;;dir=path.dirname(dir)){
    if(fs.existsSync(path.join(dir,'AGENTS.md'))&&fs.existsSync(path.join(dir,'package.json')))return dir;
    if(path.dirname(dir)===dir)return path.resolve(__dirname,'../..');
  }
}
const ROOT=norm(findRoot());
// The main checkout, also when the guard runs from one of its .claude/worktrees/<name>.
const MAIN=ROOT.replace(/\/\.claude\/worktrees\/[^/]+$/,'');
const NESTED=MAIN+'/.claude/worktrees';
const HOME=norm(os.homedir());
const HOME_CLAUDE=HOME+'/.claude';
const TEMP=norm(os.tmpdir());
// Sibling worktrees and audit copies: C:\sf-6b3-20261101, C:\sfphase2, C:\sfatomicity1...
const WORKTREE=/^[a-z]:\/sf[^/]*/;
// Each checkout is its own root: the main one, the C:\sf* copies and every .claude/worktrees/<name> inside any of
// them (also nested).
function rootOf(abs){
  let root=beneath(abs,MAIN)?MAIN:(WORKTREE.exec(abs)?.[0]??null);
  for(let match;root!==null&&abs!==root&&(match=/^\.claude\/worktrees\/[^/]+/.exec(abs.slice(root.length+1)));)root+='/'+match[0];
  return root;
}

const RANK={allow:0,ask:1,deny:2};
const ALLOW=Object.freeze({decision:'allow'});
const ask=reason=>({decision:'ask',reason:'DG2: '+reason});
const deny=reason=>({decision:'deny',reason:'DG2: '+reason});
const worst=results=>results.reduce((a,b)=>RANK[b.decision]>RANK[a.decision]?b:a,ALLOW);
// Scripts and npm scripts are written by the owner: what the guard would deny inside them becomes a question.
const capAsk=(result,what)=>result.decision==='deny'?ask(`${what} contiene una operación que el guard denegaría (${result.reason.replace(/^DG2: /,'')})`):result;
class Unsupported extends Error{}
const exists=file=>{try{fs.lstatSync(file);return true;}catch{return false;}};
const isDirectory=file=>{try{return fs.statSync(file).isDirectory();}catch{return false;}};
const commandName=text=>text.replaceAll('\\','/').split('/').at(-1).toLowerCase().replace(/\.(?:exe|cmd|bat|com)$/,'');
const literal=text=>({text,dynamic:false,glob:false});
const quote=word=>word.dynamic?'"$GUARD_ARG"':"'"+word.text.replaceAll("'","'\\''")+"'";

// ---------------------------------------------------------------- paths

const SENSITIVE_NAME=[
  /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/,
  /^\.env(?:\.|$)/,
  /\.(?:keystore|jks|p12|pfx|pem|key)$/,
  /^smartfin-(?:generation-|manifest|deletion-admission|backup|[a-f0-9-]{36}--)/,
  /^(?:movimientos-\d{4}|cuentas|categorias|subcategorias|tarjetas-credito|compras-cuotas|personas|gastos-compartidos|participaciones|reembolsos|abonos-compartidos|devoluciones-anticipos)\.csv$/,
];
const SENSITIVE_DIR=new Set(['smartfin-local-snapshots','smartfin-backup-jobs']);
const sensitiveName=name=>SENSITIVE_NAME.some(rule=>rule.test(name))||SENSITIVE_DIR.has(name);
// Copies under the system temp directory are disposable test material.
const sensitive=loc=>!loc.temp&&loc.abs.split('/').some(sensitiveName);
const globSensitive=pattern=>['','x','0000'].some(fill=>sensitiveName(pattern.toLowerCase().replace(/\[[^\]]*\]|[*?]/g,fill)));
// Never inspected for sensitive descendants: build output and caches.
const GENERATED=new Set(['node_modules','build','dist','coverage','.gradle','.cxx','pods','deriveddata','tmp','.expo','.metro-cache','out','.jest-cache']);
const CRITICAL=new Set(['','.git','src','__tests__','android','ios','.claude','.codex','.agents']);
const DISCARD=new Set(['/dev/null','nul','$null','/dev/stdout','/dev/stderr']);
const KNOWN_VARS=/^\$(?:env:)?(temp|tmp|tmpdir|home|userprofile|localappdata)\b|^\$\{(temp|tmp|tmpdir|home)\}/i;

// Agents' control plane inside a checkout (relative, lower case). CONTROL_DIRS and CONTROL_FILES are the contract
// with docs/dangerous-command-guard-claude.md and .claude/hooks/__tests__/agent-config-policy.test.cjs.
const CONTROL_DIRS=['.claude/agent-memory','.claude/agent-memory-local','.claude/agents','.claude/rules','.claude/workflows',
  '.claude/hooks','.claude/skills','.claude/commands','.codex','.agents'];
const CONTROL_FILES=['agents.md','claude.md','.claude/settings.json','.claude/settings.local.json','.mcp.json'];
// The same kind of configuration at user level (~/.claude and ~/.claude.json, with MCP servers and per-project tools),
// which also steers every session. The automatic memory under ~/.claude/projects is not included: Claude Code writes
// it as part of normal work.
const USER_DIRS=['agent-memory','agents','rules','hooks','skills','commands','plugins','workflows'];
const USER_FILES=['settings.json','settings.local.json','claude.md'];
const controlPath=rel=>CONTROL_FILES.includes(rel)||CONTROL_DIRS.some(dir=>beneath(rel,dir));

// Variables the command reassigns (HOME=…, export TMPDIR=…, $env:USERPROFILE=…): from then on their value, and ~ for
// HOME, is unknown. Reset for every event.
let REASSIGNED=new Set();
const KNOWN_NAMES=/^(?:temp|tmp|tmpdir|home|userprofile|localappdata)$/i;
// Resolves the few variables whose value is known; anything else stays dynamic (null).
function expand(word){
  if(REASSIGNED.has('home')&&/^~(?:[\\/]|$)/.test(word.text))return null;
  if(!word.dynamic)return word.text;
  const match=KNOWN_VARS.exec(word.text);
  if(!match)return null;
  const rest=word.text.slice(match[0].length);
  if(rest.includes('$'))return null;
  const name=(match[1]??match[2]).toLowerCase();
  if(REASSIGNED.has(name))return null;
  const value=name==='home'||name==='userprofile'?os.homedir():
    name==='localappdata'?(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData/Local')):os.tmpdir();
  return value+rest;
}

function locate(text,ctx){
  let value=text.replace(/^(?:microsoft\.powershell\.core\\)?filesystem::/i,'');
  if(/^\/tmp(?=\/|$)/.test(value))value=os.tmpdir()+value.slice(4); // Git Bash /tmp
  else if(/^\/cygdrive\/[a-z](?:\/|$)/i.test(value))value=value[10]+':/'+value.slice(12);
  else if(/^\/[a-z](?:\/|$)/i.test(value))value=value[1]+':/'+value.slice(3); // Git Bash /c/...
  if(value==='~'||/^~[\\/]/.test(value))value=os.homedir()+value.slice(1);
  const real=path.resolve(ctx.cwd,value),abs=norm(real);
  const root=rootOf(abs);
  return {real,abs,root,rel:root===null?null:abs.slice(root.length+1),temp:beneath(abs,TEMP)};
}
const relative=text=>!path.isAbsolute(text)&&!/^[a-z]:/i.test(text)&&!text.startsWith('~');
const unc=loc=>loc.abs.startsWith('//');

// Real location behind symbolic links and junctions: the longest existing prefix is resolved by the system.
function resolved(loc){
  if(loc.resolved===undefined){
    loc.resolved=loc.abs;
    let current=loc.real,suffix='';
    for(let i=0;i<64;i++){
      try{loc.resolved=norm(fs.realpathSync.native(current)+suffix);break;}catch{}
      const parent=path.dirname(current);
      if(parent===current)break;
      suffix='/'+path.basename(current)+suffix;current=parent;
    }
  }
  return loc.resolved;
}

function critical(loc){
  if(loc.root===ROOT&&CRITICAL.has(loc.rel))return true;
  if(loc.root&&loc.root!==ROOT&&loc.rel!==''&&CRITICAL.has(loc.rel))return true;
  const a=loc.abs;
  return /^[a-z]:$/.test(a)||ROOT.startsWith(a+'/')||a===HOME||HOME.startsWith(a+'/')||
    /^[a-z]:\/(?:windows|program files(?: \(x86\))?|programdata)(?:\/|$)/.test(a);
}
// The agents' control plane (owner-reviewed content) and, separately, Git internals.
function controlAbs(abs){
  const root=rootOf(abs);
  if(root!==null&&controlPath(abs.slice(root.length+1)))return true;
  if(abs===HOME+'/.claude.json')return true;
  if(abs.startsWith(HOME_CLAUDE+'/')){
    const rel=abs.slice(HOME_CLAUDE.length+1);
    return USER_FILES.includes(rel)||USER_DIRS.some(dir=>beneath(rel,dir));
  }
  return false;
}
const gitAbs=abs=>{const root=rootOf(abs);return root!==null&&beneath(abs.slice(root.length+1),'.git');};
const protectedAbs=abs=>controlAbs(abs)||gitAbs(abs);
// Control plane and Git internals: changes are approved by the owner. Checked on the written path and on the real
// path behind links, so a link outside the control plane does not hide a write inside it.
const guarded=loc=>protectedAbs(loc.abs)||protectedAbs(resolved(loc));
// A folder that contains protected paths: a checkout root, its .claude folder, the folder of nested worktrees,
// ~/.claude or any of their parents. Replacing, moving or deleting it as a whole reaches the control plane.
const holdsAbs=abs=>{
  const root=rootOf(abs);
  return (root!==null&&[root,root+'/.claude',root+'/.claude/worktrees'].includes(abs))||beneath(NESTED,abs)||beneath(HOME_CLAUDE,abs);
};
const holdsGuarded=loc=>holdsAbs(loc.abs)||holdsAbs(resolved(loc));
const controlAsk=loc=>ask(`modifica el plano de control de los agentes o el repositorio Git (${loc.abs}): requiere la aprobación del propietario`);
const financialSource=rel=>beneath(rel,'src/database')||beneath(rel,'src/modules/security')||
  /(?:sqlitefinancialdatarepository|smartfin(?:security|localsnapshot|backuppublisher|financialdeletion))\./.test(rel);

// Every protected path as segments (string, null = any name, RegExp = matching name), relative to a folder.
function protectedTargets(dir){
  const entries=[...CONTROL_FILES,...CONTROL_DIRS,'.git'].map(e=>e.split('/'));
  const anchors=[];
  for(const root of new Set([MAIN,ROOT,dir.root].filter(Boolean)))for(const e of entries){
    anchors.push([...root.split('/'),...e]);
    anchors.push([...root.split('/'),'.claude','worktrees',null,...e]);
  }
  for(const e of entries)anchors.push([/^[a-z]:$/,/^sf/,...e]);
  for(const e of [...USER_FILES,...USER_DIRS])anchors.push([...HOME_CLAUDE.split('/'),...e.split('/')]);
  const base=dir.abs.split('/');
  const same=(a,s)=>a===null||(a instanceof RegExp?a.test(s):a===s);
  return anchors.filter(a=>a.length>base.length&&base.every((s,i)=>same(a[i],s))).map(a=>a.slice(base.length));
}
function globRegex(part){
  return new RegExp('^'+part.replace(/[.+^${}()|\\]/g,'\\$&').replace(/\[!/g,'[^').replace(/\*/g,'[^/]*').replace(/\?/g,'[^/]')+'$','i');
}
function segmentsMatch(pattern,target){
  for(let i=0;i<Math.min(pattern.length,target.length);i++){
    if(pattern[i]==='**')return true;
    if(typeof target[i]!=='string')continue;
    try{if(!globRegex(pattern[i]).test(target[i]))return false;}catch{return true;}
  }
  return true;
}
// Could a glob name a protected path, or one of the folders that contain it?
function globGuarded(text,ctx){
  const parts=text.replaceAll('\\','/').split('/');
  const index=parts.findIndex(part=>/[*?[]/.test(part));
  if(index<0)return guarded(locate(text,ctx));
  const dir=locate(parts.slice(0,index).join('/')||'.',ctx);
  if(guarded(dir))return true;
  const pattern=parts.slice(index).filter(Boolean);
  return protectedTargets(dir).some(target=>segmentsMatch(pattern,target));
}

function containsSensitive(directory){
  if(!isDirectory(directory))return 'no';
  const stack=[directory];let count=0;
  while(stack.length){
    const current=stack.pop();
    let entries;
    try{entries=fs.readdirSync(current,{withFileTypes:true});}catch{return 'unknown';}
    for(const entry of entries){
      if(++count>20000)return 'unknown';
      if(sensitiveName(entry.name.toLowerCase()))return 'yes';
      if(entry.isDirectory()&&!entry.isSymbolicLink())stack.push(path.join(current,entry.name));
    }
  }
  return 'no';
}

// ---------------------------------------------------------------- lexer

function matching(src,start){
  let depth=0;
  for(let i=start;i<src.length;i++){
    const c=src[i];
    if(c==="'"){const stop=src.indexOf("'",i+1);if(stop<0)return -1;i=stop;continue;}
    if(c==='"'){for(i++;i<src.length&&src[i]!=='"';i++)if(src[i]==='\\'||src[i]==='`')i++;continue;}
    if(c==='(')depth++;
    else if(c===')'&&--depth===0)return i;
  }
  return -1;
}

// Splits Bash, PowerShell or CMD text into simple commands. It does not emulate the shells:
// pipes, parentheses and braces all become command boundaries, substitutions are inspected
// as nested commands, and any word built from a variable or substitution is marked dynamic.
// Each Bash segment records the ( … ) subshells it runs in (scope), so a cd inside one does not leak out.
function lex(src,shell){
  const bash=shell==='bash',cmd=shell==='cmd',esc=bash?'\\':cmd?'^':'`';
  const segments=[],heredocs=[],scopes=[];
  let seg,word=null,redirect=null,nextScope=0;
  const fresh=()=>{seg={words:[],redirects:[],stdin:null,subs:[],call:false,scope:[]};};
  fresh();
  const open=()=>word??(word={text:'',dynamic:false,glob:false});
  const close=()=>{
    if(!word)return;
    if(redirect==='<<<')seg.stdin=word.text;
    else if(redirect)seg.redirects.push({op:redirect,target:word});
    else seg.words.push(word);
    word=null;redirect=null;
  };
  const end=()=>{
    close();
    if(redirect){seg.redirects.push({op:redirect,target:null});redirect=null;}
    if(seg.words.length||seg.redirects.length||seg.subs.length||seg.stdin!==null||heredocs.some(doc=>doc.seg===seg)){
      seg.scope=scopes.slice();segments.push(seg);
    }
    fresh();
  };
  const substitution=(start,from)=>{
    const stop=matching(src,start);
    if(stop<0)throw new Unsupported('sustitución sin cerrar');
    seg.subs.push(src.slice(from,stop));
    const w=open();w.dynamic=true;w.text+='$(…)';
    return stop;
  };
  for(let i=0;i<src.length;i++){
    const c=src[i];
    if(c==='\n'){
      end();
      for(const doc of heredocs.splice(0)){
        const lines=[];
        for(let j=i+1;;){
          const nl=src.indexOf('\n',j),stop=nl<0?src.length:nl;
          const line=src.slice(j,stop).replace(/\r$/,'');
          if((doc.strip?line.replace(/^\t+/,''):line)===doc.delim){i=stop;break;}
          lines.push(line);
          if(nl<0)throw new Unsupported('heredoc sin cierre');
          j=nl+1;
        }
        doc.seg.stdin=lines.join('\n');
      }
      continue;
    }
    if(c==="'"&&!cmd){
      const stop=src.indexOf("'",i+1);
      if(stop<0)throw new Unsupported('comilla simple sin cerrar');
      open().text+=src.slice(i+1,stop);i=stop;continue;
    }
    if(c==='@'&&shell==='powershell'&&(src[i+1]==="'"||src[i+1]==='"')&&/^\r?\n/.test(src.slice(i+2,i+4))){
      const quoteChar=src[i+1],stop=src.indexOf('\n'+quoteChar+'@',i+2);
      if(stop<0)throw new Unsupported('here-string sin cerrar');
      const body=src.slice(i+2,stop).replace(/^\r?\n/,'').replace(/\r$/,'');
      const w=open();w.text+=body;
      if(quoteChar==='"'&&/\$[\w{(]/.test(body))w.dynamic=true;
      i=stop+2;continue;
    }
    if(c==='"'){
      const w=open();
      for(i++;;i++){
        if(i>=src.length)throw new Unsupported('comilla doble sin cerrar');
        const d=src[i];
        if(d==='"'){if(shell==='powershell'&&src[i+1]==='"'){w.text+='"';i++;continue;}break;}
        if(d===esc&&!cmd&&i+1<src.length&&(!bash||'$`"\\\n'.includes(src[i+1]))){w.text+=src[++i];continue;}
        if(d==='$'&&!cmd&&src[i+1]==='('){i=substitution(i+1,i+2);continue;}
        if(bash&&d==='`'){
          const stop=src.indexOf('`',i+1);
          if(stop<0)throw new Unsupported('sustitución sin cerrar');
          seg.subs.push(src.slice(i+1,stop));w.dynamic=true;w.text+='$(…)';i=stop;continue;
        }
        if((d==='$'&&!cmd&&/[\w{?:]/.test(src[i+1]??''))||(cmd&&d==='%'))w.dynamic=true;
        w.text+=d;
      }
      continue;
    }
    if(c===esc){
      if(src[i+1]==='\n'){i++;continue;}
      if(src[i+1]==='\r'&&src[i+2]==='\n'){i+=2;continue;}
      if(i+1<src.length)open().text+=src[++i];
      continue;
    }
    // PowerShell a,b is a list: the word before a comma is marked so a -Path a,b keeps every element.
    if(shell==='powershell'&&c===','){const w=word;close();if(w&&seg.words.at(-1)===w)w.comma=true;continue;}
    if(c===' '||c==='\t'||c==='\r'){close();continue;}
    if(c==='#'&&!word&&!cmd){const nl=src.indexOf('\n',i);i=(nl<0?src.length:nl)-1;continue;}
    if(c==='<'&&shell==='powershell'&&src[i+1]==='#'){
      const stop=src.indexOf('#>',i+2);
      if(stop<0)throw new Unsupported('comentario sin cerrar');
      i=stop+1;continue;
    }
    if(c==='>'||(bash&&c==='&'&&src[i+1]==='>')){
      // A bare file-descriptor number (2>) or * (PowerShell *>) belongs to the operator.
      if(word&&!redirect&&/^[\d*]$/.test(word.text)&&!word.dynamic)word=null;else close();
      if(c==='&')i++;
      let op='>';
      if(src[i+1]==='>'){op='>>';i++;}
      if(src[i+1]==='&'){
        i++;
        // 2>&1, >&2, >&- duplicate or close a descriptor; in Bash >&word writes to the file word (>word 2>&1).
        if(!bash||/[\d-]/.test(src[i+1]??'')){while(/[\d-]/.test(src[i+1]??''))i++;continue;}
        redirect=op;continue;
      }
      if(src[i+1]==='|')i++;
      redirect=op;continue;
    }
    if(c==='<'){
      close();
      if(bash&&src.startsWith('<<<',i)){i+=2;redirect='<<<';continue;}
      if(bash&&src[i+1]==='<'){
        i+=2;let strip=false;
        if(src[i]==='-'){strip=true;i++;}
        while(src[i]===' '||src[i]==='\t')i++;
        let delim='';
        for(;i<src.length&&!/[\s;&|<>()]/.test(src[i]);i++)if(!`'"\\`.includes(src[i]))delim+=src[i];
        i--;
        if(!delim)throw new Unsupported('heredoc sin delimitador');
        heredocs.push({delim,strip,seg});continue;
      }
      if(bash&&src[i+1]==='('){
        const stop=matching(src,i+1);
        if(stop<0)throw new Unsupported('sustitución sin cerrar');
        seg.subs.push(src.slice(i+2,stop));i=stop;continue;
      }
      redirect='<';continue;
    }
    if(c==='$'&&!cmd){
      if(src[i+1]==='('){i=substitution(i+1,i+2);continue;}
      const w=open();w.dynamic=true;
      if(src[i+1]==='{'){
        const stop=src.indexOf('}',i+2);
        if(stop<0)throw new Unsupported('variable sin cerrar');
        w.text+=src.slice(i,stop+1);i=stop;continue;
      }
      w.text+=c;continue;
    }
    if(bash&&c==='`'){
      const stop=src.indexOf('`',i+1);
      if(stop<0)throw new Unsupported('sustitución sin cerrar');
      seg.subs.push(src.slice(i+1,stop));
      const w=open();w.dynamic=true;w.text+='$(…)';i=stop;continue;
    }
    // Bash brace expansion (CLAUDE{,}.md, x{1..3}) and find's {} placeholder belong to the word; a group
    // { cmd; } always has a blank after the brace. An expansion yields names the guard does not compute: dynamic.
    if(bash&&c==='{'&&i+1<src.length&&(src[i+1]==='}'||!/[\s;&|<>()]/.test(src[i+1]))){
      let depth=0,j=i;
      for(;j<src.length;j++){
        if(src[j]==='{')depth++;
        else if(src[j]==='}'){if(--depth===0)break;}
        else if(/[\s;&|<>]/.test(src[j]))break;
      }
      if(src[j]==='}'&&depth===0){
        const w=open();w.text+=src.slice(i,j+1);
        if(/,|\.\./.test(src.slice(i+1,j)))w.dynamic=true;
        i=j;continue;
      }
    }
    if(';|&(){}'.includes(c)){
      if(c==='&'&&shell==='powershell'&&!word&&!seg.words.length&&src[i+1]!=='&'){seg.call=true;continue;}
      end();
      if(bash&&c==='(')scopes.push(++nextScope);
      else if(bash&&c===')'&&scopes.length)scopes.pop();
      if((c==='&'||c==='|')&&src[i+1]===c)i++;
      continue;
    }
    if(cmd&&c==='%')open().dynamic=true;
    if('*?['.includes(c))open().glob=true;
    open().text+=c;
  }
  end();
  if(heredocs.length)throw new Unsupported('heredoc sin cierre');
  return segments;
}

// ---------------------------------------------------------------- shell commands

const SHELLS={bash:'bash',sh:'bash',zsh:'bash',dash:'bash',pwsh:'powershell',powershell:'powershell',cmd:'cmd'};
const WRAPPERS=new Set(['sudo','nohup','time','command','builtin','exec','nice','stdbuf','env','npx','winpty','call']);
// Wrapper options that take a value (the value is not the wrapped program).
const WRAPPER_VALUES={sudo:/^-[ugChpRrT]$|^--(?:user|group|host|prompt|role|type|other-user|close-from|command-timeout)$/,
  env:/^-u$|^--unset$/,nice:/^-n$|^--adjustment$/,stdbuf:/^-[ioe]$/,time:/^-f$|^--format$/,npx:/^-p$|^--package$/};
const DELETERS=new Set(['rm','rmdir','unlink','shred','remove-item','ri','del','erase','rd','clear-content','clc','rimraf','trash']);
const WRITERS=new Set(['tee','tee-object','set-content','add-content','ac','out-file','new-item','ni','cp','copy','copy-item','cpi',
  'mv','move','move-item','mi','ren','rename','rename-item','rni','sed','truncate','dd','touch','mkdir','md','export-csv','epcsv',
  'export-clixml','install']);
// Other programs that write files: links, attributes, downloads, archives, copy tools, patches.
const FILE_TOOLS=new Set(['ln','mklink','chmod','chown','chgrp','attrib','curl','wget','invoke-webrequest','iwr','invoke-restmethod','irm',
  'start-bitstransfer','tar','unzip','7z','7za','expand-archive','compress-archive','rsync','robocopy','xcopy','patch','sort','awk',
  'gawk','mawk','nawk']);
const INTERPRETERS=new Set(['node','python','python3','py','ruby','perl','deno','bun','php','lua','tsx','ts-node']);
const SYSTEM_DENY=new Set(['format','format-volume','diskpart','clear-disk','initialize-disk','remove-partition','mkfs',
  'shutdown','stop-computer','restart-computer']);
// subst, New-PSDrive, mount and fsutil create aliases (drives, links) that hide the real path of a later write.
const SYSTEM_ASK=new Set(['set-executionpolicy','reg','bcdedit','netsh','takeown','icacls','cacls','set-mppreference',
  'add-mppreference','schtasks','vssadmin','setx','wsl','subst','new-psdrive','ndr','mount','fsutil','junction',
  'set-alias','sal','new-alias','nal']);
const REGISTRY_CMDLETS=new Set(['set-itemproperty','sp','new-itemproperty','remove-itemproperty','rp','rename-itemproperty']);
const CD=['cd','chdir','set-location','sl','pushd','push-location','popd','pop-location'];
const DOTNET_WRITE=/\]::\s*(?:Delete|Move|Replace|Copy|Create\w*|OpenWrite|WriteAll\w*|AppendAll\w*|AppendText|SetAttributes|Encrypt|Decrypt)\s*\(|\.(?:Delete|MoveTo|CopyTo|Replace|WriteAll\w*|AppendAll\w*|SetLength|Create(?:Text|Subdirectory)?|OpenWrite|AppendText)\s*\(|\b(?:IO\.)?(?:StreamWriter|FileStream|BinaryWriter)\b/i;

function evaluateShell(src,shell,ctx){
  if(ctx.depth>6)return ask('demasiados niveles de shells anidados');
  const segments=lex(src,shell),results=[],stack=[];
  if(shell==='powershell'){
    if(DOTNET_WRITE.test(src))results.push(ask('llamada .NET que modifica archivos'));
    // &( … ) / .( … ) call a command whose name is computed; ]::"Name"( calls a method by a string.
    if(/(?:^|[\s;|{(])[&.]\s*\(/.test(src)||/\]::\s*["'(]/.test(src))results.push(ask('llamada a un comando o método calculado en PowerShell'));
    if(/\.\s*(?:IsReadOnly|Attributes|LastWriteTime\w*|CreationTime\w*)\s*=/i.test(src))results.push(ask('cambia atributos de un archivo desde PowerShell'));
    // Instance methods are judged by the same names as ForEach-Object members: a call ($_.Delete(), $_.'Delete'(),
    // $_.set_IsReadOnly($true), $_.Terminate.Invoke()) whose name modifies asks. A name that cannot be read ($_.$m(),
    // $_.('x')(), ….Methods['x'].Invoke()), % ( … ) and .ForEach( … ) with anything but a script block or a plain
    // literal ask as well.
    for(const m of src.matchAll(/\.\s*(["']?)([A-Za-z_]\w*)\1\s*(?:\(|\.\s*Invoke\s*\()/g))
      if(m[2].toLowerCase()!=='foreach'&&MODIFYING_MEMBER.test(m[2])){results.push(ask(`llamada al método ${m[2]}, que puede modificar archivos`));break;}
    if(/\.\s*(?:\$[\w:]+|\([^)]*\))\s*(?:\(|\.\s*Invoke\b)|\]\s*\.\s*Invoke\s*\(/.test(src))
      results.push(ask('llamada a un método de nombre calculado en PowerShell'));
    if(/(?:\||^|;)\s*(?:%|foreach-object)\s[^|;\n{}]*\(|\|\s*foreach\s[^|;\n{}]*\(/im.test(src))
      results.push(ask('ForEach-Object con un miembro o argumento calculado entre paréntesis'));
    for(const m of src.matchAll(/\.\s*ForEach\s*\(\s*([^)]*)/gi)){
      const arg=m[1],literal=/^(["'])([^"'\n]*)\1\s*$/.exec(arg);
      if(!arg.startsWith('{')&&(!literal||MODIFYING_MEMBER.test(literal[2]))){
        results.push(ask(`.ForEach con ${literal?`el método ${literal[2]}`:'un argumento calculado'}`));break;
      }
    }
  }
  for(const seg of segments){
    // Leaving a ( … ) subshell restores the directory it started in.
    let k=0;
    while(k<stack.length&&k<seg.scope.length&&stack[k].id===seg.scope[k])k++;
    while(stack.length>k){const saved=stack.pop();ctx.cwd=saved.cwd;ctx.unknownCwd=saved.unknownCwd;ctx.dirs=saved.dirs;}
    while(stack.length<seg.scope.length)stack.push({id:seg.scope[stack.length],cwd:ctx.cwd,unknownCwd:ctx.unknownCwd,dirs:ctx.dirs});
    const inner={...ctx,depth:ctx.depth+1};
    for(const sub of seg.subs)results.push(evaluateShell(sub,shell,inner));
    for(const r of seg.redirects)if(r.op==='>'||r.op==='>>')results.push(writeTarget(r.target,ctx));
    results.push(commandRule(seg,shell,ctx));
  }
  return worst(results);
}

const BASH_KEYWORDS=new Set(['do','then','else','elif','if','while','until','!','{']);
function commandRule(seg,shell,ctx){
  let words=seg.words;const pre=[];
  const assigned=text=>{
    const m=/^(?:\$?env:)?([A-Za-z_]\w*)=?(.*)$/i.exec(text);
    if(!m)return;
    if(KNOWN_NAMES.test(m[1]))REASSIGNED.add(m[1].toLowerCase());
    // NODE_OPTIONS can preload code or redirect output for every node process of the command.
    if(/^NODE_OPTIONS$/i.test(m[1])&&/--(?:require|import|loader|experimental-loader|redirect-warnings|test-reporter|test-global-setup|experimental(?:-default)?-config-file|env-file)|(?:^|\s)-r\b/.test(m[2]))
      pre.push(ask('NODE_OPTIONS precarga código o redirige la salida de node: el guard no lo analiza'));
    // Variables that Git and other tools run as a command (GIT_PAGER='tee x' git log): the value is a command.
    if(/^(?:GIT_(?:PAGER|EDITOR|SEQUENCE_EDITOR|SSH_COMMAND|SSH|EXTERNAL_DIFF|ASKPASS|PROXY_COMMAND)|PAGER|EDITOR|VISUAL|LESSOPEN|SSH_ASKPASS)$/i.test(m[1])&&m[2])
      pre.push(evaluateShell(m[2],'bash',{...ctx,depth:ctx.depth+1}));
    // Git configuration from the environment (GIT_CONFIG_KEY_0=core.pager…) or another exec path.
    if(/^GIT_(?:CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS|GLOBAL|SYSTEM)|EXEC_PATH)$/i.test(m[1]))
      pre.push(ask(`${m[1]} cambia la configuración o los programas de Git desde el entorno`));
    // rg reads options from this file, --pre among them.
    if(/^RIPGREP_CONFIG_PATH$/i.test(m[1]))pre.push(ask('RIPGREP_CONFIG_PATH hace que rg lea opciones (como --pre) de un archivo que el guard no analiza'));
  };
  for(;;){
    if(!words.length)return worst(pre);
    const head=words[0];
    if(shell==='bash'&&/^[A-Za-z_]\w*=/.test(head.text)){assigned(head.text);words=words.slice(1);continue;}
    // Reserved words (for f in …; do cmd; done, if …; then cmd; fi): the command follows them. The list of for/select
    // and the word of case are values, not a command; their $(…) are analysed as substitutions.
    if(shell==='bash'&&BASH_KEYWORDS.has(head.text)){words=words.slice(1);continue;}
    if(shell==='bash'&&['for','select','case'].includes(head.text))return worst(pre);
    if(shell==='bash'&&['export','declare','typeset','local','readonly'].includes(head.text)){
      for(const w of words.slice(1))if(/^[A-Za-z_]\w*=/.test(w.text))assigned(w.text);
      return worst(pre);
    }
    if(shell==='cmd'&&head.text.toLowerCase()==='set'&&words[1]){assigned(words[1].text);return worst(pre);}
    // PowerShell assignment: $x = <command>
    if(shell==='powershell'&&/^\$[\w:]+$/.test(head.text)&&/^[-+*/]?=$/.test(words[1]?.text??'')){
      if(/^\$env:/i.test(head.text))assigned(head.text.slice(1)+'='+(words[2]?.text??''));
      words=words.slice(2);continue;
    }
    // Without blanks ($env:X='v') the assignment is a single word.
    if(shell==='powershell'&&/^\$[\w:]+[-+*/]?=/.test(head.text)){
      if(/^\$env:/i.test(head.text))assigned(head.text.slice(1).replace(/[-+*/]=/,'='));
      words=words.slice(1);continue;
    }
    const name=commandName(head.text);
    if(WRAPPERS.has(name)){
      words=words.slice(1);
      while(words.length){
        const t=words[0].text;
        if(name==='env'&&/^[A-Za-z_]\w*=/.test(t)){words=words.slice(1);continue;}
        if(!t.startsWith('-'))break;
        if(name==='env'&&(t==='-C'||t==='--chdir'||t.startsWith('--chdir='))){
          const dir=t.startsWith('--chdir=')?{...words[0],text:t.slice(8)}:words[1];
          const value=dir?expand(dir):null;
          ctx=value===null?{...ctx,unknownCwd:true}:{...ctx,cwd:locate(value,ctx).real};
          words=words.slice(t.includes('=')?1:2);continue;
        }
        if(name==='env'&&(t==='-S'||t==='--split-string'||t.startsWith('--split-string='))){
          const text=t.startsWith('--split-string=')?{...words[0],text:t.slice(15)}:words[1];
          if(!text)return worst(pre);
          if(text.dynamic)return ask('env -S con contenido dinámico');
          const rest=words.slice(t.includes('=')?1:2).map(quote).join(' ');
          return worst([...pre,evaluateShell(text.text+' '+rest,'bash',{...ctx,depth:ctx.depth+1})]);
        }
        if(name==='npx'&&(t==='-c'||t==='--call')){
          const text=words[1];
          if(!text)return worst(pre);
          return worst([...pre,text.dynamic?ask('npx -c con contenido dinámico'):evaluateShell(text.text,'bash',{...ctx,depth:ctx.depth+1})]);
        }
        if(name==='time'&&(t==='-o'||t==='--output')&&words[1]){pre.push(writeTarget(words[1],ctx));words=words.slice(2);continue;}
        words=words.slice(WRAPPER_VALUES[name]?.test(t)?2:1);
      }
      continue;
    }
    if(name==='timeout'&&shell==='bash'){
      words=words.slice(1);
      // -s/--signal and -k/--kill-after take a value: it is not the duration.
      while(words.length&&words[0].text.startsWith('-'))words=words.slice(/^-[sk]$|^--(?:signal|kill-after)$/.test(words[0].text)?2:1);
      words=words.slice(1);continue;
    }
    break;
  }
  return worst([...pre,programRule(words[0],words.slice(1),seg,shell,ctx)]);
}

function programRule(head,args,seg,shell,ctx){
  if(head.dynamic){
    // A PowerShell expression such as $list.Count is not a program launch unless called with &.
    if(shell==='powershell'&&!seg.call)return ALLOW;
    return ask(`programa dinámico: ${head.text}`);
  }
  const name=commandName(head.text);
  if(CD.includes(name))return cdRule(name,args,shell,ctx);
  if(name==='git')return gitRule(args,seg,ctx);
  if(name==='adb')return adbRule(args,ctx);
  if(name==='sqlite3'||name==='sqlite')return sqliteRule(args,seg,ctx);
  if(/^gradlew?$/.test(name))
    return args.some(w=>/uninstall/i.test(w.text))?ask('una tarea Gradle uninstall* borra la app y sus datos del dispositivo'):ALLOW;
  if(name==='npm')return npmRule(args,ctx);
  if(['jest','eslint','prettier','tsc'].includes(name))return toolRule(name,args,ctx);
  if(DELETERS.has(name))return deleteRule(args,shell,ctx);
  if(WRITERS.has(name))return writeRule(name,args,ctx,shell);
  if(FILE_TOOLS.has(name))return fileToolRule(name,args,seg,ctx,shell);
  if(name==='sc'&&shell==='powershell')return writeRule('set-content',args,ctx,shell);
  if(name==='xargs')return xargsRule(args,shell,ctx);
  if(name==='find')return findRule(args,shell,ctx);
  if(Object.hasOwn(SHELLS,name))return nestedShellRule(name,args,seg,ctx);
  if(['eval','iex','invoke-expression'].includes(name)){
    const code=args.filter(w=>!/^-command$/i.test(w.text));
    // Without a literal argument the code comes from a pipe or from ( … ): it cannot be analysed.
    if(!code.length)return PIPED(name);
    if(code.some(w=>w.dynamic))return ask('eval con contenido dinámico');
    return evaluateShell(code.map(w=>w.text).join(' '),shell,{...ctx,depth:ctx.depth+1});
  }
  if(['start-process','saps','start'].includes(name))return startRule(args,ctx);
  if(name==='source'||name==='.')
    return args[0]?scriptRule(args[0],shell==='powershell'?'powershell':'bash',args.slice(1),ctx):PIPED(name);
  if(INTERPRETERS.has(name))return interpreterRule(name,args,seg,ctx);
  if(SYSTEM_DENY.has(name))return deny(`operación destructiva del sistema (${name})`);
  if(SYSTEM_ASK.has(name))return ask(`cambia configuración del sistema o crea un alias de ruta (${name})`);
  if(REGISTRY_CMDLETS.has(name)){
    if(args.some(w=>/^(?:hk(?:lm|cu|cr|u|cc)|registry):/i.test(w.text)))return ask('modifica el registro de Windows');
    // On files these cmdlets change attributes (IsReadOnly...).
    const {positional,named}=parseArgs(args,shell);
    const target=named['-path']??named['-literalpath']??positional[0];
    return target?writeTarget(target,ctx):ask(`${name} sobre elementos que llegan por la tubería`);
  }
  return directScript(head,args,ctx)??unknownProgram(name,args,ctx);
}

// Programs the guard does not model (gzip, openssl, vim, certutil, npx shx…) may write a path they receive. A literal
// argument (also --opt=value or -oVALUE) that names the control plane asks, except for known readers. A glob asks when
// it could name the control plane; a dynamic value that cannot be resolved ($VAR, $(…)) could be any path and asks,
// except for programs that take no files and PowerShell constants.
const READERS=new Set(['cat','less','more','head','tail','grep','egrep','fgrep','rg','ag','wc','diff','cmp','comm','sha1sum',
  'sha256sum','sha512sum','md5sum','cksum','b2sum','stat','file','ls','dir','echo','printf','test','[','[[','realpath','readlink',
  'dirname','basename','du','type','findstr','fc','od','hexdump','strings','cut','nl','tac','column','jq','pwd','which','where',
  'get-content','gc','select-string','sls','get-item','gi','get-childitem','gci','test-path','resolve-path','rvpa','get-filehash',
  'measure-object','measure','compare-object','compare','get-acl','split-path','join-path','write-output','write','write-host',
  'format-hex','fhx','get-itemproperty','gp','convertfrom-json','select-object','select','where-object','sort-object',
  'format-list','fl','format-table','ft','out-string','out-host','get-location','gl','get-command','gcm','get-help','code']);
const NO_FILE_PROGRAMS=new Set(['sleep','start-sleep','kill','wait','exit','return','shift','seq','expr','true','false']);
const PS_CONSTANTS=/^\$(?:true|false|null|lastexitcode|\?)$/i;
// ForEach-Object -MemberName X (also % X and foreach X) calls method X on every object of the pipe: Delete, MoveTo,
// CopyTo, Open, set_IsReadOnly… change the files (or keys) that arrive there, whose names the guard cannot see.
const FOREACH=new Set(['foreach-object','%','foreach']);
const MODIFYING_MEMBER=/^(?!open(?:read|text)$)(?:delete|remove|move|copy|replace|rename|encrypt|decrypt|open|append|create|set|write|clear|truncate|save|kill|invoke|extract|uninstall|terminate|format|put|stop)/i;
// Parameters of ForEach-Object (and common parameters, with their aliases) that take a value: it is not the member.
const FOREACH_VALUED=['-inputobject','-throttlelimit','-timeoutseconds','-argumentlist','-begin','-process','-end',
  '-remainingscripts','-erroraction','-warningaction','-informationaction','-errorvariable','-warningvariable',
  '-informationvariable','-outvariable','-outbuffer','-pipelinevariable','-progressaction'];
const FOREACH_ALIASES={'-ea':'-erroraction','-wa':'-warningaction','-infa':'-informationaction','-ev':'-errorvariable',
  '-wv':'-warningvariable','-iv':'-informationvariable','-ov':'-outvariable','-ob':'-outbuffer','-pv':'-pipelinevariable',
  '-args':'-argumentlist','-proga':'-progressaction'};
// The member named with -MemberName (in any position) or, without it, the first positional word: ask when it modifies
// or is dynamic, otherwise null so that its arguments get the usual checks.
function foreachMember(name,args){
  let named=null,positional=null;
  for(let i=0;i<args.length;i++){
    const w=args[i],t=w.text;
    if(!t.startsWith('-')||t==='-'){positional??=w;continue;}
    const lower=t.toLowerCase(),colon=lower.indexOf(':');
    const raw=colon<0?lower:lower.slice(0,colon),key=FOREACH_ALIASES[raw]??raw;
    const value=colon<0?null:{...w,text:t.slice(colon+1)};
    if(key.length>=2&&'-membername'.startsWith(key)){named=value??args[++i]??null;continue;}
    if(!value&&key.length>=2&&FOREACH_VALUED.some(p=>p.startsWith(key)))i++;
  }
  const member=named??positional;
  if(!member)return null;
  const text=member.text.replace(/^['"]|['"]$/g,'');
  if(member.dynamic&&!PS_CONSTANTS.test(text))return ask(`${name} invoca un miembro dinámico sobre los objetos de la tubería: ${text}`);
  if(MODIFYING_MEMBER.test(text))return ask(`${name} invoca el método ${text} sobre los objetos de la tubería, que el guard no puede comprobar`);
  return null;
}
function unknownProgram(name,args,ctx){
  if(FOREACH.has(name)){const member=foreachMember(name,args);if(member)return member;}
  // rg --pre and ag --pager run another program on every file (RIPGREP_CONFIG_PATH is checked with the assignments).
  if(name==='rg'&&args.some(w=>/^--pre(?:=|$)/.test(w.text)))
    return ask('rg --pre ejecuta un programa sobre cada archivo: el guard no puede comprobar lo que hace');
  if(name==='ag'&&args.some(w=>/^--pager(?:=|$)/.test(w.text)))
    return ask('ag --pager ejecuta un programa con la salida: el guard no puede comprobar lo que hace');
  if(READERS.has(name))return ALLOW;
  for(const w of args){
    const candidates=[w.text];
    const eq=w.text.indexOf('=');
    if(w.text.startsWith('-')&&eq>0)candidates.push(w.text.slice(eq+1));
    else if(/^-[a-zA-Z]./.test(w.text)&&!w.text.startsWith('--'))candidates.push(w.text.slice(2));
    for(const text of candidates){
      if(!text||/^[a-z]{2,}:/i.test(text)||(text.startsWith('-')&&text===w.text))continue;
      let value=text;
      if(w.dynamic){
        if(NO_FILE_PROGRAMS.has(name)||PS_CONSTANTS.test(text))continue;
        value=expand({text,dynamic:true});
        if(value===null)return ask(`${name} recibe un argumento dinámico que el guard no puede resolver y podría ser una ruta que modifica: ${text}`);
      }
      if(w.glob?globGuarded(value,ctx):guarded(locate(value,ctx)))
        return ask(`${name} recibe una ruta del plano de control y el guard no sabe si la modifica: ${text}`);
    }
  }
  return ALLOW;
}

function cdRule(name,args,shell,ctx){
  const pop=name.startsWith('pop'),push=name==='pushd'||name==='push-location';
  if(pop){
    if(ctx.dirs?.length){ctx.cwd=ctx.dirs[0];ctx.dirs=ctx.dirs.slice(1);}else ctx.unknownCwd=true;
    return ALLOW;
  }
  const target=args.find(w=>!w.text.startsWith('-')&&!(shell==='cmd'&&/^\/[a-z]$/i.test(w.text)));
  // cd - goes back to the previous directory; PowerShell's bare Set-Location does not go home.
  if(args.some(w=>w.text==='-')||(!target&&shell!=='bash')){ctx.unknownCwd=true;return ALLOW;}
  const value=target?expand(target):os.homedir();
  if(push)ctx.dirs=[ctx.cwd,...(ctx.dirs??[])];
  if(value===null)ctx.unknownCwd=true;else ctx.cwd=locate(value,ctx).real;
  return ALLOW;
}

// ---------------------------------------------------------------- files

const recursiveFlag=(text,shell)=>{
  const l=text.toLowerCase();
  if(l==='--recursive'||l==='/s'||l==='-rf'||l==='-fr')return true;
  if(!/^-[a-z]+$/.test(l))return false;
  // PowerShell accepts any prefix of -Recurse; Bash combines short flags (-rf, -Rv).
  return shell==='powershell'?'-recurse'.startsWith(l):l.slice(1).includes('r');
};

function deleteRule(args,shell,ctx){
  const targets=[];let recursive=false,dry=false,endOptions=false;
  for(let i=0;i<args.length;i++){
    const w=args[i];let t=w.text;
    if(!endOptions&&t==='--'){endOptions=true;continue;}
    if(!endOptions&&!w.dynamic&&((t.startsWith('-')&&t.length>1)||/^\/[a-z]$/i.test(t))){
      // PowerShell -Name:value
      const colon=/^(-[a-z]+):(.+)$/i.exec(t);
      if(colon){t=colon[1];if(/^-(?:path|literalpath|lp|pspath)$/i.test(t)){targets.push({...w,text:colon[2]});continue;}}
      if(/^-(?:path|literalpath|lp|pspath)$/i.test(t)){if(args[i+1])targets.push(args[++i]);continue;}
      if(/^-stream$/i.test(t))return ask('borrado de flujos alternativos de archivo');
      if(/^-(?:filter|include|exclude|erroraction|ea|errorvariable|ev|credential|depth)$/i.test(t)){if(!colon)i++;continue;}
      if(/^-(?:whatif|wi)$/i.test(t))dry=true;
      if(recursiveFlag(t,shell))recursive=true;
      continue;
    }
    targets.push(w);
  }
  if(dry)return ALLOW;
  if(!targets.length)return ask('borrado sin destino explícito (llega por la tubería o la entrada)');
  return worst(targets.map(w=>deleteTarget(w,recursive,ctx)));
}

function deleteTarget(word,recursive,ctx){
  if(DISCARD.has(word.text.toLowerCase()))return ALLOW;
  const text=expand(word);
  if(text===null)return ask(`borrado con destino dinámico: ${word.text}`);
  if(/^[a-z]{2,}:/i.test(text)&&!/^filesystem::/i.test(text))return ask(`borrado en un proveedor de PowerShell: ${text}`);
  if(ctx.unknownCwd&&relative(text))return ask('borrado relativo después de cambiar a un directorio desconocido');
  if(word.glob)return globDelete(text,recursive,ctx);
  const loc=locate(text,ctx);
  if(sensitive(loc))return deny('borraría una base de datos, respaldo, exportación o secreto; si de verdad hay que borrarlo, hazlo tú');
  if(critical(loc))return deny(`borraría ${loc.abs} (raíz del repositorio, código fuente, historial Git o carpeta del sistema)`);
  if(loc.root&&loc.root!==ROOT&&loc.rel==='')return ask(`borra el worktree completo ${loc.abs}`);
  if(guarded(loc)||holdsGuarded(loc))return controlAsk(loc);
  if(!loc.root&&!loc.temp)return ask(`borrado fuera de SmartFin y de sus worktrees: ${loc.abs}`);
  if(recursive&&!loc.temp&&!GENERATED.has(path.basename(loc.abs))){
    const found=containsSensitive(loc.real);
    if(found==='yes')return ask(`la carpeta ${loc.abs} contiene bases de datos, respaldos o exportaciones`);
    if(found==='unknown')return ask(`la carpeta ${loc.abs} es demasiado grande para revisarla`);
  }
  return ALLOW;
}

function globDelete(text,recursive,ctx){
  const parts=text.split(/[\\/]/);
  const index=parts.findIndex(part=>/[*?[]/.test(part));
  const dir=locate(parts.slice(0,index).join('/')||'.',ctx);
  if(sensitive(dir)||(!dir.temp&&globSensitive(parts.at(-1))))return deny('el comodín alcanza bases de datos, respaldos o exportaciones');
  const everything=/^(?:\*|\.\*|\*\.\*|\*\*)$/.test(parts.at(-1));
  const top=critical(dir)||(dir.root&&dir.rel==='');
  if(top&&everything&&recursive)return deny(`borrado recursivo de todo el contenido de ${dir.abs}`);
  if(globGuarded(text,ctx))return ask(`el comodín puede alcanzar el plano de control de los agentes: ${text}`);
  if(top){
    if(everything)return ask(`borra todos los archivos de ${dir.abs}`);
    return recursive?ask(`borrado recursivo con comodín dentro de ${dir.abs}`):ALLOW;
  }
  if(!dir.root&&!dir.temp)return ask(`borrado con comodín fuera de SmartFin: ${dir.abs}`);
  if(recursive&&!dir.temp&&!GENERATED.has(path.basename(dir.abs))&&containsSensitive(dir.real)==='yes')
    return ask(`la carpeta ${dir.abs} contiene bases de datos, respaldos o exportaciones`);
  return ALLOW;
}

// A write to one path. With container=true the path is an existing folder that receives files with names checked
// separately, so only the folder itself must not be protected.
function writeTarget(word,ctx,container=false){
  if(!word)return ask('redirección sin destino');
  if(DISCARD.has(word.text.toLowerCase()))return ALLOW;
  const text=expand(word);
  if(text===null)return ask(`escritura con destino dinámico: ${word.text}`);
  if(word.glob)return ask(`escritura con comodines: ${text}`);
  if(ctx.unknownCwd&&relative(text))return ask('escritura relativa después de cambiar a un directorio desconocido');
  if(/^[a-z]{2,}:/i.test(text)&&!/^(?:microsoft\.powershell\.core\\)?filesystem::/i.test(text))
    return /^(?:hk\w+|registry|cert):/i.test(text)?ask(`escribe en ${text}`):ALLOW;
  const loc=locate(text,ctx);
  if(unc(loc))return ask(`escritura en una ruta UNC: ${text}`);
  // Creating a new database or export is fine; overwriting an existing one is not.
  if(sensitive(loc)&&exists(loc.real))return deny('sobrescribiría una base de datos, respaldo, exportación o secreto existente');
  ctx.written?.add(loc.abs);
  if(guarded(loc)||(!container&&holdsGuarded(loc)))return controlAsk(loc);
  return ALLOW;
}
// The target of a new link: a link to the control plane would let a later write reach it under another name.
function linkTarget(word,ctx){
  const text=expand(word);
  if(text===null)return ask(`enlace hacia un destino dinámico: ${word.text}`);
  const loc=locate(text,ctx);
  return guarded(loc)||holdsGuarded(loc)?ask(`crea un enlace hacia el plano de control de los agentes: ${loc.abs}`):ALLOW;
}

function moveSource(word,ctx){
  const text=expand(word);
  if(text===null)return ask(`mueve un origen dinámico: ${word.text}`);
  if(word.glob){
    if(globSensitive(text.split(/[\\/]/).at(-1)))return deny('movería bases de datos, respaldos o exportaciones');
    return globGuarded(text,ctx)?ask(`mueve con comodín archivos que pueden ser del plano de control: ${text}`):ALLOW;
  }
  const loc=locate(text,ctx);
  if(unc(loc))return ask(`mueve una ruta UNC: ${text}`);
  if(sensitive(loc)&&exists(loc.real))return deny('movería una base de datos, respaldo, exportación o secreto');
  if(critical(loc))return deny(`movería ${loc.abs}`);
  if(guarded(loc)||holdsGuarded(loc))return controlAsk(loc);
  return ALLOW;
}

const VALUE_OPTIONS=new Set(['-path','-literalpath','-lp','-pspath','-destination','-filepath','-name','-newname','-value',
  '-encoding','-itemtype','-type','-filter','-include','-exclude','-inputobject','-width','-erroraction','-ea','-credential',
  '-variable','-target','-t','--target-directory','-s','--suffix','-delimiter','-outfile','-destinationpath']);
// PowerShell accepts unambiguous prefixes of parameter names (-Pa, -Dest).
const PS_NAMES=['-path','-literalpath','-destination','-destinationpath','-filepath','-value','-encoding','-itemtype','-name',
  '-newname','-target','-inputobject','-outfile'];
// Bash options are case-sensitive: -t DIR takes a value, -T (no target directory) and -s (symlink) do not.
const BASH_VALUE_OPTIONS=new Set(['-t','--target-directory','-S','--suffix']);
function parseArgs(args,shell){
  const positional=[],named={},flags=[],lists={};let endOptions=false;
  for(let i=0;i<args.length;i++){
    const w=args[i],t=w.text;let l=shell==='bash'?t:t.toLowerCase();
    if(!endOptions&&t==='--'){endOptions=true;continue;}
    if(shell==='cmd'&&!w.dynamic&&/^\/[a-z0-9-]+(?::\S*)?$/i.test(t))continue;
    if(!endOptions&&!w.dynamic&&t.length>1&&t.startsWith('-')){
      if(l.startsWith('--')&&l.includes('=')){named[l.slice(0,l.indexOf('=')).toLowerCase()]={...w,text:t.slice(t.indexOf('=')+1)};continue;}
      const colon=shell==='powershell'?/^(-[a-z]+):(.+)$/i.exec(t):null;
      if(colon)l=colon[1].toLowerCase();
      if(shell==='powershell'&&!VALUE_OPTIONS.has(l)&&l.length>=3)l=PS_NAMES.find(n=>n.startsWith(l))??l;
      if(colon){named[l]={...w,text:colon[2]};continue;}
      if((shell==='bash'?BASH_VALUE_OPTIONS:VALUE_OPTIONS).has(l)&&args[i+1]){
        named[l]=args[++i];
        // A PowerShell list (-Path a,b): every element is a value of the option.
        const all=[args[i]];
        while(all.at(-1).comma&&args[i+1])all.push(args[++i]);
        lists[l]=all;
        continue;
      }
      flags.push(l);
      continue;
    }
    positional.push(w);
  }
  return {positional,named,flags,lists};
}

function writeRule(name,args,ctx,shell){
  if(name==='sed')return sedRule(args,ctx);
  if(name==='dd'){
    const output=args.find(w=>w.text.startsWith('of='));
    if(!output)return ALLOW;
    const text=output.text.slice(3);
    if(/^\/dev\/(?!null$)|physicaldrive|^\\\\\.\\/i.test(text))return deny('dd escribiría directamente sobre un dispositivo');
    return writeTarget({...output,text},ctx);
  }
  if(name==='touch'||((name==='mkdir'||name==='md')&&shell!=='powershell')){
    const targets=[];
    for(let i=0;i<args.length;i++){
      const t=args[i].text;
      if(t.startsWith('-')&&t.length>1&&!args[i].dynamic){if(/^-[mrtdA]$|^--(?:mode|reference|date|time)$/.test(t))i++;continue;}
      if(shell==='cmd'&&/^\/[a-z]$/i.test(t))continue;
      targets.push(args[i]);
    }
    return worst(targets.map(w=>writeTarget(w,ctx)));
  }
  if(name==='install')return installRule(args,ctx);
  const {positional,named,flags,lists}=parseArgs(args,shell);
  if(name==='tee')return worst(positional.map(w=>writeTarget(w,ctx)));
  if(name==='truncate')return worst(positional.map(w=>writeTarget(w,ctx)));
  if(['tee-object','set-content','add-content','ac','out-file','new-item','ni','mkdir','md','export-csv','epcsv','export-clixml'].includes(name)){
    const key=['-path','-literalpath','-lp','-pspath','-filepath'].find(k=>named[k]);
    // The first positional may be a list too (Set-Content a,b x).
    const firstList=[];
    if(!key&&positional[0]){firstList.push(positional[0]);for(let i=1;firstList.at(-1).comma&&positional[i];i++)firstList.push(positional[i]);}
    let targets=key?lists[key]??[named[key]]:firstList;
    if(named['-name']){
      const bases=targets.length?targets:[literal('.')];
      targets=bases.map(base=>({text:path.join(base.text,named['-name'].text),dynamic:base.dynamic||named['-name'].dynamic,glob:base.glob||named['-name'].glob}));
    }
    if(!targets.length)return name==='tee-object'?ALLOW:ask(`${name} sin destino explícito`);
    const results=targets.map(w=>writeTarget(w,ctx));
    if(/^(?:symboliclink|junction|hardlink)$/i.test(named['-itemtype']?.text??'')){
      const link=named['-target']??named['-value']??positional[1];
      results.push(link?linkTarget(link,ctx):ask('enlace sin destino explícito'));
    }
    return worst(results);
  }
  return copyRule(name,positional,named,ctx,flags,lists);
}

function copyRule(name,positional,named,ctx,flags=[],lists={}){
  const moving=!['cp','copy','copy-item','cpi','install'].includes(name);
  const sources=[...(lists['-path']??[named['-path']]),...(lists['-literalpath']??[named['-literalpath']]),...positional].filter(Boolean);
  let destination=named['-destination']??named['-newname']??named['-t']??named['--target-directory'];
  if(!destination){
    if(sources.length<2)return ask(`${name} sin origen y destino explícitos`);
    destination=sources.pop();
  }
  if(['ren','rename','rename-item','rni'].includes(name)&&!/[\\/]/.test(destination.text)&&sources[0])
    destination={...destination,text:path.join(path.dirname(sources[0].text),destination.text)};
  const resolvedDest=destination.glob?null:expand(destination);
  const destLoc=resolvedDest===null?null:locate(resolvedDest,ctx);
  // No explicit source: the items come from a pipe (Get-Item x | Move-Item -Destination y).
  if(!sources.length){
    if(moving)return ask(`${name} mueve o renombra elementos que llegan por la tubería`);
    if(destLoc===null||holdsGuarded(destLoc)||guarded(destLoc))return ask(`${name} copia elementos de la tubería a ${destLoc?.abs??destination.text}`);
  }
  // cp/mv -T treat the destination as the file itself, never as a folder to copy into.
  const intoDir=destLoc!==null&&!flags.some(f=>/^-[a-zA-Z]*T[a-zA-Z]*$/.test(f)||f==='--no-target-directory')&&isDirectory(destLoc.real);
  const results=[writeTarget(destination,ctx,intoDir)];
  for(const source of sources){
    if(moving)results.push(moveSource(source,ctx));
    if(!intoDir)continue;
    // Copy or move into a folder: the real destination keeps the source name. Several names (glob, dir/., a
    // dynamic name) are only a problem when the folder holds the control plane (a root, .claude...).
    if(source.dynamic||source.glob||/[\\/]\.?$/.test(source.text)){
      if(holdsGuarded(destLoc))results.push(ask(`copia o mueve varios archivos a ${destLoc.abs}, que contiene el plano de control`));
    }
    else results.push(writeTarget(literal(path.join(resolvedDest,path.basename(source.text))),ctx));
  }
  return worst(results);
}

function installRule(args,ctx){
  const rest=[];let directories=false;
  for(let i=0;i<args.length;i++){
    const t=args[i].text;
    if(t==='-d'||t==='--directory'){directories=true;continue;}
    if(/^-[mogSt]$/.test(t)){if(t==='-t')rest.push(literal('--target-directory'));i++;if(t==='-t')rest.push(args[i]);continue;}
    if(t.startsWith('-')&&t.length>1&&!t.startsWith('--target-directory'))continue;
    rest.push(args[i]);
  }
  if(directories)return worst(rest.map(w=>writeTarget(w,ctx)));
  const {positional,named}=parseArgs(rest,'bash');
  return copyRule('install',positional,named,ctx);
}

// sed's w/W commands and the s///w flag write files; e and s///e run commands.
const SED_WRITES=/(^|[;\n{}/])[\sgpiImM\d$]*[wWe](\s|$)/;
function sedRule(args,ctx){
  let inPlace=false,script=false;const files=[],scripts=[];
  for(let i=0;i<args.length;i++){
    const t=args[i].text;
    if(t.startsWith('--in-place')||/^-[a-zA-Z]*i/.test(t)&&!t.startsWith('--')){inPlace=true;continue;}
    if(t==='-f'||t==='--file'||t.startsWith('--file='))return ask('sed -f ejecuta un script de sed que el guard no analiza');
    if(t==='-e'||t==='--expression'){script=true;if(args[i+1])scripts.push(args[i+1]);i++;continue;}
    if(t.startsWith('-'))continue;
    if(!script){script=true;scripts.push(args[i]);continue;}
    files.push(args[i]);
  }
  if(scripts.some(w=>w.dynamic))return ask('sed con un script dinámico');
  if(scripts.some(w=>SED_WRITES.test(w.text)))return ask('el script de sed escribe archivos (w) o ejecuta comandos (e)');
  return inPlace?worst(files.map(w=>writeTarget(w,ctx))):ALLOW;
}

// Links, attributes, downloads, archives, copy tools, sort -o, awk and patch.
function fileToolRule(name,args,seg,ctx,shell){
  const t=args.map(w=>w.text);
  const valueAt=i=>{const x=t[i],eq=x.indexOf('=');return x.startsWith('--')&&eq>0?{...args[i],text:x.slice(eq+1)}:args[i+1];};
  const key=x=>x.split('=')[0];
  switch(name){
    case 'ln': {
      const files=[];let dir=null;
      for(let i=0;i<args.length;i++){
        if(t[i]==='-t'||key(t[i])==='--target-directory'){dir=valueAt(i);if(!t[i].includes('='))i++;continue;}
        if(t[i]==='-S'||key(t[i])==='--suffix'){if(!t[i].includes('='))i++;continue;}
        if(t[i].startsWith('-')&&t[i].length>1)continue;
        files.push(args[i]);
      }
      if(!files.length)return ALLOW;
      if(!dir&&files.length>1)dir=files.pop();
      const results=files.map(w=>linkTarget(w,ctx));
      if(!dir)results.push(writeTarget(literal(path.basename(files[0].text)),ctx));
      else{
        const text=expand(dir);
        if(text===null)return ask(`enlace con destino dinámico: ${dir.text}`);
        if(isDirectory(locate(text,ctx).real)){
          results.push(writeTarget(dir,ctx,true));
          for(const w of files)results.push(writeTarget(literal(path.join(text,path.basename(w.text))),ctx));
        }else results.push(writeTarget(dir,ctx));
      }
      return worst(results);
    }
    case 'mklink': {
      const files=args.filter(w=>!/^\/[a-z]$/i.test(w.text));
      if(files.length<2)return ask('mklink sin enlace y destino explícitos');
      return worst([writeTarget(files[0],ctx),linkTarget(files[1],ctx)]);
    }
    case 'chmod': case 'chown': case 'chgrp': case 'attrib': {
      const files=args.filter(w=>w.dynamic||!(w.text.length>1&&(name==='attrib'?/^[-+/]/:/^-/).test(w.text)));
      const reference=t.some(x=>x.startsWith('--reference'));
      // The mode (755, u+x) or the owner is not a file.
      if(name==='chmod'&&!reference&&/^(?:[0-7]{3,4}|[ugoa]*[-+=][rwxXst]*(?:,[ugoa]*[-+=][rwxXst]*)*)$/.test(files[0]?.text??''))files.shift();
      if((name==='chown'||name==='chgrp')&&!reference)files.shift();
      return worst(files.map(w=>writeTarget(w,ctx)));
    }
    case 'curl': case 'wget': case 'invoke-webrequest': case 'iwr': case 'invoke-restmethod': case 'irm': case 'start-bitstransfer': {
      // Options are case-sensitive in curl and wget (-o and -O differ) and case-insensitive in PowerShell.
      const ps=!['curl','wget'].includes(name)||args.some(w=>/^-outfile$/i.test(key(w.text)));
      const FILE=name==='curl'?['-o','--output','-D','--dump-header','-c','--cookie-jar','--trace','--trace-ascii','--stderr']:
        name==='wget'?['-O','--output-document','-o','--output-file','-a','--append-output']:['-outfile','-destination'];
      const FOLDER=name==='curl'?['--output-dir']:name==='wget'?['-P','--directory-prefix']:[];
      const results=[];let named=false;
      for(let i=0;i<args.length;i++){
        const k=ps?key(t[i]).toLowerCase():key(t[i]);
        if(FILE.includes(k)||FOLDER.includes(k)){
          const v=valueAt(i);if(v)results.push(writeTarget(v,ctx,FOLDER.includes(k)));
          if(['-O','--output-document','-o','--output','-outfile','-destination'].includes(k))named=true;
          if(!t[i].includes('='))i++;continue;
        }
        if(name==='curl'&&!ps&&(t[i]==='--remote-name'||t[i]==='--remote-name-all'||/^-[a-zA-Z]*O[a-zA-Z]*$/.test(t[i])))
          results.push(writeTarget(literal('.'),ctx,true));
      }
      if(name==='wget'&&!named)results.push(writeTarget(literal('.'),ctx,true));
      // Pasted or bundled forms (-o.claude/x, -sSLo file) and any other path argument of the control plane.
      results.push(unknownProgram(name,args,ctx));
      return worst(results);
    }
    case 'tar': case 'unzip': case '7z': case '7za': case 'expand-archive': case 'compress-archive': {
      let extracting=false,dest=null;const results=[];
      if(name==='tar'){
        extracting=t.some(x=>/^--(?:extract|get)$/.test(x)||/^-[a-zA-Z]*x/.test(x))||/^[a-zA-Z]*x/.test(t[0]??'');
        for(let i=0;i<args.length;i++){
          if(t[i]==='-C'||key(t[i])==='--directory'){dest=valueAt(i);if(!t[i].includes('='))i++;continue;}
          if(!extracting&&(t[i]==='-f'||key(t[i])==='--file'||/^-?[a-zA-Z]*f$/.test(t[i])&&i===0||/^-[a-zA-Z]*f$/.test(t[i]))){
            const v=valueAt(i);if(v)results.push(writeTarget(v,ctx));if(!t[i].includes('='))i++;
          }
        }
        if(!extracting)return worst(results);
      }else if(name==='unzip'){
        extracting=!t.some(x=>/^-[a-zA-Z]*[lvtZ]/.test(x));
        const i=t.indexOf('-d');if(i>=0)dest=args[i+1];
      }else if(name==='7z'||name==='7za'){
        extracting=t[0]==='x'||t[0]==='e';
        const o=args.find(w=>/^-o./.test(w.text));if(o)dest={...o,text:o.text.slice(2)};
        if(!extracting)return ALLOW;
      }else{
        const {positional,named}=parseArgs(args,shell);
        if(name==='compress-archive'){const d=named['-destinationpath']??positional[1];return d?writeTarget(d,ctx):ask('Compress-Archive sin destino');}
        extracting=true;dest=named['-destinationpath']??positional[1]??null;
      }
      if(!extracting)return ALLOW;
      const word=dest??literal('.');
      const text=expand(word);
      if(text===null)return ask(`extrae un archivo comprimido en un destino dinámico: ${word.text}`);
      const loc=locate(text,ctx);
      if(guarded(loc)||holdsGuarded(loc))
        return ask(`extrae un archivo comprimido sobre el plano de control o una carpeta que lo contiene: ${loc.abs}`);
      return worst([...results,writeTarget(word,ctx,true)]);
    }
    case 'rsync': case 'robocopy': case 'xcopy': {
      const files=args.filter(w=>name==='rsync'?!(w.text.startsWith('-')&&w.text.length>1):!/^\//.test(w.text));
      const dest=name==='rsync'?files.at(-1):files[1];
      if(!dest||(name==='rsync'&&files.length<2))return ask(`${name} sin origen y destino explícitos`);
      const text=expand(dest);
      if(text===null)return ask(`${name} con destino dinámico: ${dest.text}`);
      if(name==='rsync'&&(/^[\w.-]+@[\w.-]+:/.test(text)||/^[\w.-]{2,}:/.test(text)))return ALLOW; // remote target
      const loc=locate(text,ctx);
      const results=[writeTarget(dest,ctx,true)];
      if(guarded(loc)||holdsGuarded(loc))results.push(ask(`${name} copia sobre el plano de control o una carpeta que lo contiene: ${loc.abs}`));
      if(name==='robocopy'&&t.some(x=>/^\/mov(?:e)?$/i.test(x))&&files[0])results.push(moveSource(files[0],ctx));
      if(name==='rsync'&&t.includes('--remove-source-files'))for(const w of files.slice(0,-1))results.push(moveSource(w,ctx));
      return worst(results);
    }
    case 'sort': {
      for(let i=0;i<args.length;i++)if(t[i]==='-o'||key(t[i])==='--output'){const v=valueAt(i);if(v)return writeTarget(v,ctx);}
      return ALLOW;
    }
    case 'awk': case 'gawk': case 'mawk': case 'nawk': {
      if(t.some((x,i)=>x==='-i'&&/^inplace/.test(t[i+1]??'')||/^-iinplace/.test(x)||/^--include=inplace/.test(x)))
        return ask('awk -i inplace modifica archivos en el sitio');
      const writes=/\bprint[f]?\b[^;}]*?>|\bsystem\s*\(|\|\s*getline|\bprint[f]?\b[^;}]*?\|/;
      const fileOpt=t.findIndex(x=>x==='-f'||key(x)==='--file');
      let program='';
      if(fileOpt>=0){
        const word=valueAt(fileOpt),text=word?expand(word):null;
        if(text===null)return ask('programa awk dinámico');
        try{program=fs.readFileSync(locate(text,ctx).real,'utf8').slice(0,1048576);}catch{return ALLOW;}
      }else{
        const first=args.find((w,i)=>!w.text.startsWith('-')&&!/^-[vF]$/.test(t[i-1]??''));
        if(!first)return ALLOW;
        if(first.dynamic)return ask('programa awk dinámico');
        program=first.text;
      }
      return writes.test(program)?ask('el programa awk escribe archivos o ejecuta comandos'):ALLOW;
    }
    case 'patch': {
      const results=[];let input=null,strip=null;const files=[];
      for(let i=0;i<args.length;i++){
        if(t[i]==='-i'||key(t[i])==='--input'){input=valueAt(i);if(!t[i].includes('='))i++;continue;}
        if(/^-p\d+$/.test(t[i])){strip=Number(t[i].slice(2));continue;}
        if(t[i]==='-o'||key(t[i])==='--output'){const v=valueAt(i);if(v)results.push(writeTarget(v,ctx));if(!t[i].includes('='))i++;continue;}
        if(/^-[dBrDVYzg]$/.test(t[i])){i++;continue;}
        if(t[i].startsWith('-')&&t[i].length>1)continue;
        files.push(args[i]);
      }
      if(files[0])results.push(writeTarget(files[0],ctx));
      if(!input&&files[1])input=files[1];
      return worst([...results,patchInput(input,seg,ctx,strip,'patch')]);
    }
    default:
      return ALLOW;
  }
}

// Paths named by a unified or Git diff.
function patchPaths(text){
  const out=[];
  for(const raw of text.split('\n')){
    const line=raw.replace(/\r$/,'');
    let m=/^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
    if(m){out.push(m[1],m[2]);continue;}
    m=/^(?:\+\+\+|---) (?!\/dev\/null)"?(.+?)"?(?:\t.*)?$/.exec(line);
    if(m){out.push(m[1]);continue;}
    m=/^(?:rename|copy) (?:from|to) (.+)$/.exec(line);
    if(m)out.push(m[1]);
  }
  return out;
}
// The patch text: a file, a here-document or a redirected file. Asks when it cannot be read or touches the control
// plane under any reasonable reading of its paths (as written, without a/ b/, without the first folder, base name).
function patchInput(input,seg,ctx,strip,what){
  let text=null;
  if(input&&input.text!=='-'){
    const file=expand(input);
    if(file===null)return ask(`${what} con un parche de ruta dinámica`);
    try{text=fs.readFileSync(locate(file,ctx).real,'utf8').slice(0,4194304);}catch{return ask(`${what}: no se pudo leer el parche ${file}`);}
  }else if(seg.stdin!==null)text=seg.stdin;
  else{
    const redirect=seg.redirects.find(r=>r.op==='<');
    if(!redirect?.target)return ask(`${what} recibe el parche por la tubería: no se puede analizar`);
    const file=expand(redirect.target);
    if(file===null)return ask(`${what} con un parche de ruta dinámica`);
    try{text=fs.readFileSync(locate(file,ctx).real,'utf8').slice(0,4194304);}catch{return ask(`${what}: no se pudo leer el parche ${file}`);}
  }
  const paths=patchPaths(text);
  if(!paths.length)return ask(`${what}: el parche no tiene rutas reconocibles`);
  const roots=[ctx.cwd];
  const own=rootOf(norm(ctx.cwd));
  if(own)roots.push(own);
  for(const p of paths){
    const clean=p.replace(/^[ab]\//,'');
    // A deep prefix (a/x/y/.claude/agents/…) hides the real path under any -pN reading: a control-plane name asks.
    if(/(?:^|\/)(?:\.claude\/(?:agent-memory|agents|rules|workflows|hooks|skills|commands|settings)|\.codex|\.agents|\.mcp\.json|claude\.md|agents\.md)(?:\/|$|\.|-)/i.test(clean))
      return ask(`${what} modifica el plano de control de los agentes: ${clean}`);
    const readings=new Set([p,clean,clean.split('/').slice(1).join('/'),path.basename(clean)]);
    if(strip!==null)readings.add(p.split('/').slice(strip).join('/'));
    for(const reading of readings){
      if(!reading)continue;
      for(const base of roots)if(guarded(locate(reading,{...ctx,cwd:base})))
        return ask(`${what} modifica el plano de control de los agentes: ${clean}`);
    }
  }
  return ALLOW;
}

function xargsRule(args,shell,ctx){
  let i=0,replace=null;
  while(i<args.length&&args[i].text.startsWith('-')){
    const t=args[i].text;
    if(t==='-I'){replace=args[i+1]?.text??'{}';i+=2;continue;}
    if(/^-I./.test(t)){replace=t.slice(2);i++;continue;}
    if(/^--replace(?:=|$)/.test(t)){replace=t.includes('=')?t.slice(10):'{}';i++;continue;}
    i+=/^-(?:[inLPdsEa]|-(?:max-args|max-procs|delimiter|arg-file|eof|max-chars))$/.test(t)?2:1;
  }
  const inner=args.slice(i);
  if(!inner.length)return ALLOW;
  const name=commandName(inner[0].text);
  if(DELETERS.has(name)||WRITERS.has(name)||FILE_TOOLS.has(name)||['git','adb','sqlite3','sqlite'].includes(name)||Object.hasOwn(SHELLS,name))
    return ask(`xargs ejecuta ${name} con argumentos que llegan por la entrada`);
  // The arguments from the input are unknown: they are dynamic words.
  const words=replace!==null?inner.map(w=>w.text.includes(replace)?{...w,dynamic:true}:w):[...inner,{text:'$XARGS',dynamic:true,glob:false}];
  return commandRule({words,redirects:[],stdin:null,subs:[],call:false,scope:[]},shell,{...ctx});
}

function findRule(args,shell,ctx){
  const t=args.map(w=>w.text),results=[];
  const sensitiveMatch=t.some((x,i)=>/^-(?:name|iname|path|ipath)$/.test(t[i-1]??'')&&globSensitive(x.split('/').at(-1)));
  for(let i=0;i<args.length;i++){
    if(/^-(?:fprint0?|fprintf|fls)$/.test(t[i])&&args[i+1])results.push(writeTarget(args[i+1],ctx));
    if(t[i]==='-delete'){
      if(sensitiveMatch)return deny('find borraría bases de datos, respaldos o exportaciones');
      results.push(ask('find con -delete borra archivos'));
    }
    if(/^-(?:exec|execdir|ok|okdir)$/.test(t[i])){
      const inner=[];let j=i+1;
      for(;j<args.length&&t[j]!==';'&&t[j]!=='+';j++)inner.push(t[j].includes('{}')?{...args[j],dynamic:true}:args[j]);
      i=j;
      if(!inner.length)continue;
      if(sensitiveMatch&&/^(?:rm|del|shred|unlink|mv|truncate|sqlite3?)$/.test(commandName(inner[0].text)))
        return deny('find borraría bases de datos, respaldos o exportaciones');
      // Each found path is a dynamic argument ({}): writers and deleters ask, readers stay allowed.
      results.push(commandRule({words:inner,redirects:[],stdin:null,subs:[],call:false,scope:[]},shell,{...ctx}));
    }
  }
  return worst(results);
}

// ---------------------------------------------------------------- tools that write implicitly

// Jest -u, ESLint --fix and Prettier --write rewrite files that the command does not name: the guard cannot check
// them, so the owner approves. Output options with an explicit path are checked as writes.
function toolRule(name,args,ctx){
  const t=args.map(w=>w.text),results=[];
  // A test, configuration or plugin written earlier in the same command runs inside Jest or ESLint unanalysed.
  if((name==='jest'||name==='eslint')&&[...(ctx.written??[])].some(file=>/\.(?:[cm]?[jt]sx?|json)$|rc$/.test(file)))
    results.push(ask(`${name} ejecuta código escrito en el mismo comando`));
  const valueAt=i=>{const x=t[i],eq=x.indexOf('=');return eq>0&&x.startsWith('-')?{...args[i],text:x.slice(eq+1)}:args[i+1];};
  for(let i=0;i<t.length;i++){
    const x=t[i],k=x.split('=')[0].toLowerCase();
    if(name==='jest'){
      if(/^-[a-zA-Z]*u[a-zA-Z]*(?:=.*)?$/.test(x)||/^--update-?snapshot(?:=true)?$/i.test(x))results.push(ask('jest -u/--updateSnapshot reescribe snapshots sin un destino analizable'));
      if(/^--output-?file$/.test(k)){const v=valueAt(i);if(v)results.push(writeTarget(v,ctx));}
      if(/^--(?:coverage-?directory|cache-?directory)$/.test(k)){const v=valueAt(i);if(v)results.push(writeTarget(v,ctx,true));}
    }else if(name==='eslint'){
      if(k==='--fix'||k==='--fix-type')results.push(ask('eslint --fix reescribe archivos sin un destino analizable'));
      if(k==='-o'||k==='--output-file'||k==='--cache-location'){const v=valueAt(i);if(v)results.push(writeTarget(v,ctx));}
    }else if(name==='prettier'){
      if(k==='--write'||k==='-w')results.push(ask('prettier --write reescribe archivos sin un destino analizable'));
    }else if(name==='tsc'){
      if(/^--(?:outdir|declarationdir|generatetrace)$/.test(k)){const v=valueAt(i);if(v)results.push(writeTarget(v,ctx,true));}
      if(/^--(?:outfile|tsbuildinfofile)$/.test(k)){const v=valueAt(i);if(v)results.push(writeTarget(v,ctx));}
    }
  }
  return worst(results);
}

// npm runs the scripts of package.json: the guard evaluates the script text (with pre/post scripts and the extra
// arguments) as a command. install/ci also run the root package's install lifecycle scripts.
const PACKAGES=new Map();
function packageScripts(dir){
  for(let d=dir;;d=path.dirname(d)){
    const file=path.join(d,'package.json');
    if(PACKAGES.has(file))return PACKAGES.get(file);
    if(exists(file)){
      let value;
      try{value={dir:d,scripts:JSON.parse(fs.readFileSync(file,'utf8')).scripts??{}};}catch{value={dir:d,error:true};}
      PACKAGES.set(file,value);
      return value;
    }
    if(path.dirname(d)===d)return null;
  }
}
const NPM_RUN=['run','run-script','rum','urn'];
const NPM_INSTALL=['install','i','in','ins','inst','insta','instal','isnt','isnta','isntal','isntall','add','ci','clean-install','ic',
  'install-clean','isntall-clean','rebuild','rb'];
function npmRule(args,ctx){
  const a=args.map(w=>w.text);let i=0,cwd=ctx.cwd;
  while(i<a.length&&a[i].startsWith('-')){
    if(a[i]==='--prefix'||a[i]==='-C'){
      if(!args[i+1]||args[i+1].dynamic)return ask('npm con --prefix dinámico');
      cwd=path.resolve(cwd,a[i+1]);i+=2;continue;
    }
    if(a[i].startsWith('--prefix=')){cwd=path.resolve(cwd,a[i].slice(9));i++;continue;}
    i++;
  }
  const sub=(a[i]??'').toLowerCase();
  // --prefix may also follow the subcommand (npm install --prefix dir).
  for(let j=i+1;j<a.length;j++){
    if(a[j]==='--prefix'&&args[j+1]){if(args[j+1].dynamic)return ask('npm con --prefix dinámico');cwd=path.resolve(cwd,a[j+1]);}
    else if(a[j].startsWith('--prefix='))cwd=path.resolve(cwd,a[j].slice(9));
  }
  // install, init, update… write package.json, the lockfile and node_modules in the package folder.
  if([...NPM_INSTALL,'init','create','innit','update','up','upgrade','uninstall','remove','rm','un','unlink','link','ln','prune',
    'dedupe','ddp','version','pkg','shrinkwrap'].includes(sub)){
    const loc=locate(cwd,{...ctx,cwd:ctx.cwd});
    if(ctx.unknownCwd&&!a.some(x=>x.startsWith('--prefix')))return ask(`npm ${sub} en un directorio desconocido`);
    if(guarded(loc))return ask(`npm ${sub} escribe en el plano de control de los agentes: ${loc.abs}`);
  }
  let names,rest=[];
  if(NPM_RUN.includes(sub)){
    let j=i+1;
    while(j<a.length&&a[j].startsWith('-')&&a[j]!=='--')j++;
    if(j>=a.length)return ALLOW;
    if(args[j].dynamic)return ask('npm run con un script dinámico');
    names=[a[j]];rest=args.slice(j+1);
  }else if(['test','t','tst'].includes(sub)){names=['test'];rest=args.slice(i+1);}
  else if(['start','stop','restart'].includes(sub)){names=[sub];rest=args.slice(i+1);}
  else if(NPM_INSTALL.includes(sub))names=['preinstall','install','postinstall','prepare'];
  else if(sub==='exec'||sub==='x'){
    const words=args.slice(i+1);
    const c=words.findIndex(w=>w.text==='-c'||w.text==='--call');
    if(c>=0)return words[c+1]?(words[c+1].dynamic?ask('npm exec -c dinámico'):evaluateShell(words[c+1].text,'bash',{...ctx,depth:ctx.depth+1})):ALLOW;
    const dash=words.findIndex(w=>w.text==='--');
    const program=dash>=0?words.slice(dash+1):words.filter(w=>!w.text.startsWith('-'));
    return program.length?commandRule({words:program,redirects:[],stdin:null,subs:[],call:false,scope:[]},'bash',{...ctx}):ALLOW;
  }
  else return ALLOW;
  const pkg=packageScripts(cwd);
  if(!pkg)return ALLOW;
  if(pkg.error)return ask('no se pudo leer package.json para analizar el script de npm');
  const extra=rest.filter(w=>w.text!=='--').map(quote).join(' ');
  const scripts=[];
  if(names.length===1)scripts.push(['pre'+names[0],''],[names[0],extra],['post'+names[0],'']);
  else for(const n of names)scripts.push([n,'']);
  const results=[];
  for(const [n,more] of scripts){
    const body=pkg.scripts[n];
    if(typeof body!=='string')continue;
    results.push(capAsk(evaluateShell(body+(more?' '+more:''),'bash',{...ctx,cwd:pkg.dir,unknownCwd:false,dirs:[],depth:ctx.depth+1}),`el script de npm «${n}»`));
  }
  return worst(results);
}

// ---------------------------------------------------------------- nested execution and scripts

// Write or process APIs in inline code or in a script. The targets of an inline program cannot be checked.
const CODE_WRITES=/writeFile|appendFile|createWriteStream|copyFile|\bcpSync|\bcp\s*\(|\brename|unlink|\brm(?:Sync)?\s*\(|rmdir|mkdir|truncate|symlink|\blink(?:Sync)?\s*\(|utimes|chmod|chown|\bfs\.(?:promises\.)?(?:write|open)|\bopen\s*\([^)]*,\s*(?:mode\s*=\s*)?['"][^'"]*[wax+>]|os\.(?:remove|replace|makedirs)|shutil\.|\.write_(?:text|bytes)|\.touch\s*\(|child_process|exec(?:File)?Sync|spawn(?:Sync)?\s*\(|subprocess|os\.(?:system|popen|exec\w*)|(?<![.\w])(?:system|exec)\s*\(|Deno\.(?:write|remove|rename|copy|mkdir|create|truncate|symlink|link|chmod|run|Command)|Bun\.(?:write|spawn)|File(?:Utils)?\.(?:write|open|delete|rename|unlink|cp|mv|rm|mkdir|touch)|IO\.(?:write|binwrite)|file_put_contents|fwrite|fopen|\bqx\b|os\.(?:open|write|fdopen)\b/;
// Names of the control plane in a script's text.
const CONTROL_TOKEN=/\.claude\b|agent-memory|\bclaude\.md\b|\bagents\.md\b|\.codex\b|\.agents\b|\.mcp\.json|\bsettings(?:\.local)?\.json\b/i;
const CMD_WRITES=/>|\b(?:del|erase|rd|rmdir|copy|xcopy|robocopy|move|ren|rename|mklink|md|mkdir|attrib|icacls|powershell|pwsh|node|python)\b/i;
// Known read-only verifications whose script also contains write code for another mode (exact arguments).
const READONLY_SCRIPTS=[{file:'scripts/syncagentskills.js',args:['--check']}];
// The hook suites that CI and /verificar run with node --test: they name the control plane and write, but only to the
// temp directory and to their own synthetic fixtures (a .guard-v2-fixture folder and, removed in finally, synthetic
// checkouts under .claude/worktrees/guard-*-<pid>). The name is not enough: the content must be the reviewed one, pinned here
// as the SHA-256 of the file with LF line endings (agent-config-policy.test.cjs checks the pins). A suite whose content
// differs, reached through a link or written in the same command is analysed like any other script.
const HOOK_SUITES={
  '.claude/hooks/__tests__/dangerous-command-guard.test.cjs':'ac4af3c761c920e7f3b3e64de0d1a51c9a07ac7fff3c9a6246bd75ccc8bfea6d',
  '.claude/hooks/__tests__/reviewer-reminder.test.cjs':'e15de7c2d07da01d6bc89ea2cbd7078049655a3172bf2c53c939f6a9668e0c97',
  '.claude/hooks/__tests__/session-context.test.cjs':'3b2a9ca291b4ea729e59b19e479a9213444851740c5ce235c7a726155f0f9a96',
  '.claude/hooks/__tests__/agent-config-policy.test.cjs':'488def85fef96f07814e6a631be5d141a23957d9757e56547cb4a1a6698108da',
};
const suiteDigest=file=>crypto.createHash('sha256').update(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')).digest('hex');
// The suites load the hooks of their own checkout (../dangerous-command-guard.cjs…). In another checkout those must be
// identical to the hooks of this one, the ones running now; otherwise the suite would run code nobody pinned.
const HOOK_MODULES=['dangerous-command-guard','reviewer-reminder','session-context'].map(name=>`.claude/hooks/${name}.cjs`);
function sameHooks(root){
  if(root===ROOT)return true;
  try{return HOOK_MODULES.every(rel=>{
    const file=path.join(root,rel);
    return norm(fs.realpathSync.native(file))===norm(file)&&suiteDigest(file)===suiteDigest(path.join(ROOT,rel));
  });}catch{return false;}
}
function hookSuite(word,ctx){
  const text=expand(word);
  if(text===null||word.glob||(ctx.unknownCwd&&relative(text)))return false;
  const loc=locate(text,ctx);
  if(loc.root===null||!Object.hasOwn(HOOK_SUITES,loc.rel)||resolved(loc)!==loc.abs||ctx.written?.has(loc.abs))return false;
  try{return fs.lstatSync(loc.real).isFile()&&suiteDigest(loc.real)===HOOK_SUITES[loc.rel]&&sameHooks(loc.root);}catch{return false;}
}
// node --test runs the files, folders or globs it receives (node expands them, also when quoted), discovers test files
// when it has none, and takes node options before or after them (--require, reporters, --test-isolation…). Instead of
// modelling those options, only the verified invocation runs without a question: `node --test` followed by one or more
// pinned hook suites and nothing else. Any other form asks.
function nodeTestRule(name,args,ctx){
  const files=args.filter(w=>w.text!=='--test');
  if(name==='node'&&files.length===args.length-1&&files.length&&files.every(w=>hookSuite(w,ctx)))return ALLOW;
  return ask('node --test solo se ejecuta sin aprobación como «node --test <suites de hooks fijadas>»: otros argumentos, el descubrimiento de pruebas o módulos adicionales no se analizan');
}
const SCRIPT_KIND={'.sh':'bash','.bash':'bash','.ps1':'powershell','.bat':'cmd','.cmd':'cmd','.py':'python','.js':'node','.cjs':'node',
  '.mjs':'node','.rb':'ruby','.pl':'perl'};

const CATASTROPHE=/git\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+(?:-f\b|--force)|filter-branch)|(?:pm\s+clear|uninstall)\s+com\.smartfin(?![\w.])|format-volume|diskpart/i;
function inlineCode(code){
  if(CATASTROPHE.test(code))return ask('código en línea que ejecuta una operación destructiva');
  if(/\.(?:db|sqlite3?)\b|smartfin-(?:backup|manifest|generation)|\.keystore|\.env\b/i.test(code)&&
     /unlink|rmSync|rmdirSync|rimraf|writeFile|truncate|os\.remove|shutil\.rmtree|\bopen\([^)]*,\s*['"][wa]|\bDROP\s|DELETE\s+FROM|UPDATE\s+\w+\s+SET/i.test(code))
    return ask('código en línea que modifica bases de datos, respaldos o secretos');
  if(CODE_WRITES.test(code))return ask('código en línea que escribe archivos o lanza procesos: el guard no puede comprobar su destino');
  // Whatever the API (also built dynamically, 'write'+'FileSync'), inline code that names the control plane asks.
  if(CONTROL_TOKEN.test(code))return ask('código en línea que nombra el plano de control de los agentes');
  return ALLOW;
}

function shebangKind(source){
  const first=source.slice(0,200).split('\n')[0];
  if(first.startsWith('#!')){
    if(/\bnode\b|\bdeno\b|\bbun\b/.test(first))return 'node';
    if(/python/.test(first))return 'python';
    if(/ruby|perl/.test(first))return 'ruby';
    if(/pwsh|powershell/.test(first))return 'powershell';
    return 'bash';
  }
  return source.slice(0,4096).includes('\0')?'binary':'bash';
}

// Runs a script file. Shell scripts are analysed like a command (whatever would be denied becomes ask); other
// languages are scanned: the entry file asks when it names the control plane and contains write code. Imports are
// not followed. A script inside the control plane is analysed like any other: its location does not make it safe.
function scriptRule(word,kind,args,ctx){
  const text=expand(word);
  if(text===null)return ask(`ejecuta un script de ruta dinámica: ${word.text}`);
  // The shell expands the glob to a real file that the guard cannot read under that name.
  if(word.glob)return ask(`ejecuta un script con comodines: ${text}`);
  // /dev/stdin, /dev/fd/N and /proc/self/fd/N are the pipe or a process substitution.
  if(/^\/dev\/(?:stdin|fd\/)|^\/proc\/self\/fd\//i.test(text))return PIPED('el script');
  if(ctx.unknownCwd&&relative(text))return ask('ejecuta un script relativo después de cambiar a un directorio desconocido');
  const loc=locate(text,ctx);
  if(ctx.written?.has(loc.abs))return ask(`ejecuta un script escrito en el mismo comando: ${text}`);
  // Git internals are not owner-reviewed content (git config and git commit write there): running them asks.
  if(gitAbs(loc.abs)||gitAbs(resolved(loc)))return ask(`ejecuta un archivo interno de Git: ${text}`);
  if(loc.root&&READONLY_SCRIPTS.some(s=>s.file===loc.rel&&s.args.join('\0')===args.map(w=>w.text).join('\0')))return ALLOW;
  let source;
  try{
    const stat=fs.statSync(loc.real);
    if(!stat.isFile())return ALLOW;
    if(stat.size>1048576){
      if(kind!=='auto')return ask(`script demasiado grande para analizarlo: ${text}`);
      const fd=fs.openSync(loc.real,'r'),buffer=Buffer.alloc(4096);
      try{fs.readSync(fd,buffer,0,4096,0);}finally{fs.closeSync(fd);}
      return buffer.includes(0)?ALLOW:ask(`script demasiado grande para analizarlo: ${text}`);
    }
    source=fs.readFileSync(loc.real,'utf8');
  }catch{return ALLOW;} // it does not exist: nothing runs
  if(kind==='auto')kind=shebangKind(source);
  if(kind==='binary')return ALLOW;
  if(kind==='bash'||kind==='powershell'){
    try{return capAsk(evaluateShell(source,kind,{...ctx,dirs:[],depth:ctx.depth+1}),`el script ${text}`);}
    catch{return ask(`script no analizable: ${text}`);}
  }
  if(CONTROL_TOKEN.test(source)&&(kind==='cmd'?CMD_WRITES:CODE_WRITES).test(source))
    return ask(`el script ${text} menciona el plano de control de los agentes y contiene operaciones de escritura`);
  return ALLOW;
}
function directScript(head,args,ctx){
  const ext=path.extname(head.text).toLowerCase();
  if(Object.hasOwn(SCRIPT_KIND,ext))return scriptRule(head,SCRIPT_KIND[ext],args,ctx);
  if(['.exe','.com','.dll','.msi'].includes(ext))return null;
  if(/[\\/]/.test(head.text))return scriptRule(head,'auto',args,ctx);
  return null;
}

// A shell or interpreter with no program argument, here-document or redirected file reads its program from a pipe:
// the guard cannot see it.
const PIPED=what=>ask(`${what} lee el programa de la entrada (tubería): el guard no puede analizarlo`);
function nestedShellRule(name,args,seg,ctx){
  const kind=SHELLS[name],inner={...ctx,depth:ctx.depth+1},texts=args.map(w=>w.text);
  const fromInput=shell=>{
    if(seg.stdin!==null)return evaluateShell(seg.stdin,shell,inner);
    const input=seg.redirects.find(r=>r.op==='<');
    return input?.target?scriptRule(input.target,shell,[],ctx):PIPED(name);
  };
  if(kind==='cmd'){
    const index=texts.findIndex(t=>/^\/[ck]$/i.test(t));
    if(index<0)return fromInput('cmd');
    return evaluateShell(texts.slice(index+1).join(' '),'cmd',inner);
  }
  if(kind==='bash'){
    const index=texts.findIndex(t=>/^-[a-z]*c[a-z]*$/.test(t));
    if(index>=0)return args[index+1]?evaluateShell(args[index+1].text,'bash',inner):ALLOW;
    if(texts.some(t=>t==='--version'||t==='--help'))return ALLOW;
    const script=args.findIndex(w=>(!w.text.startsWith('-')||w.dynamic)&&w.text!=='-');
    if(script>=0)return scriptRule(args[script],'bash',args.slice(script+1),ctx);
    return fromInput('bash');
  }
  for(let i=0;i<texts.length;i++){
    const t=texts[i].toLowerCase();
    if(/^-(?:e|ec|en|enc|enco|encod|encode|encoded|encodedc\w*|encodeda\w*)$/.test(t))return ask('PowerShell con comando codificado');
    if(t.length>=2&&'-command'.startsWith(t))
      return texts[i+1]==='-'||texts.length===i+1?fromInput('powershell'):evaluateShell(texts.slice(i+1).join(' '),'powershell',inner);
    if(t==='-version'||t==='-v'||t==='-help'||t==='-?')return ALLOW;
    if(t.length>=2&&'-file'.startsWith(t))return args[i+1]?scriptRule(args[i+1],'powershell',args.slice(i+2),ctx):ALLOW;
    if(/^-(?:executionpolicy|ep|ex|exe|exec|configurationname|workingdirectory|wd|outputformat|of|inputformat|if|windowstyle|w)$/.test(t)){i++;continue;}
    if(!t.startsWith('-'))return scriptRule(args[i],'powershell',args.slice(i+1),ctx);
  }
  return fromInput('powershell');
}

function startRule(args,ctx){
  let file=null;const rest=[];
  for(let i=0;i<args.length;i++){
    const t=args[i].text.toLowerCase();
    if(t==='-verb'){if(/runas/i.test(args[i+1]?.text??''))return ask('ejecución con privilegios de administrador');i++;continue;}
    if(['-filepath','-file','-f'].includes(t)){file=args[++i]??null;continue;}
    // The argument list is a PowerShell list ('reset','--hard'): its elements may start with -.
    if(['-argumentlist','-args','-a'].includes(t)){
      if(args[i+1]){rest.push(args[++i]);while(args[i].comma&&args[i+1])rest.push(args[++i]);}
      continue;
    }
    if(t.startsWith('-')){if(/^-(?:workingdirectory|wd|redirectstandard\w*|windowstyle|credential)$/.test(t))i++;continue;}
    if(!file)file=args[i];else rest.push(args[i]);
  }
  if(!file)return ALLOW;
  if(file.dynamic||rest.some(w=>w.dynamic))return ask('Start-Process con programa o argumentos dinámicos');
  // One element is a whole command line; several are separate arguments and keep their boundaries.
  const pwshQuote=w=>"'"+w.text.replaceAll("'","''")+"'";
  const text=pwshQuote(file)+' '+(rest.length===1?rest[0].text:rest.map(pwshQuote).join(' '));
  return evaluateShell(text,'powershell',{...ctx,depth:ctx.depth+1});
}

const INLINE={node:['-e','--eval','-p','--print','-pe'],python:['-c'],ruby:['-e'],perl:['-e','-E'],php:['-r'],lua:['-e'],
  deno:['eval'],bun:['-e','--eval','-p','--print']};
const PRELOAD=/^(?:-r|--require|--import|--loader|--experimental-loader)$/;
const NODE_VALUES=/^(?:-C|--conditions|--env-file|--input-type|--test-reporter|--test-name-pattern|--test-concurrency|--title|--max-old-space-size)$/;
// Node options whose value is a file or folder that node writes.
const NODE_OUTPUTS=/^(?:--test-reporter-destination|--redirect-warnings|--cpu-prof-dir|--heap-prof-dir|--diagnostic-dir|--report-dir|--report-directory|--report-filename)$/;
function interpreterRule(name,args,seg,ctx){
  const lang=/^py(?:thon3?)?$/.test(name)?'python':['tsx','ts-node'].includes(name)?'node':name;
  const inline=INLINE[lang]??[];
  const results=[];
  if(lang==='node'&&args.some(w=>w.text==='--test'))return nodeTestRule(name,args,ctx);
  // perl/ruby -i (also bundled as -0pi or placed after the code) edits the named files in place.
  const inPlace=(lang==='perl'||lang==='ruby')&&args.some(w=>/^-[a-zA-Z0-9]*i/.test(w.text)&&!w.text.startsWith('--'));
  // Node output options apply wherever they appear, also after the script (node --test x --test-reporter-destination=…).
  if(lang==='node'||lang==='bun')for(let i=0;i<args.length;i++){
    const t=args[i].text,key=t.split('=')[0];
    if(!NODE_OUTPUTS.test(key))continue;
    const value=t.includes('=')?{...args[i],text:t.slice(t.indexOf('=')+1)}:args[i+1];
    if(value)results.push(writeTarget(value,ctx,/dir/.test(key)));
  }
  for(let i=0;i<args.length;i++){
    const w=args[i],t=w.text;
    const key=t.split('=')[0];
    const inlineFlag=inline.includes(t)||((lang==='perl'||lang==='ruby')&&/^-[a-zA-Z0-9]*e$/.test(t));
    if(inlineFlag){
      const code=args[i+1];
      if(!code)return worst(results);
      results.push(code.dynamic?ask('código en línea dinámico'):inlineCode(code.text));
      if(inPlace)for(const file of args.slice(i+2).filter(x=>!x.text.startsWith('-')))results.push(writeTarget(file,ctx));
      return worst(results);
    }
    if(/^--(?:eval|print)=/.test(t))return worst([...results,inlineCode(t.slice(t.indexOf('=')+1))]);
    if(lang==='python'&&t==='-m')return ask('python -m ejecuta un módulo que el guard no analiza');
    if(lang==='python'&&/^-[WX]$/.test(t)){i++;continue;}
    if(PRELOAD.test(key)){
      const value=t.includes('=')?{...w,text:t.slice(t.indexOf('=')+1)}:args[++i];
      if(!value)continue;
      if(/^data:/i.test(value.text))return ask('node precarga código en línea (data:): el guard no lo analiza');
      results.push(scriptRule(value,'node',[],ctx));continue;
    }
    if(NODE_OUTPUTS.test(key)&&(lang==='node'||lang==='bun')){
      const value=t.includes('=')?{...w,text:t.slice(t.indexOf('=')+1)}:args[++i];
      if(value)results.push(writeTarget(value,ctx,/dir/.test(key)));
      continue;
    }
    if(lang==='node'||lang==='bun'){
      // Test reporters and global setup are modules that node runs in the same process: built-in reporters only.
      if(/^--test-(?:reporter|global-setup)$/.test(key)){
        const value=t.includes('=')?{...w,text:t.slice(t.indexOf('=')+1)}:args[++i];
        if(value&&!(key==='--test-reporter'&&/^(?:spec|tap|dot|junit|lcov)$/.test(value.text)))
          results.push(/^[.~/\\]|^[a-z]:|\.[cm]?[jt]s$/i.test(value.text)?scriptRule(value,'node',[],ctx):
            ask(`node carga el módulo ${value.text} (${key}) sin que el guard pueda analizarlo`));
        continue;
      }
      // Configuration and environment files can add --require/--import or NODE_OPTIONS.
      if(/^--(?:experimental-config-file|experimental-default-config-file|env-file|env-file-if-exists)$/.test(key))
        return worst([...results,ask(`${key} carga configuración o variables (NODE_OPTIONS…) que pueden añadir código: el guard no la analiza`)]);
    }
    if(NODE_VALUES.test(key)&&(lang==='node'||lang==='bun')){if(!t.includes('='))i++;continue;}
    if(t.startsWith('-')&&t!=='-')continue;
    if(t==='-')break;
    if((lang==='deno'||lang==='bun')&&['run','test'].includes(t))continue;
    results.push(scriptRule(w,lang,args.slice(i+1),ctx));
    // A literal control-plane path passed to the script may be what it writes.
    results.push(unknownProgram(name,args.slice(i+1),ctx));
    return worst(results);
  }
  if(seg.stdin!==null)return worst([...results,inlineCode(seg.stdin)]);
  const input=seg.redirects.find(r=>r.op==='<');
  if(input?.target)return worst([...results,scriptRule(input.target,lang,[],ctx)]);
  // --version/--help run nothing. Otherwise the program comes from a pipe.
  if(args.some(w=>/^(?:-v|-V|--version|-h|--help)$/.test(w.text)))return worst(results);
  return worst([...results,PIPED(name)]);
}

// ---------------------------------------------------------------- Git

// Configuration keys that make Git run a command or read another configuration file later (git config and git -c).
const GIT_SENSITIVE=/^(?:alias\.|core\.(?:hookspath|sshcommand|fsmonitor|pager|editor|askpass|gitproxy|attributesfile|worktree)|credential\.|url\.|filter\.|include\.|includeif\.|diff\.external|diff\..+\.(?:textconv|command)|merge\..+\.driver|sequence\.editor|gpg\.|interactive\.difffilter|uploadpack\.|receive\.|pager\.)/i;

function gitRule(args,seg,ctx){
  const a=args.map(w=>w.text);let i=0,cwd=ctx.cwd,dynamicCwd=false,otherTree=false;
  while(i<a.length&&a[i].startsWith('-')){
    const option=a[i];
    if(option==='-C'){if(args[i+1]?.dynamic)dynamicCwd=true;else cwd=path.resolve(cwd,a[i+1]??'.');i+=2;continue;}
    if(option==='-c'){
      if(GIT_SENSITIVE.test(a[i+1]??'')||/^protocol\./i.test(a[i+1]??''))return ask('git -c cambia configuración sensible');
      i+=2;continue;
    }
    if(option.startsWith('--config-env'))return ask('git --config-env cambia la configuración desde una variable');
    if(option.startsWith('--exec-path='))return ask('git --exec-path cambia los programas que ejecuta Git');
    if(['--git-dir','--work-tree','--namespace'].includes(option)){otherTree=true;i+=2;continue;}
    if(/^--(?:git-dir|work-tree)=/.test(option))otherTree=true;
    i++;
  }
  const sub=a[i]??'',r=a.slice(i+1),words=args.slice(i+1);
  const has=(...flags)=>r.some(x=>flags.includes(x));
  const shortHas=letter=>r.some(x=>/^-[a-zA-Z]+$/.test(x)&&x.includes(letter));
  const gctx={...ctx,cwd};
  const pathOp=()=>dynamicCwd?ask('git -C con directorio dinámico'):otherTree?ask('git con --git-dir/--work-tree: no se puede comprobar qué archivos cambia'):null;
  const output=()=>{
    const results=[];
    for(let j=0;j<words.length;j++){
      const t=words[j].text;
      if(t==='--output'||t==='--output-directory'||(t==='-o'&&['format-patch','archive'].includes(sub))){
        if(words[j+1])results.push(writeTarget(words[j+1],gctx,t==='--output-directory'||(t==='-o'&&sub==='format-patch')));j++;continue;
      }
      const m=/^--(output|output-directory)=(.*)$/.exec(t);
      if(m)results.push(writeTarget({...words[j],text:m[2]},gctx,m[1]==='output-directory'));
    }
    return worst(results);
  };
  switch(sub){
    case 'reset':
      return has('--hard','--merge','--keep')?deny('git reset --hard/--merge/--keep descarta cambios sin respaldo'):ALLOW;
    case 'clean':
      if(has('--dry-run')||shortHas('n'))return ALLOW;
      return deny('git clean borra archivos no versionados (hay trabajo sin confirmar en el repositorio)');
    case 'checkout': {
      if(has('--','.','-f','--force','-p','--patch','--ours','--theirs','-m','--merge'))
        return deny('git checkout con rutas o forzado descarta cambios locales');
      if(has('-B'))return ask('git checkout -B reinicia una rama existente');
      if(r.filter(x=>!x.startsWith('-')).some(x=>exists(path.resolve(cwd,x))))
        return deny('git checkout <ruta> descarta los cambios locales de esos archivos');
      return ALLOW;
    }
    case 'switch':
      if(has('-f','--force','--discard-changes'))return deny('git switch forzado descarta cambios locales');
      return has('-C','--force-create')?ask('git switch -C reinicia una rama existente'):ALLOW;
    case 'restore':
      return has('-S','--staged')&&!has('-W','--worktree')?ALLOW:deny('git restore descarta cambios del árbol de trabajo');
    case 'stash':
      return ['drop','clear'].includes(r[0])?deny('git stash drop/clear elimina cambios guardados'):ALLOW;
    case 'branch':
      return has('-D','-f','--force','-M','-C')?ask('borrado o reescritura forzada de una rama'):ALLOW;
    case 'push':
      if(has('-f','--force','--mirror','--delete','-d','--prune')||r.some(x=>/^--force-with-lease|^--force-if-includes|^\+|^:/.test(x)))
        return deny('push forzado o borrado de ramas remotas');
      return ask('git push publica en el remoto');
    case 'rebase':
      return has('--abort','--continue','--skip','--quit')?ALLOW:ask('git rebase reescribe historial');
    case 'reflog':
      return ['expire','delete'].includes(r[0])?deny('borra entradas del reflog'):ALLOW;
    case 'gc':
      return r.some(x=>x.startsWith('--prune'))?ask('git gc --prune elimina objetos recuperables'):ALLOW;
    case 'prune':
      return ask('git prune elimina objetos inalcanzables');
    case 'filter-branch': case 'filter-repo':
      return deny('reescritura masiva del historial');
    case 'update-ref':
      return ask('update-ref modifica referencias directamente');
    case 'update-index':
      return has('--assume-unchanged','--skip-worktree')?ask('git update-index oculta cambios de archivos a git status'):ALLOW;
    case 'sparse-checkout':
      return r[0]==='list'?ALLOW:ask('git sparse-checkout añade o quita archivos del árbol de trabajo');
    case 'worktree': {
      if(r[0]==='remove'&&has('-f','--force'))return ask('worktree remove --force descarta los cambios de ese worktree');
      // A new worktree inside the control plane fills it with a whole tree.
      if(r[0]==='add'){
        const target=words.slice(1).find((w,j,list)=>!w.text.startsWith('-')&&!/^-[bB]$|^--reason$/.test(list[j-1]?.text??''));
        return target?writeTarget(target,gctx,true):ALLOW; // a new checkout is not the control plane, its inside is
      }
      return ALLOW;
    }
    case 'tag':
      return has('-d','--delete','-f','--force')?ask('borra o mueve una etiqueta'):ALLOW;
    case 'remote':
      return ['add','remove','rm','set-url','rename'].includes(r[0])?ask('cambia los remotos del repositorio'):ALLOW;
    case 'config': {
      if(has('--get','--get-all','--get-regexp','--list','-l','--show-origin'))return ALLOW;
      if(has('--global','--system'))return ask('configuración global de Git');
      // --file/-f writes an arbitrary file.
      const file=words.findIndex(w=>w.text==='--file'||w.text==='-f'||w.text.startsWith('--file='));
      if(file>=0){
        const w=words[file];
        const target=w.text.startsWith('--file=')?{...w,text:w.text.slice(7)}:words[file+1];
        const result=target?writeTarget(target,gctx):ask('git config --file sin ruta');
        if(result.decision!=='allow')return result;
      }
      return r.some(x=>GIT_SENSITIVE.test(x))?ask('configuración sensible de Git'):ALLOW;
    }
    case 'rm': {
      if(has('-n','--dry-run'))return ALLOW;
      if(r.some(x=>x.startsWith('--pathspec-from-file')))return ask('git rm con rutas leídas de un archivo');
      const problem=pathOp();if(problem)return problem;
      const specs=[];let endOptions=false;
      for(const w of words){if(!endOptions&&w.text==='--'){endOptions=true;continue;}if(endOptions||!w.text.startsWith('-'))specs.push(w);}
      return worst(specs.map(w=>gitPathspec(w,gctx)));
    }
    case 'mv': {
      if(has('-n','--dry-run'))return ALLOW;
      const problem=pathOp();if(problem)return problem;
      const files=words.filter(w=>!/^-[fkv]$|^--(?:force|verbose)$/.test(w.text));
      return writeRule('mv',files,gctx,'bash');
    }
    case 'apply': case 'am': {
      if(sub==='apply'&&has('--check','--stat','--numstat','--summary')&&!has('--apply'))return ALLOW;
      if(sub==='am'&&has('--abort','--skip','--quit','--show-current-patch'))return ALLOW;
      const problem=pathOp();if(problem)return problem;
      const files=words.filter(w=>!w.text.startsWith('-')||w.text==='-');
      if(r.some(x=>x.startsWith('--directory')))return ask(`git ${sub} con --directory: no se comprueban las rutas del parche`);
      const strip=r.map(x=>/^-p(\d+)$/.exec(x)).find(Boolean);
      const results=(files.length?files:[null]).map(w=>patchInput(w,seg,gctx,strip?Number(strip[1]):null,`git ${sub}`));
      return worst(results);
    }
    case 'clone': case 'submodule': {
      // The target folder of a clone or of a new submodule receives a whole tree.
      const plain=words.filter(w=>!w.text.startsWith('-'));
      const list=sub==='submodule'?(plain[0]?.text==='add'?plain.slice(1):[]):plain;
      if(list.length<2)return ALLOW;
      return writeTarget(list.at(-1),gctx);
    }
    case 'checkout-index':
      return has('-f','--force','-a','--all')||r.some(x=>x.startsWith('--prefix'))?ask('git checkout-index escribe archivos del índice en el árbol'):ALLOW;
    case 'read-tree':
      return has('-u','--reset')?ask('git read-tree -u/--reset reemplaza archivos del árbol de trabajo'):ALLOW;
    case 'diff': case 'log': case 'show': case 'format-patch': case 'archive': case 'whatchanged': case 'range-diff':
      return output();
    case 'grep':
      // -O<program> / --open-files-in-pager runs a program with the files found (also bundled: -nOvim).
      return r.some(x=>/^-[a-zA-Z]*O/.test(x)||x.startsWith('--open-files-in-pager'))?
        ask('git grep -O ejecuta un programa con los archivos encontrados: el guard no lo analiza'):ALLOW;
    default:
      return ALLOW;
  }
}
// One git rm pathspec: a literal path, a glob or pathspec magic (:(glob)…).
function gitPathspec(word,ctx){
  const text=expand(word);
  if(text===null)return ask(`git rm con ruta dinámica: ${word.text}`);
  if(text.startsWith(':'))return ask(`git rm con pathspec especial: ${text}`);
  if(/[*?[]/.test(text))return globGuarded(text,ctx)?ask(`git rm con comodín que puede alcanzar el plano de control: ${text}`):ALLOW;
  const loc=locate(text,ctx);
  return guarded(loc)||holdsGuarded(loc)?controlAsk(loc):ALLOW;
}

// ---------------------------------------------------------------- SQLite

const stripSql=sql=>sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"/g,' ');
const WRITE_SQL=/\b(?:insert|update|delete|replace|drop|alter|create|vacuum|attach|detach|reindex)\b|\bpragma\s+[\w.]+\s*=|(?:^|\n)\s*\.(?:import|restore|load|read|output|once|save|backup|clone|shell|system)\b/i;
const writesSql=sql=>WRITE_SQL.test(stripSql(sql));

function sqliteRule(args,seg,ctx){
  let readonly=false,i=0;const extra=[];
  for(;i<args.length&&args[i].text.startsWith('-')&&args[i].text!=='-';i++){
    const option=args[i].text.toLowerCase().replace(/^--/,'-');
    if(option==='-readonly')readonly=true;
    else if(option==='-cmd'){extra.push(args[i+1]?.text??'');i++;}
    else if(option==='-init')return ask('sqlite3 -init ejecuta un archivo de comandos');
    else if(['-separator','-newline','-nullvalue','-vfs','-mmap','-pagecache','-lookaside','-heap','-maxsize','-escape'].includes(option))i++;
  }
  const database=args[i];
  if(!database)return ALLOW;
  const statements=args.slice(i+1);
  if(database.dynamic||statements.some(w=>w.dynamic))return ask('sqlite3 con base o SQL dinámicos');
  if(database.text===':memory:'||database.text==='')return ALLOW;
  let sql=[...extra,...statements.map(w=>w.text)].join('\n');
  if(seg.stdin!==null)sql+='\n'+seg.stdin;
  const input=seg.redirects.find(r=>r.op==='<');
  if(input?.target){
    const text=expand(input.target);
    if(text===null)return ask('script SQL de entrada dinámico');
    try{sql+='\n'+fs.readFileSync(locate(text,ctx).real,'utf8').slice(0,1048576);}
    catch{return ask('no se pudo leer el script SQL de entrada');}
  }
  if(!sql.trim())return ask('sqlite3 interactivo o alimentado por una tubería sobre un archivo');
  if(!writesSql(sql))return ALLOW;
  if(readonly&&!/(?:^|\n)\s*\.(?:output|once|save|backup|clone|shell|system|import)\b/i.test(sql))return ALLOW;
  const loc=locate(database.text,ctx);
  if(loc.temp||!exists(loc.real))return ALLOW;
  return ask(`SQL de escritura sobre una base existente: ${loc.abs}`);
}

// ---------------------------------------------------------------- Android

const PRODUCTION='com.smartfin';
const SYNTHETIC=/^com\.smartfin\.[a-z0-9_.]+$/i;
const PRODUCTION_PATH=/\/com\.smartfin(?:\/|$)/i;

function adbRule(args,ctx){
  const a=args.map(w=>w.text);let i=0;
  while(i<a.length&&a[i].startsWith('-'))i+=['-s','-t','-H','-P','-L'].includes(a[i])?2:1;
  const op=(a[i]??'').toLowerCase(),words=args.slice(i+1),r=a.slice(i+1);
  switch(op){
    case 'uninstall': {
      const packages=r.filter(x=>!x.startsWith('-'));
      if(packages.includes(PRODUCTION))return deny('desinstalar com.smartfin borra los datos financieros del dispositivo');
      return packages.every(p=>SYNTHETIC.test(p))?ALLOW:ask('desinstala un paquete del dispositivo');
    }
    case 'install': case 'install-multiple': case 'install-multi-package':
      return r.includes('-d')?ask('instalar con downgrade (-d) puede romper la migración de la base'):ALLOW;
    case 'push':
      return PRODUCTION_PATH.test(r.at(-1)??'')?deny('escribe en el almacenamiento privado de com.smartfin'):ALLOW;
    case 'pull':
      return r.filter(x=>!x.startsWith('-')).length>=2?writeTarget(words.at(-1),ctx):ALLOW;
    case 'shell': case 'exec-out':
      if(!words.length)return ALLOW;
      if(words.some(w=>w.dynamic))return ask('adb shell con contenido dinámico');
      return remoteShell(words.map(w=>w.text).join(' '));
    case 'reboot': case 'root': case 'unroot': case 'remount': case 'disable-verity': case 'enable-verity':
    case 'sideload': case 'restore': case 'emu':
      return ask(`adb ${op}`);
    default:
      return ALLOW;
  }
}

function remoteShell(text){
  let segments;
  try{segments=lex(text,'bash');}catch{return ask('comando adb shell no analizable');}
  return worst(segments.map(remoteCommand));
}

function remoteCommand(seg){
  if(seg.redirects.some(r=>(r.op==='>'||r.op==='>>')&&r.target&&PRODUCTION_PATH.test(r.target.text)))
    return deny('escribe en el almacenamiento privado de com.smartfin');
  let words=seg.words.map(w=>w.text),asProduction=false;
  if(words[0]==='run-as'){asProduction=words[1]===PRODUCTION;words=words.slice(2);}
  const [command='',...rest]=words;
  if((command==='sh'||command==='bash')&&rest[0]==='-c'&&rest[1]&&!asProduction)return remoteShell(rest[1]);
  if(asProduction&&['rm','mv','cp','dd','truncate','tee','chmod','chown','ln','sh','bash','toybox','busybox'].includes(command))
    return deny('modifica archivos privados de com.smartfin con run-as');
  if(command==='pm'||(command==='cmd'&&rest[0]==='package')){
    const sub=command==='pm'?rest:rest.slice(1);
    if(['clear','uninstall'].includes(sub[0])){
      const packages=sub.slice(1).filter(x=>!x.startsWith('-')&&!/^\d+$/.test(x));
      if(packages.includes(PRODUCTION))return deny(`pm ${sub[0]} com.smartfin borra los datos financieros del dispositivo`);
      return packages.every(p=>SYNTHETIC.test(p))?ALLOW:ask(`pm ${sub[0]} sobre otro paquete`);
    }
    return ALLOW;
  }
  if(command==='rm'){
    const targets=rest.filter(x=>!x.startsWith('-'));
    if(targets.some(x=>PRODUCTION_PATH.test(x)))return deny('borra archivos privados de com.smartfin');
    if(rest.some(x=>/^-[a-z]*r/i.test(x))&&!targets.every(x=>x.startsWith('/data/local/tmp/')||x.startsWith('/sdcard/')))
      return ask('borrado recursivo en el dispositivo');
    return ALLOW;
  }
  if(command==='sqlite3'){
    const database=rest.find(x=>!x.startsWith('-'));
    if(database&&(asProduction||PRODUCTION_PATH.test(database))&&writesSql(rest.slice(rest.indexOf(database)+1).join('\n')))
      return deny('SQL de escritura sobre la base de com.smartfin');
    return ALLOW;
  }
  if(['reboot','wipe','recovery'].includes(command))return ask(`adb shell ${command}`);
  if(command==='content'&&['delete','update','insert'].includes(rest[0]))return ask('modifica un content provider del dispositivo');
  return ALLOW;
}

// ---------------------------------------------------------------- Write / Edit / NotebookEdit

const DANGEROUS_SQL=/\bDROP\s+(?:TABLE|TRIGGER)\b|\bPRAGMA\s+(?:foreign_keys|writable_schema)\s*=\s*(?:OFF|ON|0|1|FALSE|TRUE)\b/gi;
const dangerousSql=text=>(text.match(DANGEROUS_SQL)??[]).length;

function editRule(tool,input,ctx){
  const file=tool==='NotebookEdit'?input.notebook_path:input.file_path;
  if(typeof file!=='string'||/[\0\r\n]/.test(file))return ask('ruta de archivo no válida');
  const loc=locate(file,ctx);
  if(unc(loc))return ask(`edición en una ruta UNC: ${file}`);
  if(sensitive(loc)&&exists(loc.real))return deny('sobrescribiría una base de datos, respaldo, exportación o secreto existente');
  if(guarded(loc))return controlAsk(loc);
  if(tool==='NotebookEdit'||!loc.root||!financialSource(loc.rel))return ALLOW;
  const edits=tool==='MultiEdit'?input.edits:[input];
  if(!Array.isArray(edits))return ask('edición no analizable');
  for(const edit of edits){
    const added=tool==='Write'?edit?.content:edit?.new_string;
    let removed=tool==='Write'?'':edit?.old_string;
    if(typeof added!=='string'||typeof removed!=='string')return ask('edición no analizable');
    if(tool==='Write'){try{removed=fs.readFileSync(loc.real,'utf8');}catch{removed='';}}
    if(removed.trim()&&!added.trim())return ask('elimina código de persistencia o seguridad sin reemplazo');
    if(dangerousSql(added)>dangerousSql(removed))
      return ask('introduce DROP TABLE/TRIGGER o cambia PRAGMA foreign_keys/writable_schema en código de persistencia');
  }
  return ALLOW;
}

// ---------------------------------------------------------------- entry point

function evaluate(event){
  try{
    if(!event||typeof event!=='object'||typeof event.tool_name!=='string'||!event.tool_input||typeof event.tool_input!=='object')
      return ask('evento de herramienta mal formado');
    const input=event.tool_input;
    REASSIGNED=new Set();
    const ctx={cwd:typeof event.cwd==='string'?event.cwd:ROOT,unknownCwd:false,depth:0,dirs:[],written:new Set()};
    switch(event.tool_name){
      case 'Bash': case 'PowerShell': case 'powershell': {
        if(typeof input.command!=='string'||!input.command.trim())return ask('comando vacío');
        if(input.command.length>131072)return ask('comando demasiado largo para analizarlo');
        return evaluateShell(input.command,event.tool_name==='Bash'?'bash':'powershell',ctx);
      }
      case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit':
        return editRule(event.tool_name,input,ctx);
      default:
        return ALLOW;
    }
  }catch(error){
    return ask(error instanceof Unsupported?'no se pudo analizar: '+error.message:'el guard no pudo analizar la operación');
  }
}

if(require.main===module){
  let input='',oversized=false;
  const emit=result=>{
    if(result.decision!=='allow')process.stdout.write(JSON.stringify({hookSpecificOutput:{
      hookEventName:'PreToolUse',permissionDecision:result.decision,permissionDecisionReason:result.reason}}));
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{if(input.length+chunk.length>2*1024*1024)oversized=true;else if(!oversized)input+=chunk;});
  process.stdin.on('error',()=>emit(ask('no se pudo leer el evento')));
  process.stdin.on('end',()=>{
    let event=null;
    try{if(!oversized)event=JSON.parse(input);}catch{event=null;}
    emit(event?evaluate(event):ask('evento ilegible o demasiado grande'));
  });
}
module.exports={evaluate,lex,controlPath,CONTROL_DIRS,CONTROL_FILES,HOOK_SUITES};
