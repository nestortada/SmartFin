# SmartFin — Fase 1a.1: motor determinista de cuotas

1 de noviembre de 2026, America/Bogota. Rama `main`, commit inicial `f113947` («Fase 6 b»), árbol limpio.
Sin commit ni push.

Código: [`installmentPlan.ts`](../src/modules/creditCards/useCases/installmentPlan.ts).
Pruebas: [`installmentPlan.test.ts`](../__tests__/installmentPlan.test.ts) (suite estable).

**Alcance:** solo funciones puras y sus pruebas. El motor **no está conectado** a la persistencia, la
reconciliación, los pagos, los extractos ni la interfaz. SmartFin calcula hoy exactamente lo mismo que antes:
no hay migración 5 ni cambios de esquema, repositorios, extractos o reglas contables.

## 1. Restricciones del motor

- No usa SQLite, red, reloj, preferencias globales ni React Native.
- No usa `Date`: las fechas son cadenas civiles `YYYY-MM-DD` y la aritmética de calendario se hace con enteros,
  así que el resultado no depende de la zona horaria del dispositivo.
- No modifica sus entradas (las pruebas lo comprueban con objetos congelados).
- Ningún error de datos lanza una excepción: cada problema se informa como un `issue` con código y mensaje.
- Solo trabaja con centavos enteros seguros. La única conversión es `toExactCopCents`
  ([exactCopCents.ts](../src/shared/utils/exactCopCents.ts)), que no redondea.

## 2. Contrato

### Entrada (`InstallmentPlanInput`)

| Campo | Significado |
|---|---|
| `purchaseId` | Identificador de la compra. Base de los ids de las cuotas |
| `principal` | `{ kind: 'cents', cents }` (entero seguro > 0) o `{ kind: 'storedAmount', amount }` (`REAL` histórico; se acepta solo si convierte exactamente) |
| `installmentCount` | Entero de 1 a 360. El límite es técnico (30 años): SmartFin no tiene un límite de negocio |
| `purchaseDate` | Fecha civil de la compra (`YYYY-MM-DD`) |
| `timeZone` | Solo `America/Bogota` |
| `billing.closingDay` | Día de corte (entero de 1 a 31) o ausente |
| `billing.closingDayPurchasePolicy` | `closingCycle` o `nextCycle`: dónde se factura una compra hecha justo el día del corte. Sin valor por defecto |
| `billing.shortMonthPolicy` | `lastDayOfMonth` (por defecto). Se puede sustituir |
| `confirmedFirstCycle` | `{ cycleEnd, source: 'user' \| 'statement' }`: ciclo de la primera cuota, confirmado para esa compra en concreto |

### Salidas

- **`buildInstallmentPlan`** devuelve un `InstallmentPlan`:
  - `status`, `isConfirmed`, `isComplete`;
  - `principalCents`;
  - `amounts`: `baseCents`, `lastCents` y `residueCents`;
  - `firstCycle`, con su origen: `confirmed` o `purchaseCycleDefault`;
  - `schedule`: cada cuota con `id`, `position`, `cycleEnd` y `amountCents`;
  - `issues`.
- **`evaluateInstallmentProgress(plan, { cycleEnd } | { date })`** devuelve:
  - el ciclo evaluado;
  - las cuotas programadas;
  - las cuotas y los centavos **facturados**;
  - el capital programado **pendiente de facturación**, en importe y número de cuotas;
  - si el resultado no se puede determinar, `determined: false` con sus motivos.
- **Funciones auxiliares:**
  - `installmentBilledInCycle`: la cuota que factura un ciclo; es el contrato de los extractos de la Fase 1a.2;
  - `buildRevisedInstallmentSchedule`: revisión con ciclo de entrada en vigor (`effectiveCycleEnd`);
  - `compareInstallmentSchedules`: diferencias ciclo a ciclo;
  - `distributeInstallmentCents`, `cycleEndContaining`, `closingDateOfMonth`, `shiftCycleEnd` y `parseCivilDate`.

