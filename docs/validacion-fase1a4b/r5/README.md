# Fase 1a.4B — r5: tercera variante de «no such table» (API 35) y preparación Android

7 de noviembre de 2026. **Preparación**: no se compiló ningún APK, no se instaló nada y no se ejecutó ninguna campaña
Android. La Fase 1a.4B **no** está aprobada. Los resultados de r4 se conservan como evidencia histórica de r4 y no
corresponden a r5.

## 1. Estado inicial

- Rama `main`, commit `34eab43`.
- Modificados sin commit: `__tests__/phase1a4bAndroidEquivalence.test.ts`, `docs/validacion-fase1a4b/node/results.json`,
  `scripts/phase1a4b/derive-probes.cjs` y `scripts/phase1a4b/phase1a3bProbes.ts` (r3/r4).
- Sin versionar: pruebas 1a.4B de r2–r4, scripts `r2`–`r4` y evidencias `r2`–`r4`.
- Inventario r4: 0 cambios. Atestación r4 `97e1a907…`, APK r4 `aa720dd0…`.
- Durante la tarea apareció `.claude/agents/` (tres archivos `.md`, 11:46), creado por el comando `/agentdeck` del usuario.
  No se ha tocado. No forma parte de los hooks ni de `settings.json` y está fuera del inventario.

## 2. Causa raíz (r4, API 35)

El HONOR CRT-NX3 (API 35) escribe el mismo error con un tercer formato
(`r4/android/api35/phase1a3b-flows/result.json`):

```
no such table: installment_allocations (Sqlite code 1 SQLITE_ERROR): , while compiling: SELECT 1 AS found FROM installment_allocations a
        JOIN installment_purchases p ON p.id = a.installment_purchase_id
        WHERE p.transaction_id = ? AND a.status = 'active' LIMIT 1;, (OS error - 2:No such file or directory)
```

Tiene la misma tabla, la misma consulta de la guarda y el mismo código SQLite 1. Cambian `Sqlite code … SQLITE_ERROR` y
el sufijo del último error del sistema operativo. El clasificador r4 solo aceptaba `(code 1)`, `(code 1 SQLITE_ERROR)` y
`(code 1 SQLITE_ERROR[1])` sin sufijo, así que devolvió el texto completo y la comprobación literal de la sonda v4 se
detuvo, como estaba diseñada. Producción no está implicada.

## 3. Reproducción antes de corregir

`__tests__/phase1a4bSqliteErrorClassificationR5.test.ts`, escrita y ejecutada **antes** de corregir
([log](reproduction-before.log): 9 fallidas y 56 aprobadas de 65).

- El mensaje se lee de la evidencia. Se comprueba carácter a carácter (saltos de línea con 8 espacios, sin `\r`) y que
  la parte clasificada y la parte `raw` del fallo son la misma cadena.
- Se ejecuta el **clasificador r4 real**: copia byte a byte de la sonda derivada r4
  (`baseline/phase1a3bProbes.r4.ts.txt`, SHA `4883d7ef…`, igual al inventario r4), transpilada solo en sus funciones.
  Reconoce Node y API 24 y **no** reconoce API 35. Reproduce literalmente el texto del fallo del HONOR.
- Fallos antes de la corrección:
  - El positivo API 35.
  - Las 4 comprobaciones de `v4-v5-flows` con el formato API 35 inyectado. Node reproduce exactamente
    `Version 4 guarded step: other: no such table: … (OS error - 2:No such file or directory) | raw: …`.
  - 4 negativos que r4 aceptaba: las dos variantes nunca observadas, otra tabla con una sentencia cualquiera, y el formato
    API 24 con el sufijo OS añadido.

## 4. Clasificador anterior y nuevo

**r4:** `^no such table: <id>( \(code 1( SQLITE_ERROR(\[1\])?)?\): , while compiling: <cualquier texto>)?$`. La sentencia
solo debía contener el nombre de la tabla como palabra completa.

