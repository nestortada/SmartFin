# Verificación de rendimiento y escalabilidad posterior a 3B

18 de octubre de 2026. Se aplican `smartfin-financial-domain` y
`react-native-best-practices`. Alcance: diagnóstico, equivalencia financiera y una
corrección local del límite de parámetros. No incluye fase 4 ni nuevas funcionalidades.

## Fuentes y trazado del cierre

Se revisaron `AGENTS.md`, `ARQUITECTURA.md`, `BASE_DE_DATOS.md` y los informes
de fases 3A, 3A.1 y 3B, contrastados con código y llamadores. La línea base de esta
verificación conserva la fase 3B: 542 pruebas aprobadas y ocho snapshots.

`CreditCardsScreen` captura la cuenta del formulario y llama
`closeCreditCardWithReconciliation`. El comando captura esa expectativa, entra en
`withCreditCardManagementScope`, relee y valida la cuenta si hay expectativa,
reconcilia y llama `deleteCreditCard`. Este último participa en el mismo dueño:
lee cuentas, extractos, cuotas y perfiles mediante cuatro promesas; construye el
overview y rechaza cuotas activas pendientes, uso/deuda positivos o extracto actual
no subsanado. Finalmente cambia la cuenta a `closed`. El cierre no borra historial.
La pantalla refresca y cierra el formulario tras confirmar el commit.

Reconciliar relee cuentas, todas las cuotas pertinentes y candidatos financieros
completos; conserva el orden de sumas JavaScript, deuda por compras completas menos
pagos no cancelados y cálculo de extractos por ciclo/cuotas. La consulta sigue
recorriendo el índice de fecha para conservar equivalencia REAL: pocas filas
devueltas no acreditan coste constante frente a muchos movimientos ajenos.
No se trasladó la validación fuera del commit ni se alteró esa consulta.

## Defecto reproducible y corrección acotada

La asociación obtiene todas las compras por clasificar con sus pistas y estados
históricos, filtra coincidencias, guarda cada movimiento, actualiza las referencias
de cuotas y reconcilia. No limita el conjunto a una página ni excluye compras antiguas,
pendientes o canceladas que antes coincidían.

El antiguo `updateInstallmentPurchasesAccount` emitía un único `IN` con N IDs más
cuenta y timestamp. Android API 24 / SQLite 3.9.2 acepta 997 IDs (999 parámetros)
y falla con 998. API 35 / SQLite 3.44.5 acepta al menos los 10.000 IDs probados;
no se afirma su máximo absoluto. El error puede llegar después de escribir todos
los movimientos, pero el ámbito 3B revierte la operación completa.

La única modificación adicional de producción está en
`sqliteCreditCardRepository.ts`: deduplicar IDs, capturar un solo timestamp y, para
más de 997 IDs únicos, ejecutar fragmentos de 900 mediante el generador existente
`runSQLiteTransaction`. Cada sentencia enlaza como máximo 902 parámetros. Con
participante exterior no abre otra transacción; un llamador independiente obtiene
una sola transacción local. Los duplicados no actualizan dos veces una cuota ni
incrementan dos veces la revisión, como ocurría con el `IN` original. Los conjuntos
pequeños conservan su única sentencia.

No cambia esquema, driver, dependencias, predicados, cantidades, fechas financieras,
cuotas pagadas, estados de incertidumbre ni límites del commit. Esta fragmentación
local no introduce commits por lote ni un nuevo protocolo de procesamiento.

Las otras consultas revisadas tienen límites distintos: reconciliación usa tres
copias de como máximo 300 IDs de tarjetas y, sobre ese umbral, lee candidatos
completos sin restricción SQL de cuentas; referencias de integridad y suscripciones
ya fraccionan sus parámetros. Las consultas de cuotas/extractos/perfiles del cierre
reciben un solo ID. Este encargo no certifica cantidades arbitrarias de tarjetas
pasadas directamente a todos los métodos genéricos del repositorio.

