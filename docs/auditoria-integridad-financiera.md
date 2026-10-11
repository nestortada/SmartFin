# Auditoría correctiva de integridad financiera

11 de octubre de 2026. Solo SQLite en memoria, datos sintéticos, FK habilitadas y reloj fijo en los casos de uso. No se abrieron bases financieras del usuario.

## Reproducción antes de cambiar producción

Se ejecutó `npm test -- --runInBand --no-cache __tests__/financialIntegrity.test.ts __tests__/transactionsScreen.test.tsx` antes de modificar producción: **7 fallos y 15 pruebas aprobadas**, en 2 suites (22 pruebas). Los siete fallos siguientes son aserciones financieras o de referencias, no errores del entorno.

Fixture principal en COP: banco inicial 1.000.000, compra 250.000, pago 100.000; todas las cuentas activas. Ingresos 0 y gasto de compra 250.000.

| Operación | Resultado anterior incorrecto | Resultado exigido |
|---|---|---|
| Débito → crédito rápido | Banco 750.000, deuda 250.000, patrimonio 500.000 | Banco 1.000.000, deuda 250.000, patrimonio 750.000 |
| Crédito → débito rápido | Banco 1.000.000, deuda 0, patrimonio 1.000.000 | Banco 750.000, deuda 0, patrimonio 750.000 |
| Borrar pago con medio débito | Banco 1.000.000, deuda 150.000, patrimonio 850.000 | Banco 1.000.000, deuda 250.000, patrimonio 750.000 |
| Editar pago a 50.000 en caso de uso | Pierde `targetAccountId`; no reconcilia deuda | Banco 950.000, deuda 200.000, patrimonio 750.000; destino conservado |
| Editar pago desde acción de pantalla | Lo convierte en `expense` y pierde destino | Conserva `creditCardPayment`, destino y fecha; gasto sigue 250.000 |
| Registrar `Infinity` manual | Operación aceptada; persiste importe infinito | Rechazo antes de escribir |
| Guardar cuotas sin cambios | `paidInstallments` pasa de 1 a 0 y reemplaza primer vencimiento | Conserva progreso y primer vencimiento |

Descartados para los escenarios probados: conversión mediante el caso de uso manual (ambas direcciones), reverso de transferencia con impuesto y acompañantes, aceptación manual de `NaN`/`-Infinity`, aceptación de los tres importes no finitos por el registro de pagos. Estas pruebas no acreditan todos los estados o entradas posibles.

## Atomicidad: fase independiente

Las pruebas de caracterización aprobadas reproducen los límites actuales; **aprobarlas no significa que el flujo sea atómico**:

- Fallo al insertar transferencia de 100.000 con impuesto: banco 899.600 y destino 100.000 quedan confirmados, pero no hay movimientos ni gasto de impuesto. Patrimonio 999.600.
- Fallo al insertar pago de 100.000: banco 900.000 queda confirmado, deuda sigue 250.000, pago inexistente y patrimonio 650.000.
- Fallo al borrar un gasto: banco vuelve a 1.000.000, pero el gasto de 250.000 permanece.

Los repositorios de cuentas y movimientos tienen transacciones propias; no existe un commit único para saldos, movimientos, acompañantes, cuotas y extractos. El repositorio de movimientos sí incluye conciliaciones de suscripciones en su transacción. Los lotes IA ya participan en un `BEGIN IMMEDIATE` exterior mediante `sqliteWithinExistingTransaction`.

La solución integral requiere un límite de operación compartido para alta/edición/borrado/pagos, coordinación de conexión con mantenimiento/respaldo, participación de repositorios sin transacciones anidadas y política de reintentos que no reaplique impactos. Debe incluir fallos después de cada escritura, revisiones financieras y efectos posteriores al commit. Se necesita autorización para esa fase antes de implementarla; no se introduce compensación manual como sustituto de rollback.

## Validación posterior