**r5** (`missingTableName`, generado por `derive-probes.cjs`): se reconocen exactamente tres formatos.

| Formato | Texto después de `no such table: <tabla>` |
|---|---|
| A. Node | nada |
| B. Android API 24 | ` (code 1): , while compiling: ` + sentencia |
| C. Android API 35 | ` (Sqlite code 1 SQLITE_ERROR): , while compiling: ` + sentencia + `, (OS error - 2:No such file or directory)` |

En B y C, la sentencia debe ser **completa e idéntica** a una sentencia registrada para esa tabla en
`MISSING_TABLE_STATEMENTS`. Solo hay una: la guarda `hasActiveAllocationsForPurchaseTransaction`, tal como la pasa
producción, con salto de línea y 8 espacios. No se usan expresiones flexibles ni se normalizan espacios. Por
construcción quedan fuera:

- otro código u otra categoría;
- otro sufijo OS u otro errno;
- una segunda sentencia o un segundo error;
- texto añadido, recortado o con prefijo;
- mezclar los formatos B y C.

Las variantes r4 no observadas se retiran. Cualquier mensaje no reconocido conserva su clase anterior (`raise:`, `check`,
`unique`, `foreignKey`, `notNull`) o `other: <texto completo>`. El resultado sigue siendo
`other: no such table: installment_allocations`, idéntico al que Node producía. No hay normalización general.

## 5. Archivos modificados

| Archivo | Cambio |
|---|---|
| `scripts/phase1a4b/derive-probes.cjs` | Solo el bloque del clasificador y sus comentarios (`4409847f…` → `b3db9aad…`) |
| `scripts/phase1a4b/phase1a3bProbes.ts` | Regenerado por el generador (`4883d7ef…` → `508a88e5…`; +28/−10 líneas: cabecera y clasificador) |
| `__tests__/phase1a4bSqliteErrorClassificationR5.test.ts` | Nueva: reproducción, positivos, 47 negativos y `v4-v5-flows` con los tres formatos (65 pruebas) |
| `__tests__/phase1a4bSqliteErrorClassification.test.ts` | Dos expectativas r4 alineadas con la regla más estricta. Las variantes no observadas y otra tabla con sentencia no registrada conservan ahora el texto completo, que sigue siendo una clase distinta. Sin otros cambios |
| `docs/validacion-fase1a4b/r5/` | Este informe, logs, líneas base r4 (`baseline/`) e inventario |
| `scripts/phase1a4b/r5/` | Inventario, preparación, identidad, runners y verificador de cobertura |

Sin cambios en `scripts/phase1a3b/probes.ts` ni `scripts/phase1a4a/phase1a3bProbes.ts` (fuentes históricas), producción,
migración 5, triggers, reglas D6, oráculos, hooks ni guards.

## 6. Pruebas positivas y negativas

- **Positivas (3):**
  - Node.
  - API 24, mensaje real de r4, igual al de r3.
  - API 35, mensaje real de r4.
  - Las tres dan `missingTableName = installment_allocations` y la misma clase estable, tanto con objeto `message` como con
    `Error`.
- **Negativas no reconocidas (36).** Todas conservan `other: <texto completo>`:
  - Otra tabla (formatos 24 y 35).
  - Tabla alterada: singular, mayúsculas o calificada con `main.`.
  - Sentencia sobre otra tabla, con `LIMIT 2`, con una segunda sentencia, con otro espaciado, o con la tabla solo como
    prefijo.
  - Códigos 11 y 19, `SQLITE_CONSTRAINT`, o código 1 con otra categoría.
  - Las dos variantes r4 no observadas.
  - Sufijo OS desconocido, errno 13 o errno 0; API 35 sin sufijo; API 24 con sufijo; sufijo duplicado.
  - Truncados: sufijo, sentencia, nada tras `while compiling` o código sin sentencia.
  - Malformados: sin dos puntos, `sqlite` en minúsculas, sin nombre o sin espacio.
  - Dos errores en un mensaje o dos errores Node.
  - Texto añadido, salto de línea final, prefijo `Error:`, o Node con texto añadido.
