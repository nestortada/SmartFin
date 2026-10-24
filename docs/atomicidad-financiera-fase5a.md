# Fase 5A: coordinación nativa, respaldos y borrado financiero

Fecha de auditoría: 18 de octubre de 2026, America/Bogota. **Diagnóstico y diseño;
no implementa fase 5B.** Se aplicaron las skills locales `smartfin-financial-domain`
y `react-native-best-practices`, incluida la referencia de hilos nativos.

## 1. Resultado y alcance de la evidencia

La transacción administrada protege las operaciones SQL del runtime JavaScript.
No excluye conexiones Kotlin. El respaldo actual no puede certificar una revisión
común de SQLite y CSV frente al receptor; tampoco detecta de manera suficiente una
publicación incompleta. El borrado SQL tiene una transacción local, pero cancela
recursos Android antes de confirmar ese borrado. El receptor publica la notificación
antes de confirmar su transacción propia. Estos límites ya aparecían como pendientes
en el diseño y en las fases anteriores; no son regresiones atribuidas a la fase 4.

Se recomienda una barrera nativa pequeña para operaciones de ciclo de vida, snapshot
local inmutable y publicación por generaciones verificables; borrado SQL con una
intención de limpieza dentro de su commit y limpieza Android recuperable posterior.
La entrega de notificaciones merece una subfase independiente. Ninguna propuesta
promete una transacción global entre SQLite, AlarmManager y un proveedor documental.

Solo se añadieron este informe, scripts de auditoría y evidencia bajo
`docs/atomicidad-fase5a/`. No se tocaron producción, esquema, contratos, dependencias,
driver, Kotlin, cálculos ni tests existentes. No se abrió, copió ni borró una base
financiera real. Los cambios locales anteriores de 3B/4 permanecen.

Evidencia nueva:

- [12 reproducciones y sus límites](atomicidad-fase5a/reproductions.json): Node
  v24.16.0, SQLite 3.53.0, archivos nuevos dentro de un directorio temporal sintético,
  reloj SQL fijo `2026-10-18T15:00:00.000Z`. R5 cubre 36 escrituras/72 posiciones.
- [Calidad](atomicidad-fase5a/quality-results.json): 591 pruebas/51 suites aprobadas,
  8 snapshots, 3 benchmarks omitidos preexistentes; TypeScript, ESLint y diff-check
  con salida 0. [Jest completo](atomicidad-fase5a/jest.log).
- [Huellas antes/después](atomicidad-fase5a/scope-audit.json): 454 archivos protegidos
  idénticos, incluidos producción, tests, skill financiera y driver instalado.
  Cuatro JSON históricos regenerados por tests se restauraron a sus bytes iniciales.
- **No hay una campaña Android nueva en esta fase.** Se comprobó disponibilidad ADB
  de un HONOR CRT-NX3; no se inició ninguna app financiera ni se instaló un APK.
  Los efectos OS de las reproducciones son dobles explícitos. La matriz Android
  de §10 es trabajo pendiente, no resultados aprobados.

## 2. Fuentes y contraste histórico

Se revisaron `AGENTS.md`, `ARQUITECTURA.md` (persistencia, nativos, mantenimiento),
`BASE_DE_DATOS.md` (revisión, migraciones, borrado y privacidad),
`MODULOS_Y_FLUJOS.md` (ajustes/respaldo), `SUSCRIPCIONES.md` (persistencia,
recordatorios y recuperación), el diseño de atomicidad y código/llamadores vigentes.

| Antecedente revisado | Qué acredita / límite que se conserva |
|---|---|
| [Fase 1](atomicidad-financiera-fase1.md), [validación inicial API 24](validacion-atomicidad-fase1-api24.md) | Dueño JS y ámbitos revocables; tres bloqueos de recuperación iniciales, no certificación completa |
| [Fase 1.1](atomicidad-financiera-fase11.md), `atomicidad-fase11/validation-summary.json` | Recuperación corregida, 17 controles por entorno; no cubre conexiones Kotlin ni destrucción arbitraria del host |
| [Fase 2](atomicidad-financiera-fase2.md), `atomicidad-fase2/validation-summary.json` | Flujos manuales completos; los conteos antiguos corresponden a aquel árbol |
| [Fase 3A](atomicidad-financiera-fase3a.md), [3A.1](atomicidad-financiera-fase3a1.md) y sus resúmenes | Pago y lecturas especializadas; se mantienen 52 puntos del pago. El fallo histórico de la suite de 3A no describe el Jest actual |
| [Fase 3B](atomicidad-financiera-fase3b.md), [verificación posterior de rendimiento](verificacion-rendimiento-post3b.md) | Gestión de tarjetas y validación de pago efectivo; la columna antigua del lector tuvo una aclaración de instrumentación |
| [Fase 4](atomicidad-financiera-fase4.md), `atomicidad-fase4/quality-results.json`, `validation-summary.json` | 591 tests Node y campañas Android previas documentadas, comprobantes IA y recuperación de intenciones. Los servicios OS del APK aislado eran simulados |
| [Diseño original, fase 5](diseno-atomicidad-financiera.md) | Identificaba permiso nativo, limpieza durable y entrega como pendientes; no prueba que ya existan |

Discrepancias específicas, sin repararlas en esta entrega:

1. `BASE_DE_DATOS.md:293` describe correctamente el DELETE transaccional;
   `:324` aún afirma que el borrado total puede aplicarse parcialmente por carecer
   de transacción. El repositorio vigente y R5 respaldan el primer apartado en
   el límite SQL probado; ninguno acredita reversión de Android.
2. `MODULOS_Y_FLUJOS.md:180` habla de resembrar después del borrado. El handler
   vigente `AppNavigator.tsx:275` solo borra y refresca el dashboard. No llama a
   seed en ese recorrido. No se introduce reseed.
3. La coordinación anunciada por `SUSCRIPCIONES.md:55` cubre la fachada JS. No
   implica que `withDatabase` Kotlin adquiera `DatabasePermit`.
4. El mapa histórico de la skill acerca de gastos compartidos queda limitado por
   sus propias actualizaciones posteriores. Los módulos/pruebas vigentes se
   conservan, no se deducen políticas contables del texto antiguo.
5. `tarjetas-credito.csv` filtra `a.type='credit_card'`
   (`SmartFinDriveBackupModule.kt:433`), mientras los repositorios guardan el tipo
   de dominio `creditCard` sin esa conversión. Puede omitir tarjetas actuales.
   Es un hallazgo de exportación, no una corrección aplicada ni una prueba Android.

