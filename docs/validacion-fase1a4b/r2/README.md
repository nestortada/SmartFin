# Fase 1a.4B — Diagnóstico Android r2 de `phase1a4b-reversal / editAmount` (33 frente a 31)

6–7 de noviembre de 2026. Ronda **solo diagnóstica**. La Fase 1a.4B **no** queda aprobada. No se corrigió producción, no se
modificó ningún oráculo ni ninguna referencia y no se ejecutó API 35.

## 1. Conclusión

**Causa raíz demostrada (Node y Android API 24): es un artefacto del oráculo o del arnés, no del código de producción ni
de SQLite.**

- La sonda `seed()` de `scripts/phase1a4b/probes.ts` ejecuta
  `INSERT OR IGNORE INTO categories ('cat-label','cat-other')`. `categories` tiene triggers `backup_revision_*`, así que
  cada fila nueva suma +1 a `financial_data_revision`. `resetSyntheticData` no vacía `categories`.
- En Android el runner hace `pm clear` antes de **cada** campaña: `phase1a4b-reversal` empieza con una base nueva, las 2
  categorías se insertan (+2) y el contador queda en **33**.
- El oráculo Node (`campaigns1a4b` en `__tests__/phase1a4bAndroidEquivalence.test.ts`) ejecuta `register`, `reversal` y
  `guards` en **una sola sesión**. Cuando llega a `reversal/editAmount`, las categorías ya existen: el `INSERT OR IGNORE`
  inserta 0 filas y el contador queda en **31**.
- La edición del pago suma **+8** en ambos entornos (Android 25→33; disposición del oráculo 23→31). Escribe lo mismo, en
  el mismo orden, con las mismas filas directas y los mismos efectos de triggers.

## 2. Evidencia del fallo r1 (conservada intacta)

`android/api24/phase1a4b-reversal/result.json` (SHA-256 `c9d49faa…`): `$.observation.backupRevision` Android = 33,
Node = 31, 181 hojas en ambos lados. El arnés r1 se detenía en la primera diferencia, por orden de claves. r1 no registró
ninguna excepción SQLite. `integrity-after.json` de r1 no se reescribió: el inventario r2 escribe en `r2/authorization/`.

## 3. Mapa de escrituras de `editAmount` (13 sentencias; esperado = observado en Node y Android)

| # | Sentencia | Origen | Filas directas | Triggers (+contador) |
|---|---|---|---|---|
| 1 | `UPDATE installment_allocations SET status='reversed'` | `reverseAllocation` (D6) | 1 | +1 |
| 2 | `INSERT INTO installment_plan_revisions` | `appendPlanRevision` | 1 | +1 |
| 3–4 | `UPDATE accounts` + `INSERT … WHERE NOT EXISTS` (banco) | `saveSqliteAccounts` | 1 + 0 | +1 |
| 5–6 | `UPDATE transactions` + `INSERT … WHERE NOT EXISTS` | `saveTransactions` | 1 + 0 | +1 |
| 7 | `DELETE FROM installment_purchases WHERE transaction_id=?` | `deleteInstallmentPurchasesByTransactionId` | 0 | 0 |
| 8–11 | 2 × (`UPDATE accounts` + `INSERT … WHERE NOT EXISTS`) (tarjetas) | reconciliación | 2 + 0 | +2 |
| 12–13 | 2 × `UPDATE credit_card_statements` | `saveStatements` | 2 | +2 |
| | **Total** | | 8 filas | **+8** |

Cada incremento corresponde a un trigger `backup_revision_*` `AFTER … FOR EACH ROW` por fila afectada. No hay ninguna
sentencia repetida, ningún trigger ejecutado de más ni incrementos sin fila. Una actualización sin cambio de contenido sí
cuenta (SQLite cuenta filas emparejadas), igual en ambos motores.

## 4. Instrumentación (solo arnés; producción idéntica a r1)

- `scripts/phase1a4b/r2/editAmountDiagnostic.ts`: fixture copiado literalmente de `probes.ts`, que no se modifica.
  Captura estados en los límites con la traza en pausa, post-procesa la traza (origen, filas directas, filas de triggers,
  delta del contador, estado transaccional) y enumera **todas** las diferencias: ruta, valor Node, valor Android, tipo y
  tabla.
- Traza en el límite del driver. En Node, el adaptador `realSQLite`. En Android, un envoltorio de
  `NativeModules.SQLite.backgroundExecuteSqlBatch` instalado desde el arnés. Antes y después de cada lote nativo se envía
  **una** lectura en la misma cola o conexión (dentro de `BEGIN…COMMIT` es la misma transacción):
  `SELECT revision, changes(), total_changes()`. No hay escrituras diagnósticas, commits, rollbacks ni transacciones
  anidadas. La granularidad es por sentencia: todos los lotes del flujo llevan una sola sentencia de SmartFin
  (`multi = 0`).
- `__tests__/phase1a4bR2Diagnostic.test.ts`: reproducción Node determinista (dos ejecuciones idénticas). La traza es
  neutral: resultados con y sin traza idénticos. La disposición del oráculo reproduce la referencia exactamente. El
  oráculo original sigue en 10/10.
