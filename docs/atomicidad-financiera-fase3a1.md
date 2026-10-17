# Fase 3A.1: reloj de pruebas y reconciliación de tarjetas

17 de octubre de 2026. Alcance: estabilización de Suscripciones y reducción del coste de
lectura/mapeo de reconciliación; conserva las unidades transaccionales de fases 1/1.1/2/3A.

## Línea base y fuentes

Se aplicaron las skills `smartfin-financial-domain` y `react-native-best-practices`, con el
ciclo medir → optimizar → volver a medir → validar. Se revisaron AGENTS, arquitectura,
base de datos, flujos, Suscripciones, diseño/informes de atomicidad y los instrumentos de
rendimiento vigentes. El checkout empezó en `e0249d8`, sin cambios de código pendientes.

Antes de cambiar producción se ejecutó Jest completo: **472 aprobadas, 1 fallida,
3 omitidas; ocho snapshots aprobados**. [Log](atomicidad-fase3a1/baseline/jest.log).
Se guardaron las fuentes previas y hashes de infraestructura, dashboard, historial,
pantalla/virtualización, movimientos manuales, ámbito y UI de pago, esquema y dependencias.

[Medición Node previa](atomicidad-fase3a1/baseline/node-baseline.json), con 100.000 movimientos
ajenos más una compra: lectura completa 699,43 ms; mapeo/validación JS 596,98 ms; pago
2.326,20 ms y lector 2.326,15 ms. Son muestras diagnósticas aisladas, no percentiles ni
una descomposición aditiva: calentamiento y cachés hacen variar cada medición.
`EXPLAIN QUERY PLAN` muestra recorrido de `idx_transactions_date` y B-tree temporal para
el último término de ORDER BY.

La fase 3A había medido un solo pago sobre ese volumen en Android: 18.377 ms (API 24) y
30.375 ms (API 35), con lectores de 18.378/30.419 ms. Esta fase añade comparación emparejada
con calentamiento y tres muestras por versión/tamaño, en el mismo APK y entorno.

## Causa y corrección temporal

El fixture de `subscriptions.test.ts` inyectaba en la fachada un reloj que empezaba el
3 de octubre, mientras `sqliteTransactionRepository.saveTransactions/deleteTransaction`
capturan `new Date()` al ejecutar la mutación. La obligación del test vence el 15 de
octubre y la ejecución real es posterior: al borrar el gasto, el repositorio la reabre
correctamente como `overdue`, pero la prueba esperaba el `pending` del reloj simulado.

Se siguieron los llamadores de producción: `subscriptionRuntime.createRuntimeApi` y el
uso de `createSubscriptionApi` desde el ejecutor de IA no inyectan un reloj alternativo;
usan el mismo reloj del sistema que Movimientos. El fallo reproducido es un desacuerdo
del fixture, no evidencia de una política de vencimiento errónea en producción. Cada
operación conserva su instante de captura; no se promete un día global inmutable a través
de múltiples operaciones independientes o cambios del reloj del dispositivo.

La corrección se limita al fixture: Date está fijado mediante Jest, la fachada lee ese
mismo Date y `setNow` mueve una sola fuente temporal. Los temporizadores y colas necesarios
para SQLite siguen siendo reales. No se modifican expectativas previas, repositorios de
producción ni reglas de vencimiento. La comparación continúa siendo estrictamente
`expectedDate < today`: antes e incluso durante el día debido es `pending`; al día siguiente
es `overdue`.

Nueve casos nuevos, cada uno con borrado y edición incompatible, cubren el instante anterior,
medianoche y último milisegundo del vencimiento, inicio del día siguiente, octubre/noviembre,
año nuevo y febrero/marzo. Usan el calendario local que emplea el dominio vigente y no
introducen una política nueva de zona horaria. La prueba preexistente de cambios de zona
horaria también permanece activa.

## Matriz de efectos conservada

