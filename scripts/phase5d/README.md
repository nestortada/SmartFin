# Fase 5D: entrega Android aislada

Desde la raíz del repositorio, con Node/SDK/JDK ya instalados:

1. `node scripts/phase5d/prepare-android.cjs C:/sf-5d-20261024`
2. En `C:/sf-5d-20261024/android`, `./gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain`.
3. `./scripts/phase5d/run-suite.ps1 -Serial emulator-5554 -Api 24` y,
   en otro dispositivo, `./scripts/phase5d/run-suite.ps1 -Serial AXCC6R3919012932 -Api 35`.
4. Para un reinicio real, ejecutar `run-android.ps1 -Campaign phase5d-reboot-stage -KeepRunning`
   con el serial/directorio apropiados. Reiniciar únicamente ese dispositivo y
   desbloquearlo. Ejecutar `-Campaign phase5d-reboot-verify -PreserveData`.
   No borrar datos entre ambos pasos. `KeepRunning` evita dejar el paquete detenido
   forzosamente antes de BOOT_COMPLETED.
5. `node scripts/phase5d/quality.cjs` conserva reportes históricos al ejecutar
   Jest completo, TypeScript, ESLint y diff-check.
6. `node scripts/phase5d/summarize.cjs` verifica las campañas aceptadas y las
   huellas de producción, y calcula muestras temporales.

El único paquete instalable es `com.smartfin.snapshot5b2.tests`; la única base es
`phase5b2_synthetic.db`. Cada instalación comprueba APK, fuentes, UID distinto y
metadatos del paquete financiero. El APK es release/Hermes y utiliza los módulos
nativos reales y el driver instalado, sin cambiar dependencias. Las cancelaciones
globales del probe son exclusivas del UID sintético.

El receptor anterior está congelado en `docs/atomicidad-fase5d/baseline-sources/`.
Los hooks registran intentos y retornos de notify, estado de transacción y tiempos;
inyectan excepciones o matan realmente el proceso en los puntos elegidos. Un trigger
sintético prueba un UPDATE que falla después de publicar. Un contador privado del
probe sobrevive a la muerte del proceso; no forma parte de la entrega de producción
ni acredita persistencia ante pérdida eléctrica.

La barrera `phase5d-suppress-recovery` pertenece exclusivamente al banco de pruebas:
separa la inspección de fallos del mantenimiento que puede modificar legítimamente
el fixture manual. Se retira explícitamente para probar WorkManager y Headless JS
reales, y antes de reiniciar el dispositivo. Los cuatro callbacks BOOT/TIME/TIMEZONE/
PACKAGE también se inyectan directamente en el receptor de recuperación; esos
callbacks no se presentan como cambios reales del reloj o del sistema.

Los tiempos de notify incluyen la escritura del contador del probe. Son muestras
funcionales, no p95 ni medidas de FPS. Flags y cantidad activa no acreditan sonido,
vibración o banners percibidos por una persona. La ausencia de una notificación no
se usa como comprobante de no entrega.

Al terminar, detener únicamente el paquete sintético, restaurar el ajuste temporal
de pantalla del HONOR y cerrar solo el emulador iniciado para esta sesión.
