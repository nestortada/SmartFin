# Atomicidad financiera: fase 1.1 correctiva

Fecha: 11 de octubre de 2026. **Los 14 casos originales pasan en Android API 24 y HONOR API 35**, junto con tres controles nuevos de recuperación fallida por entorno. Se repitió la matriz con el APK final y el resultado fue consistente. Recomiendo cerrar técnicamente la recuperación de fase 1 y someter fase 2 a autorización explícita. No se implementó fase 2.

## Diagnóstico y autorización

Se aplicó la [skill financiera](../.agents/skills/smartfin-financial-domain/SKILL.md) y se revisaron AGENTS, diseño aprobado, arquitectura/base de datos, informes de fases 0/1/API 24, los cuatro adaptadores SQLite, consumidores financieros y la implementación instalada de `react-native-sqlite-storage` 6.0.1. Se reprodujeron los tres bloqueos con el APK anterior antes de modificar producción. La línea base Node aprobó 257 pruebas y ocho snapshots; TypeScript/ESLint devolvieron 0.

El [diagnóstico previo](atomicidad-fase11/diagnostico-previo.md) y el [fragmento propuesto](atomicidad-fase11/propuesta-parche-driver.diff) se entregaron antes de implementar el parche. El usuario autorizó expresamente **«Autorizar parche y completar validación»**. No fue necesario cambiar contratos públicos, versiones ni dependencias.

La causa comprobada consta de dos fallos relacionados:

1. El driver ejecuta BEGIN mediante `SQLiteDatabase.beginTransaction()` en DBRunner. El cierre anterior llamaba `close()` sin terminar la sesión de ese hilo. Android cierra el objeto/pool, pero la sesión conserva una conexión adquirida. Logcat API 24 registra **una conexión todavía en uso** y después `SQLiteDatabaseLockedException` al compilar `PRAGMA journal_mode` durante la siguiente apertura. DBRunner termina por ese error. Véanse [traza BEGIN anterior](atomicidad-fase11/before-api24-begin-after/logcat.txt) y [reproducción sin coordinador](atomicidad-fase11/raw-driver-api24/logcat.txt).
2. `sqlite.js` resuelve la promesa `openDatabase` con el objeto provisional de la fábrica, antes del callback nativo. La primera consulta encolada no recibe error cuando esa apertura falla: `executeSql` crea una transacción JS sin callback general de error y `abortFromQ` solo notifica ese callback. La espera observada en `PRAGMA foreign_keys=ON` era una consulta que nunca llegó a ejecutarse; la reapertura anterior tampoco estaba confirmada.

La reproducción directa con el driver excluye al coordinador/runner de SmartFin como causa necesaria. El experimento SQLite Android independiente reproduce el bloqueo en ambas API al cerrar sin terminar sesión; termina la sesión en el mismo hilo y demuestra una nueva consulta utilizable. Las pilas capturadas después del timeout están vacías porque el worker fallido ya terminó; Logcat conserva la pila de la excepción de apertura.

