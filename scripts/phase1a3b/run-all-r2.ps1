param([Parameter(Mandatory=$true)][string]$Serial,[Parameter(Mandatory=$true)][int]$Api)
$ErrorActionPreference='Stop'
if(-not (($Serial -eq 'emulator-5554' -and $Api -eq 24) -or ($Serial -eq 'AXCC6R3919012932' -and $Api -eq 35))){throw 'Only the two authorized targets are supported'}
# 1a.3B campaigns first: the start-up pair keeps the version 4 database seeded by phase1a3b-startup-seed (and its
# migrated state) across process restarts. Then the eleven 1a.3A/1a.2/6B.3/6A regressions with their original oracles
# (each unknown-restart keeps the data of the unknown campaign right before it).
foreach($campaign in @('phase1a3b-upgrade','phase1a3b-startup-seed','phase1a3b-startup-upgrade','phase1a3b-upgrade-restart','phase1a3b-migration-atomicity','phase1a3b-integrity','phase1a3b-flows','phase1a3a-identity','phase1a3a-atomicity','phase1a3a-unknown','phase1a3a-unknown-restart','phase6b3-atomicity','phase1a2-atomicity-historical','phase1a2-statements','phase6b3-probes','phase6b3-unknown','phase6b3-unknown-restart','phase6a-precision')){
  $preserve=$campaign -in @('phase1a3b-startup-upgrade','phase1a3b-upgrade-restart','phase1a3a-unknown-restart','phase6b3-unknown-restart')
  ./scripts/phase1a3b/run-android-r2.ps1 -Serial $Serial -Campaign $campaign -Output "docs/validacion-fase1a3b/r2/android/api$Api/$campaign" -PreserveData:$preserve
}
