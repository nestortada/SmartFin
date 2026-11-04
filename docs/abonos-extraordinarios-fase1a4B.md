# Fase 1a.4B: abonos extraordinarios «No sé», imputaciones y reversiones seguras

2 de noviembre de 2026. Rama `main`, commit base `ece07ab` («fase 1a 4A»), árbol limpio al empezar. Sin commit ni
push. Implementación **completa** (sin división 1a.4B.1/1a.4B.2). Caso de uso **interno**: no se exporta desde
`index.ts` ni se conecta a pantallas, hooks ni comandos de IA. Validación Android **no ejecutada** (sección 15).

## 1. Estado inicial

- `ece07ab` contiene la 1a.4A con su validación Android r2 aprobada (API 24 y API 35: 355/355 casos, 198 puntos de fallo
  por dispositivo, 41.994 hojas iguales a Node). Es solo la línea base histórica: ese APK no contiene este código.
- El repositorio de historial (`sqliteInstallmentHistoryRepository`) no tenía llamadores de imputación ni reversión.

## 2. Reproducción del comportamiento anterior (datos sintéticos)

Sonda sobre una base sintética (compra 600.000 × 6, pago ordinario de 100.000, imputación activa insertada a mano):

| # | Comprobación | Resultado antes del cambio |
|---|---|---|
| 1–3 | Pago ordinario | Un movimiento `creditCardPayment`; banco 1.000.000 → 900.000; deuda 600.000 → 500.000 (derivada de movimientos); patrimonio igual |
| 4 | Compra a cuotas | Fila de `installment_purchases` ligada por `transaction_id`; revisión 0 desde 1a.4A |
| 5 | Editar importe del pago imputado | **Bloqueado** por trigger («reviértelas antes de modificarlo»): el usuario no podía corregir un pago legítimo |
| 5 | Editar la **fecha** del pago imputado | **Permitido sin revertir** (la guarda SQLite no vigila la fecha): imputación activa sobre un pago cambiado |
| 6 | Borrar el pago imputado | **Bloqueado** por trigger |
| 7 | Compra imputada: 6 → 3 cuotas | **Permitido**: `purchaseEdit` con la imputación activa (dejaba de contar en el capital) |
| 7 | Compra imputada: a débito, a 1 cuota, borrar, cascada directa | Bloqueado por el trigger de borrado de compras (error técnico, con rollback) |
| 7 | Compra imputada: cambiar `account_id` (otra tarjeta) | **Permitido**: imputación ligada a un pago de otra tarjeta |
| 8 | Compra sin revisión 0 | Una revisión `allocation` era imposible (la secuencia exige empezar por `original`) |
| 10 | Importes | Pago parcial en pesos enteros: `Math.round(amount)`; 0,40 rechazado; **1,6 se redondeaba a 2** |
| 11–12 | Rutas destructivas y cascadas | Ver matrices de las secciones 11 y 12 |

Conclusión: ningún bloqueo exige cambiar esquema, migración ni triggers. Todos los huecos se cierran en casos de uso,
por lo que se implementó la fase completa.

## 3. Decisión

Implementación completa. Las imputaciones solo se crean desde un caso de uso interno, y todas las rutas de edición y
borrado de pagos y compras cumplen D6 o rechazan la operación antes de escribir.

## 4. Diseño del caso de uso

`src/modules/creditCards/useCases/extraordinaryInstallmentPayment.ts`:

- `registerExtraordinaryInstallmentPayment({ cardAccountId, installmentPurchaseId, sourceAccountId, paymentAmount,
  allocatedAmount, mode: 'unspecified', commandId, currentDate })`: pago y su imputación en **una** transacción.
- `allocateCreditCardPaymentToPurchase(...)`: imputa un pago existente con su propio comando, sin mover dinero (escenario
  C y futura reimputación explícita de 1a.5).

Flujo (un `BEGIN`/`COMMIT`, ámbito `withCreditCardPaymentScope`, sin transacciones anidadas):

