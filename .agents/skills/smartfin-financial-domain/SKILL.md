---
name: smartfin-financial-domain
description: Preserva el comportamiento y la integridad financiera de SmartFin al crear, modificar o revisar movimientos, cuentas, tarjetas, cuotas y extractos, suscripciones, gastos compartidos y condonaciones, saldos, deuda, patrimonio, centavos exactos o su persistencia. Úsala también para refactorizaciones, optimizaciones y migraciones que afecten esos resultados; no para cambios puramente visuales.
---

# Dominio financiero de SmartFin

Antes de cambiar un resultado financiero, identifica qué hace hoy la aplicación y qué diferencia solicita el usuario. Conserva las reglas existentes en refactorizaciones; una corrección funcional debe tener efectos explícitos y pruebas que los justifiquen. Esta skill no impone un modelo contable nuevo ni autoriza reparar problemas ajenos al encargo.

## Consultar las fuentes

Lee [AGENTS.md](../../../AGENTS.md) para las restricciones del proyecto. Consulta las secciones relevantes de estos documentos y contrástalas con código y pruebas vigentes:

- [BASE_DE_DATOS.md](../../../docs/BASE_DE_DATOS.md): relaciones, persistencia, compatibilidad y riesgos del esquema.
- [ARQUITECTURA.md](../../../docs/ARQUITECTURA.md): capas, puntos de entrada y coordinación de operaciones.
- [MODULOS_Y_FLUJOS.md](../../../docs/MODULOS_Y_FLUJOS.md): flujos financieros y estado de capacidades.
- [SUSCRIPCIONES.md](../../../docs/SUSCRIPCIONES.md): separación entre compromiso, cobro esperado, gasto real y conciliación.

No decidas por la fecha del documento o el nombre de una función. Para establecer el comportamiento actual, sigue los llamadores, las condiciones del código y el SQL, y busca evidencia en pruebas. Una prueba aprobada acredita sus escenarios, no garantías adicionales. Si documentación, código y pruebas discrepan, registra el conflicto con su fuente; no conviertas accidentalmente una discrepancia en una regla nueva.

### Localizar la implementación afectada

Las rutas de esta tabla parten de la raíz del proyecto. Lee solo los archivos pertinentes al cambio; usa `rg` para seguir sus consumidores.

