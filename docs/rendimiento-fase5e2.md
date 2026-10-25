# SmartFin 5E.2 — rendimiento del historial y diagnóstico del dashboard

Fecha: 24-25 de octubre de 2026. Alcance: adaptador interno del historial
([sqliteTransactionHistory.ts](../src/modules/transactions/repositories/sqliteTransactionHistory.ts)).
Sin cambios de esquema, migraciones, índices, driver, dependencias, reglas financieras,
Kotlin, comprobantes IA, notificaciones, borrado ni respaldos v2.
`BACKUP_PUBLICATION_UI_ENABLED` sigue en `false`. Solo datos sintéticos.

Artefactos: [`rendimiento-fase5e2/`](rendimiento-fase5e2) — Node (`node/`), Android
(`android/api24`, `android/api35`, intentos conservados en `android/attempt*`), calidad
(`quality/`), [defecto 5E2-001](rendimiento-fase5e2/defecto-5e2-001.md) y
[resumen Android](rendimiento-fase5e2/android/summary.md).

## 1. Causa comprobada de la lentitud del historial

Dos causas independientes, medidas sobre SQLite real con el adaptador 5E.1 congelado
([diagnóstico](rendimiento-fase5e2/node/diagnostic-5e1.json)):

1. **Ruta de compatibilidad completa.** La prueba canónica de 5E.1 solo aceptaba claves de
   longitud 20/24. Cualquier `YYYY-MM-DD` (o mezcla) la hacía fallar y la primera página
   recorría todo el historial: 100k filas → **505 sentencias y 100.053 filas transferidas**
   para entregar 50, más un `sort` JS de 100k con dos `new Date()` por comparación.
2. **Orden incompatible con el índice.** `idx_transactions_civil_sort` es
   `(clave ASC, created_at DESC)`. Para `clave DESC, created_at DESC, rowid DESC` SQLite
   moderno muestra `USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY`: cada lote ordena el
   grupo de empate entero. Con el fixture 5E (100k filas del mismo día y `created_at`) cada
   lote de 200 cuesta ~30 ms de motor: 505 × 30 ms ≈ 14,5 s en Node (12,98 s API 24 y
   62 s HONOR en 5E.1). No era el índice ausente: era recorrer y reordenar demasiadas veces.

La validación de fechas (~0,1–150 ms) y la construcción de objetos (<0,3 ms por página) no
explicaban la latencia. El coste dominante fue motor + puente por número de filas/sentencias.

**Defecto adicional encontrado (5E2-001).** En SQLite 3.9.2 el planificador considera que el
recorrido del índice de expresión satisface *todo* el `ORDER BY` en ambos sentidos. 5E.1 lo
corrigió para oldest; newest (páginas keyset **y** escaneo de compatibilidad) devolvía empates
de clave con `created_at` distintos en orden de índice → duplicados/omisiones. Medido en
API 24: 5E.1 entregó **74.358 de 100.000** movimientos en legacyDay 100k, y difiere del
oráculo en civil/legacyDay/legacyWithCivil (10k y 100k). Los fixtures 5E.1 usaban
`created_at` constante y no lo detectaban. El hook deduplica por id: el síntoma visible era
**omisión y desorden**. Detalle y sonda: [defecto-5e2-001.md](rendimiento-fase5e2/defecto-5e2-001.md).

## 2. Planes SQL y número de consultas

| Consulta | 5E.1 | 5E.2 |
|---|---|---|
| Prueba de orden | `LIMIT 1` + `DISTINCT` con salida temprana (falla en `YYYY-MM-DD`) | 1 agregado sobre claves `DISTINCT` (+1 consulta de empates solo si hay mezcla día/instante) |
| Página newest | `SCAN USING INDEX` + `TEMP B-TREE FOR LAST 2 TERMS` (3.9.2: sin sort → orden erróneo) | `SEARCH USING INDEX (<expr><? / >?)` acotado + `TEMP B-TREE FOR ORDER BY` del rango |
| Página oldest | `TEMP B-TREE FOR ORDER BY` de **todo** el resto del historial | mismo sort, solo del rango acotado |
| Compatibilidad | 505 lotes de 200 a 100k | lotes 200→6.400 (24 a 100k), mismo orden corregido |
| Primera página 100k, sentencias/filas | legacyDay 505/100.053 | legacyDay 4/54 |