Los siete fallos iniciales pasan después de las correcciones. La suite completa final tiene **214 pruebas aprobadas y 3 omitidas**, en 28 suites aprobadas y 3 suites de benchmark omitidas. Se añadieron 20 escenarios ejecutados respecto de las 194 pruebas previas: 16 en `financialIntegrity.test.ts` y 4 en `transactionsScreen.test.tsx`. Los fixtures están en memoria, usan FK y comprueban `foreign_key_check`; el reloj se fija tanto en los casos de uso como en las pruebas de pantalla. Se incluyen repetición de acciones desde una selección antigua, fecha histórica fuera del mes, identidad de cuotas y comparación de saldos/deuda/disponible/patrimonio/ingreso/gasto/ahorro.

También se confirmó después de las correcciones el límite de commit del extracto: al fallar su escritura durante la edición de un pago a 50.000, el banco queda en 950.000, la deuda en 200.000 y el movimiento en 50.000, mientras el extracto conserva 150.000 en lugar de 200.000. Es una caracterización de atomicidad pendiente, no un fallo corregido.

TypeScript (`npx tsc --noEmit`) y ESLint (`npm run lint`) aprobados. La skill pasó `quick_validate.py` con Python en modo UTF-8. Los benchmarks omitidos no se presentan como mediciones nuevas.

## Correcciones y archivos

- `src/modules/transactions/useCases/saveManualTransaction.ts`: rechazo de importes no finitos antes de escribir; conservación del destino y reconocimiento del pago al reconciliar edición/borrado; helper compartido de cuotas que conserva progreso/vencimiento si las condiciones no cambiaron. Cambiar importe o número de cuotas conserva el comportamiento anterior de regeneración; no se define una política nueva de amortización.
- `src/modules/transactions/useCases/updateTransactionQuickly.ts` y `useCases/index.ts`: acciones rápidas de gastos con estado persistido y reverso mediante el caso de uso manual; guardado de cuotas mediante el helper compartido. Se conserva la selección de cuenta débito y resolución de tarjeta existentes.
- `src/modules/transactions/ui/TransactionsScreen.tsx`: delegación de acciones rápidas y conservación del tipo de pago al abrir edición. Se eliminó la duplicación de reglas de saldo y cuota en esas acciones porque ahora reside en casos de uso.
- `src/modules/transactions/ui/components/AddTransactionModal.tsx` y `TransactionCard.tsx`: edición identificada como pago de tarjeta y bloqueo de conversiones incidentales a gasto/crédito desde esos controles.
- `__tests__/financialIntegrity.test.ts`, `__tests__/helpers/financialIntegrityFixture.ts` y `__tests__/transactionsScreen.test.tsx`: reproducciones, regresiones y caracterizaciones de fallos.
- `.agents/skills/smartfin-financial-domain/SKILL.md`: comprobaciones generales para pagos con medio débito, importes no finitos, acciones repetidas y cuotas sin cambios; referencias a regresiones y distinción entre caracterización y rollback.
- Este informe: resultados previos, comparación financiera y alcance de atomicidad pendiente.

No se modificaron repositorios de consultas, esquema, migraciones, driver ni coordinación global. No se reescribió ningún movimiento histórico del usuario.

## Rendimiento y límites pendientes

La fase 1 conserva `SectionList`, tarjetas individuales, claves, secciones y espaciados: pasan sus pruebas de pantalla, incluyendo 1.000 filas virtualizadas. La fase 2 conserva proyecciones y orden de suma del dashboard: pasa su equivalencia con el baseline y la comprobación de consultas estrechas. Las fases 3 y 3.1 conservan paginación, cancelación, revisiones, búsqueda y cachés: pasan `transactionHistoryPagination`, `transactionHistoryRefinement` y `useTransactionsPagination`. Esos archivos de producción permanecen sin cambios; en la pantalla se editaron solo acciones financieras e importaciones. No se efectuó una campaña Android ni se prometen tiempos de ejecución.

Permanecen los cuatro estados parciales caracterizados, la coordinación/concurrencia de operaciones financieras y sus reintentos, y la regeneración de progreso cuando se cambian condiciones de cuotas. La deuda de crédito por clasificar y la diferencia entre `posted` del dashboard y no-`cancelled` de tarjetas son reglas actuales preservadas. Las correcciones no reparan automáticamente inconsistencias ya almacenadas ni acreditan el comportamiento del driver Android.