El comportamiento de sesión/pool coincide con [SQLiteSession de Android 7](https://android.googlesource.com/platform/frameworks/base/+/android-7.0.0_r1/core/java/android/database/sqlite/SQLiteSession.java) y [SQLiteConnectionPool](https://android.googlesource.com/platform/frameworks/base/+/android-7.0.0_r1/core/java/android/database/sqlite/SQLiteConnectionPool.java). Las copias consultadas están en `atomicidad-fase11/baseline/`.

## Solución y límites de seguridad

El parche autorizado termina las sesiones activas de **`this.mydb`, en su propio hilo DBRunner**, antes de cerrar y emitir el callback de éxito. Conserva el manejo de errores del driver: si `endTransaction` o cierre falla, propaga error. No recorre otras bases, no ejecuta SQL ROLLBACK sobre conexiones ajenas ni modifica Kotlin de producción. El postinstall existente aplica el fragmento de forma idempotente y rechaza versiones/fragments no revisados.

SmartFin espera ahora el callback real de apertura; la resolución provisional solo se consume para recoger posibles rechazos. Apertura, cierre y verificación tienen recibos acotados a 10 segundos. Un timeout es un error: jamás entrega un handle supuestamente recuperado. La inicialización verifica FK habilitadas, `foreign_key_check`, `integrity_check` y una revisión financiera entera válida antes de entregar la conexión. Esta verificación incluye un límite conservador para la inicialización existente; no cambia su DDL o migraciones.

El cierre falla de forma persistente para esa generación: permanece en cuarentena, sin segundo cierre automático ni nuevas consultas. Una apertura o verificación fallida bloquea siguientes aperturas del runtime. Una respuesta tardía no revierte esa decisión. Se necesita reinicio y revisión explícita; no se añadió un desbloqueo automático ni reparación financiera.

El runner conserva `confirmed`, `rolledBack` y `unknown`. **Recuperar una conexión utilizable no confirma ni revierte el resultado del comando anterior.** Una sesión ya marcada con `setTransactionSuccessful()` puede confirmar al terminarla: el experimento nativo persiste 900.000 frente a 1.000.000 al terminar una sesión no marcada. El comando incierto sigue siendo `unknown`; no se ejecuta de nuevo su cuerpo ni se añaden compensaciones.

## Archivos de esta corrección

| Archivo | Cambio |
|---|---|
| `src/database/sqliteLifecycle.ts` | Nuevo recibo nativo de apertura y límite de espera con error |
| `src/database/managedSQLite.ts` | Cierre acotado y fallo persistente de recuperación/cuarentena |
| `src/database/sqliteDatabase.ts` | Apertura confirmada, validación de integridad/revisión y bloqueo persistente |
| `scripts/sqliteAndroidRecoveryPatch.js` | Transformación mínima, estricta e idempotente de DBRunner |
| `scripts/patchReactNativeSqliteStorage.js` | Reproduce el parche autorizado desde el postinstall existente |
| `__tests__/sqliteRecoveryLifecycle.test.ts` | 16 pruebas de recibos, integridad inválida, fallos, cuarentena y respuestas tardías |
| `__tests__/sqliteAndroidRecoveryPatch.test.ts` | Dos pruebas de alcance/idempotencia y rechazo de layouts inválidos |
| `__tests__/sharedSQLiteCoordination.test.ts` | Mocks de apertura emiten callback nativo; mismas expectativas financieras |
| `scripts/androidAtomicityPhase1/{Harness.jsx,AtomicityPackage.kt,prepare.js,run.ps1,README.md}` | Recibos, verificación/snapshots, fallos de cierre, diagnóstico y fingerprints |
| Informes y `docs/atomicidad-fase11/` | Diagnóstico, evidencia antes/después, auditoría y resultados |

El [control por hashes](atomicidad-fase11/scope-audit.json) compara todos los archivos de `src` con la copia previa al parche: solo cambian los tres archivos de recuperación enumerados. `atomicSQLite.ts`, `databaseCoordination.ts`, IA, suscripciones, movimientos y optimizaciones conservan su contenido previo. El Java instalado equivale exactamente al fragmento aprobado; `sqlite.js` y `lib/sqlite.core.js` permanecen idénticos. No cambian esquema, migraciones, package.json/lock, minSdkVersion ni módulos Kotlin de producción. Los cambios previos del usuario se conservaron.

## Android: entorno y resultados

Se usaron únicamente bases sintéticas en la aplicación release/Hermes aislada **`com.smartfin.atomicityphase1.tests`**. Se excluyen los módulos Kotlin de producción. Cada caso usa un nombre nuevo; se reabre solo esa base. Los metadatos del paquete `com.smartfin` permanecen iguales en todas las campañas y no se leen sus bases. El APK final incluye las fuentes verificadas mediante fingerprints.

| Entorno | API 24 | API 35 |
|---|---|---|
| Equipo | AVD `SmartFin_Atomicity_API24`, Nexus 5X | HONOR CRT-NX3 físico |
| Sistema / ABI | Android 7.0, Google APIs rev. 27, x86_64, WHPX | Android 15, arm64-v8a |
| Serial de esta campaña | emulator-5556 | AXCC6R3919012932 |
| SQLite nativo | 3.9.2 | 3.44.5 |
| Journal observado | persist | truncate |
| Antes | 11/14; tres timeouts >30 s | 11/14; mismos tres timeouts |
| Después y repetición | 14/14 + 3 controles negativos | 14/14 + 3 controles negativos |

Se mantuvieron los mismos criterios funcionales. Las diferencias de journal/latencia no se atribuyen únicamente al nivel API: también cambian imagen, ABI y fabricante. No se detectaron diferencias de exclusión, callbacks, rollback o recuperación en los casos evaluados. JDK 17 y las herramientas/imagen del SDK ya disponibles se reutilizaron; no se instalaron dependencias nuevas.

| Los 14 casos originales | API 24 | API 35 |
|---|---|---|
| Callbacks reales y rollback del generador local | Pasa | Pasa |
| Fallo antes de escritura compartida | Pasa | Pasa |
| Fallo después de escritura compartida | Pasa | Pasa |
| Violación FK y rollback integral | Pasa | Pasa |
| Padre/hijo, saldo, deuda y revisión revertidos | Pasa | Pasa |
| BEGIN rechazado antes de ejecutarse | Pasa | Pasa |
| Respuesta perdida después de BEGIN | Pasa | Pasa |
| Dos operaciones, lector externo, checkpoint y ámbitos revocados | Pasa | Pasa |
| Transacción anidada rechazada y permiso prestado revocado | Pasa | Pasa |
| Fallo antes de COMMIT | Pasa | Pasa |
| Respuesta perdida después de COMMIT | Pasa | Pasa |
| Fallo antes de ROLLBACK | Pasa | Pasa |
| Respuesta perdida después de ROLLBACK | Pasa | Pasa |
| Cierre espera al dueño, reapertura y generación nueva | Pasa | Pasa |

Los tres casos que fallaban ahora completan en 984/891/840 ms (API 24: BEGIN después/COMMIT antes/ROLLBACK antes) y 742/610/593 ms (API 35), incluyendo fixture y verificaciones. La matriz final no registra CASE_TIMEOUT ni errores de apertura/bloqueo SQLite en estos casos. No son benchmarks de rendimiento.

Los tres controles adicionales por entorno inyectan fallo **antes del cierre**, **después del cierre nativo** y **pérdida del recibo de cierre**. Todos conservan resultado `unknown`, `recoveryError`, cuarentena, ámbitos revocados y un único cuerpo financiero/cierre intentado. Lectores y un segundo descarte fallan antes de llegar al driver. El último caso tarda 10.919/10.439 ms en total por el límite real de 10 segundos; aprueba porque **detecta el error y el bloqueo seguro**, no porque recupere la conexión. La limpieza directa del fixture no rehabilita el handle administrado.

Los diagnósticos `raw-driver` y `native-probe` también se ejecutaron en ambos entornos. El primero ya reabre y consulta sin coordinador. El segundo es una caracterización separada: deliberadamente demuestra el error del cierre sin finalizar sesión, y consulta correctamente tras finalizarla con/sin marca de éxito. Ese error intencional no cuenta como rollback exitoso ni sustituye ninguno de los 14 criterios.

## Estado financiero verificado

La cuenta sintética comienza con saldo **1.000.000**, revisión **1**, sin movimientos. Los snapshots incluyen todas las columnas de todas las tablas de aplicación, con orden determinista; conservan referencias, deuda y revisión. En el escenario padre/hijo se agrega tarjeta con deuda 250.000 y se interrumpe después de saldo, deuda, pago y split: todo vuelve al snapshot inicial.

| Fallo inyectado | Cuerpo | Saldo persistido / revisión tras reapertura | Resultado del comando |
|---|---|---|---|
| Antes o después de BEGIN | 0 veces | 1.000.000 / 1; snapshot completo inicial | unknown |
| Antes de COMMIT, después de actualizar a 900.000 | 1 vez | 1.000.000 / 1; snapshot completo inicial | unknown |
| Después de COMMIT ejecutado | 1 vez | 900.000 / 2; resto de tablas idéntico | unknown |
| Antes o después de ROLLBACK solicitado por error de dominio | 1 vez | 1.000.000 / 1; snapshot completo inicial | unknown |
| Antes o después de escritura, ROLLBACK con recibo | 1 vez | Snapshot completo inicial, deuda/referencias/revisión restauradas | rolledBack |
| Recuperación/cierre fallido | 1 vez | No se consulta la conexión incierta; estado no certificado | unknown + recoveryError |

Toda reapertura de las campañas verifica FK habilitadas, ausencia de violaciones FK, integrity_check=ok y revisión válida antes de consultar el saldo. El lector en espera no observa el saldo intermedio y los ámbitos/permisos expirados no envían SQL. Las trazas contienen solicitudes, no prueban por sí solas ejecución de sentencias inyectadas antes.

## Verificación general y evidencia

- Jest completo final: **275 pruebas aprobadas**, 33 suites aprobadas, ocho snapshots aprobados; tres benchmarks previamente omitidos siguen omitidos. IA, suscripciones, integridad financiera y fase 0 incluidos.
- TypeScript `npx tsc --noEmit`: código 0. ESLint `npm run lint`: código 0.
- Builds release Android: aprobados. Idempotencia del postinstall comprobada varias veces y mediante pruebas; diferencias de fuente auditadas.
- No se actualizaron snapshots ni expectativas de caracterización parcial de fase 0.

El [resumen verificable](atomicidad-fase11/validation-summary.json) contiene los 17 casos únicos por entorno, tiempos, estados, saldos/revisión y experimentos nativos. Reportes íntegros, Logcat, fingerprints y metadatos: `atomicidad-fase11/verified-api24-*` y `verified-api35-*`. Los directorios `before-*`, `diagnostic-*`, `after-*` y los logs iniciales conservan las ejecuciones anteriores; algunas campañas de diagnóstico iniciales no produjeron reporte o fallaron una expectativa experimental y **no se contabilizan como aprobadas**. Los resultados finales usan exclusivamente `verified-*`. Para reproducir, véase el [README del harness](../scripts/androidAtomicityPhase1/README.md).

## Riesgos pendientes y decisión

Node SQLite en memoria acredita invariantes, guardas y snapshots, pero no reproduce SQLiteSession, el bridge ni los callbacks del driver Android. Las comprobaciones del singleton `openSmartFinDatabase` se prueban en Jest con conexiones sintéticas; Android usa el abridor confirmado y los mismos adaptadores/runner con nombres sintéticos, sin llamar al abridor con nombre financiero de producción. Los módulos nativos de IA/recordatorios/backup no se incluyen en la app aislada: sus fachadas se verifican por Jest, no sus receptores Android de producción.

No se probaron corte de energía, almacenamiento lleno, muerte del proceso durante COMMIT, todos los fabricantes API 24 ni sesiones de conexiones Kotlin independientes. La cola solo coordina el runtime JS. El cierre por destrucción de Catalyst en otro hilo sigue fuera de este parche, que corrige la rama explícita de cierre de DBRunner. El checkpoint probado no equivale a una copia integral de respaldo. Los tres benchmarks omitidos no se activaron y no se repitieron mediciones físicas de rendimiento.

Los fallos antes/después de SQL se inyectan como rechazos deterministas, siguiendo los criterios anteriores. La pérdida silenciosa de recibo se ejercita en cierre; no se simula la desaparición silenciosa de cada callback de sentencia. El nuevo límite cubre apertura, cierre e inicialización/verificación, no toda consulta financiera arbitraria.

`unknown` exige revisión del estado antes de repetir un comando: integrity_check y FK acreditan integridad estructural, no la intención económica de una operación cuyo recibo se perdió. La verificación completa agrega lecturas y un límite conservador de 10 segundos; una base muy grande o dispositivo lento puede bloquear la inicialización de forma preventiva. Debe evaluarse con otra base sintética grande si se ajusta ese límite. Un recibo tardío puede dejar recursos nativos abiertos hasta reiniciar; no habilita una conexión incierta.

La condición técnica de recuperación de fase 1 **se cumple en estos dos entornos**: coordinación/exclusión, rollback verificable cuando hay recibo, reapertura utilizable y bloqueo seguro cuando no lo hay. Recomiendo cerrar fase 1. Antes de autorizar fase 2, revisar el parche permanente, conservar esta matriz y los criterios de fase 0, aceptar el tratamiento de `unknown` y sus límites, y obtener autorización explícita del usuario. Ningún movimiento manual pasó a una transacción compartida durante esta corrección.