El motor **no devuelve cuotas pagadas**. Pagadas, facturadas y programadas son tres cifras distintas, y el
calendario no permite deducir pagos. La deuda de la tarjeta y el saldo de capital de cada compra siguen
perteneciendo al modelo financiero existente y a fases posteriores.

### Estados

| Estado | Cuándo | ¿Se puede facturar? |
|---|---|---|
| `confirmed` | Calendario completo con el primer ciclo confirmado explícitamente | Sí |
| `projected` | Calendario completo calculado con la regla D1 por defecto (ciclo de la compra) | Sí, como proyección. Nunca se presenta como confirmado |
| `pendingVerification` | Falta el día de corte o no es válido; compra el día del corte sin política; importe histórico inexacto; primer ciclo confirmado incoherente | No |
| `requiresDecision` | La distribución D2 da cuotas de 0 centavos (capital en centavos < número de cuotas) | No. Las cuotas de 0 se muestran, no se ocultan |
| `invalid` | Número de cuotas, capital, fecha, zona o identificador imposibles | No |

`isComplete` es verdadero solo en `confirmed` y `projected`. Con cualquier otro estado,
`evaluateInstallmentProgress` devuelve `determined: false` y no cuenta cuotas facturadas.

## 3. Reglas de fechas (D1)

- **Ciclo:** se identifica por su fecha de corte, que pertenece al ciclo que cierra.
- **Fecha evaluada:** pertenece al ciclo cuyo corte es el primero en esa fecha o después de ella.
  - Es la misma regla inclusiva que usa hoy `getCurrentStatementRange`.
- **Primera cuota por defecto (D1):** se factura en el ciclo de la compra.
  - Un `confirmedFirstCycle` la sustituye para esa compra; corregirlo recalcula todo el calendario.
  - Ese ciclo debe ser una fecha de corte de la tarjeta y no puede cerrar antes de la compra.
- **Compra el día del corte:**
  - si la tarjeta no tiene `closingDayPurchasePolicy` (y no hay ciclo confirmado), el calendario queda en `pendingVerification`;
  - nunca se toma una decisión bancaria universal.
- **Cortes de los días 29, 30 y 31:** con `lastDayOfMonth`, el corte pasa al último día de los meses más cortos.
  - Ejemplos: 28 de febrero, o 29 en años bisiestos; 30 en abril.
  - El mes siguiente vuelve al día pedido: 31 → 28 feb → 31 mar.
  - Esta regla no sale de la fecha del mes anterior, así que no se desplaza con los meses.
- **Sin `closingDay`:**
  - no se inventa ningún corte y el calendario queda en `pendingVerification`;
  - un primer ciclo confirmado se conserva, pero las cuotas 2 a n quedan con `cycleEnd: null`.
- **Cuota «facturada»:** cuota asignada a un ciclo anterior o igual al evaluado.
  - Incluye la del ciclo abierto, que aparecerá en el extracto que ese ciclo cerrará.

## 4. Redondeo exacto (D2)

`base = floor(capital / n)` en centavos (división entera exacta: `(c − c mod n) / n`). Las cuotas 1 a n−1
valen `base` y la última, `base + residuo`. La suma es siempre el capital: no se crea ni se pierde un centavo.

| Compra | Cuotas | Calendario (COP) | Residuo | Estado |
|---|---|---|---|---|
| 100.000 | 3 | 33.333,33 · 33.333,33 · 33.333,34 | 0,01 | `projected` |
| 100.000,50 | 3 | 33.333,50 × 3 | 0 | `projected` |
| 100.000,01 | 3 | 33.333,33 · 33.333,33 · 33.333,35 | 0,02 | `projected` |
| 1 | 3 | 0,33 · 0,33 · 0,34 | 0,01 | `projected` |
| 0,40 | 2 | 0,20 · 0,20 | 0 | `projected` |
| 0,01 | 2 | 0,00 · 0,01 | 0,01 | `requiresDecision` |
| 0,02 | 3 | 0,00 · 0,00 · 0,02 | 0,02 | `requiresDecision` |

Ejemplo de calendario: compra del 11 de octubre de 2026, corte el día 20, 600.000 en 6 cuotas. Se factura
100.000 en cada corte, del 20 de octubre de 2026 al 20 de marzo de 2027. Evaluado el 20 de noviembre: 2
facturadas (200.000) y 400.000 en 4 cuotas pendientes de facturación.

