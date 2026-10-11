# Validación física de la fase 2 — HONOR

**Resultado: APROBADA CON OBSERVACIONES.** La optimización conserva exactamente el resumen financiero y reduce consultas, procesamiento JS, refresco y PSS en los cuatro tamaños probados. La fase 2 puede cerrarse dentro del alcance del dashboard y SmartFin puede comenzar la fase 3 como trabajo separado. No se implementó la fase 3.

## Entorno y protección de datos

Pruebas ejecutadas realmente por ADB el 10/10/2026, aproximadamente 23:13–23:20, en HONOR CRT-NX3, serie AXCC6R3919012932, Android 15/API 35, arm64-v8a, America/Bogota, pantalla de 60 Hz. React Native 0.85.3, Hermes confirmado en cada muestra, SQLite Android 3.44.5. APK release, BuildConfig.DEBUG=false y __DEV__=false; usa la firma de desarrollo configurada en el proyecto y R8 desactivado, igual que su configuración release actual. Build con Java 17, Gradle 9.3.1, Android SDK local y Node 24.16.0.

Se instaló exclusivamente **com.smartfin.dashboardphase2.bench**. Se verificaron applicationId y ausencia de application-debuggable antes de instalar. El proyecto de prueba está en C:/sfphase2, fuera del repositorio. Solo monta una copia del DashboardScreen; no monta Navigator ni inicia los servicios, receptores o trabajos nativos de producción. Las bases privadas son dashboard_phase2_v3_<cantidad>.db. El archivo .env del proyecto aislado está vacío.

No se abrió SmartFin ni su base financiera; no se ejecutó pm clear ni se instaló su APK. La versión y fechas de instalación de com.smartfin permanecieron iguales. Esta evidencia es una comprobación de metadatos, no una inspección del contenido financiero, que se evitó deliberadamente. Los hashes de los cuatro archivos de producción utilizados permanecen iguales al final. No se hicieron commits ni se instalaron dependencias.

Evidencias: [protección del paquete](C:/Users/nesto/Proyectos/SmartFin/docs/performance/android-phase2/production-package-unchanged.json), [verificación final y SHA256 del APK](C:/Users/nesto/Proyectos/SmartFin/docs/performance/android-phase2/final-verification.json), [entorno](C:/Users/nesto/Proyectos/SmartFin/docs/performance/android-phase2/preflight.json), [fuentes comparadas](C:/Users/nesto/Proyectos/SmartFin/docs/performance/android-phase2/source-fingerprints.json).

## Metodología

Se aplicó react-native-best-practices de Callstack: medir, volver a medir y validar el mismo flujo en release. Se revisaron AGENTS.md, ARQUITECTURA.md, BASE_DE_DATOS.md, repositorios, useCase y hook del dashboard. No se encontró un harness reutilizable de rendimiento del dashboard de la fase 1; los tests Android existentes de suscripciones no ejercitan este flujo.

La versión anterior se recuperó mediante git show del commit a9dd112859e51c099905d1806f992c2628b7b41c, sin modificar el checkout. Ambas versiones están en el mismo APK y leen exactamente el mismo archivo SQLite por tamaño. El generador determinista crea 8 cuentas, categorías, todos los tipos financieros, estados posted/pending/cancelled, importes fraccionarios, pares de transferencias y fechas distribuidas durante 1.096 días. Los saldos son snapshots de cuentas, como los lee el dashboard; el fixture no reconstruye un libro contable desde saldos iniciales.

La creación de bases ocurre en procesos separados, antes de medir. Para cada tamaño y versión se reinicia únicamente el paquete de prueba, se hace una carga inicial sin medir, dos refrescos de calentamiento y cinco medidos, con 500 ms de pausa entre ellos. Orden alternado: antes/después en 1.000 y 50.000; después/antes en 10.000 y 100.000. No se fuerza GC ni se limpia la caché del sistema; representa refrescos calientes, no arranque en frío. Dispositivo conectado por USB/cargando; batería y temperatura por ejecución están en los archivos environment.json. No se controló térmicamente el dispositivo ni se realizó una campaña de órdenes aleatorios.

