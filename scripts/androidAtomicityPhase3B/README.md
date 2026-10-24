# Harness de fase 3B

Aplicación release/Hermes aislada `com.smartfin.atomicityphase1.tests`. Reutiliza
el driver instalado y los preparadores de fases 1.1/2/3A. No copia los módulos
Kotlin financieros de producción ni abre `smartfin.db` de la aplicación real.
El preparador exige una carpeta nueva fuera del repositorio.

```powershell
node scripts/androidAtomicityPhase3B/prepare.js C:/sfatomicity-phase3b-new
$env:JAVA_HOME='C:/Program Files/Java/jdk-17'
& C:/sfatomicity-phase3b-new/android/gradlew.bat -p C:/sfatomicity-phase3b-new/android assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain
./scripts/androidAtomicityPhase3B/run.ps1 -Harness C:/sfatomicity-phase3b-new -Serial emulator-5554 -Output docs/atomicidad-fase3b/repeat-api24 -Campaign phase3b
```

Repetir en API 35 y ejecutar `phase3a`, `phase2`, `core`, `begin-after`,
`commit-before` y `rollback-before` en ambas API, cada una con salida propia.
El runner valida el paquete release antes de instalar y compara los metadatos
del paquete financiero antes/después. No iniciar dos campañas en el mismo equipo.

`ManagementCampaign.js` descubre cada escritura de ocho flujos e inyecta fallos
antes y después por SQL/ocurrencia. Compara todas las tablas, auditoría, revisión,
referencias y métricas tras rollback, y el éxito contra fuentes anteriores congeladas.
Incluye compras antiguas, varias tarjetas, cuotas parcialmente pagadas, estados,
validación monetaria, conflictos, concurrencia, lectores y recuperación de `unknown`.

Solo `phase3b` fija los relojes JS y SQL de sus bases sintéticas. Las campañas
históricas de recuperación conservan sus relojes reales. Los tiempos usan
`performance.now()` y registran operación, ámbito BEGIN/COMMIT y lector externo.
Son muestras por flujo/volumen independientes, sin percentiles ni prueba de FPS.
El perfilado envuelve el driver en el harness; no modifica producción.

Los archivos anteriores de gestión/relaciones viven en `__tests__/helpers/phase3B*`;
se copian al harness con imports relativos adaptados. No ejecutar esos oráculos
desde la aplicación financiera. Una modificación de fuentes exige recompilar y
volver a verificar fingerprints. Los fallos inyectados no simulan apagados físicos.

`node scripts/androidAtomicityPhase3B/summarize.js <harness>` exige las catorce campañas
completas y valida fuentes/driver/APK. Si el usuario desconecta expresamente API 35,
`--allow-disconnected-api35` permite generar un resumen parcial: las campañas sin
resultado permanecen pendientes y `complete` es false; nunca las marca aprobadas.
