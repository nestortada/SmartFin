# Aceptación integrada 5E

Solo datos sintéticos. No habilita la bandera de respaldos ni distribución.

1. `node scripts/phase5e/quality.cjs baseline-new` ejecuta Jest, TypeScript estricto,
   ESLint y diff-check, conserva bytes de reportes históricos y atesta fuentes.
2. `node scripts/phase5e/prepare-android.cjs C:/sf-5e-20261024` prepara una copia
   aislada sobre el banco 5D/5C/5B.2. No utilizar el checkout financiero como destino.
   Requiere Node, SDK y JDK ya instalados. Para API 24 basta `x86_64`; para la campaña
   física compilar también `arm64-v8a`.
3. En `C:/sf-5e-20261024/android`: `./gradlew.bat assembleRelease
   '-PreactNativeArchitectures=x86_64' --console=plain` con JDK 17.
4. Ejecutar `scripts/phase5e/run-android.ps1 -Campaign phase5e-integrated -Output
   docs/atomicidad-fase5e/android/api24/integrated-final2`; después, sin limpiar
   datos, `-Campaign phase5e-restart -PreserveData -Output
   docs/atomicidad-fase5e/android/api24/restart-final2`.
5. `-Campaign phase5e-performance -Output docs/atomicidad-fase5e/android/api24/performance-final`
   reinicia solo el fixture sintético. Ejecuta 1k/10k/100k con comandos reales,
   captura/publicación y borrado/limpieza por volumen. El llenado masivo es historia
   sintética sembrada por SQL; no es una medición de altas individuales.
6. `scripts/phase5e/run-regressions.ps1` ejecuta secuencialmente notificaciones,
   fallos de limpieza/borrado y captura/publicación. Nunca solapar campañas en un serial.
7. Para reboot API 24: ejecutar `phase5d-reboot-stage -KeepRunning`, registrar
   `/proc/sys/kernel/random/boot_id`, reiniciar solo el emulador, esperar arranque,
   registrar otro boot_id y ejecutar `phase5d-reboot-verify -PreserveData`.
   El resultado distingue `automaticAlarm` antes de la invocación explícita.
   Un reboot físico necesita autorización del propietario; la campaña HONOR 5E
   posterior cuenta con autorización explícita y conserva sus propios boot_id.
8. `node scripts/phase5e/reader-contract.cjs` relee fixtures binarios locales,
   comprueba selección/hash y límites de fecha/época. No contacta Drive ni ChatGPT.
9. `node scripts/phase5e/quality.cjs final` y `node scripts/phase5e/summarize.cjs`.

Campaña complementaria de contienda financiera: preparar otro directorio nuevo,
`node scripts/phase5e/prepare-android.cjs C:/sf-5e-contender-20261024 --financial-contender`,
compilar y ejecutar `run-android.ps1 -Harness C:/sf-5e-contender-20261024 -Campaign
phase5d-matrix -Output docs/atomicidad-fase5e/android/api24/contender-payment`.
Reemplaza exclusivamente el contendiente de lectura del harness 5D por el caso de
uso real de pago de $1 COP. Usa otro APK atestado con las mismas fuentes de
producción; el banco primario y su APK quedan conservados en su directorio original.

El runner verifica APK release, hashes embebidos, fuentes vigentes, UID distinto,
base y paquete antes de ejecutar. El único paquete es
`com.smartfin.snapshot5b2.tests`; la base es `phase5b2_synthetic.db`. El proveedor
SAF sintético pertenece a ese UID. No abre la base de `com.smartfin`.

El fixture común está en `integration.ts` y se ejecuta desde Jest y Hermes. Incluye
auditoría inicial sembrada explícitamente; no presume que los comandos manuales
agreguen filas a account_balance_history. Las campañas pequeñas comparan filas y
columnas completas; las grandes conservan inventario, columnas y hashes por tabla
calculados en streaming nativo para no convertir la transferencia del informe en
una medición del dashboard. Los tiempos son muestras funcionales instrumentadas.

Las copias Kotlin incluyen los módulos reales. Solo cambian nombre de base,
aislamiento, hooks de fallo y evidencia. Se reaplican los hooks de limpieza sobre
el objeto 5C actual: el preparador 5D lo copiaba después de los hooks originales.
No se altera driver, esquema, dependencias ni política de entrega incierta.
La barrera de mantenimiento del banco se retira en campañas WorkManager/reboot;
una llamada manual no se presenta como recuperación automática del sistema.

Para HONOR usar siempre `-Serial AXCC6R3919012932`, salidas `android/api35/` y
`run-regressions.ps1 -Serial AXCC6R3919012932 -Api 35`. Los APK x86 anteriores y
sus huellas se conservan en `apk-api24-attested/` de cada copia antes de compilar
con `'-PreactNativeArchitectures=arm64-v8a,x86_64'`. Los hashes de fuentes originales
de ambas campañas deben coincidir. Consolidar HONOR con `summarize-honor.cjs`;
`summary.json` conserva el inventario API 24 y `summary-integrated.json` reúne
ambos inventarios. Calidad de reapertura/cierre: `honor-baseline`/`honor-closure`.

El reboot HONOR fue autorizado expresamente y sus observaciones anteriores a
abrir el harness están en `honor-boot-after.json` y `honor-boot-prelaunch-second.json`.
La primera verificación sufrió el crash real 5E-002; se conserva sin resultado
aprobado en `reboot-verify`. La recuperación explícita posterior está en
`reboot-verify-final2`, con `automaticAlarm=false`. El consolidado usa esa carpeta
y conserva el intento excluido; no vuelve a ejecutar finanzas.

Para la reproducción determinista adicional: `node scripts/phase5e/prepare-contention.cjs
C:/sf-5e-race-20261024`, compilar con las dos ABI y ejecutar el runner con ese
`-Harness`, `-Campaign phase5d-contention -PreserveData -Serial AXCC6R3919012932`
y salida `android/api35/recovery-contention`. Usa reflexión sobre el mutex real y
el receptor real; el manejador temporal de excepciones solo permite guardar la
excepción esperada. No representa un parche ni recepción BOOT automática.
Calidad final posterior: `node scripts/phase5e/quality.cjs honor-final`.

Los intentos sin informe final o con expectativas incorrectas se conservan y se
excluyen del consolidado. El informe nunca debe serializar un handle administrado:
solo snapshot y tiempos. El rechazo de toJSON se reproduce en Jest.
