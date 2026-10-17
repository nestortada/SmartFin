# Validación Android y operaciones de gastos compartidos

Fecha de campaña: 12 de octubre de 2026. Este informe corresponde exclusivamente a datos sintéticos y a los comandos del módulo; no implementa su interfaz.

## Alcance y fuentes

Se aplicaron las skills locales de Callstack `react-native-best-practices` y `smartfin-financial-domain`. Se revisaron `AGENTS.md`, `ARQUITECTURA.md`, `BASE_DE_DATOS.md`, `MODULOS_Y_FLUJOS.md`, `SUSCRIPCIONES.md`, `GASTOS_COMPARTIDOS_Y_FECHAS.md`, `CONDONACIONES_COMPARTIDAS.md`, `AUDITORIA_GASTOS_COMPARTIDOS_ANDROID.md` y los informes previos de historial, posición compartida y condonaciones. El código vigente prevalece sobre el mapa antiguo de la skill que todavía describía gastos compartidos como una capacidad ausente.

Había numerosos cambios del usuario antes de comenzar. La referencia es una copia completa de ese `src`, no `HEAD`: [archivo original](performance/shared-commands/baseline/source.zip), [huellas de archivos](performance/shared-commands/baseline/source-sha256.json) y [SHA-256 del archivo](performance/shared-commands/baseline/archive-sha256.json). Las cinco fuentes especialmente afectadas también están guardadas como texto. No se revirtieron otros cambios ni se eliminaron pruebas.

## Problemas y decisiones

| Punto de entrada | Información necesaria | Hallazgo y solución |
|---|---|---|
| `createSharedExpenseApi.execute` | Efectos financieros, cambios del comando y estado compartido | Dos cargas completas y comparación `.find`/`.some` por cada fila: coste cuadrático. Los cambios SQLite ahora se registran dentro del comando; el adaptador alternativo usa mapas. |
| Compra, división, edición, cobro, devolución, cancelación y borrado | Totales personales y flujos bancarios antes/después | Se leen tres campos de filas publicadas que contribuyen: identificador, importe y clasificación. Continúan dos recorridos ordenados; no se cambian sumas `REAL` por `SUM` SQL ni por diferencias locales aproximadas. |
| Aplicar/desvincular anticipo, condonar, recuperar y revertir; contacto | Cuentas y estado compartido, sin cambios del movimiento bancario | No requieren transportar movimientos para calcular deltas personales o bancarios iguales a cero. Conservan validaciones e importes en centavos del dominio. |
| `movement` y colisión de cobro | Una identidad concreta | Consulta por clave primaria mediante el adaptador existente; evita `getTransactions()`. |
| `sharedTransactionIntegrity` | Referencias del lote escrito/borrado | Sondeo SQL de gastos, cobros y devoluciones, incluidas referencias históricas. Solo carga las siete tablas cuando hay referencias. Lotes de 300 identidades respetan el límite de parámetros Android. |
| `persistSharedExpenseState` | Diferencias e inmutabilidad del diario | Mapas y conjuntos temporales reemplazan búsquedas cuadráticas; las comprobaciones del diario siguen vigentes. |
| `getPersonalFinancialEntries` | Exclusiones activas y participación personal | Índices temporales con la misma prioridad de primera coincidencia y el mismo orden de los movimientos. |
| Posición compartida y snapshot de efectos | Pertenencia a gastos activos, incluida la fecha de corte | Conjuntos temporales reemplazan `.some` por participación. Conservan el orden de las participaciones, recibos y sumas, y el predicado original de fecha. |
| Eliminación de transferencia | Movimiento e impuesto acompañante | Consulta puntual del impuesto; conserva orden de IDs eliminados y reversión exacta de saldos. |
| Conciliación de tarjeta | Gastos y pagos no cancelados, cuotas y extractos | Persisten lecturas completas en `creditCardTransactionRelations.ts`. Incluyen `pending` y no pueden sustituirse por el filtro `posted` de los efectos. Se conservó esta lógica. |
| Edición de transferencia e historial personal | Acompañantes o lectura explícita del historial | Quedan caminos completos en `saveManualTransaction.ts` y el adaptador alternativo. No se sustituyeron por páginas visibles. |