## 3. Inventario completo de acceso a la base financiera

La búsqueda de abridores en `src/` y `android/app/src/main/` encuentra una apertura
JS y dos fábricas Kotlin. Hay varias instancias transitorias de estas últimas.
Se distinguen de bases propias de WorkManager y de fixtures/harness de pruebas.

| Acceso / dueño real | Conexión y cierre | Operaciones y coordinación actual |
|---|---|---|
| `sqliteDatabase.ts` → `sqliteLifecycle.ts` | Singleton por promesa, `smartfin.db`, driver 6.0.1 instalado; cierre explícito con recibo | Cola `databaseCoordination.ts`; handle proxy `managedSQLite.ts`; FK ON, esquema/migraciones, FK/integridad/revisión al abrir. Recibos de apertura/cierre/verificación con límite de 10 s |
| Repositorios/UI/casos de uso JS | Reutilizan handle administrado y generación | Cada SQL adquiere cola o usa permiso prestado. Runner compartido posee BEGIN/COMMIT y participante; `runSQLiteTransaction` usa callbacks síncronos para unidades locales |
| Mantenimiento Suscripciones UI/Headless | Misma apertura JS mediante `subscriptionRuntime.ts` | Consolida solicitudes; permiso nuevo por lote de hasta 500 fechas, máximo 20 lotes. Recomprueba revisión antes del pase OS final. Las operaciones públicas protegen también sus efectos OS contra cierre JS |
| `SmartFinSubscriptionRemindersModule.withDatabase` (`:134`) | Cada llamada abre RW sobre `context.getDatabasePath("smartfin.db")`, `.use` cierra | `schedule`, `cancel`, `cancelAll` consultan intenciones; no adquieren cola JS ni una barrera Kotlin común. No configuran/verifican FK por conexión |
| `SmartFinSubscriptionReminderReceiver` (`:24`) | Otra conexión de la misma fábrica, en executor único del receptor | Transacción `beginTransaction` → lectura de revisión/contrato/cobro → notificación → UPDATE → `setTransactionSuccessful/endTransaction`; cierre `.use`. Escritor independiente |
| `SmartFinDriveBackupModule.exportBackup` (`:170`) | Primero stream del archivo; después conexión READONLY al archivo vivo, cierre en `finally` | Executor propio serializa respaldos y consultas de estado de ese módulo. No excluye receptor. No hay transacción de lectura común para todos los CSV |
| `SmartFinSubscriptionWorker` | No abre directamente otra conexión financiera | WorkManager inicia `reactHost`, espera arranque, lanza Headless JS y espera `completeMaintenance`. Reintenta mantenimiento, no un gasto/plan confirmado |
| Recovery receiver | No abre SQLite directamente | BOOT_COMPLETED, MY_PACKAGE_REPLACED, TIME_SET, TIMEZONE_CHANGED encolan WorkManager; puede operar sin actividad visible |
| Apertura/cierre al montar/desmontar navegación | Singleton JS anterior | Cleanup encola `closeSmartFinDatabase`; no cierra conexiones Kotlin ajenas. El cierre por destrucción nativa del host tiene límites históricos de 1.1 |

El manifest no declara un `android:process` separado para esos receivers. Corren
en el proceso de la app incluso sin UI; eso **no** los convierte en participantes
del runtime JS. No se encontró otro abridor financiero de producción ni un flujo
de restauración/importación: las referencias a “restore” de scripts/seguridad no
son un restaurador de SQLite. WorkManager tiene almacenamiento interno propio,
fuera del commit financiero. Seguridad utiliza preferencias/Keystore, sin abrir
otra base financiera.

`DatabasePermit` es un objeto validado por WeakSet del módulo JS, no un lock del
archivo ni un token nativo. La exclusión de SQLite impide escritores SQL
simultáneos, pero no protege una copia por `inputStream`, un conjunto de SELECT
autocommit ni las acciones OS. FK ON es por conexión: su verificación JS no prueba
la configuración Kotlin. Los UPDATE actuales del receptor no cambian claves
padre/hijo; no se observó por ello una violación FK concreta.

El driver Android instalado traduce BEGIN a `SQLiteDatabase.beginTransaction()`,
COMMIT a marca de éxito/endTransaction y ROLLBACK a endTransaction. No se atribuye
al texto `BEGIN IMMEDIATE` una semántica idéntica al motor Node. Se conserva el
parche de recuperación de 1.1; no cubre las conexiones Kotlin independientes.

### Órdenes de concurrencia observables

- Permiso JS de respaldo → checkpoint → revisión R → cerrar JS → receptor Kotlin
  confirma UPDATE y revisión R+1 → copia/CSV. El permiso sigue vigente; Kotlin
  nunca lo consultó. Si el receptor entra durante el stream, la copia no posee
  bloqueo SQLite. R1/R2 reproducen la falta de exclusión y cambio entre pasos.
- Copia R → receptor confirma R+1 → CSV del archivo vivo R+1 → manifiesto declara
  R. El receptor solo modifica recordatorios, no saldos; puede romper la igualdad
  de revisión/estado sin cambiar los CSV financieros actuales. Una divergencia
  monetaria entre CSV requiere otro escritor independiente: R2 lo modela y lo
  etiqueta, no se atribuye ese UPDATE de cuenta al receptor actual.
- Receptor en transacción → SQL JS espera/falla por SQLite; su cola sigue libre
  de conocimiento del dueño Kotlin. R9 caracteriza BUSY con timeout cero en Node;
  Android puede esperar de otra forma y requiere medición.
- `schedule`: SELECT válido → cierre de conexión → `setAndAllowWhileIdle`. Sin
  exclusión del ciclo completo, una cancelación/borrado puede intercalarse entre
  validación y efecto. `cancel` tiene una ventana análoga para un ID reutilizado.
- Mantenimiento libera entre lotes → borrado entra → siguiente lote vuelve a
  leer una base vacía. Hoy puede volver a asegurar trabajo periódico aun sin
  suscripciones. El diseño de limpieza debe distinguir trabajo viejo/nuevo.
- En el diseño de snapshot corto, una publicación puede seguir usando datos
  capturados mientras la base viva recibe un borrado. Los jobs de respaldo y su
  staging privado también necesitan coordinación de ciclo de vida; liberar el
  permiso SQL no autoriza publicar después de una revocación de ese job.

## 4. Auditoría del respaldo actual

