# 5E.3 runner: 5E.2 runner plus -NoForceStop, so automatic recovery can be inspected
# without the force-stop that cancels the package alarms. 5E.2 notes follow.
# 5E.2 runner: 5E.1 isolation checks unchanged; adds timeout and observed device
# conditions (power, screen, battery, thermal, PID). It never changes device settings.
param(
  [string]$Harness='C:/sf-5e3-20261024',
  [string]$Serial='emulator-5554',
  [string]$Campaign='phase5e3-history-legacyDay-scrambled-1000',
  [string]$Output='docs/aceptacion-fase5e3/android/api24/history-legacyDay-scrambled-1000',
  [int]$TimeoutMinutes=35,
  [switch]$PreserveData,
  [switch]$DenyNotifications,
  [switch]$KeepRunning,
  [switch]$NoForceStop
)
$ErrorActionPreference='Stop'
$campaignMutex=[System.Threading.Mutex]::new($false,"SmartFinPhase5DTests-$Serial")
if(-not $campaignMutex.WaitOne(0)){throw 'Another synthetic campaign is active on this device'}
try {
$testPackage='com.smartfin.snapshot5b2.tests'
function Invoke-SyntheticAdb {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
  $response=& adb -s $Serial @Arguments 2>&1
  if($LASTEXITCODE -ne 0){throw "ADB failed: $($Arguments -join ' '): $response"}
  return ($response -join "`n")
}
function Production-Metadata {
  $data=Invoke-SyntheticAdb @('shell','dumpsys','package','com.smartfin')
  return (($data -split "`n" | Where-Object {$_ -match 'userId=|appId=|versionCode=|versionName=|lastUpdateTime=|firstInstallTime='}) -join "`n")
}
$fingerprints=Get-Content -LiteralPath (Join-Path $Harness 'source-fingerprints.json') -Raw | ConvertFrom-Json
if($fingerprints.packageId -ne $testPackage){throw 'Synthetic package required'}
foreach($source in $fingerprints.originalHashes.PSObject.Properties){
  if((Get-FileHash -LiteralPath $source.Name -Algorithm SHA256).Hash.ToLowerInvariant() -ne $source.Value){throw "Source changed: $($source.Name). Reprepare and rebuild."}
}
foreach($source in $fingerprints.hashes.PSObject.Properties){
  if((Get-FileHash -LiteralPath (Join-Path $Harness $source.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $source.Value){throw "Prepared source changed: $($source.Name)"}
}
New-Item -ItemType Directory -Path $Output -Force | Out-Null
$before=Production-Metadata
$apk=Join-Path $Harness 'android/app/build/outputs/apk/release/app-release.apk'
$aapt=Join-Path $env:ANDROID_HOME 'build-tools/36.0.0/aapt.exe'
$badging=& $aapt dump badging $apk
if($LASTEXITCODE -ne 0 -or ($badging -join "`n") -notmatch "package: name='com\.smartfin\.snapshot5b2\.tests'" -or ($badging -join "`n") -match 'application-debuggable'){throw 'APK isolation failed'}
$badging | Set-Content -LiteralPath (Join-Path $Output 'apk-badging.txt') -Encoding utf8
$apkHash=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[System.IO.Compression.ZipFile]::OpenRead($apk)
try {
  $entry=$archive.GetEntry('assets/phase5b2-source-fingerprints.json')
  if(-not $entry){throw 'APK lacks source attestation'}
  $reader=[System.IO.StreamReader]::new($entry.Open())
  try {$embedded=$reader.ReadToEnd()} finally {$reader.Dispose()}
  if($embedded -cne [System.IO.File]::ReadAllText((Join-Path $Harness 'source-fingerprints.json'))){throw 'APK embeds stale source fingerprints'}
} finally {$archive.Dispose()}
$installedPath=(Invoke-SyntheticAdb @('shell','pm','path',$testPackage)).Replace('package:','').Trim()
$sameApk=$false
if($installedPath){
  $remoteDigest=Invoke-SyntheticAdb @('shell','md5sum',$installedPath)
  $sameApk=($remoteDigest -split '\s+')[0] -eq (Get-FileHash -LiteralPath $apk -Algorithm MD5).Hash.ToLowerInvariant()
}
if(-not $sameApk){Invoke-SyntheticAdb @('install','--no-streaming','-r',$apk) | Write-Output}
$testMetadata=Invoke-SyntheticAdb @('shell','dumpsys','package',$testPackage)
$testUid=[regex]::Match($testMetadata,'(?:userId|appId)=(\d+)').Groups[1].Value
$prodUid=[regex]::Match($before,'(?:userId|appId)=(\d+)').Groups[1].Value
if(-not $testUid -or $testUid -eq $prodUid){throw 'UID isolation failed'}
$environment=@{serial=$Serial;api=(Invoke-SyntheticAdb @('shell','getprop','ro.build.version.sdk')).Trim();model=(Invoke-SyntheticAdb @('shell','getprop','ro.product.model')).Trim();package=$testPackage;uid=$testUid;productionUid=$prodUid;apkSha256=$apkHash;productionMetadata=$before}
$environment | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'environment.json') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $Harness 'source-fingerprints.json') -Destination (Join-Path $Output 'source-fingerprints.json') -Force
if(-not $NoForceStop){Invoke-SyntheticAdb @('shell','am','force-stop',$testPackage) | Out-Null}
if(-not $PreserveData -and ($Campaign -match '^phase5e1-|^phase5e2-|^phase5e3-(history|dashboard|auto-stage|fifty)' -or $Campaign -match '^acceptance-seed-|^phase5d-(kill-|stage-restart$|epoch$|recovery$|reboot-stage$)' -or $Campaign -in @('ui-prepare','core','publication','phase5d-matrix','phase5e-integrated','phase5e-performance','phase5c-matrix','phase5c-main','phase5c-lost-before','phase5c-lost-after','phase5c-cleanup-matrix'))){
  if($testPackage -ne 'com.smartfin.snapshot5b2.tests'){throw 'Synthetic reset guard failed'}
  Invoke-SyntheticAdb @('shell','pm','clear',$testPackage) | Out-Null
}
if([int]$environment.api -ge 33){
  $notificationAction=if($DenyNotifications){'revoke'}else{'grant'}
  Invoke-SyntheticAdb @('shell','pm',$notificationAction,$testPackage,'android.permission.POST_NOTIFICATIONS') | Out-Null
}else{
  $notificationMode=if($DenyNotifications){'ignore'}else{'allow'}
  Invoke-SyntheticAdb @('shell','appops','set',$testPackage,'POST_NOTIFICATION',$notificationMode) | Out-Null
}
$remote="/sdcard/Android/data/$testPackage/files/snapshot5b2-results/result.json"
Invoke-SyntheticAdb @('shell','rm','-f',$remote) | Out-Null
Invoke-SyntheticAdb @('shell','input','keyevent','224') | Out-Null
Invoke-SyntheticAdb @('shell','wm','dismiss-keyguard') | Out-Null
function Device-Conditions([string]$Label) {
  $power=(Invoke-SyntheticAdb @('shell','dumpsys','power')) -split "`n" | Where-Object {$_ -match 'mWakefulness=|mStayOn=|mIsPowered=|mBatteryLevel=|mScreenOffTimeoutSetting=|mHoldingDisplaySuspendBlocker='}
  $battery=(Invoke-SyntheticAdb @('shell','dumpsys','battery')) -split "`n" | Where-Object {$_ -match 'level:|temperature:|AC powered:|USB powered:|status:'}
  $thermal=(& adb -s $Serial shell dumpsys thermalservice 2>$null) -split "`n" | Where-Object {$_ -match 'Thermal Status|mStatus|Temperature{' } | Select-Object -First 12
  [ordered]@{label=$Label;at=(Get-Date).ToUniversalTime().ToString('o');power=@($power|ForEach-Object Trim);battery=@($battery|ForEach-Object Trim);thermal=@($thermal|ForEach-Object Trim);pid=((& adb -s $Serial shell pidof $testPackage 2>$null) -join '')}
}
$conditions=[System.Collections.ArrayList]::new()
[void]$conditions.Add((Device-Conditions 'before-launch'))
Invoke-SyntheticAdb @('shell','am','start','-W','-a','android.intent.action.VIEW','-n',"$testPackage/com.smartfin.MainActivity",'-d',"snapshot5b2://campaign/$Campaign") | Write-Output
$deadline=(Get-Date).AddMinutes($TimeoutMinutes)
$lastPing=Get-Date
$completed=$false
while((Get-Date) -lt $deadline){
  Start-Sleep -Seconds 3
  if(((Get-Date)-$lastPing).TotalSeconds -ge 20){
    & adb -s $Serial shell input keyevent 224 2>$null | Out-Null
    [void]$conditions.Add((Device-Conditions 'during'))
    $lastPing=Get-Date
  }
  $response=& adb -s $Serial shell cat $remote 2>$null
  if($LASTEXITCODE -eq 0 -and $response){$completed=$true;break}
}
[void]$conditions.Add((Device-Conditions 'after-completion'))
$conditions | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Output 'device-conditions.json') -Encoding utf8
$testProcess=(& adb -s $Serial shell pidof $testPackage 2>$null) -join ''
if(-not $testProcess){
  if($Campaign -notmatch '^publication-kill-(before|after|captured)$|^phase5d-kill-'){throw 'Synthetic process unexpectedly absent'}
  $testProcess=(($response -join "`n") | ConvertFrom-Json).config.pid
}
Invoke-SyntheticAdb @('logcat','-d','-v','threadtime','--pid',$testProcess) | Set-Content -LiteralPath (Join-Path $Output 'logcat.txt') -Encoding utf8
if(-not $KeepRunning){Invoke-SyntheticAdb @('shell','am','force-stop',$testPackage) | Out-Null}
$after=Production-Metadata
@{unchanged=$before -eq $after;before=$before;after=$after} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'production-package-unchanged.json') -Encoding utf8
if($before -ne $after){throw 'Production package metadata changed'}
if(-not $completed){throw 'Synthetic campaign timed out. Inspect logcat.'}
Invoke-SyntheticAdb @('pull',$remote,(Join-Path $Output 'result.json')) | Write-Output
$report=Get-Content -LiteralPath (Join-Path $Output 'result.json') -Raw | ConvertFrom-Json
if($report.campaign -ne $Campaign -or -not $report.passed){throw "Synthetic campaign failed: $($report.failure)"}
if($report.config.uid -ne [int]$testUid -or $report.config.database -notmatch '^/data/(user/0|data)/com\.smartfin\.snapshot5b2\.tests/databases/phase5b2_synthetic\.db$'){throw 'Runtime path/UID isolation failed'}
Write-Output "Passed $($report.cases.Count) cases in $Campaign on $Serial."

} finally { $campaignMutex.ReleaseMutex(); $campaignMutex.Dispose() }