Hay **40 muestras válidas**, con foco comprobado al inicio/final, pantalla encendida y sin bloqueo. No se registró el foco continuamente. Se excluyó el primer par de 10.000 porque tres muestras optimizadas perdieron el foco; se repitieron ambas versiones. Los registros excluidos permanecen en android-phase2/excluded-focus-loss. Los directorios android-phase2-pilot y android-phase2-pilot2 contienen pilotos descartados: ventana cubierta por notificaciones/datos iniciales poco representativos, y generación de datos dentro del proceso medido, respectivamente. No participan en las tablas.

### Qué mide cada tiempo

- **SQL/cursor:** suma de rawQuery, moveToFirst y moveToNext en la copia instrumentada del adaptador SQLite Android. Incluye ejecución/materialización de ventanas del cursor; excluye convertir columnas a objetos Java y enviarlos a JS. No es un perfil de opcodes SQLite.
- **Consulta nativa y codificación:** ejecución completa del lector Java, incluyendo construcción de filas. La diferencia respecto a SQL es material en el historial completo.
- **JS financiero:** funciones originales de cálculo del resumen y filtrado/suma de conteos diarios. El mapeo de filas a objetos de dominio se registra por separado.
- **Datos listos:** desde cambiar refreshKey hasta resolver el useCase, incluyendo planificación, consulta, transporte y JS.
- **Refresco completo medido:** desde cambiar refreshKey hasta el commit React del resumen y dos callbacks requestAnimationFrame. Usa DashboardScreen y su hook copiados. Incluye carga y actualización de la pantalla, pero no certifica presentación final del compositor/GPU, arranque, navegación ni respuesta táctil.
- **PSS:** proceso completo mediante Debug.MemoryInfo al inicio/final y cada 100 ms; se contrasta con dumpsys meminfo. El pico es muestreado, no continuo.

Los tres SELECT optimizados se solicitan con Promise.all; la suma de sus tiempos de promesa incluye espera/cola y puede solaparse. No debe sumarse al refresco como una etapa adicional. La instrumentación de cursor, FrameMetrics y PSS añade coste no cuantificado; ambos caminos usan el mismo APK/instrumentación, pero el coste crece con filas y duración. Los tiempos absolutos son del harness instrumentado, no una promesa de latencia de toda la aplicación de producción.

## Rendimiento: medianas reales

Latencias en ms; memoria en MiB (KiB/1024). Variación = (después/antes − 1) × 100. Un valor negativo indica reducción.

