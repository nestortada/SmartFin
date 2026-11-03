# Validación Android 1a.4A (preparada, no ejecutada)

2 de noviembre de 2026, America/Bogota. Estado: **campañas, oráculo Node, scripts, inventario, workspace sintético y
atestación preparados**. No se ha compilado el APK ni se ha instalado o ejecutado nada en dispositivos: requiere
autorización específica. El APK y la evidencia de 1a.3B (`validacion-fase1a3b/r5`, 289/289) **no** validan este código.

## 1. Qué cambia en dispositivo

Una única escritura nueva: `INSERT INTO installment_plan_revisions` (revisión 0) cuando `saveTransactionInstallments`
crea la fila del plan (alta o recreación tras `purchaseRemoval`), en el mismo participante e inmediatamente después del
`INSERT INTO installment_purchases`. Lecturas nuevas (no son puntos de fallo: el gancho `__deletionFault` cuenta solo
`INSERT/UPDATE/DELETE/REPLACE`): última revisión, tarjetas, reglas de facturación y primer ciclo confirmado.

Escrituras por paso, mismo flujo con y sin el paso de revisión 0 (Node, `phase1a4aAndroidEquivalence`):

| Paso | Antes | 1a.4A | Diferencia |
|---|---|---|---|
| Alta a 3 cuotas | 6 | 7 | +1 |
| Solo descripción (×2) | 6 | 6 | 0 |
| 3 → 6 cuotas (`purchaseEdit` por trigger) | 6 | 6 | 0 |
| A 1 cuota (`purchaseRemoval` por trigger) | 6 | 6 | 0 |
| Recreación a 4 cuotas | 6 | 7 | +1 |
| A débito | 8 | 8 | 0 |
| De vuelta a crédito, 2 cuotas | 8 | 9 | +1 |
| Acción rápida sin cambio / a 1 / a 3 cuotas | 6 / 6 / 6 | 6 / 6 / 7 | 0 / 0 / +1 |
| Borrar la compra | 22 | 22 | 0 |

Tras cada paso, cuentas, cupo, dashboard, movimientos, planes y extractos son idénticos; la diferencia del contador de
respaldo es exactamente el número de filas de historial.

## 2. Separación de responsabilidades en Node

| Suite | Objetivo | Referencia |
|---|---|---|
| `phase1a3aAndroidEquivalence`, `phase1a3bAndroidEquivalence` | **Reproducibilidad histórica**: con el único paso de 1a.4A neutralizado (`jest.mock` de `recordInitialInstallmentRevision`), el código actual reproduce exactamente las referencias aprobadas. Aserciones intactas; ya no pueden reescribir la referencia | `validacion-fase1a3a/node/results.json`, `validacion-fase1a3b/node/results.json` (solo lectura, hashes del inventario r5) |
| `phase1a4aAndroidEquivalence` | **Código actual**: campañas 1a.4A, 1a.3A (sondas sin cambios) y 1a.3B (sondas derivadas), determinismo, orden de claves, comparación antes/después y comparadores de diferencias aprobadas contra las referencias históricas | `validacion-fase1a4a/node/results.json` (nueva) |

Comparadores contra las referencias históricas (solo lectura):

- 1a.3A: solo cambian `revision`/`revisionDelta` (contador de respaldo), +1 o +2; matrices 6 y 10, verbos, 32 puntos y
  `unknown` iguales.
- 1a.3B upgrade, arranque y flujos: solo `backupRevision`; las 30 fallas de migración idénticas.
- 1a.3B integridad: solo `verification`/`pending_reasons`/`effective_cycle_end` de las dos revisiones 0 preparadas
  (`pendingVerification` a mano → `projected` por el caso de uso); ningún importe, extracto ni clase de error cambia.
  `purchaseRecreation` cambia de escenario (ver sección 3) y conserva el rechazo de una revisión no original tras una
  eliminación.

## 3. Sondas 1a.3B derivadas

`scripts/phase1a4a/derive-probes.cjs` exige el hash r5 de `scripts/phase1a3b/probes.ts` (`6182dd98…`) y escribe
`scripts/phase1a4a/phase1a3bProbes.ts` con dos sustituciones exactas:

1. Preparación de integridad: ya no añade a mano la revisión 0 (el repositorio rechaza una segunda `original`); comprueba
   la creada por el caso de uso (`projected`, ciclo 2026-10-20, centavos y reloj exactos).
