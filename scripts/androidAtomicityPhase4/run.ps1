param([string]$Harness='C:/sfatomicity-phase4',[string]$Serial='AXCC6R3919012932',[string]$Output='docs/atomicidad-fase4/android',[ValidateSet('phase4','phase4-restart-create','phase4-restart-verify','phase3b','phase3a','phase2','core','begin-after','commit-before','rollback-before','native-probe','raw-driver')][string]$Campaign='phase4',[string]$SyntheticDatabaseName='')
$ErrorActionPreference='Stop'
if((Test-Path -LiteralPath (Join-Path $Harness 'validation-hold')) -and $env:SMARTFIN_PHASE4_READY -ne 'verified-full-sources'){throw 'Synthetic validation held while sources/APK are being verified.'}
$phase4Fingerprint=Get-Content -LiteralPath (Join-Path $Harness 'source-fingerprints.json') -Raw | ConvertFrom-Json
foreach($phase4Source in $phase4Fingerprint.originalHashes.PSObject.Properties){
  if(Test-Path -LiteralPath $phase4Source.Name){
    if((Get-FileHash -LiteralPath $phase4Source.Name -Algorithm SHA256).Hash.ToLowerInvariant() -ne $phase4Source.Value){throw "Prepared sources differ for $($phase4Source.Name); refresh and rebuild before running."}
  }
}
$testPackage='com.smartfin.atomicityphase1.tests'
if($testPackage -eq 'com.smartfin'){throw 'Package isolation failed'}
New-Item -ItemType Directory -Path $Output -Force | Out-Null
function Invoke-TestAdb {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
  $response=& adb -s $Serial @Arguments 2>&1
  if($LASTEXITCODE -ne 0){throw "ADB failed: $($Arguments -join ' '): $response"}
  return ($response -join "`n")
}
function Production-Metadata {
  $data=Invoke-TestAdb @('shell','dumpsys','package','com.smartfin')
  return (($data -split "`n" | Where-Object {$_ -match 'versionCode=|versionName=|lastUpdateTime=|firstInstallTime='}) -join "`n")
}
$before=Production-Metadata
$environment=@{serial=$Serial;api=(Invoke-TestAdb @('shell','getprop','ro.build.version.sdk')).Trim();model=(Invoke-TestAdb @('shell','getprop','ro.product.model')).Trim();android=(Invoke-TestAdb @('shell','getprop','ro.build.version.release')).Trim();package=$testPackage;productionMetadata=$before}
$environment | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'environment.json') -Encoding utf8
$apk=Join-Path $Harness 'android/app/build/outputs/apk/release/app-release.apk'
$aapt=Join-Path $env:ANDROID_HOME 'build-tools/36.0.0/aapt.exe'
$badging=& $aapt dump badging $apk
if($LASTEXITCODE -ne 0 -or ($badging -join "`n") -notmatch "package: name='com\.smartfin\.atomicityphase1\.tests'" -or ($badging -join "`n") -match 'application-debuggable'){throw 'Isolated release APK verification failed'}
$badging | Set-Content -LiteralPath (Join-Path $Output 'apk-badging.txt') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $Harness 'source-fingerprints.json') -Destination (Join-Path $Output 'source-fingerprints.json') -Force
$phase4ExpectedApk=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$phase4CompareHash=$phase4ExpectedApk
$phase4HashAlgorithm='SHA256'
$phase4PackagePaths=& adb -s $Serial shell pm path $testPackage 2>$null
$phase4InstalledPath=($phase4PackagePaths | Where-Object {$_ -match '^package:/data/app/'} | Select-Object -First 1) -replace '^package:',''
$phase4InstalledHash=''
if($phase4InstalledPath -match '^/data/app/[A-Za-z0-9_./=~+-]+/base\.apk$'){
  & adb -s $Serial shell test -f $phase4InstalledPath
  $phase4ApkExists=$LASTEXITCODE -eq 0
}else{$phase4ApkExists=$false}
if($phase4ApkExists){
  $phase4RemoteHash=& adb -s $Serial shell sha256sum $phase4InstalledPath 2>$null
  if($LASTEXITCODE -eq 0 -and ($phase4RemoteHash -join '') -match '^[a-fA-F0-9]{64}\s'){
    $phase4InstalledHash=(($phase4RemoteHash -join '') -split '\s+')[0].ToLowerInvariant()
  }else{
    # API 24 provides md5sum: only a cache/equality check on our own signed APK.
    # The report retains the host SHA256 independently; this is no authenticity claim.
    $phase4HashAlgorithm='MD5'
    $phase4CompareHash=(Get-FileHash -LiteralPath $apk -Algorithm MD5).Hash.ToLowerInvariant()
    $phase4InstalledHash=((Invoke-TestAdb @('shell','md5sum',$phase4InstalledPath)) -split '\s+')[0].ToLowerInvariant()
  }
}
if($phase4InstalledHash -ne $phase4CompareHash){Invoke-TestAdb @('install','--no-streaming','-r',$apk) | Write-Output}else{Write-Output 'Installed isolated APK hash matches; reusing it.'}
@{apkSha256=$phase4ExpectedApk;comparisonAlgorithm=$phase4HashAlgorithm;installedBefore=$phase4InstalledHash;reused=$phase4InstalledHash -eq $phase4CompareHash} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'installed-apk-verification.json') -Encoding utf8
Invoke-TestAdb @('shell','am','force-stop',$testPackage) | Out-Null
Invoke-TestAdb @('shell','input','keyevent','224') | Out-Null
Invoke-TestAdb @('shell','wm','dismiss-keyguard') | Out-Null
$remote="/sdcard/Android/data/$testPackage/files/atomicity-results/result.json"
Invoke-TestAdb @('shell','rm','-f',$remote) | Out-Null
$phase4Uri="atomicity-phase1://campaign/$Campaign"
if($SyntheticDatabaseName){if($SyntheticDatabaseName -notmatch '^atomicity_phase1_\d+_\d+\.db$'){throw 'Synthetic name required'};$phase4Uri+='?database='+$SyntheticDatabaseName}
Invoke-TestAdb @('shell','am','start','-W','-a','android.intent.action.VIEW','-n',"$testPackage/com.smartfin.MainActivity",'-d',$phase4Uri) | Write-Output
$deadline=(Get-Date).AddMinutes(25)
$completed=$false
while((Get-Date) -lt $deadline){
  Start-Sleep -Seconds 3
  $result=& adb -s $Serial shell cat $remote 2>$null
  if($LASTEXITCODE -eq 0 -and $result){$completed=$true;break}
}
$processId=(Invoke-TestAdb @('shell','pidof',$testPackage)).Trim()
Invoke-TestAdb @('logcat','-d','-v','threadtime','--pid',$processId) | Set-Content -LiteralPath (Join-Path $Output 'logcat.txt') -Encoding utf8
Invoke-TestAdb @('shell','am','force-stop',$testPackage) | Out-Null
$after=Production-Metadata
@{unchanged=$before -eq $after;before=$before;after=$after} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'production-package-unchanged.json') -Encoding utf8
if($after -ne $before){throw 'Production package metadata changed'}
if(-not $completed){throw 'Isolated harness timed out; inspect logcat'}
Invoke-TestAdb @('pull',$remote,(Join-Path $Output 'result.json')) | Write-Output
$report=Get-Content -LiteralPath (Join-Path $Output 'result.json') -Raw | ConvertFrom-Json
if($report.campaign -ne $Campaign){throw "Unexpected campaign: $($report.campaign); expected $Campaign"}
if(-not $report.passed){throw "Android cases failed: $($report | ConvertTo-Json -Depth 6)"}
if ($Campaign -in @('raw-driver','native-probe')) {
  Write-Output "Passed diagnostic campaign $Campaign. Production package metadata unchanged."
} else {
  Write-Output "Passed $($report.cases.Count) Android cases. Production package metadata unchanged."
}




