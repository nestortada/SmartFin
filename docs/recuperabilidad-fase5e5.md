# SmartFin 5E.5 — recuperabilidad de respaldos y cierre de garantías financieras internas

25 de octubre de 2026, America/Bogota. Fase de verificación. **No se modificó código de producción**, esquema,
migraciones, driver SQLite, dependencias, reglas contables, modelo monetario, política de notificaciones ni
contrato de respaldos v2. `BACKUP_PUBLICATION_UI_ENABLED` sigue en `false`. No hay restauración en producción.
Solo datos sintéticos, paquete aislado `com.smartfin.snapshot5b2.tests` y proveedor de documentos sintético:
ni bases personales ni Google Drive real. No se avanza a fase 6.

**Fuera de alcance por decisión del propietario:** el analista financiero semanal externo (lector de Drive,
automatizaciones, canal externo de épocas). Su ausencia **no** bloquea esta fase ni aparece como requisito.

Evidencias: [`recuperabilidad-fase5e5/`](recuperabilidad-fase5e5) — línea base y cierre de calidad, Node (`node/`),
Android (`android/api24`, `android/api35`, [resumen](recuperabilidad-fase5e5/android/summary.md)) y generaciones
reales 1k versionadas (`evidencia/`). Procedimiento: [`scripts/phase5e5/`](../scripts/phase5e5).

**Veredicto: 5E.5 ACEPTADA en el alcance probado** (sección 10). Respaldos: archivo recuperable; restauración funcional no implementada.

## 0. Línea base y método

- Fuentes revisadas: AGENTS, ARQUITECTURA, BASE_DE_DATOS, informes 5B.1–5E.4, las dos skills y el código vigente
  de captura (`SmartFinLocalSnapshot`), publicación (`SmartFinBackupPublisher`), CSV (`SmartFinBackupCsv`),
  épocas/borrado (`SmartFinFinancialDeletion`) y el estado de respaldo (`SmartFinDriveBackupModule`).
- Git limpio en `633a186`. Antes de cualquier cambio: **Jest 915 aprobadas / 13 omitidas / 68 suites, 8 snapshots;
  tsc 0; ESLint 0 errores (1 advertencia previa en `scripts/phase5e3/androidHarness.js`); diff-check 0**
  ([baseline](recuperabilidad-fase5e5/baseline)), igual al cierre de 5E.4. Los 4 artefactos que Jest reescribe
  se restauraron con `git restore`.
- Datos: la regla oficial ([representativeHistory.ts](../__tests__/helpers/representativeHistory.ts)) — 100.000
  movimientos en 50 años calendario (1977–2026), 10.000 en 5 años, 1.000 en 6 meses; semilla fija, fechas civiles,
  6 cuentas, 8 categorías, 4 tipos y estados posted/pending/cancelled. Sobre ella se ejecuta antes el **escenario
  integrado real** de 5E ([integration.ts](../scripts/phase5e/integration.ts)): ingreso, gasto, transferencia con
  4×1000, compra a crédito en 3 cuotas, pago de tarjeta, rechazo de $0,40, suscripción pagada y pendiente con
  recordatorios, compra compartida, reembolso, condonación y comprobante IA confirmado. La variante «centavos» del
  diagnóstico monetario es una distribución de importes aparte, no un benchmark de volumen. No se ejecutó ninguna
  carga de 100k concentrada.

**Separación de conceptos.** Esta fase acredita la **recuperabilidad del archivo**: una generación v2 publicada por
el protocolo real contiene un SQLite íntegro y CSV coherentes, y una herramienta independiente puede identificarla,
verificarla y leerla sin modificar el respaldo. **No** acredita una restauración funcional dentro de SmartFin
(sustituir la base instalada, migrar, reabrir y reconciliar efectos Android), que no existe ni se implementó.

### Herramientas nuevas (solo pruebas)

