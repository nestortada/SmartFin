# Validación Node–Android de la Fase 1a.3B (r5 aprobada en API 24 y API 35; r1–r4 detenidas en API 24)

2 de noviembre de 2026, America/Bogota. Estado: **campañas, oráculo Node, scripts y workspace sintético preparados**.
No se ha compilado ningún APK, ni arrancado emuladores, ni instalado o ejecutado nada en dispositivos. Ninguna acción
afecta a `com.smartfin`. Ejecutar la sección 8 requiere autorización específica del propietario.

La validación 1a.3A (223/223 en API 24 y API 35; [validacion-fase1a3a/README.md](../validacion-fase1a3a/README.md)) es la
línea base de las regresiones. Su APK `2a5d613f…` no contiene la migración 5 y no sirve como evidencia de esta fase.

## 1. Estado del repositorio

- Rama `main`, commit `9086c90` («fase 1a3A»).
- Cambios sin confirmar: la implementación 1a.3B ([persistencia-imputaciones-fase1a3B.md](../persistencia-imputaciones-fase1a3B.md))
  y, de esta tarea, solo archivos nuevos de validación (sección 2). **No se modificó código de producción** ni los
  oráculos históricos de 1a.3A, 1a.2, 6B.3 o 6A.
- Decisión D6 registrada: se conservan las guardas de imputaciones activas. Contrato futuro (no implementado): el caso
  de uso identifica las imputaciones activas del pago, las revierte, crea las revisiones correctivas y después edita o
  elimina el pago, todo en una única transacción.

## 2. Piezas preparadas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Sondas y oráculos | [`scripts/phase1a3b/probes.ts`](../../scripts/phase1a3b/probes.ts) | Código compartido Node/Android. Usa la migración, los casos de uso y los repositorios de producción sin cambios, con el reloj JS fijado en cada paso. La base «v4» se obtiene en sitio eliminando exactamente los objetos de la migración 5 y su fila de versión |
| Arnés Android | [`scripts/phase1a3b/androidHarness.js`](../../scripts/phase1a3b/androidHarness.js) | 7 campañas `phase1a3b-*`; cada caso debe ser igual a la referencia Node campo a campo, sin tolerancias. Informa la versión de SQLite |
| Referencia Node | [`node/results.json`](node/results.json) | `SMARTFIN_WRITE_EVIDENCE=1 npx jest __tests__/phase1a3bAndroidEquivalence.test.ts`, conexión gestionada `node:sqlite` |
| Prueba Node | [`__tests__/phase1a3bAndroidEquivalence.test.ts`](../../__tests__/phase1a3bAndroidEquivalence.test.ts) | Ejecuta las 7 campañas como el APK (arranques reales sobre un archivo para las de reinicio), comprueba determinismo (dos ejecuciones idénticas) e igualdad con la referencia |
| Preparador | [`scripts/phase1a3b/prepare-android.cjs`](../../scripts/phase1a3b/prepare-android.cjs) | Workspace nuevo `C:/sf-1a3b-20261102` desde `C:/sf-1a3a-20261102` (comprueba atestación `fe6d5789…` y APK `2a5d613f…`) |
| Inventario | [`scripts/phase1a3b/authorization-inventory.cjs`](../../scripts/phase1a3b/authorization-inventory.cjs) | `capture` / `verify` pasivos de entradas y guards ([`authorization/inputs.sha256.json`](authorization/inputs.sha256.json)) |
| Identidad del APK | [`scripts/phase1a3b/apk-identity.cjs`](../../scripts/phase1a3b/apk-identity.cjs) | Tras compilar y antes de instalar: hash, tamaño, atestación embebida; rechaza las atestaciones y APK de 6B.3, 1a.2 r1/r2 y 1a.3A |
| Runner | [`scripts/phase1a3b/run-android.ps1`](../../scripts/phase1a3b/run-android.ps1) | Derivado mecánicamente del runner 1a.3A (hash fijado `e02594b5…`) por [`make-runner.cjs`](../../scripts/phase1a3b/make-runner.cjs). Solo cambian workspace, rutas de evidencia e identidad, las 18 campañas permitidas, el reseteo limpio de `phase1a3b-` y `PreserveData` para las dos campañas de arranque |
| Ejecución | [`scripts/phase1a3b/run-all.ps1`](../../scripts/phase1a3b/run-all.ps1) | Las 7 campañas 1a.3B y después las 11 regresiones, solo para los dos seriales autorizados |

## 3. Campañas nuevas

Datos sintéticos comunes: banco 1.000.000; Visa con corte el 20 y cupo 2.000.000; compras por los casos de uso
(300.000×3, 1.234,56×6 y 50.000 a 1 cuota, sin plan), pago de tarjeta de 100.000 y cuatro filas heredadas
sintéticas (0,1+0,2; 0 cuotas; 400 cuotas; 2^47). Seis planes en total.

| Campaña | Contenido | Comprobaciones (además de igualdad con Node) |
|---|---|---|
| `phase1a3b-upgrade` | Base v4 con historial → `applyVersionedMigrations` en proceso; luego dos ejecuciones más | Versión 5; cuatro tablas y sus objetos; revisión 0 por plan (`pendingVerification`, sin ciclo, `basis_*` sin redondear); cuentas, cupo (BigInt), dashboard, movimientos, planes y extractos con `rowid`, perfiles y contador de respaldo idénticos; todas las tablas existentes iguales fila a fila; `integrity_check` y `foreign_key_check`; repetición sin escrituras ni cambios en `applied_at` |
| `phase1a3b-startup-seed` | Deja una base v4 con historial y guarda el estado esperado en una tabla sintética | Esquema v4 exacto |
| `phase1a3b-startup-upgrade` (`PreserveData`) | Nuevo proceso: `openSmartFinDatabase` migra al arrancar (ruta real de producción) | Versión 5, revisiones 0, estado financiero igual al guardado; registra `applied_at`, ids y relojes de las revisiones y el estado completo |
| `phase1a3b-upgrade-restart` (`PreserveData`) | Tercer proceso | Migración no repetida (`applied_at` igual), sin revisiones duplicadas ni reescritas, estado completo idéntico |
| `phase1a3b-migration-atomicity` | Los 15 puntos del Node × antes/después = **30 casos** | Fallo propagado; esquema completo (texto SQL incluido) y todas las tablas iguales a v4; versión 5 no registrada; sin tablas, índices ni triggers parciales; nuevo propietario confirma una transacción; la siguiente migración completa la versión 5 con las revisiones esperadas |
| `phase1a3b-integrity` | 10 sondas en v5 | `CHECK` (incl. `date()` de fechas imposibles en 3.9.2), centavos, triggers `BEFORE`/`AFTER`, compra/pago/tarjeta, secuencia, solo inserción, `INSERT OR REPLACE`, transición `active → reversed`, FK compuesta, idempotencia por comando, guardas con el caso de uso real (rollback exacto), reversión y borrado posterior, `purchaseEdit`/`purchaseRemoval`, recreación de compra, metadatos D1 con identidad, repositorios en ámbito compartido, borrado financiero |
| `phase1a3b-flows` | Crear → editar condiciones (3 → 6) → pagar → borrar pago → borrar compra, en v4 y en v5 | Mismo número de escrituras en cada paso; contabilidad idéntica (cuentas, cupo, dashboard, movimientos, planes, extractos); diferencias estructurales explicadas |

