param(
  [string]$Harness = 'C:/sfphase2',
  [string]$Serial = 'AXCC6R3919012932',
  [string]$Output = 'docs/performance/android-phase2',
  [switch]$SkipInstall,
  [ValidateSet(1000,10000,50000,100000)][int[]]$Sizes = @(1000,10000,50000,100000),
  [switch]$SkipFunctional
)
$ErrorActionPreference = 'Stop'
$benchPackage = 'com.smartfin.dashboardphase2.bench'
if ($benchPackage -eq 'com.smartfin') { throw 'Package guard failed' }
$outputPath = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
  $response = & adb -s $Serial @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "ADB failed: $($Arguments -join ' '): $response" }
  return ($response -join "`n")
}
function Production-Metadata {
  $metadata = Invoke-Adb @('shell','dumpsys','package','com.smartfin')
  return (($metadata -split "`n" | Where-Object { $_ -match 'versionCode=|versionName=|lastUpdateTime=|firstInstallTime=' }) -join "`n")
}
$originalMetadata = Production-Metadata
$preflight = @{
  serial=$Serial; model=(Invoke-Adb @('shell','getprop','ro.product.model')).Trim();
  manufacturer=(Invoke-Adb @('shell','getprop','ro.product.manufacturer')).Trim();
  android=(Invoke-Adb @('shell','getprop','ro.build.version.release')).Trim();
  abi=(Invoke-Adb @('shell','getprop','ro.product.cpu.abi')).Trim();
  timezone=(Invoke-Adb @('shell','getprop','persist.sys.timezone')).Trim();
  productionMetadata=$originalMetadata; package=$benchPackage;
  battery=Invoke-Adb @('shell','dumpsys','battery')
}
if ($preflight.model -ne 'CRT-NX3' -or $preflight.android -ne '15' -or $preflight.abi -ne 'arm64-v8a') { throw 'Reference device mismatch' }
$preflight | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputPath 'preflight.json') -Encoding utf8
$apk = Join-Path $Harness 'android/app/build/outputs/apk/release/app-release.apk'
$aapt = Join-Path $env:ANDROID_HOME 'build-tools/36.0.0/aapt.exe'
$badging = & $aapt dump badging $apk
if ($LASTEXITCODE -ne 0 -or ($badging -join "`n") -notmatch "package: name='com\.smartfin\.dashboardphase2\.bench'") { throw 'APK applicationId verification failed' }
if (($badging -join "`n") -match 'application-debuggable') { throw 'Debug APK rejected' }
$badging | Set-Content -LiteralPath (Join-Path $outputPath 'apk-badging.txt') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $Harness 'source-fingerprints.json') -Destination (Join-Path $outputPath 'source-fingerprints.json')
if (-not $SkipInstall) { Invoke-Adb @('install','-r',$apk) | Write-Output }
$cases = @()
foreach ($size in $Sizes) { $cases += @{size=$size;version='prepare'} }
foreach ($size in $Sizes) {
  $versions = if ($size -in @(10000,100000)) { @('after','before') } else { @('before','after') }
  foreach ($version in $versions) { $cases += @{size=$size;version=$version} }
}
if (-not $SkipFunctional) {
  $cases += @{size=80;version='functional'}
  $cases += @{size=0;version='functional'}
}
$runPrefix = 'honor-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
foreach ($case in $cases) {
  $runId = "$runPrefix-$($case.size)-$($case.version)"
  $remote = "/sdcard/Android/data/$benchPackage/files/phase2-results/$runId.jsonl"
  $batteryBefore = Invoke-Adb @('shell','dumpsys','battery')
  Invoke-Adb @('shell','am','force-stop',$benchPackage) | Out-Null
  Invoke-Adb @('shell','cmd','statusbar','collapse') | Out-Null
  Invoke-Adb @('shell','am','start','-W','-n',"$benchPackage/com.smartfin.MainActivity",'--es','version',$case.version,'--es','size',[string]$case.size,'--es','runId',$runId) | Write-Output
  $focus = Invoke-Adb @('shell','dumpsys','window')
  if (($focus -split "`n" | Where-Object { $_ -match 'mCurrentFocus=' }) -notmatch 'com.smartfin.dashboardphase2.bench') { throw 'Synthetic dashboard is not foreground' }
  $deviceProcessId = (Invoke-Adb @('shell','pidof',$benchPackage)).Trim()
  $deadline = (Get-Date).AddMinutes(8)
  $completed = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $content = & adb -s $Serial shell cat $remote 2>$null
    if ($LASTEXITCODE -eq 0 -and $content) {
      $records = @($content | ForEach-Object { $_ | ConvertFrom-Json })
      if (@($records | Where-Object type -eq 'failure').Count -gt 0) { throw "Harness failure: $content" }
      $completed = if ($case.version -eq 'prepare') { @($records | Where-Object type -eq 'prepared').Count -eq 1 } elseif ($case.version -eq 'functional') { @($records | Where-Object type -eq 'functional').Count -eq 1 } else { @($records | Where-Object type -eq 'sample').Count -eq 5 }
      if ($completed) { break }
    }
  }
  $log = Invoke-Adb @('logcat','-d','-v','threadtime','--pid',$deviceProcessId)
  $log | Set-Content -LiteralPath (Join-Path $outputPath "$runId-logcat.txt") -Encoding utf8
  Invoke-Adb @('shell','dumpsys','meminfo',$benchPackage) | Set-Content -LiteralPath (Join-Path $outputPath "$runId-meminfo.txt") -Encoding utf8
  if (-not $completed) { throw "Timed out: $runId; see isolated process Logcat" }
  Invoke-Adb @('pull',$remote,(Join-Path $outputPath "$runId.jsonl")) | Write-Output
  @{runId=$runId; batteryBefore=$batteryBefore; batteryAfter=(Invoke-Adb @('shell','dumpsys','battery'))} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $outputPath "$runId-environment.json") -Encoding utf8
  Write-Output "COMPLETED $runId"
}
$finalMetadata = Production-Metadata
if ($finalMetadata -ne $originalMetadata) { throw 'Production package metadata unexpectedly changed' }
@{unchanged=$true;before=$originalMetadata;after=$finalMetadata} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'production-package-unchanged.json') -Encoding utf8
Write-Output 'All physical-device scenarios collected. Production package metadata unchanged.'
