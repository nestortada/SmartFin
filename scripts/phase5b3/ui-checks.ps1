param(
  [Parameter(Mandatory=$true)][string]$Serial,
  [Parameter(Mandatory=$true)][ValidateSet(24,35)][int]$Api,
  # Read the actual menu screenshot on this device before supplying coordinates.
  [Parameter(Mandatory=$true)][int]$SettingsX,
  [Parameter(Mandatory=$true)][int]$SettingsY
)
$ErrorActionPreference='Stop'
$folder="docs/estabilizacion-fase5b3/ui/api$Api"
function Screen([string]$name,[string]$action='snapshot',[string]$label='') {
  $argsForNode=@("$PSScriptRoot/ui.cjs",$Serial,[string]$Api,$name,$action)
  if($label){$argsForNode+=$label}
  $text=& node @argsForNode
  if($LASTEXITCODE -ne 0){throw "UI action failed: $name"}
  $text | Set-Content -LiteralPath "$folder/$name.json" -Encoding utf8
  return ($text | ConvertFrom-Json)
}
function Launch([string]$campaign) {
  & adb -s $Serial shell am force-stop com.smartfin.snapshot5b2.tests | Out-Null
  & adb -s $Serial shell am start -W -a android.intent.action.VIEW -n com.smartfin.snapshot5b2.tests/com.smartfin.MainActivity -d "snapshot5b2://campaign/ui-$campaign" | Out-Null
  $launchScreen=$null
  foreach($attempt in 1..8) {
    $launchScreen=Screen "$campaign-start"
    if($launchScreen.nodes.text -contains 'DESPUÉS' -or $launchScreen.nodes.label -contains 'Más'){break}
  }
  if($launchScreen.nodes.text -contains 'DESPUÉS'){ $null=Screen "$campaign-dismiss" 'tap' 'DESPUÉS' }
  $null=Screen "$campaign-more" 'tap' 'Más'
  # XML bounds of the animated menu can be inverted on RN/API24. Use reviewed pixels.
  & adb -s $Serial shell input tap $SettingsX $SettingsY | Out-Null
  $targetLabel=if($campaign -eq 'revoked'){'Elegir carpeta'}elseif($campaign -like 'recover*'){'Verificar'}else{'Publicar'}
  & node "$PSScriptRoot/ui-align.cjs" $Serial ([string]$Api) "$campaign-align" $targetLabel | Out-Null
  if($LASTEXITCODE -ne 0){throw "Cannot align $targetLabel"}
}
function Contains($screen,[string]$text){ return @($screen.nodes | Where-Object {$_.text -like "*$text*"}).Count -gt 0 }
function Assert($value,[string]$message){if(-not $value){throw $message}}
function Evidence([string]$name){
  & adb -s $Serial pull /sdcard/Android/data/com.smartfin.snapshot5b2.tests/files/snapshot5b2-results/result.json "$folder/$name-events.json" | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Event evidence pull failed'}
  $report=Get-Content -LiteralPath "$folder/$name-events.json" -Raw | ConvertFrom-Json
  $expected=if($name -eq 'retained-uncertain'){'ui-recover'}else{"ui-$name"}
  Assert ($report.campaign -eq $expected) 'Event transcript belongs to another campaign'
  return $report
}
$results=@()
Launch 'slow'
$null=Screen 'slow-double' 'double' 'Publicar'
$capturing=Screen 'slow-capturing'
Assert (Contains $capturing 'Capturando SQLite') 'Capture progress missing'
Assert (@($capturing.nodes | Where-Object { $_.label -eq 'Cambiar carpeta' -and $_.enabled -eq 'false' }).Count -eq 1) 'Directory must be disabled'
$null=Screen 'slow-leave' 'tap' 'Inicio'
$null=Screen 'slow-return-more' 'tap' 'Más'
& adb -s $Serial shell input tap $SettingsX $SettingsY | Out-Null
$returned=Screen 'slow-returned'
Assert (Contains $returned 'Capturando SQLite') 'Owner lost across navigation'
$null=Screen 'slow-release-capture' 'tap' 'Liberar captura de prueba'
$null=Screen 'slow-release-saf' 'tap' 'Liberar SAF de prueba'
$null=Screen 'slow-result-scroll' 'scroll'
$verified=Screen 'slow-result'
Assert (Contains $verified 'Generación verificada mediante SAF') 'Manual publication not verified'
$events=Evidence 'slow'
Assert (@($events.observations.jobId | Sort-Object -Unique).Count -eq 1) 'Double tap created multiple jobs'
$results+=@{case='manual-double-navigation';passed=$true;jobId=$events.observations[0].jobId}

