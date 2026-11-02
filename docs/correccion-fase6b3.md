# SmartFin 6B.3: liquidación exacta de deudas de tarjeta con centavos

30 de octubre de 2026, America/Bogota. Corrige 6B-C1 ([auditoría 6B](auditoria-fase6b.md),
[6B.1](correccion-fase6b1.md), [6B.2](correccion-fase6b2.md)).

Qué no cambia:

- Esquema, migraciones, driver y dependencias.
- Pagos parciales (contrato de fase 3B), reconciliación de tarjetas, extractos, cuotas, impuestos, gastos compartidos, suscripciones, IA, borrado y respaldos.
- `BACKUP_PUBLICATION_UI_ENABLED` sigue en `false`. No hay restauración, respaldos automáticos ni analista semanal.
- 6B-D5 queda fuera. No se avanza a la siguiente fase.

Evidencias en [`correccion-fase6b3/node/`](correccion-fase6b3/node): `reproduction-before-fix.json` (código de producción sin modificar) y `results.json`.
Sondas: [`scripts/phase6b3/probes.ts`](../scripts/phase6b3/probes.ts). Pruebas: [`creditCardSettlementPhase6B3.test.tsx`](../__tests__/creditCardSettlementPhase6B3.test.tsx) y [`phase6b3Reproduction.test.ts`](../__tests__/phase6b3Reproduction.test.ts).
Copia congelada del pago anterior: [`pre6B3CreditCardRelations.ts`](../__tests__/helpers/pre6B3CreditCardRelations.ts), generada desde el blob de `8985346` por [`freeze-pre6b3.cjs`](../scripts/phase6b3/freeze-pre6b3.cjs).

**Veredicto: 6B-C1 CORREGIDO en Node. Validación Android pendiente de autorización** (secciones 10 y 13).

> **Actualización (1 nov 2026, Fase 1a.1): validación Android completada.** API 24: 102/102 casos. API 35:
> 102/102. Equivalencia Node–Android: 1.715 campos sin diferencias por dispositivo. Evidencias vigentes en
> [`validacion-fase6b3-1/android/`](validacion-fase6b3-1/android). Los intentos fallidos anteriores
> (`attempt-0N/`, incluida la diferencia `minimum_payment_amount` Android=0 / Node=1000) se conservan como
> historial del incidente. Las menciones a «pendiente» que siguen describen el estado en la fecha original.

## 1. Línea base y reproducción

- Git en `8985346`, árbol limpio. La primera ejecución de Jest se solapó con mis ediciones del formateador y no sirve como línea base. La línea base efectiva es la de 6B.2: 75 suites, 1.010 aprobadas y 14 omitidas. `tsc`: 0 errores. ESLint: 0 errores y 5 advertencias previas. `git diff --check`: limpio.
- Apareció `docs/financial-integrity-guard/AUDITORIA_Y_DISENO.md` sin seguimiento (22:23). No es de esta fase y no lo he tocado.

Reproducción con el código de producción sin modificar ([reproduction-before-fix.json](correccion-fase6b3/node/reproduction-before-fix.json)). Cuenta Banco con $1.000.000:

| Escenario | Operación | Resultado | Deuda | Banco | Patrimonio | Extracto | Cierre |
|---|---|---|---|---|---|---|---|
| A | Compra 10.000,40; pago 10.000 | pagado 10.000 | **0,40, mostrada «$ 0»** | 990.000 | 989.999,60 | 0,40 pendiente | rechazado |
| A | Pago 0,40 | rechazado (mínimo $1) | 0,40 | 990.000 | igual | igual | rechazado |
| B | Compra 0,40; pago 0,40 | rechazado | 0,40 «$ 0» | 1.000.000 | 999.999,60 | 0,40 pendiente | rechazado |
| C | Compra 10.000,40; pago 10.000,40 | **pagado 10.000** (redondeo) | 0,40 | 990.000 | igual | 0,40 pendiente | rechazado |
| D | Compras 94.562; pago 94.562 | pagado 94.562 | 0 | 905.438 | 905.438 | 0 pagado | cerrada |

