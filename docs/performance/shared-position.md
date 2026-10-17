# Posición financiera del dashboard: optimización de gastos compartidos

Fecha del informe: 11 de octubre de 2026. Método de la skill de Callstack:
**medir → optimizar → volver a medir → validar**.

## Resultado y dictamen

**El camino de lectura financiera del dashboard está listo para conectar la futura interfaz de gastos compartidos**, dentro del volumen y dispositivo probados. Los indicadores conservan igualdad exacta con la implementación anterior. En Android físico, con 100.000 movimientos y 5.000 gastos compartidos, la mediana pasó de **9.619 a 125,5 ms**, una reducción del **98,7 %**. Las consultas pasan de nueve a cuatro; la posición compartida transporta una fila en todos los volúmenes.

Esto no declara terminada la funcionalidad completa: la interfaz, restauración y condonación siguen fuera de esta fase. Tampoco es una medición de FPS, TTI ni fluidez de una pantalla nueva. No se accedió a la base financiera real ni se reemplazó la instalación de SmartFin.

## Causa raíz y reproducción previa

El dashboard llamaba `SharedExpenseRepository.getState()`, que ejecutaba seis lecturas de tablas completas: contactos, gastos, participaciones, cobros, aplicaciones y devoluciones. Además de las tres consultas del dashboard ya optimizadas, había que mapear toda esa información a objetos JavaScript, incluyendo descripciones e historial de reparto.

`getSharedFinancialPosition` filtra participaciones por cada contacto y, por cada participación, busca repetidamente gastos, aplicaciones y recibos. Aumentaban el payload nativo y los recorridos de arreglos en el hilo JavaScript. El problema no provenía de renders medidos; por eso no se añadieron memoización, cambios de estado global ni otra librería.

Antes de cambiar producción se volvió a ejecutar `integrationAudit.test.js`. La reproducción obtuvo **8,606 / 75,891 / 872,238 ms**, transportando **550 / 5.050 / 25.050 filas** compartidas para 100 / 1.000 / 5.000 gastos. La auditoría original medía 4,148 / 40,270 / 569,443 ms. Varía la latencia de pared, pero se reproduce el crecimiento y la carga de todas las relaciones. Ambas evidencias se conservan en `shared-position/audit-original.json` y `baseline-reproduced.json`; el archivo original de `docs/audit/` quedó preservado.

El comparador de esta implementación es una copia congelada del dashboard **con gastos compartidos previo a esta optimización**, no el dashboard antiguo sin esa funcionalidad. Se conservó antes de editar en `dashboard-before.ts.txt`; `dashboardSharedStateBaseline.ts` reproduce ese código cambiando solamente sus rutas de importación para Jest. El repositorio mensual de movimientos y el dominio de estado completo no se cambiaron en esta fase.

## Arquitectura y precisión

El dashboard llama `getFinancialTotals()` en el contrato del repositorio. Esa operación ejecuta una única lectura SQL administrada, dentro del participante existente cuando se utiliza en una transacción. No abre otro `BEGIN`, no confirma escrituras, no mantiene caché de dinero ni agrega una proyección persistente.

La consulta usa CTE y agrupa cada relación antes de unirla:

1. Aplicaciones activas con recibo activo y participación/gasto activos, por `participation_key`.
2. Pendiente y dinero aplicado por contacto, solo para participaciones de terceros activas de gastos activos.
3. Cobros activos por contacto.
4. Devoluciones activas de cobros activos por contacto.
5. Por contacto: **por cobrar = participaciones − aplicaciones**; **anticipos = cobros − aplicaciones − devoluciones**. Se conservan los chequeos por participación/contacto.
6. Totales globales y bandera de importes inválidos, en una fila.

La unión por `participation_key` es intencional: el dominio anterior usa esa identidad histórica; la FK `participation_id` puede quedar nula. Unir todas las filas sin preagregar multiplicaría los cobros al existir varios abonos/devoluciones. Esa combinación tiene una prueba específica.

SQLite suma centavos `INTEGER`, sin `TOTAL()`, `REAL`, redondeos ni conversión prematura a pesos. Los totales se convierten a texto decimal al salir de SQLite; el caso de uso valida su sintaxis, signo y `MAX_SAFE_INTEGER` con `BigInt` antes de hacer la misma conversión final `/ 100` del dominio anterior. Se rechazan pendientes negativos, acumulaciones fuera de rango y anticipos inválidos. Un desbordamiento del entero SQLite también rechaza la lectura: no hay fallback que publique dinero redondeado o cero.

