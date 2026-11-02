# Transacciones y concurrencia

## Dos mecanismos que no deben confundirse

`src/database/atomicSQLite.ts::runSharedSQLiteTransaction` adquiere/reutiliza permiso, crea un participante y controla un único `BEGIN IMMEDIATE`/`COMMIT` nativo. Su cuerpo puede coordinar repositorios con `await`; **todas** las lecturas y escrituras financieras deben usar el participante entregado. Eso es distinto de añadir un callback `async` a `database.transaction`, que el driver no espera.

`runSQLiteTransaction` acepta `SQLiteProgram`, un generador de SQL. En una conexión ordinaria avanza síncronamente desde callbacks SQLite, forzando rollback si falla el dominio mediante una sentencia inválida controlada. En un participante activo avanza mediante `executeSql` sin abrir otra transacción; el propietario exterior decide el resultado final. Un resultado devuelto por el participante sigue siendo provisional.

`sqliteWithinExistingTransaction` valida que exista un participante activo: no convierte un handle cualquiera en participante ni acredita un `BEGIN` ajeno. `managedSQLite` rechaza control SQL público, transacciones/callbacks anidados, cierres del ámbito activo y handles escapados. No eludas el proxy para resolver un error de anidación.

## Procedimiento para una operación financiera

1. Sigue todos los puntos de entrada: formulario, acción rápida, IA, mantenimiento y otros casos de uso. Identifica qué entidades y relaciones deben confirmar juntas; usa la matriz de efectos de la skill financiera sin duplicar sus fórmulas.
2. Localiza el ámbito existente más cercano. Manual: `src/modules/transactions/useCases/manualTransactionScope.ts`; pagos: `src/modules/creditCards/useCases/creditCardPaymentScope.ts`; gestión: `src/modules/creditCards/useCases/creditCardManagementScope.ts`. Comprueba `repositorySQLiteDatabase` y exige el **mismo handle** registrado. La coincidencia de nombre de archivo no basta. Los dobles sin metadatos pueden ejecutar dominio pero no demostrar atomicidad SQLite.
3. Conserva el permiso prestado si el llamador ya posee mantenimiento. Reconstruye dependencias con el participante, como hacen los ámbitos actuales. No esperes una operación encolada detrás del permiso que tú mantienes: puede bloquearse indefinidamente. No lances tareas sin esperar dentro del ámbito.
4. Relee/valida estado persistido **dentro** del ámbito antes de escribir. Mantén conflictos optimistas que comparan campos incluso con `updatedAt` idéntico. Una validación anterior a la cola no excluye carreras.
5. Mantén cálculos, escritura principal y derivados necesarios en el mismo commit. Haz parsing/cómputo costoso independiente antes si es posible; revalida dentro lo que dependa del estado. Reserva notificaciones, recordatorios y efectos de presentación para después de confirmar, preservando las intenciones durables que correspondan.
6. Descubre las posiciones reales de escritura mediante trazas; inyecta fallos antes y después de cada escritura. Compara todas las tablas relacionadas, auditoría, revisión y métricas; no basta comprobar que la promesa rechazó.
7. Intercala determinísticamente dos escritores, un lector, cierre/captura y mantenimiento usando barreras. Exige visibilidad de estado confirmado, sin saldos perdidos ni doble reverso. Comprueba participantes revocados y permisos expirados.

## Matriz de límites a preservar

