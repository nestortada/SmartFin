# Validación Node–Android de la Fase 1a.3A (ejecutada)

2 de noviembre de 2026, America/Bogota. Estado: **ejecutada con autorización del propietario**; resultados en la
sección 10. Las secciones 1–9 describen la preparación, anterior a cualquier compilación o acción en Android.
Ninguna acción modificó `com.smartfin`.

La validación 1a.2 r2 (APK `fb5898e1…`, 168/168 por dispositivo) es la **línea base histórica**: ese APK no
contiene el código 1a.3A y no sirve como evidencia de esta fase.

## 1. Estado inicial del repositorio

- Rama `main`, commit `c008e34` («fase 1 a1 y a2»).
- Cambios de la implementación 1a.3A sin confirmar (se conservan íntegros):
  - `src/database/saveSQLiteRowPreservingIdentity.ts` (nuevo);
  - `src/modules/creditCards/repositories/sqliteCreditCardRepository.ts`;
  - las pruebas, el snapshot de la Fase 0 y los documentos descritos en
    [persistencia-segura-fase1a3A.md](../persistencia-segura-fase1a3A.md).
- Esta tarea **no** modifica código de producción. Solo añade los archivos de la sección 2, la referencia Node y el
  inventario de autorización.

## 2. Piezas preparadas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Sondas y oráculo | [`scripts/phase1a3a/probes.ts`](../../scripts/phase1a3a/probes.ts) | Código compartido Node/Android: 8 sondas de identidad, 2 matrices de rollback, `unknown` y comprobación tras reinicio. Usa los casos de uso de producción sin cambios, con el reloj JS fijado en cada paso. Las tablas dependientes son sintéticas y solo existen en la base sintética |
| Arnés Android | [`scripts/phase1a3a/androidHarness.js`](../../scripts/phase1a3a/androidHarness.js) | Campañas `phase1a3a-identity`, `-atomicity`, `-unknown` y `-unknown-restart`. Cada caso debe ser igual a la referencia Node campo a campo, sin tolerancias. Inyecta los fallos con los ganchos ya auditados del APK sintético (`__deletionFault`, `__snapshotCommitLost`) e informa la versión de SQLite |
| Referencia Node | [`node/results.json`](node/results.json) | Generada con `SMARTFIN_WRITE_EVIDENCE=1 npx jest __tests__/phase1a3aAndroidEquivalence.test.ts` sobre una conexión gestionada `node:sqlite`, en el mismo orden que el APK. Ids de movimiento normalizados a `T1…Tn` |
| Prueba Node | [`__tests__/phase1a3aAndroidEquivalence.test.ts`](../../__tests__/phase1a3aAndroidEquivalence.test.ts) | Ejecuta las cuatro campañas en Node y comprueba: determinismo (dos ejecuciones idénticas), igualdad con la referencia, 6 y 10 escrituras con sus verbos, `unknown` sin reintento, reinicio. También que las sondas **rechazan** el repositorio anterior con `REPLACE` |
| Preparador | [`scripts/phase1a3a/prepare-android.cjs`](../../scripts/phase1a3a/prepare-android.cjs) | Workspace nuevo `C:/sf-1a3a-20261102` a partir de `C:/sf-1a2-20261101`: comprueba su atestación `b7e3bb60…` y su APK `fb5898e1…`, refresca `src/`, añade el arnés 1a.3A, refresca los archivos de regresión sin cambios y escribe una atestación nueva (`phase: '1a.3A'`) |
| Inventario | [`scripts/phase1a3a/authorization-inventory.cjs`](../../scripts/phase1a3a/authorization-inventory.cjs) | `capture` / `verify` pasivos de las entradas y los guards ([`authorization/inputs.sha256.json`](authorization/inputs.sha256.json), 798 archivos) |
| Identidad del APK | [`scripts/phase1a3a/apk-identity.cjs`](../../scripts/phase1a3a/apk-identity.cjs) | Tras compilar y antes de instalar: hash y tamaño del APK, atestación embebida. Rechaza las atestaciones de 6B.3, 1a.2 r1 y r2 y los APK `6ee559dd…`, `8d8a3e01…` y `fb5898e1…` |
| Runner | [`scripts/phase1a3a/run-android.ps1`](../../scripts/phase1a3a/run-android.ps1) | Derivado mecánicamente del runner 6B.3.1 (hash fijado `a2693a9b…`) por [`make-runner.cjs`](../../scripts/phase1a3a/make-runner.cjs). Solo cambian el workspace, las rutas de evidencia e identidad, las 11 campañas permitidas, el reseteo limpio de `phase1a3a-`/`phase1a2-` y `PreserveData` para los dos `unknown-restart` |
| Ejecución | [`scripts/phase1a3a/run-all.ps1`](../../scripts/phase1a3a/run-all.ps1) | Las 4 campañas 1a.3A seguidas de las 7 regresiones 1a.2 r2, solo para los dos seriales autorizados |

