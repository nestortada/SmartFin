# Validación Node–Android de la Fase 1a.2 (preparada, sin ejecutar)

1 de noviembre de 2026, America/Bogota. Estado: **ejecutada con autorización del propietario** («Autorizo la
campaña»). Resultados en la sección 6.

La validación anterior (6B.3: API 24 102/102, API 35 102/102, 1.715 campos sin diferencias) es la **línea base
histórica**. No valida el código de 1a.2, porque el APK `6ee559dd…` no lo contiene.

## 1. Piezas preparadas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Sondas y oráculo | [`scripts/phase1a2/probes.ts`](../../scripts/phase1a2/probes.ts) | 10 sondas con los casos de uso de producción sin cambios y el reloj JS fijado al mediodía de Bogotá en cada paso. Cada paso pasa un oráculo BigInt independiente (no usa el motor): total del extracto, pago mínimo, estado, deuda, banco, patrimonio, integridad y claves foráneas |
| Referencia Node | [`node/results.json`](node/results.json) | Salida de las sondas en `node:sqlite` (`SMARTFIN_WRITE_EVIDENCE=1 npx jest __tests__/phase1a2StatementsProbes.test.ts`). 5.530 campos por dispositivo. Ids de movimientos normalizados a `T1…Tn` en orden de creación, con las referencias incluidas |
| Prueba Node | [`__tests__/phase1a2StatementsProbes.test.ts`](../../__tests__/phase1a2StatementsProbes.test.ts) | Comprueba el oráculo, que una segunda ejecución da lo mismo, la coincidencia con los escenarios de `creditCardStatementsPhase1a2` y que el oráculo **rechaza** la reconciliación anterior a 1a.2 (`Statement 2026-11-20: 0 != 100000`) |
| Arnés Android | [`scripts/phase1a2/androidHarness.js`](../../scripts/phase1a2/androidHarness.js) | Campaña `phase1a2-statements`. Ejecuta las sondas en el driver real y exige igualdad campo a campo con la referencia, sin tolerancias. Informa los campos comparados |
| Preparador | [`scripts/phase1a2/prepare-android.cjs`](../../scripts/phase1a2/prepare-android.cjs) | Workspace nuevo `C:/sf-1a2-20261101` a partir de `C:/sf-6b3-20261101` (comprueba su atestación `1352b7dd…` y su APK `6ee559dd…`). Refresca todo `src/`, añade el arnés 1a.2 y los archivos de regresión 6B.3/6A sin cambios, y escribe una **atestación nueva** (`phase: '1a.2'`) |
| Inventario | [`scripts/phase1a2/authorization-inventory.cjs`](../../scripts/phase1a2/authorization-inventory.cjs) | `capture` / `verify` pasivos de los hashes de entradas y guards ([`authorization/inputs.sha256.json`](authorization/inputs.sha256.json)) |
| Identidad del APK | [`scripts/phase1a2/apk-identity.cjs`](../../scripts/phase1a2/apk-identity.cjs) | Tras compilar y antes de instalar: hash y tamaño del APK, atestación nueva (rechaza la de 6B.3), fuentes preparadas y del checkout, fuentes 1a.2 y del arnés |
| Runner | [`scripts/phase1a2/run-android.ps1`](../../scripts/phase1a2/run-android.ps1) | Derivado mecánicamente del runner 6B.3.1 validado por [`make-runner.cjs`](../../scripts/phase1a2/make-runner.cjs), que fija su hash `a2693a9b…`. Solo cambian el workspace, las rutas de evidencia, la identidad y las seis campañas permitidas |
| Ejecución | [`scripts/phase1a2/run-all.ps1`](../../scripts/phase1a2/run-all.ps1) | `phase1a2-statements` seguida de las cinco regresiones 6B.3, solo para los dos seriales autorizados |

El oráculo Node de 6B.3 (`docs/correccion-fase6b3/node/results.json`) **no cambia**: el código actual lo reproduce
con 0 diferencias. Sus tarjetas no tienen día de corte, así que conservan la regla heredada. La referencia de
`phase6a-precision` es solo de dashboard y no depende de la reconciliación. No se modificó ningún oráculo
anterior.

## 2. Escenarios

