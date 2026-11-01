param([Parameter(Mandatory=$true)][string]$Serial,[Parameter(Mandatory=$true)][int]$Api)
$ErrorActionPreference='Stop'
if(-not (($Serial -eq 'emulator-5554' -and $Api -eq 24) -or ($Serial -eq 'AXCC6R3919012932' -and $Api -eq 35))){throw 'Only the two authorized targets are supported'}
# No wildcard selector, performance replays, device reboot, package uninstall or production mutation.
foreach($campaign in @('phase6b3-probes','phase6b3-atomicity','phase6b3-unknown','phase6b3-unknown-restart','phase6a-precision')){
  $preserve=$campaign -eq 'phase6b3-unknown-restart'
  ./scripts/phase6b3/run-android.ps1 -Serial $Serial -Campaign $campaign -Output "docs/validacion-fase6b3-1/android/api$Api/$campaign" -PreserveData:$preserve
}