| Área | Fuentes de comportamiento y verificación |
|---|---|
| Dinero y tipos | `src/shared/types/finance.ts`; `src/modules/{accounts,transactions,creditCards,subscriptions}/types/` |
| Saldos y patrimonio | [getDashboardSummary.ts](../../../src/modules/dashboard/useCases/getDashboardSummary.ts); `accounts/useCases/manageDebitCards.ts` y `getDebitCardsOverview.ts`; `__tests__/dashboardSummary.test.ts`, `debitCardManagement.test.ts` y `debitCardsOverview.test.ts` |
| Alta, edición y borrado | [saveManualTransaction.ts](../../../src/modules/transactions/useCases/saveManualTransaction.ts), incluidos `getAccountImpact`, `applyTransactionImpact` y `deleteManualTransactionSafely`; `updateTransactionQuickly.ts`; `transactions/repositories/sqliteTransactionRepository.ts`; `__tests__/saveManualTransaction.test.ts`, `financialIntegrity.test.ts` y `transactionsScreen.test.tsx` |
| Tarjetas, deuda y extractos | [creditCardTransactionRelations.ts](../../../src/modules/creditCards/useCases/creditCardTransactionRelations.ts); `creditCards/useCases/manageCreditCards.ts` y `getCreditCardsOverview.ts`; repositorio de tarjetas; `__tests__/creditCardTransactionRelations.test.ts` y `creditCardsOverview.test.ts` |
| Suscripciones | [subscriptionLifecycle.ts](../../../src/modules/subscriptions/useCases/subscriptionLifecycle.ts), `recurrence.ts`, `createSubscriptionApi.ts`; contrato y adaptador en `subscriptions/repositories/`; `__tests__/subscriptions.test.ts`, `subscriptionRecurrence.test.ts` y `aiSubscriptions.test.ts` |
| Integridad y atomicidad | [atomicSQLite.ts](../../../src/database/atomicSQLite.ts), `upsertSQLiteRow.ts`, `databaseCoordination.ts`, `sqliteSchema.ts`, `sqliteDatabase.ts`, `migrations.ts`; `subscriptions/database/schema.ts`; `accounts/repositories/saveSqliteAccounts.ts` |
| Lotes y referencias | [executeAiCommandPlan.ts](../../../src/modules/transactions/useCases/executeAiCommandPlan.ts); `transactions/hooks/useAiAssistantController.ts`; repositorios de categorías y borrado financiero; `__tests__/categoryManagement.test.ts` y `financialDataRepository.test.ts` |
| Equivalencia de consultas | `__tests__/helpers/dashboardSummaryBaseline.ts`, `transactionHistoryBaseline.ts` y `realSQLite.ts`; pruebas de dashboard e historial de movimientos |
| Gastos compartidos y condonaciones | `transactions/useCases/{sharedExpenseDomain,sharedLossDomain,sharedLossCommands,createSharedExpenseApi,sharedCommandEffects,readSharedFinancialTotals}.ts`; `transactions/repositories/{sqliteSharedExpenseRepository,sharedTransactionIntegrity,sharedFinancialProjectionSql,sharedFinancialTotalsSql}.ts`; `__tests__/sharedExpenses.test.ts`, `sharedForgiveness.test.ts` y `sharedFinancialTotals.test.ts`. Resumen: [references/shared-expenses.md](references/shared-expenses.md) |
| Precisión en centavos (fases 6A–6B.3) | `src/shared/utils/exactCopCents.ts`; escritores de saldo/deuda, reconciliación y pago de tarjeta; `getDashboardSummary.ts`; `__tests__/dashboardPhase6APrecision.test.ts`, `financialCorrectionPhase6B1.test.ts`, `dashboardAggregatesPhase6B2.test.ts` y `creditCardSettlementPhase6B3.test.tsx`. Resumen: [references/exact-cents.md](references/exact-cents.md) |
| Cuotas, extractos multiciclo e historial (fases 1a.1–1a.4B) | `creditCards/useCases/installmentPlan.ts` (motor puro), `creditCardStatementCharges.ts`, `initialInstallmentRevision.ts`, `installmentPlanRevisions.ts`, `installmentAllocationLedger.ts`, `installmentAllocationReversal.ts`, `extraordinaryInstallmentPayment.ts`; `creditCards/database/installmentHistorySchema.ts`; `creditCards/repositories/sqliteInstallmentHistoryRepository.ts`; `__tests__/installmentPlan.test.ts`, `creditCardStatementsPhase1a2.test.ts`, `installmentHistoryPhase1a3B.test.ts`, `initialInstallmentRevisionPhase1a4A.test.ts` y `extraordinaryInstallmentPaymentPhase1a4B.test.ts`; documentos `docs/motor-cuotas-fase1a1.md`, `correccion-fase1a2.md`, `persistencia-imputaciones-fase1a3B.md`, `revision-inicial-fase1a4A.md` y `abonos-extraordinarios-fase1a4B.md` |

Los nombres abreviados de módulos en la tabla están bajo `src/modules/`. No sustituyas el conjunto completo de movimientos por las páginas visibles del historial para reconciliar, editar o borrar.

## Reglas observadas que se deben comprobar y preservar

Este mapa describe la implementación revisada el 11 de octubre de 2026, actualizada el 7 de noviembre de 2026 con las fases 1a.1–1a.4B (motor de cuotas, extractos multiciclo, historial de cuotas y abonos extraordinarios) y el 12 de noviembre de 2026 con gastos compartidos, condonaciones y la precisión en centavos de las fases 6A–6B.3. Revalida las condiciones en el código antes de aplicarlo a una versión posterior.

