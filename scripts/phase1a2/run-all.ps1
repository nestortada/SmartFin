param([Parameter(Mandatory=$true)][string]$Serial,[Parameter(Mandatory=$true)][int]$Api)
$ErrorActionPreference='Stop'
if(-not (($Serial -eq 'emulator-5554' -and $Api -eq 24) -or ($Serial -eq 'AXCC6R3919012932' -and $Api -eq 35))){throw 'Only the two authorized targets are supported'}
# 1a.2 statements first, then the five 6B.3 regressions. No wildcard selector, device reboot, uninstall or production mutation.
foreach($campaign in @('phase1a2-statements','phase6b3-probes','phase6b3-atomicity','phase6b3-unknown','phase6b3-unknown-restart','phase6a-precision')){
  $preserve=$campaign -eq 'phase6b3-unknown-restart'
  ./scripts/phase1a2/run-android.ps1 -Serial $Serial -Campaign $campaign -Output "docs/validacion-fase1a2/android/api$Api/$campaign" -PreserveData:$preserve
}
