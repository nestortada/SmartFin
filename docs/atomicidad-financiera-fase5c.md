# SmartFin fase 5C: borrado y limpieza recuperable

Fecha: 24 de octubre de 2026, America/Bogota.

## Alcance y fuentes

Implementa exclusivamente el borrado financiero local, admisión de respaldos,
época local y limpieza Android recuperable. La publicación de producción sigue
deshabilitada. No modifica esquema, migraciones, driver, dependencias, reglas
contables, manifiestos v2, lectores externos, restauración ni política de entrega
incierta de notificaciones. Conserva los cambios anteriores del checkout.

Se contrastaron AGENTS, arquitectura/base, módulos/Suscripciones, fases 5A,
5B.1/5B.2, informe 5B.3 y contrato previo de 5C con todos los llamadores reales:
Ajustes → AppNavigator → caso de uso/repositorio; servicios de exportación y
recuperación v2 → publicador; mantenimiento UI/inicio/primer plano/Headless;
Worker, receptores, adaptador de recordatorios y captura privada.

Los documentos generales todavía describían seed/reseed en AppNavigator: el
código vigente ya no lo ejecuta. Esta fase no lo reincorpora. La revisión
financiera sigue midiendo mutaciones y nunca se usa como identidad de historia.

## Fallo original y línea base

La ruta anterior ejecutaba `cancelAll` antes de la transacción local con 36
DELETE. Ante un fallo SQLite, las filas, auditoría, revisión y métricas volvían
íntegras, pero la cancelación Android no se revertía. La caracterización Node
congelada está en `__tests__/financialDeletionBaseline.test.ts`, con servicios OS
simulados. Se ejecutó antes de modificar producción y se conserva su registro en
[original-reproduction.log](atomicidad-fase5c/original-reproduction.log).
La campaña Android `phase5c-matrix` reproduce ese orden con AlarmManager real:
rollback íntegro y desaparición del PendingIntent original. Después prueba la
ruta nueva con el mismo recurso sintético, sin tocar la instalación financiera.

Antes de modificar producción se ejecutaron Jest completo, TypeScript, ESLint y
diff-check. TypeScript/lint/diff-check pasaron; Jest registró el fallo intermitente
ya descrito en 5B.3 de pila/timeout en mantenimiento de Suscripciones, con 619
pruebas aprobadas. Los registros originales están bajo `atomicidad-fase5c/`.
Los intentos posteriores se conservan; no se modificaron timeouts ni el dominio
para ocultar ese fallo.

## Límite transaccional

El repositorio conserva literalmente las 36 tablas, su orden y sus DELETE sin
predicados nuevos. Adquiere/reutiliza el permiso existente y captura los IDs de
recordatorios después de drenar los participantes nativos. El generador se
ejecuta sobre el participante de `runSharedSQLiteTransaction`: un único BEGIN
IMMEDIATE, 36 DELETE, dos escrituras internas de control y un único COMMIT.
No se anidan transacciones y no se ejecutan efectos Android dentro de ella.

Las dos escrituras son el estado de ciclo de vida y el comprobante permanente
del ID. `app_settings` tiene PK textual y valores TEXT NOT NULL; es una de las
tablas preservadas. `saveSettings` solo escribe theme/biometricsEnabled/
localCredentialEnabled mediante su lista explícita. Ninguna de esas rutas
sobrescribe las claves internas. No se requiere DDL, SQLite JSON ni UPSERT
moderno; es compatible con el SQLite 3.9.2 observado en API 24. Los triggers
originales conservan revisión y consecuencias contables; no se reinicia revisión.

## Contrato durable versión 1

`__smartfin_financial_lifecycle_v1` almacena:

```json
{
  "version": 1,
  "id": "UUID del borrado",
  "epoch": "el mismo UUID, nueva identidad de historia",
  "previousEpoch": "legacy o UUID anterior",
  "phase": "cleanupPending o completed",
  "reminderIds": [],
  "workIds": [],
  "backupJobIds": [],
  "snapshotIds": []
}
```

Los arrays contienen únicamente identidades propias exactas, nunca importes,
descripciones, títulos ni contenido financiero. Al avanzar se quita cada ID
confirmado. Completed conserva arrays vacíos, ID y épocas. La clave
`__smartfin_deletion_receipt_v1:<UUID>` conserva solo versión/ID/época e impide que
el mismo ID borre una historia posterior, incluso si ya terminó su limpieza.
Se conserva un comprobante pequeño por borrado; no hay purga de comprobantes.