| Paso/predicado | Estado y referencias | Efecto financiero conservado |
|---|---|---|
| Cuenta/tarjeta | Todas las `creditCard/active`; origen activo de tipo compatible | Mismo saldo y validación de fondos bajo el dueño de conexión |
| Compra | `expense/outflow`, estado distinto de `cancelled`, cualquier fecha del historial | Deuda por importe completo, incluida `pending`; sin sumar cuotas como gasto |
| Pago existente | `creditCardPayment`, no cancelado; cuenta propia o destino igual a tarjeta | Reduce deuda de cada tarjeta que satisface el OR, sin duplicar una fila dentro de la misma tarjeta |
| Extracto | Ciclo, fechas civiles/heredadas y cuotas vigentes | Mismos monthlyAmount, redondeos, estados y fechas de pago |
| Nuevo pago | `min(round(amount), deuda)`; outflow/posted/debit; origen y tarjeta destino | Débito único, sin gasto adicional; patrimonio conservado en el escenario de fase 3A |
| Fallo/unknown | Mismas escrituras y límites de commit | Snapshot íntegro con ROLLBACK confirmado; cuarentena y ausencia de reintento en unknown |

## Optimización aceptada

`readCreditCardReconciliationTransactions.ts` es un adaptador interno del módulo de tarjetas.
No cambia los contratos públicos de repositorio. Sobre los repositorios SQLite registrados:

1. Selecciona nueve campos usados por el cálculo: identidad, amount, fecha/civil_date,
   origen/destino, tipo, dirección y estado; el lector anterior proyecta 23 campos.
2. Filtra en SQLite solamente el superconjunto exacto que las tarjetas activas pueden
   utilizar: compras expense/outflow no canceladas propias y pagos no cancelados propios
   o dirigidos a esas tarjetas. No limita fecha, cantidad de filas ni horizonte.
3. Mantiene `ORDER BY date DESC, created_at DESC` y fuerza el índice de fecha que usa el
   lector anterior. Cambiar al índice de cuenta podría cambiar el recorrido de empates
   y el orden de acumulación REAL. Las pruebas comparan también los IDs en su orden.
4. Conserva la interpretación de civil_date vacío como ausente, igual al mapeador anterior.
5. Si hay más de 300 tarjetas, evita exceder los 999 parámetros de SQLite API 24: lee el
   superconjunto por tipo/dirección/estado sin filtro de cuenta; el dominio aplica todas
   las tarjetas normalmente. Esa ruta está probada en Node.

La función de reconciliación conserva filtros definitivos y todas las sumas JS, orden de
sumas, bucles por tarjeta, cuotas, redondeos y escrituras. Sus únicas diferencias de
producción son la lectura especializada, el encadenamiento necesario para conocer las
cuentas activas y los tipos estructurales del resultado. `getTransactions()` y sus otros
consumidores conservan contrato, implementación y SQL completos.

Cada pago sigue haciendo dos lecturas consistentes y las dos reconciliaciones originales,
con un único permiso, BEGIN IMMEDIATE y COMMIT. Se evaluó reutilizar la primera lista y
mezclar el pago nuevo en memoria, pero no se adoptó: exige reproducir también el orden SQL
en fechas/empates y vincular la caché a todos los efectos del repositorio. La consulta
estrecha ya elimina el coste principal sin ese nuevo estado provisional. No se añaden
SUM SQL, índices, migraciones, dependencias, cambios al driver ni coordinación Kotlin.

El plan sigue recorriendo el índice de fecha: no se afirma una búsqueda indexada por cuenta
ni complejidad constante. Se reduce el material que ordena/devuelve la consulta y, sobre
todo, la transferencia por el puente y la validación/materialización JS. No se modifican
paginación, virtualización, dashboard, IA, gestión general de tarjetas ni respaldo.

## Equivalencia Node e instrumentos Android

`phase3ACreditCardRelations.ts` congela el código anterior exclusivamente para pruebas.
Las caracterizaciones de fase 0 apuntan expresamente a esa reconciliación anterior para
mantener su evidencia histórica. No se actualizan snapshots para esconder discrepancias.

