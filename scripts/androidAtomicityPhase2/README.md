# Atomicidad manual: harness Android de fase 2

Aplicación release/Hermes aislada `com.smartfin.atomicityphase1.tests`. Reutiliza el preparador,
el reportador nativo, el driver instalado con el parche autorizado y las campañas de recuperación
de fase 1.1. No copia módulos Kotlin de respaldo o recordatorios de producción ni abre `smartfin.db`.

Cada fixture usa una base sintética nueva. `phase2` descubre las escrituras de diez caminos y
falla antes/después de cada sentencia, incluidas sus coincidencias repetidas. Exige igualdad
exacta de todas las tablas, auditoría, revisión, cuentas, deuda y métricas después de ROLLBACK
confirmado, además de FK/integridad. Comprueba concurrencia, restricciones reales, incertidumbre
y recuperación. La base grande contiene 100.000 movimientos sintéticos; se conservan las
consultas completas necesarias para conciliación y se mide el tiempo de espera del lector.

El watchdog de cada caso es de 60 segundos: vencerlo es un fallo, nunca una aprobación.
El límite de apertura/verificación de producción sigue siendo de 10 segundos. La actividad
exclusiva de pruebas mantiene la pantalla encendida durante la campaña; no cambia ajustes
persistentes del dispositivo. El runner la despierta e intenta descartar el keyguard antes
de iniciar; un bloqueo seguro puede requerir desbloqueo por el usuario.

```powershell
node scripts/androidAtomicityPhase2/prepare.js C:/sfatomicity-phase2-new
$env:JAVA_HOME='C:/Program Files/Java/jdk-17'
& C:/sfatomicity-phase2-new/android/gradlew.bat -p C:/sfatomicity-phase2-new/android assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain
./scripts/androidAtomicityPhase2/run.ps1 -Harness C:/sfatomicity-phase2-new -Serial emulator-5554 -Output docs/atomicidad-fase2/repeat-api24 -Campaign phase2
./scripts/androidAtomicityPhase2/run.ps1 -Harness C:/sfatomicity-phase2-new -Serial AXCC6R3919012932 -Output docs/atomicidad-fase2/repeat-api35 -Campaign phase2
```

Repetir con ese mismo APK las campañas `core`, `begin-after`, `commit-before`, `rollback-before`
en ambos dispositivos, usando un Output distinto por campaña. El runner comprueba release,
applicationId, resultado de campaña y metadatos de `com.smartfin` antes/después. No considera
aprobados los reportes intermedios ni los casos de diagnóstico que fallaron.

Los fingerprints incluyen fuentes financieras, adaptadores compartidos, driver y la actividad
del harness. El directorio debe ser nuevo y externo al repositorio. No reemplazar fuentes
de un APK ya compilado para atribuirle resultados de otra versión.
