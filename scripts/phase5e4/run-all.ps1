param([string]$Serial='emulator-5554',[int]$Api=24,[string]$Harness='C:/sf-5e4-20261025')
# 5E.4 optimized APK, one serial: backup profiles, 5E3-001 campaigns, then the 28 regressions.
$ErrorActionPreference='Stop'
./scripts/phase5e4/run-backup.ps1 -Serial $Serial -Api $Api -Harness $Harness -Label optimized
foreach($campaign in @('phase5e4-recovery-contention','phase5e4-recovery-error')){
  $output="docs/optimizacion-fase5e4/android/api$Api/$($campaign -replace '^phase5e4-','')"
  try { ./scripts/phase5e4/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $campaign -Output $output -TimeoutMinutes 15 }
  catch { New-Item -ItemType Directory -Path $output -Force | Out-Null; "$((Get-Date).ToUniversalTime().ToString('o')) $_" | Add-Content -LiteralPath (Join-Path $output 'runner-error.txt'); Write-Warning "$campaign failed: $_" }
}
./scripts/phase5e4/run-regressions.ps1 -Serial $Serial -Api $Api -Harness $Harness