| Escenario | Métrica | Antes | Después | Variación |
|---|---|---:|---:|---:|
| 1.000 | SQL/cursor | 5.082 | 0.951 | -81.30% |
| 1.000 | Consulta nativa + codificación | 69.215 | 2.651 | -96.17% |
| 1.000 | JS financiero | 2.555 | 0.059 | -97.68% |
| 1.000 | Mapeo JS | 10.830 | 0.155 | -98.57% |
| 1.000 | Refresco completo medido | 188.676 | 98.117 | -48.00% |
| 1.000 | PSS final (MiB) | 127.35 | 117.01 | -8.12% |
| 1.000 | Pico PSS muestreado (MiB) | 127.35 | 117.01 | -8.12% |
| 10.000 | SQL/cursor | 163.331 | 6.647 | -95.93% |
| 10.000 | Consulta nativa + codificación | 800.201 | 15.580 | -98.05% |
| 10.000 | JS financiero | 33.689 | 0.349 | -98.96% |
| 10.000 | Mapeo JS | 156.051 | 0.478 | -99.69% |
| 10.000 | Refresco completo medido | 1342.052 | 153.089 | -88.59% |
| 10.000 | PSS final (MiB) | 138.66 | 120.02 | -13.44% |
| 10.000 | Pico PSS muestreado (MiB) | 204.10 | 120.02 | -41.19% |
| 50.000 | SQL/cursor | 1735.923 | 5.063 | -99.71% |
| 50.000 | Consulta nativa + codificación | 4133.760 | 8.962 | -99.78% |
| 50.000 | JS financiero | 122.166 | 0.310 | -99.75% |
| 50.000 | Mapeo JS | 533.195 | 0.779 | -99.85% |
| 50.000 | Refresco completo medido | 5776.643 | 130.961 | -97.73% |
| 50.000 | PSS final (MiB) | 307.82 | 123.84 | -59.77% |
| 50.000 | Pico PSS muestreado (MiB) | 315.14 | 123.84 | -60.70% |
| 100.000 | SQL/cursor | 9375.926 | 18.592 | -99.80% |
| 100.000 | Consulta nativa + codificación | 16248.550 | 27.944 | -99.83% |
| 100.000 | JS financiero | 339.589 | 0.386 | -99.89% |
| 100.000 | Mapeo JS | 1545.363 | 1.217 | -99.92% |
| 100.000 | Refresco completo medido | 20450.131 | 152.411 | -99.25% |
| 100.000 | PSS final (MiB) | 253.95 | 124.59 | -50.94% |
| 100.000 | Pico PSS muestreado (MiB) | 538.08 | 124.59 | -76.85% |

La referencia Windows de 649,20 → 4,70 ms queda separada de estas mediciones: otro runtime, fixture, adaptador y endpoint. En Android, el lector de 19 columnas y el transporte de objetos tienen costes importantes que la referencia Windows no representa.

### Mínimo, máximo y p95

Cinco muestras por celda; p95 por rango más cercano equivale al máximo con n=5. No permite caracterizar de forma robusta la cola de latencia. Todos los valores individuales, medianas y estadísticas de todas las métricas están en [summary.json](C:/Users/nesto/Proyectos/SmartFin/docs/performance/android-phase2/summary.json).