| Sonda | Comprueba |
|---|---|
| `sixInstallments` | 600.000 a 6 cuotas: 100.000 en seis ciclos y 0 en el séptimo; el gasto cuenta una sola vez |
| `overlappingPlans` | 600.000×6 + 300.000×3: `[100k, 200k, 200k, 200k, 100k, 100k, 0]`, Σ 900.000 |
| `paymentInLaterCycle` | Escenario C, comportamiento heredado documentado: noviembre 0 `paid`, deuda 550.000 |
| `centsAndResidue` | 100.000/3 · 100.000,50/3 · 0,40/2 · 1/3, exactos al centavo, residuo en la última cuota |
| `closingDays293031` | Corte 31 (meses cortos), corte 30 (29 feb 2028), corte 29 (28 feb 2027) |
| `closingDayPurchase` | Compra el día del corte sin política: `pendingVerification`, cargo `legacyUnverified` |
| `withoutClosingDay` | Tarjeta sin corte: mes calendario, `missingClosingDay` |
| `yearChange` | Compra del 21 dic 2026 → ciclos de 2027 |
| `calendarStates` | `projected`; `requiresDecision` (0,01/2); `pendingVerification` por `REAL` histórico inexacto (300.000,005). `confirmed` **no se puede reproducir** con el esquema actual: falta la migración 5 |
| `historicalProtection` | Extractos antiguos `closed`, `paid` y `open` intactos; retroceso de reloj sin escritura; repetición que conserva `created_at` |

## 3. Matriz por dispositivo

Las mismas comprobaciones en API 24 (`emulator-5554`, AVD `SmartFin_Guard_Synthetic_API24`) y API 35
(`AXCC6R3919012932`, HONOR `CRT-NX3`):

| Campaña | Casos esperados | Comparación | Criterio |
|---|---|---|---|
| `phase1a2-statements` | `isolation`, `runtime`, 10 sondas y `equivalence-summary` (13) | Igualdad campo a campo con la referencia Node (5.530 campos) y oráculo BigInt en cada paso | 13/13; `differences: 0` |
| `phase6b3-probes` | 12 | `phase6b3NodeExpected.json` sin cambios | 12/12 |
| `phase6b3-atomicity` | 66 (3 matrices de fallos inyectados; 10 escrituras × 2 fases; sin duplicado) | Rollback confirmado y estado exacto restaurado | 66/66 |
| `phase6b3-unknown` | 3 | `unknown` sin reintento y conexión retirada | 3/3 |
| `phase6b3-unknown-restart` | 3 | Un único pago persistido tras reabrir | 3/3 |
| `phase6a-precision` | 18 | Dashboard exacto | 18/18 |
| **Total por dispositivo** | **115** | | **115/115** (102 de regresión + 13 de 1a.2) |

Campos comparados en `phase1a2-statements`: extractos y estados, total por ciclo, pago mínimo, deuda, cupo
(`credit_limit_amount`), banco, ingresos, gastos, ahorro, patrimonio, movimientos y referencias (ids normalizados
de forma consistente), registros de cuotas, informe de reconciliación (orígenes y motivos),
`integrity_check` y `foreign_key_check`. No hay campos de presentación: la campaña es solo financiera.

## 4. Procedimiento que requiere autorización

Desde el repositorio, un comando por llamada y con los hooks activos. Cada paso se detiene ante cualquier
diferencia.

1. **Inventario pasivo** (ya capturado en esta tarea; repetirlo si cambian las fuentes):
   `node scripts/phase1a2/authorization-inventory.cjs capture`
2. **Preparar el workspace** (requiere autorización: crea `C:/sf-1a2-20261101`):
   `node scripts/phase1a2/prepare-android.cjs`
3. **Compilar** (requiere autorización), desde `C:/sf-1a2-20261101/android`:
   `./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'`
4. **Registrar la identidad** antes de instalar (solo lee archivos):
   `node scripts/phase1a2/apk-identity.cjs`
5. **Arrancar el AVD** ya identificado, sin wipe ni Quick Boot (requiere autorización):
   `Start-Process -FilePath 'C:/Users/nesto/AppData/Local/Android/Sdk/emulator/emulator.exe' -ArgumentList '-avd SmartFin_Guard_Synthetic_API24 -no-boot-anim -no-snapshot' -WindowStyle Hidden`
6. **Campañas** (requiere autorización: instala o actualiza solo `com.smartfin.snapshot5b2.tests` y limpia sus
   datos sintéticos):
   - `./scripts/phase1a2/run-all.ps1 -Serial emulator-5554 -Api 24`
   - `./scripts/phase1a2/run-all.ps1 -Serial AXCC6R3919012932 -Api 35`
