# Fase 5B.1: coordinación nativa y snapshot privado

Fecha: 18 de octubre de 2026, America/Bogota. Implementa coordinación de un solo
proceso y captura SQLite local. No certifica publicación externa. Las campañas
aceptadas y sus límites se detallan abajo; un intento exploratorio no se cuenta
como aprobación.

## Alcance y línea base

Se conserva el árbol sucio previo (3B/4/5A), registrado en
`atomicidad-fase5b1/git-initial.txt`. HEAD inicial:
`eeb15e6cce008d64deb558c6fe9c12770ad48920`. Node v24.16.0,
react-native 0.85.3, react-native-sqlite-storage instalado 6.0.1 con su parche
previo de recuperación. Android minSdk 24, compile/target 36, Kotlin 2.1.20.
Sin migraciones, dependencias, cambios al driver, restauración o publicación nueva.

Se revisaron AGENTS, arquitectura, base de datos, módulos, suscripciones, fases
1/1.1/2/3A/3B/4 y diseño 5A, incluidas R1–R12. R1/R9 muestran conexiones Kotlin
fuera de la cola JS; R3/R12 exigen comprobar checkpoint; R10 exige conservar
comprobantes completos; R4/R6–R8/R11 conservan sus límites externos/unknown.

## Matriz previa a implementación

| Ruta | Adquisición | Liberación y espera |
|---|---|---|
| Dueño JS normal o ciclo de vida | Cola JS → token nativo exclusivo → SQLite | Finalización SQLite → nativo → JS |
| Kotlin llamado dentro de dueño JS | Participante del token explícito, con generación/dueño verificados | Tras conexión y efecto OS; no readquiere exclusión |
| Receptor Kotlin independiente | Participante nativo → transacción propia | Fin SQL/cierre/efecto → participante; no espera JS |
| Snapshot | Dueño JS/nativo → drenaje → checkpoint → cierre confirmado → copia privada/validación → reapertura verificada | Barrera retenida hasta recuperar; cierre incierto conserva cuarentena |
| Worker/recovery | Encolar/iniciar Headless sin permiso retenido | Nunca espera callback JS con permiso nativo |
| Host destruido | Revocar propietario y rechazar nuevas adquisiciones | Cuarentena hasta reinicio del proceso; no fingir cierre del driver |

La serialización nativa amplía la exclusión de los dueños JS; no mueve reglas
financieras a Kotlin. El timeout solo limita una adquisición pendiente. Un token
con trabajo iniciado no caduca por tiempo. Las conexiones Kotlin transitorias
se cierran antes de liberar participantes. No se introduce mutex ligado al hilo.

## Efectos financieros esperados

| Operación | Saldo/deuda/ingreso/gasto/patrimonio | Derivados y comprobantes |
|---|---|---|
| Capturar/validar/limpiar temporal propio | Delta cero | Copia de todas las tablas; ningún recibo creado o eliminado en origen |
| Esperar barrera/cerrar/reabrir | Delta cero | No repetir comandos ni convertir unknown en rollback |
| Recordatorios/receptor | Conservar reglas anteriores | Misma política de entrega y SQL; únicamente participación y FK por conexión |
| Respaldos SAF existentes | Contrato previo conservado | Publicación sigue sin certificación; captura nueva no se conecta a sobrescritura |

## Fuentes primarias

