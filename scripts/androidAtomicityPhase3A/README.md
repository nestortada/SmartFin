# Harness Android de atomicidad: fase 3A

Paquete aislado `com.smartfin.atomicityphase1.tests`, release/Hermes; reutiliza los
preparadores y recuperación de fases 1.1/2. No incluye módulos Kotlin financieros
de producción ni abre su base. No modifica dependencias ni el driver instalado.

La campaña `phase3a` descubre 10/16 escrituras para una/dos tarjetas y falla antes/después
de todas, comparando snapshots de todas las tablas, auditoría, revisión, saldos,
deudas, extractos y referencias. Añade validaciones, redondeo/límite, intención repetida,
concurrencia por deuda/fondos, lecturas bloqueadas, unknown con recuperación y tiempos
con cero/100.000 movimientos sintéticos adicionales. Watchdog: 60 segundos por caso;
un timeout es fallo. Usa la infraestructura anterior de inyección alrededor del driver
real; no simula fallos físicos del almacenamiento.

```powershell
node scripts/androidAtomicityPhase3A/prepare.js C:/sfatomicity-phase3a-new
$env:JAVA_HOME='C:/Program Files/Java/jdk-17'
& C:/sfatomicity-phase3a-new/android/gradlew.bat -p C:/sfatomicity-phase3a-new/android assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain
./scripts/androidAtomicityPhase3A/run.ps1 -Harness C:/sfatomicity-phase3a-new -Serial emulator-5554 -Output docs/atomicidad-fase3a/repeat-api24 -Campaign phase3a
./scripts/androidAtomicityPhase3A/run.ps1 -Harness C:/sfatomicity-phase3a-new -Serial AXCC6R3919012932 -Output docs/atomicidad-fase3a/repeat-api35 -Campaign phase3a
```

Repetir `core`, `begin-after`, `commit-before`, `rollback-before` en ambos entornos con
directorios de salida distintos. El runner conserva entorno, fingerprints, reporte,
logcat y metadatos del paquete de producción antes/después. Una fuente cambiada requiere
otra compilación; no atribuir a un APK anterior los resultados del código nuevo.

El preparador exige un directorio nuevo fuera del repositorio; el runner valida paquete
release antes de instalar. Solo elimina el reporte sintético anterior. Para evitar
interferencia entre campañas, no lanzar dos a la vez sobre el mismo dispositivo.