7. **Verificación final:** `node scripts/phase1a2/authorization-inventory.cjs verify` (guards sin cambios) y
   resumen de `docs/validacion-fase1a2/android/api{24,35}/*/result.json`.

Garantías heredadas del runner: comprueba API, AVD o modelo, hash del APK y de la atestación, atestación embebida
idéntica, paquete sintético no depurable, todas las fuentes preparadas y del checkout, UID distinto del de
`com.smartfin`, y salida exacta sin sobrescribir evidencias. `com.smartfin` solo se consulta en modo lectura
(metadatos de paquete).

## 5. Criterios para cerrar la Fase 1a.2

1. Node: suite estable, reproducciones, `tsc`, ESLint y `git diff --check` en verde (ver el informe de la tarea).
2. API 24 y API 35: 115/115 cada uno; `phase1a2-statements` con 0 diferencias frente a `node/results.json`.
3. Las cinco regresiones 6B.3 aprobadas con sus oráculos originales, sin cambios.
4. `authorization-inventory.cjs verify`: guards sin cambios. `com.smartfin` sin modificaciones (metadatos
   antes y después).
5. Si cualquier campo difiere, la fase sigue abierta: se investiga la causa. No se ajusta la referencia ni se
   añade tolerancia.

## 6. Resultados (1 nov 2026, autorizado)

- **Workspace:** `C:/sf-1a2-20261101`, preparado con `prepare-android.cjs`.
  - El registro de identidad se detuvo al detectar que la atestación heredada fijaba los bytes anteriores de
    `scripts/phase6b1/probes.ts`, cuyo tipo cambió en 1a.2.
  - [`refresh-harness.cjs`](../../scripts/phase1a2/refresh-harness.cjs) lo refrescó verificando todo el
    workspace. Mismo patrón que 6B.3; solo el archivo `phase6b1Probes.ts`.
- **APK:** release Hermes `8d8a3e01…`, de 33.244.848 bytes.
  - Atestación nueva `a4a437d3…`, idéntica a la embebida; la de 6B.3 no se reutiliza.
  - El bundle contiene `statementChargesForCycle`, `installmentBilledInCycle`, `supersededByLaterCycle` y el arnés
    1a.2.
  - Identidad en [`authorization/apk-identity.json`](authorization/apk-identity.json). Compilaciones:
    `android-build.log` y `android-build-attempt-02.log`.

| Campaña | API 24 (`emulator-5554`) | API 35 (`AXCC6R3919012932`) |
|---|---|---|
| `phase1a2-statements` | **13/13**: 5.530 campos, **0 diferencias** | **13/13**: 5.530 campos, **0 diferencias** |
| `phase6b3-probes` | 12/12 (oráculo 6B.3 sin cambios) | 12/12 |
| `phase6b3-atomicity` | 54/54 (8 escrituras por matriz) | 54/54 (8 escrituras por matriz) |
| `phase6b3-unknown` | 3/3 | 3/3 |
| `phase6b3-unknown-restart` | 3/3 | 3/3 |
| `phase6a-precision` | 18/18 | 18/18 |
| **Total** | **103/103** | **103/103** |

- **Equivalencia Node–Android de los extractos multiciclo:** demostrada en los dos dispositivos.
- **Guards:** `authorization-inventory.cjs verify` da `protectedFilesUnchanged: true`; el único añadido es
  `refresh-harness.cjs`.
- **`com.smartfin`:** sin cambios en ninguna campaña. En API 35 los metadatos son idénticos antes y después; en el
  emulador API 24 no está instalado.

### Diferencia frente a lo previsto: 54 en lugar de 66 casos de atomicidad

- **Lo que se esperaba:** 115 casos por dispositivo, con 10 escrituras por matriz como en 6B.3. Se obtuvieron 8.
- **Causa** (reproducida en Node con una prueba temporal ya retirada):
  - la matriz del arnés 6B.3 siembra las compras con `saveManualTransaction`, que reconcilia con el reloj real del
    dispositivo (1 nov en Bogotá) y crea el extracto de noviembre;
  - después paga con la fecha fija del 11 de octubre;
  - la protección de 1a.2 trata el ciclo de octubre como histórico (`supersededByLaterCycle`) y no escribe su
    extracto, así que faltan las 2 escrituras de extracto por matriz;
  - con el reloj de Jest (Node) hay 10 escrituras.
