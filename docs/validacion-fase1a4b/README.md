# Validación Android 1a.4B (preparada, no ejecutada)

2 de noviembre de 2026, America/Bogota. Estado: **sondas, oráculo Node, scripts, inventario, workspace sintético y
atestación preparados**. No se ha compilado el APK ni se ha instalado o ejecutado nada en dispositivos: requiere
autorización específica. El APK de 1a.4A r2 (355/355, 198 puntos, 41.994 hojas) es solo la línea base: **no** valida
este código.

## 1. Qué ejecuta el APK nuevo

La lógica **real** de 1a.4B, sin neutralizaciones: `registerExtraordinaryInstallmentPayment`,
`allocateCreditCardPaymentToPurchase`, la revisión 0 perezosa, la reversión D6 al editar o borrar pagos y la guarda de
compras con imputaciones activas. El caso de uso sigue sin exportarse desde `index.ts` y sin uso en pantallas: las
sondas lo importan por ruta, igual que las pruebas Node (la preparación lo comprueba en el workspace).

## 2. Escrituras y puntos de fallo reales (escenario del APK: dos tarjetas con corte, extractos)

| Operación | Escrituras | Diferencia con el flujo ordinario | Puntos (antes/después) |
|---|---|---|---|
| Alta del abono (`register`) | 18 | +2: `INSERT installment_allocations`, `INSERT installment_plan_revisions` | 36 |
| Alta con revisión 0 perezosa (`registerLazy`) | 19 | +3: revisión 0, imputación, revisión | 38 |
| Edición con reversión (`editReversal`) | 13 | +2 al principio: `UPDATE installment_allocations`, `INSERT installment_plan_revisions` | 26 |
| Borrado con reversión (`deleteReversal`) | 29 | +2 al principio, igual que la edición | 58 |
| **Total nuevo** | 79 | | **158** |

La estimación inicial (~122) se calculó con un fixture de una sola tarjeta (12/13/10/26 escrituras); el escenario del
APK reconcilia dos tarjetas y escribe más extractos. Las cifras de este cuadro son las medidas, iguales en Node y
exigidas al APK (`writes` de la referencia). `command_id` no añade escrituras: se guarda en la fila de imputación.

Cada punto: rollback **confirmado** (nunca `unknown`), estado completo idéntico (todas las tablas con `rowid`, esquema,
imputaciones, revisiones, contador de respaldo y cifras del dashboard), conexión utilizable y una transacción posterior
confirmada. El `COMMIT` perdido se registra como `unknown`, sin reintento, y su reinicio se comprueba aparte.

## 3. Campañas por dispositivo

| Campaña | Contenido | Casos | Puntos |
|---|---|---|---|
| `phase1a4b-register` | simple, dos abonos, excedente y capital cero, centavos, revisión 0 perezosa, 9 rechazos (0,40; 1,60; subcentavo; destinado > pago; otra tarjeta; inexistente; pagada; capital inexacto; abono > deuda) | 9 | — |
| `phase1a4b-reversal` | importe, cuenta, tarjeta, fecha, tipo, edición mixta, ediciones descriptivas y rutas de categoría, borrado, posterior pendiente (E1), posterior confirmada (E2) y rechazo previo a escrituras (decisión C) | 13 | — |
| `phase1a4b-guards` | borrar compra, débito y 1 cuota (acción rápida y formulario), cuotas, importe, tarjeta, fecha, cascada directa, reasignación, borrado tras revertir | 15 | — |
| `phase1a4b-idempotency` | crear, repetir, editar, repetir, borrar, repetir; datos distintos verificables (rechazo) y no verificables (sin escrituras) | 4 | — |
| `phase1a4b-atomicity` | 4 éxitos + 79 × 2 | 165 | **158** |
| `phase1a4b-unknown` | `COMMIT` perdido del alta: `unknown`, sin reintento, conexión retirada | 3 | — |
| `phase1a4b-unknown-restart` (`PreserveData`) | Un pago y una imputación; el comando repetido no escribe; datos distintos rechazados | 4 | — |
| **Nuevas** | | **213** | **158** |
| 1a.4A (sondas sin cambios, referencia 1a.4B = parte r2) | creation, lifecycle, compatibility, invariants, atomicity, unknown, restart | 66 | 28 |
| 1a.3B (sondas derivadas 1a.4B) | upgrade, startup ×3, migration-atomicity, integrity, flows | 66 | 30 |
| 1a.3A (sin cambios) | identity, atomicity, unknown, unknown-restart | 55 | 32 |
| 1a.2, 6B.3, 6A (oráculos sin cambios) | statements, atomicity-historical, probes, atomicity, unknown, unknown-restart, precision | 168 | 108 |
| **Total** | 32 campañas | **502** | **356** |

