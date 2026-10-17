param(
  [Parameter(Mandatory=$true)][string]$Harness,
  [string]$Serial='AXCC6R3919012932',
  [string]$Output='docs/performance/shared-commands/android',
  [string]$RunId='shared-commands-final',
  [switch]$Followup
)
$ErrorActionPreference='Stop'
$packageId='com.smartfin.sharedcommands.bench'
if($RunId -notmatch '^[a-zA-Z0-9-]{1,60}$'){throw 'Invalid run identifier'}
$apk=Join-Path $Harness 'android/app/build/outputs/apk/release/app-release.apk'
$buildTools=Get-ChildItem -LiteralPath (Join-Path $env:ANDROID_HOME 'build-tools') -Directory | Sort-Object Name -Descending
$aapt=Join-Path $buildTools[0].FullName 'aapt.exe'
$badging=& $aapt dump badging $apk
if($LASTEXITCODE -ne 0 -or ($badging -join "`n") -notmatch "package: name='$packageId'"){throw 'APK package isolation failed'}
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$before=(& adb -s $Serial shell dumpsys package com.smartfin | Select-String 'versionCode=|versionName=|firstInstallTime=|lastUpdateTime=' | Out-String)
Set-Content -LiteralPath (Join-Path $Output 'production-before.txt') -Value $before
Copy-Item -LiteralPath (Join-Path $Harness 'command-fingerprints.json') -Destination $Output
Get-FileHash -LiteralPath $apk -Algorithm SHA256 | ConvertTo-Json | Set-Content (Join-Path $Output 'apk-sha256.json')
& adb -s $Serial install -r $apk
if($LASTEXITCODE -ne 0){throw 'Synthetic package installation failed'}
# Clears only this explicitly isolated test package, for reproducible reruns.
if(!$Followup){
  & adb -s $Serial shell pm clear $packageId
  if($LASTEXITCODE -ne 0){throw 'Synthetic fixture reset failed'}
}
$phases=if($Followup){@('prepare3','verify3','optimized')}else{@('prepare','operations')}
foreach($phase in $phases){
  $suffix=if($phase -eq 'optimized'){'operations'}elseif($phase -eq 'prepare3'){'prepare'}else{$phase}
  $id="$RunId-$suffix"
  & adb -s $Serial shell am force-stop $packageId
  & adb -s $Serial shell am start -n "$packageId/com.smartfin.MainActivity" --es runId $id --es version $phase
  if($LASTEXITCODE -ne 0){throw 'Synthetic harness launch failed'}
  $remote="/sdcard/Android/data/$packageId/files/phase2-results/$id.jsonl"
  $deadline=[DateTime]::UtcNow.AddMinutes(90)
  $latest=''
  $done=$false
  while([DateTime]::UtcNow -lt $deadline){
    Start-Sleep -Seconds 3
    $lines=& adb -s $Serial shell cat $remote 2>$null
    if($LASTEXITCODE -ne 0){continue}
    $records=@($lines | Where-Object {$_ -match '^\{'} | ForEach-Object {$_ | ConvertFrom-Json})
    $failure=$records | Where-Object type -eq 'failure'
    if($failure){& adb -s $Serial pull $remote (Join-Path $Output "$id.jsonl");throw ($failure | ConvertTo-Json -Depth 6)}
    $progress=$records | Where-Object type -eq 'progress' | Select-Object -Last 1
    if($progress){$label="$($progress.size) / $($progress.shared) / $($progress.version) / $($progress.iteration)";if($label -ne $latest){Write-Output $label;$latest=$label}}
    $endType=if($phase -eq 'prepare' -or $phase -eq 'prepare3'){'prepared'}else{'complete'}
    if($records | Where-Object type -eq $endType){
      & adb -s $Serial pull $remote (Join-Path $Output "$id.jsonl")
      if($LASTEXITCODE -ne 0){throw 'Cannot collect synthetic evidence'}
      $done=$true;break
    }
  }
  if(!$done){throw 'Timed out; Android campaign incomplete'}
}
$after=(& adb -s $Serial shell dumpsys package com.smartfin | Select-String 'versionCode=|versionName=|firstInstallTime=|lastUpdateTime=' | Out-String)
Set-Content -LiteralPath (Join-Path $Output 'production-after.txt') -Value $after
if($before -ne $after){throw 'Production package metadata changed'}
Write-Output 'PASS: Android campaign completed; production package metadata unchanged'