Los cambios de DTO conservan su orden, incluidos empates de fecha y creación; el registro temporal conserva `rowid` como texto/`BigInt`. La lectura de cambios se divide en lotes de 300 y ordena globalmente, evitando límites de parámetros en un lote grande. La prueba de 1.005 escrituras acredita portabilidad y orden; no se presenta como una medición de conciliación masiva de tarjetas.

`sharedLossCommands.ts` y `sharedLossDomain.ts` mantienen sus reglas. No se modificaron migraciones, fórmulas contables, límites de dinero, relaciones, protocolos de coordinación, recibos idempotentes ni comprobaciones de recuperación. Cada comando sigue en su único `BEGIN IMMEDIATE` y `COMMIT`; un fallo también revierte el recibo del comando. No hay caché persistente de dinero.

## Método reproducible

La campaña de [campaign.js](../scripts/sharedCommands/campaign.js) usa cuatro combinaciones de movimientos/gastos compartidos: 1.000/10, 10.000/100, 100.000/100 y 100.000/1.000. Incluye importes históricos `0.1` y `0.2`, movimientos pendientes y una compra y un ingreso existentes. Los saldos iniciales son independientes del historial, como permite la aplicación; este generador no pretende reconstruir un saldo desde todos los movimientos.

Hay 18 pasos por combinación: compra nueva, división existente, participaciones, edición de compra, cobro asignado, vínculo de ingreso existente, anticipo, aplicación, condonación parcial y completa, cobro para recuperación, recuperación, reversión de recuperación, reversión de condonación, devolución de anticipo, cancelación, eliminación y repetición idempotente.

Node usa tres bases frescas por combinación optimizada y por referencia pequeña; la referencia de cada combinación de 100.000 usa una sola campaña completa debido al coste cuadrático. Android usa tres muestras a 1.000 y una a 10.000; a 100.000 se mide la versión final con una muestra por combinación. **No se midió la referencia de 100.000 en Android.** Los datos Node no sustituyen ese resultado ausente ni establecen rendimiento Hermes.

Se registran tiempo de comando, intervalo `BEGIN` a `COMMIT`, lecturas y filas devueltas. “Caracteres” es longitud del JSON de filas del instrumento, no bytes reales del puente ni tamaño de archivo. La instrumentación añade coste, especialmente serializando filas originales de 23 columnas. Android añade duración nativa de consulta/conversión y del cursor SQL. Preparación, dashboard de comprobación y huellas se ejecutan fuera del cronómetro del comando. No se midieron FPS, memoria máxima ni percentiles poblacionales; las muestras limitadas no permiten afirmar significancia estadística.

Una primera versión de seis campos se preserva en `exploratory/`. La campaña de esa versión se interrumpió durante la comprobación de 100.000 porque el arnés compilaba una expresión regular por celda al calcular las huellas. La campaña final reutiliza exclusivamente sus mediciones originales completas de 1.000 y 10.000; las muestras optimizadas publicadas corresponden al código final de tres campos y conjuntos de gastos activos. También se conserva completa la campaña intermedia de tres campos con búsquedas de pertenencia por arrays. La huella observacional final compila una vez y representa `REAL` con bits binarios64; el cálculo ocurre fuera del tiempo del comando. Node no se ejecutó con aislamiento de CPU: parte de la medición optimizada ocurrió mientras la referencia corría en otro proceso.

```powershell
# Restaurar las fuentes originales en un directorio nuevo; nunca una base financiera.
node scripts/sharedCommands/prepareBaseline.js C:/sf-command-reference-repro
$env:SMARTFIN_COMMAND_BASELINE_PATH='C:/sf-command-reference-repro'
$env:SMARTFIN_COMMAND_PERF='1'
$env:SMARTFIN_COMMAND_VERSION='before'
npx jest --runInBand --testMatch '**/__tests__/sharedCommandPerformance.test.js'
$env:SMARTFIN_COMMAND_VERSION='after'
npx jest --runInBand --testMatch '**/__tests__/sharedCommandPerformance.test.js'
Remove-Item Env:SMARTFIN_COMMAND_PERF,Env:SMARTFIN_COMMAND_VERSION,Env:SMARTFIN_COMMAND_BASELINE_PATH
```

