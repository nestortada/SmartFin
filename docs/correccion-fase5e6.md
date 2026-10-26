# SmartFin 5E.6 — precisión y orden de los CSV, y estabilización del fixture integrado

25–26 de octubre de 2026, America/Bogota. Alcance cerrado: **5E5-002** (precisión de los REAL en CSV),
**5E5-001** (orden de los CSV anuales en SQLite 3.9.2) y la **dependencia del reloj real** del fixture
integrado. Sin cambios de esquema, migraciones, driver, dependencias, manifiesto v2, cálculos financieros,
dashboard, política de notificaciones ni restauración. `BACKUP_PUBLICATION_UI_ENABLED` sigue en `false`.
Solo datos sintéticos y el paquete aislado `com.smartfin.snapshot5b2.tests`; ni bases personales ni Google
Drive. El HONOR no se reinició. No se avanza a fase 6.

El analista financiero semanal está fuera de alcance por decisión del propietario y no forma parte de esta fase.

Evidencias: [`correccion-fase5e6/`](correccion-fase5e6) — `baseline/`, `closure/`, `node/` (resultados
JSON), `android/api24|api35/` (una carpeta por campaña), `evidencia/` (sonda, re-exportación y
generaciones 1k versionadas). Procedimiento: [`scripts/phase5e6/`](../scripts/phase5e6).

**Veredicto: 5E.6 ACEPTADA** (sección 11).

## 0. Línea base y punto de recuperación

- Revisados: AGENTS, ARQUITECTURA, BASE_DE_DATOS, informes 5B.2/5E.4/5E.5 y sus evidencias de 5E5-001
  (`csv-order-probe.json`) y 5E5-002, `SmartFinBackupCsv.kt`, publicador y verificador v2, fixtures de
  `scripts/phase5e/` y `scripts/phase5e5/`, y las dos skills.
- Git limpio en `6f19b39`. **Punto de recuperación: etiqueta anotada `pre-5e6` → `6f19b39`**
  (`git reset --hard pre-5e6` restaura el estado anterior; los cambios de 5E.5 ya estaban confirmados).
- Antes de tocar nada ([baseline](correccion-fase5e6/baseline)): **Jest 921 aprobadas / 13 omitidas /
  70 suites, 8 snapshots; tsc 0; ESLint 0 errores (1 advertencia previa en `scripts/phase5e3/androidHarness.js`);
  diff-check 0.** Los 5 artefactos que Jest reescribe se restauraron con `git restore`.

## 1. Reproducción de los defectos

Ambos se reprodujeron **en el dispositivo y sobre datos idénticos**, con el exportador anterior congelado desde
`git HEAD` (`Phase5E4LegacyCsv`, el mismo mecanismo de 5E.4) junto al corregido:

- **5E5-001.** Sonda de orden (filas sintéticas patológicas en un día, con estados alternos, `local_time`
  nula, `civil_date` nula y un día civil distinto del año UTC). Con el `ORDER BY` anterior, SQLite 3.9.2
  devuelve `order-01, 08, 05, 07, 04, 02, 09, 06, 03` (orden del índice `idx_transactions_civil_day`:
  día, `status`, `rowid`); SQLite 3.44.5 devuelve el declarado `01…09`.
  [api24](correccion-fase5e6/evidencia/api24-probe) / [api35](correccion-fase5e6/evidencia/api35-probe).
- **5E5-002.** De los 33 valores de prueba, el exportador anterior pierde el valor en **21** en ambos
  dispositivos (`1234567 → 1.23457e+06`, `123456.5 → 123456`, `525357500 → 5.25358e+08`, `-44900.25 →
  -44900.2`, `1/3 → 0.333333`…).
- Re-ejecutado sobre las bases de las 12 generaciones de 5E.5, el exportador anterior **reconstruye byte a
  byte los CSV publicados** en el motor que los publicó (61/61 archivos en 100k): los defectos son
  deterministas, no intermitentes.

## 2. Código anterior y corregido