- **Negativas con clase propia (11):**
  - Otra tabla y tabla alterada en Node: clases distintas.
  - FK en Node y en API 35: `foreignKey`.
  - CHECK: `check`. UNIQUE en API 35: `unique`.
  - Sintaxis y transacción en formato API 35, permisos de solo lectura con errno 13, y `database is locked`: texto completo.
  - RAISE propio: `raise:antes de eliminarlo`.
- `undefined` → `accepted`; objeto sin `message` → `other: {"code":5}`. Fuera de la rama «no such table», el resultado es
  idéntico al del clasificador r4.

## 7. `v4-v5-flows` en Node (datos sintéticos, tres formatos inyectados en el adaptador)

Se ejecuta el flujo completo tres veces. En cada una, el rechazo «no such table» del adaptador se reescribe con el
formato correspondiente (Node, API 24 o API 35); ningún otro error se toca.

**Versión 4**, igual en los tres formatos:

- En el instante del error, `installment_allocations` no existe en `sqlite_master` (la retiró el descenso a v4 y no se
  recreó).
- La consulta que falla es exactamente la guarda de producción. El error entregado es el del formato y se clasifica
  como `other: no such table: installment_allocations`.
- El error **no** ocurre antes de toda escritura. Dentro de `BEGIN IMMEDIATE` ya se ejecutaron `UPDATE transactions` e
  `INSERT INTO transactions`. Le sigue inmediatamente `ROLLBACK` y no hay ningún `COMMIT` entre ambos.
- La sonda compara el estado completo antes y después (todas las tablas, `rowid` y esquema). Llega hasta esa
  comprobación y registra `stateUnchanged: true`. No queda ningún movimiento confirmado.
- La siguiente transacción (migración 5 reaplicada) abre y confirma. Al terminar, `isTransaction === false`: no queda
  ninguna transacción abierta.
- Único otro error SQL de la ejecución: el rechazo FK de la primera ronda de `resetSyntheticData`, reintentado por diseño.

**Versión 5**, igual en los tres formatos:

- Tras `INSERT INTO schema_migrations VALUES (5…`, las tablas de imputación y revisiones existen y no aparece ningún error
  «no such table».
- Pasos `editTerms`, `payment`, `deletePayment` y `deletePurchase` (6, 10, 24 y 22 escrituras), iguales a la referencia:
  movimientos, saldos, deuda, cupo, patrimonio, extractos, imputaciones, revisiones y D6.
- Todo `flows` es igual a `phase1a3b.flows` de la referencia.

Las comprobaciones de la sonda no cambian: la comparación v4 sigue siendo literal y el estado completo se sigue
comparando.

## 8. Oráculo

- Candidato `artifacts/phase1a4b-r5/candidate-results.json`: lo escribe `SMARTFIN_1A4B_CANDIDATE` en una ruta nueva fuera
  de `docs/` y no sobrescribe la referencia.
- **Idéntico byte a byte** a `docs/validacion-fase1a4b/node/results.json`:
  `1faa219207d86d95f7b55f3e3446243d3d6194bbd974e7018089e7acce41bd1b`, el valor del inventario r4.
- `editAmount.backupRevision = 33` y `deletePurchase.backupRevision = 25`. v4 `other: no such table: installment_allocations`,
  `stateUnchanged: true`.
- Equivalencia 1a.4B 10/10, aislamiento 7/7 y diagnóstico r2 6/6 ([log](equivalence.log)).

Referencias históricas, sin cambios (mismo SHA que en los inventarios r3 y r4):

