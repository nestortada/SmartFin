param(
  [string]$Serial='emulator-5554',
  [int]$Api=24,
  [string]$Harness='C:/sf-5e2-20261024',
  [string[]]$Sizes=@('1000','10000','100000'),
  [string[]]$Distributions=@('civil','legacyDay','legacyTied','legacyWithCivil','mixed'),
  [string[]]$Loads=@('integratedToday','legacySpread','canonicalSpread'),
  [switch]$SkipHistory,
  [switch]$SkipDashboard,
  [switch]$SkipIntegrated
)
# Sequential 5E.2 campaigns for one serial. Never overlap campaigns on a serial.
$ErrorActionPreference='Stop'
function Run-Case([string]$Campaign,[string]$Name,[int]$Timeout) {
  $output="docs/rendimiento-fase5e2/android/api$Api/$Name"
  try {
    ./scripts/phase5e2/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output $output -TimeoutMinutes $Timeout
  } catch {
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    "$((Get-Date).ToUniversalTime().ToString('o')) $_" | Add-Content -LiteralPath (Join-Path $output 'runner-error.txt')
    Write-Warning "$Campaign failed: $_"
  }
}
if(-not $SkipHistory){ Run-Case 'phase5e2-order-probe' 'order-probe' 30 }
foreach($size in $Sizes) {
  $timeout=if($size -eq '100000'){150}else{40}
  if(-not $SkipHistory){ foreach($d in $Distributions){ Run-Case "phase5e2-history-$d-$size" "history-$d-$size" $timeout } }
  if(-not $SkipDashboard){ foreach($l in $Loads){ Run-Case "phase5e2-dashboard-$l-$size" "dashboard-$l-$size" $timeout } }
}
# Same integrated 5E fixture and timers as the 5E/5E.1 acceptance (history first page and dashboard).
if(-not $SkipIntegrated){ Run-Case 'phase5e-performance' 'integrated-performance' 120 }