2. `purchaseRecreation`: la recreación por el caso de uso abre la encarnación nueva (revisión 2); se prueba además que una
   segunda `original` se rechaza y, sobre una fila recreada fuera del caso de uso, que tras la eliminación solo se admite
   `original` (revisiones 3 y 4).

El original y su referencia no se tocan.

## 4. Campañas por dispositivo

| Campaña | Contenido | Casos | Puntos de fallo |
|---|---|---|---|
| `phase1a4a-creation` | 11 escenarios: exacta, centavos, sin corte, día de corte sin política / `closingCycle` / `nextCycle`, inexacta, cuotas de $0, 400 cuotas, primer ciclo confirmado, segunda `original` rechazada y caso de uso repetido sin escrituras | 14 | — |
| `phase1a4a-lifecycle` | 12 pasos con su número de escrituras e historial | 4 | — |
| `phase1a4a-compatibility` | Compra migrada de v4, compra nueva y plan sin historial de la versión intermedia (listado para inicialización perezosa) | 4 | — |
| `phase1a4a-invariants` | Dinero exacto (BigInt) tras cada uno de 9 pasos, sin imputaciones, `paid_installments` intacto | 4 | — |
| `phase1a4a-atomicity` | Alta y recreación: 2 éxitos + 7 × 2 + 7 × 2 | 33 | **28** |
| `phase1a4a-unknown` | `COMMIT` perdido en el alta: `unknown`, sin reintento, conexión retirada | 3 | — |
| `phase1a4a-unknown-restart` (`PreserveData`) | Una compra con exactamente una revisión 0 y dinero exacto | 4 | — |
| **Nuevas** | | **66** | **28** |
| 1a.3B con referencia 1a.4A (sondas derivadas) | upgrade 4, startup ×3 12, migration-atomicity 33, integrity 13, flows 4 | 66 | 30 |
| 1a.3A con referencia 1a.4A (sondas sin cambios) | identity 11, atomicity 37, unknown 3, unknown-restart 4 | 55 | 32 |
| 1a.2, 6B.3, 6A (oráculos sin cambios) | statements 13, atomicity-historical 53, probes 12, atomicity 66, unknown 3, unknown-restart 3, precision 18 | 168 | 108 |
| **Total** | | **355** | **198** |

Puntos de fallo por dispositivo: 170 anteriores + 28 nuevos = **198** (ninguno se oculta para mantener el 170).

## 5. Oráculo Node

`npx jest __tests__/phase1a4aAndroidEquivalence.test.ts`: 14/14; dos ejecuciones completas idénticas, iguales a
`node/results.json` y robustas a dos órdenes de claves distintos. Generada con `SMARTFIN_WRITE_EVIDENCE=1` solo para esta
suite; las referencias históricas conservan sus hashes r5 (`19b01c30…` 1a.3A, `c0854ea8…` 1a.3B).

## 6. Scripts preparados (`scripts/phase1a4a/`)

| Script | Función |
|---|---|
| `probes.ts`, `androidHarness.js` | Sondas y arnés de las 7 campañas nuevas |
| `derive-probes.cjs`, `phase1a3bProbes.ts` | Sondas 1a.3B derivadas (sección 3) |
| `authorization-inventory.cjs` | `capture`/`verify` de hashes de todas las entradas revisadas (`authorization/inputs.sha256.json`) |
| `prepare-android.cjs` | Workspace nuevo desde el r5 verificado (atestación `5ef8befd…`, APK `ec3f1012…`); refresca `src/`, añade el arnés 1a.4A, las sondas derivadas y las tres partes de la referencia 1a.4A; arneses 1a.3A/1a.3B y regresiones byte a byte |
| `make-runner.cjs`, `run-android.ps1` | Runner derivado mecánicamente del r5 (hash `bc0bc353…`): solo cambian workspace, evidencia, identidad, campañas permitidas, reseteo `phase1a4a-` y `PreserveData` de `phase1a4a-unknown-restart` |
| `run-all.ps1` | 25 campañas en orden, solo para `emulator-5554` (API 24) y `AXCC6R3919012932` (API 35) |
| `apk-identity.cjs` | Tras un build autorizado: registra hash del APK y atestación; rechaza los APK y atestaciones anteriores (r5 incluido) |

## 7. Workspace y atestación

