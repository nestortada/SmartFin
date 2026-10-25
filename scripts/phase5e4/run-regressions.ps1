# 5E.4 APK: the same 28 regression campaigns as 5E.2/5E.3, outputs under optimizacion-fase5e4.
param([string]$Serial='emulator-5554',[int]$Api=24,[string]$Harness='C:/sf-5e4-20261025')
$ErrorActionPreference='Stop'
if([int](& adb -s $Serial shell getprop ro.build.version.sdk) -ne $Api){throw 'Unexpected API'}
function Run-Case([string]$Campaign,[string]$Name,[switch]$Denied,[switch]$Preserve) {
  # A failure is recorded and the list continues; dependent pairs report their own outcome.
  $output="docs/optimizacion-fase5e4/android/api$Api/regression-$Name"
  try { ./scripts/phase5e4/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output $output -DenyNotifications:$Denied -PreserveData:$Preserve }
  catch { New-Item -ItemType Directory -Path $output -Force | Out-Null; "$((Get-Date).ToUniversalTime().ToString('o')) $_" | Add-Content -LiteralPath (Join-Path $output 'runner-error.txt'); Write-Warning "$Campaign failed: $_" }
}
Run-Case phase5d-matrix notifications
Run-Case phase5d-permission denied -Denied
Run-Case phase5d-recovery worker-headless
foreach($stage in @('beforeNotify','afterNotify','afterAck')) {
  Run-Case "phase5d-kill-$stage" "kill-$stage"
  Run-Case phase5d-restart "restart-$stage"
}
Run-Case phase5d-stage-restart process-stage
Run-Case phase5d-restart process-restart
Run-Case phase5d-epoch notification-epoch
Run-Case phase5c-matrix deletion-rollback
Run-Case phase5c-cleanup-matrix cleanup-faults
Run-Case phase5c-lost-before deletion-lost-before
Run-Case phase5c-unknown-restart deletion-unknown-restart
Run-Case phase5c-lost-after deletion-lost-after
Run-Case phase5c-restart deletion-confirmed-restart
foreach($campaign in @('core','restart-verify','publication','publication-restart-verify','publication-after-verify','close-lost','open-lost')) {
  Run-Case $campaign $campaign
}
Run-Case phase5e-integrated integrated
Run-Case phase5e-restart integrated-restart -Preserve
Run-Case phase5e1-recovery recovery