La agregación excluye historial inactivo antes de sumar aplicaciones. Se probó un conjunto histórico que desbordaría 64 bits si se sumara innecesariamente, aunque su posición activa es válida. La consulta obtiene el mismo resultado que el dominio anterior.

`EXPLAIN QUERY PLAN` de Node confirma uso de claves primarias, `idx_shared_splits_person`, `idx_shared_receipts_contact` y búsquedas con índices temporales de las agregaciones. Los recorridos restantes son scans únicos de relaciones y agrupaciones SQLite; no hay una búsqueda JavaScript por cada combinación de filas. No hizo falta agregar índices persistentes, tablas ni migración: se conserva el esquema de migración 3 y los respaldos existentes. Se usó sintaxis de CTE convencional, sin ventanas ni extensiones modernas; Android API 24 no se probó físicamente.

Se conservan las tres lecturas anteriores: cuentas persistidas, importes personales del mes y conteos por día civil. También se conserva su orden de suma JavaScript para importes `REAL`. La fórmula final sigue siendo **activos − deuda + cuentas por cobrar − anticipos**. Disponible, ingresos, gastos, deuda, meses, fechas civiles e identidad de movimientos no se recalculan con otra regla.

`getState()` y `getSharedFinancialPosition()` permanecen para comandos, historial y consultas por persona/fecha. Optimizar también esas operaciones sería otro encargo.

## Igualdad financiera y pruebas

Se compararon todos los campos del dashboard con igualdad exacta, sin tolerancias, en octubre y noviembre. Antes/después de las lecturas se compararon movimientos y saldos, y se revisaron FK. La proyección también se comparó directamente con la posición del dominio completo.

La suite nueva cubre: ausencia de reparto, pendiente, parcial, completo, anticipo antes de la compra, anticipo sin aplicar, crédito, varias personas/múltiples compras, cobros en otra cuenta/mes, varias devoluciones, desvinculación/cancelación, ISO antiguo, fecha civil con hora al cierre del mes, multiplicación de joins, FK nullable, centavos cercanos al límite seguro, acumulaciones inválidas, historial inactivo y lectura dentro de una transacción que después hace rollback.

Las pruebas existentes siguen comprobando deuda completa de crédito, pagos de tarjeta, movimientos bancarios completos, consumo propio, eliminaciones, transferencias y rollback de comandos. No se modificaron para aceptar otro resultado.

- Suite completa: **38 suites, 397 pruebas y 8 snapshots aprobados**; tres suites optativas omitidas. Esta ejecución incluía 17 de las pruebas nuevas.
- Después se añadió la prueba de lectura dentro de una transacción/rollback y se ejecutó la suite nueva completa: **18/18 aprobadas**. No hubo cambios posteriores en el SQL o el dashboard. Son 398 pruebas funcionales distintas aprobadas entre ambas ejecuciones; no se afirma que se volvió a ejecutar toda la suite con esa última prueba.
- Ensayo de rendimiento final: **1/1 aprobado**, con siete comparaciones financieras por versión y volumen, además de calentamientos.
- TypeScript estricto y ESLint de los archivos de código afectados: aprobados.
- Arnés Android: `assembleRelease` aprobado, compilación inicial de 253 tareas; después se recompiló para incorporar el filtro final de historial activo.

## Comparación reproducible: Node / SQLite

Node `v24.16.0`, Windows, `node:sqlite`; ejecución con GC expuesto. Misma base de **100.000 movimientos** por volumen, 50 contactos cuando hay reparto, compra compartida de 30.000 y abono parcial de 7.500. Se vinculan compras/cobros a movimientos sintéticos existentes y se conservan exactamente 100.000 filas. No se abre ningún archivo financiero real.

Tres calentamientos y siete muestras por versión; mediana de `performance.now`. La memoria es crecimiento de heap observado antes/después y en los retornos de consulta con GC entre muestras, no un pico exhaustivo de toda la ejecución. Node y Android tienen generadores de historial distintos; las bases son idénticas **entre versiones dentro de cada plataforma**, no entre plataformas.

| Gastos compartidos | Antes, ms | Después, ms | Consultas antes→después | Filas totales antes→después | JSON, bytes antes→después |
|---:|---:|---:|---:|---:|---:|
| 0 | 2,830 | 3,547 | 9→4 | 170→171 | 13.512→13.558 |
| 100 | 5,377 | 2,797 | 9→4 | 720→171 | 155.551→13.565 |
| 1.000 | 45,058 | 5,066 | 9→4 | 5.220→171 | 1.401.105→13.554 |
| 5.000 | 765,200 | 15,890 | 9→4 | 25.220→171 | 6.984.872→13.499 |