Antes de SQLite, `smartfin-deletion-admission-v1.json` en almacenamiento privado
sin backup reserva una admisión mediante AtomicFile, con versión e ID solamente.
Su presencia cierra nuevas publicaciones/programaciones y sobrevive al reinicio.
Es una barrera preparatoria, **no evidencia de commit financiero**. No contiene
época autoritativa, datos ni un sustituto SharedPreferences del commit SQLite.

Ausencia de intención y ausencia de marcador representan instalación sin borrado
registrado. Marcador sin intención coincidente representa unknown; no se supone
rollback ni se ejecutan DELETE. Intención coincidente cleanupPending prueba que
los DELETE y la época compartieron commit. Completed con marcador residual
permite retirar únicamente ese marcador. Un rollback confirmado permite liberar
la admisión; si se pierde esa liberación se conserva la clasificación financiera
rolledBack y se informa de coordinación pendiente.

## Admisión, respaldos y orden de permisos

Una admisión nativa común cuenta las operaciones de preparación, publicación y
consulta SAF. La publicación conserva su lease desde la lectura de época hasta
el cierre de todos los streams, manifiesto final y resultado verificado. El
borrado y esa admisión comparten un monitor breve; el monitor nunca espera SAF,
SQLite ni callbacks JS. Si hay un lease activo, el borrado se rechaza antes de
reservar una intención o abrir transacción. No se supone cancelación cooperativa
de un proveedor que no puede acreditarla. El usuario puede solicitar el borrado
otra vez cuando termine el trabajo. Un proveedor que no termina puede seguir
bloqueando la admisión; no se fuerza su liberación por timeout.

Tras cerrar la admisión, el orden existente es cola JS → dueño nativo → drenaje de
participantes → lectura de IDs → transacción. Un lote de mantenimiento que ya
poseía permiso termina antes de adquirir el permiso del borrado. Cada lote
siguiente comprueba admisión y la misma época bajo su permiso, y no puede
reconstruir derivados después del corte. Kotlin no espera Headless con el permiso
de base retenido. Finalizados SQL y COMMIT, se liberan nativo/JS antes de limpiar
WorkManager, archivos privados o alarmas.

Los jobs guardan `datasetEpoch` en su registro privado existente (ausencia antigua
= legacy). Todos los estados prepared, snapshotValidated, publicationPending,
verified, failed y uncertain pasan por la misma comprobación de época/revocación
antes de abrir snapshots o SAF. La ausencia del atributo nuevo solo es compatible
con legacy. La limpieza marca `revokedByDeletion`, conserva metadatos mínimos e
integridad histórica y retira sus directorios privados. Un intento revocado no
cambia el estado histórico a uncertain. Los nuevos trabajos requieren nuevo ID
y nueva captura; no adoptan el snapshot anterior. El lease hace que no exista
una ventana entre consultar la admisión y publicar el manifiesto final.

El servicio JS mantiene además su guardia durante toda la captura/publicación y
la recepción del resultado. El borrado la consulta antes de admitir. El dueño
visual 5B.3 evita callbacks de tareas terminadas; un contador de solicitudes
invalida estados de respaldo consultados antes/durante el borrado.

## Limpieza Android y recuperación

Solo una intención SQLite confirmada autoriza efectos de limpieza. El inventario
incluye IDs de filas de recordatorios, tags propios activos de notificaciones,
UUID concretos de las dos cadenas WorkManager, jobs y snapshots privados propios.
No se ejecuta `cancelAll` en el protocolo nuevo ni una cancelación tardía por
nombre global de WorkManager.

Por cada UUID WorkManager se solicita cancelación, se espera su Operation y se
consulta estado terminal. Además debe desaparecer del registro de ejecución real
del Worker y de su Headless asociado. Un timeout, CANCELLED o promesa rechazada no
certifica por sí solo que terminó el cuerpo. Si no se puede demostrar, queda
pendiente y se liberan los permisos. Las tareas Headless de época antigua no
pueden empezar un lote nuevo; un callback perdido conserva el bloqueo hasta
terminación observable o reinicio del proceso. El proceso reiniciado no hereda
hilos/Headless antiguos.

