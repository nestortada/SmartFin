param(
  [string]$Serial='emulator-5554',
  [int]$Api=24,
  [string]$Harness='C:/sf-5e4-20261025',
  [string]$Label='optimized',
  [string[]]$Sizes=@('100000','10000','1000')
)
# 5E.4 manual backup profile: representative 50-calendar-year/5-year/6-month fixtures,
# three capture+publication rounds each. Sequential on one serial.
$ErrorActionPreference='Stop'
if([int](& adb -s $Serial shell getprop ro.build.version.sdk) -ne $Api){throw 'Unexpected API'}
foreach($size in $Sizes){
  $output="docs/optimizacion-fase5e4/android/api$Api/$Label-backup-$size"
  try {
    ./scripts/phase5e4/run-android.ps1 -Harness $Harness -Serial $Serial -Campaign "phase5e4-backup-$size" -Output $output -TimeoutMinutes 60
  } catch {
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    "$((Get-Date).ToUniversalTime().ToString('o')) $_" | Add-Content -LiteralPath (Join-Path $output 'runner-error.txt')
    Write-Warning "phase5e4-backup-$size failed: $_"
  }
}