### Cómo se inyectan los fallos de la migración

El gancho de fallos del APK (`__deletionFault`) solo cubre escrituras de la API de promesas; la migración corre en la
transacción de callbacks del driver. La sonda envuelve esa transacción **sin tocar producción**: al llegar a la
sentencia elegida, la sustituye (`before`) o la ejecuta y continúa (`after`) con un `SELECT` sobre una tabla
inexistente, el mismo aborto que usa el runner de producción, de modo que el driver revierte toda la migración. Es
la misma sonda en Node y en Android.

### Diferencias de representación entre motores

- Errores: se comparan por clase (`check`, `unique`, `foreignKey`, `notNull`) o por el texto propio de cada
  `RAISE`, no por el mensaje del motor (3.9.2 y 3.53 nombran distinto la restricción). Cualquier otro error se
  registra como `other: <mensaje>` y rompería la igualdad: no se oculta.
- Relojes de SQLite (`strftime('now')`): `applied_at` y el `created_at` de las revisiones de la migración y de los
  triggers se sustituyen por `<sqlite-clock>` tras comprobar su formato; en el reinicio se comparan sus valores reales
  dentro del mismo dispositivo.
- Ids de movimientos (reloj fijado + secuencia del proceso): renombrados `M1…`, `P1…` por orden de aparición.
- Orden: revisiones por `rowid` de la compra, nunca por id.
- No se relaja ningún importe: saldos, deuda y cupo en centavos BigInt, dashboard, movimientos y planes completos.

### Diferencias estructurales esperadas en `phase1a3b-flows` (Node)

| Paso | Escrituras v4 = v5 | Contador de respaldo v5 − v4 (acumulado) | Historial v5 |
|---|---|---|---|
| Editar condiciones | 6 | +1 | `purchaseEdit` (`termsChanged`) |
| Pago | 10 | +1 | — |
| Borrar pago | 24 | +1 | — |
| Borrar compra | 22 | +2 | `purchaseRemoval` (`purchaseRemoved`) |

Son las filas añadidas por triggers (no puntos de escritura) y sus incrementos del contador; la contabilidad es idéntica.

## 4. Oráculo Node y resultados

| Verificación | Resultado |
|---|---|
| `npx jest __tests__/phase1a3bAndroidEquivalence.test.ts` | 5/5: dos ejecuciones completas idénticas e iguales a `node/results.json` |
| Hojas comparadas | upgrade 1.208; arranque (3 campañas) 2.028; atomicidad 22.020; integridad 2.217; flujos 970 → **28.443 por dispositivo** |
| Errores sin clasificar (`other:`) | 0 |
| Pruebas de migración (`installmentHistoryPhase1a3B`) | 49/49 |

| `npm test -- --runInBand` | 85 suites aprobadas y 7 omitidas; 1.251 pruebas aprobadas, 14 omitidas, 0 fallos; 8/8 snapshots. `subscriptionAtomicityPhase4` aprobada en esta ejecución (sin fallo intermitente que registrar) |
| `npm run test:reproductions -- --runInBand` | 29/29 |
| `npx tsc --noEmit`, `npm run lint` | Sin errores; las 5 advertencias previas de `scripts/phase5e3`, `phase6a` y `phase6b`; ninguna en `scripts/phase1a3b` |
| `git diff --check` | Limpio |

## 5. Casos previstos por dispositivo

| Campaña | Casos |
|---|---|
| `phase1a3b-upgrade` | 4 (aislamiento, runtime, upgrade, resumen) |
| `phase1a3b-startup-seed` | 4 |
| `phase1a3b-startup-upgrade` | 4 |
| `phase1a3b-upgrade-restart` | 4 |
| `phase1a3b-migration-atomicity` | 33 (30 puntos) |
| `phase1a3b-integrity` | 13 (10 sondas) |
| `phase1a3b-flows` | 4 |
| **Nuevas** | **66** |
| Regresiones (sin cambios de criterio): `phase1a3a-identity` 11, `-atomicity` 37, `-unknown` 3, `-unknown-restart` 4, `phase6b3-atomicity` 66, `phase1a2-atomicity-historical` 53, `phase1a2-statements` 13, `phase6b3-probes` 12, `phase6b3-unknown` 3, `-unknown-restart` 3, `phase6a-precision` 18 | 223 |
| **Total** | **289** |

Puntos de fallo por dispositivo: 30 nuevos + 140 de regresión = **170**.

Las referencias de regresión no cambian con la migración 5: sus pruebas Node de equivalencia pasan contra los mismos
`results.json` (los triggers no son puntos de escritura y las sondas antiguas crean compras sin historial).

## 6. Cobertura real

- Migración: base nueva (todas las campañas abren por la ruta real), v4 → v5 en proceso y **al arrancar**, repetición,
  reinicio sin repetición, 30 fallos con recuperación. Filas con importes exactos, con centavos e inexactos.
- No cubierto en dispositivo: volumen (2.000 compras, solo Node), degradación a una app anterior sobre base v5, y
  fallos de E/S reales distintos del aborto por sentencia.

## 7. Workspace y atestación

Ver sección 10.

## 8. Procedimiento (requiere autorización)

Desde `C:/Users/nesto/Proyectos/SmartFin`, sin modificar el checkout después de preparar:

1. Comprobar entradas y guards: `node scripts/phase1a3b/authorization-inventory.cjs verify` (debe dar
   `protectedFilesUnchanged: true`, sin cambios).
2. Registrar metadatos de `com.smartfin` antes de empezar
   (`adb -s <serial> shell dumpsys package com.smartfin` → `android/com.smartfin-before-api{24,35}.txt`).
