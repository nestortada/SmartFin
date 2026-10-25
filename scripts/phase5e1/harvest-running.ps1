param(
  [string]$Serial='AXCC6R3919012932',
  [string]$Harness='C:/sf-5e1-20261024',
  [string]$Output='docs/atomicidad-fase5e1/android/api35/final-history-legacy-100000',
  [int]$ExpectedPid,
  [int]$TimeoutMinutes=30
)
$ErrorActionPreference='Stop'
# Continue observing the SAME running synthetic campaign. Never install, launch,
# reset data, retry a financial command or declare latency acceptance here.
$pkg='com.smartfin.snapshot5b2.tests'
$mutex=[System.Threading.Mutex]::new($false,"SmartFinPhase5DTests-$Serial")
$owned=$false
try {$owned=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owned=$true}
if(-not $owned){throw 'Original runner still owns device; stop only its verified helper process first'}
try {
function Invoke-TestAdb {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
  $response=& adb -s $Serial @Arguments 2>&1
  if($LASTEXITCODE -ne 0){throw "ADB failed: $($Arguments -join ' '): $response"}
  return ($response -join "`n")
}
function Production-Metadata {
  $data=Invoke-TestAdb @('shell','dumpsys','package','com.smartfin')
  return (($data -split "`n" | Where-Object {$_ -match 'userId=|appId=|versionCode=|versionName=|lastUpdateTime=|firstInstallTime='}) -join "`n")
}
if($ExpectedPid -le 0){throw 'Explicit running synthetic PID required'}
$environment=Get-Content (Join-Path $Output 'environment.json') -Raw | ConvertFrom-Json
if($environment.serial -ne $Serial -or $environment.package -ne $pkg -or $environment.uid -eq $environment.productionUid){throw 'Isolation mismatch'}
$fingerprints=Get-Content (Join-Path $Output 'source-fingerprints.json') -Raw | ConvertFrom-Json
foreach($source in $fingerprints.originalHashes.PSObject.Properties){
  if((Get-FileHash -LiteralPath $source.Name -Algorithm SHA256).Hash.ToLowerInvariant() -ne $source.Value){throw "Source changed: $($source.Name)"}
}
$apk=Join-Path $Harness 'android/app/build/outputs/apk/release/app-release.apk'
if((Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant() -ne $environment.apkSha256){throw 'Original attested APK changed'}
$installed=(Invoke-TestAdb @('shell','pm','path',$pkg)).Replace('package:','').Trim()
$remoteHash=((Invoke-TestAdb @('shell','md5sum',$installed)) -split '\s+')[0]
if($remoteHash -ne (Get-FileHash $apk -Algorithm MD5).Hash.ToLowerInvariant()){throw 'Installed synthetic APK changed'}
$started=[DateTime]::UtcNow.ToString('o')
@{reason='Long read-only 100k comparison/replay approached helper observation budget; same app process retained';startedAt=$started;expectedPid=$ExpectedPid;appRestarted=$false;dataReset=$false;financialCommandsRetried=$false} |
  ConvertTo-Json | Set-Content (Join-Path $Output 'observation-continuation.json')
$remote="/sdcard/Android/data/$pkg/files/snapshot5b2-results/result.json"
$deadline=(Get-Date).AddMinutes($TimeoutMinutes)
$completed=$false
while((Get-Date) -lt $deadline){
  $current=(Invoke-TestAdb @('shell','pidof',$pkg)).Trim()
  if($current -ne [string]$ExpectedPid){throw 'Synthetic process changed during continued observation'}
  $response=& adb -s $Serial shell cat $remote 2>$null
  if($LASTEXITCODE -eq 0 -and $response){$completed=$true;break}
  Start-Sleep -Seconds 3
}
if(-not $completed){throw 'Still running; observation ended without stopping or passing the app'}
Invoke-TestAdb @('pull',$remote,(Join-Path $Output 'result.json')) | Write-Output
$report=Get-Content (Join-Path $Output 'result.json') -Raw | ConvertFrom-Json
$finishedPid=(Invoke-TestAdb @('shell','pidof',$pkg)).Trim()
if($report.campaign -ne 'phase5e1-history-legacy-100000' -or $finishedPid -ne [string]$ExpectedPid -or
   $report.config.uid -ne $environment.uid -or $report.config.packageId -ne $pkg -or
   $report.config.database -ne '/data/user/0/com.smartfin.snapshot5b2.tests/databases/phase5b2_synthetic.db'){
  throw 'Result does not belong to original running synthetic campaign'
}
Invoke-TestAdb @('logcat','-d','-v','threadtime','--pid',[string]$ExpectedPid) | Set-Content (Join-Path $Output 'logcat.txt')
$after=Production-Metadata
@{unchanged=$environment.productionMetadata -eq $after;before=$environment.productionMetadata;after=$after} | ConvertTo-Json |
  Set-Content (Join-Path $Output 'production-package-unchanged.json')
if($environment.productionMetadata -ne $after){throw 'Real package metadata changed'}
Invoke-TestAdb @('shell','am','force-stop',$pkg) | Out-Null
if(-not $report.passed){throw "Synthetic campaign failed: $($report.failure)"}
Write-Output "Passed $($report.cases.Count) cases in the original process $ExpectedPid; extended observation only."
} finally {$mutex.ReleaseMutex();$mutex.Dispose()}
