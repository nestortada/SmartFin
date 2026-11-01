'use strict';
// SmartFin PreToolUse guard, version 2 (Claude Code).
// Default-allow with a short deny list. Three outcomes:
//   deny  - irreversible loss of financial data, uncommitted Git work or the production app's data on a device;
//   ask   - risky or impossible to analyse: the owner approves that single call in the permission prompt;
//   allow - silent; Claude Code's own permission rules still apply.
// Self-contained: no PowerShell parser process and no per-phase hash pins, so new scripts,
// Gradle tasks and phases do not require editing the guard.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const norm=value=>value.replaceAll('\\','/').replace(/\/+$/,'').toLowerCase();
const beneath=(candidate,parent)=>candidate===parent||candidate.startsWith(parent+'/');
function findRoot(){
  if(process.env.SMARTFIN_ROOT)return path.resolve(process.env.SMARTFIN_ROOT);
  for(let dir=__dirname;;dir=path.dirname(dir)){
    if(fs.existsSync(path.join(dir,'AGENTS.md'))&&fs.existsSync(path.join(dir,'package.json')))return dir;
    if(path.dirname(dir)===dir)return path.resolve(__dirname,'../..');
  }
}
const ROOT=norm(findRoot());
const HOME=norm(os.homedir());
const TEMP=norm(os.tmpdir());
// Sibling worktrees and audit copies: C:\sf-6b3-20261101, C:\sfphase2, C:\sfatomicity1...
const WORKTREE=/^[a-z]:\/sf[^/]*/;

const RANK={allow:0,ask:1,deny:2};
const ALLOW=Object.freeze({decision:'allow'});
const ask=reason=>({decision:'ask',reason:'DG2: '+reason});
const deny=reason=>({decision:'deny',reason:'DG2: '+reason});
const worst=results=>results.reduce((a,b)=>RANK[b.decision]>RANK[a.decision]?b:a,ALLOW);
class Unsupported extends Error{}
const exists=file=>{try{fs.lstatSync(file);return true;}catch{return false;}};
const isDirectory=file=>{try{return fs.statSync(file).isDirectory();}catch{return false;}};
const commandName=text=>text.replaceAll('\\','/').split('/').at(-1).toLowerCase().replace(/\.(?:exe|cmd|bat|com)$/,'');

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