| Escenario | Versión | Métrica | Mediana | Mínimo | Máximo | p95 |
|---|---|---|---:|---:|---:|---:|
| 1.000 | Antes | SQL/cursor | 5.082 | 4.745 | 12.303 | 12.303 |
| 1.000 | Antes | Consulta nativa + codificación | 69.215 | 49.537 | 100.422 | 100.422 |
| 1.000 | Antes | JS financiero | 2.555 | 2.403 | 8.290 | 8.290 |
| 1.000 | Antes | Mapeo JS | 10.830 | 10.650 | 14.540 | 14.540 |
| 1.000 | Antes | Refresco completo medido | 188.676 | 148.638 | 249.870 | 249.870 |
| 1.000 | Antes | PSS final (MiB) | 127.35 | 115.09 | 142.27 | 142.27 |
| 1.000 | Antes | Pico PSS muestreado (MiB) | 127.35 | 116.16 | 142.27 | 142.27 |
| 1.000 | Después | SQL/cursor | 0.951 | 0.560 | 1.594 | 1.594 |
| 1.000 | Después | Consulta nativa + codificación | 2.651 | 1.488 | 4.936 | 4.936 |
| 1.000 | Después | JS financiero | 0.059 | 0.055 | 0.072 | 0.072 |
| 1.000 | Después | Mapeo JS | 0.155 | 0.148 | 0.209 | 0.209 |
| 1.000 | Después | Refresco completo medido | 98.117 | 68.461 | 102.595 | 102.595 |
| 1.000 | Después | PSS final (MiB) | 117.01 | 104.66 | 128.59 | 128.59 |
| 1.000 | Después | Pico PSS muestreado (MiB) | 117.01 | 104.67 | 128.59 | 128.59 |
| 10.000 | Antes | SQL/cursor | 163.331 | 160.351 | 171.500 | 171.500 |
| 10.000 | Antes | Consulta nativa + codificación | 800.201 | 781.750 | 842.050 | 842.050 |
| 10.000 | Antes | JS financiero | 33.689 | 33.077 | 41.525 | 41.525 |
| 10.000 | Antes | Mapeo JS | 156.051 | 154.240 | 156.367 | 156.367 |
| 10.000 | Antes | Refresco completo medido | 1342.052 | 1299.604 | 1444.131 | 1444.131 |
| 10.000 | Antes | PSS final (MiB) | 138.66 | 131.57 | 212.21 | 212.21 |
| 10.000 | Antes | Pico PSS muestreado (MiB) | 204.10 | 141.81 | 279.17 | 279.17 |
| 10.000 | Después | SQL/cursor | 6.647 | 1.020 | 7.990 | 7.990 |
| 10.000 | Después | Consulta nativa + codificación | 15.580 | 2.199 | 16.645 | 16.645 |
| 10.000 | Después | JS financiero | 0.349 | 0.158 | 0.376 | 0.376 |
| 10.000 | Después | Mapeo JS | 0.478 | 0.305 | 0.577 | 0.577 |
| 10.000 | Después | Refresco completo medido | 153.089 | 111.757 | 177.410 | 177.410 |
| 10.000 | Después | PSS final (MiB) | 120.02 | 107.56 | 131.99 | 131.99 |
| 10.000 | Después | Pico PSS muestreado (MiB) | 120.02 | 107.56 | 131.99 | 131.99 |
| 50.000 | Antes | SQL/cursor | 1735.923 | 1720.416 | 1746.856 | 1746.856 |
| 50.000 | Antes | Consulta nativa + codificación | 4133.760 | 4113.411 | 4181.299 | 4181.299 |
| 50.000 | Antes | JS financiero | 122.166 | 118.759 | 130.945 | 130.945 |
| 50.000 | Antes | Mapeo JS | 533.195 | 529.275 | 540.376 | 540.376 |
| 50.000 | Antes | Refresco completo medido | 5776.643 | 5685.474 | 5808.138 | 5808.138 |
| 50.000 | Antes | PSS final (MiB) | 307.82 | 294.75 | 309.73 | 309.73 |
| 50.000 | Antes | Pico PSS muestreado (MiB) | 315.14 | 313.27 | 325.42 | 325.42 |
| 50.000 | Después | SQL/cursor | 5.063 | 3.074 | 10.421 | 10.421 |
| 50.000 | Después | Consulta nativa + codificación | 8.962 | 5.588 | 14.890 | 14.890 |
| 50.000 | Después | JS financiero | 0.310 | 0.210 | 0.371 | 0.371 |
| 50.000 | Después | Mapeo JS | 0.779 | 0.601 | 0.864 | 0.864 |
| 50.000 | Después | Refresco completo medido | 130.961 | 110.329 | 150.399 | 150.399 |
| 50.000 | Después | PSS final (MiB) | 123.84 | 112.58 | 135.16 | 135.16 |
| 50.000 | Después | Pico PSS muestreado (MiB) | 123.84 | 112.58 | 135.16 | 135.16 |
| 100.000 | Antes | SQL/cursor | 9375.926 | 9322.304 | 10610.556 | 10610.556 |
| 100.000 | Antes | Consulta nativa + codificación | 16248.550 | 16196.172 | 18210.283 | 18210.283 |
| 100.000 | Antes | JS financiero | 339.589 | 336.252 | 343.809 | 343.809 |
| 100.000 | Antes | Mapeo JS | 1545.363 | 1530.756 | 1552.097 | 1552.097 |
| 100.000 | Antes | Refresco completo medido | 20450.131 | 20381.736 | 22348.133 | 22348.133 |
| 100.000 | Antes | PSS final (MiB) | 253.95 | 239.91 | 264.30 | 264.30 |
| 100.000 | Antes | Pico PSS muestreado (MiB) | 538.08 | 535.68 | 539.96 | 539.96 |
| 100.000 | Después | SQL/cursor | 18.592 | 6.640 | 47.638 | 47.638 |
| 100.000 | Después | Consulta nativa + codificación | 27.944 | 11.057 | 75.791 | 75.791 |
| 100.000 | Después | JS financiero | 0.386 | 0.272 | 0.640 | 0.640 |
| 100.000 | Después | Mapeo JS | 1.217 | 0.913 | 1.596 | 1.596 |
| 100.000 | Después | Refresco completo medido | 152.411 | 111.262 | 243.297 | 243.297 |
| 100.000 | Después | PSS final (MiB) | 124.59 | 113.40 | 136.90 | 136.90 |
| 100.000 | Después | Pico PSS muestreado (MiB) | 124.59 | 113.41 | 136.90 | 136.90 |

