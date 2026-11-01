'use strict';
// Read-only checks of the proposed stage A extension. Launches nothing.
const assert=require('node:assert/strict');
const {checkStageA,inspectRefresh,inspectBuild,pins}=require('./phase6b3-stage-a.cjs');
const yes=()=>true, no=()=>false;
const opts={verifyRefresh:yes,verifyBuild:yes};
const refresh=pins.refresh.command, build=pins.build.command;

// Exact commands in their exact directory are allowed only when verification passes.
assert.deepEqual(checkStageA(refresh,'PowerShell',pins.repo,opts),{decision:'allow'});
assert.deepEqual(checkStageA(build,'PowerShell',pins.workspace+'/android',opts),{decision:'allow'});
assert.deepEqual(checkStageA('  '+refresh+'  ','PowerShell','c:\\users\\nesto\\proyectos\\smartfin',opts),{decision:'allow'});
assert.equal(checkStageA(refresh,'PowerShell',pins.repo,{...opts,verifyRefresh:no}).decision,'deny');
assert.equal(checkStageA(build,'PowerShell',pins.workspace+'/android',{...opts,verifyBuild:no}).decision,'deny');
assert.equal(checkStageA(refresh,'PowerShell',pins.repo,{...opts,verifyRefresh:()=>{throw Error('x');}}).decision,'deny');
// Withdrawn, wrong tool or wrong directory.
assert.equal(checkStageA(refresh,'PowerShell',pins.repo,{...opts,enabled:false}).decision,'deny');
assert.equal(checkStageA(refresh,'Bash',pins.repo,opts).decision,'deny');
assert.equal(checkStageA(build,'PowerShell',pins.repo,opts).decision,'deny');
assert.equal(checkStageA(refresh,'PowerShell',pins.workspace,opts).decision,'deny');
// Any variation is not a stage A command and receives no exception from this module.
for(const other of [
  refresh+'; adb devices', refresh+' extra', 'node scripts/phase6b3/prepare-android.cjs', 'node scripts/phase6b3/make-runner.cjs',
  'node scripts/phase6b3/capture-ui.cjs emulator-5554 x', build.replace('--offline ',''), build+' installRelease',
  build.replace('assembleRelease','installRelease'), './gradlew.bat assembleRelease', './scripts/phase6b3/run-all.ps1 -Serial emulator-5554 -Api 24',
  'adb -s emulator-5554 install x.apk', '& '+refresh,
])assert.equal(checkStageA(other,'PowerShell',pins.repo,opts),null,other);

// Live, read-only diagnostic on the current state (before the refresh).
const liveRefresh=inspectRefresh(), liveBuild=inspectBuild();
console.log(JSON.stringify({refreshFailures:liveRefresh,buildFailures:liveBuild}));
assert.deepEqual(liveRefresh,[],'refresh must be admissible now');
assert.ok(liveBuild.includes('attestation refreshed'),'build must stay denied until the clock fix is in the workspace');
console.log('phase6b3-stage-a: all checks passed');