Ruta completa: botón Ajustes/selección de carpeta → `runSettingsTask` →
`withExclusiveDatabase` → handle prestado → `PRAGMA wal_checkpoint(FULL)` → leer
revisión → quitar DB/repositorio del estado React → cerrar singleton →
`exportDriveBackup(revision)` → executor Kotlin → copiar archivo a SAF → abrir
READONLY **origen vivo** → 11 exportaciones CSV fijas → eliminar archivos anuales
del manifiesto anterior → consultar años → CSV por año → manifiesto → resolver
promesa → actualizar estado → `finally` reabrir/verificar/recrear repositorio.

| Paso / condición | Evidencia y consecuencia |
|---|---|
| Checkpoint | Se descartan sus filas de resultado (`AppNavigator.tsx:306`). FULL puede devolver busy sin excepción (R12). No garantiza ausencia de escrituras posteriores; en journal no WAL no convierte la copia en snapshot |
| Copia física | `input.copyTo(output)` (`Backup.kt:185`) sin permiso nativo ni bloqueo del archivo. Sin escritor, cierre/checkpoint correctos y journal limpio puede ser una copia válida; esas precondiciones no están aseguradas frente a Kotlin |
| WAL | Solo se copia `.db`, sin WAL/journal. R3 omite un UPDATE confirmado posterior al checkpoint, conservando integridad estructural. WAL se activa únicamente en ese fixture; las fases previas observaron persist en API 24 y truncate en HONOR API 35 |
| CSV | Se leen del original, no del `.db` exportado; SELECT separados, sin snapshot compartido. Una conexión READONLY no inmoviliza por sí sola la base entre consultas. R2 comprueba revisiones distintas |
| Manifiesto | `formatVersion=1`, nombres, fecha, revisión recibida de JS y `encrypted=false`; no relee esa revisión ni comprueba tamaños, hashes, conteos, FK o integridad del archivo copiado |
| Destino parcial | `writeDocument` busca nombre y abre con `"wt"` (`:325–343`); puede truncar el respaldo anterior. Una excepción rechaza la promesa, pero no recupera sus bytes ni borra todos los residuos. Se puede perder la única generación buena |
| Estado remoto | Solo existencia del `.db` y `remoteRevision < currentRevision` (`:148`). Un manifiesto viejo con la misma revisión y `.db` parcial puede parecer vigente (R4). Si el remoto tiene revisión mayor después de restaurar una base vieja, tampoco se considera desactualizado; revisión no equivale a linaje |
| Archivos anuales | Se eliminan antes del nuevo manifiesto; el catch ignora errores. Puede quedar el manifiesto anterior apuntando a CSV borrados o una mezcla de generaciones |
| Muerte de proceso | No hay job durable ni staging/reanudación. `invalidate` hace shutdown del executor, no revierte documentos. Muerte tras escritura externa o antes del recibo deja resultado de publicación incierto; reapertura local no repara el destino |
| Reapertura fallida | El `finally` puede fallar después de exportación completa y sustituir el error previo; el usuario recibe un error aunque los archivos existan. Separar exportación y recuperación local en la siguiente fase |

Escrituras externas: solo en el árbol URI seleccionado, conservado en preferencias
privadas cuando Android concede el permiso; nombres definidos por el módulo,
eliminación anual limitada por regex. No hay OAuth/API Drive ni upload propio.
SAF puede ser otro proveedor elegido por el usuario; el rótulo “Drive” no valida
su identidad. El proveedor puede sincronizar por su cuenta. El estado de permiso
persistente no acredita integridad ni sincronización remota durable.

La copia es **toda** SQLite: incluye comprobantes/borradores IA, ajustes, tablas
reservadas y mensajes históricos, no solo las filas visibles de los CSV. No hay
cifrado del respaldo por diseño previo autorizado. Borrar filas tampoco equivale
a borrar páginas libres, journals, archivos adjuntos por URI o copias externas.
No se añadió red, cifrado, purga ni exposición en logs de datos reales.

`financial_data_revision` tampoco cubre todo el archivo: los triggers incluyen
finanzas/derivados y recordatorios, pero no `ai_command_drafts` ni `app_settings`.
Confirmar solo un recibo o cambiar un ajuste puede conservar el mismo número.
El receptor, en cambio, puede aumentarlo sin cambiar un importe financiero.
Un número igual no demuestra identidad de archivos ni igualdad de comprobantes;
por eso el diseño exige snapshot validado y checksum además de revisión.

### Alternativas de snapshot y compatibilidad

| Alternativa | Consistencia y coste | API 24 / API 35 y decisión |
|---|---|---|
| Barrera nativa de ciclo de vida + cerrar/quiescer todos los accesos + copia local | Cero escritores durante checkpoint y copia; CSV de esa copia. Bloqueo limitado a disco local y validación/reapertura, no a SAF | **Recomendada**, reutiliza driver/modelo actual. Hay que certificar journal limpio, checkpoint completo y cierre/ausencia de usuarios; no basta cerrar solo JS |
| Lock SQLite de lectura + copia bajo lock | Puede servir con rollback journal; en WAL un lector permite commits nuevos y copiar solo el main sigue siendo insuficiente | No adoptar una receta única independiente del journal; más delicada que quiescencia explícita |
| API C `sqlite3_backup` | Snapshot consistente con escritores concurrentes; CSV del snapshot terminado; debe manejar BUSY/reinicio y verificar destino | Disponible desde SQLite antiguo, pero no expuesta por el API Android/driver usados. JNI/driver/dependencia exigirían autorización y más superficie |
| `VACUUM INTO` | Produce una copia consistente compactada; requiere espacio y validación, no garantiza publicación externa | Apareció en SQLite 3.27.0; el API 24 medido en fases anteriores es 3.9.2. No puede ser la única solución; SQLite no se deduce solo del número API |
| Exportación lógica propia | Requiere serializar tablas, tipos, blobs, esquema, triggers y referencias con equivalencia/restauración | Más invasiva; no recomendada para sustituir un respaldo completo |
| Un solo servicio nativo dueño de todo SQLite | Centraliza conexión/locks | Mayor migración de contratos/driver, fuera de alcance; innecesaria como primera entrega |

Una verificación de revisión antes/después sin exclusión no basta: puede detectar
cambio y rechazar, pero no hace segura una copia física intercalada. No se usaría
el número de revisión como checksum ni como identidad universal.

## 5. Auditoría del borrado actual

`SettingsScreen` pide confirmación → `AppNavigator.tsx:275` obtiene permiso JS y
construye repositorio prestado → `deleteFinancialData.ts:7` llama `cancelAll()` →
repositorio recorre 36 DELETE en un `runSQLiteTransaction` → refresco de dashboard.
El permiso exterior no es una transacción que incluya AlarmManager.

