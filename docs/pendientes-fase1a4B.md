# Decisiones técnicas pendientes tras la Fase 1a.4B (antes de 1a.5)

7 de noviembre de 2026. Documento de análisis: **no implementa nada**. 1a.4B está validada técnicamente (Android r5: API 24 y
API 35 con 32/32 campañas, 568/568 casos, 356/356 puntos de fallo y 0 diferencias; ver
[validación r5](validacion-fase1a4b/r5/README.md) §16). Cada punto requiere una decisión y una autorización propias.

## A. Idempotencia: identidad completa del comando

**Estado.** `command_id` vive en `installment_allocations`, sin FK y sin borrarse salvo en el borrado financiero total. El
id del pago se deriva de la tarjeta y el comando. Una repetición idéntica no escribe. Se rechazan las diferencias que se
pueden verificar: compra, tarjeta, modalidad e importe imputado. Mientras la imputación está activa, también se comprueban
el importe y las cuentas del pago, porque las guardas SQLite los mantienen inmutables.

**Hueco.** Tras editar o borrar el pago, su importe y su cuenta origen originales ya no están en ninguna columna. Un
comando repetido con esos datos cambiados no se puede distinguir. Se responde desde la evidencia, siempre sin escribir: no
se recrea dinero ni se reactiva la imputación, pero no se demuestra que el comando sea equivalente.

**Opción a evaluar.** Una huella inmutable del comando original: un hash canónico de tarjeta, cuenta origen, importe del
pago en centavos, compra, modalidad e importe solicitado, o esas columnas en claro. Se guardaría al insertar y nunca se
actualizaría (trigger `BEFORE UPDATE` que lo rechace).

- Ventaja: la repetición compararía el comando completo aunque el pago se edite o se borre.
- Coste: exige una migración 6, porque la migración 5 no se toca. Habría que decidir:
  - el valor para las filas existentes (huella `NULL` = «comando previo a la huella», comparación parcial como hoy);
  - la inclusión en respaldos (punto C);
  - el comportamiento ante el borrado financiero total.
- Alternativa sin esquema: mantener el contrato actual y documentarlo en la interfaz. Riesgo bajo, porque nunca duplica
  dinero.

**Decisión pendiente:** huella con migración 6, o contrato actual documentado. No se crea ninguna migración sin
autorización.

## B. Reconciliación bancaria

**Estado.** El abono es un pago real. La imputación solo registra la intención del usuario y añade una revisión
`allocation` en `pendingVerification`. Una reversión con revisión confirmada posterior deja
`statementAdjustmentRequired`, y hasta que un extracto ajuste el plan no se admiten nuevas imputaciones a esa compra.

**Requisitos para la siguiente etapa** (solo requisitos):

1. Una acción explícita para confirmar cómo aplicó el banco el abono, a partir del extracto: capital restante, cuotas
   restantes, cuota y ciclo. Debe producir una revisión `statement` confirmada que sirva de nueva ancla.
2. Ninguna reducción de plazo ni de cuota se infiere sin extracto. Las modalidades distintas de `unspecified` siguen fuera
   de alcance.
3. El desbloqueo de `statementAdjustmentRequired` se produce solo con esa revisión confirmada, en una transacción con
   rollback exacto y sin reescribir revisiones confirmadas anteriores (historial solo de añadidos).
4. Tratamiento de diferencias entre el extracto y la estimación (por ejemplo, intereses o redondeos del banco):
   registrarlas como motivo de verificación, sin corregir saldos ni deuda, que se derivan de los movimientos.
5. Las mismas pruebas que 1a.4B: equivalencia Node–Android, atomicidad por escritura e idempotencia.

## C. Respaldo y recuperación (revisión documental del código actual)

| Dato | Copia local (`SmartFinLocalSnapshot`) | Respaldo CSV / Drive (`SmartFinBackupCsv`) |
|---|---|---|
| `installment_allocations` (incluye `command_id`) | Sí: copia del archivo SQLite completo (todas las tablas, SHA-256, `integrity_check`, `foreign_key_check`) | **No exportado** |
| `installment_plan_revisions` | Sí (copia completa) | **No exportado** |
| `installment_first_cycles` | Sí (copia completa) | **No exportado** |
| `credit_card_billing_rules` (migración 5) | Sí (copia completa) | **No exportado** (`cuentas.csv` sí lleva `billing_day` y los metadatos de la cuenta) |
| `installment_purchases` | Sí | Sí (`compras-cuotas.csv`) |

Observaciones:

- `requiredTables` de la copia local no incluye las tablas de la migración 5. Se copian porque se copia el archivo
  completo, pero su presencia no se exige explícitamente.
- El CSV es una exportación legible, no un formato de restauración. Con él se perderían el historial de cuotas, las
  imputaciones, la evidencia de `command_id` y las reglas de facturación.
- El borrado financiero total sí incluye las tablas de la migración 5 (`sqliteFinancialDataRepository`).
- **No existe una prueba real de restauración** que demuestre que, tras restaurar una copia, se conservan imputaciones,
  revisiones, primeros ciclos, reglas de facturación y la idempotencia por `command_id`.

**Riesgo pendiente:** sin una prueba de restauración, no se puede afirmar que el historial 1a.3B–1a.4B sobrevive a una
recuperación. Hay que decidir si el CSV debe incluir estas tablas o declararse explícitamente como no restaurable, y añadir
una prueba de ida y vuelta de la copia local con datos sintéticos.

## D. Estabilidad de pruebas

`__tests__/subscriptionAtomicityPhase4.test.ts` falla de forma intermitente con
`RangeError: Maximum call stack size exceeded` en `__tests__/helpers/realSQLite.ts:140`. Es una recursión de
`executeSql` a través de `managedSQLite` y `atomicSQLite`. Se observó en la preparación r5 (aislada pasó 3/3). La última
ejecución completa de Jest pasó: 1.479 aprobadas y 14 omitidas.

- Seguimiento separado, en una tarea propia. No se mezcla con los abonos.
- Hipótesis a investigar: la profundidad de la cadena de promesas o de los callbacks síncronos del adaptador de prueba con
  lotes grandes. No es un fallo de producción demostrado.
- No se ha modificado ni la suite ni `realSQLite`.

## Recomendación de orden

1. **C** (prueba de restauración con datos sintéticos): riesgo de pérdida de historial.
2. **A** (decisión sobre la huella del comando, antes de exponer la funcionalidad en la interfaz).
3. **B** (reconciliación) como alcance de la siguiente fase funcional.
4. **D** en paralelo, como tarea de calidad independiente.
