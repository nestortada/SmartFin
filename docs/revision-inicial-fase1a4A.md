# Fase 1a.4A: revisión inicial de nuevas compras a cuotas

2 de noviembre de 2026. Rama `main`, commit base `a73a6ad` («Fase 1a3B»), árbol limpio al empezar. Sin commit ni
push. Validación Android **preparada, no ejecutada** ([validacion-fase1a4a](validacion-fase1a4a/README.md)). La sección 15
recoge la corrección de las ocho regresiones de equivalencia y la preparación final.

## 1. Estado inicial

- `a73a6ad` contiene la migración 5 (1a.3B) con la corrección de fechas civiles y la validación r5: 289/289 en API 24
  y API 35, 170 puntos de fallo por dispositivo, 28.564 hojas iguales a Node. Es la línea base; no valida este código.
- `saveTransactionInstallments` (`src/modules/transactions/useCases/saveManualTransaction.ts`) guarda el plan con
  `saveInstallmentPurchases` dentro del participante de `withManualTransactionScope`; no escribía historial.
- `sqliteInstallmentHistoryRepository.appendPlanRevision` existía sin llamadores de producción.

## 2. Defecto reproducido

Misma secuencia sobre una base sintética: compra creada en v4 y migrada; compra nueva creada ya en v5; ambas pasan de
3 a 6 cuotas. Estado de `installment_plan_revisions` **antes** del cambio:

| Compra | Revisiones |
|---|---|
| Migrada (v4) | `0 original pendingVerification firstCycleUnconfirmed` · `1 purchaseEdit termsChanged` |
| Nueva (v5) | **ninguna**: el cambio 3 → 6 no dejó rastro (el trigger `purchaseEdit` solo actúa si hay historial) |

Movimientos, saldos y planes iguales en ambas; `paid_installments` 0. Después del cambio la compra nueva tiene
`0 original` + `1 purchaseEdit`, igual que la migrada. La suite nueva falla 17/21 contra el código anterior.

## 3. Causa raíz

La migración 5 crea la revisión 0 solo de las compras existentes al migrar (riesgo 1 del informe 1a.3B). El alta
posterior no llamaba a `appendPlanRevision`, de modo que las compras nuevas quedaban sin historial: sus cambios de
condiciones y su eliminación no se registraban, y una recreación no abría una encarnación nueva.

## 4. Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/modules/creditCards/useCases/initialInstallmentRevision.ts` (nuevo) | `buildInitialInstallmentRevision` (puro, motor 1a.1) y `recordInitialInstallmentRevision` (idempotente, exige participante) |
| `src/modules/transactions/useCases/saveManualTransaction.ts` | `saveTransactionInstallments` registra la revisión 0 cuando crea la fila del plan |
| `src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository.ts` | `appendPlanRevision` rechaza una segunda `original` en la misma encarnación |
| `src/modules/creditCards/types/InstallmentHistory.ts` | Motivo `zeroCentInstallments` (condición `requiresDecision` del motor) |
| `__tests__/initialInstallmentRevisionPhase1a4A.test.ts` (nuevo) | 21 pruebas |
| `__tests__/installmentHistoryPhase1a3B.test.ts`, `__tests__/civilDateCheckPhase1a3B.test.ts` | Ajustadas: suponían compras nuevas sin revisión 0 (sección 7) |
| `docs/validacion-fase1a4a/README.md` (nuevo), este informe, `INDICE.md`, `BASE_DE_DATOS.md` | Documentación |

Sin cambios de esquema, migraciones, triggers, tablas de imputaciones, reglas contables, hooks, guards ni `com.smartfin`.

## 5. Nuevo flujo de la revisión 0

`saveTransactionInstallments`, tras `saveInstallmentPurchases` y solo si no existía plan para el movimiento (alta
nueva o recreación tras 1 cuota/débito), llama a `recordInitialInstallmentRevision` con la fecha civil del movimiento
(`transactionDateKey`, la misma que usan los extractos) y el reloj de dominio (`transaction.updatedAt`):

1. Obtiene la conexión del repositorio de tarjetas; sin SQLite (dobles en memoria) no hace nada. Fuera de un
   participante **lanza error**: la revisión nunca se escribe en una transacción distinta de la compra.
2. Si la última revisión existe y no es `purchaseRemoval`, la devuelve sin escribir (idempotencia; compras migradas).
3. Lee el día de corte (metadatos de la tarjeta), la política de compra el día del corte
   (`credit_card_billing_rules`) y la confirmación del primer ciclo (`installment_first_cycles`).