## Protocolo y evidencia

[Protocolo](performance/post3b/protocolo.md),
[reproducción](../scripts/androidPost3BPerformance/README.md),
[línea base](performance/post3b/baseline/),
[resultados agregados](performance/post3b/summary.json).

APK release/Hermes aislado `com.smartfin.atomicityphase1.tests`; Android API 24
en emulador x86_64 y API 35 en HONOR CRT-NX3 arm64. No se abren bases financieras
reales ni se instala/modifica/inicia la aplicación de producción. Cada campaña
conserva los metadatos de producción antes/después y las huellas del código medido.

Ambas versiones instrumentadas conviven en el mismo APK, con bases nuevas idénticas
por pareja y reloj de auditoría fijo. Hay una pareja de calentamiento descartada,
tres parejas medidas por grupo y cinco para 100.000 movimientos ajenos sin
expectativa del formulario; el orden antes/después se alterna. Los fixtures pagados
densos contienen 10.000 compras, 10.000 pagos y 80.000 movimientos ajenos. Asociación
procesa 100/997/998/1.000/10.000 coincidencias reales completas, con cuotas parciales.

Se distinguen operación, espera de conexión, ámbito BEGIN/COMMIT, lector, lecturas
del driver, escrituras y spans síncronos de mapeo/cálculo/validación. Los tiempos
del driver incluyen SQLite, cola nativa, conversión y puente; los SELECT concurrentes
se solapan. Las sondas SELECT nativas READONLY se miden por separado con un
calentamiento y tres muestras. No se obtiene un tiempo puro de puente por resta.
PSS, heap Java y asignación nativa se muestrean cada 100 ms; no representan máximos
exactos ni un ensayo de fugas. No se usan medias de un solo caso para inferir causalidad.

La comparación nativa verifica todas las tablas/columnas/tipos, bits de Double,
auditoría y revisión, además de FK e integridad. Cuando el original API 24 falla,
primero se prueba su rollback contra una base inicial; luego un oráculo sintético
explícito usa el mismo código previo con literales SQL escapados para superar
exclusivamente el límite de enlaces. Solo sirve de equivalencia de éxito; su tiempo
no forma parte de los resultados antes/después.

Una primera ejecución de la nueva campaña de fragmentos se descartó porque el
harness cerraba la conexión antes de esperar el comparador. Los artefactos
`exploratory-*-v1` conservan ese error de pruebas y sus fingerprints; se corrigieron
los tres retornos y se repitió la campaña. No se contabiliza como fallo financiero.

## Calidad

La suite completa posterior a la corrección aprueba **555 pruebas, ocho snapshots**
(47 suites; tres benchmarks/pruebas omitidos como en la línea base). TypeScript y
ESLint pasan. Las trece pruebas añadidas caracterizan el fallo anterior, cubren
límites 997/998 y 10.000 coincidencias, duplicados, equivalencia financiera exacta y
fallos antes/después de cada fragmento tanto bajo el dueño exterior como de forma
independiente. Se conserva sin modificar el criterio de rechazo de pagos positivos
que redondean a cero y sus regresiones de fase 3B.

Evidencia: [Jest](performance/post3b/jest-final.log),
[TypeScript](performance/post3b/typescript-final.log),
[ESLint](performance/post3b/eslint-final.log).

Las siete regresiones Android previas pasan de nuevo en ambas API: fase 3B
157 casos, fase 3A 72, fase 2 274, núcleo 14 y recuperación BEGIN/COMMIT/ROLLBACK
un caso por campaña: **520 casos por API**. Se conservan sus 122/52/268 puntos de
fallo de escrituras, respectivamente, además de estados `unknown`, cuarentena,
reapertura y ausencia de reintento financiero. Las cuatro campañas nuevas principales
suman otros 72 casos por API: límites 8, fragmentos 8, parejas de cierre 36 y parejas
de asociación 20. No hay violaciones del commit único en las muestras corregidas.

