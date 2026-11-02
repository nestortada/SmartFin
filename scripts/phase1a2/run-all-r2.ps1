param([Parameter(Mandatory=$true)][string]$Serial,[Parameter(Mandatory=$true)][int]$Api)
$ErrorActionPreference='Stop'
if(-not (($Serial -eq 'emulator-5554' -and $Api -eq 24) -or ($Serial -eq 'AXCC6R3919012932' -and $Api -eq 35))){throw 'Only the two authorized targets are supported'}
# r2: matrix with pinned clock (66 cases) and the historical-protection matrix, then every other 1a.2 campaign.
foreach($campaign in @('phase6b3-atomicity','phase1a2-atomicity-historical','phase1a2-statements','phase6b3-probes','phase6b3-unknown','phase6b3-unknown-restart','phase6a-precision')){
  $preserve=$campaign -eq 'phase6b3-unknown-restart'
  ./scripts/phase1a2/run-android-r2.ps1 -Serial $Serial -Campaign $campaign -Output "docs/validacion-fase1a2/android-r2/api$Api/$campaign" -PreserveData:$preserve
}
