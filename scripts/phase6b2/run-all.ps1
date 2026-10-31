param([string]$Serial='emulator-5554',[int]$Api=24,[string]$Harness='C:/sf-6b2r-20261030',[string[]]$Only=@())
# 6B.2, one serial, sequential: 6B.2 dashboard-aggregate probes (frozen pre-6B.2 and production), visible
# COP text of the production dashboard and Debit cards components, representative volumes, the 6B.1 and
# 6B probes on the corrected code and the 6B.1 regression chain (6A, 5E.6, 5E.5, 5E.3, 5D, 5C, 5E, 5E.1).
# A failure is recorded and the list continues. Synthetic package only, no reboots.
$ErrorActionPreference='Stop'
if([int](& adb -s $Serial shell getprop ro.build.version.sdk) -ne $Api){throw 'Unexpected API'}
$package='com.smartfin.snapshot5b2.tests'
function Run-Case([string]$Campaign,[string]$Name,[int]$Timeout=35,[switch]$Denied,[switch]$Preserve,[switch]$Keep,[scriptblock]$After) {
  if($Only.Count -and -not ($Only | Where-Object { $Name -like $_ })){ return }
  $output="docs/correccion-fase6b2/android/api$Api/$Name"
  if(Test-Path (Join-Path $output 'result.json')){
    if((Get-Content -LiteralPath (Join-Path $output 'result.json') -Raw | ConvertFrom-Json).passed){ Write-Output "Skip $Name (passed)"; return }
  }
  if(Test-Path $output){ Move-Item -LiteralPath $output -Destination "$output-attempt-$((Get-Date).ToString('HHmmss'))" }
  try {
    ./scripts/phase6b2/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output $output -TimeoutMinutes $Timeout -DenyNotifications:$Denied -PreserveData:$Preserve -KeepRunning:$Keep
    if($After){ & $After }
  } catch {
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    "$((Get-Date).ToUniversalTime().ToString('o')) $_" | Add-Content -LiteralPath (Join-Path $output 'runner-error.txt')
    Write-Warning "$Campaign failed: $_"
  } finally {
    if($Keep){ & adb -s $Serial shell am force-stop $package | Out-Null }
  }
}
Run-Case phase6b2-probes probes 40
foreach($probe in @('aggregateBalances','debtAggregate','sharedPosition','zeroThroughAggregation','negativeFortyCents')){
  Run-Case "phase6b2-ui-$probe" "ui-$probe" 10 -Keep -After {
    Start-Sleep -Seconds 2
    node scripts/phase6b2/ui.cjs $Serial $Api $probe | Out-Null
    if($LASTEXITCODE -ne 0){ throw "Visible text differs for $probe" }
  }
}
foreach($size in @('1000','10000','100000')){ Run-Case "phase6b2-volume-$size" "volume-$size" 60 }
# Previous phases' probes on the corrected code (their own checks; values compared with Node in the report).
Run-Case phase6b1-probes regression-6b1-probes 40
Run-Case phase6b-probes regression-6b-probes 40
Run-Case phase6a-precision regression-6a-precision 20
foreach($size in @('10000','100000')){ Run-Case "phase6a-centavos-$size" "regression-6a-centavos-$size" 120 }
foreach($size in @('1000','10000','100000')){ Run-Case "phase6a-performance-$size" "regression-6a-performance-$size" 90 }
Run-Case phase5e6-probe regression-csv-probe 30
Run-Case phase5e5-recoverability-1000 regression-recoverability-1000 90
Run-Case phase5e5-failures regression-failures 30
Run-Case phase5e5-epochs regression-epochs 30
Run-Case phase5e3-history50-civil-1000 regression-history50-civil-1000 20
Run-Case phase5e3-history50-civil-100000 regression-history50-civil-100000 120
Run-Case phase5e3-dashboard-precision regression-dashboard-precision 20
Run-Case phase5d-matrix regression-notifications
Run-Case phase5d-permission regression-denied -Denied
Run-Case phase5d-recovery regression-worker-headless
Run-Case phase5d-epoch regression-notification-epoch
Run-Case phase5c-matrix regression-deletion-rollback
Run-Case phase5c-cleanup-matrix regression-cleanup-faults
# Each restart verification reads the state staged by the campaign right before it (5E.6 order).
Run-Case phase5c-lost-before regression-deletion-lost-before
Run-Case phase5c-unknown-restart regression-deletion-unknown-restart
Run-Case phase5c-lost-after regression-deletion-lost-after
Run-Case phase5c-restart regression-deletion-confirmed-restart
foreach($campaign in @('core','publication')) { Run-Case $campaign "regression-$campaign" }
Run-Case phase5e-integrated regression-integrated
Run-Case phase5e-restart regression-integrated-restart -Preserve
Run-Case phase5e1-recovery regression-recovery
