param(
  [Parameter(Mandatory=$true)][string]$Serial,
  [Parameter(Mandatory=$true)][ValidateSet(24,35)][int]$Api,
  [string]$Harness='C:/sf-snapshot5b2-20261023',
  [switch]$KeepAwake
)
$ErrorActionPreference='Stop'
$actual=(& adb -s $Serial shell getprop ro.build.version.sdk).Trim()
if($LASTEXITCODE -ne 0 -or $actual -ne [string]$Api){throw 'Wrong synthetic test target API'}
$original=(& adb -s $Serial shell settings get global stay_on_while_plugged_in).Trim()
if($LASTEXITCODE -ne 0){throw 'Cannot read initial screen setting'}
$output="docs/atomicidad-fase5b2/android/api$Api"
try {
  if($KeepAwake){ & adb -s $Serial shell settings put global stay_on_while_plugged_in 15 | Out-Null }
  foreach($campaign in @('publication','publication-restart-verify','publication-after-verify','core','restart-verify','close-lost','open-lost','host-destroyed','host-real','publication-performance')) {
    & "$PSScriptRoot/run-android.ps1" -Harness $Harness -Serial $Serial -Campaign $campaign -Output "$output/$campaign"
  }
  foreach($stage in @('before','after','captured')) {
    & "$PSScriptRoot/run-android.ps1" -Harness $Harness -Serial $Serial -Campaign "publication-kill-$stage" -Output "$output/publication-kill-$stage"
    & "$PSScriptRoot/run-android.ps1" -Harness $Harness -Serial $Serial -Campaign publication-kill-recover -Output "$output/publication-recover-$stage"
  }
} finally {
  if($KeepAwake){ & adb -s $Serial shell settings put global stay_on_while_plugged_in $original | Out-Null }
  $after=(& adb -s $Serial shell settings get global stay_on_while_plugged_in).Trim()
  New-Item -ItemType Directory -Force $output | Out-Null
  @{serial=$Serial;originalScreenSetting=$original;finalScreenSetting=$after;restored=$original -eq $after;syntheticPackage='com.smartfin.snapshot5b2.tests'} |
    ConvertTo-Json | Set-Content -LiteralPath "$output/session.json" -Encoding utf8
}
