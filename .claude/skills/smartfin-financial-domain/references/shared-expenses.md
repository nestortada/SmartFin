# Gastos compartidos, cobros, anticipos y condonaciones

Resumen para orientar cambios. Las reglas completas, ejemplos y límites están en
[GASTOS_COMPARTIDOS_Y_FECHAS.md](../../../../docs/GASTOS_COMPARTIDOS_Y_FECHAS.md) (migración 3) y
[CONDONACIONES_COMPARTIDAS.md](../../../../docs/CONDONACIONES_COMPARTIDAS.md) (migración 4). Revalida en el código
antes de apoyarte en esta página.

## Estado

El dominio, la persistencia y la API están implementados y probados en Node y con campañas Android sintéticas
([VALIDACION_OPERACIONES_COMPARTIDAS_ANDROID.md](../../../../docs/VALIDACION_OPERACIONES_COMPARTIDAS_ANDROID.md)).
**No hay interfaz** de personas, reparto, cobros, anticipos ni condonaciones. No presentes la funcionalidad como
terminada para el usuario ni añadas interfaz sin encargo explícito.

## Dónde vive (bajo `src/modules/transactions/`)

| Archivo | Responsabilidad |
|---|---|
| `types/SharedExpense.ts` | Contactos, compras, participaciones, cobros, aplicaciones, devoluciones, eventos y clasificación |
| `useCases/sharedExpenseDomain.ts` | Centavos, reparto, estados, obligaciones por persona y proyección de consumo personal |
| `useCases/sharedLossDomain.ts`, `sharedLossCommands.ts` | Pérdidas, recuperaciones y reversiones |
| `useCases/createSharedExpenseApi.ts` | Fachada pública y validación; incluye `cashMovement` |
| `useCases/sharedCommandEffects.ts` | Deltas de saldo, deuda, patrimonio, ingreso, gasto y flujo bancario por comando |
| `useCases/readSharedFinancialTotals.ts` | Validación exacta de los centavos agregados para el dashboard |
| `repositories/sqliteSharedExpenseRepository.ts` | Adaptador SQLite y comprobante persistente del comando |
| `repositories/sharedTransactionIntegrity.ts` | Protección en la frontera común de escritura y borrado, también usada por edición rápida e IA |
| `repositories/sharedFinancialProjectionSql.ts`, `sharedFinancialTotalsSql.ts`, `sharedLossPeriodSql.ts` | Importe personal para el dashboard, cuentas por cobrar y anticipos, pérdida del periodo |

Pruebas: `sharedExpenses.test.ts`, `sharedForgiveness.test.ts`, `sharedFinancialTotals.test.ts`,
`sharedCommandReads.test.ts`, `sharedSQLiteCoordination.test.ts` y las de rendimiento opt-in `shared*Performance.test.js`.

## Reglas que hay que preservar

- **Representación:** importes compartidos en centavos `INTEGER` (`amount_minor`). Saldos y métricas públicas siguen
  en `number`/`REAL`. Toda conversión es explícita (`amount_minor / 100.0`, `toMinor`).
- **Importe bancario completo:** una compra conserva su importe completo en banco o deuda de tarjeta. El consumo por
  categoría y periodo toma solo la participación propia. Cobros y devoluciones vinculados aportan cero ingreso y gasto.
- **Patrimonio** = activos + cuentas por cobrar − deuda − anticipos sin aplicar ni devolver. El disponible solo
  incluye cuentas líquidas. La posición compartida entra una sola vez.
- **Cobro sin aplicar** = anticipo de terceros. La parte ajena de una compra activa es cuenta por cobrar hasta que se
  aplica un cobro. Una entrada nueva suma dinero una sola vez; vincular una entrada existente conserva identidad,
  importe y saldo.
- **Reparto:** dos modos en `sharedExpenseDomain.ts`. Por porcentajes: hasta dos decimales que suman 100 %; los
  centavos se distribuyen por mayor residuo y los empates siguen el orden recibido. Por importes (`amounts`): las partes
  suman exactamente el total y la parte propia puede ser 0. Se rechazan ceros en terceros o abonos, negativos, no
  finitos, más de dos decimales e importes fuera de rango.
- **Participaciones:** son filas de `transaction_splits` con `shared_expense_id` (columnas añadidas por la migración 3,
  con índice único por persona). Las filas sin `shared_expense_id` son la infraestructura anterior de splits.
- **Movimientos de caja:** `cashMovement` crea movimientos `refund` publicados («Reembolso de gasto compartido» como
  entrada, «Devolución de anticipo» como salida) en el libro `REAL`, con `addCopAmounts`. Cambiar la clasificación de
  `refund` en el dashboard o en otros consumidores altera estos invariantes.
- **Restricciones de `sharedTransactionIntegrity.ts`:** los movimientos vinculados deben seguir `posted` y en COP; una
  compra compartida a crédito exige una tarjeta clasificada («Clasifica primero la tarjeta»); los movimientos `refund`
  compartidos tienen la edición restringida.
- **Edición:** el importe compartido solo cambia junto con un reparto nuevo (`updatePurchase`); la edición general y
  la IA no pueden romperlo. Cancelar con abonos aplicados está bloqueado; eliminar compras o cobros con vínculos
  activos exige resolverlos antes.
- **Condonación** (`unrecoveredSharedExpenseLoss`): banco y deuda 0, por cobrar −X, pérdida +X, patrimonio −X; no es
  `Transaction` ni ingreso. No se resta otra vez la pérdida del patrimonio: ya baja la cuenta por cobrar.
  Recuperar consume anticipo y reduce pérdida en la fecha de la recuperación, sin volver a ingresar dinero. Cada
  operación se reconoce en su propia fecha civil; los reversos no reescriben el original.
- **Límites:** condonación ≤ pendiente; recuperación ≤ pérdida y ≤ cobro disponible; abonos + condonaciones ≤
  participación. No se repiten reversiones ni se revierten reversos; una condonación con recuperaciones netas solo se
  revierte tras revertir esas recuperaciones.
- **Fechas de eventos** (`sharedLossCommands.ts`): no pueden ser anteriores a la compra ni al último evento de la
  obligación; corregir el diario exige una reversión o un evento nuevo, no reescribir uno anterior.
- **Dashboard:** ahorro = ingresos − gastos − pérdida neta compartida (ver [exact-cents.md](exact-cents.md)).

## Atomicidad e idempotencia

La fachada reutiliza los repositorios de cuentas, movimientos y tarjetas dentro de `runSharedSQLiteTransaction` con un
único participante. Saldo, deuda, movimientos, cuotas, extractos, conciliaciones, repartos y comprobante se confirman o
revierten juntos. El ID de comando lo aporta el llamador: mismo ID y mismos datos devuelven el resultado confirmado;
mismo ID con datos distintos es un error; tras un rollback confirmado el ID queda libre para reintentar. Un COMMIT con
resultado `unknown` lanza `SQLiteCommandFailure` y conserva la cuarentena: no se reintenta el cuerpo financiero ni se
libera el ID (ver `AGENTS.md`).

## Límites documentados

- `getPosition(asOf)` usa el reparto y las aplicaciones vigentes; no reconstruye versiones anteriores ni balances
  históricos de cuentas.
- Las consultas cargan el estado compartido completo; el historial conserva su paginación.
- Falta validar en dispositivo la interfaz de fecha y hora, y un respaldo y restauración completos con los CSV nuevos.