| Elemento | Valor |
|---|---|
| Inventario | `authorization/inputs.sha256.json`: 839 entradas, fase `1a.4A`. `verify` previo: `protectedFilesUnchanged: true`, sin cambios ni añadidos (`integrity-after.json` se regenerará tras las campañas) |
| Workspace | `C:/sf-1a4a-20261102`, paquete `com.smartfin.snapshot5b2.tests`, 299 fuentes de producción refrescadas, 384 archivos atestados |
| Atestación | `27dd1ba6db65d41cacd517079fe18f63c4ed589b18ae4cd367ed65581b9d2268`, idéntica en `android/app/src/main/assets/phase5b2-source-fingerprints.json` |
| Base | 1a.3B r5 verificada (atestación `5ef8befd…`, APK `ec3f1012…`) |
| APK | **No compilado** (`android/app/build` no existe); `apk-identity.json` pendiente |
| Dispatcher | `Harness.jsx` añade `phase1a4a-` conservando las campañas anteriores; importaciones del arnés y sondas resueltas en el workspace |

## 8. Procedimiento (requiere autorización)

Desde `C:/Users/nesto/Proyectos/SmartFin`, sin modificar el checkout:

1. `node scripts/phase1a4a/authorization-inventory.cjs verify` (sin cambios ni añadidos protegidos).
2. Build en `C:/sf-1a4a-20261102/android`:
   `./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'`.
3. `node scripts/phase1a4a/apk-identity.cjs`.
4. `./scripts/phase1a4a/run-all.ps1 -Serial emulator-5554 -Api 24` y `-Serial AXCC6R3919012932 -Api 35`.
5. `verify` de nuevo; `com.smartfin` no se toca.

## 9. Ejecución r1 (2 de noviembre de 2026): detenida en `phase1a2-statements`

APK: `C:/sf-1a4a-20261102/android/app/build/outputs/apk/release/app-release.apk`, SHA-256
`825e48ce1da43f313c72b7f5babc8cc771e67ab9546ebf2f39fe92ea1db6fb73`, 33.670.328 bytes, release no depurable,
`com.smartfin.snapshot5b2.tests`, Hermes (`C6 1F BC 03`) con el código de la revisión 0, atestación embebida
`27dd1ba6db65d41cacd517079fe18f63c4ed589b18ae4cd367ed65581b9d2268` ([identidad](authorization/apk-identity.json),
[build](android-build.log)).

API 24 (`emulator-5554`, SQLite 3.9.2), [log](android-api24.log):

| Campañas | Resultado |
|---|---|
| 7 campañas `phase1a4a-*` | 66/66 (creation 14, lifecycle 4, compatibility 4, invariants 4, atomicity 33 con 28 puntos, unknown 3, unknown-restart 4) |
| 7 campañas `phase1a3b-*` (referencia 1a.4A) | 66/66 (30 puntos de migración) |
| 4 campañas `phase1a3a-*` (referencia 1a.4A) | 55/55 (32 puntos) |
| `phase6b3-atomicity`, `phase1a2-atomicity-historical` | 66/66 y 53/53 |
| `phase1a2-statements` | **Fallo en el primer caso** (`sixInstallments`): Android incluye `steps.0.tables.installment_plan_revisions` (revisión 0 `projected`, ciclo 2026-10-20); la referencia histórica de 1a.2 no tiene esa tabla |
| `phase6b3-probes`, `-unknown`, `-unknown-restart`, `phase6a-precision` | No ejecutadas (parada por la instrucción de detenerse ante un fallo) |

API 35 (`AXCC6R3919012932`): no conectado al comprobar `adb devices`; no ejecutado.

Causa: la sonda 1a.2 guarda todas las tablas no vacías salvo las de plataforma. Con 1a.4A la revisión 0 aparece como tabla
nueva en cada paso. Comprobación Node posterior (sin modificar nada): en las 10 sondas 1a.2 la **única** diferencia
frente a `validacion-fase1a2/node/results.json` es la presencia de `installment_plan_revisions`; las 10 sondas 6B.3
son idénticas a su referencia. Error de preparación: la prueba Node de 1a.2 no compara con su referencia (la escribe,
y Jest redirige esa escritura), así que la diferencia no se detectó antes de Android. No es una regresión financiera.

