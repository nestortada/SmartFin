param([string]$Serial='AXCC6R3919012932',[int]$Api=35,[string]$Harness='C:/sf-5e3-20261024')
# Resumes the 28-campaign regression list after the first HONOR stop (phase5c-restart
# race, kept under race-diagnostic). Same campaigns and order as run-regressions.ps1.
$ErrorActionPreference='Stop'
if([int](& adb -s $Serial shell getprop ro.build.version.sdk) -ne $Api){throw 'Unexpected API'}
function Run-Case([string]$Campaign,[string]$Name,[switch]$Preserve) {
  ./scripts/phase5e3/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output "docs/aceptacion-fase5e3/android/api$Api/regression-$Name" -PreserveData:$Preserve
}
Run-Case phase5c-lost-after deletion-lost-after
Run-Case phase5c-restart deletion-confirmed-restart
foreach($campaign in @('core','restart-verify','publication','publication-restart-verify','publication-after-verify','close-lost','open-lost')) { Run-Case $campaign $campaign }
Run-Case phase5e-integrated integrated
Run-Case phase5e-restart integrated-restart -Preserve
Run-Case phase5e1-recovery recovery