El benchmark escribe checkpoints individuales y permite `SMARTFIN_COMMAND_RESUME=1`: conserva únicamente combinaciones terminadas y vuelve a ejecutar una combinación incompleta. El resumen final rechaza referencias incompletas o diferentes; un benchmark optimizado que termine antes compara los checkpoints originales disponibles y deja explícita la comparación pendiente.

```powershell
# Directorio externo nuevo para una aplicación exclusivamente sintética.
node scripts/androidDashboardPhase2/prepare.js C:/sf-command-android-repro
node scripts/sharedCommands/configureAndroid.js C:/sf-command-android-repro
$env:JAVA_HOME='C:/Program Files/Java/jdk-17'
# Desde C:/sf-command-android-repro/android:
./gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=2
# Desde el repositorio; requiere ANDROID_HOME y adb con el dispositivo indicado:
./scripts/sharedCommands/runAndroid.ps1 -Harness C:/sf-command-android-repro -Serial AXCC6R3919012932 -RunId shared-commands-repro
```

El script comprueba el identificador del APK antes de instalar, borra exclusivamente el almacenamiento de `com.smartfin.sharedcommands.bench` y comprueba la metadata de `com.smartfin` antes/después. `-Followup` conserva los fixtures sintéticos originales para comparar sus bits y ejecuta preparación/reinicio nuevos y la campaña final; requiere una campaña previa completa al menos a 1.000/10.000. No abre ni escribe la base real, instala ni actualiza el paquete principal. No se implementó restauración de respaldos ni se añadió una integración de red.

## Resultados cuantitativos

Node v24.16.0, SQLite 3.53.0; Android release/Hermes, SQLite 3.44.5. Comparación exacta Node: 72/72 checkpoints. Las huellas del APK y del benchmark coinciden con las fuentes actuales.

### Node

| Movimientos / gastos compartidos | Operación | Antes ms | Después ms | Filas antes → después | Lecturas antes → después |
|---|---|---:|---:|---:|---:|
| 1000 / 10 | createPurchase | 25.70 | 9.77 | 2085 → 1877 | 35 → 31 |
| 1000 / 10 | applyReceipt | 23.82 | 1.55 | 2054 → 48 | 12 → 10 |
| 1000 / 10 | forgivePartial | 21.91 | 1.80 | 2055 → 49 | 12 → 10 |
| 10000 / 100 | createPurchase | 837.78 | 72.81 | 20625 → 18525 | 35 → 31 |
| 10000 / 100 | applyReceipt | 820.06 | 4.91 | 20324 → 318 | 12 → 10 |
| 10000 / 100 | forgivePartial | 834.48 | 6.50 | 20325 → 319 | 12 → 10 |
| 100000 / 100 | createPurchase | 277548.66 | 654.99 | 200625 → 182163 | 35 → 31 |
| 100000 / 100 | applyReceipt | 274251.67 | 4.70 | 200324 → 318 | 12 → 10 |
| 100000 / 100 | forgivePartial | 276982.63 | 5.07 | 200325 → 319 | 12 → 10 |
| 100000 / 1000 | createPurchase | 281473.01 | 620.82 | 206025 → 185027 | 35 → 31 |
| 100000 / 1000 | applyReceipt | 278994.69 | 33.88 | 203024 → 3018 | 12 → 10 |
| 100000 / 1000 | forgivePartial | 270884.43 | 30.29 | 203025 → 3019 | 12 → 10 |

### Android físico

| Movimientos / gastos compartidos | Operación | Antes ms | Después ms | Filas antes → después | Lecturas antes → después |
|---|---|---:|---:|---:|---:|
| 1000 / 10 | createPurchase | 940.58 | 242.30 | 2085 → 1877 | 35 → 31 |
| 1000 / 10 | applyReceipt | 686.06 | 77.92 | 2054 → 48 | 12 → 10 |
| 1000 / 10 | forgivePartial | 746.02 | 101.68 | 2055 → 49 | 12 → 10 |
| 10000 / 100 | createPurchase | 23557.21 | 839.34 | 20625 → 18525 | 35 → 31 |
| 10000 / 100 | applyReceipt | 23028.17 | 107.43 | 20324 → 318 | 12 → 10 |
| 10000 / 100 | forgivePartial | 21527.46 | 93.19 | 20325 → 319 | 12 → 10 |
| 100000 / 100 | createPurchase | Sin medir | 5833.11 | Sin medir → 182163 | Sin medir → 31 |
| 100000 / 100 | applyReceipt | Sin medir | 114.48 | Sin medir → 318 | Sin medir → 10 |
| 100000 / 100 | forgivePartial | Sin medir | 101.28 | Sin medir → 319 | Sin medir → 10 |
| 100000 / 1000 | createPurchase | Sin medir | 25558.95 | Sin medir → 185027 | Sin medir → 31 |
| 100000 / 1000 | applyReceipt | Sin medir | 676.46 | Sin medir → 3018 | Sin medir → 10 |
| 100000 / 1000 | forgivePartial | Sin medir | 739.41 | Sin medir → 3019 | Sin medir → 10 |

