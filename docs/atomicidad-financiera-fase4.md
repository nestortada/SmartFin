# Atomicidad financiera: fase 4 — IA y Suscripciones

Fecha: 18 de octubre de 2026. Incluye auditoría previa a los cambios de producción
y resultados finales validados.

Se aplican las skills financiera y de rendimiento React Native. Se conservan los
cambios locales anteriores de fase 3B. No se autoriza esquema, dependencias,
driver, Kotlin de producción, respaldo ni borrado financiero.

## Matriz previa a implementación

| Entrada | Escrituras | Transacción actual | Riesgo comprobado | Protección propuesta |
|---|---|---|---|---|
| Confirmar plan, `executeAiCommandPlan` | Cuentas, movimientos, acompañantes, impuesto, cuotas, deuda/extractos, categorías y suscripciones/derivados | `withDatabaseMaintenance` + `runSharedSQLiteTransaction`, un BEGIN IMMEDIATE/COMMIT | Relee por acción, pero no compara con el catálogo de generación; IDs/referencias duplicados no se validan globalmente | Conservar runner; revisión del catálogo persistida en JSON del borrador, conflicto conservador antes de escribir, validar referencias/IDs |
| Guardar borrador, `saveActiveDraft` | Borrado de otros y REPLACE del actual | Dos sentencias independientes | Perder borrador anterior si falla la segunda escritura | Generador local; UPDATE/INSERT, conservar comprobantes |
| Confirmar/consumir borrador, hook | Limpiar tabla después del comando | DELETE posterior a COMMIT | Ventana de repetición; guardar nuevamente mismo ID con contenido distinto; desbloqueo ante unknown | Conservar fila como comprobante `confirmed` con plan y resultado JSON en el mismo commit financiero; lectura activa excluye comprobantes; ID confirmado inmutable |
| Presentar éxito IA | Estado React, refresco, callback | Posterior al COMMIT | Fallo de refresco se muestra como error de guardar | Separar error financiero de error de presentación; bloqueo persistente en esa instancia ante unknown |
| Contrato, edición/pausa/cancelación, ocurrencia, confirmar pago | Contrato, ocurrencias, proyecciones, alertas, intenciones | `repository.mutate`/`runSQLiteTransaction` ya atómico y participante | Referencias y pago se releen; conserva expected/actual; ya resuelto | Conservar y ampliar pruebas de fallos y concurrencia |
| Editar/borrar gasto vinculado, manual o IA | Saldo, movimiento, ocurrencia histórica y derivados | Repositorio de movimientos participa en ámbito exterior de fases 2/IA | Ya resuelto, no duplicar reconciliación | Verificar snapshots y relaciones dentro del mismo ámbito |
| Crear categoría/subcategoría desde Suscripciones | Categoría y sincronización derivada | Dos commits locales bajo permiso | Sincronización puede fallar tras guardar categoría | Compartir ámbito únicamente para esta composición, efectos OS posteriores |
| Inicio/reanudación/pantalla/Headless | Hasta 20 lotes de 500 + derivados | Un commit por lote; permiso retenido durante todos los lotes y efectos | Solicitudes equivalentes repetidas, lectores bloqueados hasta completar todo mantenimiento | Consolidar solicitudes concurrentes del runtime; liberar permiso entre lotes, preservar límites |
| Recordatorios | Intenciones SQLite, confirmación/revisión de plataforma; Android alarmas | Intención en commit, efectos y acknowledge después | Reprogramar recupera reinicios; no puede revertir efectos OS; errores ya separados en fachada | Reutilizar recuperación; no omitir alarmas por applied_revision tras reboot; evitar efectos de planes revertidos |

## Matriz financiera y límites preservados

Fixture sintético fijo: banco 1.000.000 COP, destino 0. Gasto posted/outflow
44.900: banco −44.900, gasto +44.900, patrimonio −44.900. Transferencia
100.000 con impuesto: banco −100.400, destino +100.000, principal y pata `-in`
sin ingreso/gasto; impuesto `-4x1000` +400 de gasto y patrimonio −400.
Crear suscripción 44.900: sin saldo/deuda/gasto real; obligaciones, proyecciones,
alertas e intenciones solamente. Resultado conjunto: banco 854.700, destino
100.000, disponible/patrimonio 954.700, gasto 45.300. No se cambia clasificación,
orden de suma, redondeos, tarjetas ni políticas de gastos compartidos.

