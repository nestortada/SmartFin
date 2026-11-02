# Validación Android autorizada y sintética

Esta referencia prepara una campaña; no la autoriza. Hace falta una solicitud vigente que cubra dispositivo, paquete, instalación/limpieza y campaña. No vuelvas a pedir autorización ya otorgada para ese alcance. Si falta, completa plan, inventario local, revisión de runner/APK y salida propuesta antes de solicitar el dato/permiso necesario. No ejecutes comandos ADB de escritura como simple preflight.

## Riesgos observados en este repositorio

- `android/app/build.gradle` declara `applicationId "com.smartfin"`; es producción. `android/build.gradle` fija mínimo API 24. `connectedAndroidTest` no es una campaña sintética aislada por su nombre.
- `android/app/src/androidTest/java/com/smartfin/SubscriptionInterfaceTest.kt` abre `targetContext.getDatabasePath("smartfin.db")` con escritura y usa SQL de inserción/borrado. Prefijos de fixture NO aíslan UID, paquete o base. No ejecutar sobre la instalación habitual.
- `SubscriptionReminderTest.kt` usa un contexto que sustituye la ruta por archivo de prueba, pero programa/cancela recursos de plataforma: revisar identidad y efectos nativos igualmente.
- `scripts/phase6b2/run-android.ps1` es una referencia de controles (hashes, APK, UID, metadatos, mutex), no una receta segura por defecto. Sus valores por defecto incluyen serial, workspace externo, salida en `docs/`, instalación, `pm clear`, permisos, force-stop y acciones de pantalla. No invocarlo sin revisar alcance y salida nueva.
- `scripts/phase6b3/prepare-android.cjs`, `run-android.ps1` y otros preparadores bajo `scripts/` pueden crear/modificar árboles externos y APK. No son tests Jest ni verificaciones de solo lectura.

## Lista de verificación antes de la primera escritura

1. Identifica la campaña y sus efectos exactos: preparar, compilar, instalar, sembrar, arrancar, matar/reiniciar, cambiar permisos o limpiar. Define timeout, criterio de parada y carpeta de evidencia nueva. Comprueba que cada mutación está dentro de la autorización vigente y permitida por el guard.
2. Identifica dispositivo mediante serial MÁS estado ADB, nombre de AVD cuando aplique, fabricante/modelo, fingerprint/build, API/versión Android y evidencia de entorno dedicado sintético. Un serial `emulator-*` solo no prueba identidad ni ausencia de datos personales. Ante ambigüedad, detente.
3. Verifica paquete sintético exacto y permitido por la política actual; no basta que empiece por `com.smartfin`. La política Codex auditada enumera `com.smartfin.snapshot5b2.tests` con `phase5b2_synthetic.db`; confirma estos valores en la campaña vigente, no los impongas a todas las campañas históricas.
4. Audita APK local con herramientas instaladas: applicationId, versión, firma/hash SHA-256 y build. Contrasta manifiesto de atestación de fuentes originales/preparadas y asset embebido con archivos actuales byte por byte. `scripts/phase6b2/check-attested.cjs` ayuda a diagnosticar discrepancias; su comparación LF no autoriza aceptar un hash diferente ni ejecutar un normalizador. No reutilices APK obsoleta.
5. Comprueba paquete instalado/ruta y UID del sintético y UID de producción mediante metadatos; exige diferencia y ausencia de shared UID. No abras la base de producción para verificar aislamiento. Registrar metadatos no demuestra por sí solo que toda la app permanezca intacta.
6. Sigue la configuración de apertura hasta el nombre y ruta privada de la base sintética; exige que pertenezca al UID/paquete de prueba y que no monte/importa/copia bases reales, respaldos o exportaciones del usuario. Si no puede probarse, no ejecutes.
7. Registra versiones RN, driver/parches, ABI, SQLite nativo, API, modelo, APK y fuentes. Reserva el dispositivo mediante el mecanismo del runner; comprueba que no hay otra campaña usando el mismo paquete/UID.

Consultas ADB de lectura que pueden servir, siempre con serial explícito y revisión del guard: `adb devices -l`, `adb -s SERIAL shell getprop ro.build.fingerprint`, `adb -s SERIAL shell getprop ro.build.version.sdk`, `adb -s SERIAL shell dumpsys package PAQUETE`, `adb -s SERIAL shell pm path PAQUETE`. Son ejemplos con marcadores, no comandos listos para ejecutar ni autorización de acceso a datos.

## Ejecutar solo después de acreditar lo anterior

- Instala únicamente el APK sintético verificado. Si no coincide con la atestación, detén y prepara un nuevo candidato autorizado. No cambies políticas ni hooks para permitirlo.
- Si la campaña autoriza reset o desinstalación, vuelve a comprobar paquete/UID/ruta justo antes y conserva evidencia primero. Nunca `pm clear`, desinstalación o escritura SQL sobre `com.smartfin`. No infieras permiso de reset por permiso de lectura o por un `allow` del guard.
- Ejecuta escenarios seleccionados de driver real: apertura/FK, commit/rollback, recibo perdido antes/después, close/reopen, proceso muerto, respuesta tardía, ciclo de vida y recuperación idempotente. Diferencia matar proceso, force-stop y reinicio: no son equivalentes para alarmas/receivers.
- Mantén entradas, fechas, semilla, fuentes y oráculos equivalentes a Node. Contrasta estado financiero/tablas/recibos y resultados, no solo duración. Diferencias por SQLite, `Intl`/ICU, Unicode o formato COP deben quedar identificadas; no cambies expectativas silenciosamente.
- Valida API 24 y otras versiones pertinentes solo si están disponibles y autorizadas. Una API o un emulador no acredita la matriz completa de Android.
- Recolecta logs, trazas, resultados, manifiesto, hashes y capturas sintéticas en salida nueva. Separa evidencia histórica reutilizada de una campaña nueva. Detén ante identidad ambigua, timeout, fuentes divergentes o salida que pise evidencia anterior.
- Limpia solo temporales/paquetes de prueba expresamente incluidos; si falta permiso o el guard lo rechaza, conserva y reporta recursos pendientes. No borres evidencias para lograr un árbol limpio.

## Qué se puede concluir sin campaña

`__tests__/sqliteAndroidRecoveryPatch.test.ts` verifica estáticamente el parche instalado; `sqliteRecoveryLifecycle.test.ts` prueba el contrato en Node. Ninguna valida el driver ejecutándose en Android. La presencia de Kotlin/harnesses o JSON históricos tampoco acredita ejecución nueva. Usa «pendiente de evidencia Android» para las afirmaciones nativas aún no ensayadas.
