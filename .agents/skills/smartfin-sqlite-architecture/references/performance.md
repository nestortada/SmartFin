# Consultas, índices y bloqueos

## Reproducir antes de optimizar

1. Identifica entrada real, SQL, valores enlazados, filtros/selectividad, filas devueltas y consumidor. Cuenta llamadas SQL y volumen materializado/transferido al JS. Una consulta rápida repetida N veces puede ser el problema; un SCAN pequeño puede ser razonable.
2. Usa la misma base sintética, seed, reloj, mezcla de cuentas/categorías/tipos/estados, plataforma y versión antes/después. Lee `AGENTS.md` y `__tests__/helpers/representativeHistory.ts` vigentes: 1.000 en 6 meses, 10.000 en 5 años calendario y 100.000 en exactamente 50 años calendario, terminando en la referencia del fixture. La referencia inicial es 2026-10-25, **no** el día de ejecución.
3. Comprueba conteo, min/max de fechas y años distintos. 100.000 concentrados en un día/mes/importación no es aceptación SmartFin; a ese volumen usa décadas (40+ años, campaña por defecto 50). Empates de 1.000/10.000 son casos de corrección válidos. 50 años producen 50 CSV anuales.
4. Guarda `EXPLAIN QUERY PLAN` del SQL real con parámetros sobre el fixture instalado. Registra `SEARCH`/`SCAN`, índice usado, ordenaciones temporales y consultas auxiliares. Inspecciona prefijos/selectividad de índices simples y compuestos y coste de escrituras/triggers; añadir un índice persistido requiere el procedimiento de migraciones.
5. Mide repeticiones frías/calientes, mediana y dispersión; separa preparación del fixture, tiempo SQL, parseo/mapeo JS, duración de transacción y **espera de un lector/escritor encolado**. Para respaldos separa permiso, checkpoint, cierre, copia, validación/hash, reapertura y publicación. No ocultes el tiempo bloqueado dentro de un total medio.
6. Formula una causa verificable y un cambio acotado: filtro/proyección, consulta agregada, rango/cursor, carga por lotes, índice o eliminación de N+1. Minimiza trabajo independiente dentro del permiso/commit sin mover validaciones vigentes fuera de su protección ni reducir atomicidad.
7. Compara resultados exactos, orden estable, duplicados/omisiones, vínculos, revisión/cancelación y métricas de dominio. No introduzcas tolerancias monetarias nuevas para hacer pasar la optimización. Repite mediciones en igualdad de condiciones; si el beneficio no se reproduce, no lo declares.

## Contratos actuales que cambian decisiones

### Historial

`src/modules/transactions/repositories/sqliteTransactionHistory.ts` usa páginas de 50; lotes de candidatos comienzan en 200 y crecen hasta 6.400. Pruebas de orden por conexión/revisión y búsquedas vacías tienen cachés limitadas a ocho entradas. No almacenan un historial completo de movimientos en caché. Una escritura invalida las comprobaciones; revisión se comprueba al principio/final, y cancelaciones no deben publicar resultados reutilizables.

Las consultas de lotes usan `idx_transactions_civil_sort`, cursor con clave/created_at/rowid y `ORDER BY CAST(... AS TEXT)` sobre un rango acotado por clave. El CAST evita una optimización incorrecta del orden de índice de expresión observada en SQLite Android 3.9.2. No lo quites porque Node moderno muestre un plan atractivo. La ruta de compatibilidad de fechas puede guardar IDs/claves proporcionales a candidatos: no prometas memoria constante para todo formato heredado.

La búsqueda conserva `toLowerCase().includes()` JS y `%`/`_` literales. El prefiltro ASCII `instr(lower(...),?)` deja pasar Unicode/NUL mediante diferencia entre longitud de bytes y texto; JS decide el resultado final. Sustituirlo por LIKE/LOWER solo cambia semántica. Revisa filtros de cuenta y contracuenta, mes civil y orden más antiguo/más reciente con empates.

Pruebas: `__tests__/transactionHistoryPagination.test.ts`, `__tests__/transactionHistoryRefinement.test.ts`, `__tests__/transactionHistoryPhase5E2RangePlan.test.ts`, `__tests__/transactionHistoryPhase5E3FiftyYears.test.ts`. La campaña 50 años tiene casos grandes bajo `SMARTFIN_5E3_LARGE=1`; revisar tiempo/coste y fixture antes de habilitarla.

`getTransactions()` conserva consumidores completos en dominio/IA/edición. No reemplazar su resultado por la página visible ni imponer un tope global de búsqueda para ganar un benchmark.

### Dashboard y compartidos

`src/modules/transactions/repositories/sqliteTransactionRepository.ts` ofrece proyección mensual personal y conteos por día. `src/modules/dashboard/useCases/getDashboardSummary.ts` consume cuentas y proyecciones; `src/shared/utils/exactCopCents.ts` decide acumulación exacta/fallback. No conviertas automáticamente acumulación JS a `SUM(REAL)` ni cambies su orden.

`src/modules/transactions/repositories/sharedFinancialTotalsSql.ts` agrega posición compartida sin materializar contactos/diario en JS. Agrupa primero aplicaciones y participaciones; un JOIN multiplicador puede duplicar deuda aunque la consulta parezca más simple. Valida enteros seguros al cruzar la frontera SQL/JS. Mantén `getState()` para comandos que necesitan el detalle completo.

### Tarjetas y exportación

`src/modules/creditCards/repositories/readCreditCardReconciliationTransactions.ts` y `src/modules/creditCards/repositories/readUnclassifiedCreditTransactions.ts` acotan candidatos sin limitar artificialmente el historial. Preservan orden/predicados que el dominio usa al reconciliar o asociar; no sustituyas por unas páginas recientes.

`android/app/src/main/java/com/smartfin/SmartFinBackupCsv.kt` exporta años civiles y representación decimal de REAL que conserva el Double. Orden anual usa expresión `+COALESCE(...)` para evitar el defecto Android del índice; es un contrato diferente del CAST del historial. No reescribas CSV históricos o redondees para igualar cifras. Las generaciones viejas pueden conservar otro formato sin que el SQLite copiado esté corrupto.

## Evidencia y límites

Inspecciona siempre el generador de cada benchmark existente: hay pruebas históricas que no representan los volúmenes actuales. `__tests__/sharedCommandPerformance.test.js` y otras `.test.js` no se descubren por el `testMatch` TS/TSX de `jest.config.js`; una ejecución normal no acredita que corrieron. Algunos benchmarks además están deshabilitados por variables. Selecciona explícitamente configuración/patrón y permisos adecuados si el encargo exige ejecutarlos; no declares cobertura a partir del nombre del archivo.

No habilites `SMARTFIN_WRITE_EVIDENCE=1` para una verificación rutinaria. `__tests__/setup/redirectEvidenceWrites.js` redirige escrituras de evidencia histórica a artifacts por defecto. Conserva la evidencia anterior y comunica dónde quedaron las muestras nuevas.

No impongas aquí un objetivo de ms inventado. Usa el objetivo aceptado para la tarea/plataforma y reporta mediciones y límites. Los tiempos Node no certifican latencia Android, WAL, memoria del bridge ni espera nativa.