3. Compilar en `C:/sf-1a3b-20261102/android`:
   `./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'`.
4. `node scripts/phase1a3b/apk-identity.cjs` (antes de instalar nada).
5. Arrancar el AVD `SmartFin_Guard_Synthetic_API24` sin wipe si no lo está.
6. `./scripts/phase1a3b/run-all.ps1 -Serial emulator-5554 -Api 24` y `./scripts/phase1a3b/run-all.ps1 -Serial AXCC6R3919012932 -Api 35`.
7. `node scripts/phase1a3b/authorization-inventory.cjs verify` y metadatos de `com.smartfin` después.

Protección de `com.smartfin` (ya en el runner): solo seriales y API autorizados (AVD por nombre, HONOR por modelo);
APK y atestación iguales a la identidad registrada y a la embebida; `aapt` exige `com.smartfin.snapshot5b2.tests`
no depurable; UID distinto del de producción; `pm clear` solo del paquete sintético; ruta de la base
`.../com.smartfin.snapshot5b2.tests/databases/phase5b2_synthetic.db`; metadatos de `com.smartfin` antes y después de cada
campaña (falla si cambian); mutex por dispositivo; evidencia nunca sobrescrita.

## 9. Riesgos y criterios de cierre

Riesgos:
- `date()` y la evaluación de triggers con subconsultas en 3.9.2: cubiertos por `phase1a3b-integrity`, sin evidencia
  hasta ejecutar.
- Si la apertura en el arranque hiciera otra lectura o escritura antes de la sonda, `phase1a3b-startup-upgrade`
  lo detectaría como diferencia (no se tolera).
- `subscriptionAtomicityPhase4` (intermitente conocido): aprobada en la ejecución completa; no toca la migración 5.
- El runner y el preparador fijan los hashes del checkout: cualquier edición posterior obliga a volver a capturar el
  inventario y preparar un workspace nuevo (el preparador no sobrescribe).

Criterios para cerrar 1a.3B, por dispositivo:
1. 66/66 casos nuevos y 0 diferencias frente a Node (28.443 hojas).
2. Regresiones con sus totales anteriores (223/223) y 0 diferencias.
3. 170/170 puntos de fallo con rollback confirmado.
4. `com.smartfin` sin cambios y guards intactos (`verify`).

## 10. Workspace preparado

`node scripts/phase1a3b/prepare-android.cjs` (copia de archivos; sin Android ni compilación):

| Campo | Valor |
|---|---|
| Workspace | `C:/sf-1a3b-20261102` (desde `C:/sf-1a3a-20261102`, atestación `fe6d5789…` y APK `2a5d613f…` comprobados) |
| Atestación nueva | `7a3fc303c1c6acf5f50a99cf16fb03ff065de8f10517c41d9c952e2a248d5bce` (`phase: '1a.3B'`), idéntica a la copia de `assets/` |
| Paquete | `applicationId "com.smartfin.snapshot5b2.tests"` |
| Fuentes | 298 de producción refrescadas; `sqliteSchema.ts` con solo el nombre de base sintético, tras comprobar que la adaptación anterior era exactamente esa línea |
| Arnés | `phase1a3bHarness.js`, `phase1a3bProbes.ts`, `phase1a3bNodeExpected.json`; despachador `phase1a3b-` añadido a `Harness.jsx` conservando las campañas anteriores; regresiones byte a byte iguales a las validadas en 1a.3A |
| Limpieza | Sin `android/app/build` heredado y sin bases de datos |
| Inventario | `authorization/inputs.sha256.json`: 814 entradas. `verify` previo a la ejecución: `protectedFilesUnchanged: true`, sin cambios ni añadidos (`integrity-after.json` se regenerará tras las campañas) |

## 11. Ejecución r1 (2 nov 2026, autorizada) — detenida en el primer caso

Verificaciones previas superadas: inventario sin cambios y guards intactos; workspace y checkout iguales a la
atestación `7a3fc303…` (0 diferencias, copia embebida idéntica); oráculos históricos sin cambios; seriales
`emulator-5554` (API 24, AVD `SmartFin_Guard_Synthetic_API24`) y `AXCC6R3919012932` (API 35). Metadatos de
`com.smartfin` antes: [`android/com.smartfin-before-api{24,35}.txt`](android/) (no instalado en el emulador).

**APK r1** ([`authorization/apk-identity.json`](authorization/apk-identity.json), compilación en `android-build.log`, 3 min 15 s):
SHA-256 `cb07e290e4b9fb89b60d017adf05940731c8db9eb5c803eb705a7ae71180a4ae`, 33.566.540 bytes, release; atestación
`7a3fc303…` igual a la embebida; bytecode Hermes (`C6 1F BC 03`) con la migración 5 y las campañas 1a.3B;
`com.smartfin.snapshot5b2.tests` no depurable (`aapt`); 307 fuentes de producción comprobadas.

**Resultado** ([`android/api24/phase1a3b-upgrade/`](android/api24/phase1a3b-upgrade/), `android-api24.log`): API 24 con
**SQLite 3.9.2**; `isolation` y `runtime` aprobados; `upgrade` **falló** la igualdad con Node:
`$.schema.100.1: Android="backup_revision_categories_delete" Node="backup_revision_categories_insert"`.
`run-all` se detuvo ahí: ninguna otra campaña ni API 35 se ejecutó. `com.smartfin` sin cambios.

**Causa**: Android muestra 1.211 campos frente a 1.208 en Node, es decir, una fila de esquema más (3 campos) que desplaza
la lista. Esa fila es `android_metadata`, la tabla que crea el framework de Android (no SmartFin). La fase 5E.5 ya la
excluía (`backupRecoverabilityPhase5E5.test.ts`). Todas las comprobaciones internas de la sonda se cumplieron antes de
la comparación en el dispositivo: v4 → v5, revisión 0, estado financiero idéntico y repetición sin escrituras. Por
tanto es un **defecto de representación del arnés**, no una diferencia de datos ni de la migración.

**Corrección (r2)**: las tres consultas de esquema/tablas de `scripts/phase1a3b/probes.ts` excluyen `android_metadata`.
La referencia Node queda **idéntica byte a byte** (Node no tiene esa tabla); ningún oráculo cambia. No se tocó código de
producción, la migración, los triggers ni los guards.

## 12. r2 preparada (pendiente de autorización)