| Referencia | SHA-256 |
|---|---|
| 1a.4A r2 | `fa0a6e8a01b86cef29d0775da3456b13e19de9eea2f912d2b4e63a80c6a0dab7` |
| 1a.4A | `008decf042315da46dfc3ba76703a3375e42af473a99e1cfdc873508cc90f59f` |
| 1a.3B | `c0854ea85ce3a9ad06f18ba3ac0db840e7ca4160a2966bc94359283c05efed03` |
| 1a.3A | `19b01c303a55d4af16a1fd036d3caf92cd7624afccf419cd10cb9bfe289abb2e` |
| 1a.2 | `8e58ada75f0b1006d95b37ad3a8f6cc32567955f48fd1a12822e6e50129abb13` |
| 6B.3 | `e7c12f1e2deb6cc4a26e7d41f683e6c3465708894057f50bbe8652d6b6b6b9b3` |
| 1a.4B | `1faa219207d86d95f7b55f3e3446243d3d6194bbd974e7018089e7acce41bd1b` |

## 9. Validación Node

| Verificación | Resultado |
|---|---|
| Clasificador r5 (reproducción, positivos, negativos y v4/v5 ×3) + suite r4 | 65/65 + 27/27 ([log](classifier-after.log)) |
| Equivalencia 1a.4B, aislamiento y diagnóstico r2 | 23/23 |
| Abonos extraordinarios, D6, inicialización perezosa, idempotencia y protección de compras (`extraordinaryInstallmentPaymentPhase1a4B`), 1a.4A, 1a.3B, 1a.3A, 1a.2, 6B.3 y 6A | PASS en Jest completo |
| Jest completo | **1478 aprobadas, 1 fallo, 14 omitidas** (1493); 93 suites aprobadas, 1 fallida, 7 omitidas ([log](jest-full.log)) |
| Reproducciones financieras | **29/29** ([log](reproductions.log)) |
| TypeScript | Sin errores |
| ESLint | 0 errores; las 5 advertencias previas (`phase5e3`, `phase6a`, `phase6b`) |
| `git diff --check` | Limpio |

**Fallo intermitente conocido, documentado aparte:** `subscriptionAtomicityPhase4` («maintenance requests share one
run…»), `RangeError: Maximum call stack size exceeded` en `__tests__/helpers/realSQLite.ts:140`. Es el mismo
desbordamiento de pila ya documentado y no toca ningún archivo de 1a.4B. Ejecutado aislado tres veces: 14/14 cada vez
([log](subscriptionAtomicityPhase4-isolated.log)). La suite no se ha modificado. Las 1478 aprobadas son las 1414 de la
línea base más las 65 nuevas, menos la fallida.

Después de Jest, la referencia 1a.4B, las referencias históricas y las evidencias r1–r4 siguen con los mismos hashes.

## 10. Auditoría preventiva (solo lectura)

| Aspecto | Resultado |
|---|---|
| Textos de driver en los oráculos | Solo `no such table: installment_allocations` en la referencia 1a.4B. Ninguno en 1a.4A r2, 1a.3A, 1a.2 ni 6B.3 |
| Comparaciones de errores en las sondas que van al APK | 1a.4B: `outcomeOf` (RAISE propios, error de caso de uso, `rejected: <texto>` de validación JS, igual en ambos motores; aprobado en API 24 y 35 en r4). 1a.4A: texto propio de la app. 1a.3A: FK por expresión regular. Fallos inyectados por identidad (`isInjected`). 1a.3B: `errorClass` (corregido) y la comprobación de la migración por `/smartfin_phase1a3b_fault_missing_table\|no such table/`, aprobada en API 35 en r4 |
| Identidad de consultas | La única sentencia reconocida es la guarda real, comparada completa |
| Rollback | La v4 compara el estado completo dentro del motor; los puntos de fallo comparan `rolledBack`, `exactStateRestored` y `nextOwnerConfirmed` con Node |
| Orden de propiedades y filas | `canonical()` y filas `ORDER BY rowid`; sin cambios |
| `android_metadata` | Excluida en `schemaObjects` y `fullState`; sin cambios |
| Aislamiento | `pm clear` del paquete sintético antes de cada campaña salvo las de reinicio; mutex por dispositivo; mismas reglas `PreserveData` |
| Contador de respaldo | 33 y 25 en la referencia y en las partes embebidas |
| Runners | Derivados mecánicamente de los r4 (hashes del inventario r4); solo cambian workspace, identidad y rutas `r5/` |
| Archivos embebidos | Las cinco partes de referencia, regeneradas desde el oráculo, son idénticas byte a byte a las del workspace |