Launch 'publishslow'
$null=Screen 'publishslow-submit' 'double' 'Publicar'
$publishing=Screen 'publishslow-active'
Assert (Contains $publishing 'Publicando y verificando archivos') 'Publication progress missing'
$null=Screen 'publishslow-release' 'tap' 'Liberar captura de prueba'
$verified=Screen 'publishslow-result'
Assert (Contains $verified 'Generación verificada mediante SAF') 'Publication did not complete'
$null=Evidence 'publishslow'
$results+=@{case='publication-progress';passed=$true}

Launch 'fail'
$null=Screen 'fail-submit' 'tap' 'Publicar'
$failed=Screen 'fail-result'
Assert ((Contains $failed 'Cannot create smartfin-') -and (Contains $failed 'smartfin-backup.db')) 'Local publication error missing'
$failure=Evidence 'fail'
Launch 'recoverinspect'
$null=Screen 'recoverinspect-submit' 'double' 'Verificar'
$recovering=Screen 'recoverinspect-active'
Assert (Contains $recovering 'Inspeccionando el snapshot original') 'Recovery snapshot phase missing'
$null=Screen 'recoverinspect-release' 'tap' 'Liberar captura de prueba'
$verified=Screen 'recoverinspect-result'
Assert (Contains $verified 'Generación verificada mediante SAF') 'Original recovery did not verify'
$recovery=Evidence 'recoverinspect'
Assert ($failure.observations[0].jobId -eq $recovery.observations[0].jobId) 'Recovery changed identity'
Assert ($recovery.observations.state -contains 'continuingPublication') 'Continuation phase missing'
$results+=@{case='failure-restart-original-snapshot';passed=$true;jobId=$recovery.observations[0].jobId}

Launch 'finalfail'
$null=Screen 'finalfail-submit' 'tap' 'Publicar'
$null=Screen 'finalfail-result'
$failure=Evidence 'finalfail'
Launch 'recoverexternal'
$null=Screen 'recoverexternal-submit' 'tap' 'Verificar'
$external=Screen 'recoverexternal-active'
Assert (Contains $external 'Validando componentes externos mediante SAF') 'External validation phase missing'
$null=Screen 'recoverexternal-release' 'tap' 'Liberar captura de prueba'
$verified=Screen 'recoverexternal-result'
Assert (Contains $verified 'Generación verificada mediante SAF') 'External recovery did not verify'
$recovery=Evidence 'recoverexternal'
Assert ($failure.observations[0].jobId -eq $recovery.observations[0].jobId) 'External recovery changed job'
Assert (-not ($recovery.observations.state -contains 'inspectingSnapshot')) 'External verification unexpectedly needed snapshot'
$results+=@{case='external-manifest-recovery';passed=$true;jobId=$recovery.observations[0].jobId}

Launch 'revoked'
$revoked=Screen 'revoked-result'
Assert (Contains $revoked 'Android perdió el acceso') 'Lost permission must not be reported merely as outdated'
$results+=@{case='revoked-provider-access';passed=$true}

Launch 'uncertain'
$null=Screen 'uncertain-submit' 'tap' 'Publicar'
$uncertain=Screen 'uncertain-result'
Assert (Contains $uncertain 'Provider content verification failed') 'Uncertain publication error missing'
$failure=Evidence 'uncertain'
Launch 'recover'
$null=Screen 'uncertain-reverify' 'tap' 'Verificar'
$dialog=Screen 'uncertain-retained'
Assert (Contains $dialog 'Trabajo sin verificar') 'Uncertainty not preserved'
$recovery=Evidence 'retained-uncertain'
Assert ($failure.observations[0].jobId -eq $recovery.observations[0].jobId) 'Uncertain recovery changed identity'
Assert ($recovery.observations[-1].state -eq 'uncertain') 'Partial bytes must not be promoted'
$null=Screen 'uncertain-keep' 'tap' 'CONSERVAR PENDIENTE'
$results+=@{case='partial-bytes-restart-remain-uncertain';passed=$true;jobId=$recovery.observations[0].jobId}
@{api=$Api;serial=$Serial;passed=$true;cases=$results;limits='Synthetic provider faults and test-only stage gates; process restart, not OS reboot; no TalkBack certification or FPS measurement'} |
  ConvertTo-Json -Depth 10 | Set-Content -LiteralPath "$folder/ui-results.json" -Encoding utf8