- Evidencia r1 conservada íntegra: workspace `C:/sf-1a3b-20261102`, `authorization/`, `android/api24/phase1a3b-upgrade/`,
  logs y runner `scripts/phase1a3b/run-android-r1.ps1` / `run-all-r1.ps1`.
- Workspace nuevo `C:/sf-1a3b-r2-20261102` desde `C:/sf-1a3a-20261102`: atestación
  `40b3c298a56fd4d6a65b0c83971ca3e1eee88a02a9539326709c3241ec14d32c` (`phase: '1a.3B r2'`), 298 fuentes refrescadas,
  sin build ni bases heredadas.
- Inventario r2: [`r2/authorization/inputs.sha256.json`](r2/authorization/inputs.sha256.json); `verify`:
  `protectedFilesUnchanged: true`, sin cambios.
- `apk-identity.cjs` rechaza además la atestación y el APK r1. Runner r2 = runner 1a.3A con rutas r2
  (`docs/validacion-fase1a3b/r2/android/…`); mismas 18 campañas y controles.
- Comandos r2: compilar en `C:/sf-1a3b-r2-20261102/android` con el mismo `gradlew` de la sección 8,
  `node scripts/phase1a3b/apk-identity.cjs`, y `run-all.ps1` para cada serial.

## 13. Ejecución r2 (2 nov 2026, autorizada) — detenida en `phase1a3b-integrity`

Verificaciones previas: inventario r2 y guards intactos; workspace r2 y checkout iguales a la atestación `40b3c298…`
(0 diferencias, embebida idéntica); r1 y r2 difieren **solo** en `phase1a3bProbes.ts` (las tres exclusiones de
`android_metadata`); APK y evidencia r1 intactos (`cb07e290…`); oráculos históricos y referencia Node sin cambios.

**APK r2** ([`r2/authorization/apk-identity.json`](r2/authorization/apk-identity.json), `r2/android-build.log`, 2 min 53 s):
SHA-256 `1423e8cea7ecfaaf8d5c611a32f30f747365b39e4363c3864719c91d0b917911`, 33.566.644 bytes, release; atestación
`40b3c298…` embebida; Hermes (`C6 1F BC 03`) con la exclusión y la migración 5; `com.smartfin.snapshot5b2.tests` no
depurable; 307 fuentes; `apk-identity.cjs` rechaza las atestaciones y APK de 6B.3, 1a.2, 1a.3A y 1a.3B r1.

**API 24 (`emulator-5554`, SQLite 3.9.2)** — evidencia en [`r2/android/api24/`](r2/android/api24/), `r2/android-api24.log`:

| Campaña | Resultado | Campos comparados |
|---|---|---|
| `phase1a3b-upgrade` | **4/4**, 0 diferencias | 1.208 |
| `phase1a3b-startup-seed` | **4/4**, 0 diferencias | 756 |
| `phase1a3b-startup-upgrade` | **4/4**, 0 diferencias (migración en `openSmartFinDatabase` al arrancar) | 954 |
| `phase1a3b-upgrade-restart` | **4/4**, 0 diferencias (sin repetir migración ni duplicar revisiones) | 318 |
| `phase1a3b-migration-atomicity` | **33/33**: 30/30 fallos inyectados, rollback a v4 exacto y recuperación | 22.020 |
| `phase1a3b-integrity` | **Falló** en la sonda `constraints` (3/13 registrados: aislamiento, runtime y el fallo) | — |
| `phase1a3b-flows` y 11 regresiones | No ejecutadas (`run-all` se detiene en el primer fallo) | — |

API 35: **no ejecutada** (la autorización exige que API 24 pase completa). `com.smartfin`: sin cambios en las 6
campañas (`production-package-unchanged.json`). Guards: `verify` sin cambios.

**Diferencia encontrada (real, de motor):** la sonda inserta `amount_cents = '100'` (texto numérico). En SQLite 3.53
(Node) la afinidad `INTEGER` lo convierte en el entero 100 antes del `CHECK typeof(...) = 'integer'` y se acepta; en
SQLite 3.9.2 (API 24) el `CHECK` se evalúa sobre el texto y se **rechaza** (`CHECK constraint failed:
installment_allocations`, octava violación del logcat, que corresponde a `amount.numericText`). La sonda exigía la
aceptación de Node y se detuvo en el dispositivo (`Valid rows accepted`).

Impacto: ninguno en producción. El repositorio valida que los centavos sean números enteros seguros antes de escribir y
la migración solo envía números o `NULL`; en 3.9.2 el comportamiento es **más estricto**. Las escrituras numéricas
enteras sí pasan el `CHECK` en 3.9.2, como prueban las revisiones 0 de `upgrade`, `startup-upgrade` y la recuperación
tras los 30 fallos. Las otras 9 sondas de integridad (triggers, FK compuesta, guardas, borrado financiero…) no llegaron a
ejecutarse en esta ronda.

**Decisión pendiente** (no se ha modificado ninguna aserción ni oráculo): cómo tratar este caso en una r3.

## 14. r3 (2 nov 2026, autorizada) — detenida en `phase1a3b-integrity`; diagnóstico corregido

### Diagnóstico de r2 y corrección del arnés

- Driver: el plugin Android (`SQLitePlugin.bindArgsToStatement`) enlaza en escrituras las cadenas JS con `bindString`
  (TEXT), los números enteros con `bindLong` y los demás con `bindDouble`; `node:sqlite` también enlaza `'100'` como
  TEXT. Las consultas `SELECT` del plugin envían todos los parámetros como texto (`rawQuery`). Ambos drivers entregan
  el mismo TEXT en el `INSERT`: la diferencia de `'100'` es del motor.
- Cambio de la sonda `constraints` (r3): `'100'` se prueba en un ámbito compartido que siempre se revierte; solo son
  seguros el rechazo por `CHECK` sin fila o el entero exacto 100 (`classifyNumericTextInsert`; cualquier otro
  resultado falla y una prueba Node lo comprueba con 8 casos inseguros). Se compara el criterio común
  (`numericText: {input:'100', criterion:'rejectedOrExactInteger', safe:true}`); el resultado observado y una
  demostración de afinidad sobre tablas sintéticas (`engineObserved`) se guardan sin comparar, solo en esta sonda. Se
  añaden el entero 100 almacenado exactamente y la ausencia de importes no enteros.
- Campos del oráculo Node que cambian (9, todos en `integrity.constraints`): `outcomes['amount.numericText']` →
  `outcomes['amount.integer']`, `numericTextStoredAs` → `integerStored`, nuevos `nonIntegerAmountsStored`,
  `numericText` y `engineObserved`, y la fila de imputación de la observación (`amount-numeric-text` →
  `amount-integer`, mismo importe entero 100). Node observa `acceptedExactInteger`; afinidad en 3.53: el `CHECK`
  ve el valor ya convertido (`check_text` rechaza).
