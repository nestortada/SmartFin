'use strict';
// Synthetic events against the INSTALLED adapter's evaluate(). Executes none of the commands.
// Usage: node docs/validacion-fase6b3-1/authorization/guard-stage-a/installed-guard.test.cjs <before-refresh|after-refresh|revoked>
const assert=require('node:assert/strict');
const path=require('node:path');
const {evaluate}=require(path.resolve(__dirname,'../../../../.claude/hooks/dangerous-command-guard.cjs'));
const {pins,checkStageA}=require(path.resolve(__dirname,'../../../../.claude/hooks/phase6b3-stage-a.cjs'));
const stage=process.argv[2];
if(!['before-refresh','after-refresh','revoked'].includes(stage))throw Error('Stage argument required');
const repo=pins.repo, android=pins.workspace+'/android';
const refresh=pins.refresh.command, build=pins.build.command;
// Optional second argument `simulate-boundary`: composes the PROPOSED boundary rule in the proposed
// adapter order (runner, stage A, boundary, rest). It only denies, so it is applied over evaluate().
const simulate=process.argv[3]==='simulate-boundary';
const boundary=simulate?require(path.resolve(__dirname,'../guard-boundary/build-script-boundary.cjs')).checkBoundary:null;
const core=simulate?require(path.resolve(__dirname,'../../../../.codex/hooks/dangerous-command-guard.cjs')):null;
const {bashToPowerShell}=require(path.resolve(__dirname,'../../../../.claude/hooks/dangerous-command-guard.cjs'));
const decide=(command,cwd=repo,tool='PowerShell')=>{
  const result=evaluate({hook_event_name:'PreToolUse',cwd,tool_name:tool,tool_input:{command}});
  if(!simulate||checkStageA(command,tool,cwd,{verifyRefresh:()=>false,verifyBuild:()=>false})!==null)return result;
  const extra=boundary(command,tool,cwd,core,bashToPowerShell);
  return extra&&result.decision==='allow'?extra:result;
};
const rows=[], failures=[];
// Records every decision and which layer gave it: the stage A extension, or the rest of the guard
// (null from checkStageA). Collects every mismatch instead of stopping at the first one.
const expect=(label,command,cwd,tool,wanted)=>{
  const result=decide(command,cwd,tool);
  const layer=checkStageA(command,tool,cwd,{verifyRefresh:()=>false,verifyBuild:()=>false})===null?'rest-of-guard':'stage-a';
  rows.push({label,decision:result.decision,layer,reason:result.reason||''});
  if(wanted&&result.decision!==wanted)failures.push({label,wanted,got:result.decision,layer});
};

// Exact commands: the decision depends on the stage preconditions.
const exact={'before-refresh':['allow','deny'],'after-refresh':['deny','allow'],revoked:['deny','deny']}[stage];
expect('refresh exact, repo',refresh,repo,'PowerShell',exact[0]);
expect('build exact, workspace/android',build,android,'PowerShell',exact[1]);
// Exact commands in the wrong place or tool: always refused by the extension.
expect('refresh in workspace',refresh,pins.workspace,'PowerShell','deny');
expect('refresh in android',refresh,android,'PowerShell','deny');
expect('build in repo',build,repo,'PowerShell','deny');
expect('build in workspace root',build,pins.workspace,'PowerShell','deny');
expect('refresh via Bash',refresh,repo,'Bash','deny');
expect('build via Bash',build,android,'Bash','deny');
// Variations must never be allowed.
const variations=[
  ['refresh + extra arg',refresh+' extra',repo],
  ['refresh chained ;',refresh+'; adb devices',repo],
  ['refresh chained &&',refresh+' && echo x',repo],
  ['build installRelease',build.replace('assembleRelease','installRelease'),android],
  ['build + installRelease',build+' installRelease',android],
  ['build without --offline',build.replace('--offline ',''),android],
  ['build + extra task',build+' clean',android],
  ['build chained',build+'; adb devices',android],
  ['run-all API24','./scripts/phase6b3/run-all.ps1 -Serial emulator-5554 -Api 24',repo],
  ['run-all API35','./scripts/phase6b3/run-all.ps1 -Serial AXCC6R3919012932 -Api 35',repo],
  ['run-android UI','./scripts/phase6b3/run-android.ps1 -Serial emulator-5554 -Campaign phase6b3-ui-small -Output docs/validacion-fase6b3-1/android/api24/phase6b3-ui-small -KeepRunning',repo],
  ['adb install','adb -s emulator-5554 install -r C:/sf-6b3-20261101/android/app/build/outputs/apk/release/app-release.apk',repo],
  ['adb HONOR shell','adb -s AXCC6R3919012932 shell pm list packages',repo],
  ['adb uninstall prod','adb -s emulator-5554 uninstall com.smartfin',repo],
  ['prepare-android','node scripts/phase6b3/prepare-android.cjs',repo],
  ['make-runner','node scripts/phase6b3/make-runner.cjs',repo],
];
for(const [label,command,cwd] of variations)expect(label,command,cwd,'PowerShell','deny');
// Original rules still active: read-only ADB query and 6B.2 runner pin keep their own decisions.
expect('readonly adb devices (original rule)','adb devices -l',repo,'PowerShell','allow');
expect('6B.2 runner (original pin, APK 6B.2 not in its harness state)','./scripts/phase6b2/run-all.ps1 -Serial emulator-5554 -Api 24',repo,'PowerShell');

console.log(JSON.stringify({stage,rows,failures},null,1));
assert.deepEqual(failures,[],'installed-guard: '+stage+' has unexpected decisions');
console.log('installed-guard: '+stage+' checks passed');
