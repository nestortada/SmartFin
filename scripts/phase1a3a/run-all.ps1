param([Parameter(Mandatory=$true)][string]$Serial,[Parameter(Mandatory=$true)][int]$Api)
$ErrorActionPreference='Stop'
if(-not (($Serial -eq 'emulator-5554' -and $Api -eq 24) -or ($Serial -eq 'AXCC6R3919012932' -and $Api -eq 35))){throw 'Only the two authorized targets are supported'}
# 1a.3A campaigns first (each unknown-restart keeps the data of the unknown campaign right before it), then the
# seven 1a.2 r2 regressions with their original oracles.
foreach($campaign in @('phase1a3a-identity','phase1a3a-atomicity','phase1a3a-unknown','phase1a3a-unknown-restart','phase6b3-atomicity','phase1a2-atomicity-historical','phase1a2-statements','phase6b3-probes','phase6b3-unknown','phase6b3-unknown-restart','phase6a-precision')){
  $preserve=$campaign -in @('phase1a3a-unknown-restart','phase6b3-unknown-restart')
  ./scripts/phase1a3a/run-android.ps1 -Serial $Serial -Campaign $campaign -Output "docs/validacion-fase1a3a/android/api$Api/$campaign" -PreserveData:$preserve
}