- Node r3: Jest 1.252/1.252 (14 omitidas), reproducciones 29/29, tsc y ESLint sin errores, `git diff --check` limpio;
  oráculos históricos sin cambios.

**APK r3** ([`r3/authorization/apk-identity.json`](r3/authorization/apk-identity.json)): SHA-256
`c46c22943cfdc5857ad95c0d720fcbd3a42ce8c1979cad2f1b6dc1d1d6b36369`, 33.575.656 bytes; atestación
`33cd4e3f7f5ba284452d8a99ee46431b69988030d7709bbfbd6ef9a9f3dfb13c` embebida; r3 difiere de r2 solo en el arnés, la
sonda y la referencia Node; rechaza las atestaciones y APK de r1 y r2.

### API 24 r3 (SQLite 3.9.2)

| Campaña | Resultado |
|---|---|
| `phase1a3b-upgrade`, `-startup-seed`, `-startup-upgrade`, `-upgrade-restart` | 4/4 cada una; 1.208 + 756 + 954 + 318 campos, 0 diferencias |
| `phase1a3b-migration-atomicity` | 33/33; 30/30 fallos; 22.020 campos, 0 diferencias |
| `phase1a3b-integrity` | **Falló** en `constraints` (`Valid rows accepted`) |
| Resto y API 35 | No ejecutados |

`com.smartfin` sin cambios en las 6 campañas; guards intactos.

### Causa real (corrige el diagnóstico de r2)

Emparejando cada intento con su error en el logcat del dispositivo:

1. Importes: 5 `CHECK`, `NOT NULL`, `CHECK`; el entero 100 se acepta; los demás casos de imputación fallan como en Node.
2. El **primer** intento de revisión, `revision.impossibleDate` (`effective_cycle_end = '2026-02-30'`), **no registra
   error: SQLite 3.9.2 lo acepta**. Desde ahí, los 12 intentos siguientes con `revision_number = 1` (incluida la
   fila válida) se rechazan *correctamente* por el trigger de secuencia, porque ya existe la revisión 1. El trigger no
   falla; entró antes una fila que Node rechaza.
3. De los dos intentos inválidos en `installment_first_cycles` solo se rechaza uno (`source` inválido): `cycle_end =
   '2026-02-29'` (2026 no es bisiesto) también se acepta.

Conclusión: en SQLite 3.9.2 el `CHECK(length(x) = 10 AND date(x) IS x)` de la migración 5 **no rechaza fechas civiles
imposibles** (29–31 de un mes que no las tiene); en 3.53 sí. En r2 la fila de texto `'100'` también se rechazó (era la
octava violación), pero la causa del fallo de la sonda fue esta misma fila de fecha: el diagnóstico de r2 estaba
incompleto.

Impacto: los repositorios de producción validan las fechas con `parseCivilDate` (estricto) antes de escribir
(`requireCivilDate`), y la migración 5 no escribe fechas; ningún flujo actual de la app puede guardar una fecha
imposible. Lo que no se cumple en API 24 es la **garantía de base de datos** (defensa en profundidad) para
`installment_plan_revisions.effective_cycle_end` e `installment_first_cycles.cycle_end`. No afecta a importes,
saldos ni movimientos.

### Decisión pendiente (fuera de la autorización r3)

Corregirlo exige cambiar los `CHECK` de la migración 5 (aún no publicada), lo que la autorización excluye. Opciones:

- A (recomendada): sustituir `date(x) IS x` por una expresión portable verificada antes en 3.9.2, por ejemplo
  `x GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(x, '+0 days') IS x`, con una campaña diagnóstica
  previa en el emulador que mida el comportamiento de `date()` con y sin modificadores.
- B: aceptar que en API 24 la validez de la fecha la garantiza solo la capa JS, documentarlo y hacer la sonda
  dependiente del motor para fechas imposibles.

En cualquier caso, la sonda debe aislar cada intento inválido de revisión (ámbito revertido) para que una aceptación
inesperada no se propague a los siguientes casos.

## 15. Corrección de fechas y preparación de r4 (2 nov 2026; sin compilar ni ejecutar)

### Causa raíz

La restricción anterior de la migración 5 era `CHECK(length(x) = 10 AND date(x) IS x)`. En SQLite 3.9.2 `date()`
devuelve sin cambios una fecha con día 29–31 en un mes que no lo tiene, así que la comparación era verdadera y la fila
se aceptaba (r3: `effective_cycle_end = '2026-02-30'` y `cycle_end = '2026-02-29'` aceptadas, sin error en logcat). En
SQLite 3.53 (Node) la misma función no devuelve el texto original y el `CHECK` rechaza; la prueba
`civilDateCheckPhase1a3B` lo reproduce en Node y deja documentado el resultado opuesto observado en Android. No hay
binario 3.9.2 local y no se ejecutó ninguna sonda adicional en el emulador: la verificación en 3.9.2 queda para r4.

### Nueva expresión (`CIVIL_DATE_CHECK`)

```sql
(CASE WHEN typeof(x) = 'text' AND length(x) = 10
    AND x GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND CAST(substr(x,1,4) AS INTEGER) >= 1 AND CAST(substr(x,6,2) AS INTEGER) BETWEEN 1 AND 12
    AND CAST(substr(x,9,2) AS INTEGER) BETWEEN 1 AND (CASE CAST(substr(x,6,2) AS INTEGER)
      WHEN 2 THEN (CASE WHEN (y % 4 = 0 AND y % 100 <> 0) OR y % 400 = 0 THEN 29 ELSE 28 END)
      WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END)
  THEN 1 ELSE 0 END) = 1          -- y = CAST(substr(x,1,4) AS INTEGER)
```

- Solo `typeof`, `length`, `GLOB` (clases de caracteres), `substr`, `CAST`, `CASE` y aritmética entera: presentes y
  con el mismo comportamiento en 3.9.2 y en versiones posteriores. Sin funciones de fecha.
- `GLOB` garantiza dígitos ASCII antes de cada `CAST`, por lo que las conversiones son exactas.
- El `CASE` devuelve 1 o 0, nunca `NULL` (un `CHECK` con resultado `NULL` se considera aprobado). Los valores no
  textuales no pasan: en 3.9.2 el `CHECK` ve el entero y en 3.53 la afinidad lo convierte en un texto de 8 caracteres.
