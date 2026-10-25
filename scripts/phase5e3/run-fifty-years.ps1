param(
  [string]$Serial='emulator-5554',
  [int]$Api=24,
  [string]$Harness='C:/sf-5e3-20261024'
)
# Acceptance volume (AGENTS.md "Performance Volumes"): 100k movements over 50 years,
# plus the API 24 rerun of the precision matrix. Concentrated 100k loads are not run.
$ErrorActionPreference='Stop'
if([int](& adb -s $Serial shell getprop ro.build.version.sdk) -ne $Api){throw 'Unexpected API'}
function Run-Case([string]$Campaign,[string]$Name,[int]$Timeout) {
  $output="docs/aceptacion-fase5e3/android/api$Api/$Name"
  $prior=Join-Path $output 'result.json'
  if((Test-Path $prior) -and (Get-Content -LiteralPath $prior -Raw | ConvertFrom-Json).passed){ Write-Output "Skip $Name (passed result present)"; return }
  if(Test-Path $output){ Move-Item -LiteralPath $output -Destination "$output-attempt-$((Get-Date).ToString('HHmmss'))" }
  try {
    ./scripts/phase5e3/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign $Campaign -Output $output -TimeoutMinutes $Timeout
  } catch {
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    "$((Get-Date).ToUniversalTime().ToString('o')) $_" | Add-Content -LiteralPath (Join-Path $output 'runner-error.txt')
    Write-Warning "$Campaign failed: $_"
  }
}
foreach($shape in @('civil','legacy','migrated')){
  Run-Case "phase5e3-history50-$shape-100000" "history50-$shape-100000" 120
  Run-Case "phase5e3-fifty-$shape" "fifty-$shape" 60
}
Run-Case "phase5e3-history50-civil-1000" "history50-civil-1000" 20
if($Api -eq 24){ Run-Case 'phase5e3-dashboard-precision' 'dashboard-precision' 20 }