| Pieza | Función |
|---|---|
| [verifyGeneration.ts](../scripts/phase5e5/verifyGeneration.ts) | Verificador aislado en Node: reimplementa las reglas v2, selecciona la última generación íntegra, abre una **copia** de solo lectura, comprueba que el respaldo no cambia y reconstruye los CSV de forma independiente |
| [recoverability.ts](../scripts/phase5e5/recoverability.ts) | Cifras con las rutas de lectura de producción (dashboard por mes, cuentas, tarjetas, débito, suscripciones, cobros, compartidos, historial, IA, auditoría) y huellas SHA-256 de todas las filas de todas las tablas; compartido por el APK y Node |
| [androidHarness.js](../scripts/phase5e5/androidHarness.js), [Phase5E5Methods.kt.txt](../scripts/phase5e5/Phase5E5Methods.kt.txt) | Campañas `phase5e5-recoverability-*`, `phase5e5-failures`, `phase5e5-epochs`; exportación de evidencia, daño controlado de documentos sintéticos y sonda de orden de CSV |
| [backupRecoverabilityPhase5E5.test.ts](../__tests__/backupRecoverabilityPhase5E5.test.ts) | Verificación completa + matriz de 14 fallos; siempre sobre las generaciones 1k versionadas de ambos dispositivos, y con `SMARTFIN_5E5_EVIDENCE` sobre 10k/100k |
| [dashboardPhase5E5PrecisionDiagnostic.test.ts](../__tests__/dashboardPhase5E5PrecisionDiagnostic.test.ts) | Diagnóstico monetario mes a mes sobre los historiales representativos |

## 1. Recuperabilidad del SQLite

Por cada volumen y dispositivo, la campaña `phase5e5-recoverability-*`:

1. construye el escenario integrado y el historial representativo;
2. espera a que se asienten las entregas de recordatorios vencidos (sección 8);
3. toma el **snapshot original** con las rutas de lectura de la app;
4. publica **G1** por el protocolo real (`preparePublication` → captura → `publishSnapshot`);
5. comprueba que la base viva no cambió;
6. registra cambios financieros reales (gasto, pago de tarjeta y sondas de importes) y publica **G2**;
7. exporta ambas generaciones byte a byte.

El verificador aislado ([resultados](recuperabilidad-fase5e5/node/recoverability-results.json),
[log](recuperabilidad-fase5e5/node/recoverability-jest.log)) aplica después los 10 pasos pedidos:

| Paso | Resultado (12 generaciones: 1k/10k/100k × G1/G2 × 2 dispositivos) |
|---|---|
| 1. Identificar la generación v2 | Las dos generaciones son íntegras y se selecciona G2, la más reciente por `generatedAt`/id, igual que la búsqueda de producción |
| 2. Manifiesto, tamaños y SHA-256 | Todas las reglas v2 reimplementadas (versión, identidad, estado, `cloudSync=unconfirmed`, revisión segura, nombres, inventario `files`/`csvFiles`) y cada componente con su tamaño y SHA-256 |
| 3. SQLite exacto de la generación | Sale del manifiesto (`database`) y su SHA-256 coincide con la captura privada registrada en el dispositivo |
| 4. Copia independiente | Se copia, se comprueba el hash de la copia y se abre en **solo lectura**; los documentos publicados conservan su SHA-256 tras toda la verificación |
| 5. `integrity_check` / `foreign_key_check` | `ok` / sin filas en las 12 |
| 6. Tablas, columnas y relaciones | **40 tablas**, mismas columnas y mismo esquema que la base viva. El esquema es **idéntico al que crea el código actual** sobre una base vacía (salvo `android_metadata`, propia de Android). 49 FK declaradas sin violaciones. La referencia polimórfica sin FK `cash_flow_events → subscription_occurrences` no tiene huérfanos |
| 7–9. Movimientos, cuentas, tarjetas, deudas, obligaciones, comprobantes IA, suscripciones, saldos, patrimonio, ingresos, gastos, auditoría | Sección 2 |
| 10. SQLite ↔ CSV | Sección 3 |

| Generación (G1) | Componentes | SQLite | Revisión API 24 / HONOR | Publicación G1 API 24 / HONOR |
|---|---:|---:|---:|---:|
| 1k / 6 meses | 13 + manifiesto | 1,0 MB | 1.091 / 1.090 | 0,38 / 0,26 s |
| 10k / 5 años | 17 + manifiesto | 4,7 MB | 10.091 / 10.090 | 0,86 / 0,62 s |
| **100k / 50 años** | **62 + manifiesto (50 CSV anuales)** | **42,5 MB** | 100.091 / 100.090 | 5,3 / 6,0 s |

Los tiempos son informativos: no eran objetivo de esta fase, y en API 24 corrían dos dispositivos a la vez.

