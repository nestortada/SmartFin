# Historial de movimientos: carga progresiva, fase 3

Fecha de trabajo: 10–11 de octubre de 2026, America/Bogota. Se aplica el ciclo medir → optimizar → medir → validar de la [skill de Callstack](../../.agents/skills/react-native-best-practices/SKILL.md). El árbol estaba limpio al comenzar. Se revisaron AGENTS.md, ARQUITECTURA.md, BASE_DE_DATOS.md, esquema/migraciones, contratos, hooks, pantalla, acciones y consumidores del historial.

## Línea base y alcance

La fase 1 ya utiliza `SectionList`, tarjetas individuales, claves por ID, encabezados/espaciados y modales existentes. Se conserva todo su diseño: la pantalla solo incorpora `loadMore`, `onEndReached` y su umbral. La fase 2 mantiene las consultas específicas del dashboard; sus cálculos, SQL y documentos de evidencia no se modifican.

Antes, el hook obtenía 19 columnas de **todos** los movimientos, guardaba el historial completo y construía meses/filtros/búsqueda/orden en memoria. La línea base funcional está congelada en [transactionHistoryBaseline.ts](../../__tests__/helpers/transactionHistoryBaseline.ts) y el hook original en [useTransactionsList.before.txt](transactions-phase3/useTransactionsList.before.txt). Los hashes del código anterior y verificaciones se conservan en [baseline.json](transactions-phase3/baseline.json). Antes de editar: Jest 173 aprobadas, 1 benchmark omitido; TypeScript y ESLint aprobados. Se ejecutó la medición anterior antes de editar producción: [before.json](transactions-phase3/before.json).

| Consumidor | Tratamiento en fase 3 |
|---|---|
| TransactionsScreen/useTransactionsList | Nueva API paginada, 50 filas iniciales y páginas al desplazarse |
| Dashboard | Conserva las proyecciones y cálculos de fase 2 |
| Tarjetas débito/crédito y reconciliación de deuda | `getTransactions()` completo, sin modificaciones |
| Guardado/edición/eliminación manual y acompañantes de transferencias/impuesto | Casos de uso y lectura completa conservados |
| IA: contexto, resolución y búsqueda de movimientos | API completa conservada |
| Suscripciones: candidatos y movimientos vinculados | Consultas específicas existentes conservadas |
| Respaldo/exportación | Historial completo conservado |

Acciones de tarjeta, cuotas, selección, categorización individual/global, edición y eliminación siguen recibiendo el objeto `Transaction` completo. La categorización por descripción sigue actualizando toda la base, incluso registros sin cargar. No se cambian saldos, deudas, importes, reglas contables ni dependencias.

## Consulta, equivalencia y concurrencia

Los nuevos contratos están en `TransactionHistoryQuery.ts`. `getTransactionPage(query,cursor?,isCancelled?)` trabaja en el repositorio existente con un adaptador específico; la UI no consulta SQL. Mes usa el prefijo literal almacenado; cuenta respeta la excepción de transferencias internas; categoría usa igualdad. No se añade filtro de tipo, estado ni medio de pago: los controles de operación existentes editan el movimiento.

La búsqueda original evalúa `search.trim().length > 0`, pero usa el texto **sin recortar**, en minúsculas, contra comercio, descripción y notas. SQLite LOWER no preserva el mismo Unicode, ni LIKE reproduce los comodines literales. La solución aplica los filtros SQL y busca con el predicado JS original en proyecciones de 200 candidatos, hasta encontrar 50 coincidencias o agotar toda la consulta. Para consultas ASCII imprimibles, un prefiltro SQL usa INSTR/LOWER y deja pasar también cualquier campo con Unicode, controles o NUL. Así descarta solo candidatos que no pueden coincidir; JavaScript conserva siempre la decisión final. Las comprobaciones de fecha siguen usando el índice de fechas sin ese predicado textual, evitando descargar filas para validar el orden. Luego materializa solo las coincidencias. Las búsquedas antiguas y sin coincidencias no se limitan a la página visible. No hay límite total ni recorte silencioso.