1. Validación previa sin escrituras: comando, modalidad, `paymentAmount` entero ≥ 1, `allocatedAmount` exacto en
   centavos (≤ 2 decimales) y ≤ pago.
2. Repetición: si el comando ya existe, se compara y se devuelve `replayed` sin escribir (sección 15).
3. Elegibilidad de la compra antes de escribir: existe en esa tarjeta, no `paid`/`cancelled`, misma moneda, movimiento
   original vigente y a crédito.
4. Pago ordinario (`registerCreditCardPaymentInScope`, la regla contable vigente) con identidad
   `tx-credit-card-payment-<tarjeta>-command-<comando>`. Si la regla lo recortaría a la deuda, se rechaza: el abono nunca
   se reduce en silencio.
5. Revisión 0 perezosa si falta (sección 9), estimación del capital (sección 5), imputación (`saveAllocations`) y
   revisión `allocation` (`appendPlanRevision`).

Resultado: importe pagado, destinado, imputado, excedente general y capital estimado antes/después, en centavos.

## 5. Límite por capital pendiente estimado

`installmentAllocationLedger.estimatePendingPrincipal(historial, imputaciones)` (puro, centavos enteros):

- **Ancla**: la última revisión de la encarnación vigente que fija el capital por sí misma: `original`, `purchaseEdit`
  (su capital es el nuevo total heredado convertido con `toExactCopCents`) o cualquier revisión `confirmed`.
- Se restan las imputaciones **activas** registradas después del ancla; las anteriores a un ancla confirmada ya están
  reflejadas en ella.
- Indeterminado (rechazo controlado, nunca un límite inventado): sin historial, compra eliminada, capital `NULL`
  (importe inexacto), revisión pendiente de ajuste por extracto, extracto sin confirmar posterior al ancla, imputación
  activa sin su revisión o resultado negativo.
- No usa `monthly_amount` ni `installment_amount_cents` (su significado difiere entre revisiones migradas y nuevas).

`importeImputado = min(importeDestinado, capitalPendienteEstimado)`; capital 0 ⇒ la compra se rechaza como destino.

## 6. Excedentes generales

El pago conserva su importe completo y reduce la deuda una sola vez (deuda = Σ compras − Σ pagos). La diferencia
`pago − imputado` queda como abono general (`unallocatedPaymentCents`); nunca se asigna a otra compra ni genera
imputaciones adicionales. No se introduce R9.

## 7. Capital estimado cero

La revisión `allocation` guarda `remaining_principal_cents = 0` con `pendingVerification` y motivos
`allocationUnconfirmed,estimatedPrincipalZero`. `installment_purchases.status`, `paid_installments`, calendario y
extractos no cambian. La migración 5 representa el caso sin ambigüedad con esos campos; no hizo falta un estado nuevo.

## 8. Cardinalidad

Un pago tiene como máximo una imputación activa (comprobado en el caso de uso; el esquema admitiría más). Un segundo
intento se rechaza sin escrituras; también se comprueba el límite general Σ activas ≤ pago. Una imputación revertida
queda como historial y no se reactiva; reimputar exige un comando nuevo.

## 9. Inicialización perezosa y procedencia

`ensureInitialInstallmentRevision` (en `initialInstallmentRevision.ts`), solo dentro del participante de la
imputación y solo para la compra imputada (nunca masiva):

- Historial vigente existente ⇒ se devuelve sin escribir (y su validez la decide la estimación, sin reparar nada).
- Sin historial, o encarnación terminada por `purchaseRemoval` ⇒ revisión 0 con el motor 1a.1 (capital exacto o `NULL`,
  cuotas), siempre `pendingVerification` y motivo `lazyInitialRevision`; `created_at` = momento de la imputación.
- No inventa movimientos, confirmaciones ni `paid_installments`.

Procedencia distinguible:

