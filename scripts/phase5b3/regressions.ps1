param([Parameter(Mandatory=$true)][string]$Serial,[Parameter(Mandatory=$true)][ValidateSet(24,35)][int]$Api)
$ErrorActionPreference='Stop'
$original=(& adb -s $Serial shell settings get global stay_on_while_plugged_in).Trim()
$completed=$false
try {
  & adb -s $Serial shell settings put global stay_on_while_plugged_in 15 | Out-Null
  foreach($campaign in @('core','restart-verify','publication','publication-restart-verify','publication-after-verify','close-lost','open-lost')) {
    & "$PSScriptRoot/run-android.ps1" -Harness C:/sf-5b3ui-20261023 -Serial $Serial -Campaign $campaign -Output "docs/estabilizacion-fase5b3/regressions/api$Api/$campaign"
  }
  $completed=$true
}finally{
  & adb -s $Serial shell settings put global stay_on_while_plugged_in $original | Out-Null
  $after=(& adb -s $Serial shell settings get global stay_on_while_plugged_in).Trim()
  New-Item -ItemType Directory -Force "docs/estabilizacion-fase5b3/regressions/api$Api" | Out-Null
  @{serial=$Serial;completed=$completed;originalScreenSetting=$original;finalScreenSetting=$after;restored=$original -eq $after} |
    ConvertTo-Json | Set-Content -LiteralPath "docs/estabilizacion-fase5b3/regressions/api$Api/session.json" -Encoding utf8
}