| Flujo | Qué debe quedar dentro del límite verificado |
|---|---|
| Transferencia y 4×1000 | Saldo origen/destino, movimiento principal, pata acompañante e impuesto; al editar/borrar, reverso y nuevos efectos juntos. Seguir `saveManualTransaction` y `deleteManualTransaction`, no operar el acompañante como principal |
| Compra de crédito y cuotas | Libro, deuda/cuenta, compra a cuotas y reconciliación pertinente; preservar historial/progreso según dominio, sin contar la cuota como otro gasto |
| Pago de tarjeta | Relectura/reconciliación, débito bancario, movimiento de pago, deuda y extractos. `creditCardTransactionRelations.ts` usa el ámbito de pago; validar importe efectivo después de redondeo/límite |
| Gestión de tarjeta | `saveCreditCardWithAssociations` y `closeCreditCardWithReconciliation` en `src/modules/creditCards/useCases/creditCardManagementCommands.ts`: cuenta/perfil, asociación/referencias, reconciliación y alerta/cierre bajo el mismo propietario |
| Edición/eliminación/acción rápida | Estado vigente, reverso completo, nuevo impacto, acompañantes, vínculos de cuotas, suscripciones y compartidos; revisar `src/modules/transactions/useCases/updateTransactionQuickly.ts` y los llamadores reales |
| Gastos compartidos y pérdidas | `src/modules/transactions/useCases/createSharedExpenseApi.ts` delega en `sqliteSharedExpenseRepository.execute`: comando estable, libro/cuentas/deuda, reparto/cobros/aplicaciones/devoluciones/pérdidas y comprobante se confirman juntos |
| Suscripciones/conciliaciones | Generadores de `src/modules/subscriptions/repositories/sqliteSubscriptionRepository.ts`; vínculo único de pago, ocurrencias, alertas, proyecciones e intención de recordatorios. Crear categorías desde la fachada participa en ámbito exterior; efectos Android quedan después |
| Plan IA | `src/modules/transactions/useCases/executeAiCommandPlan.ts`: todas las acciones, referencias y comprobante `ai_command_drafts.phase=confirmed` en el mismo commit. No trasladar al interior los veinte lotes del mantenimiento |

No reescribas aquí fórmulas de negocio. Exige las invariantes financieras de la operación, incluida equivalencia de saldos/deudas/patrimonio/periodos/relaciones; aplica el delta solicitado si hay cambio funcional autorizado.

## Interpretar la finalización

| Resultado/caso | Tratamiento actual del runner compartido |
|---|---|
| BEGIN sin recibo fiable | `unknown`; no hace ROLLBACK de una transacción cuyo propietario no pudo confirmar |
| Cuerpo falla, ROLLBACK responde correctamente | `rolledBack`; conserva el error original y revierte también revisión y derivados |
| ROLLBACK falla antes/después de ejecutarse | `unknown`, con `rollbackError`; revoca participante y descarta/cuarentena la conexión |
| COMMIT falla antes/después de ejecutarse | `unknown`; nunca ejecuta un ROLLBACK especulativo ni repite el cuerpo |
| COMMIT responde correctamente | `confirmed`; publicar éxito y efectos posteriores |
| Cierre de recuperación falla | Se conserva `recoveryError`; el handle no se reutiliza y el cierre fallido queda retenido |

Reabrir y pasar integridad prueba que la conexión/archivo es utilizable, no cuál fue la intención del usuario ni que aquel comando hizo rollback. Una fila de revisión mayor tampoco identifica el comando.

Comprueba comprobantes solo donde existen: ID+contenido en `shared_commands`, plan+ID en `ai_command_drafts`, recibos de borrado en `app_settings`. Presencia válida puede acreditar un commit específico; ausencia **no** acredita universalmente rollback. Las WeakMap de solicitudes manuales/tarjetas evitan repetir el mismo objeto en ese runtime, no proporcionan idempotencia durable entre reinicios, IDs diferentes o restauraciones.

No uses compensaciones manuales como sustituto de atomicidad sin un diseño explícito autorizado. No captures un error incierto y devuelvas éxito ni inventes reintentos por timeout, busy o fallo del recordatorio.

## Coordinación y límites de plataforma

`databaseCoordination.ts` serializa en el runtime JS; el gate Kotlin protege participantes del **mismo proceso**. El orden es JS → nativo. La adquisición JS no impone timeout que conceda otro propietario ante respuesta perdida; el gate nativo sí tiene límites de espera propios. Liberar espera a participantes reales; invalidar host deja cuarentena.

`src/modules/subscriptions/services/subscriptionRuntime.ts` consolida mantenimiento, libera el permiso entre hasta veinte lotes, relee revisión antes de terminar y comprueba época del dataset. No conviertas esos lotes en una transacción gigante ni elimines la comprobación de escritores intercalados. Captura/cierre/borrado requieren coordinarse con esos accesos y los nativos; la cola JS sola no protege una fábrica Kotlin ajena.

Usa [la selección de pruebas](testing-checklist.md) para exigir evidencia del ámbito real y de los fallos de finalización, diferenciando driver simulado y dispositivo.