**Workspace ya preparado** (copia de archivos, sin Android ni compilación): `C:/sf-1a3a-20261102`, 292 fuentes de
producción refrescadas.
- Atestación nueva `fe6d57895a37def3e6f26d7d60c636abe56e5173581b73c8294d1e417cd8417e`, igual a la embebida en
  `assets/`.
- `applicationId "com.smartfin.snapshot5b2.tests"`.
- Sin `android/app/build` heredado y sin bases de datos.
- El despachador `Harness.jsx` conserva todas las campañas anteriores y añade `phase1a3a-`.

## 3. Campaña `phase1a3a-identity`

Las 8 sondas corren en el driver real y en el mismo orden en Node y Android. Banco 1.000.000; Visa con corte el 20
y cupo 2.000.000.

| Sonda | Puntos del encargo | Comprueba |
|---|---|---|
| `insertNew` | 1, 4, 5, 9, 10 | Compra 300.000×3: plan y extracto insertados una vez, `created_at = updated_at` = reloj fijo, Δ revisión |
| `editPlanUnchangedTerms` | 2, 3, 4, 5, 6, 7, 9 | Edición del plan con hijos `CASCADE` y `SET NULL`: mismo `id`/`rowid`/`created_at`, `updated_at` nuevo, `paid_installments` y `monthly_amount` conservados, hijos intactos |
| `editPlanChangedTerms` | 2, 3, 6, 7 | 3 → 6 cuotas: identidad e hijos conservados; el plan se reinicia como antes (pendiente para 1a.3B) |
| `statementPaymentInPlace` | 2, 3, 5, 6, 7 | Pago de 100.000: el extracto se liquida en la misma fila (`0`, `paid`) con sus hijos; banco 900.000, deuda 500.000 |
| `repeatedReconciliation` | 12 | 6 reconciliaciones (repetidas y de ciclos posteriores): un extracto por ciclo, filas anteriores con mismo `rowid`, `created_at` e hijos |
| `profileUpdate` | 2, 3, 4, 5 | Perfil: `created_at` del primer guardado, tasa y `updated_at` nuevos, mismo `rowid`, +1 revisión por guardado |
| `rejectMissingReference` | 10, 11 | Plan, extracto y perfil con referencias inexistentes: rechazados por `FOREIGN KEY`, sin filas ni cambios |
| `unlistedColumns` (última) | 8 | Columna sintética añadida a planes y extractos (como hará la migración 5): `kept` tras editar, pagar y reconciliar; un extracto nuevo recibe el DEFAULT |

En cada paso se comparan:
- cuentas, cupo disponible (centavos BigInt), disponible, deuda, patrimonio, ingresos, gastos y ahorro;
- movimientos completos, planes y extractos con `rowid`, perfiles y dependientes;
- `financial_data_revision.revision`, `integrity_check` y `foreign_key_check`.

Los importes clave se verifican además contra valores decimales esperados. **1.123 campos** por dispositivo. La
versión de SQLite se informa en el caso `runtime` y no se compara (Node usa 3.53; se espera 3.9.2 en API 24).

## 4. Atomicidad (`phase1a3a-atomicity`, `-unknown`, `-unknown-restart`)

| Matriz | Escrituras (Node) | Puntos | Contenido |
|---|---|---|---|
| `planEdit` | 6: movimiento (2), **plan `UPDATE`**, tarjeta (2), **extracto `UPDATE`** | 12 | Edición del plan con hijos sintéticos |
| `statementPayment` | 10: tarjeta (2), **extracto `UPDATE` (3)**, banco (2), pago (2), tarjeta (2), **extracto `UPDATE` (10)** | 20 | Pago con el extracto y sus hijos |