- **Cuentas y patrimonio.** El dashboard incluye únicamente cuentas `active`. Disponible suma `balance.amount` de `cash`, `bankAccount` y `savingsAccount`. Deuda suma `debtBalance.amount` de `creditCard` y `loan`; patrimonio suma los activos anteriores más `investment`, resta esa deuda y, si hay posición compartida, suma una sola vez las cuentas por cobrar y resta los anticipos de terceros (`getDashboardSummary.ts`). El cupo disponible de una tarjeta no es un activo. La existencia del tipo `loan` no implica un módulo de préstamos operativo. Los saldos pueden proceder de valores iniciales o edición directa de cuentas, no solo de movimientos. Cerrar una cuenta cambia su inclusión en métricas sin eliminar su historial.
- **Ingreso y gasto mensual.** El dashboard usa el prefijo `YYYY-MM` de la fecha, estado `posted`, y exclusivamente `income/inflow` o `expense/outflow`. Una compra compartida aporta solo la participación propia al gasto, y cobros y devoluciones vinculados aportan cero. Desde la fase 6A, ingresos y gastos se suman en centavos exactos y ahorro = ingresos − gastos − pérdida neta compartida del periodo (eventos de `shared_loss_events`: condonaciones, recuperaciones y sus reversiones), con caída a la suma binaria anterior fuera del contrato de dos decimales ([exact-cents.md](references/exact-cents.md)). Una compra de crédito publicada cuenta como gasto por su importe completo. `internalTransfer` y `creditCardPayment` no cuentan como ingreso ni gasto. No generalices la clasificación del dashboard a las métricas de cuentas débito, que clasifican entradas y pagos de otra forma.
- **Movimientos manuales.** El flujo aplica el impacto al saldo de cuentas que no son tarjeta y cuyo movimiento no usa `paymentMethod: credit`; una entrada/ingreso aumenta saldo y una salida lo reduce. El gasto de crédito se reconcilia mediante el dominio de tarjetas. No atribuyas a este flujo un filtro universal por `posted`: su función de impacto no comprueba el estado.
- **Transferencias.** Se guardan origen `internalTransfer/outflow`, destino `<id>-in` con `inflow` y contracuentas cruzadas. El impacto de ambos saldos se aplica desde la operación principal, no aplicando otra vez el acompañante. Con cuentas activas compatibles, sin impuesto, disponible y patrimonio se conservan. El gasto opcional `<id>-4x1000` debita el origen y aumenta gasto con `Math.max(1, Math.round(amount * 0.004))`; entonces el patrimonio disminuye por ese impuesto. El filtro por cuenta usa la cuenta propia de cada pata.
- **Tarjetas.** `reconcileCreditCardTransactions` usa gastos `expense/outflow` y pagos `creditCardPayment` **no cancelados**, incluidos `pending`. Deuda es `max(0, compras completas - pagos)`, calculada desde la fase 6B.1 con `differenceOfCopSums` (centavos exactos con caída binaria). Desde la fase 1a.2, los cargos de cada ciclo salen de `creditCardStatementCharges.ts`: una compra sin plan activo de varias cuotas aporta su importe completo al ciclo de su fecha (`singleCharge`); un plan que el motor puede programar aporta solo la cuota que el motor asigna a ese ciclo, en centavos exactos (primera cuota en el ciclo de la compra, residuo en la última), de modo que las compras de meses anteriores aparecen cuando les toca y nunca dos veces en el mismo ciclo; un plan que no se puede programar conserva la regla heredada (`monthly_amount` solo en el ciclo de la compra, `legacyUnverified`) y se informa en `notices`. La deuda nunca se deriva de estos cargos, y las cuotas no generan otro gasto realizado. `registerCreditCardPayment` exige tarjeta y cuenta origen activas compatibles, valida importe finito positivo, usa `min(round(amount), deuda)` y exige saldo suficiente. Debita origen, guarda un pago dirigido a la tarjeta y reconcilia; no registra otro gasto. Ese es el contrato `settlement: 'partial'` (por defecto). Desde la fase 6B.3, `settlement: 'fullDebt'` liquida exactamente la deuda vista, con centavos, solo si el llamador lo pide expresamente y la deuda releída no cambió; si tras el pago la deuda no es 0, todo se revierte ([exact-cents.md](references/exact-cents.md)). Para cuentas activas incluidas en patrimonio, el pago conserva patrimonio al reducir activo y pasivo por el mismo importe. Intereses simulados y metadatos de cuota de manejo no acreditan cargos reales automáticos.
- **Cuotas e historial (fases 1a.1–1a.4B).** El motor `installmentPlan.ts` es puro, trabaja en centavos enteros y fechas civiles `America/Bogota`. La migración 5 añadió el historial (entre otras, `installment_plan_revisions` e `installment_allocations`, con columnas `*_cents INTEGER`; también `credit_card_billing_rules` e `installment_first_cycles`). Dar de alta o recrear un plan a cuotas escribe la revisión 0 en el mismo commit que el plan; con y sin esa revisión, saldos, deuda, cupo, patrimonio, ingresos, gastos, extractos y `installment_purchases` son idénticos. El abono extraordinario «No sé» (`extraordinaryInstallmentPayment.ts`) es un caso de uso interno, no exportado ni conectado a la interfaz: registra un pago ordinario e imputa como máximo el capital pendiente estimado de la compra elegida; un pago tiene como máximo una imputación activa y el resto queda como abono general. Imputar o revertir nunca modifica `installment_purchases` ni extractos históricos; borrar un abono imputado devuelve exactamente las métricas previas y deja la imputación `reversed`, sin reactivarla. La idempotencia es durable por `command_id`.
- **Crédito por clasificar.** `account-credit-card-unclassified` es actualmente una cuenta especial de tipo `bankAccount`. El gasto con medio `credit` no altera su saldo ni la deuda de una tarjeta real. La asociación posterior cambia cuenta y referencias de cuotas y reconcilia la tarjeta. No prometas que el dashboard incorpora esa deuda antes de clasificarla.
- **Gastos compartidos y condonaciones.** Dominio, persistencia y API implementados (migraciones 3 y 4) sin interfaz. Una compra conserva su importe bancario completo; el consumo usa la parte propia; la parte ajena es cuenta por cobrar y un cobro sin aplicar es anticipo. Patrimonio = activos + por cobrar − deuda − anticipos. Una condonación reduce la cuenta por cobrar y el patrimonio y crea pérdida, sin ingreso ni movimiento. Las tablas compartidas usan centavos `INTEGER`; la compra, los movimientos de cobro y devolución y los saldos siguen en el libro `REAL` (escritos con `addCopAmounts`). Todo ocurre bajo `runSharedSQLiteTransaction`, con idempotencia por ID de comando. Detalle: [shared-expenses.md](references/shared-expenses.md).
- **Suscripciones.** Crear, generar, vencer, pausar, cancelar, proyectar o recordar un compromiso no crea movimientos ni cambia saldo/deuda. Los equivalentes mensual/anual son compromisos, no gasto del periodo. `confirmPayment` vincula un movimiento existente `expense/outflow/posted`, moneda coincidente, importe finito positivo y cuenta compatible si se especificó. No exige igualdad de importe ni fecha: conserva `expectedAmount` y `actualAmount`; las sugerencias no son confirmaciones. Repetir el mismo vínculo es idempotente, y un movimiento no puede vincularse a otra ocurrencia. Registrar un gasto desde Suscripciones utiliza Movimientos y requiere después conciliación explícita.
- **Historial de suscripciones.** Editar un gasto vinculado compatible actualiza importe real y fecha de pago. Eliminarlo o incompatibilizarlo limpia el vínculo y deja el cobro `overdue` si su fecha es anterior a hoy, o `pending` en caso contrario, junto con sus entidades derivadas. Esto es atómico con la escritura/borrado del movimiento en el repositorio. Cambiar el contrato afecta pendientes estrictamente futuros, conservando pagos y obligaciones pasadas; la edición explícita del importe de una ocurrencia es una operación distinta que cambia solo su esperado, incluso si está pagada, sin cambiar gasto real ni contrato.