## Diseño del comprobante sin migración

`ai_command_drafts.phase` es TEXT libre. Se reserva internamente `confirmed`;
`plan_json` conserva plan y metadatos locales, incluido el resultado confirmado.
Los tipos públicos de fase siguen siendo clarifying/review. Guardar y cancelar
solo elimina borradores activos; un ID confirmado nunca se reutiliza. Se compara
contenido canónico completo, no un hash con posibles colisiones. El historial de
comprobantes crece: no se introduce una política de purga que elimine evidencia.

Un comprobante confirmado permite reconocer la misma intención tras reapertura.
Sin él no se demuestra rollback ni rechazo: el comando sigue sin recibo verificable.
No hay ejecución automática al abrir la app; unknown bloquea repetición en la instancia.
No se promete exactamente una vez universal, ni identidad entre IDs diferentes,
ni garantías ante escritores Kotlin, restauración de respaldos o versiones antiguas.
No se amplía shared_commands, cuyo contrato pertenece a gastos compartidos.

La revisión financiera compara el catálogo original con el vigente antes de la
primera acción; los cambios propios dentro del plan no causan autoconflicto. Es
conservadora: también puede rechazar cambios ajenos. Un borrador legado sin revisión
necesita regeneración explícita. El llamador directo sin borrador es una intención
inmediata; no acredita detección de cambios desde una generación que no persistió.

## Evidencia previa y discrepancias

Los informes fases 0/1/1.1/2/3A/3A.1/3B documentan límites históricos; el diseño
original todavía describe ausencia de dueño y atomicidad manual, ya corregidas.
Las fases posteriores no acreditan consumo de borradores. `SUSCRIPCIONES.md`
describe deduplicación de alta de suscripción, no de un plan completo. El código
de `createSubscriptionInCommand` devuelve una fila existente sin comprobar contenido.
Los estados reales son active/paused/cancelled para contrato y
pending/overdue/paid/skipped para ocurrencias.

SQLite y efectos Android son dominios distintos: el receptor nativo valida revisión
y estado, pero publica antes de su commit propio. Se conserva esa limitación sin
modificar Kotlin ni diseñar una outbox nueva. El coordinador abarca un runtime y
su conexión administrada, como en fase 3B.

## Implementación y límites de commit

- `transactions/useCases/executeAiCommandPlan.ts` conserva el runner exterior y
  relee los repositorios dentro de cada acción. Copia la intención antes de esperar,
  rechaza números no finitos, IDs/clientRef duplicados y referencias futuras o
  incompatibles. El mapa de referencias y los resultados provisionales permanecen
  locales; rollback/unknown no los publican. BEGIN/COMMIT/ROLLBACK, generación,
  revocación, cuarentena y recuperación siguen perteneciendo a fases 1/1.1.
- `transactions/repositories/aiCommandReceipt.ts` comprueba intención/revisión y
  confirma el comprobante en el mismo ámbito que todas las acciones. Repetir el
  mismo ID/contenido devuelve el resumen financiero almacenado sin escrituras ni
  sincronización OS. Otro contenido con el mismo ID se rechaza. El resumen durable
  corresponde al commit financiero; los avisos de plataforma son posteriores.
- `sqliteAiDraftRepository.ts` guarda reemplazos de borrador con un generador
  transaccional, conserva createdAt y usa UPDATE/INSERT condicionado. Limpiar o
  guardar otro borrador conserva los comprobantes. Un borrador legado sin revisión
  se puede leer, pero no confirmar ni actualizar silenciosamente: requiere verificar
  su estado, cancelarlo y generar otra solicitud explícita.
- `useAiAssistantController.ts` captura catálogo y revisión bajo el mismo permiso,
  antes de interpretar. No consume desde el hook. Después del commit, un error de
  callback/refresco conserva el resultado guardado; ante unknown bloquea confirmar,
  cancelar, corregir o generar desde esa instancia. No se reejecuta al montar.
- `subscriptions/useCases/createSubscriptionInCommand.ts` ya deduplicaba por ID;
  ahora verifica también los términos normalizados antes de devolver una fila
  existente. No acepta silenciosamente otro contrato con el mismo ID.