Para UTC homogéneo (`...ssZ` o `...ss.SSSZ`) y calendario válido, el orden textual equivale a `Date`. Se verifica la forma sobre fechas distintas en SQLite; `LIMIT -1` mantiene la proyección interna y evita repetir la validación por cada fecha duplicada. Páginas por cursor usan `date DESC/ASC, created_at DESC, rowid DESC`; `created_at` y la dirección del desempate se mantienen incluso en orden antiguo. El índice de fecha existente recorría `rowid` descendente en empates exactos; la nueva consulta lo hace explícito y conserva esa estabilidad. No se usa OFFSET en el historial.

Offsets, precisión mixta, fechas locales y fechas inválidas requieren compatibilidad: se leen por cursor proyecciones estrechas en lotes de 200, se filtra la búsqueda **antes** del orden, se conserva ID/fecha y se aplica exactamente el comparador estable anterior, incluido `NaN`. Solo después se materializan páginas de 50 por ID. Esta ruta tiene trabajo y memoria de metadatos O(N) antes de la primera página; garantiza equivalencia sin guardar todos los movimientos completos. No se confunde esta excepción con una mejora constante de memoria para cualquier base heredada.

`getTransactionMonths()` consulta meses de **todo** el historial, independientemente de filtros y páginas. Su orden conserva `localeCompare`. Las comprobaciones de fechas/meses pueden recorrer índices de toda la base dentro de SQLite: limitar filas devueltas no significa limitar todas las visitas del motor.

Cada cursor contiene la consulta y revisión financiera. Se lee `financial_data_revision` antes y después de cada página; una escritura produce invalidación y reinicia la generación. El hook serializa cargas, ignora eventos de fin repetidos mientras está ocupado y cancela respuestas anteriores al cambiar base/filtro/búsqueda/orden/refresco o desmontar. No mezcla snapshots. El refresco reconstruye la profundidad ya cargada; nuevos filtros comienzan en 50. Una página fallida conserva las filas visibles y permite reintentar mediante otra solicitud de carga. Las tarjetas seleccionadas siguen conservando su objeto durante acciones/modales.

## Node/SQLite: comparación reproducible

[comparison.json](transactions-phase3/comparison.json) contiene cinco muestras por tamaño/camino/consulta, igualdad exacta de la página contra el baseline, filas devueltas, delta de heap y planes EXPLAIN. Node 24.16, SQLite en memoria, Windows, `--expose-gc`. Las bases usan el generador determinista existente de fase 2, con 1.000, 10.000 y 100.000 registros y sin datos reales. Ambos caminos se ejecutan sobre la misma base de cada tamaño. El baseline cronometrado incluye consulta completa, mapeo, filtros y sort; el posterior incluye página y meses. No se cronometra UI/puente/Hermes. El baseline de referencia y el fixture permanecen vivos en ambas mediciones.

| Movimientos | Carga inicial antes (mediana ms) | Después | Filas devueltas antes/después | Movimientos retenidos antes/después |
|---:|---:|---:|---:|---:|
| 1.000 | 6,51 | 2,11 | 1.000 / 91 | 1.000 / 50 |
| 10.000 | 49,00 | 3,59 | 10.000 / 91 | 10.000 / 50 |
| 100.000 | 765,02 | 14,64 | 100.000 / 91 | 100.000 / 50 |

Las 91 filas posteriores son 51 movimientos (incluida anticipación), 37 meses, una fecha de forma y dos revisiones. Las consultas de validación canónica pueden examinar el índice completo, devolviendo cero filas inválidas. No se midieron visitas VM; no se presenta 91 como el número de filas físicamente examinadas.

| Movimientos | Búsqueda con coincidencias antes/después (ms) | Sin coincidencias antes/después (ms) |
|---:|---:|---:|
| 1.000 | 6,11 / 4,30 | 5,38 / 4,44 |
| 10.000 | 49,26 / 26,32 | 45,42 / 29,15 |
| 100.000 | 665,33 / 41,90 | 662,66 / 318,65 |

Consulta positiva: `merchant 49`, negativa: `never found`. En 100.000, la positiva devuelve 290 filas entre candidatos estrechos, 50 coincidencias materializadas y metadatos; la negativa devuelve 40 filas de metadatos y cero movimientos completos. El motor todavía examina candidatos sobre toda la base. Estas mejoras de escritorio no se extrapolan a búsquedas interactivas Android que antes reutilizaban un historial ya cargado.