**Conclusión:** las generaciones v2 actuales son **recuperables como archivo** en los tres volúmenes y en los dos
dispositivos. Esto no acredita una restauración funcional dentro de SmartFin.

## 2. Equivalencia de datos financieros

Se comparan dos niveles contra el snapshot original del dispositivo:

- **Datos crudos.** Todas las filas de todas las tablas, en orden de columnas y por `rowid`, con su SHA-256. Resultado:
  **las 40 tablas son idénticas** en las 12 generaciones, incluidos `transactions`, `accounts`, `installment_purchases`,
  `credit_card_statements`, `subscription_occurrences`, `subscription_reminders`, `shared_*`, `ai_command_drafts`,
  `account_balance_history`, `financial_data_revision` y `schema_migrations`.
- **Cifras calculadas por el código de producción** sobre la copia recuperada, frente a las calculadas en el
  dispositivo sobre la base viva:
  - dashboard de **cada mes** con datos (7 / 58 / **598**): disponible, deuda, patrimonio, ingresos, gastos, ahorro,
    pérdidas y recuperaciones compartidas;
  - dashboard del día de referencia;
  - cuentas, panorama de tarjetas (deuda, extractos, cuotas) y de débito;
  - suscripciones y todos los cobros;
  - estado compartido completo;
  - primeras páginas del historial más recientes y más antiguas;
  - comprobantes IA confirmados, auditoría (revisión, historial de saldos, migraciones) y totales por tipo y estado.

Resultado: **todo coincide**, con una única excepción explicada:

| | 1k | 10k | 100k |
|---|---|---|---|
| HONOR | idéntico | idéntico | idéntico (598 meses) |
| API 24 | idéntico | idéntico | idéntico salvo `recentTransactionCount` de **1993-02: 156 en el dispositivo vs 151 en Node** |

La excepción (**5E5-003**) no es del respaldo: los datos son idénticos (mismas huellas), y la diferencia la produce
el motor JS. Colombia aplicó horario de verano entre mayo de 1992 y principios de 1993. Hermes en API 24 resuelve
esos días locales sin él; V8 (Node) y HONOR, con él. La ventana de «movimientos recientes» de 30 días locales de
ese mes cuenta 5 movimientos distintos. El verificador la acepta **solo** para ese campo y ese periodo, y la reporta
con nombre (`platformTimezoneDifferences`). Cualquier otra diferencia hace fallar la prueba. No afecta al uso
normal, porque el dashboard muestra el mes actual.

## 3. Integridad y correspondencia de los CSV

Cada CSV se **reconstruye de forma independiente** desde el SQLite recuperado y se compara byte a byte:

- columnas explícitas y orden declarado del contrato;
- BOM UTF-8, comillas RFC 4180 y saltos `\n`;
- conversión de celdas igual que el `CursorWindow` de Android: INTEGER y TEXT literales, REAL con `printf("%g")`
  y NULL vacío.

Además se comprueba que:

- cada movimiento con fecha canónica aparece **exactamente una vez** en los CSV anuales (1.016 / 10.016 / 100.016
  filas en G2), sin omisiones ni duplicados;
- no hay movimientos sin fecha canónica en estos datos.

| | CSV byte a byte idénticos | Mismas filas, otro orden | Celdas REAL con pérdida |
|---|---|---|---|
| HONOR 1k / 10k / 100k | **12/12, 16/16, 61/61** | 0 | 6 / 6 / 10 (solo G2) |
| API 24 1k / 10k / 100k | 11/12, 11/16, 11/61 (todos los fijos) | 1 / 5 / **50** CSV anuales | 6 / 6 / 10 (solo G2) |

**Contenido: exacto en los dos dispositivos.** Dos hallazgos reales, ninguno corregido porque cambiaría el CSV del
contrato v2:

- **5E5-001 — orden de filas de los CSV anuales en SQLite 3.9.2 (API 24).**
  - En un mismo día, las filas salen en el orden del índice `idx_transactions_civil_day` (día, `status`, `rowid`), no
    en el declarado (día, `local_time`, `created_at`): 0 inversiones respecto al índice.
  - La sonda en el dispositivo ([csv-order-probe](recuperabilidad-fase5e5/evidencia/api24-recoverability-1000/csv-order-probe.json))
    lo atribuye al planificador: con la consulta **anterior a 5E.4** (`SCAN … USING INDEX`) y con la actual
    (`SEARCH … USING INDEX`), SQLite 3.9.2 da el `ORDER BY` por satisfecho con el índice de expresión. Con
    `ORDER BY +COALESCE(...)` usa `TEMP B-TREE FOR ORDER BY` y respeta el orden.
  - En 3.44.5 las tres variantes respetan el orden. Por tanto el defecto **existe desde que se creó ese índice
    (`e0249d8`, 17-oct)** y no lo introdujo 5E.4: su comparación byte a byte se hizo contra un exportador igual de
    afectado.
  - Severidad baja: no se pierden ni duplican filas, y el SQLite es la copia autorizada.
  - Corrección propuesta, de una línea y validada en ambos motores: el `+` unario en el primer término del `ORDER BY`
    anual. Requiere autorización.
- **5E5-002 — pérdida de precisión de los REAL en todos los CSV (los dos dispositivos).**
  - `Cursor.getString()` convierte REAL con `%g`, es decir, 6 cifras significativas y notación exponencial.
    Ejemplos reales de G2: saldo $8.296.299,6 → `8.2963e+06`; deuda $525.357.500 → `5.25358e+08` (+$500);
    movimiento $1.234.567 → `1.23457e+06`; $123.456,5 → `123456`.
  - Afecta a importes y saldos de 7 o más cifras significativas. Los pesos enteros de hasta 6 cifras y los
    múltiplos «redondos» salen exactos, por eso los datos representativos no lo mostraban.
  - Las sumas o reconstrucciones hechas desde el CSV pueden no cuadrar con la app. El SQLite del respaldo **no**
    está afectado.
  - Severidad media para quien use el CSV como fuente contable.
  - Propuesta: exportar los REAL con su texto exacto (por ejemplo `CAST(x AS TEXT)` o leer `getDouble` y formatear
    sin pérdida). Cambia el contenido de los CSV, no el formato del manifiesto v2, y requiere autorización y una
    fase propia.

## 4. Matriz de fallos de respaldos

**Producción en el dispositivo:** búsqueda, estado y publicación reales sobre el proveedor sintético. Campaña
`phase5e5-failures`, **18/18 en API 24 y en HONOR**, más la regresión `publication` (28/28) y los reinicios de
publicación.

**Verificador aislado:** 14 daños sobre copias de G2 en las 6 parejas de generaciones (1k/10k/100k × 2), con G1
íntegra.

| Fallo | Producción (dispositivo) | Verificador aislado | G1 protegida |
|---|---|---|---|
| Generación incompleta (CSV anual ausente) | Selecciona G1 | Rechaza G2 («componente ausente») | ✓ bytes iguales |
| SQLite corrupto (1 byte, mismo tamaño) | Selecciona G1 | «SHA-256 distinto» | ✓ |
| SQLite truncado | Selecciona G1 | «tamaño distinto» | ✓ |
| Componente ausente (SQLite / CSV fijo) | Selecciona G1 | «componente ausente» | ✓ |
| Hash incorrecto en el manifiesto | Selecciona G1 | «SHA-256 distinto» | ✓ |
| Tamaño incorrecto / revisión inconsistente | — / revisión cubierta por `publication` | Rechaza | ✓ |
| Manifiesto inválido (JSON roto / versión 3 / ausente) | Selecciona G1 | Rechaza | ✓ |
| Archivos mezclados (SQLite o CSV de G1 con nombre de G2; manifiesto de G2 apuntando a G1) | Selecciona G1 | Rechaza | ✓ |
| Permiso revocado | Estado `accessNeedsRenewal`, sin generación; publicar falla y el trabajo queda `uncertain` | — | ✓ |
| Recuperar ese trabajo tras nuevos datos | Publica **la captura original** (revisión 1.101 < actual 1.103; SHA-256 = captura), no los datos nuevos | — | ✓ |
| Publicación interrumpida **antes** de crear un componente | G1 sigue seleccionada; la reanudación completa la captura original **sin reescribir** SQLite ni componentes verificados | — | ✓ |
| Publicación interrumpida **a mitad** de un componente | Ver nota | — | ✓ |
| Respuesta perdida después de publicar | Repetir devuelve la misma generación con **0 escrituras** | — | ✓ |
| Muerte real del proceso antes y después de publicar, cierre y apertura perdidos | Regresiones `publication-*`, `close-lost`, `open-lost` | — | ✓ |