`EXPLAIN` por el driver de Android 15 falla con `SQLITE_ROW`; los planes API 35 no están
disponibles por esa vía (se registra el error). Planes 3.9.2 en
[`android/api24`](rendimiento-fase5e2/android/api24), planes Node en
[`node/keyset-plans.json`](rendimiento-fase5e2/node/keyset-plans.json) y
[`node/proof-access-paths.json`](rendimiento-fase5e2/node/proof-access-paths.json).

## 3. Datos canónicos frente a heredados

JS ordena por `new Date(clave)` (orden estable sobre el orden SQL); SQL por texto.

| Distribución | Prueba 5E.2 | Ruta newest / oldest |
|---|---|---|
| Canónica 24 o 20 caracteres | ordenada | keyset / keyset |
| `YYYY-MM-DD` válidas homogéneas | ordenada | keyset / keyset |
| `civil_date` (fecha u hora) | ordenada | keyset / keyset |
| `YYYY-MM-DD` + un formato completo sin instantes iguales | ordenada, sin empates | keyset / keyset |
| `YYYY-MM-DD` + `DT00:00:00(.000)Z` del mismo día | ordenada, con empates | keyset / **compatibilidad** |
| Mezcla 20 + 24 (`…:00Z` > `…:00.500Z` en texto) | no ordenada | compatibilidad |
| Inválidas, imposibles (`2026-02-31`, `2026-13-01`), offsets | no ordenada | compatibilidad |

Precondiciones demostradas: para claves válidas de un formato, o de día más **un** formato
completo, un instante posterior siempre tiene texto mayor (el texto refina el orden
temporal), luego newest coincide con el orden estable JS. Oldest además exige que ningún día
`D` coexista con `DT00:00:00(.000)Z` (empate JS que conserva el orden newest). El motor debe
interpretar `YYYY-MM-DD` como medianoche UTC (sonda `DATE_ONLY_IS_UTC`, verdadera en V8 y
Hermes). No se normalizan, reescriben ni migran fechas históricas.

## 4. Optimización implementada

Todo en el adaptador interno, sin cambiar el contrato público ni el tipo del cursor:

- **Prueba de orden generalizada** (`proveDateOrder`): acepta `YYYY-MM-DD` válidas y
  mezclas día/instante; la prueba se guarda por filtro como `{ordered, ties}` y una prueba
  global solo se reutiliza en subconjuntos para el orden que demuestra. Con filtro de
  categoría deja al planificador usar `idx_transactions_category_id` (claves DISTINCT
  idénticas en cualquier plan). `strftime` solo para días 29–31.
- **Orden correcto en 3.9.2** (`ORDER_KEY_SQL`): `CAST(clave AS TEXT)` en ambos sentidos,
  la técnica de 5E.1 para oldest; la clave ya es TEXT.
- **Rango por lote** (`batchRange`): un `LIMIT n` en orden clave-mayor solo contiene filas
  con clave hasta la de la n-ésima fila; una subconsulta con el mismo predicado calcula esa
  clave (orden de un solo término, correcto también en 3.9.2) y el sort completo toca solo
  ese rango. Con menos de n filas el límite es la clave extrema de la tabla.
- **Lotes crecientes** 200 → 6.400 en búsquedas y compatibilidad (menos sentencias y menos
  reordenamientos), manteniendo exactamente la regla de cursor de los bloques de 200.
- **Compatibilidad**: `Date` se calcula una vez por fila (mismo comparador, mismos valores,
  incluso `NaN`); texto de búsqueda solo si hay búsqueda.

Se conservan páginas de 50, búsqueda en todo el historial, filtros, desempates, revisión
financiera, cancelación, caché de fallos y la corrección 5E-001 (sin `INDEXED BY` en una
sentencia sin orden ni predicado utilizable).

## 5. Equivalencia exacta

- Node: [transactionHistoryPhase5E2.test.ts](../__tests__/transactionHistoryPhase5E2.test.ts)
  recorre todas las páginas en paralelo contra el
  [adaptador 5E.1 congelado](../__tests__/helpers/transactionHistoryPhase5E1.ts) para 13
  distribuciones × 7 tamaños (0, 1, 49, 50, 51, 1000, 3000) × 13 filtros/búsquedas (ASCII,
  Unicode, `İω`, NUL, `%_`, solo espacios, ausente, mes, cuenta con destino de transferencia,
  categoría, combinados) × 2 órdenes, más 10k en 5 distribuciones. Objetos completos y cursor
  completo idénticos cuando ambas versiones usan la misma representación. Al pasar de
  compatibilidad a keyset con búsqueda, puede aparecer **una página final vacía**: es el
  comportamiento keyset ya existente en 5E.1 y se verifica que esté vacía y sin cursor.
  También: frontera de cursor de 200, selección de ruta, prueba con empates no reutilizada
  para oldest, cancelación, escritura concurrente, revisión, fecha inválida introducida
  después e historial vacío. Suites de historial, 5E.1 y pantalla: 149 pruebas aprobadas.
