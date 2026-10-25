param([string]$Serial='emulator-5554',[int]$Api=24,[string]$Harness='C:/sf-5e-20261024')
$ErrorActionPreference='Stop'
$detectedApi=(& adb -s $Serial shell getprop ro.build.version.sdk).Trim()
if($LASTEXITCODE -ne 0 -or [int]$detectedApi -ne $Api){throw 'Unexpected device API; campaign not started'}
function Run-Case([string]$Campaign,[string]$Name,[switch]$Denied) {
  ./scripts/phase5e/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output "docs/atomicidad-fase5e/android/api$Api/regression-$Name" -DenyNotifications:$Denied
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