## Consultas y filas

Antes: 2 SELECT por refresco, cuentas y todo el historial de 19 columnas sin límite temporal. Después: 3 SELECT, cuentas intactas, proyección mensual amount/type/direction con fecha/estado/tipo/dirección y orden original, y COUNT(*) agrupado por prefijo de día para la ventana reciente. Se conservan los índices existentes, sin migraciones.

| Escenario | Filas de historial devueltas antes | Devueltas después | Candidatas por rango después | Coincidentes con WHERE después |
|---|---:|---:|---:|---:|
| 1.000 | 1000 | 9 | 60 | 26 |
| 10.000 | 10000 | 60 | 424 | 190 |
| 50.000 | 50000 | 162 | 2044 | 1066 |
| 100.000 | 100000 | 285 | 4040 | 2143 |

Se devuelven además las mismas 8 cuentas en ambas versiones. En 100.000: 251 importes mensuales y 34 grupos de día; 930 candidatas mensuales y 3.110 candidatas recientes, con 251 y 1.892 filas coincidentes respectivamente. Las sumas pueden contar una transacción en ambas consultas. Las candidatas son COUNT de filas dentro del rango de fechas y las coincidentes son COUNT con el WHERE real, ejecutados después del endpoint cronometrado. **No se midió el número exacto de visitas de la máquina virtual SQLite** ni se presenta este COUNT como filas físicamente examinadas.

No se trasladó la suma monetaria a SUM SQL: REAL y el orden de acumulación pueden producir diferencias de coma flotante. Se mantiene el reduce JS y ORDER BY date DESC, created_at DESC. El conteo sí se agrega en SQL y el useCase reaplica la semántica anterior de medianoche local y 30 × 24 horas; el rango incluye tres días candidatos adicionales para conservar la normalización JS de febrero 30/31. No se introdujo una optimización financiera nueva durante esta validación.

## Igualdad financiera

Se comparó el objeto completo sin tolerancias ni redondeos mediante JSON.stringify. Los 5 resultados de cada versión son deterministas; cada par de versiones coincide exactamente. El saldo disponible, deuda y patrimonio son 3.100, 1.000 y 7.100 COP en todos los escenarios. Las cuentas activas cash/bank/savings/investment y las deudas card/loan usan el mismo repositorio y los mismos snapshots; las cuentas closed/inactive se excluyen igual. No se ejercitaron mutaciones de saldos ni reconciliación del libro contable.

| Movimientos | Ingresos exactos en ambas versiones | Gastos exactos | Ahorro exacto | Recientes |
|---|---:|---:|---:|---:|
| 1.000 | 25.4 | 45 | -19.6 | 18 |
| 10.000 | 50411.69999999999 | 80068.69999999998 | -29656.999999999993 | 148 |
| 50.000 | 219048.00000000017 | 361277.50000000035 | -142229.50000000017 | 856 |
| 100.000 | 449105.6000000002 | 755960.2999999984 | -306854.6999999982 | 1728 |

Los decimales se muestran sin corregir los artefactos de coma flotante que ya existían: la igualdad comprobada es más estricta que la apariencia redondeada en pantalla.