En todos los casos se recupera G1: la búsqueda vuelve a ella, sus bytes no cambian y su copia abre con
`integrity_check=ok`. Nunca se borró un documento externo.

**Nota sobre el corte a mitad de componente.** Es comportamiento actual, comprobado en ambos dispositivos:

- el documento parcial queda en la carpeta, porque el publicador nunca trunca ni sobrescribe;
- por eso la reanudación se rechaza («Provider content verification failed») **sin escribir nada**;
- el trabajo `uncertain` bloquea nuevas generaciones («Hay un respaldo pendiente…») hasta abandonarlo
  explícitamente (`retainFailedJob`);
- después, una generación nueva se publica y se selecciona;
- quedan 13 documentos huérfanos de ese trabajo, que nunca se seleccionan ni se eliminan.

Es seguro, pero requerirá UX: explicar el bloqueo y ofrecer el abandono.

## 5. Compatibilidad con borrado y épocas internas

Contrato de épocas de 5C sin cambios; manifiesto v2 sin cambios; ningún canal externo de épocas. Campaña
`phase5e5-epochs` (escenario integrado + 1k representativo, borrado real `deleteFinancialData`), **8/8 en API 24 y
8/8 en HONOR**:

| Comprobación | API 24 | HONOR |
|---|---|---|
| G1 publicada antes del borrado: `datasetCurrency=current` | ✓ | ✓ |
| Borrado confirmado (limpieza completada) revoca G1, un trabajo fallido y uno preparado con captura (`revokedByDeletion`) | ✓ | ✓ |
| Con metadatos locales, G1 se reconoce **`historical`** y sus bytes externos no cambian | ✓ | ✓ |
| Recuperar G1, publicar el preparado o reanudarlo → «Trabajo de una historia financiera anterior; publicación revocada.»; **0 escrituras** | ✓ | ✓ |
| Ningún dato eliminado reaparece (cuentas, movimientos, cuotas, ocurrencias, compartidos, comprobantes en 0) | ✓ | ✓ |
| Generación de la época nueva → `current`; si su manifiesto falta, la búsqueda cae en G1 y la presenta **`historical`**, nunca vigente | ✓ | ✓ |
| Sin el registro local del trabajo, G1 se presenta **`unknown`**, no `current` | ✓ | ✓ |
| Integridad y FK de todas las tablas vivas al terminar | ✓ | ✓ |

Además pasan las regresiones de épocas/borrado previas: matriz de 78 casos, fallos de limpieza, recibo perdido
antes/después, `unknown` sin repetición, reinicio con borrado confirmado y épocas de notificaciones (sección 7).
Límite: la vigencia se decide **dentro** de SmartFin con su registro local; una herramienta externa sin ese
contexto solo puede verificar integridad, no vigencia (fuera de alcance por decisión del propietario).

## 6. Diagnóstico de precisión monetaria (sin cambios en cálculos)

Se revisó la discrepancia documentada en 5E.2/5E.3 con el criterio de volumen vigente: **cada mes** de los tres
historiales representativos, comparando el resultado de producción (`getDashboardSummaryFromDb`), el orden de
acumulación efectivo (`date DESC, created_at DESC`), los desempates explícitos `rowid ASC`/`rowid DESC`, la suma
exacta en centavos (BigInt) y la cifra COP mostrada por `formatCurrency` (V8 = Node/HONOR) frente al formato del
decimal exacto ([precision.json](recuperabilidad-fase5e5/node/precision.json)).

| Historial | Meses | Producción = orden efectivo | Binario ≠ exacto | COP mostrado ≠ exacto (V8) | `rowid DESC` ≠ actual | Error máx. |
|---|---:|---:|---:|---:|---:|---:|
| 1k / 6 meses, representativo | 7 | 7 | 0 | 0 | 0 | 0 |
| 10k / 5 años, representativo | 58 | 58 | 0 | 0 | 0 | 0 |
| **100k / 50 años, representativo** | **598** | 598 | **0** | **0** | 0 | 0 |
| 1k, importes con centavos | 7 | 7 | 7 | 0 | 0 | 3·10⁻⁸ COP |
| 10k, importes con centavos | 58 | 58 | 53 | 0 | 0 | 3·10⁻⁸ COP |
| 100k, importes con centavos | 598 | 598 | 574 | **7** | 0 | 6·10⁻⁸ COP |