Corrección propuesta (requiere autorización; nueva preparación r2): referencia 1a.4A para `phase1a2-statements`
generada con las mismas sondas sobre el código actual, comparador que solo admita la tabla `installment_plan_revisions`,
nuevo workspace y atestación, APK nuevo y repetición completa en API 24 y API 35. La referencia histórica de 1a.2 no se toca.

Guards: `verify` sin cambios. `com.smartfin`: no instalado en el emulador; `production-package-unchanged.json` registra
`unchanged: true` en cada campaña.

## 10. Preparación r2 (corrección de la referencia de extractos; no ejecutada)

### 10.1 Diagnóstico exacto de r1

`phase1a2-statements` (`sixInstallments`, primer caso) comparó el resultado Android, que incluye
`steps.N.tables.installment_plan_revisions`, con la referencia **histórica** de 1a.2, que no la tiene. La sonda 1a.2
guarda todas las tablas no vacías salvo las de plataforma (`financial_data_revision` incluida entre las excluidas).
La prueba Node de 1a.2 escribía su referencia en `afterAll` sin compararla; la redirección de Fase 0
(`__tests__/setup/redirectEvidenceWrites.js`) protegía el archivo, pero ninguna prueba detectaba la diferencia.

Informe de campos ([r2/node/phase1a2-differences.json](r2/node/phase1a2-differences.json)), las 10 sondas: 0 errores del
comparador. La única diferencia es la tabla `installment_plan_revisions`, presente en 49 pasos: sixInstallments 7,
overlappingPlans 7, paymentInLaterCycle 2, centsAndResidue 11, closingDays293031 10, closingDayPurchase 2,
withoutClosingDay 2, yearChange 3, calendarStates 2, historicalProtection 3. Solo revisiones `original` número 0 con id
`<compra>:revision:0`, capital exacto en centavos, ciclo y verificación iguales al motor 1a.1 para cada plan (corte y
política de la tarjeta, fecha civil del movimiento). Movimientos, extractos, saldos, deuda, planes, dashboard (gastos,
ingresos, patrimonio) e integridad: idénticos. El plan heredado que `calendarStates` inserta por SQL
(`installment-legacy-inexact`) sigue sin historial. El contador de respaldo no forma parte de esta sonda; su
correspondencia exacta con las filas de historial se prueba en la comparación antes/después de `phase1a4a-lifecycle`.

### 10.2 Separación histórica / actual

| Comprobación | Suite | Referencia |
|---|---|---|
| A. Reproducibilidad histórica | `phase1a2StatementsProbes` neutraliza solo `recordInitialInstallmentRevision` (`jest.mock`, entorno de prueba) y **compara** con la referencia; ya no la escribe y rechaza `SMARTFIN_WRITE_EVIDENCE=1` | `validacion-fase1a2/node/results.json` (`8e58ada7…`, sin cambios) |
| B. Comportamiento actual | `phase1a4aAndroidEquivalence` ejecuta las 10 sondas con la revisión 0 activa y el APK compara el resultado **completo** (revisiones incluidas) | `validacion-fase1a4a/r2/node/results.json` (parte `phase1a2`) |

Comparador `compare1a2` (frente a la referencia histórica): todo lo que está fuera de las tablas de cada paso, igual;
dentro, todas las tablas salvo `installment_plan_revisions`, iguales; esa tabla debe contener, por plan, numeración
contigua desde 0, ids deterministas, ninguna `original` duplicada en una encarnación, ningún historial huérfano ni
inventado, y la revisión 0 vigente igual campo a campo al resultado de `buildInitialInstallmentRevision`. Prueba negativa
sobre copias sintéticas (11 mutaciones: saldo +0,01, total de extracto, importe de movimiento, revisión eliminada,
`original` duplicada, capital −1 centavo, verificación cambiada, primer ciclo movido, tabla desconocida, historial
inventado para el plan heredado, cifra del dashboard): todas producen error.

### 10.3 Responsabilidad de las referencias

- Las pruebas ordinarias leen y comparan; un resultado distinto falla.
- Regeneración explícita: `SMARTFIN_WRITE_EVIDENCE=1` en `phase1a4aAndroidEquivalence`, que solo escribe
  `r2/node/results.json` y `phase1a2-differences.json` y **se niega a sobrescribir** un archivo existente.