- Columnas: `effective_cycle_end TEXT CHECK(effective_cycle_end IS NULL OR (…))` (se mantiene el `NULL` para
  `pendingVerification` y los contratos `confirmed`/`projected`/`estimated`) y `cycle_end TEXT NOT NULL CHECK(…)`.
  Ningún otro campo de la migración 5 usaba `date()` (los `created_at`, `updated_at` y `reversed_at` no tienen
  `CHECK` de formato) y ningún trigger depende de fechas.
- Distribución: archivos de la migración 5 sin commit; solo los paquetes sintéticos la ejecutaron;
  `com.smartfin` (HONOR) actualizada el 11 oct 2026, antes de existir la migración 5. Se corrigió la definición;
  migraciones 1–4 intactas.

### Aislamiento de los intentos inválidos

`isolated()` ejecuta cada intento esperado como inválido en un ámbito compartido que siempre se revierte, partiendo
del estado actual. Registra la clase del resultado y comprueba que todas las tablas (filas, `rowid`, contador de
respaldo) quedan idénticas. Una aceptación inesperada aparece como `accepted` en su propio caso y no altera la
numeración de revisiones de los siguientes. Se aplica a las sondas `constraints`, `revisionSequence` y `allocations`.

### Pruebas

| Prueba | Resultado |
|---|---|
| `civilDateCheckPhase1a3B` (5 pruebas) | Barrido de 7.392 fechas (16 años, incl. 0, 1, 100, 400, 1900, 2000, 2100, 2400, 9999; meses 0–13; días 0–32) y 17 cadenas mal formadas: aceptación idéntica a `parseCivilDate`; casos límite; `NULL` permitido/prohibido; `INSERT` y `UPDATE` directos; sin `date()` en el esquema; reproducción r3 en Node |
| `phase1a3bAndroidEquivalence` | 6/6, determinista, igual a la referencia regenerada |
| Sonda `constraints` (Node) | 27 fechas × 3 caminos (revisión, primer ciclo insert y update), todas iguales a `parseCivilDate`; `NULL`: original pendiente sin ciclo aceptada, confirmada sin ciclo rechazada, primer ciclo nulo `notNull` |
| `installmentHistoryPhase1a3B` | 49/49 (migración v4→v5, 30 fallos con rollback, repetición, reinicio) |
| `npm test -- --runInBand` | 86 suites aprobadas y 7 omitidas; 1.257 pruebas aprobadas, 14 omitidas, 0 fallos; 8/8 snapshots (`subscriptionAtomicityPhase4` aprobada) |
| `npm run test:reproductions` | 29/29 |
| `tsc`, ESLint, `git diff --check` | Sin errores; las 5 advertencias previas; limpio |

### Cambios del oráculo Node (todos causados por la corrección)

- 64 campos: el texto SQL de `installment_plan_revisions` e `installment_first_cycles` en las listas de esquema
  (`upgrade.schema`, `startup.upgrade.schema` y el esquema recuperado de los 30 puntos de atomicidad).
- `integrity.constraints`: nuevos `civilDates` y `nulls`, y en la observación la fila de primer ciclo usada para los
  `UPDATE` (`installment-M2`, `2026-10-20`) y, por su trigger de respaldo, `observation.financial.backupRevision`
  20 → 21 (contador, no un importe; omitido en la primera redacción y verificado antes de r4). Los resultados de los
  casos existentes no cambian.
- Oráculos históricos de 1a.3A, 1a.2 y 6B.3 sin cambios.

### r4 preparada

| Campo | Valor |
|---|---|
| Workspace | `C:/sf-1a3b-r4-20261102` (desde `C:/sf-1a3a-20261102`) |
| Atestación | `540c2c7b79e2386da867c10b2195fa1d8ef1e5dd8e4ea80c1d80f1bd9a7d4cd1` (`phase: '1a.3B r4'`), idéntica a la embebida |
| Diferencia con r3 | Solo `installmentHistorySchema.ts` (producción), `phase1a3bProbes.ts` y la referencia Node |
| Inventario | [`r4/authorization/inputs.sha256.json`](r4/authorization/inputs.sha256.json); `verify`: `protectedFilesUnchanged: true`, sin cambios |
| Identidad | `apk-identity.cjs` escribirá `r4/authorization/apk-identity.json` y rechaza las atestaciones y APK de 6B.3, 1a.2, 1a.3A y 1a.3B r1–r3 |
| Runner | `scripts/phase1a3b/run-android.ps1` (r4, 8 líneas de ruta distintas del r3); evidencia en `r4/android/api{24,35}/…`; runners anteriores conservados como `run-android-r{1,2,3}.ps1` |
| Casos por dispositivo | 66 nuevos + 223 regresiones = 289; 170 puntos de fallo |

Evidencias, APK, workspaces y atestaciones de r1, r2 y r3 conservados sin cambios.

### Comandos (requieren autorización específica para r4)

```bash
node scripts/phase1a3b/authorization-inventory.cjs verify
```

En `C:/sf-1a3b-r4-20261102/android`:

```bash
./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'
```

```bash
node scripts/phase1a3b/apk-identity.cjs
```

```bash
./scripts/phase1a3b/run-all.ps1 -Serial emulator-5554 -Api 24
```

```bash
./scripts/phase1a3b/run-all.ps1 -Serial AXCC6R3919012932 -Api 35
```

### Riesgos

- La nueva expresión está probada exhaustivamente en Node, pero en SQLite 3.9.2 solo se verificará en r4 (sonda
  `constraints`, 27 fechas × 3 caminos).
- `isolated()` depende de que un error de sentencia dentro del ámbito compartido no cierre la transacción en el driver
  Android (el JS del plugin no emite `ROLLBACK` en `executeSql`); si no fuera así, el caso falla explícitamente
  (`unknown` o estado distinto), nunca en silencio.
- Siguen sin evidencia de dispositivo: las otras 9 sondas de integridad, los flujos v4/v5, las 223 regresiones y API 35.

## 16. Ejecución r4 (2 nov 2026, autorizada) — detenida en `phase1a3b-integrity`

Verificaciones previas: inventario r4 y guards intactos; workspace y checkout iguales a la atestación `540c2c7b…`
(0 diferencias, embebida idéntica); APK r1–r3 iguales a sus identidades; oráculos históricos sin cambios; el oráculo
1a.3B difiere del de r3 en los 64 campos de texto SQL documentados más `integrity.constraints` (`civilDates`, `nulls`, la
fila de primer ciclo y su efecto en el contador de respaldo, 20 → 21, añadido a la sección 15). Emulador
`SmartFin_Guard_Synthetic_API24` (API 24). **El HONOR `AXCC6R3919012932` no estaba conectado** (`adb devices`).