Una interrupción prolongada dejó sin resultado la primera fase 3A API 24 y perdió
la conexión API 35 durante la recogida de fase 2. Esos intentos se conservan en
`interrupted-*`; no cuentan como aprobados ni como diagnóstico causal de un bloqueo
de producto. Tras reconectar el teléfono se repitieron desde bases nuevas y pasaron.
La auditoría de las 289 fuentes y del driver volvió a pasar antes de reanudar.

Con los controles de lector terminados: **24/24 campañas, 1.224 casos Android
aprobados (612 por API)**, cero fallos y cero violaciones de BEGIN/COMMIT único en
las muestras corregidas. Se verifican las huellas de ambos APK de pruebas: el de
mediciones principales quedó inmutable y el segundo solo cambia instrumentación.
Los 289 archivos originales de producción corresponden al checkout, el driver
coincide y la única diferencia adicional de producción es el repositorio corregido.
Evidencia: [auditoría de alcance](performance/post3b/scope-audit.json),
[calidad](performance/post3b/quality.json),
[resumen de campañas y medidas](performance/post3b/summary.json).

## Cierre: resultados repetidos y diagnóstico de los 7,95 segundos

Medianas en ms. Las distribuciones completas, mínimo/máximo y desviación estándar
por versión/fixture están en [tablas de tiempos](performance/post3b/timing-tables.md).
Los tiempos de operación/commit son válidos; véase debajo la corrección del contador
de lector de las primeras campañas.

| API | Fixture | Operación | n por versión | Antes | Después |
|---:|---|---|---:|---:|---:|
| 24 | 100.000 ajenos | Reconciliar | 5 | 68,97 | 65,26 |
| 24 | 100.000 ajenos | Reconciliar + cerrar | 5 | 64,31 | 70,77 |
| 35 | 100.000 ajenos | Reconciliar | 5 | 188,28 | 181,83 |
| 35 | 100.000 ajenos | Reconciliar + cerrar | 5 | 171,98 | 162,96 |
| 24 | 10.000 compras pagadas + 10.000 pagos + 80.000 ajenos | Reconciliar + cerrar | 3 | 1.147,49 | 1.159,46 |
| 35 | 10.000 compras pagadas + 10.000 pagos + 80.000 ajenos | Reconciliar + cerrar | 3 | 3.057,88 | 3.072,80 |

El cierre API 35 sobre 100.000 ajenos varía **152,81–661,93 ms antes** y
**158,80–466,64 ms después**; con expectativa de cuenta del formulario, las medianas
son 180,30/163,05 ms. En API 24 el cierre equivalente varía 63,02–112,58 y
62,19–104,56 ms. Los rangos se solapan; no se atribuye a la fragmentación de asociaciones
una mejora de cierre que ese código no modifica.

**Los 7.950,50 ms históricos no se reproducen en este protocolo de fixtures
equivalentes y rondas repetidas.** La muestra previa de reconciliación independiente
(250,69 ms) tenía otro fixture, y no es un control causal. La evidencia actual no
acredita una regresión estable del cierre ni un bloqueo de conexión previo al BEGIN.
El dato histórico queda como atípico no reproducido; al no conservar una traza interna
de aquella muestra no puede asignarse su causa exacta a SQLite, puente, GC o sistema.
No se borra ni se sustituye ese resultado por las nuevas medianas.

Sí existe dependencia real del volumen pertinente: con 10.000 cuotas pagadas el
cierre API 35 tarda 3.042,53–3.101,38 ms después. También hubo un atípico de
4.706,98 ms en **reconciliación anterior API 24 del fixture denso**: 3.547,67 ms
estuvieron en la llamada al driver que lee cuotas y el intervalo de contadores
Hermes registró 52,98 ms de GC.
No explica la muestra histórica API 35 ni constituye una mejora causada por este fix.

Desglose del cierre corregido, medianas en ms; las etapas se solapan y no deben
sumarse como componentes exclusivos:

| API / fixture | Cola inicial | BEGIN / COMMIT | Ámbito completo | Lectura candidatos, driver | Lectura cuotas de reconciliación, driver | Reconciliación JS | Validar + escribir cierre | Validación JS | Intervalo lector legado |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 24 / 100.000 ajenos | 0,05 | 1,15 / 6,09 | 70,41 | 40,71 | 1,33 | 0,47 | 6,41 | 0,23 | 71,94 |
| 35 / 100.000 ajenos | 0,07 | 2,60 / 3,75 | 161,79 | 123,85 | 2,55 | 2,26 | 9,86 | 0,47 | 165,29 |
| 24 / denso pagado | 0,05 | 1,71 / 5,92 | 1.158,71 | 476,44 | 271,67 | 12,87 | 279,21 | 9,98 | 1.160,50 |
| 35 / denso pagado | 0,08 | 1,39 / 4,15 | 3.071,88 | 1.290,49 | 615,53 | 49,39 | 795,22 | 41,60 | 3.074,65 |

Las escrituras del cierre/reconciliación son siete sentencias en este fixture de
dos tarjetas: cuatro del UPDATE/INSERT condicionado de cuentas, dos extractos y un
UPDATE de cierre. La suma de medianas de sus llamadas es 7,95/13,47 ms con historial
ajeno y 8,03/14,86 ms con historial denso, API 24/35 respectivamente; no es la mediana
del total ni incluye COMMIT. El coste adicional denso se concentra en lecturas,
conversión/mapeo de miles de filas y validación del overview, no en nuevas escrituras.

La sonda SQLite/cursor nativa de candidatos devuelve cero filas sobre 100.000 ajenos:
36,32–38,14 ms en API 24 y 120,99–121,35 ms en API 35. Con 18.462 candidatos no
cancelados del fixture denso: 245,80–254,28 y 568,71–579,12 ms. Son muestras separadas
de las llamadas del driver, no una estimación del puente por resta. API 24 muestra
recorrido de `idx_transactions_date` y ordenación parcial temporal. En API 35 falla
la sonda EXPLAIN con `another row available`; sus SELECT temporizados sí completan.

Picos PSS muestreados del proceso para cierre corregido: 58,60/111,90 MiB con historial
ajeno y 86,20/155,99 MiB con denso, API 24/35. Hermes expone contadores: el máximo de
bytes asignados **al terminar** los cierres densos es 6,87/14,29 MiB, con heap reservado
de 20 MiB; no equivale a pico JS durante la operación. Las estadísticas de Java,
asignación nativa y deltas GC están en el JSON. El proceso comparte rondas/versiones;
estos datos no acreditan una reducción causal de memoria ni ausencia de fugas.

### Corrección de la medida del lector

Se encontró un defecto de instrumentación en `ManagementCampaign` de 3B y en la
primera campaña detallada nueva: se solicitaba el lector, se esperaba al escritor
y **después** se calculaba su tiempo. En asociación, además, la lectura inicial de
la cuenta permitía que el lector se encolase antes del escritor. Por ello, el
intervalo podía aproximarse a la duración del escritor aunque el lector hubiese
terminado antes. Los 7.950,40 ms históricos y la columna de lector legado **no
acreditan por sí solos una espera efectiva del lector**. El tiempo de operación y
el ámbito BEGIN/COMMIT se midieron aparte y no quedan invalidados.

Se conserva el código exacto de esa instrumentación en
[main-instrumentation](performance/post3b/main-instrumentation/), con sus huellas.
El harness corregido captura la duración en el `.then` del lector, obtiene la cuenta
de asociación antes de empezar la ventana y comprueba la cola de adquisición real.
La campaña adicional `post-reader-control` desactiva el detalle SQL y el muestreo
PSS (solo registra controles y cola); así contrasta también el coste de instrumentar.
Repite reconciliación/cierre sobre el **fixture original de cierre 3B** con 100.000
ajenos, incluida compra cancelada/extracto subsanado, y asociaciones de 1.000/10.000.

