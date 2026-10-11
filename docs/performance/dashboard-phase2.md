# Dashboard: optimización de consultas, fase 2

Fecha: 10 de octubre de 2026. Referencia anterior: `a9dd112859e51c099905d1806f992c2628b7b41c`.

Se aplicó el ciclo medir → optimizar → volver a medir → validar de la [skill de Callstack](../../.agents/skills/react-native-best-practices/SKILL.md). Se revisaron `AGENTS.md`, `ARQUITECTURA.md`, `BASE_DE_DATOS.md`, el esquema, los repositorios y los consumidores del historial. El árbol de trabajo estaba limpio al empezar. El cambio se limita al dashboard; no modifica la pantalla de movimientos, otros hallazgos de Callstack, dependencias ni integraciones.

## Análisis y línea base

`getDashboardSummaryFromDb` ejecutaba dos SELECT: cuentas ordenadas por nombre y **todo** el historial con 19 columnas, ordenado por `date DESC, created_at DESC`. Convertía cada fila a `Transaction`, filtraba y sumaba en JavaScript.

La versión anterior se conservó en `__tests__/helpers/dashboardSummaryBaseline.ts` antes de modificar producción. Las primeras diez pruebas de comparación pasaron contra el código original. Antes del cambio también pasaron las 158 pruebas existentes, TypeScript y ESLint. La primera medición se conserva en [dashboard-phase2-baseline.json](dashboard-phase2-baseline.json).

### Inventario de consultas y consumidores

| Consumidor / consulta | Información que necesita | Posible sustitución | Acción en esta fase |
|---|---|---|---|
| Dashboard: ingresos/gastos del mes | Importes de movimientos `posted` del mes y pares tipo/dirección pertinentes | Proyección filtrada por fecha, estado, tipo y dirección | Implementada |
| Dashboard: movimientos recientes | Cantidad de todos los movimientos `posted` de la ventana local | `COUNT(*)` por prefijo de día y filtro local final | Implementada |
| Dashboard: saldos, deuda y patrimonio | Saldos persistidos de cuentas activas según tipo | Proyección o agregado de cuentas; no depende del historial | Lectura y cálculo originales conservados |
| `getDashboardSummary` y `seedSmartFinDatabase` | Mock síncrono, usado como referencia/seed | No necesita SQL | Conservado |
| `useTransactionsList` → `TransactionsScreen` | Historial, filtros, búsqueda y orden de movimientos | Consulta filtrada/paginada con contrato de navegación | Fuera de alcance por instrucción expresa |
| `getDebitCardsOverview` | Movimientos por cuenta, métricas mensuales y tendencia semanal | Filtrar por cuentas; proyecciones por periodo para métricas | Identificado; conservado |
| `getCreditCardsOverview` | Movimientos por tarjeta/contracuenta, estado y periodo del extracto; historial si no hay extracto | Consulta por cuentas y rango opcional, conservando pendientes | Identificado; conservado |
| `reconcileCreditCardTransactions` | Gastos/pagos confirmados, deuda histórica y cargos del extracto vinculados a cuotas | Proyecciones por cuenta/tipo/estado; agregados requieren preservar precisión y reglas de cuotas | Identificado; conservado por riesgo contable |
| `associatePendingTransactionsForCreditCard` | Compras de crédito de cuenta sin clasificar, pistas de tarjeta y notas | Consulta por cuenta/medio de pago; comparación de pistas en caso de uso | Identificado; conservado |
| `saveManualTransaction`, `deleteManualTransactionSafely` | Movimiento y acompañantes de transferencia/impuesto | Búsqueda por IDs específicos | Identificado; conservado |
| `useAiAssistantController`, `executeAiCommandPlan` | Contexto, búsqueda y resolución de movimientos de ingreso/gasto/transferencia | Proyección por tipos y búsqueda específica con la misma desambiguación | Identificado; conservado |
| Suscripciones: `loadSubscriptionState`, `getFormOptions` | Movimiento solicitado o IDs vinculados a cobros | Ya filtra por ID/IDs vinculados | Conservado |
| Suscripciones: candidatos de pago | Gastos confirmados positivos en COP, cuenta opcional, búsqueda y ventana de sugerencias | Ya aplica filtros y exclusión de movimientos vinculados en SQL | Conservado |
| Respaldo CSV nativo `SmartFinDriveBackupModule` | Exportación completa del historial por año | El historial completo es parte del resultado solicitado | Conservado |

Las escrituras, recategorizaciones y eliminaciones no son consultas de carga del dashboard y permanecen intactas.

## Implementación y equivalencia contable

El repositorio existente incorpora dos métodos con contratos en `TransactionQuery.ts`. El caso de uso determina periodos, estado y operaciones; el repositorio solo selecciona/mapea datos. La UI y los hooks siguen consumiendo la misma API y el mismo `DashboardSummary`.

La proyección mensual ejecuta:

```sql
SELECT amount, type, direction FROM transactions
WHERE date >= ? AND date < ? AND status = ?
  AND substr(date, 1, ?) = ?
  AND ((type = ? AND direction = ?) OR (type = ? AND direction = ?))
ORDER BY date DESC, created_at DESC;
```

Para octubre de 2026: inicio `2026-10`, fin exclusivo `2026-11`, estado `posted`, prefijo `2026-10`, pares `income/inflow` y `expense/outflow`. El prefijo adicional conserva exactamente la comparación previa `slice(0, 7)`, incluso para cadenas heredadas. Incluye fechas futuras del mismo mes, como antes. No convierte las fechas almacenadas a UTC ni usa `date()` para el criterio mensual.

**Riesgo de precisión preservado:** los importes son `REAL`/números JS. Sustituir su reducción por `SUM` o cambiar su orden puede producir un resultado diferente. Se explicó el riesgo antes de implementar y se conservó la reducción JavaScript con `date DESC, created_at DESC`. Las pruebas incluyen fracciones, valores grandes y empates. No se introducen redondeos ni una representación monetaria nueva.

El conteo reciente ejecuta:

```sql
SELECT substr(date, 1, 10) AS date, COUNT(*) AS count FROM transactions
WHERE date >= ? AND date < ? AND status = ?
GROUP BY substr(date, 1, 10);
```

El caso de uso conserva el intervalo inclusivo original: entre la medianoche local actual menos `30 × 24 h` y la medianoche local actual. Aplica el mismo constructor `new Date(prefijo + 'T00:00:00')` a cada grupo. Esto conserva el comportamiento durante cambios de horario. La consulta lee tres días adicionales antes del inicio para conservar fechas heredadas como `2026-02-30`, que JavaScript normaliza; esos grupos adicionales pasan por el predicado original y solo cuentan si pertenecen a la ventana. No se descargan movimientos individuales para contar.

Ingresos y gastos excluyen pendientes/cancelados, transferencias internas, pagos de tarjeta/préstamo, reembolsos, inversiones y ajustes, igual que antes. Los gastos de compra con tarjeta sí cuentan cuando son `expense/outflow/posted`. Todos los tipos `posted`, incluidas las dos patas de una transferencia, cuentan en recientes. Saldos, deuda y patrimonio siguen usando los saldos de cuentas persistidos, con los mismos tipos y estados.

Ambas consultas al historial usan el índice existente, comprobado con `EXPLAIN QUERY PLAN`:

```text
SEARCH transactions USING INDEX idx_transactions_date (date>? AND date<?)
```

SQLite todavía usa estructuras temporales para completar el orden mensual y agrupar días. Estas operan sobre el rango seleccionado. No se añadieron índices ni migraciones.

## Comparación funcional sobre los mismos datos

Cada comparación ejecuta la referencia y la versión optimizada sobre **la misma base SQLite**, sin escribir entre lecturas. Se compara el objeto completo con igualdad exacta, sin tolerancia ni redondeo.

| Campo | Antes | Después |
|---|---:|---:|
| Saldo disponible | 3100 | 3100 |
| Deuda total | 1000 | 1000 |
| Patrimonio | 7100 | 7100 |
| Ingresos del mes | 3400 | 3400 |
| Gastos del mes | 950 | 950 |
| Ahorro del mes | 2450 | 2450 |
| Movimientos recientes | 17 | 17 |

Esta fixture combina cuentas activas/inactivas/cerradas, todos los tipos de movimiento, direcciones incompatibles, pendientes/cancelados, compras de crédito/débito, las dos patas de transferencia, meses adyacentes y movimientos futuros. La revisión de datos persistidos tampoco cambia tras cargar el dashboard.

Además se comparan bases de 1000, 10 000 y 100 000 movimientos, cambios de año/mes, febrero bisiesto, límites inclusivos de recientes, prefijos con horas/offsets, cambios de horario y fechas heredadas normalizadas. En la base de 100 000 movimientos se conservan exactamente los resultados fraccionarios previos, por ejemplo ahorro `77787.99999999994`.

## Rendimiento medido y reproducción

Entorno: Windows x64, Node `v24.16.0`, SQLite `3.53.0` mediante `node:sqlite`, Intel Core i5-12450H, 12 procesadores lógicos, aproximadamente 16 GB de RAM, zona `America/Bogota`. Fecha funcional fijada al 10 de octubre de 2026 al mediodía local.

Se generan movimientos deterministas repartidos en 1096 días, ocho tipos y estados 70 % confirmados, 20 % pendientes y 10 % cancelados; los registros contienen descripciones/notas sintéticas. Se usa el esquema real, incluidos sus índices y triggers, en una base en memoria. Preparar los datos no forma parte del tiempo medido.

La comparación usa tres calentamientos y siete muestras por versión/tamaño. El reloj final es `node:perf_hooks.performance.now`; el archivo de línea base inicial usaba el reloj del preset de Jest con resolución de 1 ms. La tabla siguiente procede de la [comparación final con reloj de alta resolución](dashboard-phase2-comparison.json), que vuelve a medir la referencia y la optimización con el mismo instrumento y los mismos datos.

