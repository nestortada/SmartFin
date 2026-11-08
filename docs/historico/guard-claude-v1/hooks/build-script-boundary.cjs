'use strict';
// PROPOSED, NOT INSTALLED. Owner review required before copying to .claude/hooks/.
// Closes a gap found in 6B.3.1: the core treats `node <script>` and `gradlew` as execution
// boundaries, so any Gradle task (installRelease installs on a device through Gradle's own adb,
// outside the ADB rules) and any repository script (prepare-android writes outside SmartFin,
// capture-ui calls adb) were admitted. Exact audited launches are decided earlier by their own pins
// (phase6b2-runner, phase6b3-stage-a); everything else that reaches Gradle or a script is denied here.
const path=require('node:path');
// Same reader list as phase6b2-runner: commands that only read file names.
const readers=new Set(['git','get-content','gc','cat','type','select-string','sls','rg','grep','get-filehash','test-path',
  'get-item','gi','get-childitem','gci','ls','dir','head','tail','wc','echo','write-output','printf']);
const shells=new Set(['powershell','pwsh','cmd','start-process','saps','start','invoke-expression','iex','invoke-command','icm']);
const gradleName=/^gradlew?(?:\.bat|\.cmd|\.exe)?$/i;
const nodeName=/^node(?:\.exe)?$/i;
// A literal Gradle executable token, not gradle.properties or gradle/wrapper.
const gradleText=/(?:^|[\\/\s'"&;|(])gradlew?(?:\.bat|\.cmd|\.exe)?(?=$|[\s'";|&)])/i;
const nodeText=/(?:^|[\\/\s'"&;|(])node(?:\.exe)?(?=$|[\s'";|&)])/i;
const normalize=value=>String(value).replace(/^\/c\//i,'C:/').replaceAll('\\','/').replace(/\/$/,'').toLowerCase();
const base=name=>String(name||'').replaceAll('\\','/').split('/').at(-1).toLowerCase();

// The node script argument is the first argument that is not an option.
function nodeScript(args){
  for(const arg of args){
    if(arg===null)return null;
    if(!arg.startsWith('-'))return arg;
  }
  return undefined;
}
// Scripts under <repo>/scripts, or anywhere outside the repository, are not inspected by the core.
function deniedScript(script,cwd,repo){
  const target=normalize(path.resolve(cwd,script));
  const root=normalize(repo);
  return !target.startsWith(root+'/')||target.startsWith(root+'/scripts/');
}
function checkBoundary(source,tool,cwd,core,translateBash,repo='C:/Users/nesto/Proyectos/SmartFin'){
  const deny=reason=>({decision:'deny',reason:'DG-CLAUDE-BOUNDARY: '+reason});
  if(!gradleText.test(source)&&!nodeText.test(source))return null;
  let parsed;
  try{parsed=core.parsePowerShell(tool==='Bash'?translateBash(source):source);}
  catch{return deny('Gradle or Node command that cannot be parsed needs separate review');}
  const names=parsed.commands.map(item=>base(item.name));
  // Reading file names (for example hashing gradlew.bat) stays with the rest of the guard.
  if(!parsed.opaque&&names.length&&names.every(name=>readers.has(name)))return null;
  if(parsed.opaque)return deny('Opaque command naming Gradle or Node needs separate review');
  // A nested shell or launcher could run Gradle or a script without this check seeing it.
  if(names.some(name=>shells.has(name.replace(/\.exe$/,''))))return deny('Gradle or Node through a nested shell or launcher is not admitted');
  for(const item of parsed.commands){
    const name=base(item.name);
    if(gradleName.test(name))return deny('Only the exact audited Gradle build is admitted; other Gradle tasks need separate review');
    if(nodeName.test(name)){
      if(!Array.isArray(item.args))return deny('Dynamic Node arguments');
      const script=nodeScript(item.args);
      if(script===null)return deny('Dynamic Node script');
      if(script!==undefined&&deniedScript(script,cwd,repo))
        return deny('Repository scripts and scripts outside SmartFin run only through an exact audited pin');
    }
  }
  return null;
}
module.exports={checkBoundary};