Se realizaron **12 comparaciones adicionales** en el dispositivo: fixture de 80 movimientos con límites y fixture de cero movimientos, para 10/10/2026, 01/01/2026, 31/12/2026, 29/02/2024, 31/03/2026 y 15/11/2026. Todas exactas. Incluyen offsets +14:00, Z y −05:00, límites mensual/anual, bisiesto, límites de ventana, fechas febrero 30/31 y estados cancelados/pendientes. Se conserva el mes por prefijo escrito en la fecha y el día local derivado del prefijo de diez caracteres; no se convierte el instante UTC para decidir el mes. Solo America/Bogota se probó físicamente; otras zonas/DST siguen cubiertas por las pruebas de fase 2, no por esta campaña Android.

Las transferencias del fixture de límites tienen 4 entradas y 4 salidas posted, mismo total 6,4 por dirección. Se excluyen de ingresos/gastos y mantienen su participación en conteos recientes, igual que pagos de tarjeta/préstamo, reembolsos, inversiones y ajustes. SUM se usa aquí únicamente como diagnóstico sintético de emparejamiento, nunca para construir importes del dashboard. El caso de cero movimientos tiene ingresos/gastos/ahorro/recientes iguales a cero, conservando los snapshots de cuentas; no es una base sin cuentas.

## Memoria e interfaz

| Escenario | Mediana del mayor hueco RAF JS antes (ms) | Después (ms) | p95 duración FrameMetrics antes/después (ms) | Frames capturados antes/después |
|---|---:|---:|---:|---:|
| 1.000 | 55.363 | 25.835 | 23.408 / 25.123 | 43 / 13 |
| 10.000 | 436.672 | 50.594 | 20.406 / 47.194 | 384 / 19 |
| 50.000 | 1512.262 | 39.731 | 17.590 / 19.520 | 1700 / 20 |
| 100.000 | 4082.936 | 38.978 | 33.948 / 41.780 | 6316 / 25 |

En 100.000, los huecos RAF JS caen de una mediana de 4.082,94 ms a 38,98 ms. Esto muestra menor bloqueo JS durante el refresco. FrameMetrics no mejora uniformemente: tras optimizar, el p95 de frames llega a 47,19 ms en 10.000 y 41,78 ms en 100.000. Las ventanas son mucho más cortas y contienen pocos frames de commit, mientras que antes predominan frames repetidos del indicador de carga; no son poblaciones comparables para afirmar FPS estable ni ausencia de jank. No se midieron scroll, taps ni compositor con Perfetto.

PSS final y pico muestreado bajan en todos los tamaños. En 100.000, el pico pasa de 538,08 a 124,59 MiB aproximadamente. PSS es del proceso completo con ambos caminos e instrumentación, no heap JS exclusivamente. GC y retención varían: el delta de PSS en 10.000 aumenta de 3.740 a 4.748 KiB aunque el PSS final y pico disminuyen; no se oculta esta variación ni se interpreta como fuga. No se realizó una prueba de estabilidad de horas.

Se inspeccionó visualmente el dashboard optimizado terminado de 100.000: muestra patrimonio 7.100, saldo 3.100, ingresos/gastos/ahorro redondeados por el formato original, deuda 1.000 y 1.728 recientes. [Captura de la pantalla sintética](C:/Users/nesto/Proyectos/SmartFin/docs/performance/android-phase2/ui-dashboard-optimized.png). El banner de instrumentación se superpone a la barra de estado; es exclusivo del harness, no un cambio de UI de producción. La captura adicional ui-validation.png corresponde al estado inicial de carga.

## Problemas y límites

