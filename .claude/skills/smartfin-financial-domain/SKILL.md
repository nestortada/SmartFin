---
name: smartfin-financial-domain
description: Preserva el comportamiento y la integridad financiera de SmartFin al crear, modificar o revisar movimientos, cuentas, tarjetas, suscripciones, saldos, deuda, patrimonio o su persistencia. Úsala también para refactorizaciones, optimizaciones y migraciones que afecten esos resultados; no para cambios puramente visuales.
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

Los nombres abreviados de módulos en la tabla están bajo `src/modules/`. No sustituyas el conjunto completo de movimientos por las páginas visibles del historial para reconciliar, editar o borrar.

## Reglas observadas que se deben comprobar y preservar

Este mapa describe la implementación revisada el 11 de octubre de 2026. Revalida las condiciones en el código antes de aplicarlo a una versión posterior.

- **Cuentas y patrimonio.** El dashboard incluye únicamente cuentas `active`. Disponible suma `balance.amount` de `cash`, `bankAccount` y `savingsAccount`. Deuda suma `debtBalance.amount` de `creditCard` y `loan`; patrimonio suma los activos anteriores más `investment` y resta esa deuda. El cupo disponible de una tarjeta no es un activo. La existencia del tipo `loan` no implica un módulo de préstamos operativo. Los saldos pueden proceder de valores iniciales o edición directa de cuentas, no solo de movimientos. Cerrar una cuenta cambia su inclusión en métricas sin eliminar su historial.
- **Ingreso y gasto mensual.** El dashboard usa el prefijo `YYYY-MM` de la fecha, estado `posted`, y exclusivamente `income/inflow` o `expense/outflow`; ahorro es ingreso menos gasto. Una compra de crédito publicada cuenta como gasto por su importe completo. `internalTransfer` y `creditCardPayment` no cuentan como ingreso ni gasto. No generalices la clasificación del dashboard a las métricas de cuentas débito, que clasifican entradas y pagos de otra forma.
- **Movimientos manuales.** El flujo aplica el impacto al saldo de cuentas que no son tarjeta y cuyo movimiento no usa `paymentMethod: credit`; una entrada/ingreso aumenta saldo y una salida lo reduce. El gasto de crédito se reconcilia mediante el dominio de tarjetas. No atribuyas a este flujo un filtro universal por `posted`: su función de impacto no comprueba el estado.
- **Transferencias.** Se guardan origen `internalTransfer/outflow`, destino `<id>-in` con `inflow` y contracuentas cruzadas. El impacto de ambos saldos se aplica desde la operación principal, no aplicando otra vez el acompañante. Con cuentas activas compatibles, sin impuesto, disponible y patrimonio se conservan. El gasto opcional `<id>-4x1000` debita el origen y aumenta gasto con `Math.max(1, Math.round(amount * 0.004))`; entonces el patrimonio disminuye por ese impuesto. El filtro por cuenta usa la cuenta propia de cada pata.
- **Tarjetas.** `reconcileCreditCardTransactions` usa gastos `expense/outflow` y pagos `creditCardPayment` **no cancelados**, incluidos `pending`. Deuda es `max(0, compras completas - pagos)`. En el ciclo del extracto, una compra con varias cuotas activas aporta `monthlyAmount`; las cuotas no generan otro gasto realizado. `registerCreditCardPayment` exige tarjeta y cuenta origen activas compatibles, valida importe finito positivo, usa `min(round(amount), deuda)` y exige saldo suficiente. Debita origen, guarda un pago dirigido a la tarjeta y reconcilia; no registra otro gasto. Para cuentas activas incluidas en patrimonio, el pago conserva patrimonio al reducir activo y pasivo por el mismo importe. Intereses simulados y metadatos de cuota de manejo no acreditan cargos reales automáticos.
- **Crédito por clasificar.** `account-credit-card-unclassified` es actualmente una cuenta especial de tipo `bankAccount`. El gasto con medio `credit` no altera su saldo ni la deuda de una tarjeta real. La asociación posterior cambia cuenta y referencias de cuotas y reconcilia la tarjeta. No prometas que el dashboard incorpora esa deuda antes de clasificarla.
- **Suscripciones.** Crear, generar, vencer, pausar, cancelar, proyectar o recordar un compromiso no crea movimientos ni cambia saldo/deuda. Los equivalentes mensual/anual son compromisos, no gasto del periodo. `confirmPayment` vincula un movimiento existente `expense/outflow/posted`, moneda coincidente, importe finito positivo y cuenta compatible si se especificó. No exige igualdad de importe ni fecha: conserva `expectedAmount` y `actualAmount`; las sugerencias no son confirmaciones. Repetir el mismo vínculo es idempotente, y un movimiento no puede vincularse a otra ocurrencia. Registrar un gasto desde Suscripciones utiliza Movimientos y requiere después conciliación explícita.
- **Historial de suscripciones.** Editar un gasto vinculado compatible actualiza importe real y fecha de pago. Eliminarlo o incompatibilizarlo limpia el vínculo y deja el cobro `overdue` si su fecha es anterior a hoy, o `pending` en caso contrario, junto con sus entidades derivadas. Esto es atómico con la escritura/borrado del movimiento en el repositorio. Cambiar el contrato afecta pendientes estrictamente futuros, conservando pagos y obligaciones pasadas; la edición explícita del importe de una ocurrencia es una operación distinta que cambia solo su esperado, incluso si está pagada, sin cambiar gasto real ni contrato.

