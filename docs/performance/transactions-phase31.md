# Historial: refinamiento de fase 3.1

11 de octubre de 2026, America/Bogota. Se siguió medir → optimizar → volver a medir → validar de la [skill de Callstack](../../.agents/skills/react-native-best-practices/SKILL.md). Se revisaron AGENTS.md, arquitectura, base de datos, fase 1 (`a9dd112`, SectionList y pruebas de pantalla), [fase 2](dashboard-phase2.md), su [protocolo Android](android-phase2-validation.md) y [fase 3](transactions-phase3.md), incluidos sus pilotos y mediciones finales.

## Alcance y baseline

La comparación de esta fase usa **fase 3 paginada contra fase 3.1 paginada**. No vuelve a comparar contra el historial completo en memoria de fase 2. Al iniciar, los cambios de fase 3 todavía estaban sin commit; se preservaron. [baseline.json](transactions-phase31/baseline.json) registra sus hashes y los snapshots `*.before.txt` congelan repositorio, adaptador, hook y pantalla. [transactionHistoryPhase3.ts](../../__tests__/helpers/transactionHistoryPhase3.ts) conserva el adaptador anterior para Jest, con únicamente sus imports adaptados a la carpeta de pruebas. La primera medición Node se ejecutó antes de editar producción: [node-before.json](transactions-phase31/node-before.json).

El único archivo de producción refinado es `sqliteTransactionHistory.ts`. Pantalla, hook, repositorio público, SectionList, tarjetas, acciones, agrupaciones y contratos de fase 3 permanecen idénticos a sus snapshots. Se mantienen 50 movimientos iniciales, cursor, desempates, búsqueda sobre todo el historial, filtros literales y compatibilidad de fechas heredadas. No se alteran esquema, índices, dependencias, cálculos, saldos, deudas, escrituras ni `getTransactions()`.

## Causas medidas

[phase3-diagnosis.json](transactions-phase31/phase3-diagnosis.json) conserva consultas y tiempos de las muestras Android anteriores de 100.000 movimientos. En una muestra, la búsqueda negativa tardó 1.244 ms; su consulta de candidatos consumió 1.154 ms en SQL y devolvió **cero filas**. El coste dominante era evaluar `GLOB '*[^ -~]*'`, LOWER e INSTR por campo mientras recorría la tabla mediante el índice de fechas, no transferir un historial completo al puente. La validación de fechas se repetía en cada búsqueda y filtro: una consulta de filtros combinados consumió 45 ms solamente comprobando fechas; además había otra consulta para obtener su forma.

La fase 2 filtraba un historial ya cargado en memoria, mientras la fase 3 consultaba SQLite para cada interacción. Esta diferencia explica que una carga inicial mucho menor no garantizase búsquedas interactivas más rápidas. En fase 3.1 se conserva la carga limitada y se reduce trabajo repetido y coste por candidato.

