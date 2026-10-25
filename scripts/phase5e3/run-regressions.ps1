# 5E.3 APK: the same 28 regression campaigns as 5E.2, outputs under aceptacion-fase5e3.
param([string]$Serial='emulator-5554',[int]$Api=24,[string]$Harness='C:/sf-5e3-20261024')
$ErrorActionPreference='Stop'
if([int](& adb -s $Serial shell getprop ro.build.version.sdk) -ne $Api){throw 'Unexpected API'}
function Run-Case([string]$Campaign,[string]$Name,[switch]$Denied,[switch]$Preserve) {
  ./scripts/phase5e3/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output "docs/aceptacion-fase5e3/android/api$Api/regression-$Name" -DenyNotifications:$Denied -PreserveData:$Preserve
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