| Origen | Rasgos |
|---|---|
| Alta (1a.4A) | `original`; `projected`/`confirmed`/`pendingVerification` según el motor; `created_at` del movimiento; base D2 |
| Migración 5 | `original`; siempre `pendingVerification` + `firstCycleUnconfirmed`; ciclo `NULL`; cuota heredada |
| Perezosa (1a.4B) | `original`; siempre `pendingVerification` + **`lazyInitialRevision`**; `created_at` de la imputación |

Limitación: la migración 5 no tiene un campo de procedencia; alta y migración solo se distinguen por sus rasgos. La
perezosa sí queda marcada. `pending_reasons` es texto sin `CHECK` de valores: los cuatro motivos nuevos
(`allocationUnconfirmed`, `estimatedPrincipalZero`, `statementAdjustmentRequired`, `lazyInitialRevision`) no cambian
el esquema.

## 10. Reversiones D6

`installmentAllocationReversal.reverseActivePaymentAllocations`, en la transacción de la edición o borrado y antes de
tocar el pago: cada imputación activa pasa a `reversed` (`reverseAllocation`, única actualización admitida) y se añade
una revisión `allocationReversal`, **siempre** `pendingVerification`. Luego la edición o el borrado; un `COMMIT`.
Ningún movimiento financiero adicional y ninguna reimputación.

| Caso | Revisión correctiva |
|---|---|
| Sin revisión confirmada posterior, sin otras imputaciones | Restaura capital y proyección del ancla (cuotas, cuota base, ciclo); motivos `allocationReversed` + los del ancla |
| Sin confirmada posterior, con otras imputaciones activas | Capital = ancla − imputaciones restantes; cuota y ciclo `NULL`; `allocationReversed,allocationUnconfirmed` |
| Con revisión **confirmada** posterior | Parte de la última confirmada (capital, cuotas, cuota, ciclo); `allocationReversed,statementAdjustmentRequired`; no restaura el plan previo; la confirmada no se toca |
| Estimación indeterminada | Valores `NULL`; `allocationReversed` + `manualReview` o `statementAdjustmentRequired`. La reversión nunca se bloquea |

Tras `statementAdjustmentRequired` no se admiten nuevas imputaciones a esa compra hasta que un extracto ajuste el plan.

## 11. Matriz de rutas que afectan pagos

| Ruta | Tablas | Triggers | Cascadas | ¿Imputación activa bloquea? | Reversión explícita | D5/D6 |
|---|---|---|---|---|---|---|
| `saveManualTransaction` edición de importe | accounts, transactions, statements | guarda de pago (importe) | No | Ya no: se revierte antes | Sí | Cumple |
| Ídem cuenta origen | ídem | guarda (cuenta) | No | Ya no | Sí | Cumple |
| Ídem tarjeta destino | ídem | guarda (destino) | No | Ya no | Sí | Cumple |
| Ídem fecha | ídem | Ninguna guarda | No | Nunca bloqueó | Sí (antes no) | Cumple |
| Ídem tipo, estado, dirección, moneda | ídem | guarda | No | Ya no | Sí | Cumple |
| Ídem solo descripción/comercio/notas | transactions | Ninguna | No | No | **No**: no es edición financiera, la imputación sigue activa | Cumple |
| `deleteManualTransactionSafely` (pantalla, `createSharedExpenseApi.deleteMovement`) | accounts, transactions e hijas, statements | guarda de borrado | Hijas por `transaction_id` | Ya no | Sí | Cumple |
| `executeAiCommandPlan` | Solo `income`/`expense`/`internalTransfer` | — | — | No alcanza pagos | — | — |
| `updateTransactionQuickly` | Solo `expense` | — | — | No alcanza pagos | — | — |
| Cambio de categoría (`sqliteCategoryRepository`, `updateTransactionCategory`) | transactions.category_id | Ninguna | No | No | No (no financiero) | Cumple |
| Borrado financiero total | Todas | — | — | No (borra historial a propósito, primero las tablas nuevas) | No aplica | Excepción documentada en 1a.3B |

