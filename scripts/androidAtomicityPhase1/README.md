# Harness Android de atomicidad, fases 1 y 1.1

Solo instala `com.smartfin.atomicityphase1.tests`. Crea bases sintéticas por caso; no carga AppNavigator, módulos Kotlin de producción ni `openSmartFinDatabase`. Usa los adaptadores y runner de producción copiados al preparar la aplicación. El driver instalado se copia a `vendor/sqlite`; sus hashes acreditan la versión del parche incluida en el APK.

Requisitos: Node existente, Android SDK, adb, JDK 17, dispositivos autorizados API 24/API 35 y las dependencias actuales del proyecto. No se cambia minSdkVersion ni se instala una imagen desde estos scripts. El directorio de preparación debe ser nuevo y externo al repositorio.

```powershell
node scripts/patchReactNativeSqliteStorage.js
node scripts/androidAtomicityPhase1/prepare.js C:/sfatomicity-phase11-reproduction
$env:JAVA_HOME='C:/Program Files/Java/jdk-17'
& C:/sfatomicity-phase11-reproduction/android/gradlew.bat -p C:/sfatomicity-phase11-reproduction/android assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain
foreach ($campaign in @('core','begin-after','commit-before','rollback-before')) {
  & scripts/androidAtomicityPhase1/run.ps1 -Harness C:/sfatomicity-phase11-reproduction -Serial emulator-5556 -Campaign $campaign -Output "docs/atomicidad-fase11/reproduction-api24-$campaign"
}
```

Para API 35 cambiar Serial por el dispositivo físico y usar otro Output. Las cuatro campañas contienen los **14 casos originales**: core ejecuta 11 originales y tres controles nuevos de cierre fallido; cada campaña aislada ejecuta un caso original. El watchdog de 30 segundos devuelve fallo, nunca una aprobación. El límite de recibo de cierre de producción es de 10 segundos y también devuelve error.

Campañas de diagnóstico separadas:

- `raw-driver`: BEGIN/escritura/cierre/reapertura sin coordinador ni runner; debe poder consultar la conexión nueva con el driver corregido.
- `native-probe`: experimento Android SQLite directo. El cierre sin terminar sesión debe mostrar bloqueo; terminar sesión propia sin marca revierte, y con marca exitosa confirma. Es caracterización de la causa, no prueba de rollback financiero exitoso del caso que falla.

Los casos de resultado desconocido guardan snapshots, revisión, número de ejecuciones del cuerpo y traza en `result.json`. Una traza registra solicitudes de SQL, incluso las rechazadas antes de enviarlas al driver; no prueba por sí sola ejecución nativa. Las excepciones inyectadas antes/después son deterministas y de un solo uso. Los controles negativos comprueban cuarentena, revocación y ausencia de nuevas consultas o segundos cierres, incluido un recibo descartado después del cierre real.

`run.ps1` verifica release/applicationId, conserva Logcat y fingerprints, compara metadatos del paquete de producción y detiene únicamente el paquete sintético. No limpia sus bases ni desinstala el paquete. Los metadatos no equivalen a leer o comparar los datos financieros reales; estos nunca se abren en el harness.

La validación de `openSmartFinDatabase` y sus fallos de integridad/apertura se hace en Jest con mocks que devuelven conexiones SQLite sintéticas. No se llama esa función contra Android durante estas campañas, porque usa el nombre de producción.