[`SmartFinBackupCsv.kt`](../android/app/src/main/java/com/smartfin/SmartFinBackupCsv.kt), único archivo de
producción modificado:

```kotlin
// Antes
private fun cursorValue(cursor: Cursor, index: Int): String =
    if (cursor.isNull(index)) "" else cursor.getString(index)          // REAL → "%g", 6 cifras
private const val YEARLY_ORDER = "ORDER BY COALESCE(t.civil_date, substr(t.date,1,10)), t.local_time, t.created_at;"

// Después
private fun cursorValue(cursor: Cursor, index: Int): String =
    when (cursor.getType(index)) {
      Cursor.FIELD_TYPE_NULL -> ""
      Cursor.FIELD_TYPE_FLOAT -> exactReal(cursor.getDouble(index)) ?: cursor.getString(index)
      else -> cursor.getString(index)                                   // INTEGER y TEXT literales
    }
internal fun exactReal(value: Double): String? {                        // null si NaN/Infinity
  if (!value.isFinite()) return null
  if (value == 0.0) return if (1.0 / value < 0) "-0" else "0"
  val exact = BigDecimal(value)                                         // valor binario exacto
  for (digits in 1..17) {
    val candidate = exact.round(MathContext(digits, RoundingMode.HALF_UP))
    if (java.lang.Double.parseDouble(candidate.toString()) == value) return candidate.stripTrailingZeros().toPlainString()
  }
  error("REAL without a 17-digit round trip")
}
private const val YEARLY_ORDER = "ORDER BY +COALESCE(t.civil_date, substr(t.date,1,10)), t.local_time, t.created_at;"
```

**Elección de la representación.** Se evaluaron tres opciones sobre los valores almacenados en ambos motores:

| Opción | Ida y vuelta exacta (33 valores × 2 columnas) | Observación |
|---|---|---|
| `Cursor.getString()` (anterior) | 24/66 | `%g`: seis cifras significativas |
| `CAST(x AS TEXT)` en SQLite | **40/66** en 3.9.2 y en 3.44.5 | 15 cifras: pierde `0.1+0.2`, `98765432109876.54`, `MAX_SAFE_INTEGER`, `1/3`, adyacentes… **Descartada** |
| `Double.toString()` | 66/66 | Exacta, pero usa exponente (`5.253575E8`) y su número de cifras depende de la implementación de libcore |
| **`exactReal` (elegida)** | **66/66** | El decimal más corto que vuelve al mismo `Double`, sin exponente (`525357500`, `123456.5`) |

`exactReal` no redondea a pesos ni a centavos: parte del valor binario exacto y elige el menor número de
cifras (1–17) cuya lectura recupera **el mismo `Double`**. Garantía: con 17 cifras significativas, todo
`Double` finito tiene ida y vuelta, así que el bucle siempre termina. La regla (redondeo medio hacia arriba del
valor exacto y primera longitud que hace ida y vuelta) se reimplementó de forma independiente en el
verificador Node con `toExponential`. Ambas coinciden en los 33 valores de prueba, en **4.998 dobles aleatorios**
(patrones de bits y montos con centavos) en los dos dispositivos, y en **todas** las celdas REAL de las
generaciones (sección 4).

En Node, además, 199.944 dobles deterministas hacen ida y vuelta con exactamente el número de cifras del
`Number#toString` de V8, que es el más corto posible.

Los valores no finitos conservan el texto del cursor (`inf`/`-inf`; NaN no existe en SQLite). INTEGER, TEXT,
NULL, BOM, encabezados, columnas, consultas, separadores y escape RFC 4180 no cambian.

**Orden.** El `+` unario impide que el primer término coincida con el índice de expresión, así que 3.9.2 ordena
con `TEMP B-TREE`. Las columnas y los predicados (rango sobre el día civil más `substr(...) = año`) son los
mismos. No se agregó ningún índice ni migración.

## 3. Comparación de importes SQLite ↔ CSV