Ninguna ruta reimputa automáticamente.

## 12. Matriz de rutas que afectan la compra o su movimiento original

| Ruta | ¿Cascada? | Con imputación activa | Historial | Imputaciones |
|---|---|---|---|---|
| Borrar movimiento original (caso de uso) | `DELETE installment_purchases` explícito | **Rechazo controlado** (`ActiveInstallmentAllocationError`) antes de escribir | Intacto | Intactas |
| `DELETE transactions` directo | `ON DELETE CASCADE` | Abortado por `installment_allocations_guard_purchase_delete` (la acción FK dispara el trigger) | Intacto | Intactas |
| Editar importe, cuotas, tarjeta o fecha (formulario o IA) | No (UPDATE en sitio) | Rechazo controlado antes de `saveInstallmentPurchases` (antes: permitido con `purchaseEdit`) | Intacto | Intactas |
| A una cuota (formulario o acción rápida) | Borra el plan | Rechazo controlado (antes: error de trigger) | Intacto | Intactas |
| A débito (formulario o acción rápida) | Borra el plan | Rechazo controlado | Intacto | Intactas |
| Recategorizar | No | Permitido (no destructivo) | Sin revisión | Intactas |
| Solo nombre/comercio | No | Permitido | Sin revisión | Intactas |
| Reasignar desde «Tarjeta por clasificar» (`associatePendingTransactionsForCreditCard`) | UPDATE de `account_id` | Rechazo controlado (antes: permitido) | Intacto | Intactas |
| Recrear compra (cuotas → 1 → cuotas) | Nueva encarnación | Imposible con imputación activa (el paso a 1 cuota se rechaza) | — | — |
| Cerrar tarjeta (`deleteCreditCard`) | Cierre lógico | Bloqueado si hay cuotas vigentes (regla previa) | Intacto | Intactas |
| `DELETE installment_purchases` directo | — | Abortado por trigger | Intacto | Intactas |

Sin imputaciones activas, todas las rutas conservan su comportamiento y su número de escrituras (las suites históricas
lo comprueban). Tras revertir la imputación (editando o borrando el pago), la compra admite de nuevo esas operaciones.

## 13. Cambios realizados

| Archivo | Cambio |
|---|---|
| `src/modules/creditCards/useCases/extraordinaryInstallmentPayment.ts` (nuevo) | Casos de uso internos de abono e imputación |
| `src/modules/creditCards/useCases/installmentAllocationLedger.ts` (nuevo) | Estimación pura y revisiones `allocation`/`allocationReversal` |
| `src/modules/creditCards/useCases/installmentAllocationReversal.ts` (nuevo) | Reversión D6 y guarda de compras con imputación activa |
| `src/modules/creditCards/useCases/initialInstallmentRevision.ts` | `ensureInitialInstallmentRevision` y `asLazyInitialRevision` |
| `src/modules/creditCards/useCases/creditCardTransactionRelations.ts` | `registerCreditCardPaymentInScope` exportado (interno) con `transactionId` opcional; guarda en la reasignación |
| `src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository.ts` | `reverseAllocation` y `hasActiveAllocationsForPurchaseTransaction` |
| `src/modules/creditCards/types/InstallmentHistory.ts` | Cuatro motivos nuevos |
| `src/modules/transactions/useCases/saveManualTransaction.ts` | Reversión al editar (campos financieros) o borrar un pago; guarda de compras imputadas |
| `__tests__/extraordinaryInstallmentPaymentPhase1a4B.test.ts` (nuevo) | 45 pruebas |
| `__tests__/installmentHistoryPhase1a3B.test.ts`, `phase1a3bAndroidEquivalence`, `phase1a4aAndroidEquivalence` | Neutralizan solo los pasos 1a.4B (sección 17) |
| Este informe, `INDICE.md`, `BASE_DE_DATOS.md` | Documentación |