- Las suites históricas de 1a.2, 1a.3A y 1a.3B lanzan error si se pide regenerar su referencia.
- Comprobado: el intento con la referencia r2 existente falla sin modificarla; el de 1a.2 falla con
  «The 1a.2 Node reference is historical evidence»; dos ejecuciones completas de Jest dejan intactos los 9.529 archivos
  `.json`/`.log` de `docs/`.

Auditoría de suites que escriben evidencias sin compararlas (todas redirigidas por Fase 0, ninguna modificó `docs/`):

| Suite | Referencia leída por el APK 1a.4A | Acción |
|---|---|---|
| `phase1a2StatementsProbes` | Sí (`phase1a2-statements`) | Corregida (10.2) |
| `creditCardSettlementPhase6B3` | Sí (`phase6b3-probes`) | Sin cambiar el arnés: `phase1a4aAndroidEquivalence` exige ahora igualdad exacta de las 10 sondas 6B.3 (anterior y actual) con `correccion-fase6b3/node/results.json` — iguales |
| `phase6a-precision` | No (oráculo independiente en el dispositivo) | Ninguna |
| `financialAtomicityPhase4/5E`, `financialDeletionPhase5C`, `financialAuditPhase6B`, `financialCorrectionPhase6B1`, `dashboard*`, `transactionHistory*`, `subscription*`, `backupRecoverabilityPhase5E5`, `creditCardReconciliationEquivalence`, `phase6b3Reproduction` | No | Fuera de alcance; documentado, sin cambios |

### 10.4 Cobertura r2

Mismas 25 campañas, 355 casos y 198 puntos de fallo por dispositivo que r1. Orden de escrituras y puntos sin cambios:
las partes `phase1a4a`, `phase1a3a` y `phase1a3b` de la referencia r2 son idénticas a la r1 (prueba
«r2 keeps every r1 part identical»). Solo cambia el oráculo de `phase1a2-statements` (13 casos, 0 puntos de fallo).

### 10.5 Workspace y atestación r2

| Elemento | Valor |
|---|---|
| Inventario | `r2/authorization/inputs.sha256.json`: 848 entradas, fase `1a.4A r2`; `verify`: sin cambios ni añadidos protegidos |
| Base | r1 auditado: atestación `27dd1ba6…`, APK `825e48ce…` (no se copia: `build/` excluido) |
| Workspace | `C:/sf-1a4a-r2-20261102`, `com.smartfin.snapshot5b2.tests`, 299 fuentes de producción |
| Atestación r2 | `286642b3482d6b9b9baa3ebbec3b047697fb941f862c54ce2e06580786112465`, igual a la copia en assets |
| Diferencia con r1 | Un único archivo: `phase1a2NodeExpected.json` (parte `phase1a2` de la referencia r2) |
| Código | `saveManualTransaction.ts` con `await recordInitialInstallmentRevision(` activo; ningún `jest.mock` en el workspace |
| APK | No compilado; `r2/authorization/apk-identity.json` pendiente |

Scripts r2: `authorization-inventory-r2.cjs`, `prepare-android-r2.cjs`, `make-runner-r2.cjs` → `run-android-r2.ps1`
(derivado del runner r1, hash `52e466b8…`; solo cambian workspace, evidencia e identidad), `run-all-r2.ps1`,
`apk-identity-r2.cjs` (rechaza también la atestación y el APK de r1). La evidencia r1 no se modifica.

### 10.6 Procedimiento r2 (requiere autorización)

Desde `C:/Users/nesto/Proyectos/SmartFin`, un comando por llamada:

1. `node scripts/phase1a4a/authorization-inventory-r2.cjs verify`
2. En `C:/sf-1a4a-r2-20261102/android`:
   `./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'`
3. `node scripts/phase1a4a/apk-identity-r2.cjs`
4. `./scripts/phase1a4a/run-all-r2.ps1 -Serial emulator-5554 -Api 24`
5. Si `adb devices` muestra `AXCC6R3919012932`: `./scripts/phase1a4a/run-all-r2.ps1 -Serial AXCC6R3919012932 -Api 35`
6. `node scripts/phase1a4a/authorization-inventory-r2.cjs verify`

### 10.7 Criterios de aceptación r2

Por dispositivo: 355/355 casos (66 nuevos + 289 regresiones), 198 puntos de fallo con rollback confirmado y ningún
`unknown` contado como rollback, igualdad campo a campo con la referencia r2 (y con las referencias 1a.2 de oráculo
independiente, 6B.3 y 6A sin cambios), una sola revisión 0 por plan, `com.smartfin` sin cambios, guards intactos y
`verify` sin cambios protegidos. Ante cualquier fallo: detenerse y conservar la evidencia.