- `subscriptions/services/subscriptionRuntime.ts` da un ámbito exterior solamente
  a crear categoría/subcategoría y sincronizar sus derivados. El generador de
  Suscripciones participa sin BEGIN anidado; efectos OS quedan fuera. El resto de
  las mutaciones conserva su transacción local ya existente.
- `createSubscriptionApi.ts` mantiene el contrato público; su composición interna
  permite diferir recordatorios hasta el commit exterior. Los fallos de plataforma
  se devuelven en reminderErrors. El controlador de Suscripciones conserva éxito
  ante error de presentación y bloquea el reenvío tras unknown reconocido por el
  runtime. La inferencia de incertidumbre de transacciones locales conserva el
  etiquetado COMMIT/ROLLBACK del driver y la cuarentena de fase 1; un doble sin ese
  comportamiento no acredita las mismas garantías.

## Mantenimiento y efectos externos

Inicio, reanudación, Headless y los cinco alias de mantenimiento de la fachada
comparten solicitudes concurrentes. Cada lote obtiene un permiso nuevo; se mantienen
500 fechas por suscripción/lote y hasta 20 lotes por ejecución. Los efectos OS se
recuperan una vez al terminar. Una revisión financiera comprueba que no entró un
escritor entre el último lote y la sincronización final: si cambió, vuelve a leer en
otro lote, dentro del mismo límite de 20. Agotar el límite conserva hasMore=true.
Esto evita omitir obligaciones al consolidar solicitudes que dejaron de ser equivalentes.
No se almacena una caché de mantenimiento terminado ni se ejecutan lotes históricos
dentro de una transacción prolongada.

`createSubscriptionApi.synchronizeReminders` conserva la programación idempotente
con identidad/revisión persistidas. Las alarmas programadas se vuelven a solicitar
para recuperar reinicios; applied_revision por sí solo no demuestra que Android
conservó una alarma. Una cancelación ya confirmada para la misma revisión se omite.
Un error al programar persiste delivery_status=failed/error y se recupera mediante
syncSubscriptionReminders. Un fallo al guardar el acknowledge queda en reminderErrors;
la intención anterior permite reintento. Nunca se repite por ello el comando financiero.

IA conserva la pasada final acotada que antes ejecutaba después de guardar una
suscripción, trasladándola dentro del commit del plan. El oráculo con un contrato
anual desde 1500 verifica más de 500 ocurrencias y equivalencia exacta con el
resultado previo. No se llama al bucle de veinte lotes dentro del plan.
Después del commit, IA sincroniza solo los recordatorios cuando creó una suscripción
o editó/eliminó movimientos; no ejecuta otro mantenimiento financiero postcommit.
La conciliación de movimientos ya dejó proyecciones, alertas e intenciones en el
ámbito exterior. Un plan revertido no invoca plataforma. No se añadió outbox ni se
cambió Kotlin, y no se promete rollback de una notificación ya publicada por el receptor.

## Pruebas, oráculos y diferencias autorizadas

Las fuentes previas están congeladas en `atomicidad-fase4/baseline-sources/` y en
los helpers `phase4ExecuteAiCommandPlan`, `phase4SubscriptionApi` y
`phase4SubscriptionRuntime`. Solo se adaptaron sus imports. La equivalencia de
éxito compara todas las tablas, auditoría, revisión, métricas y relaciones; normaliza
únicamente IDs generados con sus referencias y la nueva fila de comprobante autorizada.
No se usó actualización de snapshots ni tolerancias monetarias.

La expectativa antigua de `aiTransfers.test.ts` exigía error UNIQUE al repetir una
transferencia ya confirmada. Se cambia expresamente por éxito desde el comprobante,
conservando las comprobaciones de saldos, movimientos y deduplicación intactas.
Las diferencias autorizadas restantes son rechazo de referencias/IDs incompatibles,
conflicto conservador del catálogo, protección de borradores, composición atómica de
categorías de Suscripciones y separación de errores postcommit.

`financialAtomicityPhase4.test.ts` ejercita plan compuesto, cada escritura antes/después,
conflictos de cuenta/movimiento/suscripción, Infinity/-Infinity/NaN, referencias revocadas,
confirmación simultánea, COMMIT perdido antes/después sobre archivo sintético con
cierre/reapertura, rollback fallido y conciliación histórica. `subscriptionAtomicityPhase4`
descubre escrituras de diez flujos, exige snapshot completo tras cada rechazo y valida
concurrencia, liberación entre lotes, intercalación de escritor y recuperación OS.
`aiConfirmationPhase4` prueba los resultados de presentación/unknown del hook y
`aiDraftRepository` las tres escrituras de reemplazo del borrador antes/después.