- `scripts/phase1a4b/r2/androidHarness.js`: casos `tracer-installed`, `schema-facts`, `editAmount-fresh-traced`,
  `editAmount-staged-warm`, `editAmount-warm-traced` y `verdict`. El veredicto **falla** mientras quede cualquier
  diferencia; no acepta nada automáticamente.

## 5. Identidad del APK diagnóstico

| | Intento 1 | Intento b (válido) |
|---|---|---|
| Workspace | `C:/sf-1a4b-r2-20261106` | `C:/sf-1a4b-r2b-20261106` |
| APK SHA-256 | `5e68ea6862a643224188bb5a731f71a8724e29a61f12fbe66662cfa6c6ba9ea5` | `69f3c11926fad64be6f143747d83a2d9c94bb4aa6c2eb99a3281dc74ded81716` |
| Tamaño | 33.970.028 B | 33.970.456 B |
| Atestación (embebida, idéntica) | `a93716e7…612a` | `05051e350c8e3b420cb57ff8363dee1b1ff267ea63221bd24dbbd799b3e8bfad` |
| Build offline | 8 min 22 s ([log](android-build.log)) | 11 min 19 s ([log](android-build-b.log)) |
| Resultado | Autoprueba del trazador fallida, sin casos `editAmount` | Todos los casos ejecutados, veredicto fallido (esperado) |

En ambos: paquete `com.smartfin.snapshot5b2.tests`, release sin `debuggable` (aapt), Hermes (`C6 1F BC 03`). Diferencias
frente a r1: `Harness.jsx` (+2 líneas de despachador), `phase1a4bR2Diagnostic.ts`, `phase1a4bR2Harness.js`,
`phase1a4bR2NodeExpected.json` y la atestación. `src/`, `phase1a4bProbes.ts` y `phase1a4bNodeExpected.json` son
idénticos byte a byte. El caso de uso sigue sin exportarse desde `index.ts`. `apk-identity-r2.cjs` rechaza los APK y las
atestaciones de r1 y del intento 1.

El intento 1 falló porque `react-native-sqlite-storage` (`lib/sqlite.core.js:449`) antepone un `SELECT 1` propio a cada
`executeSql` sin bloqueo transaccional. La autoprueba esperaba un único evento. El intento b separa ese preámbulo del
driver y lo cuenta (`preamble = 208/612/…`, `preambleErrors = 0`). Su evidencia está en `android/` y
`authorization/apk-identity.json`.

## 6. Resultados API 24 (`emulator-5554`, SQLite 3.9.2) frente a Node (24.16.0, SQLite 3.53.0)

| Caso | Frente a la referencia original | Frente a Node (mismas condiciones) | Traza alineada |
|---|---|---|---|
| `schema-facts` (120 triggers, `recursive_triggers=0`, `foreign_keys=1`) | — | 0 diferencias (versión de SQLite informada, no comparada) | — |
| `editAmount-fresh-traced` (condiciones r1) | **1 diferencia** (ver §8) | 0 | 0 de 206 sentencias |
| `editAmount-staged-warm` | — | 0 (5 estados) | 0 de 208 |
| `editAmount-warm-traced` | **0** (`backupRevision` = 31) | 0 | 0 de 208 |

El arnés compara las trazas índice a índice e informó 185–199 diferencias. Todas se deben a una sentencia exclusiva de
Android, `DELETE FROM "android_metadata"` (esa tabla solo existe en Android), que desplaza los índices.
`analyze-r2.cjs` alinea las trazas excluyendo solo esas sentencias (listadas, una por reset) y obtiene 0 diferencias en
sentencia, tabla, tipos de parámetros, resultado, filas directas, filas de triggers, contador antes y después y estado
transaccional ([analysis-b.json](analysis-b.json)). `driverRowsAffected` difiere solo por el driver: el plugin informa 1
para cualquier `INSERT` multifila. Las 4 `SQLiteConstraintException (FOREIGN KEY)` del logcat son los reintentos por
rondas de `resetSyntheticData`, presentes en las mismas posiciones en Node.

## 7. Primer punto de divergencia y valores del contador

Frente a la disposición del oráculo, la primera divergencia es la sentencia `INSERT OR IGNORE INTO categories` del seed.
Android con base nueva: 2 filas directas, +2 (4→6). Oráculo: 0 filas (4→4). Después, las 163 posiciones restantes tienen
el mismo SQL y las mismas filas, con un desfase constante de +2 en el contador.

| Punto | Android/Node con base nueva | Disposición del oráculo |
|---|---|---|
| Tras el seed | 6 | 4 |
| Tras la compra (6 cuotas) | 13 | 11 |
| Tras el pago y la imputación | 25 | 23 |
| Antes de la edición | 25 | 23 |
| Tras cada escritura de la edición | 26, 27, 28, 29, 30, 31, 32, 33 | 24 … 31 |
| Final | **33** | **31** |

## 8. Todas las diferencias finales de `editAmount` (base nueva frente a la referencia)