Delta mediano de heap de la carga inicial: aproximadamente 3,26/32,06/191,08 MiB antes y 0,224/0,221/0,221 MiB después. Es un delta al terminar la operación, afectado por GC, no pico ni medición de memoria Android. El JSON de las filas iniciales pasa de aproximadamente 499 KiB/4,89 MiB/49,00 MiB a unos 25 KiB. JSON es volumen de datos retenidos, no tamaño real de objetos ni heap.

Para reproducir sin instalar paquetes:

```powershell
$env:SMARTFIN_HISTORY_BENCHMARK='comparison'
node --expose-gc node_modules/jest/bin/jest.js __tests__/transactionHistoryPerformance.test.ts --runInBand
Remove-Item Env:SMARTFIN_HISTORY_BENCHMARK
```

## Android release

El harness en `scripts/androidTransactionsPhase3/` reutiliza el protocolo de aislamiento/observación de fase 2: paquete `com.smartfin.transactionsphase3.bench`, bases `transactions_phase3_v3_<N>.db`, release arm64, Hermes, HONOR CRT-NX3/Android 15/America-Bogota. Se monta `TransactionsScreen` real con el hook original o paginado. Hay dos calentamientos y cinco muestras por versión/tamaño, mismas bases sintéticas, cuentas y categorías. Cada muestra mide apertura, filtros combinados, búsqueda positiva/negativa y reset; el camino posterior añade nueve páginas hasta 500 filas. Los snapshots son funcionalmente comparables; los generadores Node y Android tienen distribuciones distintas y sus cifras no se mezclan. No se encontró un protocolo de fase 1 adicional en los archivos del repositorio; se reutiliza el protocolo físico documentado de fase 2.

Se preservó el piloto en `transactions-phase3/android-pilot/`. Detectó que el puente Android vincula parámetros numéricos como texto; `length(date) <> ?` activaba innecesariamente compatibilidad. Se corrigió a `length(date) <> CAST(? AS INTEGER)` y se añadió una regresión con bindings textuales. El piloto no se usa como resultado final. También se corrigió el cursor sobrante al agotar un número exacto de lotes de búsqueda y se eliminó OFFSET de la compatibilidad.

Se validaron **30 muestras** (cinco por versión/tamaño) y **12 comparaciones funcionales exactas** en el dispositivo. Los hashes de producción coinciden con las fuentes finales y el paquete `com.smartfin` mantuvo sus metadatos. [Resumen validado](transactions-phase3/android/summary.json), [proveniencia de campañas](transactions-phase3/android/provenance.json) y JSONL/entorno/meminfo están en la misma carpeta. Se reutilizaron las quince muestras del baseline original, cuyo hook/API completa no cambió; las quince posteriores corresponden al código final sobre las **mismas bases persistentes**. No son muestras intercaladas de una única ejecución: temperatura, USB/carga y estado del sistema no están controlados.

| Movimientos | Datos listos antes/después (mediana ms) | Tras dos RAF antes/después (ms) | Filas devueltas antes/después | Pico PSS del protocolo antes/después (MiB) |
|---:|---:|---:|---:|---:|
| 1.000 | 222,28 / 195,77 | 262,33 / 248,91 | 1.012 / 103 | 173,39 / 172,88 |
| 10.000 | 1.224,23 / 224,50 | 1.355,41 / 327,92 | 10.012 / 103 | 190,85 / 152,08 |
| 100.000 | 16.445,51 / 241,05 | 16.579,17 / 284,55 | 100.012 / 103 | 664,60 / 159,57 |

Datos listos incluye montaje de pantalla, consultas, puente y hook; dos RAF es un marcador de presentación JS, **no** una medición del compositor ni arranque frío de la app. Las 103 filas posteriores incluyen 51 movimientos, 37 meses, 8 cuentas, 4 categorías, 2 revisiones y una fecha de forma. La consulta de validación no devuelve fechas inválidas. La carga inicial retiene exactamente 50 movimientos en todas las muestras.