// Resolves the few variables whose value is known; anything else stays dynamic (null).
function expand(word){
  if(!word.dynamic)return word.text;
  const match=KNOWN_VARS.exec(word.text);
  if(!match)return null;
  const rest=word.text.slice(match[0].length);
  if(rest.includes('$'))return null;
  const name=(match[1]??match[2]).toLowerCase();
  const value=name==='home'||name==='userprofile'?os.homedir():
    name==='localappdata'?(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData/Local')):os.tmpdir();
  return value+rest;
}

function locate(text,ctx){
  let value=text;
  if(/^\/tmp(?=\/|$)/.test(value))value=os.tmpdir()+value.slice(4); // Git Bash /tmp
  else if(/^\/[a-z](?:\/|$)/i.test(value))value=value[1]+':/'+value.slice(3); // Git Bash /c/...
  if(value==='~'||/^~[\\/]/.test(value))value=os.homedir()+value.slice(1);
  const real=path.resolve(ctx.cwd,value),abs=norm(real);
  const root=beneath(abs,ROOT)?ROOT:(WORKTREE.exec(abs)?.[0]??null);
  return {real,abs,root,rel:root===null?null:abs.slice(root.length+1),temp:beneath(abs,TEMP)};
}
const relative=text=>!path.isAbsolute(text)&&!/^[a-z]:/i.test(text)&&!text.startsWith('~');

function critical(loc){
  if(loc.root===ROOT&&CRITICAL.has(loc.rel))return true;
  if(loc.root&&loc.root!==ROOT&&loc.rel!==''&&CRITICAL.has(loc.rel))return true;
  const a=loc.abs;
  return /^[a-z]:$/.test(a)||ROOT.startsWith(a+'/')||a===HOME||HOME.startsWith(a+'/')||
    /^[a-z]:\/(?:windows|program files(?: \(x86\))?|programdata)(?:\/|$)/.test(a);
}
// Guard configuration and project instructions: changes are approved by the owner.
function guarded(loc){
  if(loc.root===null)return false;
  const r=loc.rel;
  return r==='agents.md'||r==='claude.md'||beneath(r,'.codex')||beneath(r,'.agents')||beneath(r,'.git')||
    beneath(r,'.claude/hooks')||/^\.claude\/settings(?:\.local)?\.json$/.test(r);
}
const financialSource=rel=>beneath(rel,'src/database')||beneath(rel,'src/modules/security')||
  /(?:sqlitefinancialdatarepository|smartfin(?:security|localsnapshot|backuppublisher|financialdeletion))\./.test(rel);

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
function lex(src,shell){
  const bash=shell==='bash',cmd=shell==='cmd',esc=bash?'\\':cmd?'^':'`';
  const segments=[],heredocs=[];
  let seg,word=null,redirect=null;
  const fresh=()=>{seg={words:[],redirects:[],stdin:null,subs:[],call:false};};
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
    if(seg.words.length||seg.redirects.length||seg.subs.length||seg.stdin!==null||heredocs.some(doc=>doc.seg===seg))segments.push(seg);
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
      const quote=src[i+1],stop=src.indexOf('\n'+quote+'@',i+2);
      if(stop<0)throw new Unsupported('here-string sin cerrar');
      const body=src.slice(i+2,stop).replace(/^\r?\n/,'').replace(/\r$/,'');
      const w=open();w.text+=body;
      if(quote==='"'&&/\$[\w{(]/.test(body))w.dynamic=true;
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
    if(c===' '||c==='\t'||c==='\r'||(shell==='powershell'&&c===',')){close();continue;}
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
      if(src[i+1]==='&'){i++;while(/[\d-]/.test(src[i+1]??''))i++;continue;}
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
    if(';|&(){}'.includes(c)){
      if(c==='&'&&shell==='powershell'&&!word&&!seg.words.length&&src[i+1]!=='&'){seg.call=true;continue;}
      end();
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
const DELETERS=new Set(['rm','rmdir','unlink','shred','remove-item','ri','del','erase','rd','clear-content','clc','rimraf','trash']);
const WRITERS=new Set(['tee','tee-object','set-content','add-content','ac','out-file','new-item','ni','cp','copy','copy-item','cpi',
  'mv','move','move-item','mi','ren','rename','rename-item','rni','sed','truncate','dd']);
const INTERPRETERS=new Set(['node','python','python3','py','ruby','perl','deno','bun']);
const SYSTEM_DENY=new Set(['format','format-volume','diskpart','clear-disk','initialize-disk','remove-partition','mkfs',
  'shutdown','stop-computer','restart-computer']);
const SYSTEM_ASK=new Set(['set-executionpolicy','reg','bcdedit','netsh','takeown','icacls','cacls','set-mppreference',
  'add-mppreference','schtasks','vssadmin','setx','wsl']);
const REGISTRY_CMDLETS=new Set(['set-itemproperty','sp','new-itemproperty','remove-itemproperty','rp','rename-itemproperty']);

function evaluateShell(src,shell,ctx){
  if(ctx.depth>6)return ask('demasiados niveles de shells anidados');
  const segments=lex(src,shell),results=[];
  if(shell==='powershell'&&/\]::\s*(?:Delete|Move|Replace|Copy|WriteAll\w*|AppendAll\w*)\s*\(|\.(?:Delete|MoveTo|CopyTo|WriteAll\w*|AppendAll\w*|SetLength)\s*\(/i.test(src))
    results.push(ask('llamada .NET que modifica archivos'));
  for(const seg of segments){
    const inner={...ctx,depth:ctx.depth+1};
    for(const sub of seg.subs)results.push(evaluateShell(sub,shell,inner));
    for(const r of seg.redirects)if(r.op==='>'||r.op==='>>')results.push(writeTarget(r.target,ctx));
    results.push(commandRule(seg,shell,ctx));
  }
  return worst(results);
}

function commandRule(seg,shell,ctx){
  let words=seg.words;
  for(;;){
    if(!words.length)return ALLOW;
    const head=words[0];
    if(shell==='bash'&&/^[A-Za-z_]\w*=/.test(head.text)){words=words.slice(1);continue;}
    // PowerShell assignment: $x = <command>
    if(shell==='powershell'&&/^\$[\w:]+$/.test(head.text)&&/^[-+*/]?=$/.test(words[1]?.text??'')){words=words.slice(2);continue;}
    const name=commandName(head.text);
    if(WRAPPERS.has(name)){
      words=words.slice(1);
      while(words.length&&(words[0].text.startsWith('-')||(name==='env'&&/^[A-Za-z_]\w*=/.test(words[0].text))))words=words.slice(1);
      continue;
    }
    if(name==='timeout'&&shell==='bash'){
      words=words.slice(1);
      while(words.length&&words[0].text.startsWith('-'))words=words.slice(1);
      words=words.slice(1);continue;
    }
    break;
  }
  const head=words[0],args=words.slice(1);
  if(head.dynamic){
    // A PowerShell expression such as $list.Count is not a program launch unless called with &.
    if(shell==='powershell'&&!seg.call)return ALLOW;
    return ask(`programa dinámico: ${head.text}`);
  }
  const name=commandName(head.text);
  if(['cd','chdir','set-location','sl','pushd','push-location','popd','pop-location'].includes(name)){
    const target=args.find(w=>!w.text.startsWith('-'));
    const value=name.startsWith('pop')?null:target?expand(target):os.homedir();
    if(value===null)ctx.unknownCwd=true;else ctx.cwd=locate(value,ctx).real;
    return ALLOW;
  }
  if(name==='git')return gitRule(args,ctx);
  if(name==='adb')return adbRule(args,ctx);
  if(name==='sqlite3'||name==='sqlite')return sqliteRule(args,seg,ctx);
  if(/^gradlew?$/.test(name))
    return args.some(w=>/uninstall/i.test(w.text))?ask('una tarea Gradle uninstall* borra la app y sus datos del dispositivo'):ALLOW;
  if(DELETERS.has(name))return deleteRule(args,shell,ctx);
  if(WRITERS.has(name))return writeRule(name,args,ctx);
  if(name==='sc'&&shell==='powershell')return writeRule('set-content',args,ctx);
  if(name==='xargs')return xargsRule(args,shell,ctx);
  if(name==='find')return findRule(args);
  if(Object.hasOwn(SHELLS,name))return nestedShellRule(name,args,seg,ctx);
  if(['eval','iex','invoke-expression'].includes(name)){
    if(args.some(w=>w.dynamic))return ask('eval con contenido dinámico');
    return evaluateShell(args.map(w=>w.text).join(' '),shell,{...ctx,depth:ctx.depth+1});
  }
  if(['start-process','saps','start'].includes(name))return startRule(args,ctx);
  if(INTERPRETERS.has(name))return interpreterRule(name,args,seg);
  if(SYSTEM_DENY.has(name))return deny(`operación destructiva del sistema (${name})`);
  if(SYSTEM_ASK.has(name))return ask(`cambia configuración del sistema (${name})`);
  if(REGISTRY_CMDLETS.has(name)&&args.some(w=>/^(?:hk(?:lm|cu|cr|u|cc)|registry):/i.test(w.text)))return ask('modifica el registro de Windows');
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
    const w=args[i],t=w.text;
    if(!endOptions&&t==='--'){endOptions=true;continue;}
    if(!endOptions&&!w.dynamic&&((t.startsWith('-')&&t.length>1)||/^\/[a-z]$/i.test(t))){
      if(/^-(?:path|literalpath|lp|pspath)$/i.test(t)){if(args[i+1])targets.push(args[++i]);continue;}
      if(/^-stream$/i.test(t))return ask('borrado de flujos alternativos de archivo');
      if(/^-(?:filter|include|exclude|erroraction|ea|errorvariable|ev|credential|depth)$/i.test(t)){i++;continue;}
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
  if(/^[a-z]{2,}:/i.test(text))return ask(`borrado en un proveedor de PowerShell: ${text}`);
  if(ctx.unknownCwd&&relative(text))return ask('borrado relativo después de cambiar a un directorio desconocido');
  if(word.glob)return globDelete(text,recursive,ctx);
  const loc=locate(text,ctx);
  if(sensitive(loc))return deny('borraría una base de datos, respaldo, exportación o secreto; si de verdad hay que borrarlo, hazlo tú');
  if(critical(loc))return deny(`borraría ${loc.abs} (raíz del repositorio, código fuente, historial Git o carpeta del sistema)`);
  if(loc.root&&loc.root!==ROOT&&loc.rel==='')return ask(`borra el worktree completo ${loc.abs}`);
  if(guarded(loc))return ask('modifica la configuración del guard o las instrucciones del proyecto');
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
  if(critical(dir)||(dir.root&&dir.rel==='')){
    if(everything)return recursive?deny(`borrado recursivo de todo el contenido de ${dir.abs}`):ask(`borra todos los archivos de ${dir.abs}`);
    return recursive?ask(`borrado recursivo con comodín dentro de ${dir.abs}`):ALLOW;
  }
  if(!dir.root&&!dir.temp)return ask(`borrado con comodín fuera de SmartFin: ${dir.abs}`);
  if(recursive&&!dir.temp&&!GENERATED.has(path.basename(dir.abs))&&containsSensitive(dir.real)==='yes')
    return ask(`la carpeta ${dir.abs} contiene bases de datos, respaldos o exportaciones`);
  return ALLOW;
}

function writeTarget(word,ctx){
  if(!word)return ask('redirección sin destino');
  if(DISCARD.has(word.text.toLowerCase()))return ALLOW;
  const text=expand(word);
  if(text===null)return ask(`escritura con destino dinámico: ${word.text}`);
  if(word.glob)return ask(`escritura con comodines: ${text}`);
  if(ctx.unknownCwd&&relative(text))return ask('escritura relativa después de cambiar a un directorio desconocido');
  if(/^[a-z]{2,}:/i.test(text))return /^(?:hk\w+|registry|cert):/i.test(text)?ask(`escribe en ${text}`):ALLOW;
  const loc=locate(text,ctx);
  // Creating a new database or export is fine; overwriting an existing one is not.
  if(sensitive(loc)&&exists(loc.real))return deny('sobrescribiría una base de datos, respaldo, exportación o secreto existente');
  if(guarded(loc))return ask('modifica la configuración del guard o las instrucciones del proyecto');
  return ALLOW;
}

function moveSource(word,ctx){
  const text=expand(word);
  if(text===null)return ask(`mueve un origen dinámico: ${word.text}`);
  if(word.glob)return globSensitive(text.split(/[\\/]/).at(-1))?deny('movería bases de datos, respaldos o exportaciones'):ALLOW;
  const loc=locate(text,ctx);
  if(sensitive(loc)&&exists(loc.real))return deny('movería una base de datos, respaldo, exportación o secreto');
  if(critical(loc))return deny(`movería ${loc.abs}`);
  if(guarded(loc))return ask('modifica la configuración del guard o las instrucciones del proyecto');
  return ALLOW;
}

const VALUE_OPTIONS=new Set(['-path','-literalpath','-lp','-pspath','-destination','-filepath','-name','-newname','-value',
  '-encoding','-itemtype','-type','-filter','-include','-exclude','-inputobject','-width','-erroraction','-ea','-credential',
  '-variable','-target','-t','--target-directory','-s','--suffix','-delimiter']);
function parseArgs(args){
  const positional=[],named={};let endOptions=false;
  for(let i=0;i<args.length;i++){
    const w=args[i],t=w.text,l=t.toLowerCase();
    if(!endOptions&&t==='--'){endOptions=true;continue;}
    if(!endOptions&&!w.dynamic&&t.length>1&&t.startsWith('-')){
      if(l.startsWith('--')&&l.includes('=')){named[l.slice(0,l.indexOf('='))]={...w,text:t.slice(t.indexOf('=')+1)};continue;}
      if(VALUE_OPTIONS.has(l)&&args[i+1])named[l]=args[++i];
      continue;
    }
    positional.push(w);
  }
  return {positional,named};
}

function writeRule(name,args,ctx){
  if(name==='sed')return sedRule(args,ctx);
  if(name==='dd'){
    const output=args.find(w=>w.text.startsWith('of='));
    if(!output)return ALLOW;
    const text=output.text.slice(3);
    if(/^\/dev\/(?!null$)|physicaldrive|^\\\\\.\\/i.test(text))return deny('dd escribiría directamente sobre un dispositivo');
    return writeTarget({...output,text},ctx);
  }
  const {positional,named}=parseArgs(args);
  if(name==='tee')return worst(positional.map(w=>writeTarget(w,ctx)));
  if(name==='truncate')return worst(positional.map(w=>writeTarget(w,ctx)));
  if(['tee-object','set-content','add-content','ac','out-file','new-item','ni'].includes(name)){
    let target=named['-path']??named['-literalpath']??named['-lp']??named['-filepath']??positional[0];
    if(named['-name']){
      const base=target??{text:'.',dynamic:false,glob:false};
      target={text:path.join(base.text,named['-name'].text),dynamic:base.dynamic||named['-name'].dynamic,glob:base.glob||named['-name'].glob};
    }
    if(!target)return name==='tee-object'?ALLOW:ask(`${name} sin destino explícito`);
    return writeTarget(target,ctx);
  }
  const moving=!['cp','copy','copy-item','cpi'].includes(name);
  const sources=[named['-path'],named['-literalpath'],...positional].filter(Boolean);
  let destination=named['-destination']??named['-newname']??named['-t']??named['--target-directory'];
  if(!destination){
    if(sources.length<2)return ask(`${name} sin origen y destino explícitos`);
    destination=sources.pop();
  }
  if(['ren','rename','rename-item','rni'].includes(name)&&!/[\\/]/.test(destination.text)&&sources[0])
    destination={...destination,text:path.join(path.dirname(sources[0].text),destination.text)};
  const results=[writeTarget(destination,ctx)];
  const resolved=expand(destination);
  for(const source of sources){
    if(moving)results.push(moveSource(source,ctx));
    // Copy or move into a directory: the real destination keeps the source name.
    if(resolved!==null&&!destination.glob&&!source.dynamic&&isDirectory(locate(resolved,ctx).real))
      results.push(writeTarget({text:path.join(resolved,path.basename(source.text)),dynamic:false,glob:false},ctx));
  }
  return worst(results);
}

function sedRule(args,ctx){
  let inPlace=false,script=false;const files=[];
  for(let i=0;i<args.length;i++){
    const t=args[i].text;
    if(t.startsWith('--in-place')||/^-[a-zA-Z]*i/.test(t)&&!t.startsWith('--')){inPlace=true;continue;}
    if(['-e','-f','--expression','--file'].includes(t)){script=true;i++;continue;}
    if(t.startsWith('-'))continue;
    if(!script){script=true;continue;}
    files.push(args[i]);
  }
  return inPlace?worst(files.map(w=>writeTarget(w,ctx))):ALLOW;
}

function xargsRule(args,shell,ctx){
  let i=0;
  while(i<args.length&&args[i].text.startsWith('-'))
    i+=/^-(?:[IinLPdsE]|-(?:replace|max-args|max-procs|delimiter|arg-file))$/.test(args[i].text)?2:1;
  const inner=args.slice(i);
  if(!inner.length)return ALLOW;
  const name=commandName(inner[0].text);
  if(DELETERS.has(name)||WRITERS.has(name)||['git','adb','sqlite3','sqlite'].includes(name)||Object.hasOwn(SHELLS,name))
    return ask(`xargs ejecuta ${name} con argumentos que llegan por la entrada`);
  return commandRule({words:inner,redirects:[],stdin:null,subs:[],call:false},shell,ctx);
}

function findRule(args){
  const t=args.map(w=>w.text);
  const acting=t.includes('-delete')||t.some((x,i)=>/^-(?:exec|execdir|ok|okdir)$/.test(x)&&
    /^(?:rm|del|shred|unlink|mv|truncate|sqlite3?)$/.test(commandName(t[i+1]??'')));
  if(!acting)return ALLOW;
  if(t.some((x,i)=>/^-(?:name|iname|path|ipath)$/.test(t[i-1]??'')&&globSensitive(x.split('/').at(-1))))
    return deny('find borraría bases de datos, respaldos o exportaciones');
  return ask('find con -delete o -exec que borra o modifica archivos');
}

// ---------------------------------------------------------------- nested execution

function nestedShellRule(name,args,seg,ctx){
  const kind=SHELLS[name],inner={...ctx,depth:ctx.depth+1},texts=args.map(w=>w.text);
  if(kind==='cmd'){
    const index=texts.findIndex(t=>/^\/[ck]$/i.test(t));
    if(index<0)return seg.stdin!==null?evaluateShell(seg.stdin,'cmd',inner):ALLOW;
    return evaluateShell(texts.slice(index+1).join(' '),'cmd',inner);
  }
  if(kind==='bash'){
    const index=texts.findIndex(t=>/^-[a-z]*c[a-z]*$/.test(t));
    if(index>=0)return args[index+1]?evaluateShell(args[index+1].text,'bash',inner):ALLOW;
    if(!texts.some(t=>!t.startsWith('-'))&&seg.stdin!==null)return evaluateShell(seg.stdin,'bash',inner);
    return ALLOW; // a script file is its own boundary
  }
  for(let i=0;i<texts.length;i++){
    const t=texts[i].toLowerCase();
    if(/^-(?:e|ec|en|enc|enco|encod|encode|encoded|encodedc\w*|encodeda\w*)$/.test(t))return ask('PowerShell con comando codificado');
    if(t.length>=2&&'-command'.startsWith(t))return evaluateShell(texts.slice(i+1).join(' '),'powershell',inner);
    if(t.length>=2&&'-file'.startsWith(t))return ALLOW;
  }
  return seg.stdin!==null?evaluateShell(seg.stdin,'powershell',inner):ALLOW;
}

function startRule(args,ctx){
  let file=null;const rest=[];
  for(let i=0;i<args.length;i++){
    const t=args[i].text.toLowerCase();
    if(t==='-verb'){if(/runas/i.test(args[i+1]?.text??''))return ask('ejecución con privilegios de administrador');i++;continue;}
    if(['-filepath','-file','-f'].includes(t)){file=args[++i]??null;continue;}
    if(['-argumentlist','-args','-a'].includes(t)){while(args[i+1]&&!args[i+1].text.startsWith('-'))rest.push(args[++i]);continue;}
    if(t.startsWith('-')){if(/^-(?:workingdirectory|wd|redirectstandard\w*|windowstyle|credential)$/.test(t))i++;continue;}
    if(!file)file=args[i];else rest.push(args[i]);
  }
  if(!file)return ALLOW;
  if(file.dynamic||rest.some(w=>w.dynamic))return ask('Start-Process con programa o argumentos dinámicos');
  const text="'"+file.text.replaceAll("'","''")+"' "+rest.map(w=>w.text).join(' ');
  return evaluateShell(text,'powershell',{...ctx,depth:ctx.depth+1});
}

const CATASTROPHE=/git\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+(?:-f\b|--force)|filter-branch)|(?:pm\s+clear|uninstall)\s+com\.smartfin(?![\w.])|format-volume|diskpart/i;
function inlineCode(code){
  if(CATASTROPHE.test(code))return ask('código en línea que ejecuta una operación destructiva');
  if(/\.(?:db|sqlite3?)\b|smartfin-(?:backup|manifest|generation)|\.keystore|\.env\b/i.test(code)&&
     /unlink|rmSync|rmdirSync|rimraf|writeFile|truncate|os\.remove|shutil\.rmtree|\bopen\([^)]*,\s*['"][wa]|\bDROP\s|DELETE\s+FROM|UPDATE\s+\w+\s+SET/i.test(code))
    return ask('código en línea que modifica bases de datos, respaldos o secretos');
  return ALLOW;
}
function interpreterRule(name,args,seg){
  const python=/^py(?:thon3?)?$/.test(name);
  for(let i=0;i<args.length;i++){
    const t=args[i].text;
    if((['-e','-p','--eval','--print','-pe','-ne'].includes(t)||(python&&t==='-c'))&&args[i+1])
      return args[i+1].dynamic?ask('código en línea dinámico'):inlineCode(args[i+1].text);
    if(/^--(?:eval|print)=/.test(t))return inlineCode(t.slice(t.indexOf('=')+1));
    if(!t.startsWith('-'))return ALLOW; // a script file is its own boundary
  }
  return seg.stdin!==null?inlineCode(seg.stdin):ALLOW;
}

// ---------------------------------------------------------------- Git

function gitRule(args,ctx){
  const a=args.map(w=>w.text);let i=0,cwd=ctx.cwd;
  while(i<a.length&&a[i].startsWith('-')){
    const option=a[i];
    if(option==='-C'){cwd=path.resolve(cwd,a[i+1]??'.');i+=2;continue;}
    if(option==='-c'){
      if(/^(?:alias\.|core\.(?:hookspath|sshcommand|fsmonitor|pager|editor|gitproxy)|credential\.|url\.|protocol\.)/i.test(a[i+1]??''))
        return ask('git -c cambia configuración sensible');
      i+=2;continue;
    }
    if(['--git-dir','--work-tree','--namespace'].includes(option)){i+=2;continue;}
    i++;
  }
  const sub=a[i]??'',r=a.slice(i+1);
  const has=(...flags)=>r.some(x=>flags.includes(x));
  const shortHas=letter=>r.some(x=>/^-[a-zA-Z]+$/.test(x)&&x.includes(letter));
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
    case 'worktree':
      return r[0]==='remove'&&has('-f','--force')?ask('worktree remove --force descarta los cambios de ese worktree'):ALLOW;
    case 'tag':
      return has('-d','--delete','-f','--force')?ask('borra o mueve una etiqueta'):ALLOW;
    case 'remote':
      return ['add','remove','rm','set-url','rename'].includes(r[0])?ask('cambia los remotos del repositorio'):ALLOW;
    case 'config': {
      if(has('--get','--get-all','--get-regexp','--list','-l','--show-origin'))return ALLOW;
      if(has('--global','--system'))return ask('configuración global de Git');
      return r.some(x=>/^(?:alias\.|core\.(?:hookspath|sshcommand|fsmonitor|pager|editor)|credential\.|url\.)/i.test(x))
        ?ask('configuración sensible de Git'):ALLOW;
    }
    default:
      return ALLOW;
  }
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

// ---------------------------------------------------------------- Write / Edit

const DANGEROUS_SQL=/\bDROP\s+(?:TABLE|TRIGGER)\b|\bPRAGMA\s+(?:foreign_keys|writable_schema)\s*=\s*(?:OFF|ON|0|1|FALSE|TRUE)\b/gi;
const dangerousSql=text=>(text.match(DANGEROUS_SQL)??[]).length;

function editRule(tool,input,ctx){
  if(typeof input.file_path!=='string'||/[\0\r\n]/.test(input.file_path))return ask('ruta de archivo no válida');
  const loc=locate(input.file_path,ctx);
  if(sensitive(loc)&&exists(loc.real))return deny('sobrescribiría una base de datos, respaldo, exportación o secreto existente');
  if(guarded(loc))return ask('modifica la configuración del guard o las instrucciones del proyecto');
  if(!loc.root||!financialSource(loc.rel))return ALLOW;
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
    const ctx={cwd:typeof event.cwd==='string'?event.cwd:ROOT,unknownCwd:false,depth:0};
    switch(event.tool_name){
      case 'Bash': case 'PowerShell': case 'powershell': {
        if(typeof input.command!=='string'||!input.command.trim())return ask('comando vacío');
        if(input.command.length>131072)return ask('comando demasiado largo para analizarlo');
        return evaluateShell(input.command,event.tool_name==='Bash'?'bash':'powershell',ctx);
      }
      case 'Write': case 'Edit': case 'MultiEdit':
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
module.exports={evaluate,lex};
