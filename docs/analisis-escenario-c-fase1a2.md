# Escenario C: pago de un ciclo anterior (análisis, sin cambio de regla)

1 de noviembre de 2026. Documento de análisis. **No modifica la regla financiera vigente.**

## 1. Caso observado

Tarjeta con corte el día 20.

| Fecha | Operación |
|---|---|
| 11 oct | Compra de 300.000 (1 cuota) |
| 12 oct | Compra de 600.000 a 6 cuotas |
| 20 oct | Extracto de octubre: 300.000 + 100.000 = **400.000**, pendiente |
| 12 nov | Pago de 400.000, para cubrir el extracto de octubre |
| 13 nov | Compra de 50.000 |
| 20 nov | Extracto de noviembre: cargos 50.000 + cuota 2 (100.000) = 150.000; pagos fechados en el ciclo 400.000 → total `max(0, 150.000 − 400.000)` = **0, `paid`** |

La deuda (550.000), el banco (600.000) y el patrimonio son correctos. Lo que es engañoso es el extracto de
noviembre: aparece pagado aunque las obligaciones de noviembre (150.000) siguen pendientes. Evidencia:
`paymentInLaterCycle` en [`validacion-fase1a2/node/results.json`](validacion-fase1a2/node/results.json) y el
escenario C de [`correccion-fase1a2/node/after.json`](correccion-fase1a2/node/after.json).

## 2. Por qué ocurre

`reconcileCreditCardTransactionsInScope` resta a los cargos del ciclo **todos los pagos fechados en ese ciclo**.
Un pago no guarda a qué extracto corresponde; solo tiene fecha, importe, cuenta origen y tarjeta destino. La regla
es anterior a 1a.2 y se conservó a propósito.

## 3. Datos necesarios para asociar un pago con un extracto

1. **Extracto objetivo:** el id del extracto (`statement-auto-<tarjeta>-<inicio>-<fin>`) o su fecha de corte.
2. **Importe aplicado a ese extracto**, en centavos exactos, y el excedente aplicado al saldo siguiente o a la
   deuda no facturada.
3. **Saldo de cierre de cada extracto** (saldo anterior + cargos − pagos aplicados), guardado de forma inmutable
   al cerrar el ciclo. Hoy los extractos guardan solo el total de su ciclo y los ciclos anteriores pueden
   conservar totales heredados.
4. **Regla de aplicación** cuando el usuario no indica el extracto, por ejemplo: primero el extracto vencido más
   antiguo, después el extracto cerrado y por último el ciclo en curso. Es una **decisión de producto**.
5. **Fecha de vencimiento** (`payment_due_date`), para distinguir un pago a tiempo de uno tardío. Ya existe.
6. **Reversión:** al editar o eliminar un pago, la aplicación se revierte en la misma transacción, con un
   identificador de comando idempotente.

Con esos datos, el extracto de noviembre mostraría: saldo anterior 400.000 − pago aplicado 400.000 + cargos nuevos
150.000 = **150.000 pendientes**.

## 4. Diferencia con las imputaciones a compras (Fase 1a.3 y siguientes)

| | Asociación pago → extracto | Imputación pago → compra a cuotas |
|---|---|---|
| Pregunta | ¿Qué obligación facturada cubre este pago? | ¿Qué capital de una compra concreta reduce este pago (abono extraordinario)? |
| Afecta | Total, estado y pago mínimo de los extractos | Calendario o plan de la compra (revisiones) |
| Deuda total | No cambia | No cambia |
| Granularidad | Ciclo de facturación | Compra (`installment_purchases`) |
| Datos | Extracto objetivo, importe aplicado, saldo de cierre | `installment_allocations`, `installment_plan_revisions` (migración 5) |
| Por defecto | Regla de aplicación por antigüedad (decisión pendiente) | Ninguna: un pago ordinario no se imputa a compras (R1) |

Un mismo pago puede tener las dos: cubrir el extracto de octubre y, con el excedente, ser un abono a una compra.
Son dimensiones independientes y no deben reutilizar la misma tabla ni la misma regla.

## 5. Recomendación

Mantener la regla vigente hasta aprobar (a) el saldo de cierre inmutable por extracto y (b) la regla de
aplicación por defecto. Implementarlo después de la migración 5, en una tarea separada de las imputaciones a
compras y con sus propias pruebas de equivalencia de deuda.