PSS se muestrea cada 100 ms en el proceso completo. Su ventana incluye filtros/búsquedas/reset y, solo después, nueve páginas adicionales hasta 500 filas. Es un pico **muestreado del protocolo**, no heap JS ni memoria inicial exclusiva; las ventanas no tienen la misma duración/trabajo. En 1.000 el pico prácticamente no cambia. Las nueve páginas posteriores incluyen consultas y actualizaciones React; no equivalen a FPS de desplazamiento. Sus muestras y percentiles completos están en el resumen JSON.

| Movimientos | Filtros combinados antes/después (ms) | Búsqueda positiva antes/después (ms) | Sin coincidencias antes/después (ms) |
|---:|---:|---:|---:|
| 1.000 | 100,48 / 144,86 | 133,14 / 173,20 | 39,37 / 71,64 |
| 10.000 | 93,32 / 150,29 | 169,53 / 295,83 | 82,55 / 218,92 |
| 100.000 | 180,05 / 181,79 | 690,75 / 356,68 | 510,88 / 1.306,31 |

Estas interacciones comparan el baseline **ya cargado en memoria** con nuevas consultas locales posteriores. Se registra la regresión de filtros/búsqueda en varios tamaños; en 100.000 la búsqueda positiva mejora, pero la negativa sigue siendo más lenta. El prefiltro conservador redujo la negativa de aproximadamente 6,93 s en la campaña sin prefiltro a 1,31 s en el código final, sin perder Unicode ni resultados. `android-pre-ascii/` conserva esa campaña y `sqliteTransactionHistory.preAscii.txt` coincide con su hash. `android-ascii-pilot/` conserva la iteración donde el predicado textual también ralentizaba la comprobación de fechas; esa comprobación se separó para usar el índice de fechas. No se usan esos intentos como resultado final.

El harness obtiene configuración mediante una llamada nativa explícita después de adjuntar la Activity: evita que valores predeterminados durante creación del contexto clasifiquen una preparación como medición. Este ajuste afecta exclusivamente al harness. Los intentos Logcat por PID devolvieron archivos vacíos; no permiten afirmar ausencia de advertencias. Los builds release terminaron con warnings de APIs/Gradle/configuración heredados de dependencias, sin instalar ni modificar versiones.

### Desplazamiento físico adicional

Se completó una muestra posterior por tamaño, de 45 segundos con 20 swipes ADB de 500 ms sobre la lista real. El script inspecciona los bounds del ScrollView y comienza por encima de la barra flotante existente. Las primeras pruebas tocaban esa barra y no desplazaban el historial: se preservan en `scroll-pilot/` y se descartan. Un arranque perdió el foco de forma transitoria; se rechazó antes de ejecutar gestos y se repitió. Los tres registros finales cumplen foco, release/Hermes, IDs únicos y carga adicional; [resumen](transactions-phase3/scroll/summary.json), XML antes/después, coordenadas/timestamps y capturas están en `scroll/`.

| Movimientos en base | Retenidos al finalizar | Nuevas consultas | Eventos de visibilidad | p95 FrameMetrics (ms) | Máximo hueco RAF JS (ms) |
|---:|---:|---:|---:|---:|---:|
| 1.000 | 100 | 3 | 286 | 30,20 | 347,88 |
| 10.000 | 150 | 6 | 220 | 22,17 | 442,08 |
| 100.000 | 150 | 6 | 199 | 29,95 | 445,62 |

Hay exactamente 100/150/150 IDs únicos. Se atravesaron páginas mediante `onEndReached`, sin cargar toda la base, y se inspeccionó la [captura final de 100.000](transactions-phase3/scroll/scroll-20261011-000637-100000.png). Los huecos JS de hasta 446 ms durante carga/render de páginas muestran pausas pendientes; no se afirma ausencia de jank ni 60 FPS. Una muestra por tamaño, con tiempo inactivo dentro de la ventana y sin par anterior de gestos, no permite afirmar una mejora cuantitativa de FPS respecto de fase 1. Esta observación no justifica modificar otras optimizaciones dentro del alcance solicitado. La navegación real de AppNavigator, gestos rápidos y estabilidad de horas quedan pendientes; los siete remontajes por camino/tamaño y pruebas de hook cubren recarga y liberación de la generación.

Reproducción (ruta del harness nueva, SDK y dispositivo ya disponibles):

