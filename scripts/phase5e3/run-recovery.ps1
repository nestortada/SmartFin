param(
  [string]$Serial='emulator-5554',
  [int]$Api=24,
  [string]$Harness='C:/sf-5e3-20261024',
  [string[]]$Scenarios=@('replace-alarm-lost','replace-cleanup','kill-alarm-lost','stopped-replace-alarm-lost'),
  [int]$ObserveSeconds=180
)
# Phase 5E.3 automatic recovery observation. Stages leave the synthetic process
# running; the trigger is Android itself (reboot of the emulator only, or package
# replacement). Observation uses dumpsys/logcat without launching the app, and the
# inspection launch never force-stops (force-stop cancels the package alarms).
# A physical reboot of the HONOR is refused here: it needs new owner authorization.
$ErrorActionPreference='Stop'
$package='com.smartfin.snapshot5b2.tests'
if([int](& adb -s $Serial shell getprop ro.build.version.sdk) -ne $Api){throw 'Unexpected API'}
$isEmulator=(& adb -s $Serial shell getprop ro.kernel.qemu).Trim() -eq '1'
$apk=Join-Path $Harness 'android/app/build/outputs/apk/release/app-release.apk'
# Not named Adb: PowerShell names are case-insensitive and child scripts inherit
# functions, so `adb` inside would recurse (first attempts exhausted host memory).
function Invoke-DeviceAdb { param([Parameter(ValueFromRemainingArguments=$true)][string[]]$A) $r=& adb.exe -s $Serial @A 2>&1; return ($r -join "`n") }
function Snapshot([string]$Label) {
  # Filter on the device and keep only recent lines: full dumpsys/logcat dumps every
  # poll exhausted host memory in the first attempt.
  $alarms=(Invoke-DeviceAdb shell "dumpsys alarm | grep -E 'snapshot5b2|smartfin-reminder' | head -n 40") -split "`n" | Where-Object {$_}
  $jobs=(Invoke-DeviceAdb shell "dumpsys jobscheduler | grep snapshot5b2 | head -n 20") -split "`n" | Where-Object {$_}
  $observe=(Invoke-DeviceAdb logcat -d -t 200 -v time -s SmartFin5E3:I SmartFinRecovery:I) -split "`n" | Where-Object {$_ -match 'SmartFin'}
  $starts=(Invoke-DeviceAdb shell "logcat -d -t 400 -b events | grep -E 'am_proc_start.*snapshot5b2' | head -n 10") -split "`n" | Where-Object {$_}
  [ordered]@{label=$Label;at=(Get-Date).ToUniversalTime().ToString('o');pid=(Invoke-DeviceAdb shell pidof $package).Trim();
    alarmLines=@($alarms|ForEach-Object Trim);reminderAlarms=@($alarms|Where-Object {$_ -match 'tag=\*walarm\*:.*SmartFinSubscriptionReminderReceiver'}).Count;
    jobLines=@($jobs|ForEach-Object Trim);observeLog=@($observe|ForEach-Object Trim);processStarts=@($starts|ForEach-Object Trim)}
}
function Stage([string]$Campaign,[string]$Out) {
  ./scripts/phase5e3/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output $Out -TimeoutMinutes 10 -KeepRunning
}
function Inspect([string]$Out) {
  ./scripts/phase5e3/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign 'phase5e3-auto-inspect' -Output $Out -TimeoutMinutes 10 -PreserveData -NoForceStop
}
function Observe([string]$Folder,[string]$Kind,[string]$Mode) {
  $polls=[System.Collections.ArrayList]::new(); $deadline=(Get-Date).AddSeconds($ObserveSeconds); $met=$false
  while((Get-Date) -lt $deadline){
    $s=Snapshot 'poll'; [void]$polls.Add($s)
    if($Kind -eq 'alarm' -and $s.reminderAlarms -gt 0){$met=$true}
    if($Kind -eq 'cleanup' -and ($s.observeLog -match 'receiver.recover:completed|worker.result')){$met=$true}
    if($met -and $Mode -ne 'full'){break}
    Start-Sleep -Seconds 15
  }
  $polls | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Folder 'observation.json') -Encoding utf8
  return $met
}
foreach($scenario in $Scenarios){
  $folder="docs/aceptacion-fase5e3/android/api$Api/recovery-$scenario"
  if(Test-Path (Join-Path $folder 'inspect/result.json')){ Write-Output "Skip $scenario"; continue }
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
  $kind=if($scenario -match 'cleanup'){'cleanup'}else{'alarm'}
  $stage=if($kind -eq 'cleanup'){'phase5e3-auto-stage-cleanup'}elseif($scenario -match 'lost'){'phase5e3-auto-stage-alarm-lost'}else{'phase5e3-auto-stage-alarm'}
  $summary=[ordered]@{scenario=$scenario;serial=$Serial;api=$Api;stage=$stage}
  try {
    Stage $stage (Join-Path $folder 'stage')
    Invoke-DeviceAdb logcat -c | Out-Null
    $summary.beforeTrigger=Snapshot 'before-trigger'
    $summary.bootIdBefore=(Invoke-DeviceAdb shell cat /proc/sys/kernel/random/boot_id).Trim()
    if($scenario -match '^reboot-'){
      if(-not $isEmulator){throw 'Physical reboot requires explicit owner authorization; refused'}
      Invoke-DeviceAdb reboot | Out-Null; & adb -s $Serial wait-for-device
      $bootDeadline=(Get-Date).AddMinutes(5)
      while((Invoke-DeviceAdb shell getprop sys.boot_completed).Trim() -ne '1'){ if((Get-Date) -gt $bootDeadline){throw 'Boot timeout'}; Start-Sleep -Seconds 3 }
      $summary.trigger='device reboot (emulator)'
    } elseif($scenario -match '^kill-'){
      Invoke-DeviceAdb shell input keyevent 3 | Out-Null; Start-Sleep -Seconds 2; Invoke-DeviceAdb shell am kill $package | Out-Null
      $summary.trigger='background process kill (am kill), no force-stop'
    } else {
      if($scenario -match '^stopped-'){ Invoke-DeviceAdb shell am force-stop $package | Out-Null; $summary.forceStoppedBeforeTrigger=$true }
      $summary.installOutput=Invoke-DeviceAdb install --no-streaming -r $apk
      $summary.trigger='package replacement (adb install -r, same APK)'
    }
    $summary.triggeredAt=(Get-Date).ToUniversalTime().ToString('o')
    $summary.bootIdAfter=(Invoke-DeviceAdb shell cat /proc/sys/kernel/random/boot_id).Trim()
    $summary.automaticWithinWindow=Observe $folder $kind 'early'
    $summary.afterObservation=Snapshot 'after-observation'
    Inspect (Join-Path $folder 'inspect')
    $summary.passed=$true
  } catch {
    $summary.passed=$false; $summary.error="$_"; Write-Warning "$scenario failed: $_"
  } finally {
    $summary | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $folder 'summary.json') -Encoding utf8
    Invoke-DeviceAdb shell am force-stop $package | Out-Null
  }
}