En C el usuario creía pagar todo y quedaba una deuda oculta. Además, la pantalla prellenaba `Math.round(deuda)`: 10.000 para 10.000,40 y 0 para 0,40.

## 2. Significado de «total»

| Magnitud | Origen | Uso |
|---|---|---|
| Deuda completa (`debtBalance`, `usedCredit`) | Σ compras completas − Σ pagos no cancelados, en centavos exactos (6B.1) | **Es lo que liquida «Pagar deuda total»** |
| Saldo exigible del extracto (`totalAmount`) | Cargos del ciclo (la cuota mensual en compras a cuotas) − pagos del ciclo | Sigue siendo derivado; no se paga por separado |
| Cuotas pendientes (`paidInstallments`) | Progreso almacenado de cada compra | Los pagos no lo modifican (regla vigente) |

Antes de 6B.3 no existía una operación «pagar total»: solo el formulario parcial con un valor prellenado.

## 3. Contratos

**Anterior (se conserva para `settlement: 'partial'`, valor por defecto):** importe finito positivo, `Math.round(importe) ≥ 1`; importe efectivo `min(round(importe), deuda)`, entero seguro ≥ 1; saldo suficiente.

**Nuevo, `settlement: 'fullDebt'`:** el llamador indica expresamente la liquidación total y envía como `amount` la deuda que vio.

1. Antes de abrir la operación: importe finito, positivo y canónico de dos decimales por debajo de 2^46 (`toExactCopCents`). Si no, se rechaza sin escrituras.
2. Dentro del mismo ámbito coordinado (`withCreditCardPaymentScope`) se reconcilia y se relee la tarjeta.
3. La deuda vigente debe ser canónica. Una deuda heredada con fracciones de centavo se rechaza: no se aproxima.
4. La deuda vigente debe ser **igual** al importe visto. Si cambió, se rechaza («La deuda de la tarjeta cambió…»).
5. Mismas restricciones de origen: cuenta activa de tipo efectivo, banco o ahorro, y saldo suficiente. Si el pago tiene centavos, el saldo del origen debe ser canónico; si no, se rechaza en vez de simular un débito por otro importe.
6. Se debita exactamente la deuda (`addCopAmounts`), se guarda el pago `creditCardPayment` con ese importe y se reconcilia.
7. Se relee la deuda: si no es exactamente 0, se lanza un error dentro del ámbito y todo se revierte.

No hay redondeo, tolerancia ni condonación. Un importe tecleado nunca se interpreta como total, aunque coincida con la deuda.

## 4. Cambios de producción

- [`creditCardTransactionRelations.ts`](../src/modules/creditCards/useCases/creditCardTransactionRelations.ts): tipo `CreditCardPaymentSettlement`, parámetro opcional `settlement`, validación previa por modo, `fullDebtSettlementAmount` (pasos 3–5) y comprobación final de deuda cero. La rama parcial no cambia.
- [`CreditCardPayment.tsx`](../src/modules/creditCards/ui/components/CreditCardPayment.tsx): opción «Pagar deuda total: $ X» con estado seleccionado. Deuda y saldo pendiente con centavos (`formatCurrencyWithCents`).
- [`CreditCardsScreen.tsx`](../src/modules/creditCards/ui/CreditCardsScreen.tsx): elegir el total captura la deuda mostrada y rellena el texto exacto; **editar el importe vuelve a pago parcial**. Una deuda con centavos ya no se prellena redondeada (las deudas enteras se prellenan igual que antes). El bloqueo de doble envío y de `unknown` no cambia.
- [`formatCurrency.ts`](../src/shared/utils/formatCurrency.ts), [`transactionsScreenFormatters.ts`](../src/modules/transactions/ui/transactionsScreenFormatters.ts), [`copAmountInput.ts`](../src/shared/utils/copAmountInput.ts) y los formateadores locales de `TransactionCard`/`CategorizationModal`, que ahora usan `formatCOP`: presentación (sección 7).