Conclusiones:

1. **Con importes en pesos enteros o medios pesos** (los representativos: salarios, compras en múltiplos de $100,
   1 % con ,50) todas las sumas son exactas en binario, en cualquier orden: **ninguna cifra cambia**. 295 meses de
   100k terminan exactamente en ,50 y se muestran igual en binario y en decimal.
2. **Con centavos** (la UI acepta hasta 2 decimales) casi todos los meses tienen un error binario interno
   (≤6·10⁻⁸ COP), invisible salvo cuando el total exacto termina en ,50. En 7 de 598 meses el **ahorro** exacto
   termina en ,50 y la resta binaria `ingresos − gastos` da x,4999…: V8/HONOR muestran **$1 menos** que el decimal
   exacto. En 5E.3, el formateador de API 24 mostró el valor del decimal exacto en el caso equivalente
   (0,49999999999999994 → $1); estos meses concretos no se formatearon en el dispositivo. Ejemplo 1986-12: ingresos
   72.300.006,94, gastos 25.249.238,44 → ahorro exacto 47.050.768,50; binario 47.050.768,499999985.
3. **El desempate determinista no cambia nada medible**: en historiales repartidos no hay empates de
   `date, created_at` dentro de un mes, así que `rowid ASC`, `rowid DESC` y el orden actual coinciden en los 1.316
   meses evaluados. Tampoco corrige el caso 2, que no depende del orden sino de la representación binaria.
4. Disponible, deuda, patrimonio y conteos no dependen del orden (5E.3) y no se ven afectados.

**Riesgo:** bajo. No hay error contable (los movimientos y saldos guardados no cambian); la discrepancia es de
presentación, ±$1 COP, solo con centavos y puede diferir entre dispositivos.

**Recomendación (requiere autorización; no aplicada):** acumular ingresos y gastos mensuales en **centavos enteros**
(`Math.round(amount*100)`, exacto hasta ~9·10¹³ COP), derivar el ahorro en centavos y convertir a pesos solo al
final. Corrige el caso 2 en todos los dispositivos sin cambiar esquema, almacenamiento ni el modelo `number`/`REAL`
del resto de la app. Es un cambio observable acotado (solo esos meses con ,50) que debe ir en una tarea propia, con
pruebas de equivalencia que acepten explícitamente esas diferencias. El desempate `rowid ASC` por sí solo no se
recomienda: no tiene efecto medido. Mantener el estado actual es aceptable mientras los importes sean pesos enteros.

## 7. Resultados Android API 24 y HONOR API 35

Emulador `SmartFin_Atomicity_API24` (SQLite 3.9.2) y HONOR CRT-NX3 API 35 (SQLite 3.44.5). Solo se usó el paquete
aislado: UID distinto y metadatos del paquete real `com.smartfin` sin cambios en cada campaña. No hubo reinicio
físico del HONOR, ni bases personales, ni Google Drive real.
Resumen: [summary.md](recuperabilidad-fase5e5/android/summary.md) / [summary.json](recuperabilidad-fase5e5/android/summary.json).

| Área crítica | Campañas | API 24 | HONOR |
|---|---|---|---|
| Captura SQLite y publicación v2 (1k/10k/100k) | `recoverability-*` | ✓ 10/9/9 | ✓ 10/9/9 |
| Verificación de hashes y matriz de fallos | `failures`, `regression-publication` | ✓ 18, 28 | ✓ 18, 28 |
| Recuperación de publicaciones | `regression-publication-restart-verify`, `-after-verify`, `restart-verify`, `close-lost`, `open-lost`, `core` | ✓ | ✓ |
| Épocas y borrado recuperable | `epochs`, `regression-deletion-*` (78 casos de reversión, fallos de limpieza, recibo perdido, `unknown`, reinicio) | ✓ | ✓ |
| Recuperación concurrente (5E3-001) | `recovery-contention`, `recovery-error`, `regression-recovery` | ✓ | ✓ (ver intentos) |
| Suscripciones y notificaciones | `regression-notifications` (27), permiso denegado, Worker/Headless, tres muertes de proceso con reinicio, etapa, épocas | ✓ | ✓ |
| Historial paginado (oráculo exacto) | `history50-civil-1000`, `history50-civil-100000` | ✓ 19, 19 | ✓ 19, 19 |
| Equivalencia financiera | `regression-integrated` (+reinicio), `dashboard-precision`, cifras de la sección 2 | ✓ | ✓ |