Orden SQL exacto descubierto por R5:

```text
shared_commands, shared_loss_events, shared_allocations, shared_returns,
shared_receipts, transaction_splits, shared_expenses, shared_contacts,
subscription_reminders, subscription_occurrences, ai_command_drafts,
transaction_tax_tags, tax_tags, receipt_attachments, installment_purchases,
credit_card_statements, credit_card_profiles, amortization_schedule_items, loans,
recurring_subscriptions, envelope_movements, envelopes, budgets,
account_balance_history, transactions, merchant_mappings, subcategories,
categories, cash_flow_events, smart_alerts, financial_health_scores,
financial_goals, investment_assets, backup_records, raw_financial_messages, accounts
```

Conserva `app_settings`, `schema_migrations`, `financial_data_revision` y el archivo
DB. Los triggers incrementan revisión por filas afectadas; no se restablece a cero.
`backup_records` no es un historial funcional de los archivos SAF existentes.

`cancelAll` consulta IDs, cancela PendingIntent/AlarmManager y notificaciones con
tag del recordatorio; limpia notificaciones activas con prefijo y pide cancelar
dos trabajos únicos WorkManager. No espera el resultado de los `Operation` de
WorkManager. No borra copias SAF, sus permisos persistidos, adjuntos por URI,
preferencias de seguridad/Keystore ni credenciales. La pérdida de IDs después de
DELETE impediría descubrir alarmas huérfanas con la consulta actual: mover la
llamada después del commit sin conservarlos sería insuficiente.

R5 confirma rollback SQL completo, incluidos revisión y todas las tablas del
fixture, tras cada punto antes/después de DELETE. El fixture tiene cuenta,
contrato, ocurrencia, recordatorio y ajustes; no rellena todas las tablas futuras.
La regresión Jest cubre por separado tarjetas, compartidos y vínculos. El doble de
alarmas muestra el efecto cancelado pese al rollback. No demuestra restauración
de AlarmManager real ni resistencia a apagado físico.

El borrado usa el runner **local** de callbacks, no el resultado tipado del runner
compartido. `managedSQLite` reconoce los errores COMMIT/ROLLBACK rotulados por el
driver y pone la conexión en cuarentena. `runSettingsTask` muestra el error y
libera el busy visual; no tiene el bloqueo durable/por instancia de los hooks IA.
R11 adapta explícitamente ese rótulo del driver en Node: antes de COMMIT queda el
snapshot anterior; después queda vacío, ambos con cuarentena y resultado incierto.
Reabrir y encontrar una base íntegra no determina por sí solo qué intención quedó
confirmada.

## 6. Recordatorios: garantías reales y ventana de entrega

Intención SQLite: ID estable por ocurrencia/offset, `revision`, `desired`,
`delivery_status`, `applied_revision`. Cambios contractuales/conciliación mantienen
derivados sin crear gastos. La fase 4 programa/cancela después del commit y
captura errores de plataforma aparte. Reprograma `scheduled` aunque exista acuse,
para recuperar alarmas perdidas al reiniciar. Solo omite cancelaciones ya
confirmadas con la misma revisión. El acknowledge SQL (`Repository.ts:477`)
compara revisión y no sobrescribe `delivered`; R9 preserva ese predicado.

El receptor relee revisión, desired, cobro pending y contrato active, y compara
el día local actual con expected_date. El tiempo exacto, canal y permisos dependen
de Android; el receptor no representa un pago. Publica `notify(id,1)` dentro de la
transacción y después actualiza delivered/applied_revision. Si el UPDATE o
endTransaction falla, solicita recuperación. **El rollback solo revierte SQL.**

R8 muestra dos llamadas de publicación y una sola clave activa después de fallar
el primer acuse y reabrir. En Android el mismo tag/id actualiza la notificación
existente, pero no hay `setOnlyAlertOnce` en ese builder; no se demuestra ausencia
de sonido/alerta repetida, ni que el usuario no la haya visto o descartado. Consultar
notificaciones activas puede reducir duplicados, pero su ausencia no prueba que
nunca se publicó. Marcar delivered antes de notify cambia duplicados por avisos
perdidos si el proceso muere: no es una solución de exactamente una vez.

Propuesta separada: conservar intención/revisión actuales, reclamar entrega
condicional en SQL, publicar fuera del commit y confirmar condicionalmente. El
estado de entrega incierta necesita política explícita: recuperación puede
reconciliar la clave activa y repetir con identidad estable/alerta única; si no
existe, decidir entre reintentar con posible duplicación u omitir con posible
pérdida. Un estado/lease durable nuevo requiere autorización de contrato/esquema
o metadatos internos versionados. No mantener una transacción de escritura mientras
se espera al OS. Revalidar generación/estado antes del efecto bajo la barrera
nativa y conservar recuperación de fase 4: no saltar scheduled por applied_revision.

Al iniciar, volver a primer plano o recibir BOOT/TIME/TIMEZONE/PACKAGE_REPLACED,
recuperar primero limpiezas pendientes; después mantenimiento normal. No deducir
ausencia de alarma de una base restaurada ni permitir que un trabajo de limpieza
antiguo cancele una nueva alarma con identidad reutilizada.

## 7. Arquitectura propuesta para la implementación futura

### 7.1 Propiedad, exclusión y orden de locks

Mantener JS dueño de finanzas, repositorios/runner actuales y SQLite como árbitro
de transacciones. Añadir un coordinador nativo **de ciclo de vida**, compartido
por respaldo, fábrica de recordatorios, programación/cancelación y receptor.
No convertir cada cálculo en una llamada nativa ni introducir otro driver.

Orden fijo para una operación JS de respaldo/borrado:

```text
permiso JS → permiso nativo exclusivo de ciclo de vida → transacción SQLite
          → finalizar/cerrar SQLite → liberar permiso nativo → liberar permiso JS
```

Los accesos Kotlin ordinarios adquieren participación nativa antes de abrir,
manteniéndola hasta cerrar y completar su efecto OS. El receptor toma participación
nativa → transacción SQLite → cierra → libera; **no espera JS bajo ese permiso**.
Recovery encola trabajo y libera antes de cualquier espera Headless. El worker
no retiene un permiso nativo mientras espera `completeMaintenance`.

No esperar bajo el permiso JS a que termine un worker que esté esperando entrar
en esa misma cola. El acuse de cancelación de WorkManager y la terminación de un
worker ya iniciado son resultados distintos. Un trabajo iniciado antes del borrado
debe revalidar su generación/estado de limpieza antes de volver a asegurar trabajo
o programar alarmas; la identidad de ese trabajo local no es una identidad
financiera universal ni autoriza reconstruir datos borrados.