Sonda `phase5e6-probe` ([resultado api24](correccion-fase5e6/evidencia/api24-probe/phase5e6-probe/result.json)):

1. Copia privada de una G1 recién publicada.
2. Inserta los 33 valores como `transactions.amount` y `accounts.balance_amount`, con `bindDouble` desde sus
   bits exactos.
3. Exporta con el **exportador de producción**.
4. Lee en SQLite cada valor guardado (bits, `typeof`, texto del cursor, `CAST`, `Double.toString`).
5. Comprueba que la base publicada conserva su SHA-256.

| Valor | Bits guardados = previstos | CSV 5E.6 | CSV anterior |
|---|---|---|---|
| 1.234.567 COP | ✓ | `1234567` | `1.23457e+06` ✗ |
| 123.456,50 COP | ✓ | `123456.5` | `123456` ✗ |
| 525.357.500 COP | ✓ | `525357500` | `5.25358e+08` ✗ |
| 8.296.299,60 COP | ✓ | `8296299.6` | `8.2963e+06` ✗ |
| −44.900,25 / −525.357.500 | ✓ | `-44900.25` / `-525357500` | `-44900.2` ✗ / `-5.25358e+08` ✗ |
| 0 / 0,01 / 0,40 | ✓ | `0` / `0.01` / `0.4` | igual |
| 0,1 + 0,2 | ✓ | `0.30000000000000004` | `0.3` ✗ |
| 98.765.432.109.876,54 | ✓ | `98765432109876.55` (más corto equivalente) | `9.87654e+13` ✗ |
| `MAX_SAFE_INTEGER`, 2⁵³+2 | ✓ | `9007199254740991`, `9007199254740994` | `9.0072e+15` ✗ |
| 1e-5, 1e-7, 1e21 (notación exponencial) | ✓ | `0.00001`, `0.0000001`, `1000000000000000000000` | `1e-05`, `1e-07`, `1e+21` (exactos) |
| 1,2345678901234567e25, `MAX_VALUE`, menor normal/subnormal | ✓ | plano, 26–326 caracteres | `1.23457e+25` ✗ … |
| adyacentes a 1, 1.234.567 y 123.456,5 | ✓ | `1.0000000000000002`, `1234566.9999999998`, `123456.50000000001` | ✗ |

Resultados:

- En los dos dispositivos, **66/66 celdas del CSV nuevo se leen con los mismos bits** que SQLite devuelve.
- Ningún valor cambió al guardarse: los 33 bits coinciden con los previstos.
- El CSV anterior pierde el valor en 42/66 celdas.
- Los importes de COP con muchas cifras, que no son representables exactamente en binario, aparecen con su
  equivalente más corto (por ejemplo, `98765432109876.55`). Es el decimal que recupera exactamente el valor
  guardado, no un redondeo monetario.

## 4. Equivalencia en SQLite 3.9.2 y 3.44.5, y diferencias intencionales

**Generaciones nuevas** (`phase5e5-recoverability-*` con el APK corregido; verificador independiente con
formato `exact`, [resultados](correccion-fase5e6/node/recoverability-results.json)):

| Dispositivo | Volumen | Componentes | CSV byte a byte = reconstrucción independiente | Filas reordenadas | Celdas REAL / con pérdida |
|---|---|---:|---:|---:|---:|
| API 24 y HONOR | 1k / 6 meses | 13 | 12/12 | 0 | 1.039 / **0** (G2) |
| API 24 y HONOR | 10k / 5 años | 17 | 16/16 | 0 | 10.039 / **0** |
| API 24 y HONOR | **100k / 50 años** | 62 (**50 CSV anuales**) | **61/61** | **0** | 100.039 / **0** |

En 5E.5 el mismo verificador encontró, en API 24, 1/5/50 CSV anuales en otro orden y 6/6/10 celdas con pérdida.