| Hallazgo | Gravedad | Tratamiento |
|---|---|---|
| Tres muestras perdieron el foco en 10.000 | Invalidación de medición | Par excluido y repetido; todas las 40 finales cumplen foco/estado |
| Logcat por PID y tag SFPhase2 devolvió salida vacía | Observación de validación | Se conservaron archivos; no se puede afirmar ausencia de errores/advertencias a partir de Logcat. Las ejecuciones sí terminaron sin errores reportados por el harness |
| Frames largos durante algunos commits optimizados | Observación de rendimiento | Registrados; no justifica cambios de UI dentro de este alcance |
| Coste del observador, USB/carga y temperatura no controlada | Límite metodológico | Comparación instrumentada reproducible; no extrapolar a todos los dispositivos |
| Visitas VM, GPU, arranque, interacción manual y memoria de larga duración sin medir | Pendiente fuera de esta validación | No se presentan como métricas verificadas |
| Warnings de build sobre APIs/Gradle/SDK en dependencias | Baja | Build release exitoso; sin cambios de dependencias ni correcciones ajenas |

## Pruebas y archivos

Jest: 24 suites aprobadas, **173 tests aprobados**, 1 benchmark Windows opcional omitido por su flag de entorno. TypeScript: npx tsc --noEmit aprobado. ESLint: npm run lint aprobado. Compilación Android release arm64 completada e instalada en el paquete aislado. summarize.js valida número de muestras, release/Hermes, condiciones de ventana, consultas solo SELECT, misma base e igualdad exacta. Los checks finales están documentados en final-verification.json.

Archivos creados para esta validación:

- scripts/androidDashboardPhase2/prepare.js: genera copia aislada y recupera baseline de Git; instrumenta solamente esa copia.
- scripts/androidDashboardPhase2/BenchmarkApp.jsx: flujo real de pantalla, refrescos y comparaciones funcionales.
- scripts/androidDashboardPhase2/BenchmarkPackage.kt: generador sintético, PSS, FrameMetrics y exportación local.
- scripts/androidDashboardPhase2/run.ps1: guardas ADB/APK, ejecución y recogida; admite Sizes para repetir un escenario.
- scripts/androidDashboardPhase2/summarize.js: validación y estadísticas a partir de JSONL reales.
- docs/performance/android-phase2-validation.md y android-phase2/: informe, registros, resumen, hashes, meminfo, intentos Logcat y capturas.
- android-phase2-pilot/ y android-phase2-pilot2/: evidencia descartada, preservada aparte.

No se modificaron fuentes de producción en esta validación. Se conservaron los cambios previos de fase 2 en getDashboardSummary.ts, sqliteTransactionRepository.ts, TransactionQuery.ts, BASE_DE_DATOS.md y sus pruebas/informes. TransactionsScreen sigue intacta.

## Reproducción

Desde el repositorio, con el HONOR conectado/desbloqueado y ANDROID_HOME apuntando al SDK local, usar una ruta nueva fuera del repositorio. Reutiliza las dependencias instaladas mediante junction, sin instalar paquetes:

```powershell
node scripts/androidDashboardPhase2/prepare.js C:/sfphase2-repro
Set-Location C:/sfphase2-repro/android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
Set-Location C:/Users/nesto/Proyectos/SmartFin
& scripts/androidDashboardPhase2/run.ps1 -Harness C:/sfphase2-repro -Output docs/performance/android-phase2-repro
node scripts/androidDashboardPhase2/summarize.js docs/performance/android-phase2-repro
```

Usar una carpeta de resultados nueva por campaña. Si el validador rechaza un escenario, conservar sus archivos fuera de la carpeta principal y repetir **ambas versiones** con -Sizes 10000 -SkipFunctional -SkipInstall, ajustando tamaño/Harness/Output. No mezclar muestras válidas repetidas sin apartar las anteriores. El validador solo considera JSONL del nivel superior.

**Cierre recomendado:** fase 2 aprobada con las observaciones descritas; exactitud preservada y mejora demostrada en el HONOR. Se puede comenzar la fase 3 en una tarea independiente, con una nueva línea base y protección equivalente de datos. El paquete de prueba permanece instalado y detenido; sus bases son exclusivamente sintéticas.