4. `buildInstallmentPlan` (1a.1) con el importe guardado como `storedAmount` y `appendPlanRevision` (`source =
   original`, número siguiente, id `<compra>:revision:<n>`, contrato de la migración 5).

Contenido:

| Columna | Valor |
|---|---|
| `remaining_principal_cents` | Capital exacto en centavos; `NULL` si el importe no equivale a dos decimales (sin redondeo) |
| `remaining_installments` | Número de cuotas; `NULL` si es inválido (> 360) |
| `installment_amount_cents` | Cuota base D2 (cuotas 1…n−1); la última absorbe `capital mod n`. **No** es el `monthly_amount` heredado, que se redondea a pesos |
| `effective_cycle_end` | Ciclo de la cuota 1 solo si el motor lo determina (corte configurado o confirmación); si no, `NULL` |
| `verification` | `confirmed` solo con confirmación explícita; `projected` si el calendario es completo con las reglas; en otro caso `pendingVerification` |
| `pending_reasons` | `firstCycleUnconfirmed` (sin corte, día de corte sin política, confirmación incoherente), `inexactHistoricalAmount`, `invalidInstallmentCount`, `invalidPrincipal`, `zeroCentInstallments` (`requiresDecision`), `manualReview` (fecha o id inválidos) |
| `basis_*` | Valores heredados sin tocar: `total_amount`, `monthly_amount`, `installment_count` |

El esquema no tiene `requiresDecision`: se conserva como `pendingVerification` + `zeroCentInstallments`, nunca como
proyección o confirmación. `paid_installments` no se lee ni se modifica; una cuota programada no es una cuota pagada.

## 6. Ediciones y eliminaciones

| Escenario | Historial |
|---|---|
| Alta a 3 cuotas | `0 original` |
| Solo descripción (incluso repetida) | Sin revisión nueva; `rowid`, `id` y `created_at` conservados |
| 3 → 6 cuotas | `+ purchaseEdit termsChanged` (trigger, semántica intacta); la revisión 0 no se reescribe |
| A 1 cuota o a débito | `+ purchaseRemoval` (trigger) |
| Vuelta a cuotas (mismo id) | `+ original` nueva con sus propias condiciones: nada heredado |
| Eliminar la compra | `+ purchaseRemoval`; el flujo de borrado no cambia (22 escrituras) |
| Acción rápida de cuotas | Igual que el alta/recreación cuando crea el plan; nada si ya existe |

## 7. Pruebas

Suite nueva `initialInstallmentRevisionPhase1a4A` (21): alta, centavos, inexactos, cuotas de $0 y 400 cuotas, sin
corte, día de corte con y sin política, proyectado, confirmado (puro y persistido), pendiente, ediciones, eliminación,
recreación, acción rápida, repetición, rechazo fuera de transacción, invariantes, fallos inyectados, `COMMIT`
`unknown` con reapertura del archivo, reapertura de SQLite y migración v4 → v5.

Ajustes de pruebas existentes (comportamiento nuevo intencionado, sin relajar criterios):

- `installmentHistoryPhase1a3B` «a recreated purchase…»: la recreación ya trae su `original` (revisión 2) creada por el
  flujo; la regla «tras una eliminación solo se admite `original`» se sigue comprobando con una fila recreada fuera del
  caso de uso.
- `civilDateCheckPhase1a3B`: la sonda inserta a mano la revisión 0; ahora borra antes la creada por el alta.

Resultados: sección 13.

## 8. Atomicidad y recuperación

- Un único `BEGIN`/`COMMIT`; la revisión es la escritura inmediatamente posterior al plan, en el mismo participante
  (`runSQLiteTransaction` se une al propietario: sin transacciones anidadas).
- Fallo antes y después de cada una de las 7 escrituras del alta (14 casos): rollback confirmado, estado completo
  (todas las tablas, contador de respaldo, integridad) idéntico al previo.
- Fallo en la revisión: sin compra ni movimiento. Fallo en la compra: la revisión nunca se intenta.
- `COMMIT` antes/después: `unknown`, conexión retirada, sin reintento (un único `INSERT` de revisión). Reapertura
  forense del archivo: 0 compras/0 revisiones o 1 compra con su única revisión 0; `integrity_check` correcto.
