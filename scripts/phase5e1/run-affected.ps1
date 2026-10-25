param([string]$Serial='emulator-5554',[int]$Api=24,[string]$Harness='C:/sf-5e1-20261024')
$ErrorActionPreference='Stop'
function Run-Case([string]$Campaign,[string]$Name,[switch]$Preserve) {
  ./scripts/phase5e1/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output "docs/atomicidad-fase5e1/android/api$Api/final-$Name" -PreserveData:$Preserve
}
Run-Case phase5e1-recovery recovery
foreach($count in @(1000,10000,100000)) {
  foreach($mode in @('civil','legacy')) { Run-Case "phase5e1-history-$mode-$count" "history-$mode-$count" }
}
Run-Case phase5e1-history-mixed-1000 history-mixed-1000
Run-Case phase5e-integrated integrated
Run-Case phase5e-restart restart -Preserve
Run-Case phase5e-performance performance
./scripts/phase5e1/run-regressions.ps1 -Harness $Harness -Serial $Serial -Api $Api