## 5. Parciales frente a totales

| Caso | Parcial (formulario) | «Pagar deuda total» |
|---|---|---|
| Deuda 0,40 | rechazado (mínimo $1) | pagado 0,40 |
| Deuda 10.000,40, importe 10.000,40 | paga 10.000 y quedan 0,40 (3B, sin cambios) | pagado 10.000,40 |
| Deuda 0,50, importe 0,50 | rechazado (entero efectivo) | pagado 0,50 |
| 0,01 | rechazado | — |
| Deuda 94.562 | pagado 94.562 | pagado 94.562, mismo estado final |
| Importe distinto de la deuda vigente | `min(round, deuda)` | rechazado sin escrituras |

Equivalencia del parcial: 40 casos aleatorios con semilla fija (deudas en pesos y con centavos; importes iguales a la deuda, mayores, 0,01, 0,49, 0,50 y un tercio de la deuda) dan resultado, mensaje y estado persistido **idénticos** a la copia congelada. Las sondas parciales A, C, D y `partialSmallRejected` también son idénticas.

## 6. Efectos y cierre (después)

Oráculo independiente en cada paso (BigInt sobre textos decimales): el banco baja exactamente lo pagado, la deuda baja lo mismo, el patrimonio no cambia, el gasto del mes sigue siendo la compra y la deuda del dashboard es igual a la persistida.

| Escenario | Pago | Deuda | Banco | Patrimonio | Gasto mes | Extracto | Cierre |
|---|---|---|---|---|---|---|---|
| A (tras 10.000) | total 0,40 | **0** | 989.999,60 | 989.999,60 (igual) | 10.000,40 | 0, pagado | **cerrada** |
| B | total 0,40 | 0 | 999.999,60 | 999.999,60 | 0,40 | 0, pagado | cerrada |
| C | total 10.000,40 | 0 | 989.999,60 | 989.999,60 | 10.000,40 | 0, pagado | cerrada |
| D | total 94.562 | 0 | 905.438 | 905.438 | 94.562 | 0, pagado | cerrada |
| Compra a 3 cuotas 30.000,30 | total 30.000,30 | 0 | 969.999,70 | igual | 30.000,30 | pagado | **rechazado: cuotas vigentes** (regla existente) |

Los pagos quedan registrados con su importe exacto (`0.4`, `10000.4`), destino a la tarjeta, medio débito y estado `posted`. No se crea un segundo gasto. Después de liquidar, otra solicitud nueva se rechaza porque «La tarjeta no tiene saldo pendiente por pagar».

Rechazos sin efectos: saldo insuficiente (10.000,39 frente a 10.000,40; antes pagaba 10.000 y dejaba 0,40), deuda cambiada (10.000 o 10.000,41 frente a 10.000,40) y origen desviado `97599.49999999999` con pago de centavos. Con pesos enteros desde ese origen se paga igual que antes.

Las compras a cuotas no cambian: el cierre sigue exigiendo que no haya cuotas vigentes, y los pagos no avanzan `paidInstallments`. Esa regla es anterior a 6B.3 y no se ha modificado.

## 7. Presentación de importes inferiores a $1

Inventario de consumidores: `formatCurrency` (dashboard NetWorthCard/MetricsGrid, Débito, Tarjetas, toast de pago), `formatCOP` (Movimientos), y los formateadores locales de TransactionCard y CategorizationModal, que muestran el pago de 0,40 en el historial. `subscriptionPresentation` y los `toLocaleString` de IA y formularios ya muestran decimales y no cambian.