Riesgo observado y evitado: `inventory-r4.cjs verify` reescribe `r4/authorization/integrity-after.json`. Se ejecutó una vez
antes de Jest. El archivo se restauró a su contenido de cierre de r4 (SHA `92824534…`), comprobado frente a una
instantánea de los 378 archivos de evidencia r4 tomada antes. `inventory-r5.cjs` solo escribe en `r5/authorization`.

No se encontró ningún otro defecto.

## 11. Workspace r5

| Elemento | Valor |
|---|---|
| Workspace | `C:/sf-1a4b-r5-20261107`, nuevo, copiado del r4 auditado (`97e1a907…`, APK `aa720dd0…`). Sin `build/`, `.gradle/` ni `.cxx/` (se detiene si se copiara algún archivo posterior a la atestación r4); `node_modules` como enlace |
| Atestación | `13268571c86f24f13a132b5090cafb37022924863a9bec2037535987950f543e`, fase `1a.4B r5`, 390 archivos preparados y 389 fuentes del checkout; copia embebida idéntica |
| Diferencias frente a r4 | Solo `phase1a3bProbes.ts` (además de la atestación y su copia embebida). Mismos 482 archivos; producción, las cinco partes de referencia y los demás arneses son idénticos byte a byte |
| Comprobaciones | `phase1a3bProbes.ts` = checkout reescrito (`'../../src/'` → `'./src/'`); lógica real 1a.4B activa; `extraordinaryInstallmentPayment` solo en su propio archivo (sin export en `index.ts` ni uso en pantallas); paquete `com.smartfin.snapshot5b2.tests`; 0 diferencias workspace–atestación y checkout–atestación |
| Inventario | `r5/authorization/inputs.sha256.json` (`60f296e2…`, 1480 entradas, incluye las 378 evidencias r4). Cambios frente a r4: el generador, la sonda regenerada y la prueba r4. Añadidos: la prueba r5 y `scripts/phase1a4b/r5/`. `verify` sin cambios: guards, producción, referencias y evidencias r1–r4 intactos |
| Identidad del APK | `apk-identity-r5.cjs` rechaza los APK y atestaciones de r4, r3, r2 (1 y b), r1 y anteriores |
| Runners | `run-android-r5.ps1` (`4e7a756f…`) y `run-all-r5.ps1` (`9d3559df…`): mismos dos dispositivos y mismas 32 campañas en el mismo orden |
| Cobertura | `check-coverage-r5.cjs <24\|35>`. Comprobado en seco contra r4: API 24 568/568 y 356/356; API 35 343/568 y 216/356 |

## 12. Cobertura corregida

El total de 502 casos de `docs/validacion-fase1a4b/README.md` §3 y de los informes r1/r3 era un error de suma: las filas
de esas tablas suman **568**. Esos documentos son evidencia protegida y no se modifican; la corrección consta aquí y en
`check-coverage-r5.cjs`.

| Bloque | Casos por dispositivo | Puntos de fallo |
|---|---:|---:|
| 1a.4B | 213 | 158 |
| 1a.4A | 66 | 28 |
| 1a.3B | 66 | 30 |
| 1a.3A | 55 | 32 |
| 1a.2, 6B.3 y 6A | 168 | 108 |
| **Total (32 campañas)** | **568** | **356** |

## 13. Comandos (requieren una nueva autorización)