Las filas incluyen cuentas, importes mensuales y días, además de la posición. Sin reparto, las tablas anteriores devuelven cero filas mientras que la agregación devuelve una fila de ceros: por eso aumenta una fila total pese a reducir consultas. Con 5.000 repartos, el crecimiento de heap muestreado pasa de **51.774.840 a 270.776 bytes**.

**Límite observado:** Node sin gastos compartidos tarda 0,717 ms más en esta campaña. El adaptador prepara cada sentencia nuevamente y la consulta agregada es más compleja que seis selects vacíos; no se midieron por separado preparación y ejecución para atribuir todo el delta. No se declara mejora universal en Node. En el dispositivo probado sí mejoró también el caso sin reparto.

## Comparación ejecutada en Android físico

Honor **CRT-NX3**, Android **15**, `arm64-v8a`, zona `America/Bogota`, SQLite **3.44.5**, Hermes, APK **release**. Paquete aislado `com.smartfin.sharedposition.bench`, con directorio de datos separado, sin servicios/tareas de producción ni valores del `.env` del usuario.

Se ejecutaron los cuatro volúmenes en la misma campaña, cada uno con su copia sintética y ambas funciones de resumen. Tres calentamientos y siete muestras por versión: **56 muestras**. La aplicación verificó igualdad financiera en cada lectura, saldos/deuda persistidos iguales, 100.000 movimientos sin duplicación y ausencia de violaciones FK. Los hashes de los cinco archivos relevantes usados por el APK coinciden con el checkout final.

| Gastos compartidos | Antes, ms | Después, ms | Consultas | Filas totales antes→después | Caracteres JSON antes→después |
|---:|---:|---:|---:|---:|---:|
| 0 | 84,371 | 44,810 | 9→4 | 293→294 | 23.490→23.536 |
| 100 | 196,590 | 79,464 | 9→4 | 843→294 | 165.515→23.547 |
| 1.000 | 704,012 | 75,398 | 9→4 | 5.343→294 | 1.411.047→23.536 |
| 5.000 | 9.618,966 | 125,498 | 9→4 | 25.343→294 | 6.994.807→23.493 |

Android registra **caracteres JSON**, no bytes UTF-8; no se intercambian esas unidades. Las 294 filas posteriores son las cuentas, importes mensuales, días y una fila de posición, no miles de relaciones compartidas.

El módulo nativo muestrea PSS del proceso cada 100 ms, además de inicio/final. Mediana de crecimiento respecto al inicio: **400→179 KB**, **488→96 KB**, **2.928→98 KB** y **13.532→92 KB**, respectivamente. PSS incluye memoria Java/native/Hermes y no representa solo heap JavaScript. El orden es anterior→optimizado sin forzar GC Hermes; las cifras absolutas y picos transitorios pueden depender del historial del proceso. Las lecturas menores de 100 ms pueden tener únicamente muestras de extremos. Se conservan todos los valores crudos.

Los campos `size:'1000'` y `runId:'manual'` del encabezado de constantes heredadas del arnés son defaults de ese módulo, no parámetros utilizados por esta campaña. El código llama explícitamente `seed(100000, ...)`, el módulo verifica los conteos y cada muestra registra `size:100000` y su volumen compartido. El archivo se recoge mediante el identificador real del intent. Esto se deja documentado para evitar interpretar aquel encabezado como una prueba de 1.000 movimientos.

Se compiló y **se ejecutó** el APK; no se confunden esos resultados con pruebas Node. No se midió la UI de producción ni FPS/TTI. Se verificaron metadatos de instalación de `com.smartfin` antes/después, sin cambios; nunca se abrió su base. El paquete de prueba fue desinstalado al terminar.

## Archivos de esta fase

Producción, cinco archivos:

- `src/modules/dashboard/useCases/getDashboardSummary.ts`: sustituye estado completo por totales.
- `src/modules/transactions/repositories/SharedExpenseRepository.ts`: método `getFinancialTotals`.
- `src/modules/transactions/repositories/sqliteSharedExpenseRepository.ts`: lectura agregada administrada.
- `src/modules/transactions/repositories/sharedFinancialTotalsSql.ts`: consulta nueva.
- `src/modules/transactions/useCases/readSharedFinancialTotals.ts`: validación de totales exactos.

Verificación:

- `__tests__/sharedFinancialTotals.test.ts` y `helpers/dashboardSharedStateBaseline.ts`.
- `__tests__/sharedPositionPerformance.test.js` y `helpers/sharedPositionVolume.ts`.
- `__tests__/helpers/realSQLite.ts`: reconocer lecturas `WITH`/`EXPLAIN` en el adaptador Node. El primer ensayo mostró cero filas porque el adaptador trataba `WITH` como escritura; se corrigió el adaptador y se repitió. El driver Android procesa estas consultas mediante su camino de lectura.
- `scripts/androidSharedPosition/{prepare.js,SharedPositionApp.jsx,seedShared.kt.txt,run.ps1,summarize.js}`: arnés y recolección reproducibles.
- `docs/ARQUITECTURA.md`, `docs/BASE_DE_DATOS.md`, `docs/GASTOS_COMPARTIDOS_Y_FECHAS.md`: contrato de lectura actualizado.
- Este informe y evidencia bajo `docs/performance/shared-position/`.

Los demás archivos modificados/untracked del checkout pertenecen a la implementación y auditoría anteriores; no fueron revertidos ni añadidos al alcance de esta optimización.

## Reproducir

Pruebas y medición Node:

```powershell
npm test -- --runInBand
npx tsc --noEmit
node --expose-gc node_modules/jest/bin/jest.js --runInBand --runTestsByPath __tests__/sharedPositionPerformance.test.js --testMatch '**/__tests__/**/*.test.js'
```

El ensayo `.test.js` es optativo por el `testMatch` habitual del proyecto; produce `shared-position/node-comparison.json`. El baseline congelado evita depender de un HEAD que pueda cambiar.

Android, eligiendo otro directorio vacío y otro identificador de ejecución:

```powershell
node scripts/androidSharedPosition/prepare.js C:/sf-shared-position-new
# Dentro de C:/sf-shared-position-new/android:
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
# Desde el repositorio:
.\scripts\androidSharedPosition\run.ps1 -Harness C:/sf-shared-position-new -RunId shared-position-new
node scripts/androidSharedPosition/summarize.js docs/performance/shared-position/android/shared-position-new.jsonl
```

El runner valida el identificador del APK antes de instalar; requiere el serial físico indicado o uno explícito. Solo detiene el paquete aislado. No aprueba campañas incompletas ni con errores. Al terminar puede desinstalarse únicamente `com.smartfin.sharedposition.bench`. Para esta campaña se usó `C:/sf-shared-position-bench-20261011` y `shared-position-final`.

## Evidencia y pendientes

- `shared-position/node-comparison.json`: latencias individuales, memoria, filas, bytes, SQL y planes.
- `shared-position/android/shared-position-final.jsonl`: 56 muestras y comprobaciones emitidas por Android.
- `shared-position/android/summary.json`: medianas y contexto real.
- `shared-position/android/shared-position-fingerprints.json`, `apk-sha256.json`, `production-before.txt`, `production-after.txt`: procedencia e instalación preservada.

No se añadieron límites de registros ni se omitieron obligaciones por fechas futuras: el dashboard anterior calculaba posición actual sin corte `asOf`, y esa regla permanece. Las fechas civiles siguen determinando estadísticas mensuales, separadas del patrimonio actual.

Pendientes: pruebas físicas en Android antiguo/API 24 y otros equipos, exploración visual de la futura interfaz, mayor volumen de contactos/devoluciones e historial inactivo, y medición de FPS/TTI cuando exista esa interfaz. La consulta todavía recorre/agrega relaciones en SQLite; no promete coste constante del motor ni extrapola 125 ms a volúmenes ilimitados. La proyección tampoco sustituye una validación completa de JSON/historial en restauraciones.

Observación adicional fuera del alcance: `createSharedExpenseApi` obtiene el libro
completo con `getTransactions()` antes y después de cada comando, y
`sharedFinancialSnapshot` usa las proyecciones de estado completo. Es un candidato
para medir al incorporar acciones de creación/edición en la interfaz. No se midió
su latencia con 100.000 movimientos en esta campaña y no se afirma que se haya
optimizado o que cumpla un objetivo de respuesta. Se conserva su contabilización
y ámbito transaccional; cambiar ese cálculo requiere otra comparación financiera.

Restauración y condonación son pendientes conocidos de la auditoría anterior y no se modificaron. Si requieren cambios importantes, deben tratarse como encargos separados. Para el objetivo de esta fase, los resultados financieros, el payload y el rendimiento del dashboard quedaron verificados con datos sintéticos tanto en Node como en Android físico.