## Asociación de compras realmente coincidentes

Tres muestras medidas por versión, después de un calentamiento. Medianas de operación
en ms; no incluyen el oráculo sintético ni las comprobaciones externas de equivalencia.

| Coincidencias | API 24 antes | API 24 después | API 35 antes | API 35 después |
|---:|---:|---:|---:|---:|
| 100 | 534,04 | 307,17 | 611,49 | 543,08 |
| 997 | 2.439,89 | 2.316,07 | 4.893,05 | 4.819,20 |
| 998 | Falla; rollback completo | 4.881,85 | 3.382,77 | 3.445,22 |
| 1.000 | Falla; rollback completo | 4.845,29 | 4.655,69 | 3.466,16 |
| 10.000 | Falla; rollback completo | 47.940,34 | 34.750,95 | 39.679,00 |

Con 10.000 coincidencias, la versión corregida varía 46.962,47–55.258,53 ms en API 24
y 39.010,81–43.766,45 ms en API 35. El original API 35 varía 34.725,51–45.400,71 ms:
la mediana posterior es mayor, pero el rango se solapa y n=3 no acredita una regresión
causal del fix. El repositorio fragmentado supone solo 12 UPDATE de cuotas,
230,02/221,75 ms de mediana, API 24/35. Para los volúmenes pequeños también existe
variación relevante; no se presentan diferencias entre medianas como mejoras probadas.

Todas las compras solicitadas se asocian, incluidas las antiguas, pendientes y
canceladas previstas por el predicado existente. No hay LIMIT, paginación ni recorte
para mejorar cifras. Las cuotas mantienen sus pagos, importes y vencimientos. La
comparación completa da igualdad exacta con el original exitoso API 35 y con el
oráculo explicitado en API 24. Antes de ese oráculo, cada fallo del original se
contrasta contra una base inicial para acreditar rollback integral.

El límite corregido no elimina otro coste reproducible: `saveTransactions` ejecuta
**10.000 UPDATE y 10.000 INSERT condicionados**, secuencialmente bajo el participante.
El span completo de guardado ocupa 44.913,94/37.090,56 ms de mediana. La suma de
medianas de las llamadas UPDATE/INSERT al driver es 41.426,95/31.371,31 ms; no es
CPU SQLite puro ni una partición exclusiva del span. Incluye puente, colas,
conversión y continuaciones JavaScript. Los controles actuales de integridad y
suscripciones también se conservan, con sus consultas fragmentadas.

Mapear las compras por clasificar requiere 84,84/144,81 ms; filtrar pistas,
276,47/323,42 ms; reconciliar después, 965,14/1.003,31 ms. Los ámbitos BEGIN/COMMIT
de esas asociaciones duran 47.932,05/39.670,64 ms. La magnitud de decenas de segundos
no se explica por el `IN` de cuotas; ese límite era un defecto de compatibilidad,
corregido sin resolver el coste de guardar todo el conjunto.

Picos PSS muestreados para 10.000 coincidencias corregidas: 117,71/222,18 MiB,
API 24/35. En API 24 el heap Java llega a 12,21 MiB y la asignación nativa a 58,87 MiB;
Hermes al terminar llega a 13,31/13,86 MiB asignados y heap reservado de 20 MiB.
No hubo OOM en el volumen probado. No se certifica memoria acotada para entradas
arbitrarias: se conservan arrays, objetos mapeados e IDs proporcionales al conjunto.
El techo ensayado de asociación es 10.000 coincidencias, no 100.000; las 100.000 filas
del ensayo de cierre denso incluyen 10.000 compras y 10.000 pagos. No se extrapola a
100.000 coincidencias ni a grandes cantidades de vínculos compartidos/suscripciones.

## Propuesta acotada para el coste de escritura masiva