Desde `C:/Users/nesto/Proyectos/SmartFin`:

1. `node scripts/phase1a4b/r5/inventory-r5.cjs verify`
2. En `C:/sf-1a4b-r5-20261107/android`: `.\gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'`
3. `node scripts/phase1a4b/r5/apk-identity-r5.cjs`
4. Arrancar el AVD `SmartFin_Guard_Synthetic_API24` en el puerto 5554 (`-no-snapshot-save`) y ejecutar
   `./scripts/phase1a4b/r5/run-all-r5.ps1 -Serial emulator-5554 -Api 24`
5. `node scripts/phase1a4b/r5/check-coverage-r5.cjs 24`: exige 32/32, 568/568, 356/356 y 0 diferencias.
6. Solo si el paso 5 aprueba: `./scripts/phase1a4b/r5/run-all-r5.ps1 -Serial AXCC6R3919012932 -Api 35` y
   `node scripts/phase1a4b/r5/check-coverage-r5.cjs 35`.
7. `node scripts/phase1a4b/r5/inventory-r5.cjs verify`. No ejecutar `inventory-r4.cjs verify`, que reescribe evidencia r4.

## 14. Riesgos y veredicto

- Si API 35 u otro dispositivo cambia el errno del sufijo o el formato, la campaña volverá a detenerse con el texto
  completo. Es intencionado: solo se aceptan formatos observados.
- La regla nueva retira las dos variantes r4 nunca observadas. Si API 24 las produjera ahora, también se detendría.
- El fallo intermitente de `subscriptionAtomicityPhase4` sigue fuera de alcance.
- La limitación de idempotencia tras editar o borrar el pago y la reconciliación bancaria siguen abiertas.
- Hay cambios sin commit (r3–r5). El runner verifica los hashes del checkout frente a la atestación r5.

**Veredicto: preparación r5 aprobada.**

- Las tres variantes reales se clasifican igual y cualquier otro error sigue siendo distinto.
- El oráculo no cambia y es idéntico byte a byte.
- v4 conserva el rollback exacto y v5 ejecuta el flujo completo.
- Las pruebas Node pasan, salvo el fallo intermitente conocido, documentado aparte.
- Producción, triggers, guards y evidencias r1–r4 siguen intactos.
- Workspace, atestación e inventario r5 listos; cobertura corregida a 568 casos y 356 puntos por dispositivo.

Compilación y ejecución Android pendientes de autorización. La Fase 1a.4B no está aprobada.

## 15. Ejecución r5, intento 1 (7 de noviembre de 2026): API 24 detenida por un fallo de `adb` en el emulador

**Comprobaciones previas:** sin incidencias.

- `inventory-r5.cjs verify` sin cambios.
- Atestación `13268571…`, embebida idéntica; 0 diferencias workspace–atestación y checkout–atestación.
- Frente a r4 solo cambia `phase1a3bProbes.ts`; sin carpetas de compilación.
- El caso de uso solo aparece en su propio archivo.
- Sin procesos de validación previos.
- `.claude/agents/` está fuera del inventario (solo se inventarían `.claude/settings.json` y `.claude/hooks/`) y fuera del
  workspace: la preparación excluye `.claude`. No interviene en ninguna comparación de fuentes.

**Node previo:**

- Clasificador r5 + r4 y equivalencia, aislamiento y diagnóstico 1a.4B: 115/115 ([log](run/node-precheck.log)).
- Oráculo `1faa2192…`.
- **Única ejecución adicional de Jest completo: 1479 aprobadas, 0 fallos, 14 omitidas** (94 suites aprobadas, 7 omitidas;
  [log](run/jest-full.log)). Es la nueva línea base. La intermitencia de `subscriptionAtomicityPhase4` sigue documentada
  (§9): esta vez no apareció.

**APK r5:** `C:/sf-1a4b-r5-20261107/android/app/build/outputs/apk/release/app-release.apk`.

