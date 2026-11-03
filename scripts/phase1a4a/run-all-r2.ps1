param([Parameter(Mandatory=$true)][string]$Serial,[Parameter(Mandatory=$true)][int]$Api)
$ErrorActionPreference='Stop'
if(-not (($Serial -eq 'emulator-5554' -and $Api -eq 24) -or ($Serial -eq 'AXCC6R3919012932' -and $Api -eq 35))){throw 'Only the two authorized targets are supported'}
# r2: same 25 campaigns and order as r1; phase1a2-statements now compares with the 1a.4A r2 reference.
# 1a.4A campaigns first (phase1a4a-unknown-restart keeps the data of phase1a4a-unknown). Then the 1a.3B and 1a.3A
# campaigns against the 1a.4A Node references (derived 1a.3B probes), and the 1a.2/6B.3/6A regressions with their
# original oracles (each restart campaign keeps the data of the campaign right before it).
foreach($campaign in @('phase1a4a-creation','phase1a4a-lifecycle','phase1a4a-compatibility','phase1a4a-invariants','phase1a4a-atomicity','phase1a4a-unknown','phase1a4a-unknown-restart','phase1a3b-upgrade','phase1a3b-startup-seed','phase1a3b-startup-upgrade','phase1a3b-upgrade-restart','phase1a3b-migration-atomicity','phase1a3b-integrity','phase1a3b-flows','phase1a3a-identity','phase1a3a-atomicity','phase1a3a-unknown','phase1a3a-unknown-restart','phase6b3-atomicity','phase1a2-atomicity-historical','phase1a2-statements','phase6b3-probes','phase6b3-unknown','phase6b3-unknown-restart','phase6a-precision')){
  $preserve=$campaign -in @('phase1a4a-unknown-restart','phase1a3b-startup-upgrade','phase1a3b-upgrade-restart','phase1a3a-unknown-restart','phase6b3-unknown-restart')
  ./scripts/phase1a4a/run-android-r2.ps1 -Serial $Serial -Campaign $campaign -Output "docs/validacion-fase1a4a/r2/android/api$Api/$campaign" -PreserveData:$preserve
}