Todos los comandos, duración de transacciones, lecturas, filas, caracteres y número de muestras están en [las tablas completas](performance/shared-commands/comparison-tables.md) y [comparison.json](performance/shared-commands/comparison.json). Los JSON originales conservan cada muestra sin redondear.

### Estado financiero terminal exacto

| Movimientos / compartidos | Banco | Cuenta destino | Deuda | Disponible | Por cobrar | Anticipos | Patrimonio | Consumo personal mensual | Pérdida neta | Movimientos finales |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1000 / 10 | 995000 | 6500 | 0 | 1001500 | 153000 | 500 | 1154000 | 170149.8 | 1000 | 1004 |
| 10000 / 100 | 995000 | 6500 | 0 | 1001500 | 1503000 | 500 | 2504000 | 1521499.6 | 1000 | 10004 |
| 100000 / 100 | 995000 | 6500 | 0 | 1001500 | 1503000 | 500 | 2504000 | 1535136.1000000234 | 1000 | 100004 |
| 100000 / 1000 | 995000 | 6500 | 0 | 1001500 | 15003000 | 500 | 16004000 | 15034999.800000023 | 1000 | 100004 |

En todas las combinaciones: ingresos personales mensuales 0; condonaciones 4000, reversión de condonación 3000, recuperaciones 1000 y reversión de recuperación 1000. El ahorro mensual es exactamente `0 - consumo personal - 1000`. Quedan cuatro cobros, tres asignaciones, una devolución, cinco eventos del diario y 17 recibos de comando; repetir un comando devuelve su recibo anterior y no añade filas.

Espera medida de lector: Node 1.4565999999977066 ms (condonación); Android 41.331461012363434 ms (recuperación). Son escenarios específicos, sin retraso inyectado; no se comparan como si fueran la misma carga.

## Integridad exacta

Node compara los resultados completos, efectos, dashboard y SHA-256 de doce tablas después de cada uno de los 72 checkpoints. Se normalizan exclusivamente identidades generadas de compra y columnas de auditoría de creación/actualización; quedan importes, fechas financieras, cuentas, estados, vínculos y el historial del diario y comandos. JSON conserva los números finitos de JavaScript al volver a leerlos; no se redondean importes ni se usa `toBeCloseTo`.

En Android se comparan resultados/efectos/dashboard exactos con el oráculo Node en cada paso, conteos de doce tablas y referencias SQLite. La primera campaña compara tablas entre originales y optimizadas de 1.000/10.000 en cada paso con la huella inicial decimal; la campaña final refuerza el **estado terminal** de esas bases con huellas binarias64 iguales y compara el estado terminal de las cuatro combinaciones optimizadas contra Node usando esa misma codificación. No se afirma una comparación binaria de todas las tablas de Android en cada paso ni una referencia física de 100.000.

Pruebas adicionales cubren importes muy grandes, empates, `pending`, `cancelled`, flujos neutrales, reembolsos, transferencia, medio de pago nulo, crédito y cuentas cerradas. El resultado con históricos fraccionarios conserva incluso el residuo binario de las reducciones originales, sin tolerancias.

## Android físico

Aplicación aislada release, Hermes y `react-native-sqlite-storage` reales; Honor CRT-NX3, Android 15, arm64-v8a, SQLite 3.44.5. El arnés requiere explícitamente paquete aislado, release, `!__DEV__` y Hermes. No se considera validación solo por compilar.