Si se pretende resolver esa latencia antes de fase 4, el siguiente trabajo debe
autorizarse aparte: diseñar un envío agrupado de las escrituras existentes dentro
del mismo dueño exterior. Primero contrastar el soporte real del adaptador/driver
y sus recibos; después limitar la cantidad de sentencias por envío y los parámetros
por sentencia, manteniendo orden, UPDATE/INSERT condicionado, FK, auditoría y revisión.
No basta sustituir por REPLACE ni saltarse los hooks de compartidos/suscripciones.

Debe conservarse un único BEGIN/COMMIT, sin commits por lote, compensaciones ni
reintentos financieros tras `unknown`. La aceptación exige comparar exactamente
todas las tablas/métricas y provocar fallos antes/después de cada envío y en
BEGIN/COMMIT/ROLLBACK sobre API 24/35. Si el driver no permite participar de forma
segura en el dueño exterior, presentar ese límite antes de modificarlo.

No se implementó esta propuesta: introduce coordinación por lotes más compleja que
la fragmentación local de un IN y excede la autorización de esta verificación.

## Control corregido de finalización y cola del lector

Pasan los 20 casos adicionales en cada API. En API 24, el fixture original de cierre
3B produce mediana de reconciliación 103,34 ms (78,69–228,16) y cierre 125,81 ms
(113,57–166,82), con cinco medidas por operación tras calentamiento. La cola real
del lector del cierre es 125,25 ms y su finalización 128,87 ms. Asociar 1.000 compras
tiene mediana 5.143,13 ms (5.122,59–5.693,89); 10.000, **51.144,05 ms**
(48.610,38–51.324,94), con cola del lector 51.143,49 ms y finalización 51.146,45 ms.

En API 35, con el fixture original de cierre 3B,
una repetición de calentamiento y cinco medidas: reconciliar tiene mediana 205,64 ms
(204,01–214,03); reconciliar/cerrar, 219,63 ms (217,56–222,18). La cola real del lector
en el cierre es 218,80 ms y su duración hasta terminar el SELECT, 221,32 ms.
La muestra histórica de 7,95 s tampoco se reproduce con ese fixture original.

Con 1.000 asociaciones, tres medidas tras calentamiento: mediana 5.926,22 ms
(5.912,93–5.972,04). Con 10.000: **57.881,65 ms** (53.872,85–58.840,83); ámbito
transaccional 57.880,82 ms, cola efectiva del lector 57.881,07 ms y finalización
del lector 57.883,93 ms. Cada caso exige un dueño escritor y un lector encolado;
el contador se captura al terminar su propia promesa, antes de otras comprobaciones.

Estos controles se ejecutaron después de la interrupción, en otra sesión de proceso
y condiciones del dispositivo. Desactivan el detalle SQL/PSS, pero conservan wrappers
ligeros y temporización de controles/cola. **No son un ensayo emparejado para medir
el overhead de instrumentación** ni un benchmark de UI sin instrumentación. Sí
confirman que la exclusión de otros lectores durante decenas de segundos persiste
y que no era un artefacto del contador legado.

## Decisión sobre fase 4

**No recomiendo iniciar fase 4 todavía: existe un bloqueo técnico de escalabilidad
reproducible en la asociación masiva.** Se corrigió la incompatibilidad de parámetros
API 24 y se conserva la equivalencia financiera/atomicidad, pero una asociación de
10.000 compras mantiene la conexión y a los lectores excluidos durante decenas de
segundos incluso en el control ligero. Aunque no se fijó un SLA numérico, esa espera
es material para un comando interactivo y deja sin resolver el objetivo de escalabilidad.

Los 7,95 s aislados del cierre no justifican refactorizar su arquitectura: no se
reprodujeron y su contador histórico del lector tenía un defecto. La corrección
pendiente debe centrarse en el envío de escrituras masivas con los límites y pruebas
propuestos. Requiere autorización específica antes de implementar lotes complejos
o ampliar el adaptador/driver. Fase 4 y nuevas funcionalidades no se han iniciado.
