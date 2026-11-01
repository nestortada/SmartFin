'use strict';
// Read-only checks of the proposed boundary rule with the real core parser. Executes none of the commands.
const assert=require('node:assert/strict');
const path=require('node:path');
const core=require(path.resolve(__dirname,'../../../../.codex/hooks/dangerous-command-guard.cjs'));
const {bashToPowerShell}=require(path.resolve(__dirname,'../../../../.claude/hooks/dangerous-command-guard.cjs'));
const {checkBoundary}=require('./build-script-boundary.cjs');
const repo='C:/Users/nesto/Proyectos/SmartFin', android='C:/sf-6b3-20261101/android';
const refresh='node scripts/phase6b3/refresh-harness.cjs';
const build="./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'";
const decide=(command,cwd=repo,tool='PowerShell')=>checkBoundary(command,tool,cwd,core,bashToPowerShell);

// The 8 variations admitted by the installed guard in 6B.3.1 must now be denied.
for(const [command,cwd] of [
  [refresh+' extra',repo], [refresh+' && echo x',repo],
  [build.replace('assembleRelease','installRelease'),android], [build+' installRelease',android],
  [build.replace('--offline ',''),android], [build+' clean',android],
  ['node scripts/phase6b3/prepare-android.cjs',repo], ['node scripts/phase6b3/make-runner.cjs',repo],
])assert.equal(decide(command,cwd)?.decision,'deny',command);
// Other routes to the same effects.
for(const [command,cwd,tool] of [
  ['node scripts/phase6b3/capture-ui.cjs emulator-5554 x',repo,'PowerShell'],
  ['node ./scripts/phase6b3/refresh-harness.cjs',repo,'PowerShell'],
  ['node C:/Users/nesto/Proyectos/SmartFin/scripts/phase6b3/refresh-harness.cjs',repo,'PowerShell'],
  ['node C:/sf-6b3-20261101/anything.cjs',repo,'PowerShell'],
  ['node ../outside.cjs',repo,'PowerShell'],
  ['node --trace-warnings scripts/phase6b3/make-runner.cjs',repo,'PowerShell'],
  ['C:/sf-6b3-20261101/android/gradlew.bat installRelease',repo,'PowerShell'],
  ['gradle installRelease',android,'PowerShell'],
  ['& ./gradlew.bat tasks',android,'PowerShell'],
  ['pwsh -NoProfile -Command ./gradlew.bat installRelease',android,'PowerShell'],
  ['cmd /c gradlew.bat installRelease',android,'PowerShell'],
  ['Start-Process ./gradlew.bat -ArgumentList installRelease',android,'PowerShell'],
  ['node scripts/phase6b3/prepare-android.cjs',repo,'Bash'],
  ['./gradlew.bat installRelease',android,'Bash'],
])assert.equal(decide(command,cwd,tool)?.decision,'deny',command);
// Unrelated or read-only commands stay with the rest of the guard (null).
for(const [command,cwd] of [
  ['Get-FileHash -Algorithm SHA256 -LiteralPath C:/sf-6b3-20261101/android/gradlew.bat',repo],
  ['Get-Content android/gradle.properties',repo],
  ['Test-Path -LiteralPath C:/Users/nesto/.gradle/init.d',repo],
  ['git status --short',repo],
  ['npx tsc --noEmit',repo],
  ['npx jest --runInBand __tests__/phase6b3Reproduction.test.ts',repo],
  ['npm test -- --runInBand',repo],
  ['node docs/validacion-fase6b3-1/authorization/guard-stage-a/installed-guard.test.cjs before-refresh',repo],
  ['node --version',repo],
])assert.equal(decide(command,cwd),null,command);
console.log('build-script-boundary: all checks passed');