El token exterior prestado permite operaciones internas de backup/cleanup sin
readquirir la barrera. No usar mutex de hilo cuya liberación deba ocurrir en el
mismo hilo desde el bridge; diseñar un token validado con dueño, generación,
revocación y conteo de participantes. No exponer handles SQLite crudos. Esperar
fuera de hilo UI/executor compartido RN. Evitar que un receiver consuma su plazo
`goAsync` esperando una exportación remota: diferir/reencolar si no entra pronto.

Si una adquisición supera su plazo, falla antes de operar. Un timeout no autoriza
a soltar el lock mientras continúe una copia/escritura real. Ante invalidación
del host hay que detener/drenar la tarea o mantener el bloqueo hasta terminar;
no liberar por un callback tardío como si la conexión estuviese certificada.
La muerte del proceso elimina el lock en memoria, no los trabajos durables.

Esta barrera cubre el proceso declarado actualmente. Si aparece otro proceso,
una barrera estática Kotlin sería insuficiente: exigir IPC/lock interproceso o
dueño único. Los locks SQLite siguen siendo necesarios, no un sustituto de esa
política. Las conexiones nativas deben verificar FK/configuración sin cambiar
journal/synchronous de producción en silencio.

### 7.2 Protocolo de respaldo consistente

1. Seleccionar/validar destino autorizado antes de la exclusión; crear un ID local
   de trabajo y espacio privado propio. No guardar datos fuera de esa carpeta.
2. Adquirir ambos permisos, drenar participantes Kotlin y trabajo JS previo.
   Ejecutar checkpoint inspeccionando su resultado y modo journal; ante busy o
   cierre incierto abortar snapshot. Resolver recuperación/journal mediante SQLite,
   nunca borrar a mano WAL/journal para forzar un estado “limpio”.
3. Capturar revisión y verificar estado, cerrar conexiones con recibo. Con todos
   los accesos excluidos copiar a staging privado nuevo, cerrar/sincronizar el
   archivo local; comprobar apertura READONLY, FK/integridad, esquema y revisión
   de esa copia. Una copia parcial nunca se promociona.
4. Reabrir/verificar singleton JS y restituir repositorios; liberar permisos en
   orden inverso. La captura local es la unidad corta excluyente. Si reapertura
   falla, informar por separado y mantener la política de cuarentena de 1.1.
5. Leer todos los CSV **exclusivamente del snapshot**. La revisión del manifiesto
   procede de esa copia, no de un argumento de UI. Especificar qué tablas cubren
   los CSV; el `.db` conserva comprobantes y tablas no exportadas.
6. Publicar nombres únicos por generación en SAF sin truncar la generación buena;
   registrar URIs retornadas por proveedor, tamaños, SHA-256 y conjunto esperado
   de archivos. Reabrir para validar bytes cuando el proveedor lo permita; si no,
   declarar publicación sin verificar, nunca “al día verificado”.
7. Publicar un manifiesto completo de esa generación al final. Su presencia sola
   no basta: aceptar solo JSON válido y archivos/tamaños/hashes coincidentes.
   Un puntero `latest` es orientativo y recuperable; no fingir que varios archivos
   cambian atómicamente. Conservar la generación previa hasta validar la nueva.
8. Mostrar “snapshot R publicado”, y comparar con revisión local actual: puede
   haberse vuelto antiguo mientras SAF escribía. No bloquear lectores/pagos
   durante la red del proveedor. Borrar staging privado cuando su trabajo termine
   según política aprobada, sin confundir publicación con gasto confirmado.

La primera entrega podría certificar solo snapshot local y conservar la
publicación existente como no verificada hasta completar el protocolo de
generaciones. No anunciar garantía de respaldo integral en ese estado intermedio.

### 7.3 Respaldo incompleto y resultado externo desconocido

Estado de job local propuesto: preparado → snapshot validado → publicación
pendiente → publicación verificada / fallida / incierta. Guardar identidad de
generación y URIs propias, sin copiar contenido financiero a logs. Es un diseño
de metadatos nuevo sujeto a autorización, no uso actual de `backup_records`.

Al reiniciar, verificar staging propio y manifest/hash de cada generación del
trabajo. Reanudar transferencia de ese snapshot o descartar su generación
incompleta; nunca repetir una operación financiera para reconstruirla. Un archivo
sin manifest válido es incompleto; un manifiesto sin archivos válidos también.
Si no se puede consultar el proveedor, mantener incierto. No eliminar documentos
ajenos ni generaciones por prefijos amplios. La limpieza de residuos y retención
de generaciones requieren política aprobada; ningún rename SAF se considera
commit atómico de conjunto. El proveedor puede cambiar el URI al renombrar.

### 7.4 Borrado SQL y limpieza externa recuperable

Recomendada una intención local mínima dentro del **mismo commit** del borrado:
ID de operación, fase/versión y los IDs exactos de recordatorios/trabajos antiguos,
sin importes ni títulos. Candidata menos invasiva: clave interna versionada en
`app_settings`, tabla conservada. Es una ampliación de contrato/persistencia que
requiere autorización; no se reserva una clave ni se escribe en esta fase.
Una tabla dedicada sería más explícita, pero exige migración. Un archivo o
SharedPreferences escrito antes/después de SQL tiene una brecha de dos commits:
no acredita por sí solo borrado y cleanup acoplados.

Mantener ambos permisos mientras se toma snapshot de IDs y se escribe la
intención con los 36 DELETE. Usar runner compartido para resultado explícito,
sin BEGIN anidado. Tras COMMIT confirmado, cancelar solo recursos antiguos y
esperar los recibos observables de WorkManager. Guardar progreso idempotente;
error de cancelación deja cleanup pendiente, no un borrado financiero fallido.

Una limpieza pendiente debe ejecutarse antes de permitir reprogramar recursos
con la misma identidad. Para evitar que una limpieza antigua elimine recordatorios
nuevos: bloquear programación/reutilización afectada mientras se resuelve, o
adoptar una generación nativa por operación. La primera opción conserva mejor
las identidades de fase 4 y requiere definir la UX de recordatorios temporalmente
pendientes. No detener pagos/lecturas por una espera de proveedor documental.
Las nuevas suscripciones financieras pueden guardarse, pero la programación OS
conflictiva debe esperar al cleanup; no ejecutar `cancelAll` tardío indiscriminado.

