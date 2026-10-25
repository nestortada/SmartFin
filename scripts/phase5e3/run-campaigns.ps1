param(
  [string]$Serial='emulator-5554',
  [int]$Api=24,
  [string]$Harness='C:/sf-5e3-20261024',
  [switch]$SkipHistory,
  [switch]$SkipDashboard,
  [switch]$SkipLarge
)
# Sequential 5E.3 campaigns for one serial. Never overlap campaigns on a serial.
# Node covers all 13 distributions x 5 created_at shapes; Android repeats the
# shapes of the 5E.1/5E.2 Android fixtures plus offsets and canonical keys.
$ErrorActionPreference='Stop'
if([int](& adb -s $Serial shell getprop ro.build.version.sdk) -ne $Api){throw 'Unexpected API'}
function Run-Case([string]$Campaign,[string]$Name,[int]$Timeout) {
  $output="docs/aceptacion-fase5e3/android/api$Api/$Name"
  if(Test-Path (Join-Path $output 'result.json')){ Write-Output "Skip $Name (result present)"; return }
  try {
    ./scripts/phase5e3/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output $output -TimeoutMinutes $Timeout
  } catch {
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    "$((Get-Date).ToUniversalTime().ToString('o')) $_" | Add-Content -LiteralPath (Join-Path $output 'runner-error.txt')
    Write-Warning "$Campaign failed: $_"
  }
}
$distributions=@('civil','legacyDay','legacyTied','legacyWithCivil','mixed','canonicalUtc','legacyWithOffset')
if(-not $SkipDashboard){
  Run-Case 'phase5e3-dashboard-precision' 'dashboard-precision' 20
  Run-Case 'phase5e3-dashboard-selectivity' 'dashboard-selectivity' 90
}
if(-not $SkipHistory){
  foreach($d in $distributions){ foreach($v in @('grouped','reverse','scrambled','constant','mixedFormat')){ Run-Case "phase5e3-history-$d-$v-1000" "history-$d-$v-1000" 30 } }
  foreach($d in $distributions){ foreach($v in @('scrambled','constant')){ Run-Case "phase5e3-history-$d-$v-10000" "history-$d-$v-10000" 60 } }
}
if(-not $SkipLarge -and -not $SkipHistory){
  # No 100k single-day history (AGENTS.md "Performance Volumes": 100k span decades).
  foreach($c in @('civil-scrambled','legacyDay-reverse','canonicalUtc-constant','legacyWithCivil-scrambled','mixed-scrambled')){
    Run-Case "phase5e3-history-$c-100000" "history-$c-100000" 360
  }
}