- [SQLite: wal_checkpoint](https://www.sqlite.org/pragma.html#pragma_wal_checkpoint).
- [Android: SQLiteDatabase](https://developer.android.com/reference/android/database/sqlite/SQLiteDatabase).

## Implementación y archivos de producción

| Archivos | Cambio exclusivo de 5B.1 |
|---|---|
| `src/database/databaseCoordination.ts`, `nativeDatabaseLifecycle.ts` | Cola JS → dueño nativo exclusivo; token privado asociado al permiso JS, préstamo explícito y liberación inversa. Respuesta de adquisición inválida conserva cuarentena |
| `src/database/sqliteDatabase.ts` | Revalida el dueño nativo antes de abrir/reabrir, también durante recuperación bajo permiso prestado |
| `src/database/managedSQLite.ts`, `sqliteLifecycle.ts` | Un cierre fallido o timeout de recibo deja además la barrera nativa en cuarentena; conserva el protocolo de 1.1 |
| `settings/services/localDatabaseSnapshot.ts` | Entrada local, inspección estricta de checkpoint, metadatos, cierre, captura, recuperación y tiempos separados; error conserva causa de captura y causa de recuperación |
| `SmartFinDatabaseCoordinator.kt` | Dueño/host, generación, revocación, participantes, cola de adquisición y drenaje. Solo las adquisiciones tienen plazo; no caduca trabajo activo |
| `SmartFinDatabaseLifecycleModule.kt`, `SmartFinNativePackage.kt` | Puente asíncrono sobre executor propio; registra el servicio y pone cuarentena al invalidar el host |
| `SmartFinLocalSnapshot.kt` | UUID/carpeta nueva privada, archivo exclusivo, copia/sync/hash y verificación READONLY. Limpieza por ID propio, dejando a SQLite gestionar auxiliares |
| `SmartFinSubscriptionRemindersModule.kt` | Executor propio, participación hasta terminar efectos protegidos y cierre de la fábrica; FK configurada/verificada por conexión |
| `SmartFinDriveBackupModule.kt` | Participación en su ruta heredada y FK de su conexión RO. No recibe snapshots nuevos ni cambia documentos/manifiesto/retención |
| `androidSubscriptionReminderService.ts`, `subscriptionRuntime.ts`, `executeAiCommandPlan.ts` | Transporte explícito del permiso al servicio de plataforma, incluido mantenimiento/IA; sin reglas financieras nuevas |
| `androidDriveBackupService.ts`, `deleteFinancialData.ts`, `AppNavigator.tsx` | Únicamente transporte del token a llamadores existentes. El borrado conserva exactamente su orden previo de cancelación y DELETE; no implementa 5C |

Son 12 archivos TypeScript y seis Kotlin de producción. El receptor y Worker de
producción no cambian: el primero ya pasa por la fábrica ahora protegida; el
segundo no abre SQLite y sigue esperando a Headless sin permiso retenido. Se añade
una suite Jest y el harness/informes reproducibles bajo `scripts/phase5b1/` y
`docs/atomicidad-fase5b1/`. No se alteran historial paginado, dashboard, consultas
financieras, esquema, migraciones, dependencias o driver.

### Participación de conexiones Kotlin

La búsqueda de `openDatabase/openOrCreateDatabase` en producción deja las fábricas
de recordatorios y Drive, y las dos aperturas RO del capturador nuevo. Todas están
dentro de participantes nativos. La fábrica de recordatorios comprueba el permiso
antes de abrir y cierra en `finally`; `schedule/cancel/cancelAll` conservan además
su participación exterior hasta finalizar AlarmManager/NotificationManager y
encolar cancelaciones de WorkManager. Esas cancelaciones conservan sus límites
anteriores: encolarlas no acredita terminación de todo trabajo Android.

El receptor adquiere participación independiente antes de su transacción y la
libera después del efecto, `endTransaction` y cierre. No se cambia que publica
antes de su commit, ni se promete reversión de una notificación. El Worker y
recovery solo encolan/inician trabajo y no esperan JS bajo un permiso nativo.
El préstamo a llamadas desde JS evita esperar de nuevo al dueño que las invocó.

La barrera usa un monitor corto para proteger sus registros; el token exterior
no pertenece a un hilo. Los waits/IO ocurren en pools propios, no en el hilo UI
ni en el executor compartido que necesita el driver. Al liberar se revoca el token
para nuevas participaciones y se espera a las existentes sin timeout. Invalidar
ReactHost conserva cuarentena estática: reiniciar solo JS no habilita la base.
La recuperación verificable es reiniciar el proceso, sin reintento financiero.

## Protocolo local y garantías de archivo

1. El servicio obtiene permiso JS y luego dueño nativo; esto drena los accesos
   Kotlin anteriores y excluye nuevos participantes independientes.
2. Verifica journal. Solo admite WAL/DELETE/TRUNCATE/PERSIST. En WAL exige una fila
   de `wal_checkpoint(TRUNCATE)` con `busy=0, log=0, checkpointed=0`. Busy,
   filas ausentes, negativos, NaN o estado incierto rechazan antes de cerrar/copiar.
3. Comprueba FK ON, FK/integridad, esquema completo de sqlite_master, conteos de
   todas las tablas, revisión y versiones. No filtra tablas según los CSV o la UI.
4. Cierra el driver con recibo de 1.1; un fallo no inicia copia ni reapertura
   automática bajo un dueño revocado. Conserva los estados financieros unknown.
5. Kotlin abre el origen solo RO, con FK explícita, comprueba sus metadatos y cierra
   antes de copiar. PERSIST/TRUNCATE pueden observarse como DELETE en esa conexión;
   WAL debe seguir siendo WAL. No se cambia journal/synchronous del origen.
6. Crea `noBackupFilesDir/smartfin-local-snapshots/<UUID>/snapshot.db` en carpeta
   nueva. Copia todo el main tras checkpoint/cierre y sincroniza su descriptor.
   Reabre la copia RO y exige FK/integridad, esquema/conteos/revisión/versiones
   iguales. Compara SHA-256 de los bytes leídos del origen y del destino.
7. Revalida el dueño, reabre/verifica el singleton mediante 1.1 y solo entonces
   libera permisos. Devuelve el handle nuevo al componente autorizado. Ante fallo
   de captura con recuperación correcta, el error incluye ese handle recuperado;
   ante recuperación fallida no entrega conexión utilizable.

El SHA-256 verifica la copia local de ese trabajo; no introduce manifiesto externo
ni convierte la revisión financiera en identidad de archivo. El staging no tiene
un descubridor/promotor de respaldos al reiniciar. Un archivo retenido por caída
permanece privado e inactivo; retención/recuperación de jobs se decidirá en 5B.2.
`discardLocalDatabaseSnapshot(id)` solo limpia ese UUID propio. Si la lectura WAL
deja auxiliares, SQLite se abre/cierra sobre **la copia privada** para terminarlos;
no se desvinculan manualmente WAL/journal/SHM del origen. No hay purga amplia.

No se cambia el botón de respaldo ni se conecta esta captura al publicador que
sobrescribe nombres SAF. Su exportación heredada ahora participa en la barrera,
pero siguen ausentes generaciones, comprobación del destino y protección de la
última copia externa válida. El estado heredado «al día» no equivale a respaldo
externo certificado. Tampoco se implementan borrado financiero, restauración,
outbox ni nueva política de notificaciones.

## Matriz de fallos e incertidumbre

| Escenario | Resultado y evidencia |
|---|---|
| JS con transacción activa; Kotlin solicita acceso | Kotlin espera fuera de UI; lee después del commit, sin observar saldo provisional |
| Receptor real activo; captura solicitada | El dueño nativo espera cierre/fin de la transacción; captura contiene el estado confirmado |
| Native task activa y adquisición vencida | Solo falla el solicitante; el participante activo conserva la exclusión hasta terminar |
| Checkpoint con excepción | Rechazo anterior a cierre/copia; conexión original sigue disponible |
| WAL con conexión independiente bloqueante | SQLite devuelve checkpoint incompleto; rechazo sin copia. Node usa lector real; Android usa escritor WAL real, deliberadamente ajeno a la barrera solo en el test |
| Antes/durante/después de copia | Fallo inyectado, temporal sin promoción y recuperación de la conexión verificada; origen monetario intacto |
| Cierre real, respuesta perdida | Timeout real de recibo, no se copia; cuarentena del handle y barrera, sin reapertura automática |
| Apertura real, respuesta perdida | El callback nativo realmente ocurre pero se oculta en la copia de prueba; timeout/cuarentena, ningún handle provisional aceptado |
| COMMIT real, respuesta perdida | El runner conserva unknown. El snapshot puede incluir el commit y el comprobante; eso no convierte el resultado original en rollback |
| Host revocado/destruido durante copia | Trabajo nativo termina con recursos protegidos; no retorna snapshot válido ni reabre bajo token revocado. Nuevo dueño rechazado hasta reinicio de proceso |
| Proceso reiniciado antes de limpiar temporal validado | Archivo privado y recibo conservados; lectura/verificación explícita del fixture, sin publicar o repetir finanzas, y limpieza posterior por su ID |
| Snapshot con/sin comprobante IA | Copias independientes antes/después del commit; la anterior continúa sin recibo y con su saldo anterior |

En API 24, WAL sin escritura que abra efectivamente su log llegó a devolver
`0,-1,-1`. Se conservó el rechazo; no se normalizó a éxito. La campaña WAL válida
crea primero una escritura sintética y verifica `0,0,0`. La prueba inicial de lector
Android mediante SQL BEGIN se descartó porque el framework lo tradujo a BEGIN
EXCLUSIVE en API 24. Se sustituyó **solo ese fixture** por un escritor WAL real;
no se modificó el driver ni se atribuyó esa adaptación a producción.

## Verificación reproducible y límites de medición

La línea base fue **591 pruebas / 51 suites / 8 snapshots aprobados**, con tres
benchmarks omitidos. La regresión final es **605 pruebas / 52 suites / 8 snapshots
aprobados**, con los mismos tres omitidos. TypeScript estricto, ESLint y diff-check
terminaron en 0. Se preservaron los informes históricos regenerados por Jest.
[Resultados de calidad](atomicidad-fase5b1/final/quality-results.json) y
[Jest completo](atomicidad-fase5b1/final/jest.log).

Se conservan las matrices de manuales/transferencias, tarjetas/pagos, IA/comprobantes,
Suscripciones, compartidos/devoluciones/condonaciones, rechazo de $0,40 COP,
recuperación 1.1, dashboard y paginación. La suite nueva añade dos conexiones reales
al mismo archivo sintético, checkpoint busy, journals, copia fallida, respuestas
perdidas, revocación y preservación de unknown. Su bridge Kotlin es un sustituto
explícito; solo las campañas Android acreditan los módulos nativos.

El harness release/Hermes tiene paquete `com.smartfin.snapshot5b1.tests`, UID propio,
archivo `phase5b1_synthetic.db` y atestación de fuentes embebida en el APK. El runner
rechaza paquete/UID/ruta o fuentes incorrectos y compara el driver copiado con el
instalado. Registra SHA-256 del APK, archivos sintéticos y snapshots, SQLite/journal/
FK por conexión y trazas de permisos/hilos. No abre archivos del paquete real.
Los metadatos de `com.smartfin` se comparan antes/después; en API 24 no está instalado.

Los fixtures contienen cuotas con progreso, extracto/perfil, gasto compartido,
participación/condonación, comprobante, contrato/ocurrencia/recordatorio, historial
de saldos y ajustes, además de los volúmenes de movimientos. Se comprueban todas
las tablas/FK/integridad y los bytes, no solo el dashboard. El receptor, AlarmManager,
NotificationManager, Worker y Headless son reales; no son los dobles de fase 4.
Los fallos de IO y respuestas perdidas siguen siendo inyecciones declaradas.

Las mediciones son una muestra sintética instrumentada por tamaño/dispositivo,
sin SAF/Drive, percentiles o promesa de latencia. La copia del harness conserva
el buffer por defecto; las trazas añaden consultas/observación. Se separan permiso,
checkpoint cuando aplica, verificación fuente, cierre/reapertura, copia, validación/
hash y esperas de lector/operación financiera. Reapertura incluye verificaciones
de 1.1. Los tres tamaños usan los journals rollback observados en producción;
el caso WAL tiene su muestra separada de checkpoint. No se abrevia la barrera
para mejorar tiempos. La latencia observada debe considerarse antes de conectar UI.

No se certifican apagado eléctrico, disco lleno real, todos los OEM, conexiones
ajenas al inventario, otro proceso ni la publicación externa. No hay mejora FPS,
TTI o render declarada ni cambios de memoización/UI. Los informes antiguos 1–4 y
5A son históricos: sus exclusiones de Kotlin se sustituyen solo en las rutas aquí
inventariadas; sus otros límites permanecen.

## Estado de aceptación y rendimiento registrado

El [resumen verificable](atomicidad-fase5b1/validation-summary.json) incluye un
campo `complete` y la lista explícita `pending`; el generador normal rechaza
evidencia faltante. `--partial` permite registrar pendientes sin declararlos
aprobados. Solo cuenta archivos finales con resultado aprobado y comprobación de
metadatos del producto sin cambios.

| Campaña | Emulador API 24 | HONOR CRT-NX3 API 35 |
|---|---:|---:|
| Principal, concurrencia/IO/journals/Worker/volúmenes | 24 aprobados | 24 aprobados |
| Reinicio antes de limpiar snapshot | 1 aprobado | 1 aprobado |
| Cierre real con respuesta perdida | 1 aprobado | 1 aprobado |
| Apertura real con respuesta perdida | 1 aprobado | 1 aprobado |
| Revocación determinista durante copia | 1 aprobado | 1 aprobado |
| Destrucción real de ReactHost durante copia | 1 aprobado | 1 aprobado |

**58 controles aprobados en 12 campañas finalizadas: 29 por dispositivo.** El resumen
se generó sin `--partial`, con `complete: true` y `pending: []`; verificó además
que las fuentes protegidas conservan sus hashes de la regresión final.
Las seis campañas completas de cada dispositivo están en
`atomicidad-fase5b1/android/api24/` y `atomicidad-fase5b1/android/api35/`.

Un intento anterior de `restart-verify` venció con el HONOR bloqueado y su actividad
pausada. Tras el desbloqueo confirmado por el usuario, las cinco campañas de
recuperación se ejecutaron de nuevo y aprobaron. El timeout anterior no se cuenta
como resultado SQL ni como aprobación. Durante esta reanudación se mantuvo el
teléfono despierto por USB (`stay_on_while_plugged_in`: 0 → 15 → 0); el ajuste
original quedó restaurado y el paquete sintético detenido, como registra
[la evidencia de cierre](atomicidad-fase5b1/android/api35/resumed-session.json).
Los metadatos comparados del producto permanecieron iguales en las 12 campañas.
No quedan campañas ejecutándose; el emulador iniciado para esta validación quedó
cerrado.

Se midieron SQLite **3.9.2/PERSIST** en API 24 y **3.44.5/TRUNCATE** en API 35,
con FK=1 por conexión comprobada. Los escenarios adicionales verificaron DELETE,
TRUNCATE, PERSIST y WAL con copia completa, así como rechazo de checkpoint busy.
El APK compartido tiene SHA-256
`952a93014a5a4a82e50da4fb85aa370b7c1fd1a511f9bfc78a5ef3ab8048236c`.
Los UIDs sintéticos son 10079 y 10296; el UID del producto HONOR es 10284.
Las rutas main comprobadas pertenecen exclusivamente al paquete de pruebas.

| Movimientos | API 24 captura total | HONOR API 35 captura total | Lector API 24 / API 35 | Operación financiera API 24 / API 35 |
|---:|---:|---:|---:|---:|
| 1.000 | 199,33 ms | 1.096,22 ms | 205,43 / 1.106,94 ms | 212,01 / 1.117,37 ms |
| 10.000 | 301,99 ms | 1.278,60 ms | 304,63 / 1.291,52 ms | 310,28 / 1.306,09 ms |
| 100.000 | 1.677,69 ms | 16.820,74 ms | 1.681,88 / 16.835,76 ms | 1.689,73 / 16.849,96 ms |

[Desglose por permisos, cierre/reapertura, copia e integridad](atomicidad-fase5b1/performance.md).
El JSON conserva los valores completos y el coste del caso WAL aparte en su
reporte principal. `n/a` de checkpoint en la tabla de rendimiento corresponde a
journal rollback, no a una medición omitida de un checkpoint ejecutado. El total
incluye adquisición/liberación; la duración de lectores/finanzas llega hasta su
finalización real. El HONOR presentó una espera de 16,85 s: no se afirma ausencia
de pausas largas, mejora frente al publicador anterior o presupuesto UX aprobado.
No se controló la gestión térmica/energética ni se obtuvieron percentiles.

## Reversión y decisión sobre 5B.2

Se entrega [patch de reversión de código](atomicidad-fase5b1/revert-phase5b1.patch),
**preparado y comprobado con `git apply --check`, no aplicado**. Sus 18 archivos
restauran los bytes de la línea base, incluidos los cambios previos 3B/4 en los dos
archivos compartidos. Cada fuente anterior se verificó contra su SHA-256 inicial;
no usa un reset global del árbol. [Inventario/hashes](atomicidad-fase5b1/code-rollback.json).
Debe revertirse el conjunto TS/Kotlin tras detener el proceso, conservando la
recuperación de 1.1. No ejecuta SQL, migraciones, borrados de datos o limpieza de
snapshots; los temporales privados quedan disponibles para revisión posterior.

La implementación local está lista para revisión y las pruebas completadas
acreditan exclusión, bytes e integridad en sus escenarios. **Recomiendo aceptar
5B.1 dentro del alcance local y de un solo proceso probado, y autorizar 5B.2 como
entrega separada.** La evidencia completa incluye las cinco campañas de recuperación
HONOR y conserva la regresión financiera sin cambios de fuentes posteriores.
5B.2 debe abordar generaciones verificables, protección de la copia externa
válida, manejo de resultados externos inciertos y propagación del handle recuperado
a la composición de UI. Antes de activar esa ruta deben acordarse los tiempos de
espera/progreso para bases grandes, dada la espera observada de 16,85 s en el HONOR.
No se implementó ninguna de esas capacidades ni se certifica el publicador externo
actual; esta recomendación no inicia automáticamente la siguiente fase.