Incluir en el inventario de cleanup los snapshots/jobs **propios** anteriores al
borrado. Recomendación para autorizar: dejar de aceptar su publicación, cancelar
o drenar el stream ya iniciado y limpiar staging privado tras commit. Un proveedor
puede haber recibido bytes y no confirmar su cancelación: registrar publicación
incierta separada, sin afirmar que el borrado local retiró esos bytes. No borrar
respaldos completos externos ni adjuntos ajenos sin instrucción expresa. La
barrera de jobs debe evitar un deadlock con la barrera de DB: el publicador opera
solo sobre snapshot y nunca readquiere JS/SQLite vivo para terminar; no mantener
el permiso SQL esperando red indefinidamente. Si no se puede detener el stream,
la política de borrado debe exponer ese límite, no declarar cleanup total.

| Punto de fallo | SQL / comprobante de borrado | Acción de recuperación propuesta |
|---|---|---|
| Antes de adquirir o antes de escribir | Base intacta, sin intención nueva | Informar rechazo; no cancelar nada |
| Durante DELETE, rollback confirmado | Snapshot íntegro, intención revertida | No hay cleanup que aplicar; no compensar saldos |
| COMMIT confirmado, antes de cleanup | Filas borradas e intención pendiente | Informar borrado confirmado, recuperar cancelación por IDs |
| Error a mitad de cancelaciones | SQL continúa confirmado | Conservar pendientes, repetir solo cancelaciones idempotentes; no repetir DELETE |
| COMMIT/ROLLBACK sin recibo | Resultado unknown; conexión revocada/cuarentena | No cancelar basándose en el error; reabrir bajo política de 1.1 y buscar intención de ese ID. Presente permite confirmar alcance SQL. Ausente no prueba rollback universal; mantener revisión explícita |
| Muerte antes de COMMIT | SQLite recupera según journal; no afirmar resultado sin abrir | Validar FK/integridad y consultar intención, sin rehacer finanzas |
| Muerte después de COMMIT o durante cleanup | Intención sobrevive con IDs | Completar solo cleanup antes de programación conflictiva |
| Cleanup terminado, acuse perdido | SQL borrado y progreso quizá pendiente | Repetir cancelación de los mismos recursos es seguro bajo barrera; marcar terminado |

Confirmar UI dos cosas: **datos eliminados** y **recursos Android limpiados / limpieza
pendiente**. Mantener protección contra doble envío y bloquear reintento de
resultado unknown, igual que IA, sin transformar un error de presentación en una
nueva eliminación. No introducir restauración automática, resembrado financiero
o compensación para resolver incertidumbre.

## 8. IA, comprobantes y límites de restauración

`aiCommandReceipt.ts` compara ID y contenido canónico. Mismo ID/contenido confirmado
devuelve `_localCompleted` sin volver a escribir; otro contenido se rechaza. Se
confirma con los impactos del plan. Guardar/cancelar borrador activo conserva
comprobantes. Esta fase no cambia ese contrato ni la revisión de catálogo.

| Situación | Garantía real |
|---|---|
| Snapshot coherente posterior al commit IA | Incluye comprobante y efectos juntos. Los CSV solos no lo contienen |
| Copia física durante commit no coordinado | No se puede garantizar coherencia; un respaldo inválido no debe usarse para decidir reenvíos |
| Restaurar snapshot que contiene comprobante | Protege esa identidad/contenido mientras se conserven formato y código compatible |
| Restaurar snapshot anterior al comprobante | Desaparecen su evidencia y los cambios posteriores a ese snapshot. Ausencia no acredita que nunca se ejecutó, ni en esta instalación ni en el mundo externo |
| Reinterpretar intención con otro ID | Puede ser otra operación; no hay comparación semántica universal |
| Borrar todos los datos financieros | Borra deliberadamente `ai_command_drafts` y `shared_commands`; la protección histórica desaparece con sus datos. No retenerlos a escondidas |
| Downgrade/copia externa/base sustituida | Puede perder evidencia; no prometer exactamente una vez entre linajes |

R10 comprueba con helpers reales que el respaldo posterior conserva la fila y el
anterior no; `readAiCommandReceipt` devuelve undefined en el anterior. No ejecuta
de nuevo una intención financiera ni implementa un restaurador. Restaurar una
base anterior también puede hacer que revisiones numéricamente iguales representen
datos distintos. Un restaurador futuro deberá cerrar/quiescer, validar archivo,
invalidar handles/cachés, recomponer recordatorios y advertir el corte temporal;
es un encargo independiente. No se crea identidad universal, almacén externo de
recibos ni retención extra sin autorización.

## 9. Reproducciones y clasificación de riesgos

Scripts: [reproduce.js](../scripts/phase5a/reproduce.js) y
[quality.js](../scripts/phase5a/quality.js). No aceptan rutas de bases reales; crean
fixtures nuevos, mockean los módulos nativos y prohíben abrir por el bridge. La
base tiene esquema/migraciones reales; los SQL probados de borrado y helpers de
recibo/acuse se importan de producción sin modificarlos. R2/R3/R4/R8 modelan
explícitamente el orden Kotlin/OS/proveedor con Node y archivos/Map/Set.

| Caso | Resultado observado | Nivel de evidencia |
|---|---|---|
| R1 | Con permiso JS activo, conexión independiente confirma revisión 4→5. Durante escritura SQL sí rechaza otro escritor | Coordinador/runner reales + SQLite Node en archivo |
| R2 | `.db` revisión 4, antes de CSV 5, consulta posterior 6 | Barreras deterministas copy→commit→query; no Kotlin ejecutado |
| R3 | Main-only revisión 4; origen WAL confirmado 5; ambos pasan integridad | SQLite real, modo WAL solo sintético |
| R4 | `.db` de 128 bytes, manifiesto anterior igual revisión, predicado actual dice vigente; integrity_check falla | Proveedor modelado por filesystem, no SAF real |
| R5 | 36 DELETE descubiertos, 72/72 fallos antes/después; snapshot completo y revisión restaurados, FK/integridad y reapertura correctas; alarmas del doble ya canceladas | Caso de uso/repositorio/runner reales; OS simulado |
| R6 | Fallo nativo tras cancelación modelada impide SQL; base intacta, efecto externo ya ocurrido | Fachada real, cancelAll simulado |
| R7 | SQL confirmado, cleanup falla, base sigue vacía tras reapertura | **Prototipo de orden propuesto**, no camino actual |
| R8 | Rollback deja delivered pendiente, efecto publicado persiste; segundo intento hace otra llamada; una clave activa | Modelo receptor/OS, no prueba de sonido Android |
| R9 | Writer nativo impide acuse JS mientras posee transacción; después acknowledge real no sobrescribe delivered | SQLite real, conexión Kotlin sustituida por Node |
| R10 | Copia nueva tiene recibo, antigua no, borrado lo elimina | Helpers reales; sin restauración de producción |
| R11 | COMMIT antes: original; COMMIT después: vacío; ambas conexiones en cuarentena | Error de recibo inyectado y rótulo del driver adaptado explícitamente |
| R12 | FULL devuelve busy=1 sin excepción, con lector WAL antiguo activo | SQLite Node, no callback Android |