**APK r4** ([`r4/authorization/apk-identity.json`](r4/authorization/apk-identity.json), `r4/android-build.log`, 2 min 56 s):
SHA-256 `3d1bfb2202d1da03ee9b12adcdfc556543144c77020dda2e00d1f95429ccaa1a`, 33.584.696 bytes; atestación `540c2c7b…`
embebida; Hermes con el `CHECK` portable (2 `GLOB`), `isolated()` y sin `date(effective_cycle_end)`; paquete sintético no
depurable; rechaza atestaciones y APK de r1–r3.

### API 24 (SQLite 3.9.2) — [`r4/android/api24/`](r4/android/api24/)

| Campaña | Resultado |
|---|---|
| `phase1a3b-upgrade`, `-startup-seed`, `-startup-upgrade`, `-upgrade-restart` | 4/4 cada una, 0 diferencias |
| `phase1a3b-migration-atomicity` | 33/33, 30/30 fallos, 0 diferencias |
| `phase1a3b-integrity` | **Falló** en `constraints`: `Integer 100 stored exactly` |
| Resto y API 35 | No ejecutados |

`com.smartfin` sin cambios en las 6 campañas; guards intactos.

### Qué sí quedó demostrado en SQLite 3.9.2

La comprobación que falló está **después** de todos los intentos inválidos aislados y de la comprobación de sus
resultados, que pasó. El logcat del dispositivo muestra, en orden: 5 `CHECK` + `NOT NULL` + 2 `CHECK` (importes y modo),
2 `RAISE` de estado, 2 `CHECK`, **12 `CHECK` en `installment_plan_revisions`** (incluido `effective_cycle_end =
'2026-02-30'`; ya ninguna violación de secuencia en cascada), 1 `CHECK` de política y **2 `CHECK` en
`installment_first_cycles`** (origen inválido y `cycle_end = '2026-02-29'`). Por tanto, en 3.9.2:

- el nuevo `CHECK` rechaza `2026-02-30` y `2026-02-29` (en r3 se aceptaban);
- `isolated()` funciona en el driver Android: cada intento con error de sentencia se revierte con estado idéntico (si
  no, la sonda habría fallado antes con `Isolated attempt not rolled back` o `left changes`);
- el entero 100 y la revisión válida se aceptan.

El barrido de 27 fechas × 3 caminos y las comprobaciones de `NULL` están **después** del punto de fallo y no se
ejecutaron en el dispositivo; tampoco `2028-02-29`, `2026-04-31` ni las actualizaciones directas.

### Causa del fallo: aserción de la sonda sensible al orden de claves

`check(json(integerStored) === json([{ type: 'integer', amount_cents: 100 }]))` compara con `JSON.stringify` una fila
devuelta por el driver con un literal. El plugin Android construye cada fila con `Arguments.createMap()`
(`SQLitePlugin.executeSqlStatementQuery` → `bindRow`), un mapa nativo de React Native cuyo orden de claves al llegar a
JS no está garantizado. Node conserva el orden de las columnas. El valor no puede ser otro: la fila se insertó con
`bindLong`, el `CHECK typeof(amount_cents) = 'integer'` la aceptó y la comprobación de resultados (que exige `accepted`)
pasó. Es la **única** comparación de una fila del driver con un literal en `probes.ts`; las demás comparan listas de
valores, y las comparaciones fila a fila Android–Android (rollback, aislamiento) pasaron en 30 + 40 casos.

No es una diferencia financiera ni de esquema. No se modificó ninguna aserción durante la ejecución.

### Corrección propuesta (requiere autorización para r5)

Sustituir esa aserción por una comparación por campos (`rows.length === 1 && type === 'integer' && amount_cents ===
100`) y registrar la fila en la evidencia; no cambia el oráculo Node (la fila sigue igual) ni ningún criterio. Exige un
APK y un workspace nuevos (r5), y el HONOR conectado para API 35.

## 17. Ronda r5 (2 nov 2026, autorizada) — aprobada en API 24 y API 35

### Causa del fallo de r4 y corrección

La sonda `constraints` comparaba con `JSON.stringify` la fila devuelta por el driver con un literal. El plugin Android
entrega cada fila como un mapa nativo cuyo orden de claves no sigue el de las columnas. r5 lo confirma en el propio
dispositivo: la evidencia de afinidad registra `{"x":100,"type":"integer"}` en SQLite 3.9.2 y 3.44.5, frente a
`{"type":"integer","x":100}` en Node. La evidencia r4 no contenía la fila (el fallo ocurrió antes de devolverla).

```ts
// Antes (r4)
check(json(integerStored) === json([{ type: 'integer', amount_cents: 100 }]), 'Integer 100 stored exactly');
// Después (r5)
const allocationRows = await query(database, 'SELECT count(*) AS total FROM installment_allocations');
check(integerStored.length === 1 && integerStored[0]!.type === 'integer' && integerStored[0]!.amount_cents === 100
  && Number(allocationRows[0]?.total) === 1,
'Integer 100 stored exactly: ' + json({ integerStored, allocationRows }));
```

Una sola fila; `typeof` igual a `integer`; valor `=== 100` (sin redondeo ni conversión); ninguna otra imputación en la
tabla, porque todos los intentos inválidos están aislados. La fila sigue en el resultado comparado con Node (claves
ordenadas por el arnés), así que el oráculo no cambia. Producción, migración 5, triggers, arnés y oráculos no cambian.

### Auditoría preventiva de `probes.ts` y del arnés