| Valor | Antes | 6B.3 |
|---|---|---|
| 0,40 | $ 0 | **$ 0,40** |
| −0,40 | −$ 0 | **−$ 0,40** |
| 0,01 | $ 0 | **$ 0,01** |
| 0,50 / −0,50 | $ 1 / −$ 1 | $ 0,50 / −$ 0,50 |
| 0 y −0 | $ 0 | $ 0 |
| Residuo heredado 0,004 / −2,78·10⁻¹⁷ | $ 0 / −$ 0 | **«< $ 0,01» / «> −$ 0,01»** |
| No canónico 0,3999999999996362 | $ 0 | $ 0,40 (solo texto) |
| Cualquier \|x\| ≥ 1, infinitos y NaN | — | **idéntico** (239.802 valores comparados) |
| Deuda en el modal de pago 10.000,40 | $ 10.000 | $ 10.000,40 |

El formato se aplica antes de `Intl`, con dígitos fijos y sin `signDisplay`, y nunca modifica el dato almacenado. La regla para datos heredados por debajo de medio centavo es mostrar que hay un importe distinto de cero y menor de un centavo, sin presentarlo como saldado. La liquidación exacta de esas deudas se rechaza (sección 3).

**Pendiente:** verificar el texto en Android API 24 y API 35 (sección 10).

Pruebas previas actualizadas, solo en las aserciones visuales de valores menores de $1:
- `dashboardAggregatesPhase6B2`: −0,40, deuda 0,40, −0,50, residuo histórico y barrido restringido a \|x\| ≥ 1. Las demás comparaciones bit a bit se mantienen. El texto con U+00A0 se modificó con [`update-6b2-display-expectations.cjs`](../scripts/phase6b3/update-6b2-display-expectations.cjs), que exige coincidencia exacta.
- `dashboardPhase6APrecision`: el formato de referencia sigue la política <$1.
- `dashboardPhase5E3Precision`: el binario 0,4999… se muestra «$ 0,50».
- `financialAuditPhase6B`: la deuda de 0,40 caracterizada ahora es visible. Los intentos parciales siguen rechazados.

## 8. Regresión obsoleta de 6A

En [`scripts/phase6a/androidHarness.js`](../scripts/phase6a/androidHarness.js), la campaña `phase6a-precision` (caso compartido) exigía disponible, deuda y patrimonio bit a bit iguales al dashboard pre‑6A. 6B.2 hizo exacto el patrimonio: `990000.2699999999` → `990000.27`. Ahora esos tres agregados se comparan con un oráculo decimal construido con los centavos de las entradas del escenario:

- activos = 1.000.000,10 − 30.000,15 + 2.000,25
- deuda = 400,15 + 600,20
- patrimonio = activos + 5.000,35 − deuda + 15.000,08 − 1.000,01 = **990.000,27**

Las demás cifras (`recentTransactionCount`, pérdidas, reversiones y recuperaciones) siguen exigiendo igualdad bit a bit con pre‑6A. No hay tolerancias. La prueba Node equivalente (`dashboardAggregatesPhase6B2`, «6A Android shared scenario») ya usaba ese oráculo y aprueba. **La campaña Android no se ha vuelto a ejecutar** (sección 10).

## 9. Atomicidad y `unknown` (Node, SQLite real)

- Liquidación de 0,40, 10.000,40 y 94.562 con un fallo inyectado antes y después de cada escritura: 10 escrituras, 20 puntos por caso, y en todos un único ROLLBACK confirmado con todas las tablas, métricas y auditoría idénticas.
- Un rechazo tras la reconciliación inicial (deuda cambiada) revierte sus escrituras.
- `Infinity`, `-Infinity`, `NaN`, 0, −0,40, 0,001, 0,405, 2^46 y un modo desconocido se rechazan sin escrituras.
- Repetir la misma solicitud confirmada devuelve el mismo resultado sin SQL. No hay un segundo pago.
- Un COMMIT `unknown` no se reintenta: la misma solicitud devuelve el mismo fallo sin SQL y la conexión gestionada queda retirada (política 3A). En la UI, otra pulsación tras `unknown` no envía SQL.
- `integrity_check` ok y `foreign_key_check` vacío en todas las sondas.

## 10. Resultados

| Entorno | Resultado |
|---|---|
| Node | Suite 6B.3: 31/31. Reproducción: 1/1. Jest completo: ver sección 11 |
| Android API 24 / SQLite 3.9.2 | **No ejecutado** |
| HONOR API 35 / SQLite 3.44.5 | **No ejecutado** |

