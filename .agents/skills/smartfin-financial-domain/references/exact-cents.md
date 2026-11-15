# Precisión monetaria: fases 6A, 6B.1, 6B.2 y 6B.3

Resumen para orientar cambios. Las fuentes con cifras, sondas y límites son
[precision-fase6a.md](../../../../docs/precision-fase6a.md),
[auditoria-fase6b.md](../../../../docs/auditoria-fase6b.md),
[correccion-fase6b1.md](../../../../docs/correccion-fase6b1.md),
[correccion-fase6b2.md](../../../../docs/correccion-fase6b2.md) y
[correccion-fase6b3.md](../../../../docs/correccion-fase6b3.md). Revalida en el código antes de apoyarte en esta página.

## Contrato de importes

- El libro principal sigue en COP `number` / SQLite `REAL`. No hay migración global a centavos.
- La UI (`parseCopAmountDraft`, formulario de movimientos, pago de tarjeta) acepta como máximo dos decimales
  y |x| ≤ `MAX_SAFE_INTEGER / 100`. Gastos compartidos y pérdidas guardan centavos enteros (`toMinor` rechaza
  más de dos decimales). Suscripciones redondea a dos decimales.
- Excepción: los movimientos creados por IA (`executeAiCommandPlan`) y los datos heredados solo exigen
  importe finito y positivo. Pueden traer fracciones de centavo y no se redondean.
- 4×1000 (`max(1, round(a·0,004))`), cuotas (`round(total/n)`) y el pago parcial de tarjeta producen pesos enteros.

## Utilidades de `src/shared/utils/exactCopCents.ts`

| Función | Uso |
|---|---|
| `toExactCopCents(x)` | Centavo exacto de un `Double` canónico de ≤ 2 decimales bajo 2^46 (`MAX_EXACT_COP_CENTS_AMOUNT`). Nunca redondea: devuelve `undefined` si no hay un centavo que reproduzca el valor |
| `sumExactCopCents` / `addSafeCents` | Sumas de enteros con `Number.isSafeInteger` en cada paso |
| `addCopAmounts(base, delta, site)` | Escritores de saldo y deuda (6B.1) |
| `differenceOfCopSums(plus, minus, site)` | Deuda de tarjeta = `max(0, compras − pagos)` y totales de extracto (6B.1) |
| `sumCopAmounts` / `copAggregate` | Agregados del dashboard (6B.2) |
| `getCopArithmeticFallbacks` / `getCopAggregateFallbacks` | Contadores en memoria, sin persistencia ni red, de las caídas a la ruta binaria |

**Regla común:** se usa la ruta exacta solo si todos los operandos son canónicos de ≤ 2 decimales bajo 2^46 y
el resultado es entero seguro. Si no, se devuelve **exactamente** la suma binaria anterior, en el mismo orden.
Diferencias entre rutas:

- Escritores (`addCopAmounts`, `differenceOfCopSums`): además exigen que el resultado quede bajo 2^46 COP; marcan
  `path: 'binaryLegacy'` y cuentan la caída en `getCopArithmeticFallbacks`.
- Agregados (`sumCopAmounts`, `copAggregate`): solo exigen entero seguro; cuentan en `getCopAggregateFallbacks`.
- Cifras mensuales de 6A (`sumMonthlyFigures` en `getDashboardSummary.ts`): calculan los centavos directamente, sin
  `copAggregate`, sin campo `path` y sin contador de caídas. Por eso sigue siendo obligatorio conservar el orden de lectura y de suma: la ruta
heredada lo usa. No añadas redondeos ni tolerancias para "arreglar" un valor que cae a binario.

## Qué usa cada flujo

- **Escritores (6B.1):** `applyAccountImpact` (alta, edición, borrado, transferencias y su pata `-in`, 4×1000,
  acciones rápidas, IA y compra compartida), `cashMovement` de gastos compartidos, reconciliación de tarjetas y
  pago de tarjeta usan `addCopAmounts` / `differenceOfCopSums`. Las cuentas cuyo saldo se introduce directamente
  (alta de cuenta, tarjeta débito, cuenta por clasificar) no acumulan y no cambiaron.