**Las 28 regresiones de 5E.2–5E.4 pasan 28/28 en ambos dispositivos**, y también las 9 campañas 5E.5.

**APK.** Se usaron tres compilaciones del paquete aislado, con huellas de fuentes versionadas
([A](recuperabilidad-fase5e5/android/apk-a-source-fingerprints.json),
[B](recuperabilidad-fase5e5/android/apk-b-source-fingerprints.json),
[C](recuperabilidad-fase5e5/android/apk-c-source-fingerprints.json)). **Las fuentes de producción son idénticas en
las tres.** Solo cambian archivos de prueba:

- B corrige el arnés de `failures`;
- C separa los dos tipos de corte y añade un mensaje diagnóstico en `scripts/phase5e/integration.ts`.

Las campañas 5E.5, el historial, la precisión y 13 regresiones de API 24 usaron A. El resto usó B, y `failures` y la
última `regression-recovery` de HONOR usaron C.

**Intentos fallidos, conservados en las carpetas `*-attempt-*` e `*-intentos-*`, ninguno del producto:**

1. `exportGeneration` vaciaba la carpeta de evidencia en cada exportación.
2. Faltaba el diagnóstico por tabla del arnés.
3. El snapshot original se tomaba antes de que Android terminara de entregar un recordatorio vencido. Se añadió
   una espera de quiescencia (entregas registradas y revisión estable); ver 8.
4. `EXPLAIN` por `rawQuery` falla en Android 15; la sonda ahora lo tolera.
5. En `failures` reutilicé la conexión de antes de la captura.
6. Esperaba que un componente parcial fuera reanudable.
7. La parada solicitada interrumpió dos campañas.
8. **HONOR:** `phase5e-integrated` falló 1 vez y `phase5e1-recovery` 2 veces con «AI repeated confirmed impacts» al
   comparar dos instantáneas completas. Ambas pasaron al reintentar.
   - Causa probable: el escenario integrado programa un recordatorio para el 25-oct a las 15:00 de Bogotá; después
     de esa hora vence de inmediato y Android lo entrega y lo registra en segundo plano mientras la prueba compara.
     Es el mismo fenómeno medido en 5E.5, con el volcado `scheduled → delivered` y la revisión +1.
   - En el reintento con diagnóstico la carrera no se reprodujo, así que **la causa exacta de esos intentos no quedó
     capturada**.
   - Riesgo de la prueba, no del producto: el arnés 5E depende de la hora real.

## 8. Regresiones y calidad final

- **Cambios de esta fase, todos de prueba o documentación:**
  - `scripts/phase5e5/` (verificador, cifras, arnés, métodos de prueba, *runners* y resumen);
  - dos suites nuevas;
  - diagnóstico en el mensaje de `scripts/phase5e/integration.ts` (sin cambiar qué compara);
  - evidencias e informe.
- **Producción, esquema, migraciones, dependencias y driver: sin cambios** (`git diff` vacío en `src/` y `android/`).
- `BACKUP_PUBLICATION_UI_ENABLED = false`.
- **Quiescencia de recordatorios.** Las entregas de recordatorios vencidos son escrituras legítimas en segundo plano.
  Cualquier prueba o lector que compare la base viva en dos instantes debe esperar a que se asienten. La captura es
  coherente porque toma un instante bajo el permiso exclusivo; el snapshot original del arnés no lo es si no se
  espera.

**Cierre de calidad** ([closure](recuperabilidad-fase5e5/closure)):

| Control | Línea base | Final |
|---|---|---|
| Jest | 915 aprobadas / 13 omitidas / 68 suites / 8 snapshots | **921 aprobadas / 13 omitidas / 70 suites / 8 snapshots** |
| tsc | 0 | **0** |
| ESLint | 0 errores, 1 advertencia previa | **0 errores, la misma advertencia previa** (`scripts/phase5e3/androidHarness.js`) |
| `git diff --check` | 0 | **0** (y 0 incluyendo los archivos nuevos, salvo los logcat y logs del emulador, que se conservan verbatim) |