La matriz Node descubre **26 escrituras del plan / 52 posiciones** y **115 escrituras
de diez flujos de Suscripciones / 230 posiciones**. La suite de borradores añade seis
posiciones y el lote final histórico añade cuatro controles de borde (primera/última
escritura, antes/después). Se comprueban foreign_key_check e integrity_check, saldos, deuda, patrimonio,
disponible, ingresos, gastos, ahorro, referencias, auditoría y financial_data_revision.
Los errores posteriores al commit se validan como confirmados con sincronización
pendiente, no como escenarios que deban restaurar el snapshot financiero anterior.

## Línea base y calidad

Antes de modificar producción: **555 pruebas / 47 suites / 8 snapshots aprobados**;
tres benchmarks omitidos existentes. TypeScript, ESLint y git diff --check sin errores.
[Jest inicial](atomicidad-fase4/smartfin-phase4-baseline-jest.log).
Los cambios previos de fase 3B no se revirtieron. Los artefactos de rendimiento de
fases anteriores que regeneran las suites se restauran a su contenido inicial.

Jest final: **591 pruebas / 51 suites / 8 snapshots aprobados**, con los tres
benchmarks omitidos anteriores conservados. TypeScript estricto, ESLint y
git diff --check terminan con código 0. [Jest final](atomicidad-fase4/jest-final.log),
[TypeScript](atomicidad-fase4/typescript-final.log),
[ESLint](atomicidad-fase4/eslint-final.log),
[Git](atomicidad-fase4/git-diff-check.log).
La regresión incluye fases 0/1.1/2/3A/3A.1/3B, pago de 0,40 rechazado, compartidos,
devoluciones/condonaciones, dashboard, paginación y SectionList.

## Validación Android final

Aplicación release/Hermes aislada `com.smartfin.atomicityphase1.tests`, driver y
parche instalados sin cambios. Emulador API 24 y HONOR CRT-NX3/API 35:

| Campaña | API 24 | HONOR API 35 |
|---|---:|---:|
| IA y Suscripciones: matrices y controles A–G | 291 | 291 |
| Comprobante entre dos arranques de proceso | 2 | 2 |
| Recuperación fase 1.1, incluida incertidumbre | 17 | 17 |
| Regresiones manuales fase 2 | 274 | 274 |
| Pagos de tarjeta fase 3A | 72 | 72 |
| Total aprobado | **656** | **656** |

**18 campañas y 1.312 casos aprobados.** La fase 4 descubre y verifica 280 posiciones
antes/después por dispositivo: 52 del plan y 228 de Suscripciones. Node añade dos
posiciones porque confirma un pago real de 45.900 frente a 44.900 esperado y genera
una alerta de precio; Android confirma 44.900, y comprueba la discrepancia al editar
el gasto vinculado. No se recortan escrituras descubiertas. Se conservan las 268
posiciones manuales y las 52 de pagos de las campañas anteriores.

[Resumen comprobado y enlaces a las 18 campañas](atomicidad-fase4/validation-summary.json).
Cada resultado compara tablas, revisión, auditoría, referencias y métricas y comprueba
FK/integridad. El cierre/reinicio verifica el mismo archivo sintético desde otro
proceso y reconoce el comprobante sin repetir saldo o movimientos. Ese reinicio
incluye cierre confirmado previo; no equivale a muerte del proceso durante COMMIT.
Las respuestas perdidas se prueban aparte como unknown, con recuperación de conexión
y sin reintento financiero automático.