Los registros de preparación y reinicio acreditan migraciones 3 y 4 desde un esquema anterior con versiones 1/2, conservación del movimiento histórico, repetición de migración y rollback de DDL/versiones ante un fallo durante la migración 4. Tras `am force-stop` y un lanzamiento nuevo se comprueban condonación persistida, tablas/resumen iguales y repetición idempotente sin duplicación.

Se inducen errores SQLite reales mediante triggers en el diario y en el recibo de comando: el rechazo deja exactamente las mismas tablas. Se registra un reembolso y se recupera una condonación tras reiniciar; `foreign_key_check` queda vacío e `integrity_check` devuelve `ok`. Se prueban deuda completa de compra a tres cuotas, persistencia explícita de esas cuotas, pago de tarjeta sin alterar consumo ni patrimonio, pérdida sin alterar banco/deuda/consumo y eliminación de transferencia con reversión de impuesto de 40 y orden idéntico de acompañantes.

Un lector de dashboard concurrente espera al comando y ve únicamente su resultado confirmado. La espera medida pertenece a la cola de mantenimiento de la aplicación, no se presenta como una prueba de otro proceso SQLite ni incluye un retraso artificial. Los logs, APK y huellas del código identifican la ejecución, y la metadata del paquete principal permanece igual.

## Pruebas y lint

Suite completa: 41 suites aprobadas, 439 pruebas aprobadas, ocho snapshots aprobados; tres suites/pruebas de rendimiento optativas permanecen omitidas por defecto. TypeScript pasa. ESLint pasa. `git diff --check` pasa; las advertencias LF/CRLF de Windows no son errores de whitespace.

Los cuatro errores globales iniciales eran exclusivamente `no-undef` para `performance` en `scripts/androidSharedPosition/SharedPositionApp.jsx`, en posiciones 27:145, 27:354, 34:21 y 34:102 de la fuente anterior. Corresponden al arnés de auditoría, no a `src` ni a reglas financieras. Se declaró el global real de React Native en ese archivo; no se desactivó ESLint globalmente. Evidencia: `lint-before.txt` y `lint-after.txt`.

Las pruebas nuevas verifican ausencia de lecturas de movimientos en comandos de estado, proyección exacta, lotes portables y orden global, fallo de lectura final con rollback y recibo ausente, impuesto/acompañantes y espera del lector. Las pruebas de rendimiento tienen fixtures nuevos y comprobaciones financieras independientes de los tiempos.

## Riesgos y dictamen

La preparación financiera permite continuar desarrollando sobre las reglas actuales, con el alcance probado. **El módulo no está listo para integrar su interfaz con una garantía de buen rendimiento a 100.000 movimientos:** las operaciones que calculan efectos del historial todavía transportan y reducen muchos importes dos veces y mantienen una transacción abierta durante varios segundos en el teléfono. Esto prolonga la espera potencial de lectores.

La campaña física definitiva mide 5,83 segundos para crear una compra a 100.000/100 y 25,56 segundos a 100.000/1.000. Hubo variación importante entre repeticiones: una campaña intermedia midió aproximadamente 6,56 segundos para esta última combinación. Se conserva la medición final más lenta y no se atribuye esa variación al comparador, a los conjuntos ni a una causa no perfilada. Son muestras individuales. Al cierre se registraron batería a 35 °C y estado térmico del sistema 0; esa lectura puntual no acredita ausencia de variaciones durante toda la campaña. Falta perfilar la conversión/transporte del driver, pausas de GC y presión de memoria antes de fijar una garantía de latencia.

También quedan cargas completas del estado compartido y recorridos repetidos del dominio con muchos gastos/cobros, y la conciliación de tarjetas sigue recorriendo el historial. La compra de tarjeta se validó funcionalmente a 1.000; su rendimiento a 100.000 no está acreditado por la campaña bancaria. Deben medirse en una fase posterior antes de prometer esa escala.

Solo se utilizó un teléfono Android 15; no se revalidaron otros fabricantes, API 24 ni la interfaz principal. La campaña no demuestra FPS, accesibilidad ni comportamiento visual del flujo futuro. La siguiente optimización debe preservar el orden exacto de sumas históricas `REAL` y la misma atomicidad; cambiarlo a diferencias locales o agregaciones flotantes SQL exige una prueba independiente de equivalencia.