Se cancela cada AlarmManager/PendingIntent y notificación usando ID y época
anteriores. Legacy conserva la URI anterior para compatibilidad. Los nuevos
recursos usan una URI/tag con época; el receptor vuelve a comprobarla antes de
actuar. Un broadcast antiguo con ID/revisión reutilizados no entrega un aviso de
la historia nueva. Las nuevas solicitudes WorkManager llevan la época en inputData;
las antiguas sin campo son legacy y se descartan tras el corte.

Cada efecto idempotente confirmado se registra en una actualización transaccional
pequeña de control; no contiene DELETE financieros ni modifica revisión. Un fallo
antes de registrar progreso repite solo ese efecto sobre el ID antiguo. Los
directorios privados se resuelven por UUID bajo raíces propias, con comprobación
de ruta canónica. No se recorren URIs ni se eliminan documentos SAF. Los respaldos
externos completos, parciales y ajenos permanecen intactos.

Inicio/primer plano, mantenimiento y receptores de recuperación comprueban la
intención. Se permite continuar consultas y finanzas que no dependen de recursos;
programar/cancelar recordatorios y encolar trabajo en conflicto permanece cerrado
hasta completar limpieza. Una nueva petición de borrado mientras queda limpieza
pendiente se rechaza: no afirma que también se hayan eliminado los datos nuevos.
No existe reintento financiero automático ante unknown.

## Matriz de fallos

| Caso | Resultado y recuperación |
|---|---|
| A. Antes de escribir | Rechazo previo sin DELETE ni efecto OS; si se pierde la reserva de admisión, unknown conservador |
| B. Antes/después de cada escritura | 38 escrituras × 2; rollback de todas las tablas/columnas/revisión/auditoría/métricas; alarma original intacta |
| C. Commit y fallo antes de cancelar | confirmed + cleanupPending; intención/época ya confirmadas |
| D. Fallo parcial de efectos/progreso | Reanudar exclusivamente IDs pendientes y efectos idempotentes de la época anterior |
| E. Respuesta de COMMIT perdida | unknown, conexión descartada según runner; ninguna cancelación ni segundo DELETE por suposición |
| F. Reinicio tras commit | Recuperación de singleton/SQLite y comprobante coincidente; limpieza sin borrar finanzas otra vez |
| G. Limpieza terminada y respuesta perdida | Verificar completed y retirar marcador residual; no repetir finanzas |
| H. SAF activo | Rechazo antes de SQL; lease cubre publicación y finalización completa |
| I. Job/Worker antiguo reaparece | Época incompatible; no captura/publica ni inicia mantenimiento de la historia nueva |
| J. Suscripción/ID nuevo | Programación bloqueada mientras hay conflicto; después URI/tag/WorkRequest de época nueva protegidos de limpieza anterior |

La equivalencia exitosa compara el resultado de los DELETE anteriores congelados
con el nuevo, normalizando únicamente las dos filas nuevas de control. Rollback
no normaliza nada. Se comprueban todas las tablas/columnas, integrity_check y
foreign_key_check. Las matrices Node y Android son evidencias diferentes; Node
no acredita AlarmManager, WorkManager ni el driver Android.

## Interfaz

Se conserva una confirmación destructiva de Ajustes y el dueño único 5B.3. Los
mensajes distinguen confirmado/limpieza pendiente/completada, rollback, unknown y
rechazo por trabajo activo. La confirmación financiera se publica antes del
refresco visual. Un error de presentación no invita a repetir la operación ya
confirmada. El estado inicial de la app informa del último borrado, y la UI de
respaldos etiqueta las generaciones propias anteriores como históricas.

## Compatibilidad externa y límites de 5D

El manifiesto v2 no cambia: carece de identidad de historia y evidencia de borrado
negociada. Un lector externo sin contexto local debe usar
`datasetCurrency=unknown`; solo puede afirmar análisis histórico, aunque los
bytes sean íntegros. Una sincronización tardía del proveedor puede hacer visible
una copia histórica después del borrado. Esta fase no elimina ni revoca esos
bytes remotos y no modifica el analista semanal.