### Atomicidad implementada: fases 2, 3A, 3A.1 y 3B

El mapa anterior conserva observaciones históricas; contrasta sus límites con el código
vigente y los [informes de atomicidad](../../../docs/atomicidad-financiera-fase3b.md).
Los gastos compartidos están implementados (ver [shared-expenses.md](references/shared-expenses.md)
y las suites `sharedExpenses.test.ts`/`sharedForgiveness.test.ts`). Su existencia no autoriza
cambiar políticas de reparto durante una refactorización.
Los flujos manuales de fase 2 y el pago independiente de fase 3A ya comparten commit.
La fase 3A.1 conserva las sumas y usa consultas especializadas para reconciliar todo
el historial pertinente, sin limitarlo a las páginas visibles.

La fase 3B añade ámbitos compartidos para guardar cuenta/perfil de tarjeta, asociar
compras por clasificar, reconciliar tarjetas y validar/cerrar una tarjeta. Los comandos
`saveCreditCardWithAssociations` y `closeCreditCardWithReconciliation` componen la acción
de pantalla completa: incluyen referencias de cuotas, extractos y resolución de alerta
cuando el flujo previo la requería. La asociación relee la tarjeta activa y conserva el
predicado histórico de coincidencia por nombre/pistas, sin añadir filtro de fecha/estado.
No crea deuda de tarjeta antes de una asociación válida.