Sin cambios de esquema, migraciones, triggers, tablas, columnas, reglas de pagos ordinarios, hooks de UI, guards de
comandos ni `com.smartfin`. `index.ts` del módulo sin cambios.

## 14. Invariantes financieros

- Mismo flujo con pago ordinario y con abono extraordinario: todas las tablas iguales (salvo identidades del pago y las
  tablas de historial) y mismas métricas (saldos, deuda, cupo, patrimonio, ingresos, gastos); el contador de respaldo
  difiere exactamente en 2 (imputación + revisión).
- Borrar un abono imputado devuelve exactamente las métricas previas al abono; la imputación queda `reversed`.
- Ningún cambio de `installment_purchases` (incluido `paid_installments` y `status`) ni de extractos históricos por
  imputar o revertir. Capital original intacto. Integridad referencial y `integrity_check` correctos.

## 15. Atomicidad, recuperación e idempotencia

- Un `BEGIN`/`COMMIT` por operación. Fallo antes y después de cada escritura (alta con revisión perezosa: 13 escrituras;
  edición: 10; borrado: 26): rollback confirmado y estado completo idéntico (todas las tablas, contador, integridad).
- `COMMIT` antes/después: `unknown`, conexión retirada, un solo intento. Reapertura del archivo: todo o nada; repetir
  deliberadamente el mismo comando da `replayed` si se confirmó, o lo registra una sola vez si no.
- Idempotencia durable por `command_id` (no solo en memoria): repetición idéntica sin escrituras; contenido distinto
  rechazado; comando con importe recortado reconocido (revisión con capital 0); imputación revertida informada y nunca
  reactivada; mismo objeto de petición concurrente ejecutado una vez.
- Limitación: el importe destinado original no se guarda; dos peticiones distintas que el capital recortó al mismo
  importe se consideran iguales (producen exactamente las mismas escrituras).

## 16. Resultados

Ver sección 20.

## 17. Efectos sobre las campañas Android anteriores

- La sonda 1a.3B/1a.4A `activeAllocationGuards` exige que borrar un pago con imputación activa por el caso de uso quede
  bloqueado. D6 cambia ese contrato a propósito: ahora se revierte y se borra. Es la única diferencia funcional.
- Las suites históricas (`phase1a3bAndroidEquivalence`, `phase1a4aAndroidEquivalence`, `installmentHistoryPhase1a3B`)
  neutralizan solo `reverseActivePaymentAllocations` y `requireNoActiveInstallmentAllocations` y siguen reproduciendo
  **exactamente** sus referencias; ninguna referencia ni oráculo se modificó. Los flujos v4 de 1a.3B también necesitan
  esa neutralización (las guardas leen tablas de la migración 5; en producción la app siempre migra al abrir).
- Sin imputaciones activas, alta, edición y borrado escriben lo mismo que en 1a.4A (las lecturas nuevas no son puntos de
  fallo). El APK de 1a.4A **no** valida este código.

## 18. Plan de validación Android (no ejecutado)

Requiere autorización específica para compilar, instalar y ejecutar. Propuesta de campaña `phase1a4b-*` en API 24 y
API 35, con oráculo Node propio y comparación estricta:

| Campaña | Contenido | Puntos de fallo |
|---|---|---|
| `phase1a4b-register` | Abono simple, dos abonos, excedente, capital cero, centavos, inelegibles, importes pequeños | 12 escrituras × 2 = 24 |
| `phase1a4b-lazy` | Plan sin revisión 0 (paso de alta neutralizado al prepararlo) | 13 × 2 = 26 |
| `phase1a4b-reversal` | Edición de importe, cuenta, tarjeta, fecha; borrado; posterior pendiente y confirmada | edición 10 × 2 = 20; borrado 26 × 2 = 52 |
| `phase1a4b-guards` | Compra imputada: borrar, débito, 1 cuota, cuotas, importe, tarjeta, fecha, reasignación, cascada directa | 0 (rechazos sin escrituras) |
| `phase1a4b-recovery` | `COMMIT` antes/después, reapertura y repetición del comando | 2 por flujo |
| Regresiones | 1a.4A r2, 1a.3A, 1a.3B, 1a.2 y 6B.3 con los pasos 1a.4B neutralizados; `activeAllocationGuards` derivada con el contrato D6 | Los 198 actuales |