[Resultados Node de equivalencia](atomicidad-fase3a1/node-equivalence.json): se comparan
filas completas de todas las tablas, métricas, FK/integridad, auditoría y revisión en
1.000/10.000/100.000 movimientos, con conjuntos ajenos, mixtos y densos en movimientos
relevantes. Cada uno verifica el pago y cuatro ciclos. Se normaliza solo la identidad del
pago generado y sus referencias; no se usan tolerancias monetarias ni hashes como sustituto
de la igualdad. Hay casos adicionales de importes grandes/decimales, cancelación de sumas
con negativos/cero, fecha civil vacía y límite de parámetros.

El harness Android nuevo reutiliza los preparadores/runner de fases anteriores, el driver
instalado y el paquete sintético `com.smartfin.atomicityphase1.tests`. No abre la base de
producción. Contiene ambas versiones en el mismo APK. Cada tamaño y forma usa una pareja
de bases con semilla idéntica; alterna qué versión corre primero y descarta un calentamiento
antes de tres muestras. Mide pago, ámbito BEGIN/COMMIT, lector externo, lecturas por
executeSql, filas transferidas, mapeo JS, cálculo financiero y escrituras.

Para medir SQLite sin atribuirle todo el puente, el reportador nativo exclusivo de pruebas
repite el mismo SELECT en modo READONLY sobre la base sintética, consume el cursor y
registra una muestra de calentamiento y tres mediciones. Esa sonda es separada de la llamada
del driver: incluye acceso al cursor, excluye serialización JSON/puente y no pretende ser
una medición inline exacta de la sesión original. Los spans executeSql incluyen SQLite,
cola del driver, conversión y puente; se etiquetan así, sin confundirlos con SQL puro.

La comparación nativa recorre simultáneamente todas las filas de todas las tablas con
orden determinista, compara tipo y valor (incluidos bits Double), normaliza solo IDs de
pagos y devuelve los recuentos. Evita transferir dos snapshots de 100.000 filas a Hermes
solo para compararlos. Verifica también los siguientes tres ciclos. Un reloj de auditoría
JS/SQL fijo es optativo de estos fixtures del benchmark, equivalente al reloj fijo del
helper Node; no se aplica a producción ni a las campañas de recuperación existentes.

Las transformaciones de perfilado solo añaden spans en las copias del harness y fijan el
reloj de los fixtures seleccionados. Los fingerprints separan fuentes originales de
fuentes instrumentadas. El reportador Kotlin añadido es exclusivamente de pruebas; no
se modifica ningún módulo nativo ni coordinador de producción ni el driver.

## Resultados comparativos Android y Node

Ambas API aprobaron los seis conjuntos, con una muestra de calentamiento y tres medidas
por versión. Cada comparación conserva todas las tablas y columnas, referencias, auditoría
y revisión, después de los cuatro pagos y de tres cambios de ciclo.

| API | Movimientos | Semilla | Pago antes/después (ms, mediana) | Lector antes/después (ms, mediana) | Reducción pago |
|---|---:|---|---:|---:|---:|
| 24 | 1000 | noise | 222.0 → 78.0 | 224.1 → 79.3 | 64.9 % |
| 24 | 1000 | mixed | 230.6 → 66.7 | 232.8 → 69.4 | 71.1 % |
| 24 | 10000 | noise | 1473.0 → 103.2 | 1475.1 → 105.0 | 93.0 % |
| 24 | 10000 | mixed | 1457.1 → 143.4 | 1457.9 → 145.2 | 90.2 % |
| 24 | 100000 | noise | 24726.5 → 233.9 | 24728.7 → 236.3 | 99.1 % |
| 24 | 100000 | mixed | 25487.5 → 606.8 | 25490.1 → 609.4 | 97.6 % |
| 35 | 1000 | noise | 227.2 → 41.0 | 228.3 → 42.1 | 82.0 % |
| 35 | 1000 | mixed | 491.1 → 277.3 | 494.7 → 284.2 | 43.5 % |
| 35 | 10000 | noise | 2082.6 → 174.7 | 2090.1 → 177.9 | 91.6 % |
| 35 | 10000 | mixed | 2133.8 → 293.8 | 2138.1 → 296.4 | 86.2 % |
| 35 | 100000 | noise | 33192.7 → 584.6 | 33236.9 → 588.0 | 98.2 % |
| 35 | 100000 | mixed | 33519.1 → 994.6 | 33562.7 → 996.4 | 97.0 % |