## 5. Compatibilidad histórica

- El motor solo lee los datos que recibe: no escribe `monthly_amount`, `paid_installments`, estados, saldos ni
  extractos.
- Un `REAL` que no equivale exactamente a dos decimales (p. ej. 0,004, 10,005 o 1e‑7) da
  `pendingVerification` con `inexactHistoricalAmount`. No se redondea: los ciclos se siguen calculando, pero
  los importes quedan en `null`.
- El `monthly_amount` heredado (`Math.round(total / n)` en pesos) no se usa: el calendario parte del capital.
- **Consumidores actuales de `paid_installments`.** Ningún código de producción lo actualiza; solo lo
  escribe `seedCreditCardDemoData`.
  - Vista general: `summarizeInstallment` en `getCreditCardsOverview.ts` (cuotas pendientes y progreso).
  - Interfaz: «X / N cuotas» en `CreditCardInsightCards.tsx`.
  - Cierre de tarjeta: `deleteCreditCard` en `manageCreditCards.ts`, a través de las cuotas pendientes.
  - Edición de compras: `saveTransactionInstallments` lo conserva o lo pone a 0.
  - Exportación: `compras-cuotas.csv`, con `SELECT *` en `SmartFinBackupCsv.kt`.
  - IA: no lo lee. `executeAiCommandPlan` solo reutiliza `installmentCount`.
  - Esta fase no cambia ninguno de estos consumidores.

## 6. Decisiones funcionales

- **Aprobadas y aplicadas:**
  - D1: primera cuota en el ciclo de la compra, con corrección explícita por compra;
  - D2: la última cuota absorbe el residuo;
  - D4: el progreso parte del calendario y una deuda en cero no marca la compra como saldada;
  - D7: `paid_installments` se conserva pero no se usa.
- **Indicador, no restricción:** R9 (Σ capitales ≤ deuda) no se valida en el motor.
- **Pendientes:**
  - política del día de corte de cada tarjeta: no existe en los metadatos (`closingDayPurchasePolicy`);
  - qué hacer con las cuotas de 0 centavos (`requiresDecision`).

## 7. Limitaciones y trabajo posterior

- Sin intereses ni amortización francesa. Sin pagos ni imputaciones.
- Ni los metadatos de la tarjeta ni `installment_purchases` guardan todavía la política del día de corte ni el
  primer ciclo confirmado. Para usarlos hace falta una migración, prevista en una fase posterior.
- Hoy todas las compras existentes quedarían como `projected` (o `pendingVerification` si no hay corte), nunca
  como `confirmed`.

## 8. Propuesta de integración para la Fase 1a.2

> Implementada en la [Fase 1a.2](correccion-fase1a2.md) con `statementChargesForCycle`.

1. **Reproducir antes de tocar nada.** Partir de `creditCardStatements.repro.ts` (datos sintéticos) y añadir
   el caso de un pago del ciclo anterior hecho en el ciclo actual.
2. **Ciclos cerrados o pagados.** Los extractos `statement-auto-*` de ciclos ya cerrados no se recalculan ni se
   sobrescriben. Hoy `saveStatements` usa `INSERT OR REPLACE`, así que la reconciliación debe limitarse al ciclo
   abierto y a los futuros.
3. **Cargos del ciclo abierto.** Sumar `installmentBilledInCycle` de todos los planes `isComplete` cuyo
   `cycleEnd` sea el corte del ciclo, más las compras de una sola cuota con fecha dentro del ciclo. Un plan en
   `pendingVerification` o `requiresDecision` conserva el comportamiento anterior y se informa; nunca se inventa
   un cargo.
4. **Comparación.** Comparar deuda, gasto, patrimonio y extractos antes y después con oráculos BigInt. La deuda
   no debe cambiar: solo cambian los cargos del extracto.
5. **Equivalencia Node–Android.** Volver a comprobarla en API 24 y API 35 con las campañas de equivalencia de
   extractos, que necesitan autorización.
