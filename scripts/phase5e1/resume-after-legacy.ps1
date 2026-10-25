param([string]$Serial='AXCC6R3919012932',[int]$Api=35,[string]$Harness='C:/sf-5e1-20261024')
$ErrorActionPreference='Stop'
$legacy=Get-Content "docs/atomicidad-fase5e1/android/api$Api/final-history-legacy-100000/result.json" -Raw | ConvertFrom-Json
if(-not $legacy.passed -or $legacy.campaign -ne 'phase5e1-history-legacy-100000'){throw 'Completed legacy campaign required; no financial command retried'}
function Run-Case([string]$Campaign,[string]$Name,[switch]$Preserve) {
  ./scripts/phase5e1/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output "docs/atomicidad-fase5e1/android/api$Api/final-$Name" -PreserveData:$Preserve
}
Run-Case phase5e1-history-mixed-1000 history-mixed-1000
Run-Case phase5e-integrated integrated
Run-Case phase5e-restart restart -Preserve
Run-Case phase5e-performance performance
./scripts/phase5e1/run-regressions.ps1 -Harness $Harness -Serial $Serial -Api $Api