- Repetir `recordInitialInstallmentRevision` no escribe; el repositorio rechaza una segunda `original` vigente.

## 9. Invariantes financieros

Mismo flujo (dos altas, renombrar, 3 → 6, pago, a 1 cuota, recreación, borrar pago, borrar compra) en registros de
módulos aislados con y sin la revisión 0, mismo reloj y secuencia de ids: tras cada paso son idénticos saldos, deuda,
cupo disponible, patrimonio, ingresos, gastos, ahorro, movimientos, extractos, planes (incluido `paid_installments`),
integridad y **todas** las tablas salvo `installment_plan_revisions` y `financial_data_revision`, cuya diferencia es
exactamente el número de filas de historial. Las demás escrituras SQL son las mismas, en el mismo orden y con los
mismos valores; solo se añaden 3 `INSERT` de revisión (dos altas y una recreación).

## 10. Compatibilidad con la migración 5

Compras migradas: una sola revisión 0, también tras ediciones ordinarias y nuevas ejecuciones de la migración.
Compras nuevas: su propia revisión 0. `rowid` e ids conservados, versiones `[1…5]`, sin migración 6, tablas de
imputaciones vacías y sin cambios. Las 30 fallas de migración de 1a.3B dan exactamente su referencia Node.

## 11. Impacto Android

Ver [validacion-fase1a4a](validacion-fase1a4a/README.md): alta y recreación pasan de 6 a 7 escrituras (+2 puntos de
fallo cada una); 1a.3A cambia solo el contador de respaldo (21 hojas); 1a.3B cambia el contador en arranque/upgrade/flujos
y sus 10 sondas de integridad deben rediseñarse; 6B.3, 1a.2 y 6A sin cambios en Node. No se recompiló ni ejecutó nada.

## 12. Riesgos pendientes

1. **Compras creadas con el código 1a.3B tras la migración 5** (si alguna instalación lo ejecutó): siguen sin revisión 0
   hasta que se recreen. Crearla al editarlas exigiría leer el historial en cada edición; se recomienda crearla de forma
   perezosa antes de la primera imputación (1a.4B) con `recordInitialInstallmentRevision`, que ya es idempotente.
2. Código nuevo sobre una base v4: `saveTransactionInstallments` fallaría al leer el historial. No ocurre en producción
   (`openSmartFinDatabase` migra al arrancar).
3. `zeroCentInstallments` es un motivo nuevo: una app anterior que leyera esa revisión con el repositorio lo rechazaría
   (hoy ninguna pantalla lee revisiones).
4. `seedCreditCardDemoData` guarda planes sin revisión 0; no tiene llamadores.
5. Las referencias Node de 1a.3A/1a.3B ya no coinciden (sección 11): sus pruebas de equivalencia fallan hasta que exista
   la validación 1a.4A con referencias propias.
6. Sin evidencia de dispositivo (API 24 = SQLite 3.9.2).

## 13. Resultados de verificación

| Verificación | Resultado |
|---|---|
| `initialInstallmentRevisionPhase1a4A` | 21/21 (17/21 fallan con el código anterior) |
| Migración 5 y fechas (`installmentHistoryPhase1a3B`, `civilDateCheckPhase1a3B`) | 54/54 (tras los dos ajustes de la sección 7) |
| Extractos multiciclo y atomicidad (`creditCardStatementsPhase1a2`, `phase1a2StatementsProbes`, `safePersistencePhase1a3A`, `phase6b3HarnessRollbackOracle`, `creditCardSettlementPhase6B3`, `financialAtomicityPhase*`) | Verdes |
| `npm test -- --runInBand` | 85 suites aprobadas, 2 fallidas, 7 omitidas; 1.271 pruebas aprobadas, **8 fallidas**, 14 omitidas; 8/8 snapshots. Las 8 fallas son exactamente `phase1a3aAndroidEquivalence` (1) y `phase1a3bAndroidEquivalence` (7: comparten un `beforeAll`), por las diferencias medidas en la sección 11; referencias protegidas no regeneradas |
| `npm run test:reproductions -- --runInBand` | 6 suites, 29/29 |
| `npx tsc --noEmit` | Sin errores |
| `npm run lint` | 0 errores; las 5 advertencias previas de `scripts/phase5e3`, `phase6a` y `phase6b` |
| `git diff --check` | Limpio (incluidos los archivos nuevos) |

## 14. Preparación para la Fase 1a.4B