```powershell
node scripts/androidTransactionsPhase3/prepare.js C:/sfphase3-repro
Set-Location C:/sfphase3-repro/android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
Set-Location C:/Users/nesto/Proyectos/SmartFin
& scripts/androidTransactionsPhase3/run.ps1 -Harness C:/sfphase3-repro -Output docs/performance/transactions-phase3/android-repro
node scripts/androidTransactionsPhase3/summarize.js docs/performance/transactions-phase3/android-repro
& scripts/androidTransactionsPhase3/runScroll.ps1 -Harness C:/sfphase3-repro -Output docs/performance/transactions-phase3/scroll-repro
node scripts/androidTransactionsPhase3/summarizeScroll.js docs/performance/transactions-phase3/scroll-repro
```

El preparador copia fuentes/nativo y reutiliza node_modules por junction. Modifica e instrumenta solo la copia, sin escribir producción ni instalar dependencias. El runner verifica applicationId/release, dispositivo/foco y metadatos del paquete de producción, conserva JSONL/entorno/meminfo/Logcat y valida datos de muestra. El resumen comprueba hashes de las fuentes finales, límites de primera página, consultas SELECT e igualdad de los fixtures funcionales vacío y de 80 fechas heredadas. El patrón de instalación no sobrescribe `com.smartfin`.

## Validación funcional, riesgos y pendientes

Las pruebas reales de SQLite comparan objetos completos y agrupaciones con el hook congelado, sin tolerancias monetarias. Cubren recorrido completo de 1.000/10.000/100.000, fechas antiguas, combinaciones, transferencias/contracuentas, categorías, Unicode (`Á`, `İ`, sigma, `Ω`), `%`/`_`, espacios sin recortar, empates entre páginas, offsets, febrero normalizado, inválidas, ambos órdenes, base vacía, cambio de revisión, cancelación, modificación durante SELECT, categorización global de 2.000 filas y bindings Android. El hook se prueba con promesas retenidas para cambios de filtro/orden/búsqueda mientras carga, eventos repetidos, inserción durante página, refresco tras edición/eliminación y recuperación de error. Las pruebas de pantalla existentes verifican diseño/espaciados/etiquetas/temas/modales y ahora ejecutan SQL real. Las pruebas contables y de fase 2 siguen ejecutándose.

Límites explícitos:

- Búsqueda sin coincidencias sigue siendo O(N) dentro de SQLite; el prefiltro ASCII reduce el cruce del puente. Unicode puede requerir recorrer proyecciones en JS por lotes. La decisión final conserva el predicado original; SQL puro cambiaría resultados.
- Compatibilidad de fechas requiere ordenar metadatos globales; conserva resultados a cambio de coste inicial O(N).
- Las páginas visitadas permanecen en memoria para conservar desplazamiento y acciones. Recorrer todo el historial terminará reteniendo todos los movimientos; no se implementa evicción ni una nueva optimización de listas.
- Edición/eliminación contable, IA, tarjetas y reconciliación conservan los consumidores completos de `getTransactions()`; esta fase no reduce sus lecturas ni su latencia.
- Meses y comprobación canónica recorren SQLite; filtros por cuenta/categoría usan el índice de fecha para conservar orden. No se introducen índices especulativos.
- La revisión financiera también cambia por otras tablas; puede provocar un refresco conservador adicional. Escrituras continuas pueden retrasar una consulta estable.
- PSS es de todo el proceso; FrameMetrics y huecos RAF del protocolo no certifican FPS de scroll. No se presenta una prueba de horas, Perfetto/GPU, todos los dispositivos ni navegación raíz real como validada.
- `agent-device` no estaba disponible y no se instaló. La inspección física adicional usa el harness/ADB existentes; las verificaciones no realizadas se distinguen de las pruebas automatizadas.

Verificación final: Jest 26 suites y 185 pruebas aprobadas; 2 benchmarks opcionales omitidos en la ejecución normal. El benchmark de fase 3 se ejecutó por separado y aprobó con igualdad exacta. TypeScript, ESLint y `git diff --check` aprobados. Android release arm64/Hermes compilado e instalado solo en el paquete aislado.

[Registro de verificación y preservación de contratos/fase 2/dependencias](transactions-phase3/final-verification.json). El paquete sintético permanece instalado y detenido; el harness se conserva en `C:/sfphase3` para reproducir/inspeccionar.