Resolver actualidad externa requiere autorización independiente: identidad/época
versionada, evidencia del corte compartida por un canal autorizado y reglas para
v1/v2 anteriores. SAF por sí solo no acredita recepción remota del contexto. La
etiqueta current de la app solo se calcula para jobs propios cuyo registro local
coincide; archivos sin esa evidencia se consideran unknown.

Persisten la política de entrega incierta de notificaciones de 5D, los límites de
un solo proceso, pérdida eléctrica/fsync/OEM no certificados, y la resolución
manual de un marcador unknown sin comprobante coincidente. No se añade una
acción de reparación que libere esa barrera suponiendo rollback. Una futura
restauración/downgrade o segundo proceso requiere su propio contrato; no queda
autorizado por esta fase. No se promete borrado físico seguro de páginas SQLite,
WAL, snapshots de SO ni copias de terceros.

## Resultados de Android, equivalencia y regresiones

Pasan **392 controles en 38 campañas**, 196 controles/19 campañas por API:
emulador Android API 24 y HONOR CRT-NX3 físico API 35. Cada campaña verifica APK,
huellas de las fuentes originales actuales, paquete/base/UID independientes y
metadatos de `com.smartfin` sin cambios. El probe comprueba que el UID sintético
no puede leer la ruta de la base real; nunca intenta abrirla. AlarmManager,
PendingIntent, receptor, WorkManager y Headless son módulos reales del APK
sintético. SAF es un proveedor sintético, no Google Drive real.

| Campañas por API | Controles | Evidencia |
|---|---:|---|
| Rollback 38 × antes/después + aislamiento/reproducción | 78 | `matrix-final/result.json` |
| Barrera 5B.1, publicación activa, seis estados durables y commit con fallo OS | 4 | `main-final/result.json` |
| Reinicio/limpieza sin segundo DELETE | 2 | `restart-final/result.json` |
| Nuevas identidades, rechazo de jobs antiguos, mantenimiento/Worker reales | 2 | `new-identities[/final]/result.json` |
| Fallos antes/después de recursos/progreso y respuesta final perdida | 11 | `cleanup-matrix/result.json` |
| COMMIT perdido antes/después y sus reinicios | 8 | `closure-lost-*`, `closure-unknown-restart`, `closure-restart` |
| Captura, reinicio, publicación/recuperación y respuestas de apertura/cierre perdidas | 57 | `closure-core` a `closure-open-lost` |
| Otro borrado/reinicio y publicación v2 completa sobre la época posterior | 34 | `compatibility-main/restart/publication` |

Los seis estados de publicación se siembran explícitamente en registros privados
sintéticos con capturas ligadas a sus IDs, además de las transiciones reales de
publicación verificada, fallo de manifiesto y SAF activo. No se presenta esa
siembra como si cada estado hubiera sido obtenido por una interrupción real.
Todos los IDs rechazan publicación por época después de completar limpieza y
conservan su estado histórico. La campaña de compatibilidad conserva los datos
del borrado anterior al publicar: no limpia el paquete antes de probar la nueva
época. Repite los 28 controles del publicador sobre ese conjunto nuevo y conserva
las copias externas anteriores byte por byte.

Jest completo final pasa **629 pruebas, 57 suites y 8 snapshots**, con los tres
benchmarks omitidos anteriores. TypeScript estricto, ESLint y diff-check pasan.
Se preservan pagos mínimos incluido $0,40 COP, transferencias/tarjetas, comprobantes
IA, gastos compartidos/condonaciones, Suscripciones, métricas e historial. Los
tests de equivalencia de borrado comparan todas las tablas/columnas y métricas;
no cambian importes ni relaciones de las reglas anteriores. Los fixtures no
rellenan cada tabla futura; se inspeccionan también sus tablas/columnas vacías.
Las huellas archivadas de 5B.3 acreditan que esquema, migraciones, runner, cola,
driver y dependencias no cambiaron en esta entrega.

Se conserva el intento inicial de HONOR interrumpido por dos runners tempranos
solapados y el fixture inicial de alarma cancelada legítimamente por mantenimiento;
no cuentan como campañas aceptadas. El runner actual añade un mutex por dispositivo.
Los fallos intermitentes previos de Jest están conservados junto al rechequeo
aislado y la corrida completa final aprobada. Los dos reportes históricos
rastreados regenerados por Jest se restituyen a sus bytes iniciales; los resultados
nuevos se conservan aparte en `atomicidad-fase5c/generated-regressions/`.