| Riesgo | Resultado |
|---|---|
| Fila del driver comparada con un literal mediante serialización | Solo la de la línea corregida |
| Comparación Node–Android | `androidHarness.js` ordena las claves y conserva el orden de los arrays: el orden de revisiones, movimientos y filas sigue comprobándose |
| `json(a) === json(b)` entre valores del mismo driver (rollback, aislamiento, reinicio, migración repetida) | Misma consulta y mismo conjunto de claves en el mismo dispositivo. Una igualdad de cadenas no puede ocultar una diferencia; solo podría fallar en falso. Se conservan sin cambios |
| `canonical()` (renombrado M/P por primera aparición) | Ninguna fila contiene dos ids distintos del mismo tipo, así que el orden de claves no altera la numeración |
| Ids y relojes | Ids renombrados; reloj JS fijado; valores del reloj SQLite normalizados o comparados dentro del mismo dispositivo |
| `ORDER BY` | Todas las listas comparadas lo tienen. Las consultas sin `ORDER BY` devuelven una fila, un conteo o evidencia no comparada (`affinity`) |
| Efectos entre intentos inválidos | Aislados con `isolated()` (r4). En `activeAllocationGuards` los intentos bloqueados se validan juntos con el estado completo: un fallo sería explícito, aunque menos específico |
| Fallos encadenados | Las comprobaciones son secuenciales. Un fallo detiene la sonda con su propio mensaje y no se convierte en otro |

Prueba nueva en `phase1a3bAndroidEquivalence`: todas las campañas se ejecutan con las claves de cada fila invertidas y
ordenadas alfabéticamente (opción `rowKeyOrder` del adaptador `realSQLite`; sin ella no cambia nada). El resultado es
idéntico al de referencia. Con la aserción de r4 restaurada temporalmente, la prueba reproduce en Node el fallo
`Integer 100 stored exactly`. No se encontró otro defecto que exigiera cambiar aserciones.

### Node

| Prueba | Resultado |
|---|---|
| `phase1a3bAndroidEquivalence` | 7/7, incluida la prueba de orden de claves |
| `installmentHistoryPhase1a3B` y `civilDateCheckPhase1a3B` | 49/49 y 5/5 |
| `npm test -- --runInBand` | 86 suites aprobadas y 7 omitidas; 1.258 pruebas aprobadas, 14 omitidas, 0 fallos; 8/8 snapshots |
| `npm run test:reproductions` | 29/29 |
| `tsc`, ESLint, `git diff --check` | Sin errores; las 5 advertencias previas; limpio |

Oráculos: la referencia 1a.3B y los oráculos de 1a.3A, 1a.2 y 6B.3 tienen el mismo hash que en el inventario r4. No hay
ningún cambio de campos respecto a r4: el contador de respaldo sigue en 21 en `integrity.constraints` (sección 15).

### Preparación

| Campo | Valor |
|---|---|
| Workspace | `C:/sf-1a3b-r5-20261102`; respecto al de r4 solo difieren `phase1a3bProbes.ts` (la aserción) y la atestación |
| Atestación | `5ef8befd07803cf59505e7afc05cefa7f1b8ddf220beaff528e06fe2d1882433` (`phase: '1a.3B r5'`), idéntica a la embebida |
| Inventario | [`r5/authorization/inputs.sha256.json`](r5/authorization/inputs.sha256.json); `verify` final: `protectedFilesUnchanged: true`, sin cambios ni archivos añadidos |
| Runner | `run-android.ps1` (r5, 8 líneas de ruta distintas del r4); los de r1–r4 se conservan como `run-android-r{1..4}.ps1` y `run-all-r{1..4}.ps1` |

**APK r5** ([`r5/authorization/apk-identity.json`](r5/authorization/apk-identity.json), `r5/android-build.log`, 3 min 1 s):
SHA-256 `ec3f10125d95aca751e15e411e58b8a557b8a334b172af07c84b2c79ada2039a`, 33.584.940 bytes, release no depurable,
`com.smartfin.snapshot5b2.tests`. Bundle Hermes (cabecera `c6 1f bc 03`) con el nuevo mensaje y la consulta de conteo;
las mismas expresiones `GLOB` de fecha que en r4 y ninguna `date(effective_cycle_end`. Rechaza las atestaciones y APK de
6B.3, 1a.2, 1a.3A y 1a.3B r1–r4.

### Resultados

| Dispositivo | SQLite | 1a.3B (66) | Regresiones (223) | Total | Campos 1a.3B frente a Node |
|---|---|---|---|---|---|
| `emulator-5554`, API 24 ([`r5/android/api24/`](r5/android/api24/)) | 3.9.2 | 66/66 | 223/223 | **289/289** | 28.564, 0 diferencias |
| `AXCC6R3919012932`, API 35 ([`r5/android/api35/`](r5/android/api35/)) | 3.44.5 | 66/66 | 223/223 | **289/289** | 28.564, 0 diferencias |

Por campaña, en ambos dispositivos:
- `upgrade`, `startup-seed`, `startup-upgrade` y `upgrade-restart`: 4/4 cada una;
- `migration-atomicity`: 33/33;
- `integrity`: 13/13, las 10 sondas;
- `flows`: 4/4.

Regresiones con sus totales anteriores: 11, 37, 3, 4, 66, 53, 13, 12, 3, 3 y 18. Puntos de fallo: 30 de la migración 5 más
140 de regresión = **170** por dispositivo, todos con rollback confirmado y ningún resultado `unknown`.

Las restricciones y triggers funcionan igual que en Node en ambos motores, campo a campo:
- las 27 fechas por los tres caminos (inserción de revisión, e inserción y actualización de primer ciclo), con bisiestos aceptados (`2024-02-29`, `2000-02-29`, `2400-02-29`), no bisiestos rechazados (`1900-02-29`, `2100-02-29`, `2026-02-29`), `2026-02-30`, `2026-04-31` y `0000-01-01`. (Una nota de r4 citaba `2028-02-29`, pero ese caso no está en la lista de la sonda);
- las reglas de `NULL`;
- el entero 100;
- la FK compuesta;
- las guardas de imputaciones y los triggers de historial (`purchaseEdit` y `purchaseRemoval`);
- la recreación de compras;
- el borrado financiero;
- la idempotencia;
- los flujos v4/v5, con las mismas escrituras y la misma contabilidad.

No hay revisiones ni pagos duplicados. Solo se registra, sin compararla, una diferencia propia del motor con el texto
numérico `'100'`: 3.9.2 lo rechaza con `CHECK` y 3.44.5 lo guarda como INTEGER 100. Ambos resultados son seguros.

`com.smartfin` no cambió en las 36 ejecuciones: misma `lastUpdateTime=2026-10-11 16:27:48` en el HONOR. Solo se
borraron datos del paquete sintético.

Evidencias, APK, workspaces y atestaciones de r1–r4 se conservan sin cambios (hash idéntico antes y después de r5).
Nota: al iniciar r5 se ejecutó una vez `verify` con el script todavía apuntando a r4, y reescribió
`r4/authorization/integrity-after.json` con el mismo resultado (`protectedFilesUnchanged: true`, sin cambios ni
archivos añadidos).
