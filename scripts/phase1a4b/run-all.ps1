param([Parameter(Mandatory=$true)][string]$Serial,[Parameter(Mandatory=$true)][int]$Api)
$ErrorActionPreference='Stop'
if(-not (($Serial -eq 'emulator-5554' -and $Api -eq 24) -or ($Serial -eq 'AXCC6R3919012932' -and $Api -eq 35))){throw 'Only the two authorized targets are supported'}
# 1a.4B campaigns first (phase1a4b-unknown-restart keeps the data of phase1a4b-unknown). Then the 25 regression campaigns
# of 1a.4A r2 in the same order, against the 1a.4B Node reference (real 1a.4B logic; derived 1a.3B probes), and the
# 1a.2/6B.3/6A regressions with their original oracles (each restart campaign keeps the data of the one right before it).
foreach($campaign in @('phase1a4b-register','phase1a4b-reversal','phase1a4b-guards','phase1a4b-idempotency','phase1a4b-atomicity','phase1a4b-unknown','phase1a4b-unknown-restart','phase1a4a-creation','phase1a4a-lifecycle','phase1a4a-compatibility','phase1a4a-invariants','phase1a4a-atomicity','phase1a4a-unknown','phase1a4a-unknown-restart','phase1a3b-upgrade','phase1a3b-startup-seed','phase1a3b-startup-upgrade','phase1a3b-upgrade-restart','phase1a3b-migration-atomicity','phase1a3b-integrity','phase1a3b-flows','phase1a3a-identity','phase1a3a-atomicity','phase1a3a-unknown','phase1a3a-unknown-restart','phase6b3-atomicity','phase1a2-atomicity-historical','phase1a2-statements','phase6b3-probes','phase6b3-unknown','phase6b3-unknown-restart','phase6a-precision')){
  $preserve=$campaign -in @('phase1a4b-unknown-restart','phase1a4a-unknown-restart','phase1a3b-startup-upgrade','phase1a3b-upgrade-restart','phase1a3a-unknown-restart','phase6b3-unknown-restart')
  ./scripts/phase1a4b/run-android.ps1 -Serial $Serial -Campaign $campaign -Output "docs/validacion-fase1a4b/android/api$Api/$campaign" -PreserveData:$preserve
}