Total nuevo estimado: 122 puntos de fallo por dispositivo más los de `COMMIT`, además de los 198 vigentes.

## 19. Riesgos y decisiones pendientes

1. Edición no financiera de un pago (descripción, comercio, notas, categoría) **no** revierte: interpretación de «edición
   real». Confirmar con el propietario.
2. Reversión con revisión confirmada posterior: el capital parte de la confirmada; la compra queda sin imputaciones
   nuevas hasta un ajuste por extracto (no existe todavía esa ruta).
3. Un ancla `purchaseEdit` toma el capital del nuevo total heredado; con imputación activa ese cambio ya no es posible.
4. Motivos nuevos en `pending_reasons`: una app anterior que leyera esas revisiones las rechazaría (hoy ninguna pantalla
   las lee).
5. El abono usa la regla de pago parcial: pesos enteros y ≤ deuda; no hay abono con centavos.
6. Suites históricas validan el código sin los pasos 1a.4B; la suite 1a.4B cubre el comportamiento completo.
7. Sin evidencia de dispositivo.

## 20. Resultados de verificación y siguiente etapa

| Verificación | Resultado |
|---|---|
| `extraordinaryInstallmentPaymentPhase1a4B` | 46/46 (perezosa, procedencia, límite, excedente, cero, cardinalidad, D6 E1/E2, compras, idempotencia, atomicidad, `unknown`, equivalencia sin imputaciones, exposición) |
| Migración 5, 1a.4A, equivalencias 1a.3A/1a.3B/1a.4A, extractos 1a.2, atomicidad | Verdes; referencias históricas sin modificar |
| `npm test -- --runInBand` | **89 suites aprobadas, 7 omitidas; 1.347 pruebas aprobadas, 14 omitidas, 0 fallos**; 8/8 snapshots (ejecución con la suite 1a.4B en 45 pruebas; la prueba 46 y un ajuste de formato posteriores se verificaron con la suite aislada) |
| `npm run test:reproductions -- --runInBand` | 6 suites, 29/29 |
| `npx tsc --noEmit` | Sin errores |
| `npm run lint` | 0 errores; las 5 advertencias previas |
| `git diff --check` | Limpio |

Siguiente etapa (no iniciada): validación Android 1a.4B con autorización (sección 18); después, 1a.5 (interfaz que
comunique la reversión y la ausencia de reimputación automática). No se avanzó a 1a.5.

## 21. Revisión final y preparación Android (2 de noviembre de 2026)

### 21.1 Decisiones aprobadas

| Decisión | Resultado |
|---|---|
| A. Ediciones descriptivas | Descripción, comercio, notas y categoría no revierten. Hoy ninguna categoría cambia el tratamiento contable de un pago (dashboard, extractos, presupuestos e informes no la leen), así que todas son etiquetas; si una futura categoría lo hiciera, debe añadirse a `PAYMENT_FINANCIAL_FIELDS`. Importe, cuentas, fecha, tipo, dirección, estado, moneda y forma de pago revierten. Edición mixta ⇒ D6. Las rutas de categoría fuera del formulario (`updateTransactionCategory`, `deleteCategoryAndReassign`) solo reetiquetan. No existe otra ruta que modifique un pago: `saveTransactions` solo la llaman el pago, el formulario, la reasignación de compras a crédito, la acción rápida (solo gastos) y el reembolso compartido (alta nueva) |
| B. Motivos nuevos | Se guardan como texto ordenado en `pending_reasons` (sin cambio de esquema), el repositorio los lee igual, siempre con `pendingVerification`, el historial es de solo inserción y las ediciones descriptivas no lo tocan; las revisiones `allocation` no fijan cuota ni ciclo. Compatibilidad: una versión anterior que leyera esas filas con su repositorio lanzaría «SQLite devolvió un valor inválido para pending_reasons» (fallo visible, sin corrupción); hoy ninguna pantalla las lee |
| C. Bloqueo tras revisión confirmada | Cambio de producción indispensable: `requireAllocatablePrincipal` evalúa, solo con lecturas, el capital estimado **antes** del pago y de la revisión 0 perezosa. El intento posterior se rechaza con 0 escrituras por las dos entradas (abono nuevo y pago existente); también capital cero e inexacto. La confirmada queda intacta, la correctiva parte de ella con `statementAdjustmentRequired` y la imputación queda `reversed` |