Se verificaron las **291 fuentes bajo src/**, las copias con instrumentación declarada,
el driver instalado y el APK: SHA256
`663257b74bc4a84b0c1f64517bb34faa04d786300ea88d1cfc1e7a3e7f3ace95`.
El paquete instalado también coincide con ese binario; API 24 utiliza MD5 únicamente
como comprobación de igualdad para reutilizar nuestro APK y conserva SHA256 de forma
independiente. El runtime copiado sustituye solo el abridor por uno que exige elegir
el fixture sintético. No llama al singleton con el archivo financiero de producción.

El preparador está en `scripts/androidAtomicityPhase4/`; el APK conservado está en
`C:/sfatomicity-phase4-20261018/android/app/build/outputs/apk/release/app-release.apk`.
Solo `complete-*` constituye evidencia final. La campaña se repitió después de ampliar
la lista de huellas a todas las fuentes para corregir una omisión auxiliar. Una
reinstalación repetida del emulador se bloqueó antes de iniciar un escenario financiero;
el runner ahora reutiliza el APK comprobado e instala en modo no streaming si cambia.
Los intentos exploratorios y ese bloqueo no se cuentan como pruebas aprobadas.

Los servicios de recordatorio son **simulados** en la aplicación aislada. Se valida
intención, revisión, error persistido y recuperación a través del contrato; no se
atribuye ejecución real a AlarmManager, receptor o WorkManager de producción. Kotlin
se auditó pero no se modificó. No se probaron corte de energía, disco lleno, conexiones
nativas independientes o todos los fallos posibles del puente. Ninguna base real de
com.smartfin se abrió, exportó, modificó o migró. Sus metadatos de paquete permanecen
iguales antes/después de todas las campañas. La aplicación de pruebas queda detenida
y el emulador API 24 iniciado para esta validación quedó cerrado.

## Rendimiento y límites pendientes

La comparación Node conserva estado completo idéntico y reduce dos solicitudes
equivalentes de dos transacciones/pases OS a uno. La muestra de atrasos desde 2022
verifica que el lector termina después del primer lote de tres. Los tiempos son
muestras sintéticas, no percentiles, garantía de latencia ni medición de FPS.
[Comparación](atomicidad-fase4/node-maintenance-comparison.json),
[matriz y muestra de lotes](atomicidad-fase4/node-subscriptions-matrix.json).

Muestras Android del APK con las 291 fuentes actuales comprobadas:

| Muestra sintética | API 24 | HONOR API 35 |
|---|---:|---:|
| Plan compuesto y su inspección final | 154,80 ms | 859,82 ms |
| Mantenimiento atrasado desde 2022 (1.835 ocurrencias) e inspección | 3.838,34 ms | 32.659,74 ms |
| Lector encolado durante ese mantenimiento | 1.108,45 ms | 5.456,77 ms |

`operationMs` del harness incluye su inspección final de tablas/métricas; no se
presenta como duración exclusiva de BEGIN/COMMIT. `readerMs` mide la solicitud
encolada hasta resolver sus cuentas. La muestra demuestra progreso antes de acabar
el ciclo; **no demuestra ausencia de esperas prolongadas** en historiales atrasados.
En HONOR se observan 5,46 s para ese lector. La estructura libera entre lotes frente
al permiso anterior retenido durante todo el ciclo, pero no se midió una línea base
Android pareada de ese atraso. La comparación antes/después pareada es la de Node.
Perfilar IO y el coste de un lote de 500 en dispositivo frío queda como trabajo
posterior; no se cambian límites, índices, driver ni reglas monetarias aquí.

El permiso todavía protege los efectos OS de cada operación pública frente a cierre;
muchísimos recordatorios pueden retenerlo durante esa sincronización final. No se
rediseñaron esas interfaces ni la coordinación nativa. Tampoco se añade una versión
optimista a los formularios públicos de Suscripciones; sus referencias/estados se
revalidan en el dominio existente. La protección desde generación de borrador se
aplica al camino de IA que persiste su revisión, no a cualquier llamador inmediato
ni a reconstrucciones de intenciones con otro ID.

Los comprobantes sobreviven al consumo/cancelación de borradores y al reinicio normal
en la misma base. Crecen sin purga. No cubren borrado financiero autorizado, restaurar
una base anterior, downgrade a una versión que borre comprobantes, alteraciones
externas, otros procesos o escritores Kotlin independientes. Ausencia de comprobante
no se presenta como evidencia universal de rechazo o rollback. No hay asistente nuevo
de verificación de comandos inciertos ni promesa de exactamente una vez universal.

La siguiente ampliación requeriría un diseño y autorización separados para
coordinación Kotlin, retención/consulta de comprobantes, contratos optimistas públicos
o una identidad durable que atraviese restauraciones. No se implementa aquí.