Las 6 pruebas nuevas son la emulación `%g`, la verificación completa y la matriz de fallos sobre las dos generaciones
1k versionadas, y el diagnóstico monetario (1k/10k). Las de 10k/100k y el diagnóstico de 100k se ejecutan con
`SMARTFIN_5E5_EVIDENCE` / `SMARTFIN_5E5_DIAGNOSTIC`: **17/17** sobre las 6 parejas de generaciones de ambos
dispositivos. Los artefactos que Jest reescribe se restauraron con `git restore`.

## 9. Riesgos reales pendientes para utilizar SmartFin

| Riesgo | Severidad | Nota |
|---|---|---|
| **Restauración funcional no implementada**: el archivo es recuperable, pero no hay flujo probado para sustituir la base instalada, migrar ni reconciliar alarmas | Alta para depender del respaldo | Recuperar hoy exige intervención técnica manual |
| `cloudSync=unconfirmed`: sin evidencia de subida real a Drive, `fsync` del proveedor ni corte eléctrico | Alta para depender del respaldo | Igual que 5E.4; fuera del alcance de esta fase |
| **5E5-002**: CSV con REAL a 6 cifras significativas | Media (si el CSV se usa como fuente contable) | El SQLite es exacto |
| Corte a mitad de componente: trabajo no reanudable que bloquea nuevas generaciones hasta abandonarlo; documentos huérfanos | Media (UX) | Seguro; requiere explicación y acción de abandono en la UI |
| **5E5-001**: orden de filas de los CSV anuales en SQLite 3.9.2 | Baja | Mismo contenido |
| Precisión: ±$1 COP mostrado en meses con centavos y total ,50 | Baja | Sin error contable |
| **5E5-003**: conteo de recientes en meses con horario de verano histórico (1992–93) distinto entre motores | Muy baja | No afecta al mes actual |
| Margen de captura en HONOR (~0,8 s sobre 6 s, 5E.4) y otros OEM / SQLite intermedios no probados | Media | Sin cambios |
| Pruebas integradas dependientes del reloj real (recordatorio vencido) | Baja (calidad de pruebas) | Conviene fijar la hora del recordatorio sintético en el futuro |

No son riesgos de esta fase:

- el analista semanal externo, fuera de alcance por decisión del propietario;
- la publicación desactivada en la UI, una decisión pendiente y no un defecto.

## 10. Recomendación: requisitos mínimos para la fase 6

**Veredicto 5E.5: ACEPTADA en el alcance probado.**

- Los respaldos v2 actuales son **íntegros y recuperables como archivo** con 100.000 movimientos en 50 años, en
  API 24 y HONOR.
- La equivalencia de datos y cifras financieras es exacta, salvo 5E5-003, que es de plataforma.
- La última generación íntegra queda protegida ante todos los fallos probados.
- Las épocas internas impiden reactivar datos borrados o presentar una generación obsoleta como vigente.
- Las 28 regresiones pasan en ambos dispositivos.

**Requisitos mínimos propuestos antes de iniciar la fase 6** (cada uno necesita tu autorización):

1. **Decidir el alcance de respaldos en fase 6:**
   - **(a) fuera de alcance**: la publicación sigue desactivada y no se promete recuperación al usuario; o
   - **(b) dentro**, y entonces es obligatorio:
     - un flujo de **restauración** aislado, probado de punta a punta (incluida la reconciliación de alarmas y épocas);
     - la UI del bloqueo por trabajo incierto, con su acción de abandono;
     - la corrección de 5E5-002 si el CSV se presenta como exportación fiable.
2. Decidir **5E5-001** (`+` unario, de una línea) y **5E5-002** (texto exacto de los REAL). Ambos son cambios del
   contenido CSV, no del manifiesto v2.
3. Decidir la **precisión monetaria**: mantener el comportamiento actual, o sumar en centavos enteros en una tarea propia.
4. Confirmar en control de versiones los cambios de 5E.5 (nada está confirmado).
5. Tu autorización explícita para iniciar la fase 6. **No se inicia automáticamente.**

El analista semanal externo **no** es requisito de la fase 6 ni de esta fase.