[node-plans.json](transactions-phase31/node-plans.json) incluye EXPLAIN y cinco muestras de variantes. En 100.000 movimientos, el prefiltro GLOB por índice tardó una mediana de 306,7 ms; el de longitudes, 138,1 ms. El recorrido sin índice también redujo el coste de una negativa, pero se conservó el índice de fechas: cambiar el plan de todas las búsquedas podría perjudicar las positivas que completan 50 coincidencias sin recorrer toda la tabla. No se añadió una consulta completa preventiva ni otro índice. [SQLite documenta el coste de las búsquedas por índice y tabla](https://www.sqlite.org/queryplanner.html).

## Cambios y equivalencia

1. **Prefiltro más barato.** Para una consulta que, tras `toLowerCase()`, es ASCII imprimible, cada campo usa `instr(lower(campo), ?) > 0 OR length(CAST(campo AS BLOB)) <> length(campo)`. En UTF-8, Unicode ocupa más bytes que puntos de código; NUL hace que LENGTH de texto termine antes. Ambos siguen pasando a JavaScript. En UTF-16 el criterio es conservador y puede dejar pasar también ASCII. ASCII con controles se pliega igual en SQLite y JS, por lo que ya no necesita pasar sin comprobar INSTR. El predicado final sigue siendo el original `text.toLowerCase().includes(search.toLowerCase())`, con texto **sin recortar**, `%`/`_` literales y la misma activación mediante `trim()`. [Semántica oficial de LENGTH, INSTR y LOWER](https://www.sqlite.org/lang_corefunc.html).
2. **Comprobaciones por conexión y revisión.** Un WeakMap guarda hasta ocho booleanos de validación de fechas y ocho búsquedas exhaustivas sin coincidencias. No guarda movimientos, candidatos, notas ni objetos financieros. Una prueba canónica positiva de todo el historial implica que sus subconjuntos también son canónicos. Una prueba negativa global no permite deducir el orden de un subconjunto: se mantiene su validación y la ruta heredada con el mismo sort estable.
3. **Vacíos reutilizables.** Si una búsqueda activa completa `p` no encontró nada, otra `q` cuya cadena en minúsculas contiene literalmente `p` tampoco puede encontrarlo, con los mismos filtros de mes/cuenta/categoría y revisión. No se infiere nada a partir de una página parcial, una página posterior vacía, una búsqueda más corta o filtros distintos. El orden puede cambiar, porque el conjunto vacío no cambia con él. Las consultas con coincidencias siguen paginando toda la base.
4. **Cancelación entre consultas.** Se comprueba vigencia después de leer la revisión y después de respuestas nativas, incluida la validación de fechas. Una petición obsoleta evita consultas siguientes y procesamiento de candidatos. El plugin no ofrece cancelación de SQL ya ejecutándose: no se afirma que una consulta nativa en curso se interrumpa. La coordinación de generaciones y el rechazo de respuestas obsoletas del hook se conservan.

Incluso un vacío reutilizado lee la revisión antes y después. Solo se publican comprobaciones tras completar una operación sin cancelación ni cambio de revisión. Una petición anterior no publica en la caché de una revisión más reciente. El mecanismo depende de los triggers de revisión existentes; cambiar datos desactivándolos o alterando manualmente la tabla de revisión incumpliría el mismo contrato usado por los cursores de fase 3.

## Node/SQLite

[node-comparison.json](transactions-phase31/node-comparison.json) conserva resultados, SQL, tiempos, filas devueltas, heap y igualdad exacta de cada página. [Resumen](transactions-phase31/node-summary.json). Node 24.16, SQLite en memoria, Windows, `--expose-gc`, dos calentamientos y cinco muestras por versión/tamaño. Versiones alternadas sobre el mismo fixture determinista; cada muestra usa una identidad de conexión nueva para medir carga inicial sin caché previa. Después ejecuta filtros combinados, positiva, negativa, extensión negativa y reset. La inicial incluye meses; las otras interacciones no. No se mide Hermes, puente o renderizado. La distribución del fixture Node difiere de Android; sus cifras no se mezclan.

| Movimientos | Inicial 3 / 3.1 (ms) | Combinados | Positiva | Negativa | Extensión de negativa |
|---:|---:|---:|---:|---:|---:|
| 1.000 | 2,29 / 1,95 | 0,42 / 0,38 | 4,00 / 1,55 | 4,11 / 1,20 | 4,26 / 0,15 |
| 10.000 | 3,03 / 2,98 | 1,68 / 1,00 | 27,24 / 10,45 | 30,07 / 9,58 | 28,39 / 0,15 |
| 100.000 | 13,20 / 13,72 | 14,65 / 7,93 | 33,39 / 16,21 | 315,36 / 132,57 | 305,62 / 0,13 |

Medianas. Una negativa nueva todavía hace un recorrido O(N) dentro de SQLite; reutilizar una negativa probada evita ese recorrido. La extensión reutilizada devuelve únicamente las dos filas de revisión. Filas devueltas no equivalen a filas físicamente examinadas. El heap medido es un delta al terminar, sujeto a GC, no pico ni memoria Android. El fixture de filtros combinados Node tiene una distribución distinta y puede devolver cero coincidencias; Android verifica también combinaciones que completan 50.

## Android release

El harness está en `scripts/androidTransactionsPhase31/`, paquete `com.smartfin.transactionsphase31.bench`, bases `transactions_phase31_v3_<N>.db`, release arm64/Hermes, HONOR CRT-NX3, Android 15 y America/Bogota. Usa el mismo generador/protocolo físico de las fases anteriores, sin leer bases reales. Ambas implementaciones se incluyen en **el mismo APK** y se alternan dentro del mismo proceso sobre la misma base: dos calentamientos por versión, cinco pares medidos, con orden invertido en pares sucesivos. Cada montaje medido recibe un wrapper de conexión nuevo; la comprobación inicial de fechas se ejecuta en ambas versiones. No se mide una inicial favorecida por una caché de una muestra previa.

El protocolo monta `TransactionsScreen` real y acciona los setters del hook: combinados, positiva `merchant 49`, negativa `not found`, extensión `NOT FOUND extended`, reset y nueve páginas hasta 500 filas. Incluye dos RAF tras las interacciones. Ese marcador no es tiempo del compositor ni arranque frío de la app. Se conservan JSONL, batería, metadatos, meminfo, Logcat, fuentes congeladas y hashes. USB/carga/temperatura y actividad del sistema no están fijados; alternar las versiones reduce, sin eliminar, esa variación.

Una muestra de la primera campaña de 10.000 perdió foco. Se excluyó **todo el bloque de ese tamaño**, preservado en `android/excluded-focus/`, y se repitió el bloque completo. No se seleccionan muestras por su velocidad.

<!-- ANDROID_METRICS_START -->
Se validaron **30 muestras**, 12 calentamientos y **72 comparaciones funcionales exactas**. [Resumen validado](transactions-phase31/android/summary.json), [proveniencia](transactions-phase31/android/provenance.json).

| Movimientos | Inicial 3 / 3.1 (ms) | Combinados | Positiva | Negativa | Extensión negativa |
|---:|---:|---:|---:|---:|---:|
| 1.000 | 262,81 / 240,04 | 121,12 / 117,70 | 170,00 / 149,43 | 106,05 / 89,48 | 100,18 / 66,70 |
| 10.000 | 253,03 / 254,39 | 176,57 / 139,94 | 337,60 / 252,03 | 188,18 / 154,68 | 233,79 / 63,73 |
| 100.000 | 260,19 / 265,68 | 183,84 / 159,44 | 365,39 / 217,56 | 1376,35 / 690,78 | 1338,09 / 100,20 |

Medianas de interacción hasta datos y dos RAF. En 100.000, la negativa mejora un 49,8%, la positiva un 40,5% y los combinados un 13,3%. En 1.000 la mejora de combinados es pequeña. No hay mejora uniforme: el reset de 10.000 pasa de 198,79 / 232,83 ms, aunque su SQL baja de 15,47 / 1,77 ms. Las mediciones incluyen variación de programación/renderizado.

| Movimientos | Tras dos RAF iniciales 3 / 3.1 (ms) | Filas iniciales | Movimientos iniciales | Pico PSS del protocolo 3 / 3.1 (MiB) | Nueve páginas 3 / 3.1 (ms) |
|---:|---:|---:|---:|---:|---:|
| 1.000 | 304,86 / 287,82 | 103 / 103 | 50 / 50 | 148,98 / 142,31 | 2483,05 / 2474,85 |
| 10.000 | 320,83 / 287,18 | 103 / 103 | 50 / 50 | 163,35 / 157,36 | 3310,13 / 3218,19 |
| 100.000 | 382,74 / 344,39 | 103 / 103 | 50 / 50 | 157,52 / 169,10 | 3378,90 / 3129,49 |

Las 103 filas incluyen 51 movimientos con anticipación, meses, cuentas, categorías y comprobaciones. Ambas versiones terminan las nueve páginas con 500 movimientos. El pico PSS muestreado cada 100 ms abarca el proceso entero y todo el protocolo; en 100.000 **aumenta** de 157,52 / 169,10 MiB. PSS final: 143,04 / 144,39 MiB. No se oculta ni atribuye esa diferencia a una causa no perfilada. El desplazamiento separado tiene PSS prácticamente equivalente y el delta de heap Node inicial sigue alrededor de 226 KiB, con 50 objetos financieros; no se añadió retención del historial. Falta una medición controlada de heap/GC Android para interpretar el aumento del pico.
<!-- ANDROID_METRICS_END -->

### SQL, puente y JavaScript

El plugin copiado del harness mide `rawQuery` y avance del cursor como `sqlCursorMs`. `nativeQueryMs` incluye además construcción de filas nativas; su diferencia aproxima ese coste. El wrapper mide el await completo, que incluye cola nativa, puente y despacho/event loop JS: **no es una medición exclusiva del puente**. No se suman awaits paralelos de carga inicial como si fueran trabajo secuencial.

Solo en el harness se cronometran predicado de búsqueda, mapeo, append y agrupación. Los tiempos/cantidades de estas etapas aparecen por interacción y página en los JSONL. No son un perfil completo de CPU/commits React. `agent-device` y el inspector release no están instalados; no se añadieron dependencias para obtenerlos. No se introdujo memoización ni cambios de componentes basándose en inferencias sobre las pausas.

<!-- STAGE_METRICS_START -->
En la negativa de 100.000, SQL baja de 1300,78 a 602,41 ms; construcción nativa de filas, de 0,211 a 0,108 ms; await acumulado, de 1318,77 a 619,34 ms. Devuelve tres/dos filas de metadatos y cero movimientos. Esto confirma que el cambio principal reduce SQL, sin trasladar un recorrido completo a JS. La extensión reutilizada consume 0,256 ms SQL y solo dos lecturas de revisión, pero su interacción completa aún tarda 100,20 ms.

En combinados de 100.000, SQL baja de 51,14 a 18,97 ms y await de 76,36 a 38,94 ms. Mapeo, predicado, append y agrupación suman menos de 1 ms mediano por interacción. RAF p95 durante la negativa: 29,21 / 23,26 ms; una consulta lenta en el hilo nativo no equivale a bloquear JS todo ese tiempo.

Durante nueve páginas secuenciales aparecen RAF p95 de 221,41 / 229,44 ms y máximos de 247,25 / 246,54 ms. Es una carga programática rápida hasta 500, distinta del protocolo de gestos. Persisten esperas ajenas a las pequeñas etapas síncronas cronometradas. Atribuirlas por completo a React o al puente requiere un perfil de commits/CPU; no se presenta esa inferencia como una causa demostrada.
<!-- STAGE_METRICS_END -->

### Desplazamiento físico

`runScroll.ps1` ejecuta 45 segundos y 20 swipes ADB de 500 ms por tamaño/versión. Inspecciona bounds de la lista y evita la barra flotante; conserva XML, screenshots, coordenadas/timestamps y JSONL. Se comprueba carga progresiva, IDs únicos, cambios visibles, foreground, pantalla desbloqueada y release/Hermes.

<!-- SCROLL_METRICS_START -->
[Resumen](transactions-phase31/scroll/summary.json). Se inspeccionó visualmente el screenshot final de 100.000 posterior; tarjetas, cabecera y barra flotante conservan el diseño.

| Movimientos | Filas retenidas/únicas 3 / 3.1 | RAF p95 (ms) | RAF máximo (ms) | Frame nativo p95 (ms) |
|---:|---:|---:|---:|---:|
| 1.000 | 100/100 / 100/100 | 18,17 / 18,23 | 296,91 / 341,82 | 20,76 / 21,09 |
| 10.000 | 150/150 / 150/150 | 17,65 / 17,87 | 494,78 / 417,81 | 30,91 / 30,35 |
| 100.000 | 150/150 / 150/150 | 17,92 / 17,96 | 435,40 / 429,94 | 30,36 / 30,40 |

En 100.000 el mapeo, append y agrupación de las páginas físicas suman unos 2 ms por versión; los gaps máximos siguen cerca de 430 ms. No hay evidencia de mejora de desplazamiento por este refinamiento. Pico PSS de esa prueba: 183,72 / 183,07 MiB.
<!-- SCROLL_METRICS_END -->

Una muestra por combinación, con frames inactivos dentro de los 45 segundos, permite comprobar funcionamiento y detectar pausas grandes; no demuestra estadísticamente una mejora de FPS. Quedan pendientes el perfil completo de commits/renderizado, teclado con escritura rápida, sesiones prolongadas y navegación mediante AppNavigator real. Estos límites no se confunden con equivalencia funcional ni con tiempos SQL.

## Validación y riesgos restantes

Las regresiones nuevas cubren candidatos en UTF-8/UTF-16LE/UTF-16BE, caracteres ASCII/control, Unicode que cambia a ASCII al pasar a minúsculas, NUL, literales y espacios; recorrido completo de 217 filas de texto; reutilización únicamente de vacíos exhaustivos, filtros diferentes, búsquedas más cortas, límites y aislamiento de caché; escrituras concurrentes durante hits; fechas heredadas tras mutación; cancelación y ausencia de publicación de comprobaciones canceladas. Se mantienen las pruebas de fase 3 con 100.000 movimientos, orden/empates/agrupaciones, filtros, búsqueda antigua, categorización global, edición, eliminación, alta/refresco y cambios mientras hay páginas pendientes.

En Android se comparan ambos repositorios paginados y el predicado original sobre fixtures de 80 y cero movimientos, con offsets/fechas heredadas y texto Unicode/NUL/control añadido de forma determinista. No se limita la comparación a las filas visibles.

<!-- QUALITY_METRICS_START -->
Jest: **194 pruebas aprobadas, 27 suites aprobadas**, tres benchmarks opcionales omitidos en la ejecución normal; el benchmark de refinamiento se ejecutó aparte y aprobó. TypeScript estricto, ESLint y diff check aprobados. [Logs](transactions-phase31/jest.log), [verificación final](transactions-phase31/final-verification.json). Las 72 comparaciones Android son exactas en resultados completos, orden y objetos financieros. La pantalla, hook y repositorio público conservan sus hashes de fase 3; package/lock y esquema permanecen intactos.
<!-- QUALITY_METRICS_END -->

Persisten el recorrido completo para negativas nuevas, el paso de candidatos Unicode a JS y la ruta heredada O(N) de IDs/fechas cuando el orden SQL no equivale a `Date`. La caché no promete acelerar todos los filtros: se invalida tras cualquier escritura financiera y no conserva páginas financieras completas. La respuesta interactiva aún incluye SQL, cola/puente y renderizado. No se cambian otras optimizaciones de Callstack para resolver esos límites.

## Reproducción sin instalar dependencias

```powershell
# PowerShell 7, Node 24 ya disponible
$env:SMARTFIN_HISTORY_REFINEMENT='comparison'
node --expose-gc node_modules/jest/bin/jest.js __tests__/transactionHistoryRefinementPerformance.test.ts --runInBand
Remove-Item Env:SMARTFIN_HISTORY_REFINEMENT
node scripts/androidTransactionsPhase31/summarizeNode.js

# Elegir una carpeta NUEVA fuera del repositorio. El preparador rechaza una existente.
node scripts/androidTransactionsPhase31/prepare.js C:/sfphase31-new
Push-Location C:/sfphase31-new/android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
Pop-Location
& ./scripts/androidTransactionsPhase31/run.ps1 -Harness C:/sfphase31-new -Output docs/performance/transactions-phase31/android-reproduction
node scripts/androidTransactionsPhase31/summarize.js docs/performance/transactions-phase31/android-reproduction
& ./scripts/androidTransactionsPhase31/runScroll.ps1 -Harness C:/sfphase31-new -Output docs/performance/transactions-phase31/scroll-reproduction -SkipInstall
node scripts/androidTransactionsPhase31/summarizeScroll.js docs/performance/transactions-phase31/scroll-reproduction

node node_modules/jest/bin/jest.js --runInBand
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
```

El script de dispositivo valida serial/modelo/OS/ABI, applicationId, release, Hermes y metadatos de `com.smartfin`. Una invocación inicial mediante Windows PowerShell 5 falló al pasar arrays a ADB; se conserva el log y no produjo muestras. El protocolo se ejecuta con PowerShell 7. El paquete de pruebas se deja instalado y detenido; su base es aislada. No se instala nada en producción ni se modifica su base.
