param([string]$Serial='emulator-5554',[int]$Api=24,[string]$Harness='C:/sf-5e5-20261025',[string]$Evidence='C:/sf-5e5-evidence',
  [string[]]$Only=@())
# 5E.5, one serial, sequential: recoverability evidence (pulled after each campaign,
# since the next one clears it), failure matrix, epochs, concurrent recovery (5E.4),
# paginated history, precision matrix and the same 28 regressions as 5E.2-5E.4.
# A failure is recorded and the list continues. Synthetic package only.
$ErrorActionPreference='Stop'
if([int](& adb -s $Serial shell getprop ro.build.version.sdk) -ne $Api){throw 'Unexpected API'}
$package='com.smartfin.snapshot5b2.tests'
function Run-Case([string]$Campaign,[string]$Name,[int]$Timeout=35,[switch]$Denied,[switch]$Preserve,[switch]$Pull) {
  if($Only.Count -and -not ($Only | Where-Object { $Name -like $_ })){ return }
  $output="docs/recuperabilidad-fase5e5/android/api$Api/$Name"
  if(Test-Path (Join-Path $output 'result.json')){
    if((Get-Content -LiteralPath (Join-Path $output 'result.json') -Raw | ConvertFrom-Json).passed){ Write-Output "Skip $Name (passed)"; return }
  }
  if(Test-Path $output){ Move-Item -LiteralPath $output -Destination "$output-attempt-$((Get-Date).ToString('HHmmss'))" }
  try {
    ./scripts/phase5e5/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output $output -TimeoutMinutes $Timeout -DenyNotifications:$Denied -PreserveData:$Preserve
    if($Pull){
      $target=Join-Path $Evidence "api$Api/$Name"
      if(Test-Path $target){ Move-Item -LiteralPath $target -Destination "$target-previous-$((Get-Date).ToString('HHmmss'))" }
      New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
      & adb -s $Serial pull "/sdcard/Android/data/$package/files/snapshot5e5-evidence" $target | Out-Null
      if($LASTEXITCODE -ne 0){ throw "Evidence pull failed for $Name" }
    }
  } catch {
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    "$((Get-Date).ToUniversalTime().ToString('o')) $_" | Add-Content -LiteralPath (Join-Path $output 'runner-error.txt')
    Write-Warning "$Campaign failed: $_"
  }
}
foreach($size in @('1000','10000','100000')){ Run-Case "phase5e5-recoverability-$size" "recoverability-$size" 90 -Pull }
Run-Case phase5e5-failures failures 30 -Pull
Run-Case phase5e5-epochs epochs 30 -Pull
foreach($campaign in @('phase5e4-recovery-contention','phase5e4-recovery-error')){ Run-Case $campaign ($campaign -replace '^phase5e4-','') 15 }
Run-Case phase5e3-history50-civil-1000 history50-civil-1000 20
Run-Case phase5e3-history50-civil-100000 history50-civil-100000 120
Run-Case phase5e3-dashboard-precision dashboard-precision 20
Run-Case phase5d-matrix regression-notifications
Run-Case phase5d-permission regression-denied -Denied
Run-Case phase5d-recovery regression-worker-headless
foreach($stage in @('beforeNotify','afterNotify','afterAck')) {
  Run-Case "phase5d-kill-$stage" "regression-kill-$stage"
  Run-Case phase5d-restart "regression-restart-$stage"
}
Run-Case phase5d-stage-restart regression-process-stage
Run-Case phase5d-restart regression-process-restart
Run-Case phase5d-epoch regression-notification-epoch
Run-Case phase5c-matrix regression-deletion-rollback
Run-Case phase5c-cleanup-matrix regression-cleanup-faults
Run-Case phase5c-lost-before regression-deletion-lost-before
Run-Case phase5c-unknown-restart regression-deletion-unknown-restart
Run-Case phase5c-lost-after regression-deletion-lost-after
Run-Case phase5c-restart regression-deletion-confirmed-restart
foreach($campaign in @('core','restart-verify','publication','publication-restart-verify','publication-after-verify','close-lost','open-lost')) {
  Run-Case $campaign "regression-$campaign"
}
Run-Case phase5e-integrated regression-integrated
Run-Case phase5e-restart regression-integrated-restart -Preserve
Run-Case phase5e1-recovery regression-recovery