## 11. Ejecución r2 (2–3 de noviembre de 2026): aprobada en API 24 y API 35

APK r2: `C:/sf-1a4a-r2-20261102/android/app/build/outputs/apk/release/app-release.apk`, SHA-256
`a3cba3a8233d245f24b715ec896eacf05cce58a122071ea164810770b7ba29ae`, 33.672.176 bytes, release no depurable,
`com.smartfin.snapshot5b2.tests`, Hermes (`C6 1F BC 03`) con `recordInitialInstallmentRevision` activo; atestación
embebida `286642b3482d6b9b9baa3ebbec3b047697fb941f862c54ce2e06580786112465` ([identidad](r2/authorization/apk-identity.json),
[build](r2/android-build.log), 6 min 20 s). `apk-identity-r2.cjs` rechaza los APK y atestaciones de 6B.3, 1a.2, 1a.3A,
1a.3B r1–r5 y 1a.4A r1. Antes de compilar: inventario r2 sin cambios, 0 diferencias workspace–checkout, guards y
referencias históricas con sus hashes r5.

| Campaña | API 24 (`emulator-5554`, SQLite 3.9.2) | API 35 (`AXCC6R3919012932`, SQLite 3.44.5) | Puntos de fallo |
|---|---|---|---|
| `phase1a4a-creation` | 14/14 | 14/14 | — |
| `phase1a4a-lifecycle` | 4/4 | 4/4 | — |
| `phase1a4a-compatibility` | 4/4 | 4/4 | — |
| `phase1a4a-invariants` | 4/4 | 4/4 | — |
| `phase1a4a-atomicity` | 33/33 | 33/33 | 28 |
| `phase1a4a-unknown` / `-unknown-restart` | 3/3 · 4/4 | 3/3 · 4/4 | — |
| `phase1a3b-upgrade`, `-startup-seed`, `-startup-upgrade`, `-upgrade-restart` | 4/4 ×4 | 4/4 ×4 | — |
| `phase1a3b-migration-atomicity` | 33/33 | 33/33 | 30 |
| `phase1a3b-integrity` / `-flows` | 13/13 · 4/4 | 13/13 · 4/4 | — |
| `phase1a3a-identity` / `-atomicity` | 11/11 · 37/37 | 11/11 · 37/37 | 32 |
| `phase1a3a-unknown` / `-unknown-restart` | 3/3 · 4/4 | 3/3 · 4/4 | — |
| `phase6b3-atomicity` | 66/66 | 66/66 | 60 |
| `phase1a2-atomicity-historical` | 53/53 | 53/53 | 48 |
| `phase1a2-statements` (referencia actual r2) | 13/13 | 13/13 | — |
| `phase6b3-probes`, `-unknown`, `-unknown-restart` | 12/12 · 3/3 · 3/3 | 12/12 · 3/3 · 3/3 | — |
| `phase6a-precision` | 18/18 | 18/18 | — |
| **Total** | **355/355** | **355/355** | **198 / 198** por dispositivo |

Igualdad con Node campo a campo, sin tolerancias: 41.994 hojas por dispositivo en las campañas con referencia Node
(`phase1a2-statements` 6.355, con la tabla `installment_plan_revisions` incluida), 0 diferencias. Las campañas 6B.3,
1a.2-atomicity-historical y 6A usan sus oráculos independientes (BigInt/decimal) sin cambios. Los 198 puntos inyectaron
el fallo, confirmaron rollback con el estado completo restaurado y una transacción posterior confirmada; los `unknown`
(3 campañas por dispositivo) se registraron como `unknown`, sin reintento, y sus reinicios encontraron la operación una
sola vez (1a.4A: una compra con exactamente una revisión 0).

`com.smartfin`: `production-package-unchanged.json` con `unchanged: true` en las 50 campañas (no instalado en el
emulador; en el HONOR, metadatos idénticos antes y después). Guards: `verify` final sin cambios. Referencias 1a.2,
1a.3A, 1a.3B, 6B.3 y 1a.4A r1/r2 con sus hashes de inventario. Logs: [API 24](r2/android-api24.log),
[API 35](r2/android-api35.log); evidencia por campaña en `r2/android/api24/` y `r2/android/api35/`.