Cada movimiento con fecha canónica aparece una sola vez (1.016 / 10.016 / 100.016 en G2), y el dashboard
coincide mes a mes (7 / 58 / 598 meses). La única excepción es la conocida **5E5-003** (DST 1992–93 en Hermes
API 24), que el verificador acepta solo para ese campo y ese periodo.

**Re-exportación de las 12 bases históricas de 5E.5** en cada dispositivo
([prueba](../__tests__/backupCsvPhase5E6.test.ts), [resultados](correccion-fase5e6/node/reexport-results.json)):

- El exportador corregido produce **los mismos bytes en API 24 y en HONOR** para las 12 bases. Esto incluye
  las de 100k: 61 archivos cada una, 50 de ellos anuales. Esos bytes coinciden con la reconstrucción
  independiente de Node (SQLite 3.53.0).
- **Pertenencia al año:** la fila con día civil 1903-01-01 y fecha UTC 1902 aparece solo en
  `movimientos-1903.csv`; la de día civil 1902-12-31 y fecha UTC 1903, solo en el CSV de 1902.
- **Empates totales** (mismo día, hora y `created_at`; orden no especificado): 3.9.2, 3.44.5 y Node devuelven el
  mismo orden (`tie-1, tie-2, tie-3`). No se depende de ello.
- **Clasificación frente a los CSV publicados en 5E.5.** Cada fila se empareja por id y cada celda distinta debe
  cumplir dos condiciones:
  - el texto anterior es exactamente `%g` del valor nuevo;
  - el texto nuevo es `exactReal` de ese valor.

  Cualquier otra diferencia hace fallar la prueba. **No apareció ninguna otra.**

| Base histórica | Archivos | Reordenados | Celdas REAL cambiadas | Con pérdida en 5E.5 | Solo notación (`1.5e+06` → `1500000`) |
|---|---:|---:|---:|---:|---:|
| API 24 1k G1 / G2 | 12 | 1 | 103 / 110 | 0 / 6 | 103 / 104 |
| API 24 10k G1 / G2 | 16 | 5 | 1.003 / 1.010 | 0 / 6 | 1.003 / 1.004 |
| API 24 100k G1 / G2 | 61 | **50** | 10.003 / 10.010 | 0 / 10 | 10.003 / 10.000 |
| HONOR 1k / 10k / 100k | 12 / 16 / 61 | **0** | igual que API 24 | 0 / 6 / 10 en G2 | resto |

Las dos únicas clases de diferencia son las autorizadas:

1. **Orden de filas:** solo en los anuales publicados por API 24.
2. **Representación exacta de REAL:** en todos.

Las celdas «solo notación» ya eran exactas en valor (por ejemplo, `1.5e+06`) y ahora se escriben sin exponente.

## 5. Contrato de generaciones v2

El manifiesto y su estructura no cambian, ni tampoco el publicador ni el verificador de producción. Los tamaños
y SHA-256 de cada componente se calculan sobre los CSV corregidos y se verifican por relectura.

Resultados en los dos dispositivos:

- `phase5e5-recoverability-*`: 10/9/9 casos;
- `phase5e5-failures`: **18/18**;
- `phase5e5-epochs`: **8/8**;
- `publication`: **28/28**;
- `publication-restart-verify`, `publication-after-verify`, `restart-verify`, `close-lost`, `open-lost` y `core`: aprobados.

La matriz aislada de 14 daños selecciona G1 y la deja intacta en las 12 generaciones nuevas y en las 2 de 5E.5.

En cada generación, el SHA-256 del SQLite publicado es el de la captura. Las 40 tablas son idénticas a la base
viva y el esquema es idéntico al que crea el código actual: **el SQLite y su contenido financiero no cambian.**

## 6. Respaldos históricos intactos

- Nunca se reescribieron las generaciones de 5E.5: son documentos externos solo de lectura y el publicador no
  sobrescribe.
- Las 12 bases (1k/10k/100k × G1/G2 × 2 dispositivos) se empujaron como **copias** al almacenamiento de la app
  de prueba. El método de re-exportación comprueba su SHA-256 antes y después.