Motivo: el guard del propietario solo permite el runner exacto de 6B.2, con hashes fijados de fuentes, APK y scripts. Cualquier cambio en `src/` retira esa autorización, y los archivos del guard están protegidos frente a escrituras del agente (DG-FILE). Además, la excepción del AVD API 24 era solo para su primer arranque. Para ejecutar campañas hace falta preparar un espacio de trabajo y APK sintéticos de 6B.3 (con este arnés 6A corregido y las sondas 6B.3), un runner 6B.3 y un módulo de guard nuevo que el propietario revise e instale. No he intentado eludir ni variar el comando bloqueado.

## 11. Calidad, rendimiento y regresiones

- `tsc`: 0 errores. ESLint: 0 errores y las 5 advertencias previas. `git diff --check`: limpio.
- Jest completo antes de actualizar las aserciones visuales: 73 suites aprobadas, 4 fallidas y 7 omitidas; 1.036 pruebas aprobadas, 6 fallidas y 14 omitidas. Los 6 fallos eran las aserciones de la sección 7. Tras actualizarlas, pasada completa final: **77 suites aprobadas y 7 omitidas; 1.042 pruebas aprobadas, 0 fallidas y 14 omitidas; 8 snapshots** (378 s). Frente a 6B.2 (75 suites y 1.010 pruebas) se añaden 2 suites y 32 pruebas.
- Siguen aprobando las suites de 6A, 6B.1 (pagos completos, reversión, 52 puntos de 3A y matriz 3B), transferencias y 4×1000, reversiones, gastos compartidos, condonación, suscripciones, IA, borrado y épocas, historial paginado de 50 años, respaldos v2 y CSV.
- Rendimiento: el cambio añade una lectura de cuentas en la liquidación total y comparaciones O(1). No afecta a consultas por volumen; las campañas 1.000/10.000/100.000 de 6A–6B.2 no cambian de ruta. Las sondas con varios pagos en el mismo día son pruebas de corrección, no de rendimiento.
- Jest vuelve a reescribir evidencias JSON de fases anteriores (tiempos y sondas). No las he restaurado.

## 12. Riesgos residuales

- **Android sin validar:** el texto «$ 0,40» y el flujo de UI en Hermes/ICU de API 24 y API 35, y la campaña 6A corregida.
- **Datos heredados:** las deudas o saldos con fracciones de centavo no se reparan. La liquidación total se rechaza con un mensaje claro y la presentación indica «< $ 0,01».
- **Cuotas:** liquidar la deuda no avanza `paidInstallments`, así que el cierre sigue bloqueado mientras haya cuotas vigentes. Es una regla previa y requiere una decisión separada.
- **6B-D5:** sin cambios. No se tocaron las validaciones de importes de IA ni los históricos.
- **Skill de dominio:** `.claude/skills/smartfin-financial-domain/SKILL.md` (y sus copias en `.agents/` y `.codex/`) describe la regla de pago de 3B. Debería añadir el modo `fullDebt`, pero esos archivos están protegidos por el guard; queda para el propietario.
- Los formateadores `toLocaleString` de IA y formularios y `subscriptionPresentation` no se modificaron.

## 13. Veredicto

- **6B-C1: CORREGIDO** en Node. Una deuda legítima con centavos, incluida 0,40, se liquida exactamente solo mediante «Pagar deuda total». Banco y deuda cambian el mismo importe, el patrimonio no cambia y la tarjeta puede cerrarse si no quedan cuotas. Los pagos parciales conservan el contrato 3B, comprobado contra la copia congelada.
- **Presentación <$1:** implementada. Pendiente de verificar en dispositivo.
- **Regresión 6A:** aserción corregida contra un oráculo decimal. Pendiente de volver a ejecutar en Android.
- **Aceptación de 6B.3: condicionada** a las campañas en API 24 y API 35, que necesitan tu autorización y un guard nuevo.