- `registerExtraordinaryInstallmentPayment` sobre `saveAllocations` + `appendPlanRevision` en un único ámbito, con
  `recordInitialInstallmentRevision` antes de imputar a una compra sin historial (riesgo 1).
- Reversión explícita (`active → reversed` + `allocationReversal`) antes de editar o borrar el pago.
- Construir y ejecutar la validación Android 1a.4A con autorización.

## 15. Corrección de regresiones y preparación Android

### 15.1 Diagnóstico de las ocho pruebas

Ejecutadas por separado. Las siete de 1a.3B comparten un `beforeAll` que ejecuta todas las campañas: la primera
aserción que falla es la excepción de esa preparación. Con el paso de revisión 0 neutralizado, el código actual
reproduce **exactamente** ambas referencias (12/12), lo que aísla la causa en ese único paso.

| # | Prueba | Primera aserción | Campo | Antes → ahora | Causa | Veredicto |
|---|---|---|---|---|---|---|
| 1 | 1a.3A «the campaigns are deterministic and equal the recorded Node reference» | Igualdad con `results.json` | 21 hojas `revision`/`revisionDelta` (`financial_data_revision`) | p. ej. 11 → 12, 11 → 13 | Revisión 0 del alta (+1) y `purchaseEdit` que ahora sí se genera al editar condiciones (+1). Escrituras 6/10, verbos, 32 puntos, `rowid`, ids e importes iguales | Legítima |
| 2 | 1a.3B «upgrade creates revision 0…» | `beforeAll`: `La compra ya tiene una revisión original vigente.` | Preparación de `phase1a3b-integrity` | Revisión 0 manual → rechazada | Las sondas añadían a mano la revisión 0 que ahora crea el alta; el repositorio rechaza una segunda `original` | Legítima (preparación); además `backupRevision` 23 → 25 en upgrade |
| 3 | 1a.3B «the start-up path migrates once…» | Igual que 2 | Igual; `backupRevision` 23 → 25 en arranque | — | Igual que 2 | Legítima |
| 4 | 1a.3B «all 30 migration fault points…» | Igual que 2 | Sin diferencias en los 30 puntos | — | Solo la excepción compartida | Legítima |
| 5 | 1a.3B «integrity probes and v4/v5 flows» | Igual que 2 | Flujos: `backupRevision` +1 desde el alta inicial; escrituras por paso iguales | 6 → 7 … 26 → 27 | Igual que 2 | Legítima |
| 6 | 1a.3B «numeric text in amount_cents…» | Igual que 2 | Ninguna propia | — | Igual que 2 | Legítima |
| 7 | 1a.3B «the campaigns are deterministic…» | Igual que 2 | Integridad: `verification`, `pending_reasons`, `effective_cycle_end` de las dos revisiones 0 (`pendingVerification` → `projected`, ciclo 2026-10-20); `purchaseRecreation`: la recreación ya trae su `original` | — | Igual que 2 | Legítima |
| 8 | 1a.3B «the probes do not depend on the key order…» | Igual que 2 | Ninguna propia | — | Igual que 2 | Legítima |

Sin regresiones reales: saldos, deuda, cupo, gastos, ingresos, patrimonio, movimientos, importes, extractos, `rowid`,
identificadores, orden de escrituras, resultados de migración e integridad referencial son idénticos.

### 15.2 Corrección

- Suites históricas: neutralizan solo `recordInitialInstallmentRevision` (`jest.mock`) y comprueban la reproducibilidad
  exacta contra sus referencias; ya no pueden reescribirlas. Ninguna aserción eliminada ni relajada.
- Suite nueva `phase1a4aAndroidEquivalence` (14): campañas 1a.4A, 1a.3A y 1a.3B (sondas derivadas) sobre el código actual
  contra `docs/validacion-fase1a4a/node/results.json`; comparación antes/después del mismo flujo; comparadores que solo
  admiten las diferencias aprobadas frente a las referencias históricas (leídas, con hash r5 verificado).
- `scripts/phase1a4a/derive-probes.cjs`: sondas 1a.3B derivadas mecánicamente (preparación de integridad y escenario
  `purchaseRecreation`); el original no cambia.
- Modelo: comentario del tipo `installmentAmountCents` y dos pruebas. Una revisión 0 nueva guarda la base D2 (nunca la
  última cuota con residuo); la de la migración 5 guarda el `monthly_amount` heredado (1.234,56 × 6: 20.600 frente a la base
  20.576). No hay lectores financieros de la columna; 1a.4B debe derivar los importes de capital y número de cuotas.