En cada punto, antes y después de cada escritura:
- se propaga el error inyectado original y el rollback queda confirmado (no `unknown`);
- la conexión sigue utilizable y un nuevo propietario confirma una transacción (no queda ninguna abierta);
- todas las tablas son iguales al estado anterior: `rowid`, dependientes, revisión, saldos, deuda, patrimonio y
  métricas.

El número de escrituras del APK debe ser igual al de Node. **34 casos, 350 campos.**

- `phase1a3a-unknown`: COMMIT ejecutado con la respuesta perdida. El resultado es `unknown`; la misma petición
  devuelve el mismo fallo sin volver a ejecutarse y la conexión queda retirada. Antes del COMMIT se guarda la
  identidad del plan en una tabla marcador sintética.
- `phase1a3a-unknown-restart` (conserva los datos): tras reabrir, la edición está **una vez**, con el mismo
  `id`/`rowid`/`created_at`, los hijos intactos, banco 1.000.000, deuda 300.000 e integridad correcta.

## 5. Matriz por dispositivo

API 24 (`emulator-5554`, AVD `SmartFin_Guard_Synthetic_API24`) y API 35 (`AXCC6R3919012932`, HONOR `CRT-NX3`):

| Campaña | Casos | Criterio |
|---|---|---|
| `phase1a3a-identity` | 11 (`isolation`, `runtime`, 8 sondas, resumen) | 1.123 campos, 0 diferencias |
| `phase1a3a-atomicity` | 37 (`isolation`, `runtime`, 2 éxitos + 32 puntos, resumen) | 6 y 10 escrituras como Node; 32 rollbacks exactos |
| `phase1a3a-unknown` | 3 | `unknown`, sin reintento, conexión retirada |
| `phase1a3a-unknown-restart` | 4 | Edición única, identidad e hijos, igual a Node |
| `phase6b3-atomicity` | 66 | **10/10/10** escrituras (extractos en 3 y 10) |
| `phase1a2-atomicity-historical` | 53 | **8/8/8** escrituras, extracto histórico intacto |
| `phase1a2-statements` | 13 | 5.530 campos, 0 diferencias (oráculo 1a.2 sin cambios) |
| `phase6b3-probes` | 12 | Oráculo 6B.3 sin cambios |
| `phase6b3-unknown` / `-unknown-restart` | 3 + 3 | Sin cambios |
| `phase6a-precision` | 18 | Sin cambios |
| **Total por dispositivo** | **223** (168 de regresión + 55 de 1a.3A) | **223/223** |

Los oráculos de regresión no se han modificado. En Node, `phase6b3HarnessRollbackOracle` sigue dando 10 y 8
escrituras con los extractos en 3 y 10. El arnés inyecta por número de escritura, así que no se ha tocado; los
puntos 3 y 10 son ahora `UPDATE` en lugar de `INSERT OR REPLACE`. Si en Android cambia un recuento, se investiga
la cobertura real; no se ajusta el número esperado.

## 6. Comandos propuestos (requieren autorización específica)

Desde `C:/Users/nesto/Proyectos/SmartFin`, un comando por llamada y con los hooks activos. Cada paso se detiene
ante cualquier diferencia. Ya hechos sin Android: inventario (`capture`) y preparación del workspace.

1. **Compilar el APK release sintético**, desde `C:/sf-1a3a-20261102/android`:
   `./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'`
2. **Registrar la identidad** antes de instalar (solo lee archivos):
   `node scripts/phase1a3a/apk-identity.cjs`
3. **Arrancar el AVD** ya identificado, sin wipe ni Quick Boot:
   `Start-Process -FilePath 'C:/Users/nesto/AppData/Local/Android/Sdk/emulator/emulator.exe' -ArgumentList '-avd SmartFin_Guard_Synthetic_API24 -no-boot-anim -no-snapshot' -WindowStyle Hidden`
4. **Campañas** (instalan o actualizan solo `com.smartfin.snapshot5b2.tests` y limpian sus datos sintéticos):
   - `./scripts/phase1a3a/run-all.ps1 -Serial emulator-5554 -Api 24`
   - `./scripts/phase1a3a/run-all.ps1 -Serial AXCC6R3919012932 -Api 35` (el HONOR conectado por USB con depuración)