`noise` significa movimientos ajenos a las tarjetas y `mixed` mezcla compras, pagos,
pendientes/cancelados, varias tarjetas, fechas antiguas/offsets, empates y cuotas. El total
base es N+1 movimientos; los pagos de calentamiento/medición agregan cuatro filas. Las
medianas se calculan para cada métrica y no necesariamente pertenecen a la misma ronda.

| API | Semilla, 100.000 filas | Pago referencia, rango ms | Pago optimizado, rango ms |
|---|---|---:|---:|
| 24 | noise | 15021.0–25294.8 | 140.7–257.2 |
| 24 | mixed | 22057.0–25550.2 | 603.6–609.5 |
| 35 | noise | 33107.8–33399.9 | 535.8–874.7 |
| 35 | mixed | 33467.5–33519.4 | 977.5–1038.0 |

Los JSON conservan todas las muestras, mínimos, máximos y desviaciones estándar. Los
rangos muestran variabilidad material, especialmente en el emulador; la mejora grande
permanece incluso comparando el mejor tiempo anterior con el peor tiempo optimizado.
No se extrapolan estos tiempos a todos los dispositivos.

| API | Semilla, 100.000 filas | SQLite/cursor por SELECT, sonda (ms) | Dos lecturas por driver/puente (ms) | Mapeo JS (ms) | Cálculo (ms) | Escrituras (ms) | Ámbito (ms) |
|---|---|---:|---:|---:|---:|---:|---:|
| 24 | noise | 6547.0 → 96.6 | 22951.8 → 155.1 | 1608.6 → 0.1 | 85.4 → 0.8 | 32.9 → 27.7 | 24726.0 → 233.1 |
| 24 | mixed | 6546.0 → 115.4 | 23539.8 → 463.3 | 1733.2 → 42.8 | 113.4 → 14.6 | 32.7 → 32.5 | 25487.0 → 606.2 |
| 35 | noise | 8587.7 → 132.2 | 30110.3 → 367.1 | 2761.1 → 0.5 | 128.1 → 8.4 | 42.2 → 57.5 | 33192.0 → 533.6 |
| 35 | mixed | 8602.5 → 161.9 | 30457.6 → 794.0 | 2759.1 → 84.3 | 152.8 → 24.9 | 39.9 → 38.3 | 33518.8 → 993.9 |

La sonda SQLite/cursor es **un SELECT**, en una conexión READONLY independiente; los spans
del driver corresponden a **las dos lecturas** de cada pago. No son sumandos equivalentes
ni deben restarse para afirmar un tiempo puro de puente. Aun con esa limitación, muestran
que SQLite/cursor tiene un coste importante y que transferir/mapear el historial completo
amplifica ese coste. No se atribuye toda la latencia a renderizado React ni a JS.

Con 100.000 filas, la mediana de registros transferidos por las dos lecturas pasó de
200.007 a **7** en noise y a **10.415** en mixed; la proyección pasó de 23 a 9 columnas.
El cálculo conservó su código y las escrituras conservaron su cantidad y protocolo. La
mejora viene de un conjunto de lectura y materialización menor, no de confirmar menos
entidades ni de mover trabajo financiero fuera del dueño transaccional.

API 24 confirma con EXPLAIN el mismo recorrido del índice de fecha y la B-tree temporal
para el segundo término del ORDER BY. API 35 devolvió SQLITE_ROW en esa sonda de plan;
el error se conserva y el SELECT real sí se midió con tres muestras. Las consultas Node
también conservan el mismo plan de recorrido. No se añadió ningún índice.

| Movimientos | Semilla | Candidatos iniciales | Pago referencia/optimizado (ms, muestra Node) |
|---:|---|---:|---:|
| 1000 | noise | 1 | 38.1 → 8.0 |
| 1000 | mixed | 56 | 32.5 → 4.8 |
| 1000 | dense | 424 | 36.2 → 12.1 |
| 10000 | noise | 1 | 201.0 → 11.1 |
| 10000 | mixed | 523 | 224.5 → 19.0 |
| 10000 | dense | 4214 | 225.0 → 66.5 |
| 100000 | noise | 1 | 3277.6 → 94.8 |
| 100000 | mixed | 5205 | 2673.5 → 151.3 |
| 100000 | dense | 42127 | 2612.3 → 560.8 |