### 15.3 Resultados

| Verificación | Resultado |
|---|---|
| `initialInstallmentRevisionPhase1a4A` | 23/23 |
| `phase1a4aAndroidEquivalence` | 14/14 (determinista, dos órdenes de claves) |
| `phase1a3aAndroidEquivalence` / `phase1a3bAndroidEquivalence` | 5/5 y 7/7 contra las referencias históricas intactas |
| Migración 5, fechas, extractos, atomicidad (`installmentHistoryPhase1a3B`, `civilDateCheckPhase1a3B`, `creditCardStatementsPhase1a2`, `phase1a2StatementsProbes`, `safePersistencePhase1a3A`, `phase6b3HarnessRollbackOracle`, `financialAtomicityPhase*`) | Verdes |
| `npm test -- --runInBand` | **88 suites aprobadas, 7 omitidas; 1.295 pruebas aprobadas, 14 omitidas, 0 fallos**; 8/8 snapshots. Las omitidas son las suites de rendimiento/diagnóstico condicionadas por variables de entorno (mismas 7/14 que la línea base) |
| `npm run test:reproductions -- --runInBand` | 29/29 |
| `npx tsc --noEmit` | Sin errores |
| `npm run lint` | 0 errores; las 5 advertencias previas |
| `git diff --check` | Limpio |

Referencias históricas: `validacion-fase1a3a/node/results.json` (`19b01c30…`) y `validacion-fase1a3b/node/results.json`
(`c0854ea8…`) con el hash del inventario r5; ningún archivo de `docs/validacion-fase1a3a`, `docs/validacion-fase1a3b`,
`scripts/phase1a3a` o `scripts/phase1a3b` modificado.

### 15.4 Riesgos pendientes

1. Planes creados por la versión intermedia (1a.3B tras la migración 5) sin revisión 0: se listan, no se inventan; su
   edición o borrado no deja historial hasta la inicialización perezosa de 1a.4B.
2. Semántica de `installment_amount_cents` distinta entre revisiones migradas y nuevas (15.2).
3. Las suites históricas validan el código sin el paso 1a.4A; el comportamiento completo lo cubre la suite 1a.4A.
4. Sin evidencia de dispositivo hasta compilar y ejecutar con autorización.


## 16. Ronda Android r1 y preparación r2

r1 (API 24): 306 casos aprobados, 198 puntos de fallo con rollback confirmado; detenida en `phase1a2-statements` porque
su oráculo era la referencia histórica de 1a.2, sin la tabla de revisiones que el código actual escribe. No era una
diferencia financiera. Corrección (solo pruebas, arnés de preparación y referencias nuevas; producción sin cambios):
`phase1a2StatementsProbes` compara con su referencia histórica con el paso de revisión 0 neutralizado y ya no la escribe;
`phase1a4aAndroidEquivalence` añade las sondas 1a.2 con la revisión 0 activa (referencia
`validacion-fase1a4a/r2/node/results.json`), un comparador estricto con prueba negativa y la igualdad exacta de las
sondas 6B.3. Jest completo: ejecución 1 con el fallo intermitente conocido de `subscriptionAtomicityPhase4` (pila
excedida; 14/14 en tres ejecuciones aisladas, no toca cuotas), ejecución 2 **88 suites, 1.301 pruebas aprobadas, 14
omitidas, 0 fallos**; `docs/` intacto tras ambas. Workspace r2 preparado sin compilar. Detalle:
[validacion-fase1a4a, sección 10](validacion-fase1a4a/README.md).

## 17. Validación Android r2: aprobada

APK `a3cba3a8233d245f24b715ec896eacf05cce58a122071ea164810770b7ba29ae`, atestación `286642b3…`. API 24 (SQLite 3.9.2) y
API 35 (SQLite 3.44.5): **355/355** casos y **198/198** puntos de fallo por dispositivo, 41.994 hojas iguales a Node sin
diferencias, `com.smartfin` sin cambios, guards intactos. Detalle: [validacion-fase1a4a, sección 11](validacion-fase1a4a/README.md).
Pendiente para 1a.4B: revisión 0 perezosa de los planes de la versión intermedia y uso de capital y número de cuotas en
lugar de `installment_amount_cents`.