Se comprueban foreign_keys=1, foreign_key_check vacío e integrity_check=ok en los
estados válidos; R4 exige que el archivo incompleto falle. R5 compara todas las
columnas/tablas/auditoría/revisión con igualdad exacta y prueba reapertura. No se
introducen tolerancias monetarias. R10 verifica copias cerrables, no un flujo UI.
El fixture sencillo no sustituye las matrices financieras existentes; Jest
completo las vuelve a ejecutar, incluido rechazo de $0,40 COP y suscripciones,
tarjetas, compartidos, condonaciones, cuotas e impuesto.

Riesgos confirmados por código y/o reproducción: exclusión Kotlin ausente,
revisión copiada distinta de revisión exportada, detección insuficiente de archivo
parcial, cancelación anterior al commit, entrega anterior al acuse y pérdida
del comprobante al volver a un snapshot antiguo. **No se afirma haber provocado
corrupción por carrera en Android**, publicación duplicada real, pérdida de bytes
en Drive, deadlock real, muerte durante COMMIT o pérdida por apagado. La copia
intercalada corrupta y los bloqueos largos son riesgos fundamentados, pendientes
de las pruebas nativas siguientes.

Las primeras ejecuciones auxiliares del harness se corrigieron (opciones del
constructor Node y composición de dobles); se detuvo solo un proceso Node del
harness sintético. No cuentan como escenarios aprobados. El JSON final refleja
únicamente la ejecución completa de los 12 casos con salida 0. No son benchmarks.
Los fixtures temporales sintéticos se conservan para inspección; no contienen
datos del usuario.

## 10. Plan Android API 24 y API 35

No ejecutar `connectedDebugAndroidTest` del checkout como atajo: el applicationId
normal es `com.smartfin`. Aunque `SubscriptionReminderTest` redirige varias bases
con ContextWrapper, sus pruebas de Worker usan targetContext real y Headless
puede abrir el singleton financiero. Además, WorkManager/notificaciones seguirían
perteneciendo al paquete target. Los APK aislados de fase 4 excluyen los módulos
nativos reales: repetir sus 656 casos no probaría las ventanas nuevas.

Preparar un **paquete exclusivamente de pruebas** nuevo, por ejemplo
`com.smartfin.phase5a.tests`, sin shared UID, con abridor que exige fixture y falla
si falta. Copiar fuentes sin alterar producción; registrar hashes originales y
transformaciones test-only para barreras de ejecución. Incluir receiver, worker,
AlarmManager y ContentProvider local sintético que falla por byte/paso. Verificar
también WorkManager y Headless contra esa base seleccionada, sin contexto que
pueda volver a `com.smartfin`. Sin proveedor cloud ni datos reales.

| Campaña por API | Barreras/fallos y criterio de aprobación |
|---|---|
| Inventario | Medir sqlite_version, journal, synchronous, FK por conexión, hilos y package/UID. No asumir versión del motor por API |
| Copia frente a commit | Detener después de checkpoint/revisión, durante stream y antes de abrir CSV; intercalar receptor real. Registrar orden y snapshot/revisión por artefacto |
| CSV | Barreras entre cuentas, listado de años y movimientos; original modificado. Snapshot final/CSV deben corresponder a la revisión declarada |
| Checkpoint | Lector/transacción nativa activa, FULL incompleto, journal actual y WAL solo en fixtures; inspeccionar filas busy/log/checkpointed |
| Destino | Provider revoca URI, rechaza create/open/query/delete, falla tras N bytes, falla close o devuelve null; no certificar generación parcial ni destruir buena |
| Borrado | Fallar antes/después de cada DELETE descubierto, restricciones reales, rollback/commit con respuesta perdida; comparar todas las tablas y métricas |
| Cleanup | Fallar antes/después de cada cancelación, pérdida de acuse WorkManager, proceso muerto entre SQL y cleanup; mantener IDs, excluir nuevas identidades |
| Receptor/mantenimiento | Pausar tras SELECT, antes/después de notify y antes de endTransaction; intercalar mantenimiento de fase 4. Verificar revisions, delivered y número real de llamadas/alertas |
| Reinicios | Arranque frío, force-stop/reapertura, BOOT/tiempo/zona, host invalidado; corte de proceso antes/después de COMMIT y manifiesto. Diferenciar de apagado físico |
| IA/restauración sintética | Snapshot con/sin recibo, restauración test-only, repetición explícita mismo/otro ID; no confundir falta de comprobante con permiso para repetir |
| Regresión | Campañas 1.1/2/3A/3B/4 con fuentes verificadas; preservar pagos mínimos y equivalencia financiera, historial completo y paginación |

Cada resultado debe guardar build/API/ABI/sqlite/journal, fingerprints, secuencia
de barreras, resultado SQL y estado externo por separado, tablas/revisión,
foreign_key_check e integrity_check tras reapertura. Medir cuenta origen/destino,
deuda, disponible, patrimonio, ingreso/gasto/ahorro, cuotas/extractos y vínculos;
no limitarse al dashboard. Dos conexiones al mismo archivo, no dos `:memory:`.
Usar fallos deterministas y procesos aislados: no extrapolar a todos los OEM,
disco lleno real o apagado físico. API 24 de campañas anteriores tuvo SQLite 3.9.2;
HONOR API 35 tuvo 3.44.5: son antecedentes a volver a medir, no medición nueva.

## 11. Rendimiento, UX y entregas recomendadas

No hay evidencia nueva de jank, renders desperdiciados, FPS ni TTI. Se conservan
memoización/estado, SectionList, páginas de 50, cachés y orden de sumas. No se
implementa asociación masiva diferida. La skill RN lleva a medir la operación
nativa concreta, no a recomendar más useMemo por inspección.