Única diferencia: `$.observation.backupRevision`. Node 31, Android 33, ambos enteros, tabla `financial_data_revision`.
Son iguales `accounts`, `allocations`, `installmentPurchases`, `revisions`, `statements`, `summary`, `transactions`,
`integrity` y `writes` (13).

## 9. Impacto financiero comprobado

**Ninguno.** Saldos, deuda de tarjeta (510.000), cupo, patrimonio (400.000), pago editado (90.000), imputación
`reversed`, revisión correctiva `allocationReversal`, extractos e idempotencia (`command_id` `cmd-1`, una imputación) son
idénticos. `financial_data_revision` solo marca el respaldo como desactualizado y su desfase procede de filas de
`categories` del fixture.

## 10. Hipótesis descartadas (con evidencia)

Doble ejecución de sentencias por el driver; triggers duplicados o distintos (definiciones iguales); triggers ejecutados
más de una vez; diferencia de semántica entre SQLite 3.9.2 y 3.53.0 en `UPDATE`, `INSERT … WHERE NOT EXISTS` o
`DELETE`; doble contabilización entre reversión y edición; orden de operaciones distinto; actualizaciones sin cambio
contadas solo en Android; escrituras ocultas en lecturas; diferencia en la reconciliación de extractos.

## 11. Recomendación de corrección mínima (requiere autorización; no aplicada)

**No hace falta cambiar producción.** La corrección mínima está en el oráculo Node: ejecutar `register`, `reversal` y
`guards` cada una en **su propia sesión nueva**, como hace el runner Android (`pm clear` por campaña), y regenerar
explícitamente `docs/validacion-fase1a4b/node/results.json`.

- Archivos: `__tests__/phase1a4bAndroidEquivalence.test.ts` (función `campaigns1a4b`) y la referencia `results.json`
  (borrado y regeneración explícitos con `SMARTFIN_WRITE_EVIDENCE=1`). Después, una nueva preparación, atestación y APK
  (r3), porque la referencia viaja dentro del APK.
- Cambio previsto en la referencia, calculado en Node: solo 2 hojas, `reversal.editAmount.observation.backupRevision`
  31→33 y `guards.deletePurchase.observation.backupRevision` 23→25. El caso `guards.deletePurchase` habría fallado igual
  en Android, por la misma causa, si r1 hubiera llegado a esa campaña.
- Alternativa descartada: cambiar `seed()` en `probes.ts` para que no dependa del estado de `categories`. Modificaría la
  sonda compartida y los valores de todos los casos.
- Riesgos: regenerar una referencia histórica exige revisar que solo cambien esas dos hojas (con un comparador
  explícito, como en 1a.3B). Cualquier otra diferencia debe detener la regeneración. Las partes 1a.4A, 1a.3A, 1a.3B y
  1a.2 no se ven afectadas: ya usan sesiones propias.

## 12. Seguridad, guards y Git

- `r2/authorization/integrity-after-b.json`: `protectedFilesUnchanged`, `r1EvidenceUnchanged` y `productionUnchanged`
  en `true`, sin cambios. Añadidos solo `analyze-r2.cjs` y `run-android-r2b.ps1` después del inventario.
- `com.smartfin`: `production-package-unchanged.json` con `unchanged: true` en ambos intentos (no está instalado en el
  emulador). Solo se borró y reinstaló el paquete sintético (`pm clear` del runner). API 35 (`AXCC6R3919012932`)
  conectado y no usado. El emulador API 24 se arrancó para esta ronda con `-no-snapshot-save` y se apagó al terminar.
- Git: sin commit ni push. Nuevos sin versionar: `__tests__/phase1a4bR2Diagnostic.test.ts`, `scripts/phase1a4b/r2/` y
  `docs/validacion-fase1a4b/r2/`. Ningún archivo versionado modificado.

## 13. Reproducción

Desde `C:/Users/nesto/Proyectos/SmartFin`:

1. `npx jest __tests__/phase1a4bR2Diagnostic.test.ts --runInBand` (Node; la evidencia se redirige a `artifacts/`)
2. `node scripts/phase1a4b/r2/inventory-r2.cjs capture` (nuevo intento: cambiar los nombres de archivo)
3. `node scripts/phase1a4b/r2/make-runner-r2.cjs` y `node scripts/phase1a4b/r2/prepare-android-r2.cjs`
4. En el workspace `android/`: `./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'`
5. `node scripts/phase1a4b/r2/apk-identity-r2.cjs`
6. `./scripts/phase1a4b/r2/run-android-r2b.ps1 -Serial emulator-5554 -Campaign phase1a4b-r2-editamount -Output docs/validacion-fase1a4b/r2/android-b/api24/phase1a4b-r2-editamount`
7. `node scripts/phase1a4b/r2/analyze-r2.cjs` y `node scripts/phase1a4b/r2/inventory-r2.cjs verify`

Evidencia: `node/diagnostic.json` (SHA-256 `143e42cd…`), `android-b/api24/phase1a4b-r2-editamount/` (result, logcat,
entorno, badging, condiciones, producción), `android/` (intento 1), `analysis-b.json`, `authorization/` y los logs.
