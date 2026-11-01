# Autorización y alcance — 6B.3.1

Fecha: 1 de noviembre de 2026, America/Bogota.

La instrucción inicial exigía detener Android si el guard no autorizaba el runner.
Se respetó: el diagnóstico de solo lectura devolvió primero `attestation, apk` y,
tras restaurar el propietario el workspace, únicamente `attestation`.

El propietario comunicó después «por si acaso tambien desactive el hook» y autorizó
expresamente: **«Quiero que lo ejecutes ignora el kook dado que esta desactivado»**.
Esta instrucción posterior autoriza continuar la preparación y la campaña de esta
fase. No se presenta como una autorización por hashes emitida por el guard.
El agente no modificó, desactivó, renombró ni reemplazó archivos del guard.
Los registros `.claude/settings.json` y `.codex/hooks.json` conservaban su contenido;
el estado de activación de la sesión se conoce por la declaración del propietario.

## Destinos exactos

- Repositorio: `C:/Users/nesto/Proyectos/SmartFin`.
- Baseline restaurado, solo lectura: `C:/sf-6b2r-20261030`.
- Workspace nuevo: `C:/sf-6b3-20261101`.
- Aplicación: `com.smartfin.snapshot5b2.tests`.
- Emulador: serial `emulator-5554`, AVD `SmartFin_Guard_Synthetic_API24`, API 24.
- HONOR: serial `AXCC6R3919012932`, modelo `CRT-NX3`, API 35.
- Base: `/data/user/0/com.smartfin.snapshot5b2.tests/databases/phase5b2_synthetic.db`
  (alias `/data/data/…` admitido por el runner).
- Resultados Android del paquete: `/sdcard/Android/data/com.smartfin.snapshot5b2.tests/files/snapshot5b2-results/result.json`.
- Evidencias host: `docs/validacion-fase6b3-1/`.

## Comandos de preparación y ejecución

Desde el repositorio, un comando por llamada:

```powershell
node scripts/phase6b3/prepare-android.cjs
node scripts/phase6b3/refresh-harness.cjs
node scripts/phase6b3/make-runner.cjs
```

Compilación desde `C:/sf-6b3-20261101/android`, con dependencias instaladas y caché local:

```powershell
./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'
```

Arranque normal del AVD ya identificado, sin wipe ni Quick Boot:

```powershell
Start-Process -FilePath 'C:/Users/nesto/AppData/Local/Android/Sdk/emulator/emulator.exe' -ArgumentList '-avd SmartFin_Guard_Synthetic_API24 -no-boot-anim -no-snapshot' -WindowStyle Hidden
```

Campañas automáticas desde el repositorio:

```powershell
./scripts/phase6b3/run-all.ps1 -Serial emulator-5554 -Api 24
./scripts/phase6b3/run-all.ps1 -Serial AXCC6R3919012932 -Api 35
```

El runner interno admite únicamente los dos seriales y once campañas enumeradas en
su fuente, con carpeta de salida exacta, sin sobrescribir evidencias. Comprueba API,
AVD/modelo, hashes del APK y atestación, todas las fuentes originales y preparadas,
paquete release, atestación embebida, UID y ubicación de la base. `run-all.ps1`
ejecuta solo cinco campañas: sondas 6B.3, atomicidad, unknown, reapertura de unknown
conservando datos sintéticos, y `phase6a-precision` corregida.

Para una escena de interfaz se usa `run-android.ps1` con el mismo serial, una campaña
literal de la lista (`phase6b3-presentation`, `phase6b3-ui-small`, `phase6b3-ui-cents`,
`phase6b3-ui-insufficient`, `phase6b3-ui-stale`, `phase6b3-ui-unknown`), carpeta
`docs/validacion-fase6b3-1/android/api24/<campaña>` o `api35/<campaña>` y `-KeepRunning`.
Una escena sembrada no acredita la aceptación visual: esta se documenta por separado.

## Efectos autorizados

- Preparador: copia fuentes/configuración sintéticas al workspace nuevo, mantiene
  los hooks de prueba heredados, refresca las ocho fuentes de producción cambiadas
  y el oráculo Android 6A; añade sondas, pantalla real y matriz 6B.3. No ejecuta SQL.
- Build: genera artefactos Gradle/CMake, bundle Hermes y APK release en el workspace;
  usa la configuración de firma de pruebas heredada. No instala dependencias ni APK.
- Runner: puede instalar/actualizar **únicamente** el APK sintético, cerrar su proceso,
  limpiar sus datos entre campañas independientes y ajustar exclusivamente su permiso
  de notificaciones. El reinicio de unknown es cierre/reapertura del proceso sintético.
- Durante la prueba se despierta la pantalla, se descarta keyguard si el dispositivo
  lo permite y se capturan textos, jerarquías, capturas, condiciones y logcat del PID
  sintético. Agent-device se vincula al serial y paquete de pruebas; las interacciones
  se realizan tras inspeccionar la pantalla.
- Sin uninstall, wipe de AVD, reinicio físico del HONOR, cambio de saldos personales,
  cambios de dependencias, esquema, migraciones ni driver.

## Protección de producción y hashes

`com.smartfin` solo aparece en lecturas de metadatos de paquete y en la comprobación
de aislamiento del harness. No hay comandos de instalación, borrado, cierre o lanzamiento
dirigidos a él. Su UID debe diferir del sintético. La comprobación nativa exige que el
paquete sintético no pueda leer la base de producción; no abre ni lee sus filas.
El runner conserva metadatos antes/después de cada campaña. Esto acredita el alcance
observado y la separación por UID, no constituye un hash de la base personal.

`inputs.sha256.json` conserva la primera captura de fuentes y guard, la verificación
íntegra del baseline restaurado y las nueve diferencias esperadas del checkout respecto
a 6B.2 (ocho fuentes y el harness 6A). El APK histórico `85af989b…` es **6B.2** y no sirve
para aceptar 6B.3. La identidad del APK nuevo se registra en `apk-identity.json` antes
de instalarlo; la atestación completa se conserva con cada campaña.

No se concede permiso general a shells, scripts, seriales o paquetes. No se avanza de fase.