- **Impacto:**
  - la deuda, el banco y el resto de magnitudes son idénticos;
  - los 54 casos son rollbacks confirmados con el estado exacto restaurado;
  - lo que no se ejerció en Android son los puntos de fallo de **escritura del extracto** dentro del pago. Siguen
    cubiertos en Node (`phase6b3HarnessRollbackOracle`, 10 escrituras, y las pruebas de fallos inyectados de 1a.2).
- **Para cubrirlos en Android** hace falta fijar el reloj en la siembra de la matriz del arnés 6B.3 (el oráculo no
  cambia), recompilar y repetir `phase6b3-atomicity` en los dos dispositivos. Requiere tu decisión.

## 7. Cierre de atomicidad (r2, 2 nov 2026, autorizado)

**Corrección del arnés** (solo arnés y pruebas; producción sin cambios):
- `scripts/phase6b3/androidHarness.js`: la matriz fija el reloj JS de la siembra y del pago con `withPhase1A2Clock`
  (`MATRIX_CLOCKS`).
  - `aligned` (PHASE6B3_DATE): 10 escrituras. Comprueba que el extracto del ciclo del pago se escribe (`pending`
    → `0, paid`) y conserva los nombres y los 66 casos de `phase6b3-atomicity`.
  - `historical` (reloj fijo 2026-11-02T04:38:46Z, el observado en los dispositivos): 8 escrituras. Comprueba que
    el extracto guardado no cambia.
  - El bloque `<rollback-oracle>` no cambia.
- `scripts/phase1a2/androidHarness.js`: campaña nueva `phase1a2-atomicity-historical`, la matriz de protección
  histórica.
- `__tests__/phase6b3HarnessRollbackOracle.test.ts`: escenarios A y B en Node.
  - A: 8 escrituras, sin extracto, histórico intacto.
  - B: 10 escrituras, con los extractos en las posiciones **3 y 10** (reconciliación antes y después del pago).
  - Los 20 y 16 puntos de cada matriz son rollbacks confirmados; los 4 puntos de extracto por matriz se fallan de
    verdad.
- Workspace refrescado con `refresh-harness.cjs` (atestación `b7e3bb60…`). Runner `run-android-r2.ps1`
  (`make-runner.cjs r2`) y `run-all-r2.ps1`; evidencias en `android-r2/`, sin sobrescribir la r1.

**APK r2:** `fb5898e1…`, de 33.247.756 bytes, con la atestación embebida idéntica
([`apk-identity-r2.json`](authorization/apk-identity-r2.json)). Rechaza las atestaciones de 6B.3 y de la r1.

| Campaña (r2) | API 24 | API 35 |
|---|---|---|
| `phase6b3-atomicity` | **66/66** (10/10/10 escrituras) | **66/66** (10/10/10) |
| `phase1a2-atomicity-historical` | 53/53 (8/8/8) | 53/53 (8/8/8) |
| `phase1a2-statements` | 13/13: 5.530 campos, 0 diferencias | 13/13: 5.530 campos, 0 diferencias |
| `phase6b3-probes` | 12/12 | 12/12 |
| `phase6b3-unknown` | 3/3 | 3/3 |
| `phase6b3-unknown-restart` | 3/3 | 3/3 |
| `phase6a-precision` | 18/18 | 18/18 |
| **Total** | **168/168** | **168/168** |

**Cobertura por punto de escritura y dispositivo:**

| Matriz | Puntos de fallo | De ellos, de extracto |
|---|---|---|
| Alineada | 3 matrices × 10 escrituras × antes/después = 60 | 12 (escrituras 3 y 10) |
| Histórica | 3 × 8 × 2 = 48 | 0 (el ciclo es histórico y su extracto no se escribe) |

En los 108 puntos: error original propagado, rollback confirmado, nuevo propietario de transacción confirmado,
todas las tablas, métricas e integridad idénticas al estado anterior, sin COMMIT.

- `phase6b3-unknown`: `unknown` sin reintento y conexión retirada.
- `phase6b3-unknown-restart`: un único pago tras reabrir.
- **Guards:** `authorization-inventory.cjs verify` da `protectedFilesUnchanged: true`; solo cambian o se añaden
  archivos de arnés y pruebas.
- **`com.smartfin`:** sin cambios en ninguna campaña.

**Criterios de cierre de la Fase 1a.2:** cumplidos (ver la sección 5).