## Tiempos, permisos y posibles deadlocks

En las muestras funcionales pequeñas de `main-final`, la posesión exclusiva nativa
del borrado —inventario y transacción incluidos— dura **42,81 ms en API 24** y
**57,18 ms en HONOR API 35**. Se calcula con los eventos acquire/release que
preceden a la limpieza, no con el tiempo completo de SAF. La prueba con un
participante independiente retenido artificialmente tarda 238,24/250,21 ms en
esperar y completar rollback. No se observó un deadlock en las campañas ejecutadas.
Son muestras individuales con fixtures pequeños, no p95 ni presupuesto de borrado
con 100.000 movimientos; no se extrapolan a otros OEM ni se declara mejora de FPS.

El campo antiguo `rejectionMs` del harness incluye comprobación de tablas y
continuación de SAF; **no mide aisladamente el rechazo** y no se usa como tal.
El inventario consulta dos listas locales de WorkManager con límite de 5 s cada
una antes de BEGIN; en un almacenamiento problemático pueden alargar el permiso.
Las esperas de cancelación WorkManager también tienen límite de 5 s y ocurren sin
los permisos de SQLite/JS. Si faltan recibos o ejecución terminal, queda pendiente.
No se mantiene una transacción abierta durante una espera externa.

La cola JS se adquiere primero, todos los servicios nativos dentro de ella reciben
el token prestado y el runner reutiliza el mismo dueño. Kotlin no espera JS con
participación nativa retenida. El monitor de admisión no adquiere el permiso de
base; las operaciones de respaldo sueltan ese monitor antes de participar. El lock
de limpieza usa tryLock y no forma un ciclo con JS, publicación ni WorkManager.
Ningún timeout libera trabajo activo fingiendo que terminó.

## Código y contrato de mantenimiento

| Archivo o grupo | Cambio de 5C |
|---|---|
| `settings/useCases/deleteFinancialData.ts` | Admisión, clasificación financiera y limpieza separada |
| `settings/repositories/sqliteFinancialDataRepository.ts` | Mismos 36 DELETE, runner compartido e intención/comprobante |
| `settings/types/financialDeletion.ts` y `services/financialDeletionLifecycle.ts` | Contrato interno v1 y validación del puente |
| `SmartFinFinancialDeletion.kt` y `SmartFinDatabaseLifecycleModule.kt` | Barrera preparatoria, inventario, progreso y recuperación |
| `SmartFinBackupPublisher.kt` y `SmartFinDriveBackupModule.kt` | Lease, época/revocación, actualidad local y rechazo sin alterar historia |
| `SmartFinLocalSnapshot.kt` | Rechazo de nuevas capturas bajo admisión cerrada |
| Recordatorios/receptores/Worker Kotlin | Recursos por época, UUID de trabajo exacto y drenaje real de Headless |
| `subscriptionRuntime.ts` | Recuperación previa y validación de época en cada lote |
| AppNavigator, Ajustes, sección de Drive y dueño visual | Estados separados, éxito confirmado y descarte de consultas viejas |
| Tests y `scripts/phase5c/` | Oráculo anterior congelado, matrices, aislamiento y consolidación reproducible |

Las rutas abreviadas de TypeScript están bajo `src/modules/` y las Kotlin bajo
`android/app/src/main/java/com/smartfin/`. El procedimiento reproducible está en
[README](../scripts/phase5c/README.md).

## Veredicto de aceptación de 5C

**Fase 5C local aceptada dentro del alcance sintético comprobado, en un solo
proceso administrado.** El borrado financiero comparte un commit con su intención
y época; rollback conserva sus recursos; unknown no repite finanzas; la limpieza
puede reanudarse y los trabajos anteriores no publican tras el corte. La
publicación de producción permanece deshabilitada. No se inicia 5D ni 5E.

La actualidad de lectores externos continúa pendiente del contrato descrito
arriba y requiere autorización separada. Esta aceptación no la acredita ni
autoriza activar respaldos de producción. Los datos, campañas, hashes, límites e
intentos excluidos están en [summary.json](atomicidad-fase5c/summary.json).