Los tiempos Node son muestras diagnósticas, no medianas del protocolo Android; el oráculo
se ejecuta antes de medir. La equivalencia cubre los tres tamaños y las tres densidades;
los resultados financieros no dependen de una tolerancia de rendimiento o de importe.

[Reporte Android API 24](atomicidad-fase3a1/final-api24-benchmark/result.json),
[reporte Android API 35](atomicidad-fase3a1/final-api35-benchmark/result.json),
[consolidado de benchmarks](atomicidad-fase3a1/benchmark-summary.json).

## Calidad final y límites de la evidencia

Jest completo terminó con **488 pruebas aprobadas, cero fallos, tres benchmarks
preexistentes omitidos, 45 suites aprobadas y ocho snapshots históricos aprobados**.
[Log final](atomicidad-fase3a1/jest-full-final.log). No se usó actualización de snapshots.
TypeScript estricto y ESLint terminan con código 0
([TypeScript](atomicidad-fase3a1/typescript-verified.log),
[ESLint](atomicidad-fase3a1/eslint-final-complete.log)); `git diff --check` también pasa.

La [auditoría de alcance](atomicidad-fase3a1/scope-audit.json) acredita por hash la
conservación de dashboard, historial/pantalla/virtualización, transacciones manuales,
runner/recuperación/coordinación, ámbito/UI del pago, esquema, migraciones y dependencias.
El cálculo/escrituras de reconciliación y el núcleo del pago permanecen textualmente
idénticos a fase 3A. Solo cambia la fuente de sus candidatos y sus tipos estructurales.
El archivo de métricas de espera de lectores que una suite existente regenera se restauró
al contenido inicial; no se atribuyen esos cambios de artefacto a esta implementación.

Las 52 posiciones antes/después de escritura de fase 3A siguen usando el oráculo de
rollback integral, incluida auditoría y revisión. La suite completa incluye además la
matriz manual de fase 2, recuperación/coordinación de fases 1/1.1, concurrencia/unknown,
suscripciones, IA y gastos compartidos/condonaciones. No se amplían sus garantías más allá
de los escenarios comprobados. [Matriz de fase 3A de esta ejecución](atomicidad-fase3a1/phase3a-fault-matrix.json).

La primera ejecución completa de esta fase se interrumpió después de pasar la equivalencia
grande, porque el oráculo duplicaba grandes snapshots y consumía demasiada memoria.
El oráculo Node final recorre todas las columnas por bloques, compara valores con Object.is
y preserva incluso rowid en estas bases de semilla idéntica. Esto optimiza el instrumento,
no reduce datos ni aserciones financieras. El log interrumpido se conserva separado y
no se contabiliza como calidad final.

Los intentos iniciales del harness se conservan por separado: fallo del preparador por
un objetivo de instrumentación repetido, build que no resolvía la referencia bajo
`__tests__`, y campañas que abortaron al intentar el diagnóstico EXPLAIN. No se contabilizan
como campañas aprobadas ni se usan sus muestras para afirmar mejora. La referencia se
copia a `baseline/` solo dentro del harness; todas las correcciones del instrumento se
recompilaron antes de atribuir resultados al APK siguiente.

[Planes Node de ambas consultas](atomicidad-fase3a1/query-plans-node.json). En el HONOR,
EXPLAIN produjo SQLITE_ROW tanto desde la API del driver como desde la sonda nativa; no
se atribuye una causa interna no demostrada ni se modifica el driver para eludirlo.
La sonda conserva `explainError` cuando ocurre y sigue midiendo el SELECT real en una
conexión de diagnóstico independiente. Sus planes y errores quedan en cada reporte.

Las distribuciones de tres muestras describen los dispositivos/semillas medidos; no son
percentiles de producción ni un ensayo estadístico de todos los fabricantes. La sonda
SQLite separada usa su propia conexión/caché y no descompone exactamente el coste inline
del driver. Los spans con esperas asíncronas pueden solaparse; no deben sumarse como si
fueran una partición exhaustiva de CPU. Las filas retornadas se miden; las visitas del
índice completo se deducen de EXPLAIN, no de contadores sqlite3_stmt_status inexistentes
en la interfaz actual. No se afirma haber eliminado el escaneo O(N).