- Android: oráculo JS independiente del planificador (todas las filas, orden
  clave/created_at/rowid en JS y semántica congelada del hook); 5E.2 **igual en todas las
  páginas y sin duplicados/omisiones** en API 24 y API 35; la coincidencia de 5E.1 se
  registra aparte. Dashboard: cada versión estable entre muestras; diferencias entre versiones
  registradas sin tolerancia.

## 6. Resultados Node 1k/10k/100k

Node 24.16, SQLite de `node:sqlite`, 1 calentamiento + 5 muestras (3 a 100k), orden de
versiones alternado, conexión fría por muestra, páginas 1 y 2 comparadas en cada muestra.
Tabla completa: [node/history-benchmark.md](rendimiento-fase5e2/node/history-benchmark.md).
Primera página, mediana (mín–máx) ms:

| 100k | 5E.1 | sent./filas | 5E.2 | sent./filas |
|---|---:|---:|---:|---:|
| legacyTied newest (fixture 5E) | 13.290 (13.016–14.148) | 505/100.053 | 152 (133–189) | 4/54 |
| legacyTied oldest | 13.716 (13.668–13.747) | 505/100.053 | 136 (135–141) | 4/54 |
| legacyDay newest | 555 (540–579) | 505/100.053 | 6,1 (5,7–6,2) | 4/54 |
| legacyDay oldest | 576 (543–609) | 505/100.053 | 6,5 (5,5–7,0) | 4/54 |
| legacyWithCivil newest | 479 (469–489) | 505/100.053 | 10 (10–10) | 5/55 |
| legacyWithCivil oldest (empates → compat.) | 499 (498–513) | 505/100.053 | 367 (362–367) | 25/100.054 |
| mixed newest (inválidas → compat.) | 3.465 (3.422–3.530) | 505/100.053 | 616 (594–617) | 24/100.053 |
| canonicalUtc newest | 113 (110–123) | 5/54 | 82 (67–113) | 4/54 |
| civil newest | 6,2 (5,9–6,3) | 5/54 | 5,6 (5,3–5,6) | 4/54 |
| civil oldest | 12 (11–12) | 5/54 | 5,7 (5,4–6,0) | 4/54 |

Regresiones medidas (coste del orden correcto en 3.9.2): búsqueda ausente 0,8× (p. ej.
legacyDay 308 → 391 ms), filtros combinados muy selectivos 0,4–0,6× (civil 65 → 130 ms,
legacyWithCivil 85 → 191 ms) y segundas páginas en grupos de empate gigantes (legacyTied
0,4 → ~135 ms: cada página ordena el grupo). A 1k todo está por debajo de 6 ms.

## 7. Android API 24 y HONOR API 35

APK release sintético `com.smartfin.snapshot5b2.tests` (UID aislado, metadatos de
`com.smartfin` sin cambios, huella de fuentes incrustada; adaptador idéntico byte a byte a
producción). 1 calentamiento + 3 muestras por versión alternadas; en 100k lentos, 5E.1 tiene
**una sola muestra fría** (n=1, intercalada). Sin p95. El runner no cambia ajustes del
dispositivo: envía WAKEUP cada 20 s y registra pantalla, batería, temperatura y PID.

Condiciones: API 24 emulador (`SmartFin_Atomicity_API24`, SQLite 3.9.2), Awake en las 159
lecturas, alimentación AC. HONOR CRT-NX3 (SQLite 3.44.5): Awake en todas las lecturas durante
campaña; una lectura Asleep **posterior** a terminar `history-legacyDay-100000`; batería
99–100 %, 32–35 °C.

Primera página, mediana (mín–máx) ms:

| Caso | API 24 5E.1 | API 24 5E.2 | HONOR 5E.1 | HONOR 5E.2 |
|---|---:|---:|---:|---:|
| legacyTied 100k newest | 23.429 (n=1) | 565 (318–581) | 110.946 (n=1) | 370 (362–1.318) |
| legacyTied 100k oldest | 23.662 (n=1) | 478 (421–531) | 69.834 (n=1) | 1.102 (367–1.198) |
| legacyTied 100k búsqueda 49 | 31.332 (n=1) | 1.576 | 99.707 (n=1) | 1.563 |
| legacyTied 100k ausente | 15.901 (n=1) | 3.867 | 82.165 (n=1) | 8.045 |
| legacyDay 100k newest | 4.287 (n=1, **incompleto**) | 225 (216–228) | 23.329 (n=1) | 121 (110–169) |
| legacyDay 100k ausente | 2.417 (n=1) | 2.626 | 13.248 (n=1) | 9.590 |
| legacyWithCivil 100k newest | 2.833 (n=1, incompleto) | 314 | 14.645 (n=1) | 105 |
| legacyWithCivil 100k oldest | 2.828 (n=1, incompleto) | 1.713 | 13.830 (n=1) | 3.847 |
| civil 100k newest | 202 (incorrecto) | 212 | 125 | 124 |
| civil 100k oldest | 600 | 194 | 191 | 119 |
| civil 100k combinado | 208 | 369 | 462 | 861 |
| legacyTied 10k newest | 707 | 64 | 3.382 | 88 |
| legacyDay 10k newest | 526 | 29 | 1.560 | 59 |

| mixed 100k newest (compat.) | 6.645 (n=1) | 1.984 (1.967–2.177) | 30.123 (n=1) | 4.473 (3.891–4.501) |
| mixed 100k ausente | 5.173 (n=1) | 1.865 | 27.954 (n=1) | 4.741 |

En API 35 5E.1 coincide con el oráculo en todos los recorridos; en API 24 difiere en civil
(1k/10k/100k), legacyDay y legacyWithCivil (10k/100k): defecto 5E2-001. 5E.2 coincide con el
oráculo en todas las campañas de ambos dispositivos. Tabla completa (todas las búsquedas,
segunda página, sentencias, filas, heap): [android/summary.md](rendimiento-fase5e2/android/summary.md).

Fixture integrado 5E (`phase5e-performance`, mismo código de medición 5E/5E.1), API 24:

| Movimientos | Historial 5E.1 | Historial 5E.2 | Dashboard 5E.1 | Dashboard 5E.2 |
|---|---:|---:|---:|---:|
| 1.000 | 40,49 | 12,77 | 16,92 | 17,23 |
| 10.000 | 359,76 | 39,30 | 100,91 | 114,99 |
| 100.000 | 12.981,16 | **270,99** | 2.099,08 | 2.121,10 |

HONOR API 35 (5E.1 con pantalla mantenida, según su informe; 5E.2 con WAKEUP periódico):

| Movimientos | Historial 5E.1 | Historial 5E.2 | Dashboard 5E.1 | Dashboard 5E.2 |
|---|---:|---:|---:|---:|
| 1.000 | 275,06 | 53,74 | 156,10 | 100,66 |
| 10.000 | 3.223,64 | 55,01 | 379,38 | 316,02 |
| 100.000 | 62.289,62 | **406,40** | 3.506,69 | 4.142,77 |

Las columnas 5E.1 de las dos tablas integradas son una sola muestra de otra sesión: sirven de
referencia, no de comparación controlada. El dashboard no cambió en 5E.2; en este APK su
caso 100k en HONOR varía entre 3.190 y 4.401 ms entre muestras, por lo que la diferencia con
3.506 ms no se atribuye a 5E.2.

Memoria: delta de `HermesInternal.getInstrumentedStats().js_allocatedBytes` sin GC
controlado (indicativo, no comparable entre muestras con GC): la primera página heredada de
5E.1 asignaba hasta ~13 MB en 100k; 5E.2 ~0,16 MB sin búsqueda y ~10–14 MB en búsquedas
ausentes (texto de candidatos por lotes).

## 8. Diagnóstico independiente del dashboard

Reproducido en Node y en ambos dispositivos sin montar UI, con lecturas secuenciales
atribuibles ([node/dashboard-diagnostic.json](rendimiento-fase5e2/node/dashboard-diagnostic.json)).

- El fixture integrado 5E pone sus 100k movimientos **en el día y mes evaluados**.
  `monthlyAmounts` devuelve 90.000 filas (con subconsultas de `personal_amount`) que se suman
  en JS para conservar el orden de acumulación: API 24 1.724 ms de 1.795 ms totales; cuentas,
  conteos recientes, posición compartida y pérdidas suman ~45 ms; suma JS 3,3 ms.
- Con 100k repartidos en tres años (≈1.969 en el mes) el dashboard actual tarda 36 ms en
  API 24 y 122–131 ms en HONOR (baseline congelado 6,7–7,1 s y 21–25 s) y 6,4 ms en Node.
  En HONOR con el fixture 5E, `monthlyAmounts` (90.000 filas) ocupa 3.267 ms.