5. **Verificación final** (pasiva): `node scripts/phase1a3a/authorization-inventory.cjs verify` y resumen de
   `docs/validacion-fase1a3a/android/api{24,35}/*/result.json`.

## 7. Permisos necesarios

- Compilar con Gradle en el workspace sintético (sin red: `--offline`).
- Arrancar el emulador API 24 existente.
- `adb install -r`, `pm clear`, `am start/force-stop` y `pm grant`/`appops` de notificaciones, **solo** sobre
  `com.smartfin.snapshot5b2.tests`, en `emulator-5554` y `AXCC6R3919012932`.
- Lectura de metadatos de `com.smartfin` (`dumpsys package`) antes y después. Nada más sobre ese paquete.

Garantías heredadas del runner:
- API, AVD o modelo, hash del APK y de la atestación, y atestación embebida idéntica;
- paquete sintético no depurable, UID distinto del de `com.smartfin` y ruta de base `phase5b2_synthetic.db`;
- todas las fuentes preparadas y del checkout iguales a la atestación;
- evidencias sin sobrescritura; si cambian los metadatos de `com.smartfin`, la ejecución se detiene.

## 8. Riesgos y limitaciones

- **Sin evidencia de dispositivo todavía**: Node demuestra la lógica en SQLite 3.53. El comportamiento en 3.9.2
  (API 24) solo lo acredita la campaña.
- El APK final no se ha compilado ni empaquetado (tampoco el bundle de Metro). Un error de bundle se detectaría en
  el paso 1.
- `rejectMissingReference` compara que el error mencione `FOREIGN KEY`. Si el driver Android lo redacta de otra
  forma, la diferencia se investigará; no se relajará la comparación.
- La sonda `unlistedColumns` altera el esquema de la base **sintética** (no se puede quitar una columna en SQLite
  3.9). Por eso corre la última, y cada campaña empieza con `pm clear`.
- En una ejecución completa de Jest falló una vez `subscriptionAtomicityPhase4`. Pasó sola y en la siguiente
  ejecución completa (1.197/1.197). Es intermitente y ajena a 1a.3A; no se capturó el detalle del fallo.
- Siguen pendientes, fuera de esta fase: el reinicio del plan al cambiar sus condiciones (1a.3B), el escenario C,
  la migración 5 y los `REPLACE` restantes en categorías, alertas y ajustes.

## 9. Criterios para cerrar la Fase 1a.3A

1. Node: Jest completo, `tsc`, ESLint y `git diff --check` en verde; la referencia 1a.3A es determinista.
2. API 24 y API 35: **223/223**. `phase1a3a-identity` con 1.123 campos y 0 diferencias; atomicidad con 6 y 10
   escrituras y 32 rollbacks exactos; `unknown` sin reintento; reinicio con la edición única.
3. Regresiones con sus oráculos originales: 10/10/10 y 8/8/8 escrituras; 5.530 campos de 1a.2 sin diferencias.
4. `authorization-inventory.cjs verify`: guards sin cambios. `com.smartfin` sin modificaciones.
5. Si cualquier campo difiere, la fase sigue abierta y se investiga la causa. No se ajusta la referencia ni se
   añade tolerancia. No se avanza a 1a.3B sin decisión del propietario.

## 10. Resultados (2 nov 2026, ejecutada con autorización del propietario)

Verificaciones previas:
- `authorization-inventory.cjs verify`: `protectedFilesUnchanged: true`, sin cambios ni añadidos.
- Workspace y checkout iguales a la atestación `fe6d5789…` (también la embebida).
- Metadatos de `com.smartfin` registrados antes de empezar (`android/com.smartfin-before-api{24,35}.txt`).
- El emulador API 24 ya estaba arrancado: no se ejecutó el paso 3.

**APK** ([`authorization/apk-identity.json`](authorization/apk-identity.json), compilación en `android-build.log`):