Los repositorios participantes reutilizan el dueño exterior, sin BEGIN anidado. El
runner conserva `confirmed`, `rolledBack` y `unknown`; solo un ROLLBACK confirmado
acredita reversión. No hay reintento financiero automático ni recibo durable universal.
Las pantallas bloquean el doble envío, conservan el bloqueo tras `unknown` durante esa
instancia y publican cierre/refresco/toast después del commit. La edición compara la
cuenta capturada al abrir el formulario; la pantalla de tarjetas también comprueba la
tasa mostrada frente al perfil vigente. Los dobles sin metadatos SQLite no acreditan
atomicidad. La coordinación sigue limitada al mismo runtime/conexión administrada.

**Nueva regla del pago:** después de `min(Math.round(amount), deuda)`, el importe efectivo
debe ser un entero seguro positivo, al menos $1 COP. $0,01/$0,40/$0,49 se rechazan antes
de escribir; $0,50 redondea a $1; $1 permanece $1; $100.000 conserva el límite por deuda
si este produce pesos enteros válidos. Una deuda de $0,40 o un límite efectivo de $1,40
se rechazan, sin redondearlos hacia arriba ni alterar la deuda histórica. El rechazo
posterior a la reconciliación inicial revierte también sus escrituras/revisión bajo el
runner. La UI permite coma decimal y muestra el error del dominio. No extender esta
validación al impuesto, cuotas, suscripciones ni a los importes de todas las operaciones.

La matriz de `financialAtomicityPhase3B.test.ts` compara todas las tablas, auditoría,
revisión y métricas, descubre escrituras y falla antes/después de cada una. La equivalencia
exitosa usa fuentes anteriores congeladas y solo normaliza identidades generadas con
sus referencias. Las pruebas de fase 3A conservan sus 52 puntos; la expectativa anterior
de pago cero se sustituye expresamente por el rechazo autorizado. Consulta el informe
para distinguir validación Node, Android, muestras de rendimiento y límites pendientes.

### Atomicidad implementada: fase 4, IA y Suscripciones

`executeAiCommandPlan` conserva el runner compartido. La revisión financiera del
catálogo se captura antes de interpretar y se persiste como metadato JSON del
borrador. Una revisión distinta rechaza conservadoramente antes de escribir; los
cambios de las propias acciones no producen autoconflicto. Cada acción relee sus
dependencias y las referencias deben apuntar a acciones anteriores válidas.

`ai_command_drafts` conserva internamente las filas `confirmed` con contenido y
resumen del plan, en el mismo commit que todos sus impactos. Repetir ID/contenido
devuelve ese resumen sin escrituras; otro contenido con el mismo ID se rechaza.
Guardar/cancelar borradores activos no elimina comprobantes. Un borrador legado
sin revisión no se actualiza ni confirma silenciosamente: exige verificar estado
y generar otra solicitud explícita. No se añadió esquema ni contrato público.
La ausencia de comprobante no acredita universalmente rollback; tampoco se deducen
intenciones equivalentes entre IDs diferentes, respaldos restaurados o downgrades.

La pasada final acotada de generación de Suscripciones del plan ocurre antes del
COMMIT; no se ejecuta el bucle de veinte lotes dentro del plan. Recordatorios y
presentación siguen después, con errores separados del éxito financiero. Unknown
bloquea reenvío en esa instancia del controlador y no reintenta automáticamente.

Las mutaciones de Suscripciones conservan su generador local. Crear categoría o
subcategoría desde su fachada comparte commit con sus derivados. El mantenimiento
consolida solicitudes concurrentes, libera el permiso entre lotes y compara revisión
antes de terminar para no omitir trabajo intercalado. Mantiene 500 fechas por
suscripción/lote y veinte lotes por ejecución. Recupera alarmas programadas tras
reinicio; omite solo cancelaciones ya confirmadas para la misma revisión. El servicio
Android no participa en rollback SQLite. Consultar [informe y límites de fase 4](../../../docs/atomicidad-financiera-fase4.md)
para distinguir evidencia Node, driver Android y efectos nativos simulados.

## Procedimiento para un cambio financiero

### Delimitar el impacto y evitar duplicación