- En Node, cada base y cada CSV publicado de 5E.5 conserva el SHA-256 de su manifiesto. Las huellas de las
  entradas están en `C:/sf-5e6-push/inputs.sha256`.
- La verificación de 5E.5 se mantiene. El verificador elige el formato por la evidencia (`printf-g` para
  generaciones anteriores a 5E.6, `exact` para las posteriores), y las generaciones 1k versionadas de 5E.5
  siguen pasando con sus bytes originales.

## 7. Corrección de la dependencia temporal del fixture

**Causa.** El fixture tiene un reloj financiero fijo (`DATE` = 2026-10-24), pero los recordatorios de
suscripción se programan en `AlarmManager`, que funciona con el reloj real. Cualquier recordatorio sintético cuya
hora ya pasó en tiempo real (25-oct 15:00 en adelante; todos los del horizonte de 90 días a partir de enero de
2027) se entrega de inmediato. Esa entrega escribe `delivery_status` y la revisión mientras la prueba compara dos
estados.

**Corrección** (solo en [scripts/phase5e/integration.ts](../scripts/phase5e/integration.ts) y en los llamadores):

- `buildIntegratedScenario(f, { reminders })` obliga a elegir el modo de forma explícita:
  - `'stable'` para escenarios que requieren una base financiera estable (recuperabilidad 5E.5/5E.6,
    `phase5e1-recovery`). Las suscripciones sintéticas se crean sin recordatorios, así que ninguna entrega
    depende de la hora de ejecución. Compromisos, ocurrencias, pago vinculado e idempotencia no cambian.
  - `'deliver'` para escenarios que necesitan recordatorios reales (`phase5e-integrated`, cuya matriz de
    borrado exige inventario de alarmas). Antes de cada comparación de estado espera **evidencia de
    finalización**: `settleReminderDeliveries`.
- `settleReminderDeliveries` no es una espera fija. Exige tres condiciones:
  - ningún recordatorio vencido sin acuse;
  - ninguno que venza en los próximos 2 minutos;
  - la revisión estable durante 5 s.

  Si no se cumplen en 5 minutos, falla con el estado observado. No puede ocultar una escritura del caso
  probado: esa escritura persistiría y la comparación fallaría.
- La comprobación `alarmExists` de `phase5e-restart` usaba `anchorDate: '2026-10-25'`, que ya había vencido.
  Ahora usa `futureReminderCase`: un reloj de suscripciones fijo al inicio del caso y un primer recordatorio al
  menos un día después. La alarma está programada de verdad cuando se comprueba.
- No se tocó el reloj del dispositivo, ni receptores, ni Worker/Headless, ni el mantenimiento. La entrega real
  sigue probada por `phase5d-matrix` (27), kill/restart, permiso denegado, etapa, épocas y `phase5e-integrated`.

**Resultado.** Las campañas integradas se ejecutaron el 25-oct hacia las 21:30 de Bogotá (02:30–02:37 UTC del
26-oct), es decir, después de las 15:00, cuando el recordatorio sintético ya había vencido. `phase5e-integrated`, `phase5e-restart` y `phase5e1-recovery` pasaron **en el primer intento** en
API 24 y en HONOR. En 5E.5, el HONOR había fallado una vez en `phase5e-integrated` y dos veces en
`phase5e1-recovery`. La evidencia es de una ejecución por dispositivo: muestra que la dependencia temporal
desapareció del diseño, no una tasa estadística de intermitencia.

## 8. Resultados Android API 24 (SQLite 3.9.2) y HONOR CRT-NX3 API 35 (SQLite 3.44.5)

Resumen por campaña: [api24](correccion-fase5e6/android/api24) / [api35](correccion-fase5e6/android/api35).
En cada campaña, la metadata del paquete real `com.smartfin` quedó sin cambios.