| Movimientos almacenados | Latencia mediana antes → después | Tiempo SQL/materialización antes → después | Filas del historial devueltas antes → después | Heap JS muestreado antes → después (MiB) |
|---:|---:|---:|---:|---:|
| 1000 | 6,67 → 0,49 ms | 2,73 → 0,23 ms | 1000 → 19 | 3,35 → 0,06 |
| 10 000 | 50,33 → 0,80 ms | 22,27 → 0,55 ms | 10 000 → 47 | 33,09 → 0,09 |
| 100 000 | 649,20 → 4,70 ms | 349,72 → 4,33 ms | 100 000 → 162 | 168,93 → 0,20 |

En 100 000 movimientos la reducción de latencia es aproximadamente **99,28 %**. Las 162 filas son 128 proyecciones de tres columnas y 34 agregados diarios. El total de SELECT por carga pasa de **2 a 3**, incluyendo cuentas. El volumen JSON equivalente de todas las filas devueltas pasa de 64 777 345 a 10 314 bytes; se calcula en una pasada aparte, fuera de la medición temporal.

La memoria es la mediana de tres ejecuciones con GC previo: se muestrea `heapUsed` después de materializar cada consulta y al finalizar el resumen, y se resta el valor inicial. Es una aproximación del máximo observado, no un perfil continuo ni memoria nativa/total de la aplicación. Las mediciones individuales, consultas, parámetros, planes y resúmenes están en el JSON.

Desde la raíz del proyecto, en PowerShell:

```powershell
$env:SMARTFIN_DASHBOARD_BENCHMARK = 'comparison'
node --expose-gc node_modules/jest/bin/jest.js --runInBand --runTestsByPath __tests__/dashboardPerformance.test.ts
Remove-Item Env:SMARTFIN_DASHBOARD_BENCHMARK
```

El comando regenera `docs/performance/dashboard-phase2-comparison.json`. El modo `baseline` mide solamente la referencia. El benchmark se omite por defecto en Jest y se ejecutó explícitamente para esta entrega. No requiere nuevas librerías.

## Validación ejecutada

```powershell
npm test -- --runInBand
npx tsc --noEmit
npm run lint
$env:TZ = 'America/New_York'
npx jest --runInBand --runTestsByPath __tests__/dashboardSummary.test.ts
Remove-Item Env:TZ
```

- Jest: **24 suites y 173 pruebas funcionales aprobadas**, incluidas las 158 existentes; un benchmark omitido por defecto.
- Benchmark explícito: aprobado para las tres bases, con igualdad funcional comprobada en cada muestra.
- TypeScript estricto y ESLint completo: aprobados sin errores ni advertencias.
- Las 15 pruebas nuevas de dashboard también pasan en `America/New_York`, además de `America/Bogota`.

## Archivos modificados o añadidos

- `src/modules/dashboard/useCases/getDashboardSummary.ts`: reemplaza la carga completa por proyección mensual y conteos diarios; reutiliza las reglas de cálculo originales.
- `src/modules/transactions/repositories/sqliteTransactionRepository.ts`: añade consultas específicas sin cambiar `getTransactions` ni escrituras.
- `src/modules/transactions/types/TransactionQuery.ts`: contratos tipados de consultas/proyecciones/agregados.
- `__tests__/dashboardSummary.test.ts`: pruebas funcionales y de acceso por índice.
- `__tests__/dashboardPerformance.test.ts`: benchmark reproducible con mediciones y comparación exacta.
- `__tests__/helpers/dashboardFixture.ts`: bases sintéticas deterministas.
- `__tests__/helpers/dashboardSummaryBaseline.ts`: referencia anterior congelada.
- `docs/BASE_DE_DATOS.md`: documentación de las nuevas lecturas.
- `docs/performance/dashboard-phase2.md`: este informe.
- `docs/performance/dashboard-phase2-baseline.json` y `dashboard-phase2-comparison.json`: evidencia de las mediciones.

## Limitaciones pendientes

- Las mediciones son de Node/SQLite en Windows, sin Hermes ni el puente Android. No representan latencia, RSS, FPS o TTI de una compilación móvil. Falta medir el refresco en un dispositivo con una compilación de producción.
- Para preservar la precisión existente, la memoria mensual sigue creciendo con el número de ingresos/gastos pertinentes del mes. Se elimina la dependencia del historial completo, pero no se sustituye esa suma por un agregado monetario SQL.
- Se conserva el orden SQL previo incluso en empates; no se añade un desempate nuevo. Cambios futuros de índices/orden o representación monetaria requieren repetir la comparación de importes fraccionarios.
- Los demás consumidores de `getTransactions` conservan su comportamiento. La paginación de `TransactionsScreen` queda para otra fase.