- **Dashboard mensual (6A):** ingresos y gastos se suman en centavos. Ahorro = ingresos − gastos − pérdida neta
  compartida y se convierte una sola vez con `centavos / 100`. La pérdida neta se calcula en centavos `BigInt` pero
  el repositorio la devuelve en pesos (`Number(net) / 100`), y el dashboard la vuelve a convertir con
  `toExactCopCents`. Puede ser negativa en un mes con recuperaciones o reversiones: entonces el ahorro supera a
  ingresos − gastos.
- **Otros consumidores de `sumCopAmounts`:** `getDebitCardsOverview.ts` y un total de presentación en
  `TransactionsScreen.tsx`.
- **Dashboard de saldos (6B.2):** disponible, deuda y patrimonio se agregan en centavos por separado y cada uno
  cae a binario de forma independiente. Patrimonio = activos − deuda + derechos de cobro − anticipos, sumando la
  posición compartida una sola vez. `copAggregate` nunca devuelve −0.
- **Liquidación total de tarjeta (6B.3):** `settlement: 'fullDebt'` exige que el llamador lo pida expresamente y
  envíe la deuda que vio. Se valida que sea canónica, se reconcilia y relee dentro de `withCreditCardPaymentScope`,
  se rechaza si la deuda cambió o es heredada no canónica, se debita exactamente la deuda y, si la deuda releída no
  es 0, se revierte todo. Sin redondeo, tolerancia ni condonación. `settlement: 'partial'` (por defecto) conserva el
  contrato de 3B: `min(round(importe), deuda)`, entero seguro ≥ $1. Un importe tecleado nunca se interpreta como
  liquidación total aunque coincida con la deuda. La liquidación total puede pagar centavos, incluso por debajo de $1.
- **Siguen en binario o con redondeo propio** (entre otros): el pago mínimo del extracto (`Math.round(total·ratio)`
  en `creditCardTransactionRelations.ts`), las sumas por cuenta de `getDebitCardsOverview.ts` y los deltas
  informativos de `sharedCommandEffects.ts`.

## Límites conocidos

- Las correcciones valen para operaciones nuevas dentro del contrato de dos decimales. No se reescribieron saldos
  históricos ni se crearon movimientos de ajuste.
- Desde 2^46 COP un `Double` ya no identifica un único centavo. Esos valores y los importes de IA o heredados con más
  de dos decimales conservan exactamente el resultado binario anterior.
- 6B-D4 ("−$ 0") quedó corregido solo para el cero exacto. Ninguna corrección de 6B.1–6B.3 abordó 6B-D5 (con importes
  IA/heredados de más de dos decimales, el ahorro cae entero a binario y puede diferir en $1 de ingresos − gastos
  visibles) ni 6B-O1 (texto con mojibake en un mensaje de error). Comprueba su estado actual en el código antes de tocarlos.
- 6B.3: según la actualización del 1 de noviembre de 2026 de su documento, la validación Android se completó (API 24 y
  API 35: 102/102). El mismo documento conserva como pendientes una nota de 6B.2 y la repetición Android de 6A.

## Pruebas de referencia

`dashboardPhase6APrecision.test.ts`, `financialAuditPhase6B.test.ts`, `financialCorrectionPhase6B1.test.ts`,
`dashboardAggregatesPhase6B2.test.ts`, `creditCardSettlementPhase6B3.test.tsx`, `phase6b3Reproduction.test.ts` y
`phase6b3HarnessRollbackOracle.test.ts`. Varias de estas suites importan `exactCopCents`; antes de usar una como
oráculo independiente, comprueba que el valor esperado no sale de la misma utilidad que verifica (los documentos 6A y
6B.2 describen oráculos `BigInt` sobre los textos decimales).