1. Sigue cada punto de entrada afectado: formulario, acción rápida, IA, mantenimiento y consumidores de consultas. No presupongas que todos pasan por el mismo caso de uso.
2. Antes de implementar, describe el estado inicial y una matriz de efectos: operación/tipo/dirección/estado, importe/moneda/fecha, cuenta origen/destino, delta de saldo/deuda, ingreso/gasto, patrimonio y referencias derivadas. Separa el comportamiento actual del resultado solicitado.
3. Identifica el movimiento principal y sus acompañantes. Revisa IDs, `dedupeKey`, restricciones únicas y protección del llamador ante confirmaciones repetidas. La migración 1 mantiene un índice único parcial de deduplicación usado por IA; no implica idempotencia global del registro manual. Una colisión o rollback no debe justificar reaplicar un saldo ya confirmado.
4. No sumes como gastos adicionales extractos, cuotas, proyecciones `cash_flow_events`, alertas, recordatorios o registros vinculados a un gasto que ya se contabilizó.

**Devoluciones:** `refund` existe en tipos y fixtures, y el dashboard lo excluye de ingreso/gasto; no hay un flujo especializado comprobado para devolución completa/parcial o aplicada a tarjeta. Pero los gastos compartidos sí usan `refund`: `cashMovement` crea movimientos `refund` publicados («Reembolso de gasto compartido» como entrada, «Devolución de anticipo» como salida), `sharedTransactionIntegrity.ts` restringe su edición, y una entrada `refund` existente puede vincularse como cobro. Cambiar cómo se clasifica `refund` (por ejemplo, contarlo en el dashboard) altera los invariantes de gastos compartidos. Si el encargo incorpora un flujo de devoluciones, define con el requisito el pago original, importe devuelto, vínculo e impacto en saldo/deuda/patrimonio, y pregunta por la política financiera solo cuando no esté definida.

**Gastos compartidos:** el reparto entre personas vive en las tablas y casos de uso de gastos compartidos ([shared-expenses.md](references/shared-expenses.md)); Las participaciones compartidas son filas de `transaction_splits` con `shared_expense_id` (columnas `shared_expense_id`, `contact_id`, `amount_minor` y `shared_active`, añadidas por la migración 3, con índice único por persona); las filas sin `shared_expense_id` son la infraestructura anterior. No modifiques ni borres filas de esa tabla sin seguir sus consumidores: afectan cuentas por cobrar, parte propia y patrimonio. Reutiliza sus reglas de cuentas por cobrar, anticipos y pérdidas en vez de crear otras. No reutilices un gasto completo y sus partes como gastos adicionales.

### Validar modificaciones históricas

- Para edición o borrado, determina el impacto anterior y su reverso completo antes de aplicar el nuevo; comprueba ambas cuentas, impuestos y cuotas. Identifica la pata principal antes de tratar un acompañante de transferencia como operación independiente.
- Preserva identidad, `createdAt`, moneda y vínculos salvo cambio explícito. La fecha por defecto se conserva en edición, pero `transactionDate` puede reemplazarla: verifica el efecto en mes, ciclo y conciliación. Revisa también cuenta, tipo, dirección, medio y estado, no solo importe.
- Al cambiar/eliminar una compra de crédito o un pago, comprueba deuda, extracto y cuotas después; identifica el pago por su tipo y contracuenta, aunque su medio sea débito. Verifica que los formularios conserven el tipo de pago, en lugar de convertirlo incidentalmente en gasto. Las cuotas con condiciones monetarias y número sin cambios conservan su progreso; cambiar esas condiciones todavía puede reiniciar `paidInstallments`: verifica el resultado histórico antes de modificarlo.
- Para gastos vinculados a suscripciones, valida actualización o desvinculación en el repositorio, incluso en periodos antiguos fuera del horizonte futuro. No elimines primero la fila padre y después intentes reparar la conciliación.
- Una recategorización debe conservar totales financieros. Revisa reasignación a `category-other`, coherencia categoría/subcategoría y referencias de reglas, contratos y tablas relacionadas.

### Proteger integridad y atomicidad