- El dashboard actual ya es 3,4× más rápido que el baseline congelado en el fixture 5E y
  ~185× con datos repartidos. Apertura/coordinación y cachés no explican el tiempo.
- No hay corrección pequeña que conserve resultados: un `SUM` SQL cambiaría el orden de
  acumulación decimal. Mejorarlo exige otro diseño (p. ej. agregados incrementales con orden
  de suma definido) → tarea separada.

**Discrepancia exacta preexistente (no introducida en 5E.2):** con 1.000 movimientos del
mismo `date` y `created_at`, el dashboard actual y el baseline congelado difieren en el último
decimal: `monthlyIncome` 258,2999999999997 frente a 258,29999999999967 (y `monthlySavings`),
reproducido igual en Node, API 24 y API 35. Ambas consultas ordenan por
`date DESC, created_at DESC` sin desempate: el actual suma en orden rowid ascendente y el
baseline en rowid descendente. No se añadió tolerancia ni se cambió el dashboard; definir un
desempate determinista altera resultados históricos y requiere decisión.

## 9. Optimizaciones del dashboard

Ninguna. No se encontró una causa corregible sin cambiar el orden de acumulación.

## 10. Regresiones y calidad final

- Jest completo: 61 suites, 761 pruebas aprobadas, 8 omitidas por variable de entorno
  (benchmarks/diagnósticos) — [quality/jest.log](rendimiento-fase5e2/quality/jest.log).
- `tsc --noEmit`, ESLint del proyecto y del harness, `git diff --check`: código 0.
- Base previa a modificar producción: Jest 59 suites/646 pruebas, tsc, ESLint y diff-check en 0
  ([baseline/](rendimiento-fase5e2/baseline)).
- Android API 24 con el APK 5E.2: 28 campañas de regresión aprobadas (notificaciones,
  permiso denegado, Worker/Headless, muertes de proceso en tres etapas con reinicio, épocas,
  matriz de borrado de 78 casos, fallos de limpieza, intención perdida/desconocida, respaldos
  y publicación v2, integrado 5E con reinicio y recuperación 5E.1).
  HONOR API 35: las mismas 28 campañas aprobadas ([api35-regressions.log](rendimiento-fase5e2/android/api35-regressions.log)).
- Las ejecuciones de Jest reescribieron cuatro artefactos de fases previas
  (`atomicidad-fase3a1`, `atomicidad-fase4`, `performance/shared-commands`); se restauraron.

## 11. Riesgos de escalabilidad restantes

- Un grupo de empate gigante (decenas de miles de filas con el mismo día) cuesta O(grupo) por
  página: ~0,4–1,2 s por página en HONOR a 100k. Lo elimina un índice cuyo orden coincida con
  el desempate, lo que exige migración (no autorizada).
- Búsquedas sin coincidencias o con texto no ASCII recorren todo el historial (la búsqueda es
  sobre el historial completo, por diseño): 3,5–9,6 s en HONOR a 100k.
- Mezclas con instantes iguales entre formatos, fechas inválidas y offsets siguen en la ruta de
  compatibilidad (O(N) en la primera página, ~2–4 s en HONOR a 100k).
- Filtros combinados muy selectivos pagan un segundo recorrido lineal (2× en el peor caso).
- El defecto 5E2-001 puede existir en versiones SQLite intermedias no probadas (API 26–34);
  la corrección no depende de la versión.

## 12. Recomendación de rendimiento aceptable

Para uso real (fechas repartidas, decenas de movimientos por día) la primera página queda por
debajo de ~0,3 s en ambos dispositivos a 100k y de ~0,1 s a 10k. Proponemos como aceptable:
primera página ≤ 0,5 s y página siguiente ≤ 0,5 s a 100k en historiales repartidos; búsquedas
exhaustivas sin coincidencias ≤ 10 s con indicador de progreso; el caso sintético de 100k en un
solo día queda por encima (0,4–1,2 s por página) y no debería tomarse como criterio sin índice.

## 13. Veredicto sobre la aceptación integrada 5E

**Continuar con la aceptación integrada de 5E** usando este adaptador: la latencia del
historial integrado bajó de 12,98 s a 0,27 s en API 24 y de 62,29 s a 0,41 s en HONOR, con
equivalencia exacta contra el oráculo en ambos dispositivos y regresiones aprobadas. Antes de
cerrar 5E conviene decidir: (a) aceptar el defecto 5E2-001 como corregido y re-ejecutar la
matriz 5E.1 con `created_at` variable; (b) tratar la discrepancia decimal del dashboard en una
tarea separada. No se avanza a la fase 6.
