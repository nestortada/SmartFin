param(
  [Parameter(Mandatory=$true)][string]$Serial,
  [Parameter(Mandatory=$true)][ValidateSet(24,35)][int]$Api,
  [string]$Harness='C:/sf-5b3-20261023',
  [switch]$KeepAwake
)
$ErrorActionPreference='Stop'
$actual=(& adb -s $Serial shell getprop ro.build.version.sdk).Trim()
if($LASTEXITCODE -ne 0 -or $actual -ne [string]$Api){throw 'Wrong synthetic test API'}
$original=(& adb -s $Serial shell settings get global stay_on_while_plugged_in).Trim()
if($LASTEXITCODE -ne 0){throw 'Cannot read screen setting'}
$output="docs/estabilizacion-fase5b3/android/api$Api"
$completed=$false
try {
  if($KeepAwake){ & adb -s $Serial shell settings put global stay_on_while_plugged_in 15 | Out-Null }
  foreach($count in @(1000,10000,100000)) {
    & "$PSScriptRoot/run-android.ps1" -Harness $Harness -Serial $Serial -Campaign "acceptance-seed-$count" -Output "$output/seed-$count"
    foreach($repeat in 1..5) {
      & "$PSScriptRoot/run-android.ps1" -Harness $Harness -Serial $Serial -Campaign "acceptance-cold-$count-$repeat" -Output "$output/cold-$count-$repeat"
    }
    & "$PSScriptRoot/run-android.ps1" -Harness $Harness -Serial $Serial -Campaign "acceptance-warm-$count" -Output "$output/warm-$count"
  }
  $completed=$true
} finally {
  if($KeepAwake){ & adb -s $Serial shell settings put global stay_on_while_plugged_in $original | Out-Null }
  $after=(& adb -s $Serial shell settings get global stay_on_while_plugged_in).Trim()
  New-Item -ItemType Directory -Force $output | Out-Null
  @{serial=$Serial;completed=$completed;originalScreenSetting=$original;finalScreenSetting=$after;restored=$original -eq $after} |
    ConvertTo-Json | Set-Content -LiteralPath "$output/session.json" -Encoding utf8
}