## 4. Oráculo Node y compatibilidad

`npx jest __tests__/phase1a4bAndroidEquivalence.test.ts` (10/10), sin `jest.mock` de los pasos 1a.4B:

- Campañas 1a.4B deterministas (dos ejecuciones) e independientes del orden de claves de las filas (dos órdenes).
- Regresiones sobre el código real 1a.4B frente a `validacion-fase1a4a/r2/node/results.json`: las partes 1a.4A, 1a.3A y
  1a.2 son **idénticas**; 1a.3B es idéntica salvo dos cambios aprobados con comparador explícito:
  1. `activeAllocationGuards` (D6): borrar el pago por su caso de uso pasa de bloqueado a **aceptado** con reversión
     previa; borrar la compra lo rechaza ahora el caso de uso antes de escribir (la guarda SQLite sigue detrás); todas las
     guardas SQLite directas conservan su resultado.
  2. `flows`: la mitad versión 4 ejecutaba los casos de uso sobre una base **sin** migración 5. Las guardas 1a.4B leen
     las tablas de imputaciones, que solo existen desde la versión 5 (la app la aplica en cada arranque). En versión 4 el
     primer paso protegido falla sin cambios (`no such table: installment_allocations`); la mitad versión 5 es idéntica a
     la referencia.
- Referencia: `node/results.json` (SHA-256 `d26e3a53f5cb89d673a83886f5fd6af6932956615c42348e2e55c2b287ba675f`),
  48.850 hojas (1a.4B 7.199; 1a.4A 5.491; 1a.3A 1.579; 1a.3B 28.226; 1a.2 6.355). Generada una vez con
  `SMARTFIN_WRITE_EVIDENCE=1`; un segundo intento falla con «exists: review and delete it explicitly».
- Suites históricas Node (`phase1a3bAndroidEquivalence`, `phase1a4aAndroidEquivalence`, `installmentHistoryPhase1a3B`):
  aislamiento exclusivo de pruebas (`jest.mock` de los dos pasos 1a.4B) para reproducir el contrato anterior; sus
  aserciones sobre los triggers de bloqueo se conservan.

## 5. Scripts (`scripts/phase1a4b/`)

| Script | Función |
|---|---|
| `probes.ts`, `androidHarness.js` | Sondas y arnés de las 7 campañas nuevas |
| `derive-probes.cjs` → `phase1a3bProbes.ts` | Derivación mecánica (hash r2 `07abad27…` exigido) de las sondas 1a.3B: D6 y versión 4 |
| `authorization-inventory.cjs` | `capture`/`verify` de hashes de las entradas revisadas (`authorization/inputs.sha256.json`) |
| `prepare-android.cjs` | Workspace nuevo desde r2 verificado (atestación `286642b3…`, APK `a3cba3a8…`); refresca `src/`, añade arnés, sondas, despachador y las cinco partes de la referencia 1a.4B; rechaza neutralizaciones y la exportación del caso de uso |
| `make-runner.cjs` → `run-android.ps1` | Runner derivado del r2 (hash `6337f150…`): solo cambian workspace, evidencia, identidad, campañas permitidas, reseteo `phase1a4b-` y `PreserveData` de `phase1a4b-unknown-restart` |
| `run-all.ps1` | 32 campañas en orden, solo `emulator-5554` (API 24) y `AXCC6R3919012932` (API 35) |
| `apk-identity.cjs` | Tras un build autorizado: hash del APK y atestación; rechaza los APK y atestaciones anteriores (1a.4A r1/r2 incluidos) |

## 6. Workspace y atestación