- SHA-256 `33810542689a422099539b58fd4796f624a41172e41e175100d3371172368975`, 33.812.128 bytes, compilación offline en
  3 min 18 s ([log](run/android-build.log)).
- `apk-identity-r5.cjs` aprobado ([identidad](authorization/apk-identity.json)); frente a r4 solo cambia `phase1a3bProbes.ts`.
- Hermes (`C6 1F BC 03`), `com.smartfin.snapshot5b2.tests`, release sin `debuggable`.
- El bundle contiene el código 1a.4B y las dos grafías Android r5; la grafía retirada `(code 1 SQLITE_ERROR[1])` no
  aparece.
- Las cinco partes de referencia son idénticas byte a byte a las generadas desde el oráculo.

**API 24** (`emulator-5554`, AVD `SmartFin_Guard_Synthetic_API24`, `-no-snapshot-save`), [log](attempt-1/run/android-api24.log):

- 8 campañas aprobadas: las 7 de 1a.4B (213/213) y `phase1a4a-creation` (14/14). 8.243 campos comparados, 0 diferencias.
  `com.smartfin` sin cambios.
- Parada al preparar `phase1a4a-lifecycle`, **antes de lanzar la campaña**, tras `pm clear` del paquete sintético. El runner
  falló en `adb shell appops set com.smartfin.snapshot5b2.tests POST_NOTIFICATION allow: Segmentation fault`.
- Causa observada ([logcat del emulador](attempt-1/run/api24-stop/emulator-logcat.txt)): `SIGSEGV` en el proceso del sistema `cmd`
  (pid 5243), en un hilo binder (`libbinder.so Parcel::writeInt32` → `IPCThreadState::joinThreadPool`), con tombstone del
  sistema. Es la herramienta de shell de Android 7.0, no la aplicación ni SQLite. La campaña no llegó a ejecutarse
  (su carpeta solo contiene `apk-badging.txt`, `environment.json` y la atestación; no hay `result.json`).
- No ejecutado: 24 campañas de API 24 y API 35 completo. Emulador apagado. `inventory-r5.cjs verify` sin cambios.

No se reintentó nada. Para seguir hay que apartar la evidencia de este intento, porque el runner no sobrescribe
evidencias, y repetir API 24 desde el principio con el mismo APK y la misma atestación. Requiere autorización.

## 16. Ejecución r5, intento 2 (7 de noviembre de 2026): API 24 y API 35 aprobadas

**Archivado del intento 1** (autorizado):

- Movidos 61 archivos a `attempt-1/`: `android/api24/` (9 carpetas de campaña), `run/android-api24.log` y
  `run/api24-stop/`. Nombres conservados.
- Hashes idénticos antes y después: `attempt-1/hashes-before-move.sha256` y `hashes-after-move.sha256`.
- Siguen en `run/`, compartidos por ambos intentos: `android-build.log` (el mismo APK), `node-precheck.log` y
  `jest-full.log`.
- `inventory-r5.cjs verify` sin cambios (`r5/` está fuera del inventario). No se ejecutó ningún verificador r4.

**Antes del intento 2:**

- Git sin cambios respecto al inicio. Sin runners, Gradle ni emuladores activos.
- APK `33810542…` y atestación `13268571…` sin cambios. Referencia `1faa2192…`. Guards intactos.
- `com.smartfin` en el HONOR: `lastUpdateTime 2026-10-11 16:27:48`.

**Emulador (arranque nuevo, `-no-snapshot-save`):**

- `sys.boot_completed=1`, `bootanim` detenido, AVD `SmartFin_Guard_Synthetic_API24`, SDK 24; ADB responde.
- APK sintético instalado con el MD5 del APK r5; sin proceso activo; `com.smartfin` no instalado.
- El HONOR seguía conectado: el runner se dirige solo por número de serie.
- No se tocaron permisos, AppOps ni el runner.