El respaldo actual retiene permiso JS durante el proveedor completo y elimina el
handle de la UI: su latencia depende del destino. El diseño libera tras snapshot
local/reapertura; transferir y producir CSV no debe mantener bloqueada la base
viva. La validación completa y disco temporal tienen coste; medir captura,
checkpoint/cierre/apertura, espera de lector, tamaño/espacio, generación CSV,
publicación y cleanup por separado en release/Hermes, en frío y repeticiones
pareadas por volumen (1k/10k/100k). Reportar mediana/p95 solo con muestras
suficientes y finalización real del lector, siguiendo la corrección post-3B.

La fase 4 ya documenta una muestra HONOR con lector de 5,46 s durante atrasos;
no sumar a ese permiso una espera remota. Las muestras de esta auditoría no se
presentan como mejora de rendimiento. Definir presupuesto de espera/espacio con
mediciones antes de aceptar producción. Dar progreso y resultado por etapa sin
mostrar nombres/importes en logs; una espera larga no debe sugerir repetir finanzas.

| Entrega futura independiente | Archivos candidatos | Aceptación y reversión de código |
|---|---|---|
| 5B.1 Barrera nativa y captura local | `databaseCoordination.ts`, `sqliteDatabase.ts`, `managedSQLite.ts`, servicio de backup, `AppNavigator.tsx`; coordinador nativo nuevo, dos módulos y receiver | Exclusión/drain/orden de locks probados en ambas API; snapshot íntegro. Revertir llamadores y barrera juntos, conservar 1.1 y nunca saltar un cierre incierto |
| 5B.2 Publicación verificable | `SmartFinDriveBackupModule.kt`, servicio TS, `DriveBackupSection.tsx`, metadatos internos de jobs | Generaciones/manifest/hash, recuperación de parciales, resultado incierto. Reversión conserva lectura de formato previo y de jobs pendientes; no volver a sobrescribir la última generación buena |
| 5C Borrado y cleanup | `deleteFinancialData.ts`, `sqliteFinancialDataRepository.ts`, handler de navegación, coordinador nativo, reminders/worker/runtime | Intención + DELETE en mismo commit, OS posterior, unknown bloqueado, recuperación antes de reprogramar. No retirar lector/cleanup mientras haya intención pendiente; no “revertir” borrado reinsertando datos |
| 5D Entrega de notificaciones | receiver, módulo reminders, `subscriptionRuntime.ts`, `createSubscriptionApi.ts`, repositorio/esquema si se autoriza | Política de incertidumbre y claims, prueba de publish/ack/crash real. Mantener compatibilidad con intenciones de fase 4; drenar estados nuevos antes de retirar código |
| 5E Aceptación integrada | Harness Android aislado y docs/tests pertinentes | API 24/35, muertes/reaperturas/proveedor, regresión financiera y tiempos pareados; sin optimización financiera adicional |

Cambiar las etapas propuestas requiere aprobación específica, no se infiere de
esta auditoría. El esquema/contrato para jobs o cleanup se decide antes de tocar
producción; `atomicSQLite.ts` se reutiliza, no requiere reescribir el driver.

Decisiones que necesitan autorización del usuario para implementar:

1. Alcance Kotlin de la barrera, interfaces/token y política ante espera o host
   destruido; aceptar su cobertura de un solo proceso o diseñar IPC aparte.
2. Generaciones de respaldo, manifiesto versionado/checksums, espacio de staging,
   conservación de generaciones y tratamiento explícito de publicación incierta.
   El cifrado continúa con la decisión anterior salvo un encargo separado.
3. Persistencia mínima de intención/progreso de borrado en app_settings o migración
   dedicada; retención de IDs antiguos hasta confirmar cleanup y UX diferenciada.
   Incluir cancelación/drenaje de publicaciones en curso y limpieza de staging
   propio; definir por separado la conservación de respaldos externos ya completos.
4. Bloquear programación conflictiva mientras haya cleanup pendiente o incorporar
   generaciones OS. No introducir cancelación global tardía sin esa decisión.
5. Política de entrega incierta: preferencia entre posible duplicación y posible
   pérdida; claims/leases/estados nuevos y sus cambios de esquema/contrato si hacen falta.
6. Cualquier restauración funcional, retención de comprobantes tras borrado,
   identidad entre restauraciones, limpieza de adjuntos/copias remotas o borrado
   seguro de bytes. No forman parte de la implementación propuesta por defecto.

No se solicita ejecutar ninguna de estas decisiones ahora. La fase 5A termina
con diagnóstico reproducible y diseño; 5B permanece sin implementar.

## 12. Reproducción y fuentes primarias

Desde la raíz, con dependencias actuales instaladas:

```powershell
node scripts/phase5a/reproduce.js
node scripts/phase5a/quality.js
```

`quality.js` ejecuta Jest completo, TypeScript, ESLint y diff-check; conserva en
memoria los informes históricos antes de Jest y restaura solo los regenerados.
No restaura código ni cambios del usuario. Los scripts son diagnósticos, no se
incluyen en el bundle ni agregan dependencias. Los logs de calidad conservan las
duraciones solo como metadatos de ejecución.

Fuentes externas oficiales consultadas para las alternativas (no como evidencia
de ejecución de SmartFin):

- [SQLite Online Backup API](https://www.sqlite.org/backup.html): snapshot con API
  nativa y tratamiento de clientes concurrentes.
- [Riesgos de copiar durante una transacción](https://www.sqlite.org/howtocorrupt.html#backup_or_restore_while_a_transaction_is_active):
  copia física y auxiliares de recuperación; no asumir que cerrar un cliente los excluye todos.
- [PRAGMA wal_checkpoint](https://www.sqlite.org/pragma.html#pragma_wal_checkpoint):
  resultado busy/checkpoint y condiciones de terminación.
- [SQLite 3.27.0](https://www.sqlite.org/releaselog/3_27_0.html) y
  [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html): disponibilidad y límites
  de snapshot, sin depender de API 24 para una sintaxis que no soporta su motor medido.
- [Android SQLiteDatabase](https://developer.android.com/reference/android/database/sqlite/SQLiteDatabase):
  API Android usada y transacciones/configuración por conexión.
- [ContentResolver.openOutputStream](https://developer.android.com/reference/android/content/ContentResolver#openOutputStream(android.net.Uri,java.lang.String)):
  modos y fallos del proveedor; no equivale a commit remoto.
- [DocumentsContract.renameDocument](https://developer.android.com/reference/android/provider/DocumentsContract#renameDocument(android.content.ContentResolver,android.net.Uri,java.lang.String)):
  soporte/cambio de URI; no garantía de publicación atómica de varios archivos.
