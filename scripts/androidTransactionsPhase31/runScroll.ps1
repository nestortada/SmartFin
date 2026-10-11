param(
  [string]$Harness = 'C:/sfphase31',
  [string]$Serial = 'AXCC6R3919012932',
  [string]$Output = 'docs/performance/transactions-phase31/scroll',
  [ValidateSet(1000,10000,100000)][int[]]$Sizes = @(1000,10000,100000),
  [ValidateSet('scroll','scrollBefore')][string[]]$Versions = @('scroll','scrollBefore'),
  [switch]$SkipInstall
)
$ErrorActionPreference = 'Stop'
$benchPackage = 'com.smartfin.transactionsphase31.bench'
$outputPath = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
  $response = & adb -s $Serial @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "ADB failed: $($Arguments -join ' '): $response" }
  return ($response -join "`n")
}
$apk = Join-Path $Harness 'android/app/build/outputs/apk/release/app-release.apk'
$badging = & (Join-Path $env:ANDROID_HOME 'build-tools/36.0.0/aapt.exe') dump badging $apk
if ($LASTEXITCODE -ne 0 -or ($badging -join "`n") -notmatch "package: name='com\.smartfin\.transactionsphase31\.bench'" -or ($badging -join "`n") -match 'application-debuggable') { throw 'Isolated release APK guard' }
if (-not $SkipInstall) { Invoke-Adb @('install','-r',$apk) | Write-Output }
foreach ($size in $Sizes) {
 foreach ($version in $Versions) {
  $runId = 'scroll-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + "-$size-$version"
  $remote = "/sdcard/Android/data/$benchPackage/files/phase31-results/$runId.jsonl"
  Invoke-Adb @('shell','am','force-stop',$benchPackage) | Out-Null
  Invoke-Adb @('shell','am','start','-W','-n',"$benchPackage/com.smartfin.MainActivity",'--es','version',$version,'--es','size',[string]$size,'--es','runId',$runId) | Out-Null
  $ready = $false
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    $content = & adb -s $Serial shell cat $remote 2>$null
    if ($LASTEXITCODE -eq 0 -and $content -match 'scrollReady') { $ready=$true; break }
  }
  if (-not $ready) { throw 'Scroll screen not ready' }
  $focused=$false
  for ($attempt=0; $attempt -lt 6; $attempt++) {
    if ((Invoke-Adb @('shell','dumpsys','window')) -match 'mCurrentFocus=.*com.smartfin.transactionsphase31.bench') { $focused=$true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $focused) { throw 'Wrong foreground app' }
  # Inspect the actual UI before selecting coordinates. Agent-device is absent.
  Invoke-Adb @('shell','uiautomator','dump','/sdcard/sf-phase3-scroll.xml') | Out-Null
  $xmlText = Invoke-Adb @('shell','cat','/sdcard/sf-phase3-scroll.xml')
  $xmlText | Set-Content -LiteralPath (Join-Path $outputPath "$runId-before.xml") -Encoding utf8
  [xml]$document = $xmlText
  $bounds = @($document.SelectNodes('//node[@scrollable="true"]') | ForEach-Object {
    if ($_.bounds -match '\[(\d+),(\d+)\]\[(\d+),(\d+)\]') {
      @{left=[int]$Matches[1];top=[int]$Matches[2];right=[int]$Matches[3];bottom=[int]$Matches[4];height=([int]$Matches[4]-[int]$Matches[2])}
    }
  } | Sort-Object { $_.height } -Descending)[0]
  if (-not $bounds -or $bounds.height -lt 400) { throw 'Vertical history bounds unavailable' }
  $x = [int](($bounds.left + $bounds.right)/2)
  # The existing floating bottom navigation overlays the list's lower bounds.
  # Start inside the card area seen in the UI dump/screenshot, above that overlay.
  $yStart = [int]($bounds.top + $bounds.height*0.65)
  $yEnd = [int]($bounds.top + $bounds.height*0.12)
  $gestures = @()
  for ($gesture=0; $gesture -lt 20; $gesture++) {
    $gestures += @{index=$gesture;utc=[DateTime]::UtcNow.ToString('o');x=$x;fromY=$yStart;toY=$yEnd;durationMs=500}
    Invoke-Adb @('shell','input','swipe',[string]$x,[string]$yStart,[string]$x,[string]$yEnd,'500') | Out-Null
    Start-Sleep -Milliseconds 250
  }
  @{size=$size;bounds=$bounds;gestures=$gestures} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputPath "$runId-gestures.json") -Encoding utf8
  Invoke-Adb @('shell','uiautomator','dump','/sdcard/sf-phase3-scroll.xml') | Out-Null
  Invoke-Adb @('shell','cat','/sdcard/sf-phase3-scroll.xml') | Set-Content -LiteralPath (Join-Path $outputPath "$runId-after.xml") -Encoding utf8
  Invoke-Adb @('shell','screencap','-p','/sdcard/sf-phase3-scroll.png') | Out-Null
  Invoke-Adb @('pull','/sdcard/sf-phase3-scroll.png',(Join-Path $outputPath "$runId.png")) | Out-Null
  $complete=$false
  for ($attempt=0; $attempt -lt 50; $attempt++) {
    $content = Invoke-Adb @('shell','cat',$remote)
    if ($content -match '"type":"scroll"') { $complete=$true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $complete) { throw 'Scroll measurement incomplete' }
  Invoke-Adb @('pull',$remote,(Join-Path $outputPath "$runId.jsonl")) | Out-Null
  $record = @((Get-Content -LiteralPath (Join-Path $outputPath "$runId.jsonl")) | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object type -eq 'scroll')[0]
  if ($record.retainedTransactions -le 50 -or $record.uniqueTransactions -ne $record.retainedTransactions -or
    $record.visible.Count -lt 3 -or -not $record.windowFocused -or $record.keyguardLocked) { throw 'Gestures did not exercise progressive history scrolling' }
  Invoke-Adb @('shell','dumpsys','meminfo',$benchPackage) | Set-Content -LiteralPath (Join-Path $outputPath "$runId-meminfo.txt") -Encoding utf8
  Write-Output "COMPLETED $runId"
 }
}
Invoke-Adb @('shell','am','force-stop',$benchPackage) | Out-Null