| | API 24 (`emulator-5554`, SQLite 3.9.2) | API 35 (`AXCC6R3919012932`, SQLite 3.44.5) |
|---|---|---|
| Campañas | 32/32 | 32/32 |
| Casos | 568/568 | 568/568 |
| Puntos de fallo | 356/356 (158 + 198) | 356/356 (158 + 198) |
| Campos comparados con Node | 48.699, 0 diferencias | 48.699, 0 diferencias |
| `check-coverage-r5.cjs` | `approved: true` ([api24-coverage.json](android/api24-coverage.json)) | `approved: true` ([api35-coverage.json](android/api35-coverage.json)) |
| Duración | 11 min 36 s ([log](run/android-api24-attempt2.log)) | 19 min 37 s ([log](run/android-api35.log)) |
| Incidentes | Ninguno (sin `Segmentation fault`) | Ninguno |

Los recuentos son solo del intento 2: la carpeta `android/api24/` se creó de nuevo y los `result.json` son de 13:10–13:21,
posteriores al intento 1 (12:58).

**`v4-v5-flows`:** aprobado en los dos dispositivos, con 543 campos iguales a Node: `version4Incompatible` = `editTerms`,
`other: no such table: installment_allocations`, `stateUnchanged: true`, y la mitad v5 completa.

- **API 24:** el mensaje del driver quedó en el logcat (`(code 1): , while compiling: SELECT 1 AS found …`).
- **API 35:** el logcat del HONOR está vacío, como en r4, así que el texto del driver no quedó registrado. La comprobación
  literal de la sonda solo pasa si el mensaje es exactamente una de las tres formas aceptadas, con esa tabla, código 1, la
  consulta completa de la guarda y, en la forma API 35, el sufijo `OS error - 2` exacto.

**Resto de la cobertura, en ambos dispositivos:**

- **Rollback:** en los 356 puntos, `rolledBack` con el estado exacto restaurado y la siguiente transacción confirmada
  (comparado con Node o leído del dispositivo).
- **`unknown`:** los cuatro casos (1a.4B, 1a.4A, 1a.3A y 6B.3) se mantienen como `unknown`, sin reintento. Tras reiniciar
  hay una sola persistencia. No se cuentan como rollback.
- **1a.4B:**
  - Registro 9/9, D6 13/13, protección de compras 15/15, idempotencia 4/4 y atomicidad 165/165.
  - Contadores `backupRevision`: 33 (`editAmount`) y 25 (`deletePurchase`).
- **Regresiones:** 1a.4A 66, 1a.3B 66, 1a.3A 55, y 1a.2/6B.3/6A 168, contra las referencias sin cambios.
- **`com.smartfin`:** sin cambios en las 64 campañas. En el HONOR los metadatos son idénticos antes y después; en el
  emulador no está instalado. El paquete sintético queda instalado en ambos dispositivos, como en rondas anteriores.

**Estado final:**

- `inventory-r5.cjs verify` sin cambios: guards, producción, referencias y evidencias r1–r4 intactos (también frente a la
  instantánea de los 378 archivos r4).
- Emulador apagado. Sin commit ni push. Producción, arnés, oráculos y runner sin cambios. Sin recompilar.

**Veredicto: la validación técnica Android de la Fase 1a.4B queda aprobada en los dos dispositivos** (32/32, 568/568,
356/356, 0 diferencias).

Riesgos que siguen documentados aparte:

- La intermitencia de `subscriptionAtomicityPhase4`: la última ejecución de Jest pasó, pero la intermitencia no se ha
  resuelto.
- La limitación de `command_id`: tras editar o borrar el pago, el importe y la cuenta origen originales no se pueden
  comprobar. La repetición es segura (sin escrituras, sin dinero recreado, sin reactivar imputaciones), pero no demuestra
  la equivalencia completa del comando.
- La reconciliación bancaria pendiente.
- El fallo de `cmd` del emulador API 24 en el intento 1, que no se repitió.

No se avanza a 1a.5.
