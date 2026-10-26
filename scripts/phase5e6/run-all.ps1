param([string]$Serial='emulator-5554',[int]$Api=24,[string]$Harness='C:/sf-5e6-20261025',[string]$Evidence='C:/sf-5e6-evidence',
  [string]$Inputs='C:/sf-5e6-push',[string[]]$Only=@())
# 5E.6, one serial, sequential: production exporter probe, re-export of the 5E.5 generations'
# databases (pushed read-only inputs), recoverability 1k/10k/100k (pulled after each campaign),
# failure matrix, epochs and the same regressions as 5E.5. A failure is recorded and the list
# continues. Synthetic package only.
$ErrorActionPreference='Stop'
if([int](& adb -s $Serial shell getprop ro.build.version.sdk) -ne $Api){throw 'Unexpected API'}
$package='com.smartfin.snapshot5b2.tests'
$remoteEvidence="/sdcard/Android/data/$package/files/snapshot5e5-evidence"
function Pull-Evidence([string]$Name){
  $target=Join-Path $Evidence "api$Api/$Name"
  if(Test-Path $target){ Move-Item -LiteralPath $target -Destination "$target-previous-$((Get-Date).ToString('HHmmss'))" }
  New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
  & adb -s $Serial pull $remoteEvidence $target | Out-Null
  if($LASTEXITCODE -ne 0){ throw "Evidence pull failed for $Name" }
}
function Run-Case([string]$Campaign,[string]$Name,[int]$Timeout=35,[switch]$Denied,[switch]$Preserve,[switch]$Pull,[scriptblock]$Before) {
  if($Only.Count -and -not ($Only | Where-Object { $Name -like $_ })){ return }
  $output="docs/correccion-fase5e6/android/api$Api/$Name"
  if(Test-Path (Join-Path $output 'result.json')){
    if((Get-Content -LiteralPath (Join-Path $output 'result.json') -Raw | ConvertFrom-Json).passed){ Write-Output "Skip $Name (passed)"; return }
  }
  if(Test-Path $output){ Move-Item -LiteralPath $output -Destination "$output-attempt-$((Get-Date).ToString('HHmmss'))" }
  try {
    if($Before){ & $Before }
    ./scripts/phase5e6/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output $output -TimeoutMinutes $Timeout -DenyNotifications:$Denied -PreserveData:$Preserve
    if($Pull){ Pull-Evidence $Name }
  } catch {
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    "$((Get-Date).ToUniversalTime().ToString('o')) $_" | Add-Content -LiteralPath (Join-Path $output 'runner-error.txt')
    Write-Warning "$Campaign failed: $_"
  }
}
Run-Case phase5e6-probe probe 30 -Pull
# Inputs: the published SQLite of every 5E.5 generation of both devices (read-only copies).
$push={
  $remote="/sdcard/Android/data/$package/files/phase5e6-historical"
  & adb -s $Serial shell rm -rf $remote | Out-Null
  foreach($label in @('api24','api35')){
    & adb -s $Serial shell mkdir -p "$remote/$label" | Out-Null
    foreach($file in Get-ChildItem -LiteralPath (Join-Path $Inputs $label) -Filter '*.db'){
      & adb -s $Serial push $file.FullName "$remote/$label/$($file.Name)" | Out-Null
      if($LASTEXITCODE -ne 0){ throw "Push failed: $($file.Name)" }
    }
  }
}
Run-Case phase5e6-reexport reexport 40 -Pull -Before $push
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