| Elemento | Valor |
|---|---|
| Inventario | `authorization/inputs.sha256.json`: 866 entradas, fase `1a.4B`; `verify` previo: `protectedFilesUnchanged: true`, sin cambios ni añadidos. Las 23 entradas de guards (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`) son idénticas al inventario r2 |
| Base | 1a.4A r2 aprobada: atestación `286642b3…`, APK `a3cba3a8…` (verificados; `build/` no se copia) |
| Workspace | `C:/sf-1a4b-20261102`, paquete `com.smartfin.snapshot5b2.tests`, 302 fuentes de producción refrescadas, 390 archivos atestados; 0 diferencias workspace–atestación y checkout–atestación |
| Atestación | `5cbf894058ec96319b88981dd9bf2433fd79d7456ef3fe7f802f48843b753f4c`, idéntica en `android/app/src/main/assets/phase5b2-source-fingerprints.json` |
| Código | `saveManualTransaction.ts` con `await reverseActivePaymentAllocations(` (edición y borrado) y `await requireNoActiveInstallmentAllocations(`; ningún `jest.` en sondas ni arnés; `index.ts` del módulo sin el caso de uso |
| Despachador | `Harness.jsx` añade `phase1a4b-` y conserva las campañas anteriores |
| APK | **No compilado** (`android/app/build` no existe); `authorization/apk-identity.json` pendiente |

## 7. Procedimiento (requiere autorización)

Desde `C:/Users/nesto/Proyectos/SmartFin`, un comando por llamada:

1. `node scripts/phase1a4b/authorization-inventory.cjs verify`
2. En `C:/sf-1a4b-20261102/android`:
   `./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'`
3. `node scripts/phase1a4b/apk-identity.cjs`
4. `./scripts/phase1a4b/run-all.ps1 -Serial emulator-5554 -Api 24`
5. Si `adb devices` muestra `AXCC6R3919012932`: `./scripts/phase1a4b/run-all.ps1 -Serial AXCC6R3919012932 -Api 35`
6. `node scripts/phase1a4b/authorization-inventory.cjs verify`

## 8. Criterios de aceptación

Por dispositivo: 502/502 casos, 356 puntos de fallo con rollback confirmado y ningún `unknown` contado como rollback,
igualdad campo a campo con la referencia 1a.4B (y con los oráculos independientes de 1a.2, 6B.3 y 6A), una sola
imputación por comando, ningún pago recreado ni imputación reactivada, `com.smartfin` sin cambios, guards intactos y
`verify` sin cambios protegidos. Ante cualquier fallo: detenerse y conservar la evidencia.

## 9. Ejecución r1 (3 de noviembre de 2026): detenida en `phase1a4b-reversal`

Comprobaciones previas: rama `main`, commit `ece07ab`; `verify` sin cambios ni añadidos protegidos; 0 diferencias
checkout–atestación y workspace–atestación; referencia Node `d26e3a53…` incluida en el inventario; caso de uso sin
exportar ni importar desde pantallas; sin APK previo.

APK r1: `C:/sf-1a4b-20261102/android/app/build/outputs/apk/release/app-release.apk`, SHA-256
`e65e614ab5689f240047df4f5e30c5fc5bcd52b1ee90f6fbaaaf8869a06621b7`, 33.810.180 bytes, build offline en 5 min 27 s
([log](android-build.log)), atestación embebida `5cbf894058ec96319b88981dd9bf2433fd79d7456ef3fe7f802f48843b753f4c`
([identidad](authorization/apk-identity.json)), Hermes (`C6 1F BC 03`) con el código 1a.4B, paquete
`com.smartfin.snapshot5b2.tests`, release sin `debuggable`. `apk-identity.cjs` rechaza los APK y atestaciones anteriores.

API 24 (`emulator-5554`), [log](android-api24.log):

| Campaña | Resultado |
|---|---|
| `phase1a4b-register` | **9/9** (simple, dos abonos, excedente y cero, centavos, perezosa, 9 rechazos con 0 escrituras) |
| `phase1a4b-reversal` | **Fallo en el primer caso** (`editAmount`): `$.observation.backupRevision` Android = 33, Node = 31 |
| Resto (30 campañas) | No ejecutadas (instrucción de detenerse ante una diferencia) |

Datos del fallo: misma cantidad de hojas (181) en Android y Node; los campos anteriores en el orden de comparación
(`accounts`, `allocations`) son iguales; el arnés informa solo la primera diferencia, por lo que los campos posteriores
(`installmentPurchases`, `revisions`, `statements`, `summary`, `transactions`, `writes`) no se conocen. En `register`
el contador coincidió en los seis casos (p. ej. `simple` = 25), así que la diferencia (+2) aparece en la edición del pago
con reversión. `financial_data_revision` es el marcador de respaldo desactualizado, no un saldo; aun así la diferencia no
está explicada y **no se acepta**. Ninguna edición de un pago `creditCardPayment` se había validado antes en Android
(1a.4A r2 edita compras, no pagos), así que no se puede atribuir todavía a 1a.4B ni a un comportamiento previo.

API 35 (`AXCC6R3919012932`, conectado): **no ejecutado**, porque API 24 no superó las campañas.

Guards: `verify` final sin cambios. `com.smartfin`: `production-package-unchanged.json` con `unchanged: true` (no instalado
en el emulador). Ningún archivo de producción, referencia, migración, trigger, hook ni guard modificado.

Siguiente paso propuesto (requiere autorización, r2): una ejecución diagnóstica que registre en Android todas las
diferencias del caso (no solo la primera) y el contador tras cada escritura de la edición; comparar con Node; corregir
solo si se identifica la causa, con nuevo workspace, atestación y APK.
