# Harness aislado de fase 4

Reutiliza el paquete release/Hermes `com.smartfin.atomicityphase1.tests`, el driver
instalado/parcheado y los preparadores 1.1/2/3A/3B. Solo bases sintéticas con nombre
`atomicity_phase1_<timestamp>_<secuencia>.db`. No carga Kotlin financiero de producción
ni abre/exporta/migra la base de com.smartfin.

```powershell
node scripts/androidAtomicityPhase4/prepare.js C:/sfatomicity-phase4-new
$env:JAVA_HOME='C:/Program Files/Java/jdk-17'
& C:/sfatomicity-phase4-new/android/gradlew.bat -p C:/sfatomicity-phase4-new/android assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain
./scripts/androidAtomicityPhase4/run.ps1 -Harness C:/sfatomicity-phase4-new -Serial emulator-5554 -Output docs/atomicidad-fase4/complete-api24-phase4 -Campaign phase4
```

Repetir en HONOR API 35. Ejecutar también core, begin-after, commit-before,
rollback-before, phase2 y phase3a en cada dispositivo. El runner impide ejecutar
fuentes preparadas distintas del checkout y comprueba el paquete release y los
metadatos de producción antes/después. No ejecutar dos campañas en un dispositivo.

Para reinicio real de proceso, ejecutar phase4-restart-create; el runner detiene
la aplicación al terminar. Extraer `databaseName` de su result.json y pasar ese
nombre con `-SyntheticDatabaseName` a phase4-restart-verify en otro lanzamiento.
La verificación exige cuatro movimientos, banco 854.700 y el comprobante confirmado.

`AiSubscriptionCampaign.js` compara éxito contra el ejecutor anterior congelado,
descubre 26 escrituras del plan y 114 de diez flujos de Suscripciones y comprueba
antes/después: 280 posiciones. Los once controles adicionales completan 291 casos.
Node usa un importe real distinto del esperado en confirmPayment y cubre dos
posiciones más de alerta de precio; Android ejercita esa discrepancia también al
editar el movimiento vinculado. No se recortan posiciones descubiertas.

Los callbacks locales tienen un proxy de prueba que traza SQL e inyecta una sentencia
fallida antes/después del punto seleccionado, sin callbacks async. El ejecutor compartido
mantiene la inyección de recibos y las aperturas sintéticas del harness anterior.
Solo phase4 fija relojes JS/SQL; las regresiones de recuperación conservan sus relojes.

La copia de subscriptionRuntime sustituye exclusivamente su abridor por una dependencia
que exige seleccionar el fixture sintético. El resto del runtime es el de producción.
Las huellas originales y copiadas se distinguen en source-fingerprints.json. Los efectos
de recordatorio usan servicio simulado; no se presenta como validación del receptor,
AlarmManager o WorkManager de producción. El caso de intercalación de escritor utiliza
una barrera después del recibo de la primera transacción local, fuera de su callback.

Tras cambiar fuentes, `refresh.js <harness>` actualiza la copia y sus huellas; recompilar
antes de ejecutar. `summarize.js <harness>` exige 18 campañas finales completas, huellas
actuales y el driver instalado coincidente. Los intentos exploratorios no cuentan.
Los tiempos son muestras sintéticas sin percentiles ni afirmaciones de FPS.

Solo las carpetas `complete-*` entran en el resumen. `final-*` y `android-api24`
conservan ejecuciones exploratorias, sin atribuirlas al APK final. La actualización
comprueba todas las fuentes bajo src/, no solo una lista de archivos seleccionados.
El runner reutiliza el APK firmado si su hash coincide; cuando hace falta instalar
usa modo no streaming. API 24 compara MD5 únicamente para evitar reinstalación de
nuestro mismo binario; el SHA256 del APK y las huellas de fuentes se conservan de
forma independiente. No se extraen bases de datos para esta comprobación.
