# Regresión financiera con oráculos independientes

Usa `smartfin-financial-domain` para decidir efectos actuales y `smartfin-sqlite-architecture` para persistencia. No copies sus mapas históricos como nuevas reglas universales. Fuentes iniciales: `src/modules/transactions/useCases/saveManualTransaction.ts`, `src/modules/creditCards/useCases/creditCardTransactionRelations.ts`, `src/modules/dashboard/useCases/getDashboardSummary.ts` y los casos de uso de suscripciones/compartidos.

## Construir el escenario

- Fija fecha civil, zona, reloj JS/SQL y semilla; distingue fecha de operación, `createdAt`, periodo y fecha de cobro. Incluye fin de mes, año bisiesto, cambio de año y diferencias UTC/Bogotá donde afecten el flujo.
- Define cuentas, saldos iniciales, deuda, estados, monedas y relaciones explícitos. COP exacto no significa imponer pesos enteros a todo: sigue parseo, almacenamiento y redondeo de cada operación. El libro usa `REAL`; partes del dominio compartido usan centavos enteros. Prueba ambos límites sin migrar representaciones.
- Usa `__tests__/helpers/financialIntegrityFixture.ts`, `sharedExpenseFixture.ts` o fixtures del módulo, con modo administrado si la operación requiere coordinación; examina sus opciones antes. `realSQLite.ts` usa SQLite real Node en memoria y admite archivo sintético para reinicio. Comprueba `PRAGMA foreign_keys = 1`, `foreign_key_check` sin filas y `integrity_check = ok`.
- Calcula expectativas a mano o mediante una función de referencia independiente: no llames la misma función bajo prueba para construir el esperado. Para equivalencia usa la misma instantánea sintética y baseline identificado, sin tolerancias financieras añadidas para ocultar diferencias.
- Captura estado completo antes/después: todas las tablas/columnas incluso vacías, saldos por cuenta, deuda, disponible, patrimonio, ingreso/gasto/ahorro por periodo, impuestos, cuotas/extractos, vínculos de suscripciones/compartidos, revisión y auditoría. `__tests__/helpers/financialState.ts` ofrece esta comparación para su fixture. Adapta métricas a la operación sin omitir tablas nuevas.

## Matriz de escenarios por operación

| Flujo | Escenario reproducible y aceptación |
|---|---|
| Transferencia | A=1.000.000, B=100.000, capital=100.000: A=900.000 y B=200.000 sin impuesto; patrimonio/disponible conservados con cuentas incluidas. Con 4×1000 vigente, impuesto=400 separado: A=899.600, B=200.000; gasto=400. Comprueba ambas patas, referencias cruzadas y ausencia de segundo impacto del acompañante |
| Pago de tarjeta | Banco=1.000.000, deuda=250.000, pago=100.000: banco=900.000, deuda=150.000, patrimonio=750.000 antes/después y sin gasto adicional. Repite el envío/handler y verifica un solo débito; distingue bloqueo UI, comprobante del flujo e idempotencia persistida |
| Límite y redondeo de pago | Fondos insuficientes, pago mayor a deuda, deuda fraccionaria, 0, negativos, 0,01/0,40/0,49, 0,50 y 1. Verifica rechazo sin cambios o importe efectivo conforme al código. No extiendas la validación de pago entero seguro a impuesto/cuotas/suscripciones |
| Compra/cuotas | Compra completa aumenta gasto/deuda una vez; cuotas/extractos no duplican gasto. Prueba divisor con residuo, progreso pagado, edición sin cambio de términos, cambio autorizado de condiciones y asociación desde crédito por clasificar |
| Reverso/edición/borrado | Revierte impacto anterior completo y aplica nuevo una vez; cubre cambio de cuenta, importe, fecha, tipo/medio/estado, transferencia con impuesto y cuota vinculada. Revisa acompañantes, auditoría, deuda y vínculos, también fuera de la página visible |
| Compartidos | Define total, parte propia, dinero adelantado, cobrado, aplicado/devuelto y condonado desde el contrato actual; exige conservación por participante y cuenta, no solo saldo global. Prueba duplicación de cobro/aplicación, reversos y centavos seguros con `sharedExpenses.test.ts`, `sharedForgiveness.test.ts`, `sharedFinancialTotals.test.ts` |
| Suscripciones | Crear/generar/vencer/recordar no constituye gasto. Vincula un gasto compatible, repite vínculo y evita duplicación. Edita/elimina/incompatibiliza el gasto y comprueba esperado frente a real, reapertura y derivados con fecha fija |
| Conciliación y dashboard | Cruza estados `posted/pending/cancelled`, cuentas activas/cerradas, fechas civiles/ISO y precisión de importes. No presupongas iguales filtros entre dashboard, tarjetas y saldos manuales. Compara resultados por cuenta y periodo y todo el historial relevante |
| Fallo/confirmación desconocida | Inyecta fallos y compara snapshots según [atomicidad](sqlite-atomicity.md). Unknown no equivale a rechazo sin efectos: comprueba estado recuperado y que no se repita automáticamente |

Los valores del ejemplo requieren aislar movimientos iniciales: no atribuyas una compra sembrada al gasto nuevo del pago. Si la implementación contradice el requisito, documenta rojo reproducible; no cambies el requisito para aceptar el defecto.

## Casos límite y selección

Prueba `NaN`, `Infinity`, `-Infinity`, cero, negativos, límites seguros y fracciones en cada entrada afectada, verificando rechazo antes de escritura cuando el contrato lo exige. Distingue valor solicitado, normalizado y persistido; cubre importes positivos que redondean a cero. No introduzcas epsilon nuevo en una refactorización: identifica orden de suma, conversión `REAL` y diferencia exacta.

Puntos de partida vigentes bajo `__tests__/`: `saveManualTransaction.test.ts`, `creditCardTransactionRelations.test.ts`, `creditCardPaymentScreen.test.tsx`, `creditCardSettlementPhase6B3.test.tsx`, `subscriptions.test.ts`, `subscriptionRecurrence.test.ts`, `subscriptionAtomicityPhase4.test.ts`, `sharedExpenses.test.ts`, `sharedForgiveness.test.ts`, `sharedFinancialTotals.test.ts` y `dashboardSummary.test.ts`. Elige por llamadores reales. Un tipo `refund`, `loan` o una tabla no demuestra que exista un flujo de UI completo: caracteriza lo implementado y declara la capacidad faltante.
