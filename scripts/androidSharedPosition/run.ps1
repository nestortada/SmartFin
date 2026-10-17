param(
  [Parameter(Mandatory=$true)][string]$Harness,
  [string]$Serial='AXCC6R3919012932',
  [string]$Output='docs/performance/shared-position/android',
  [string]$RunId='shared-position',
  [switch]$SkipInstall
)
$ErrorActionPreference='Stop'
$packageId='com.smartfin.sharedposition.bench'
if($RunId -notmatch '^[a-zA-Z0-9-]{1,80}$'){throw 'Invalid run identifier'}
$apk=Join-Path $Harness 'android/app/build/outputs/apk/release/app-release.apk'
$tools=Get-ChildItem -LiteralPath (Join-Path $env:ANDROID_HOME 'build-tools') -Directory | Sort-Object Name -Descending
$aapt=Join-Path $tools[0].FullName 'aapt.exe'
$badging=& $aapt dump badging $apk
if($LASTEXITCODE -ne 0 -or ($badging -join "`n") -notmatch "package: name='$packageId'"){throw 'APK package isolation failed'}
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$before=(& adb -s $Serial shell dumpsys package com.smartfin | Select-String 'versionCode=|versionName=|firstInstallTime=|lastUpdateTime=' | Out-String)
Set-Content -LiteralPath (Join-Path $Output 'production-before.txt') -Value $before
Copy-Item -LiteralPath (Join-Path $Harness 'shared-position-fingerprints.json') -Destination $Output
Get-FileHash -LiteralPath $apk -Algorithm SHA256 | ConvertTo-Json | Set-Content (Join-Path $Output 'apk-sha256.json')
if(!$SkipInstall){
  & adb -s $Serial install -r $apk
  if($LASTEXITCODE -ne 0){throw 'Isolated APK installation failed'}
}
& adb -s $Serial shell am force-stop $packageId
& adb -s $Serial shell am start -n "$packageId/com.smartfin.MainActivity" --es runId $RunId
if($LASTEXITCODE -ne 0){throw 'Harness did not launch'}
$remote="/sdcard/Android/data/$packageId/files/phase2-results/$RunId.jsonl"
$deadline=[DateTime]::UtcNow.AddMinutes(12)
$progress=''
while([DateTime]::UtcNow -lt $deadline){
  Start-Sleep -Seconds 3
  $lines=& adb -s $Serial shell cat $remote 2>$null
  if($LASTEXITCODE -ne 0){continue}
  $records=@($lines | Where-Object {$_ -match '^\{'} | ForEach-Object {$_ | ConvertFrom-Json})
  $failed=$records | Where-Object type -eq 'failure'
  if($failed){throw ($failed | ConvertTo-Json -Depth 5)}
  $latest=$records | Where-Object type -eq 'progress' | Select-Object -Last 1
  if($latest){$label="$($latest.sharedExpenses) shared / $($latest.version)";if($label -ne $progress){Write-Output $label;$progress=$label}}
  if($records | Where-Object type -eq 'complete'){
    & adb -s $Serial pull $remote (Join-Path $Output "$RunId.jsonl")
    if($LASTEXITCODE -ne 0){throw 'Cannot collect evidence'}
    $after=(& adb -s $Serial shell dumpsys package com.smartfin | Select-String 'versionCode=|versionName=|firstInstallTime=|lastUpdateTime=' | Out-String)
    Set-Content -LiteralPath (Join-Path $Output 'production-after.txt') -Value $after
    if($before -ne $after){throw 'Production package metadata changed'}
    Write-Output 'COMPLETE: financial equality and unchanged production package metadata'
    exit 0
  }
}
throw 'Timed out; campaign not approved'