| Área | Campañas | API 24 | HONOR |
|---|---|---|---|
| Exportación G1/G2 1k/10k/100k | `recoverability-*` | ✓ 10/9/9 | ✓ 10/9/9 |
| Orden y precisión | `probe`, `reexport` | ✓ 4, 3 | ✓ 4, 3 |
| Integridad SQLite, tamaños, hashes, manifiesto v2 | `recoverability-*`, `publication` (28) | ✓ | ✓ |
| Publicación interrumpida y protección de la última válida | `failures` (18), `publication-*-verify`, `restart-verify`, `close-lost`, `open-lost`, `core` (24) | ✓ | ✓ |
| Borrado y épocas | `epochs` (8), `regression-deletion-*` (78 reversiones, 11 fallos de limpieza, recibo perdido, `unknown`, reinicio) | ✓ | ✓ |
| Recuperación concurrente | `recovery-contention` (6), `recovery-error` (4), `regression-recovery` (6) | ✓ | ✓ |
| Suscripciones y notificaciones | `regression-notifications` (27), permiso denegado, Worker/Headless, 3 kill + 3 restart, etapa, proceso, épocas | ✓ | ✓ |
| Historial paginado e integrado | `history50-civil-1000/100000` (19, 19), `dashboard-precision` (6), `integrated` (9), `integrated-restart` (3) | ✓ | ✓ |

**APK.** Hubo tres compilaciones con **las mismas fuentes de producción**: 308 archivos atestados por huella,
[A](correccion-fase5e6/android/apk-a-source-fingerprints.json) /
[B](correccion-fase5e6/android/apk-b-source-fingerprints.json) /
[C](correccion-fase5e6/android/apk-c-source-fingerprints.json).

- **A** ejecutó la campaña completa.
- **B** corrige un oráculo de prueba de 5B.2 (ver más abajo).
- **C** añade un comentario de lint en `probes.ts`, y con él se repitió la sonda.

Intentos fallidos, conservados en carpetas `*-attempt-*`, ninguno del producto:

1. **`publication` en los dos dispositivos.** El oráculo `compareRaw` del APK de prueba 5B.2 exigía que cada
   celda CSV fuese igual a `Cursor.getString()`: codificaba el `%g` anterior. Falló justo en los saldos REAL
   ahora exactos, y las dos campañas `*-verify` dependían de su archivo de reinicio. El oráculo ahora exige que
   la celda REAL sea un decimal sin exponente con los **mismos bits** que `getDouble`, sin usar `exactReal`. Las
   demás celdas se siguen comparando con el texto del cursor. Con B: 28/28, 1 y 1 en ambos.
2. **`restart-afterAck` en API 24.** Error transitorio de ADB (`getprop`) antes de lanzar la campaña. Se repitió
   la pareja `kill-afterAck`/`restart-afterAck` con B y pasó.

## 9. Calidad final

| Control | Línea base | Final ([closure](correccion-fase5e6/closure)) |
|---|---|---|
| Jest | 921 / 13 omitidas / 70 suites / 8 snapshots | **933 / 13 omitidas / 71 suites / 8 snapshots** |
| tsc | 0 | **0** |
| ESLint | 0 errores, 1 advertencia previa | **0 errores, la misma advertencia previa** |
| `git diff --check` | 0 | **0**; los `logcat.txt` se conservan tal cual (45 líneas con espacios finales del propio Android) |

- Pruebas nuevas: suite [backupCsvPhase5E6.test.ts](../__tests__/backupCsvPhase5E6.test.ts) (8) y 4 casos
  nuevos en la de 5E.5 (verificación y matriz de fallos de las dos generaciones 1k de 5E.6).
- Con `SMARTFIN_5E5_EVIDENCE`, `SMARTFIN_5E6_EVIDENCE` y `SMARTFIN_5E6_REEXPORT` también se verificaron las
  12 generaciones nuevas y las 24 re-exportaciones de 10k/100k: **21/21 y 10/10**.
- Los artefactos que Jest reescribe se restauraron.

## 10. Archivos modificados