### Atomicidad implementada: fases 2, 3A, 3A.1 y 3B

El mapa anterior conserva observaciones históricas; contrasta sus límites con el código
vigente y los [informes de atomicidad](../../../docs/atomicidad-financiera-fase3b.md).
La observación histórica de ausencia de gastos compartidos tampoco describe este checkout:
consulta [GASTOS_COMPARTIDOS_Y_FECHAS.md](../../../docs/GASTOS_COMPARTIDOS_Y_FECHAS.md) y
las suites vigentes `sharedExpenses.test.ts`/`sharedForgiveness.test.ts`, conservadas en
esta fase. Su existencia no autoriza cambiar políticas de reparto durante una refactorización.
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

**Devoluciones y gastos compartidos:** `refund` existe en tipos y fixtures, y el dashboard lo excluye de ingreso/gasto; no hay un flujo especializado comprobado para devolución completa/parcial o aplicada a tarjeta. Tampoco se encontró un flujo de gastos compartidos: `transaction_splits` es infraestructura, no evidencia de reparto entre personas. Si el encargo incorpora estos flujos, define con el requisito el pago original, importe devuelto o parte propia, dinero adelantado, dinero efectivamente recibido, vínculo e impacto en saldo/deuda/patrimonio. Pregunta por la política financiera solo cuando no esté definida. No inventes compensación de gastos, cuentas por cobrar, ingreso por reembolso o reparto, ni reutilices un gasto completo y sus partes como gastos adicionales.

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

- El dominio actual usa COP, `number` y SQLite `REAL`; no hay una migración global a unidades menores. Sigue cada parseo, suma, división y redondeo hasta persistencia y presentación.
- Conserva orden de suma y predicados en optimizaciones: sustituir sumas JS por `SUM` SQL o reordenar filas puede cambiar resultados de punto flotante. No ocultes diferencias con tolerancias nuevas en una prueba de equivalencia.
- Revisa decimales, valores grandes, acumulaciones, `NaN`, infinitos y límites seguros. Suscripciones redondea a dos decimales y rechaza importes no finitos o mayores en valor absoluto que `MAX_SAFE_INTEGER / 100`; cuotas, impuesto y pagos de tarjeta usan redondeos a enteros. No unifiques esos tratamientos incidentalmente ni atribuyas esa validación a todo SmartFin.
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
- Los tipos de movimiento enumerados en documentación no acreditan formularios o reglas especializadas. Devoluciones, préstamos y gastos compartidos no deben presentarse como flujos terminados por existir tipos o tablas.
- El dashboard exige `posted`; tarjetas excluye solo `cancelled`; el impacto manual no filtra estado. Los nombres `isPostedExpense`/`isPostedCreditCardPayment` no expresan sus predicados completos.
- La documentación afirma conservación de fecha en edición; el caso de uso permite reemplazarla explícitamente. La atomicidad de suscripciones y de lotes IA no se extiende automáticamente a flujos manuales.
- Las rutas rápidas de gastos en `TransactionsScreen.tsx` delegan en `updateTransactionQuickly`; el cambio de medio reutiliza `saveManualTransaction` y lee el estado persistido. Sigue siempre sus llamadores y comprueba el efecto de cada acción: delegar en un caso de uso no acredita atomicidad global ni ausencia de otras reglas financieras en la pantalla.

Al cerrar, comunica reglas preservadas, diferencias autorizadas, discrepancias con referencias concretas, pruebas/resultados y riesgos no verificados. Distingue implementación confirmada, comportamiento observado con limitaciones y funcionalidad prevista. No repares discrepancias ni añadas capacidades fuera del encargo.
