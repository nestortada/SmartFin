$ErrorActionPreference='Stop'
# Resume only missing synthetic campaigns after the recorded ADB transport failures.
# No native financial operation is repeated from an uncertain result.
foreach($target in @(@{serial='AXCC6R3919012932';api=35},@{serial='emulator-5554';api=24})) {
  $original=(& adb -s $target.serial shell settings get global stay_on_while_plugged_in).Trim()
  $completed=$false
  try {
    if($target.api -eq 35){
      & adb -s $target.serial shell settings put global stay_on_while_plugged_in 15 | Out-Null
      $campaigns=@('cold-100000-5','warm-100000')
    }else{
      $campaigns=@('seed-100000','cold-100000-1','cold-100000-2','cold-100000-3','cold-100000-4','cold-100000-5','warm-100000')
    }
    foreach($name in $campaigns) {
      & "$PSScriptRoot/run-android.ps1" -Serial $target.serial -Campaign "acceptance-$name" -Output "docs/estabilizacion-fase5b3/android/api$($target.api)/$name"
    }
    $completed=$true
  }finally{
    & adb -s $target.serial shell settings put global stay_on_while_plugged_in $original | Out-Null
    $after=(& adb -s $target.serial shell settings get global stay_on_while_plugged_in).Trim()
    @{serial=$target.serial;completed=$completed;originalScreenSetting=$original;finalScreenSetting=$after;restored=$after -eq $original;continuationOfRecordedTransportFailure=$true} |
      ConvertTo-Json | Set-Content -LiteralPath "docs/estabilizacion-fase5b3/android/api$($target.api)/session.json" -Encoding utf8
  }
}
