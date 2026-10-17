# Harness aislado de fase 3A.1

`phase3a1` compara el pago de fase 3A congelado con la consulta de candidatos actual.
Un APK release/Hermes contiene ambas versiones y el mismo driver ya instalado.
Solo abre bases `atomicity_phase1_<timestamp>_<secuencia>.db` del paquete sintético
`com.smartfin.atomicityphase1.tests`. No abre la base ni incluye módulos financieros
nativos del paquete `com.smartfin`.

Por cada tamaño (1.000, 10.000, 100.000) y semilla (ajena/mixta):

- Pareja de bases idénticas; una muestra de calentamiento y tres medidas por versión.
- Orden de versiones alternado entre rondas; COMMIT real en cada pago.
- Reloj de auditoría JS/SQL fijo optativo del fixture, sin cambios al esquema de producción.
- Comparación nativa fila/columna/tipo completa, con Double exacto y solo IDs nuevos
  normalizados; se repite después de tres cambios de ciclo.
- Tiempos de pago, ámbito, lector en cola, lectura por driver, mapeo, cálculo y escrituras.
- Sonda nativa READONLY separada para SELECT y EXPLAIN; su error de diagnóstico se
  conserva si la plataforma rechaza EXPLAIN. Nunca se etiqueta como SQL puro el tiempo
  combinado de SQLite, conversión y puente de executeSql.

La instrumentación añade spans solo en copias del harness. `source-fingerprints.json`
conserva hashes originales e instrumentados; no modifica producción ni el driver.
El reportador Kotlin adicional está solo en esta app sintética. Los callbacks de
transacciones permanecen síncronos. Timeout por pago: 60 s; por comparación nativa: 120 s.
El runner espera como máximo 25 minutos por campaña y conserva los errores.

```powershell
node scripts/androidAtomicityPhase3A1/prepare.js C:/sfatomicity-phase3a1-new
$env:JAVA_HOME='C:/Program Files/Java/jdk-17'
& C:/sfatomicity-phase3a1-new/android/gradlew.bat -p C:/sfatomicity-phase3a1-new/android assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain
./scripts/androidAtomicityPhase3A1/run.ps1 -Harness C:/sfatomicity-phase3a1-new -Serial emulator-5554 -Output docs/atomicidad-fase3a1/repeat-api24-benchmark -Campaign phase3a1
./scripts/androidAtomicityPhase3A1/run.ps1 -Harness C:/sfatomicity-phase3a1-new -Serial AXCC6R3919012932 -Output docs/atomicidad-fase3a1/repeat-api35-benchmark -Campaign phase3a1
```

Después, con el mismo APK, repetir `phase3a`, `phase2`, `core`, `begin-after`,
`commit-before` y `rollback-before` en ambas API. Usar un directorio de salida nuevo
por campaña. No lanzar campañas concurrentes en el mismo dispositivo. El runner
verifica package/release y conserva metadatos de producción antes/después, entorno,
logcat y fingerprints. Preparar exige un directorio nuevo fuera del repositorio.