- Dibuja el límite real de commit: cuentas, movimientos, acompañantes, cuotas, extractos y conciliaciones afectados. Una secuencia de `await` no es una transacción global. Comprueba los ámbitos manuales/de tarjetas ya implementados y su participación exterior; no extiendas esa garantía a reasignaciones de categorías, efectos OS u otros llamadores sin evidencia.
- Reutiliza `runSQLiteTransaction` y el patrón de generadores avanzados desde callbacks; no añadas callbacks `async` a una transacción del driver. En lotes de IA, `sqliteWithinExistingTransaction` participa en el `BEGIN IMMEDIATE` externo; evita transacciones anidadas.
- Mantén `foreign_keys` habilitadas. Inspecciona FK, acciones de borrado, unicidad y referencias polimórficas sin FK. Las ocurrencias requieren unicidad por suscripción/fecha y por movimiento vinculado. Comprueba `PRAGMA foreign_key_check` en una base de prueba después de operaciones relevantes.
- Conserva UPDATE + INSERT condicionado para cuentas y movimientos: `INSERT OR REPLACE` puede borrar padres y afectar hijos. No lo extiendas por analogía; existen usos heredados en otras tablas. Respeta compatibilidad con SQLite de Android API 24, sin exigir UPSERT moderno.
- Verifica coordinación con mantenimiento, respaldo/cierre y borrado, incluida revisión financiera. Los efectos Android de suscripciones ocurren después del commit: un fallo de recordatorio no debe provocar repetir el gasto o el contrato confirmado.

### Detectar precisión y compatibilidad

- El libro principal usa COP, `number` y SQLite `REAL`; no hay una migración global a unidades menores. Cuotas, historial de cuotas y gastos compartidos usan centavos `INTEGER`. Sigue cada parseo, suma, división y redondeo hasta persistencia y presentación.
- Desde las fases 6A–6B.3, los escritores de saldo y deuda, la deuda y el total de extractos y los agregados del dashboard se calculan con `exactCopCents.ts` (centavos exactos dentro del contrato de dos decimales y caída a la suma binaria anterior fuera de él). Un nuevo escritor o agregado monetario debe usar esas utilidades, no `saldo + delta` en binario ni redondeos propios ([exact-cents.md](references/exact-cents.md)). Siguen en binario o redondeo propio, entre otros, el pago mínimo del extracto (`Math.round(total·ratio)`), las sumas por cuenta de tarjetas débito y los deltas informativos de `sharedCommandEffects.ts`.
- Conserva orden de suma y predicados en optimizaciones: la ruta binaria heredada depende de ellos, y sustituir sumas JS por `SUM` SQL o reordenar filas puede cambiar resultados de punto flotante. No ocultes diferencias con tolerancias nuevas en una prueba de equivalencia.
- Revisa decimales, valores grandes, acumulaciones, `NaN`, infinitos y límites seguros. Suscripciones redondea a dos decimales y rechaza importes no finitos o mayores en valor absoluto que `MAX_SAFE_INTEGER / 100`; cuotas, impuesto y el pago parcial de tarjeta (`settlement: 'partial'`) usan redondeos a enteros, mientras que la liquidación total (`settlement: 'fullDebt'`) paga centavos exactos, incluso por debajo de $1. No unifiques esos tratamientos incidentalmente ni atribuyas esa validación a todo SmartFin.
- Para cambios de representación, esquema o validación, examina bases instaladas, migraciones 1/2, columnas nullable, estados heredados y metadatos en `accounts.description`. No reescribas datos históricos solo para hacerlos coincidir con una regla nueva. Suscripciones conserva configuraciones inválidas mediante diagnósticos; no las borra.
- Conserva la distinción entre fechas civiles de suscripción, marcas ISO de auditoría y los prefijos/fechas heredados de movimientos. Un cambio de zona horaria no debe desplazar cobros civiles ni pagos históricos.

## Definir y ejecutar verificación financiera

Antes del cambio, define escenarios con datos sintéticos, reloj fijo y el mismo estado inicial en ambas versiones. Usa pruebas existentes como oráculo o caracteriza el comportamiento faltante dentro del alcance autorizado. Nunca pruebes migraciones o fallos contra una base financiera real del usuario.

Compara saldos por cuenta, deuda por tarjeta, patrimonio/disponible, ingreso/gasto/ahorro por periodo y entidades financieras relacionadas. En una refactorización exige igualdad de importes y relaciones; ignora únicamente IDs generados o auditoría ajenos al objetivo, conservando identidad referencial. En un cambio funcional especifica deltas esperados y exige que el resto conserve equivalencia. No basta con comparar el total del dashboard.

