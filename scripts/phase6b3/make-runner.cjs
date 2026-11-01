'use strict';
// Mechanical, reviewable derivative of the first-install-fixed 6B.2 runner.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
if (process.argv.length !== 2) throw Error('No arguments');
const bytes = fs.readFileSync(path.join(root, 'scripts/phase6b2/run-android.ps1'));
if (crypto.createHash('sha256').update(bytes).digest('hex') !== '3004dd0d94bb7e706ffbefac901e854f16173ac2901f8ecadc31c88ba2fc40a0') throw Error('Runner baseline changed');
let text = bytes.toString().replaceAll('C:/sf-6b2r-20261030', 'C:/sf-6b3-20261101')
  .replaceAll('docs/correccion-fase6b2/android', 'docs/validacion-fase6b3-1/android')
  .replaceAll('phase6b2-probes', 'phase6b3-probes').replaceAll("'^phase6b2-", "'^phase6b3-|^phase6b2-");
const anchor = "$ErrorActionPreference='Stop'";
text = text.replace(anchor, () => anchor + `
if($Harness -ne 'C:/sf-6b3-20261101'){throw 'Only the 6B.3 synthetic workspace is authorized'}
if(-not (($Serial -eq 'emulator-5554') -or ($Serial -eq 'AXCC6R3919012932'))){throw 'Unrecognized serial'}
$allowed=@('phase6b3-probes','phase6b3-atomicity','phase6b3-unknown','phase6b3-unknown-restart','phase6a-precision','phase6b3-presentation','phase6b3-ui-small','phase6b3-ui-cents','phase6b3-ui-insufficient','phase6b3-ui-stale','phase6b3-ui-unknown')
if($Campaign -notin $allowed){throw 'Campaign not authorized'}
$expectedApi=if($Serial -eq 'emulator-5554'){24}else{35}
if($Output -cne "docs/validacion-fase6b3-1/android/api$expectedApi/$Campaign"){throw 'Output path must be exact'}
if(Test-Path -LiteralPath $Output){throw 'Evidence exists; do not overwrite'}
$actualApi=(& adb -s $Serial shell getprop ro.build.version.sdk) -join ''
if($LASTEXITCODE -ne 0 -or $actualApi.Trim() -ne [string]$expectedApi){throw 'API mismatch'}
if($expectedApi -eq 24){
  $avdLines=& adb -s $Serial emu avd name
  if($LASTEXITCODE -ne 0){throw 'AVD identity query failed'}
  $avd=($avdLines | ForEach-Object {$_.Trim()} | Where-Object {$_}) -join ':'
  if($avd -cne 'SmartFin_Guard_Synthetic_API24:OK'){throw 'AVD identity mismatch'}
}else{
  $model=(& adb -s $Serial shell getprop ro.product.model) -join ''
  if($LASTEXITCODE -ne 0 -or $model.Trim() -ne 'CRT-NX3'){throw 'HONOR identity mismatch'}
}
$identity=Get-Content -LiteralPath 'docs/validacion-fase6b3-1/authorization/apk-identity.json' -Raw | ConvertFrom-Json
if($identity.packageId -ne 'com.smartfin.snapshot5b2.tests'){throw 'APK package pin missing'}
if((Get-FileHash -LiteralPath 'C:/sf-6b3-20261101/android/app/build/outputs/apk/release/app-release.apk' -Algorithm SHA256).Hash.ToLowerInvariant() -ne $identity.sha256){throw 'APK hash mismatch'}
if((Get-FileHash -LiteralPath 'C:/sf-6b3-20261101/source-fingerprints.json' -Algorithm SHA256).Hash.ToLowerInvariant() -ne $identity.attestationSha256){throw 'Attestation hash mismatch'}
if($PreserveData -and $Campaign -ne 'phase6b3-unknown-restart'){throw 'PreserveData is restricted to unknown restart'}
`);
const destination = path.join(root, 'scripts/phase6b3/run-android.ps1');
if (fs.existsSync(destination) && !fs.readFileSync(destination, 'utf8').startsWith('# 6B.3.1 owner-authorized runner;')) throw Error('Unrecognized existing runner');
fs.writeFileSync(destination, '# 6B.3.1 owner-authorized runner; isolated synthetic package only.\n' + text);
console.log('6B.3 runner written, no Android operation performed.');