La equivalencia cubre los tipos y formatos históricos probados. La proyección no examina
columnas que el cálculo no consume ni constituye un diagnóstico de corrupción arbitraria
de datos ajenos. No reescribe ni elimina filas históricas. Con muchos movimientos de
crédito todavía se materializa el conjunto completo de candidatos; la prueba densa de
100.000 filas es Node y no certifica su latencia en todos los Android.

Se conserva el alcance de atomicidad del runtime JS y su conexión administrada. No se
certifican conexiones Kotlin independientes, muerte de proceso durante COMMIT, pérdida
física de almacenamiento ni idempotencia durable universal. `unknown` sigue requiriendo
verificación del estado y no produce reintento financiero. No se inicia fase 3B ni se
modifica gestión general de tarjetas, IA, respaldo o coordinación Kotlin.

## Regresión Android final y reproducción

| Verificación Android | API 24 | API 35 |
|---|---:|---:|
| Conjuntos de equivalencia, calentamiento y tres muestras/version | 6 aprobados | 6 aprobados |
| Pagos fase 3A | 72 aprobados | 72 aprobados |
| Puntos antes/después de escritura del pago | 52 | 52 |
| Regresión manual fase 2 | 274 aprobados | 274 aprobados |
| Puntos antes/después de escritura de la matriz manual | 268 | 268 |
| Recuperación fase 1.1 | 17 aprobados | 17 aprobados |

Se completaron las **catorce campañas** con el mismo APK: benchmark, phase3a, phase2,
core, begin-after, commit-before y rollback-before en ambas API. Cada matriz descubre
las escrituras de su camino y valida antes/después de todas; conserva snapshots completos
en rollback, FK/integridad, revisión, auditoría y referencias. Las incertidumbres mantienen
unknown, cuarentena y ausencia de reintento incluso si la reapertura muestra un pago
confirmado. No se aplican compensaciones.

La matriz manual vigente tiene 268 posiciones y seis controles, total 274 casos. El
informe histórico de fase 2 registraba 244 posiciones y 250 casos en su árbol de entonces.
Esta ejecución usa la matriz descubierta del checkout actual y comprueba las diez rutas,
dos posiciones por escritura y cada posición alcanzada; no reduce puntos ni modifica
expectativas financieras para acomodar el conteo. Los 52 puntos de pago de fase 3A sí
permanecen idénticos.

Gastos compartidos/condonaciones, suscripciones y sus relaciones con tarjetas permanecen
verificados por las suites Node completas. No se atribuye a Android una exploración de UI
o un flujo nativo de gastos compartidos que no se ejecutó en estas campañas.

El paquete de producción permanece sin cambios en todos los controles de metadatos. Las
bases fueron sintéticas, aisladas y nuevas. La app de pruebas queda detenida y el emulador
API 24 que se inició para la validación se cerró. No se instaló ni abrió la app financiera.

[Resumen consolidado y enlaces a las catorce campañas](atomicidad-fase3a1/validation-summary.json),
[verificación de fuentes/driver frente al APK](atomicidad-fase3a1/current-source-verification.json),
[hash del APK](atomicidad-fase3a1/apk-hash.json). Build final: release/Hermes, JDK 17,
arm64-v8a/x86_64; fuentes instrumentadas y originales distinguidas en los fingerprints.

[Preparación y reproducción del harness](../scripts/androidAtomicityPhase3A1/README.md).
El checkout/APK utilizado queda en C:/sfatomicity-phase3a1-20261017-b. Los intentos anteriores
y sus errores no forman parte del resumen de aprobaciones.

La consulta especializada debe seguir alineada con los predicados financieros cuando una
futura tarea los cambie expresamente; las pruebas de equivalencia congeladas protegen
esta optimización, no autorizan reglas nuevas. No queda trabajo de fase 3A.1 pendiente
en el alcance solicitado y no se inicia fase 3B.