| Archivo | Tipo | Cambio |
|---|---|---|
| `android/app/src/main/java/com/smartfin/SmartFinBackupCsv.kt` | **Producción** | Celdas por tipo, `exactReal`, `+` en el `ORDER BY` anual |
| `docs/BASE_DE_DATOS.md` | Documentación | Formato de los REAL y orden anual desde 5E.6 |
| `scripts/phase5e/integration.ts` | Fixture | Modos `stable`/`deliver`, `settleReminderDeliveries`, `futureReminderCase`, reloj de suscripciones opcional |
| `scripts/phase5e/androidHarness.js`, `scripts/phase5e1/androidHarness.js`, `scripts/phase5e5/androidHarness.js`, `__tests__/financialAtomicityPhase5E.test.ts` | Pruebas | Eligen el modo explícitamente |
| `scripts/phase5e5/verifyGeneration.ts`, `__tests__/backupRecoverabilityPhase5E5.test.ts` | Verificador | Formato `printf-g`/`exact` por generación; exactas sin reordenamientos ni pérdida |
| `scripts/phase5b2/Phase5B2Package.kt` | Oráculo de prueba | Celdas REAL comparadas por bits |
| `scripts/phase5e6/*`, `__tests__/backupCsvPhase5E6.test.ts` | Nuevos (pruebas) | Sondas, métodos Kotlin de prueba, arnés, prepare, runners |
| `docs/correccion-fase5e6.md`, `docs/correccion-fase5e6/` | Evidencia | Este informe y sus evidencias |

## 11. Riesgos residuales y veredicto

| Riesgo | Severidad | Nota |
|---|---|---|
| Consumidores externos que esperaban `1.5e+06` o el orden de API 24 en los CSV | Baja | Cambio autorizado; el SQLite no cambia; ninguna herramienta interna depende de ello |
| Celdas REAL largas en valores extremos (`MAX_VALUE` = 309 caracteres) | Muy baja | Imposibles con los límites de importes de la app; exactas |
| Importes no representables en binario aparecen como su decimal equivalente más corto (`98765432109876.55`) | Baja | Es el valor que SmartFin guarda; la acumulación en centavos sigue pendiente y fuera de esta fase |
| `'deliver'` depende de no cruzar la hora de un recordatorio durante una comparación posterior a más de 2 min de la espera | Muy baja | Los escenarios de base estable usan `'stable'` |
| Restauración funcional no implementada; `cloudSync=unconfirmed`; corte a mitad de componente (UX) | Igual que 5E.5 | Fuera de alcance |
| **5E5-003** (DST 1992–93, Hermes API 24) | Muy baja | Sin cambios |
| Otros OEM o versiones intermedias de SQLite | Media | Solo se probaron 3.9.2 y 3.44.5 |

**Veredicto 5E.6: ACEPTADA.**

- 5E5-002 y 5E5-001 están corregidos y demostrados en los dos motores y en los tres volúmenes representativos.
- Las únicas diferencias de CSV son las dos clases autorizadas.
- SQLite, manifiesto v2 y generaciones históricas quedan intactos.
- La dependencia del reloj real del fixture se eliminó sin suprimir efectos legítimos.
- Todas las regresiones pasan en API 24 y en HONOR.

## 12. Recomendación para la fase 6 (garantías financieras internas)

Recomiendo iniciar la fase 6, **con tu autorización explícita**: no se inicia automáticamente. Orden propuesto:

1. **Precisión monetaria:** decidir si se acumulan ingresos y gastos en centavos enteros (pendiente desde 5E.5;
   ±$1 en meses con centavos y total ,50). Es la garantía interna más directa que queda.
2. **Respaldos:** mantenerlos fuera de la UI mientras no exista una restauración probada de punta a punta. Si
   entran en fase 6, priorizar esa restauración aislada y la UX del trabajo incierto antes que la publicación.
3. Mantener como criterios de aceptación los fixtures representativos (100k/50 años, 10k/5 años, 1k/6 meses),
   el modo `'stable'`/`'deliver'` explícito y las 28 regresiones en API 24 y HONOR.