Selecciona escenarios según el impacto:

| Escenario | Evidencia esperada |
|---|---|
| Transferencia sin/con impuesto | Origen y destino correctos, acompañantes únicos, impuesto separado, sin ingreso/gasto por el capital transferido |
| Compra y pago de tarjeta | Gasto una vez, deuda por compra completa, cuota solo en extracto, pago sin segundo gasto y sin exceso sobre deuda |
| Edición/eliminación histórica | Reverso completo, nueva cuenta/importe/fecha correctos, acompañantes y vínculos coherentes, sin aplicar dos veces |
| Acciones rápidas | Débito↔crédito con saldo y deuda correctos; repetir la misma selección desde una fila antigua no reaplica impactos; guardar cuotas sin cambios conserva progreso y vencimiento |
| Compromiso y conciliación | Generación/vencimiento sin gasto; vínculo repetido sin duplicación; un gasto incompatible o eliminado reabre la obligación |
| Fallo intermedio/reintento | Rollback de todas las entidades dentro del límite transaccional probado; ninguna garantía inferida fuera de ese límite |
| Compatibilidad | Migración repetida/interrumpida, conservación de filas y FK, datos heredados inválidos preservados |
| Precisión y consultas | Decimales, importes grandes, límites de fecha/estado y orden de acumulación equivalentes; historial completo disponible para cálculos |

Para importes no finitos, prueba `Infinity`, `-Infinity` y `NaN` por cada entrada afectada y exige rechazo antes de cualquier escritura. En fallos intermedios, inspecciona también el estado persistido después del rechazo: puede haber saldos, pagos o deuda confirmados aunque el movimiento o extracto correspondiente no se haya guardado. Distingue las pruebas de caracterización de esos estados parciales de las regresiones que exigen rollback.

`__tests__/helpers/realSQLite.ts` permite SQLite real en memoria y fallos inyectados; requiere Node con `node:sqlite` (las pruebas documentan Node >= 22.13). Las pruebas con repositorios simulados no demuestran atomicidad SQLite. Para una nueva regla financiera, añade pruebas del resultado observable en el alcance de esa tarea; para uso exclusivamente de revisión, propone las pruebas sin modificar archivos.

Ejecuta las suites pertinentes con `npm test -- --runInBand <rutas-de-pruebas>`. Para cambios estructurales, tipos o producción, ejecuta también `npx tsc --noEmit` y los controles exigidos por el proyecto. Amplía a `npm test -- --runInBand` cuando el impacto atraviese módulos. No declares validación de dispositivo ni garantías del driver Android a partir de pruebas Node.

## Discrepancias conocidas y cierre

Recomprueba estas observaciones antes de usarlas como diagnóstico:

- El mapa inicial de `MODULOS_Y_FLUJOS.md` presenta Suscripciones como marcador, pero su sección posterior, `SUSCRIPCIONES.md`, código y pruebas muestran una implementación funcional. `budgets`, `loans`, `goals` y `reports` sí conservan `index.ts` vacíos.
- Los tipos de movimiento enumerados en documentación no acreditan formularios o reglas especializadas. Devoluciones y préstamos no deben presentarse como flujos terminados por existir tipos o tablas. Gastos compartidos y condonaciones tienen dominio y API probados, pero no interfaz.
- El dashboard exige `posted`; tarjetas excluye solo `cancelled`; el impacto manual no filtra estado. Los nombres `isPostedExpense`/`isPostedCreditCardPayment` no expresan sus predicados completos.
- La documentación afirma conservación de fecha en edición; el caso de uso permite reemplazarla explícitamente. La atomicidad de suscripciones y de lotes IA no se extiende automáticamente a flujos manuales.
- Las rutas rápidas de gastos en `TransactionsScreen.tsx` delegan en `updateTransactionQuickly`; el cambio de medio reutiliza `saveManualTransaction` y lee el estado persistido. Sigue siempre sus llamadores y comprueba el efecto de cada acción: delegar en un caso de uso no acredita atomicidad global ni ausencia de otras reglas financieras en la pantalla.

Al cerrar, comunica reglas preservadas, diferencias autorizadas, discrepancias con referencias concretas, pruebas/resultados y riesgos no verificados. Distingue implementación confirmada, comportamiento observado con limitaciones y funcionalidad prevista. No repares discrepancias ni añadas capacidades fuera del encargo.