### 21.2 Idempotencia tras edición, borrado y reinicio

El `command_id` vive en `installment_allocations` (sin FK, nunca borrada salvo el borrado financiero total) y el id del
pago se deriva de tarjeta + comando. Secuencia comprobada (Jest y sonda `phase1a4b-idempotency`/`-unknown-restart`):
crear → repetir (0 escrituras) → editar (revierte) → repetir (`replayed`, `reversed`, 0 escrituras) → borrar → repetir
(sin recrear el pago, 0 escrituras) → reiniciar SQLite → repetir (igual). Datos distintos verificables (compra,
tarjeta, modalidad, importe imputado) se rechazan. **Incompatibilidad documentada, sin cambiar el modelo**: tras editar o
borrar el pago, su importe y cuenta origen originales ya no se conservan en ninguna columna; un comando repetido con esos
datos cambiados no puede distinguirse y se responde desde la evidencia, siempre sin escribir. No permite duplicar dinero.
El borrado financiero total elimina también la evidencia del comando (operación explícita de borrado completo).

### 21.3 Cambios de esta revisión

| Archivo | Cambio |
|---|---|
| `extraordinaryInstallmentPayment.ts` | Decisión C: comprobación previa de solo lectura (única modificación de producción) |
| `__tests__/extraordinaryInstallmentPaymentPhase1a4B.test.ts` | 17 pruebas nuevas (63 en total): matriz A, motivos B, decisión C, rechazos sin escrituras, secuencia 1–8 con reinicio |
| `scripts/phase1a4b/` | Sondas, arnés, derivación 1a.3B, inventario, preparación, runner, `run-all`, identidad del APK |
| `__tests__/phase1a4bAndroidEquivalence.test.ts` | Oráculo con la lógica real (10 pruebas) |
| `docs/validacion-fase1a4b/` | README, referencia Node e inventario |

### 21.4 Resultados

| Verificación | Resultado |
|---|---|
| `npm test -- --runInBand` | **90 suites aprobadas, 7 omitidas; 1.374 pruebas aprobadas, 14 omitidas, 0 fallos**; 8/8 snapshots. Incluye las 63 de 1a.4B y las 10 de equivalencia. Omitidas: las 7 suites de rendimiento/diagnóstico condicionadas por variables de entorno (igual que la línea base). Sin fallos intermitentes en esta ejecución |
| `npm run test:reproductions -- --runInBand` | 6 suites, 29/29 |
| `npx tsc --noEmit` / `npm run lint` / `git diff --check` | Sin errores / 0 errores, 5 advertencias previas / limpio |
| Evidencias `docs/` | Hashes de todos los `.json`/`.log` idénticos antes y después de la ejecución completa |

Puntos de fallo reales nuevos: 18 + 19 + 13 + 29 = 79 escrituras ⇒ **158** por dispositivo (la estimación de ~122 venía
de un fixture con una tarjeta); total con regresiones **356**, en **502** casos. Detalle, workspace (`C:/sf-1a4b-20261102`),
atestación `5cbf8940…` y comandos: [validacion-fase1a4b/README.md](validacion-fase1a4b/README.md).