| Campo | Valor |
|---|---|
| SHA-256 | `2a5d613ff99be15a1a1b52759e98d0569a076c5a5fe7e1cb57679c4348f518a3` |
| Tamaño | 33.310.716 bytes, release |
| Atestación | `fe6d57895a37def3e6f26d7d60c636abe56e5173581b73c8294d1e417cd8417e`, idéntica a la embebida en `assets/` |
| Paquete | `com.smartfin.snapshot5b2.tests`, no depurable (`aapt`) |
| Bundle | Hermes (cabecera `C6 1F BC 03`). Contiene `phase1a3a-identity`, `saveSQLiteRowPreservingIdentity`, `runPhase1A3AMatrix` y `SELECT 1 AS present`; ningún `INSERT OR REPLACE INTO credit_card_statements` ni `… installment_purchases` |
| Fuentes | 302 de producción. `apk-identity.cjs` comprobó todas las preparadas y del checkout, y que no se reutiliza ninguna atestación ni APK de 6B.3 o 1a.2 |

| Campaña | API 24 (`emulator-5554`, SQLite **3.9.2**) | API 35 (`AXCC6R3919012932`, SQLite 3.44.5) |
|---|---|---|
| `phase1a3a-identity` | **11/11**: 1.123 campos, 0 diferencias | **11/11**: 1.123 campos, 0 diferencias |
| `phase1a3a-atomicity` | **37/37**: 6 y 10 escrituras; 32/32 rollbacks; 350 campos, 0 diferencias | **37/37**: ídem |
| `phase1a3a-unknown` | 3/3 | 3/3 |
| `phase1a3a-unknown-restart` | 4/4: 84 campos, 0 diferencias | 4/4: ídem |
| `phase6b3-atomicity` | 66/66 (10/10/10; 60/60 puntos) | 66/66 (10/10/10; 60/60) |
| `phase1a2-atomicity-historical` | 53/53 (8/8/8; 48/48 puntos) | 53/53 (8/8/8; 48/48) |
| `phase1a2-statements` | 13/13: 5.530 campos, 0 diferencias | 13/13: ídem |
| `phase6b3-probes` | 12/12 | 12/12 |
| `phase6b3-unknown` / `-unknown-restart` | 3/3 + 3/3 (un único pago) | 3/3 + 3/3 (un único pago) |
| `phase6a-precision` | 18/18 | 18/18 |
| **Total** | **223/223** | **223/223** |

Detalle:
- **Node–Android:** 0 diferencias en todos los casos comparados. Por dispositivo: 1.123 campos de identidad, 350 de
  atomicidad, 84 del reinicio, 5.530 de 1a.2 y los oráculos 6B.3/6A sin cambios.
- **Atomicidad:** 140 puntos de fallo por dispositivo, todos rollback confirmado con el estado exacto (`rowid`,
  dependientes, revisión, saldos, deuda, patrimonio y métricas) y nuevo propietario confirmado:
  - 32 de las matrices 1a.3A (12 de la edición del plan y 20 del pago);
  - 60 de `phase6b3-atomicity` (con los puntos de extracto 3 y 10, ahora `UPDATE`);
  - 48 de la matriz histórica.
- **Claves foráneas:** en los dos dispositivos, plan, extracto y perfil con referencias inexistentes se rechazan con
  `FOREIGN KEY` y sin filas. `foreign_key_check` queda vacío en todos los pasos. Los hijos `CASCADE` y `SET NULL`
  sintéticos sobreviven a ediciones, pagos y reconciliaciones.
- **Identidad y columnas heredadas:** mismo `id`, `rowid` y `created_at`, `updated_at` actualizado. La columna
  sintética conserva `kept` y un extracto nuevo recibe el DEFAULT, también en SQLite 3.9.2.
- **Recuperación:** `unknown` sin reintento (mismo fallo) y conexión retirada. Tras reiniciar, el plan
  `installment-T1` (`rowid` 1, `created_at` original) aparece editado una sola vez, con un único movimiento, sus 4
  dependientes e integridad correcta. En 6B.3, un único pago tras reabrir.
- **`com.smartfin`:** sin cambios en las 22 campañas (`production-package-unchanged.json`) y metadatos idénticos
  antes y después (`com.smartfin-after-api{24,35}.txt`). En el emulador API 24 no está instalado.
- **Guards:** `authorization-inventory.cjs verify` final da `protectedFilesUnchanged: true`, sin cambios ni
  añadidos.

**Veredicto:** se cumplen los criterios de la sección 9. La Fase 1a.3A queda validada en API 24 y API 35.
