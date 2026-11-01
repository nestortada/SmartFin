# Propuesta de autorización — 6B.3.1, revisión r2

Fecha: 1 de noviembre de 2026, America/Bogota. Estado: **pendiente de aprobación del propietario.**
Nada de lo descrito aquí se ha ejecutado contra un dispositivo en esta sesión.

## 0. Por qué hace falta una autorización nueva

- El dangerous-command-guard está **activo** en esta sesión. Rechazos observados:
  - `DG-CLAUDE: Unsupported or ambiguous tool input` (Bash compuesto).
  - `DG-CLAUDE-RUNNER: Only the exact audited 6B.2 API24 runner launch is allowed` (cualquier orden que nombre un `.ps1`).
  - `DG-PATH: Destination is outside SmartFin` (escritura fuera del repositorio).
- `.claude/hooks/phase6b2-runner.cjs` solo admite `./scripts/phase6b2/run-all.ps1 -Serial emulator-5554 -Api 24`
  con el APK 6B.2 `85af989b…`. Ese APK no contiene 6B.3 y no sirve para aceptarla.
- `README.md` de esta carpeta documenta una ejecución anterior basada en la declaración de que el hook estaba
  desactivado. Esa autorización pertenece a otra sesión. **No se reutiliza.**
- La runtime de la consola Node sí permitiría `node script.cjs` (los scripts son límites de ejecución para el
  core). Lanzar adb mediante un envoltorio Node eludiría el control. **No se ha hecho y no se propone.**

## 1. Defecto encontrado en el harness (no en producción)

Las campañas anteriores (`android/api24|api35/phase6b3-probes/result.json`, APK `49e9925f…`) fallaron en ambos
dispositivos con `scenarioA: $.next.initial.statement.minimum_payment_amount: Android=0 Node=1000`. Las sondas
B–E no llegaron a ejecutarse.

Causa: `saveManualTransaction` llama a `reconcileCreditCardTransactions` sin `currentDate`, así que el extracto
se calcula con el reloj real. Node ejecuta las sondas con `jest.setSystemTime(2026-10-11)`, mientras que el
dispositivo usaba su fecha real (2026-11-01). Por eso se seleccionó el periodo de noviembre, que no incluía la
compra del 11 de octubre. En producción `currentDate` es siempre «ahora», así que esto no cambia ningún resultado
financiero de usuario.

Reproducción en Node (`__tests__/phase6b3Reproduction.test.ts`):
- `6B.3.1 reproduction…`: con el reloj en 2026-11-01, una compra fechada el 2026-10-11 deja un extracto con
  total 0 y mínimo 0.
- `6B.3.1 probes do not depend on the device clock`: `scenarioA` da el mismo resultado con ambos relojes, y el
  mínimo es 1000.

Corrección (solo en la sonda, no en producción): `scripts/phase6b3/probes.ts` ejecuta cada sonda dentro de
`withPhase6B3Clock`, que fija `Date` en `PHASE6B3_DATE` y lo restaura al terminar. Es el mismo instante que ya
fija Jest, así que la referencia Node `docs/correccion-fase6b3/node/results.json` no cambia.
`refresh-harness.cjs` ahora refresca también `phase6b3Probes.ts`, con la misma reescritura de imports que
`prepare-android.cjs`.

## 2. Entradas y hashes SHA-256 (estado actual del checkout)

| Archivo | SHA-256 |
|---|---|
| scripts/phase6b3/refresh-harness.cjs | 2596c4ea33d19aa632f2acbf84f872c3f03e1596b0b9a03e21aacfe2b8cfa3f4 |
| scripts/phase6b3/probes.ts | 2d43bb02917abbbf80392b6507b81708b108db9ab1a307fabc312f475e7c5e6b |
| scripts/phase6b3/androidHarness.js | b9dbdee746d2b9b6784ab00a551083e9d745b526bc1069674aeb3e8c6655ee5e |
| scripts/phase6b3/run-all.ps1 | 38ad23bb33c906766487a5de2fa67c291de09516362da673cdff4948e399dfbc |
| scripts/phase6b3/run-android.ps1 | a2693a9b2c41128cf1c007a2147628dcccd2e5dc1199af08d9adb2511d5aa8a8 |
| scripts/phase6b3/capture-ui.cjs | 535ab7b2142a04010bff8e2cbdf58d9095baecfb3fdb4022d7c1b8e9689424f6 |
| scripts/phase6b3/make-runner.cjs (no se ejecuta) | 99c8f850dbeb013be2ee1cb886bf182d80a49e837659f0d78218e6bf468e96ad |
| scripts/phase6b3/prepare-android.cjs (no se ejecuta) | 0358fa484e58f37b5ab0d572686bc71a8ffab6ce6c61ba68b7a3bbcb93d6fb5b |
| scripts/phase6a/androidHarness.js (oráculo 6A corregido) | 4146a2fe238fb8dc595816af25dac314f8d0ac2c9cc91c37873108dd8c588e0e |
| __tests__/helpers/pre6B3CreditCardRelations.ts | 91d73a7231d4bfafbe83ab373bf648297fc9bbf45e19c2f6f9df3769c7cd117e |
| docs/correccion-fase6b3/node/results.json (referencia Node) | e7c12f1e2deb6cc4a26e7d41f683e6c3465708894057f50bbe8652d6b6b6b9b3 |
| src/modules/creditCards/ui/CreditCardsScreen.tsx | 1622da55cea2a30d846b58bad9349993a4ca03a90b1a04115251c743d30e0e2d |
| src/modules/creditCards/ui/components/CreditCardPayment.tsx | e42b5f72aa840038d88c20fb23893ff83f634a7889853f3c3e4f453ed0fbfa5c |
| src/modules/creditCards/useCases/creditCardTransactionRelations.ts | 03c0bc28023b2a8812b1086e54c8fefded36f1783aac85d5245e654f19444101 |
| src/modules/transactions/ui/components/CategorizationModal.tsx | 54d6a75fd2d55decf589950e3f875daa5e38237d5d020afe52e51c98531d9efe |
| src/modules/transactions/ui/components/TransactionCard.tsx | 165ea64f09917dc427dec04f1242dc919d5862c9465d4e42b6974363a9ed11a5 |
| src/modules/transactions/ui/transactionsScreenFormatters.ts | d7e797a0bd6e4385779d548e81bc724b9683cbd1bba1ccbd0ccf08547245e54f |
| src/shared/utils/copAmountInput.ts | 444d47fa70214d4d996fe9c2cb56aee517815f9d53b90cc701ec81e613c61932 |
| src/shared/utils/formatCurrency.ts | 2a7ea3e45a12e40cd6df461ceacb63df1c6bd2fc966e748cd429ca2ff1358d9a |

Las ocho fuentes de producción coinciden byte a byte con las atestadas en `C:/sf-6b3-20261101/source-fingerprints.json`
(`ff4932a2…`). La única entrada del APK que cambia es `scripts/phase6b3/probes.ts` (`9e0b954a…` → `2d43bb02…`).

APK actual del workspace (intento 02, **anterior a la corrección, no apto**): `49e9925f4ed39ef1b4930966833765fa27d3a327041809c9656d609952b54ffd`.

Herramientas: adb `b4a6b455…286b3f`, aapt 36.0.0 `c528418a…17b561` (mismos pines que 6B.2).

## 3. Etapa A — refresco y compilación (sin dispositivo)

Desde el repositorio, una orden por llamada:

```powershell
node scripts/phase6b3/refresh-harness.cjs
```

Escribe solo `C:/sf-6b3-20261101/phase6b3Harness.js`, `phase6b3Probes.ts`, `source-fingerprints.json` y
`android/app/src/main/assets/phase5b2-source-fingerprints.json`. Antes de escribir, verifica todas las fuentes
preparadas.

Desde `C:/sf-6b3-20261101/android`:

```powershell
./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'
```

Después, en el repositorio:
- Mover `authorization/apk-identity.json` a `authorization/apk-identity-attempt-02.json`.
- Escribir un `apk-identity.json` nuevo con el SHA-256 del APK y de la atestación.
- Mover las evidencias `android/api24/phase6b3-probes` y `android/api35/phase6b3-probes` a
  `android/api{24,35}/attempt-02/phase6b3-probes`, siguiendo la convención del intento 01. El runner se niega
  a sobrescribir evidencias, y no se borra ninguna.

**El propietario revisa `apk-identity.json` antes de la etapa B. El hash del APK nuevo es un pin de la etapa B.**

## 4. Etapa B — campañas en dispositivo

Destinos exactos:
- `emulator-5554`: AVD `SmartFin_Guard_Synthetic_API24`, API 24, pines AVD de `phase6b2-runner.cjs`.
- `AXCC6R3919012932`: HONOR `CRT-NX3`, API 35.

Paquete: `com.smartfin.snapshot5b2.tests`. Base: `/data/user/0/com.smartfin.snapshot5b2.tests/databases/phase5b2_synthetic.db`.

Órdenes exactas (literales, sin comodines):

```powershell
./scripts/phase6b3/run-all.ps1 -Serial emulator-5554 -Api 24
./scripts/phase6b3/run-all.ps1 -Serial AXCC6R3919012932 -Api 35
```

Cada una ejecuta `phase6b3-probes`, `phase6b3-atomicity`, `phase6b3-unknown`, `phase6b3-unknown-restart`
(conservando los datos sintéticos) y `phase6a-precision` (oráculo decimal corregido).

Escenas de interfaz: 12 órdenes literales, 6 campañas × 2 seriales.

```powershell
./scripts/phase6b3/run-android.ps1 -Serial <S> -Campaign <C> -Output docs/validacion-fase6b3-1/android/api<N>/<C> -KeepRunning
```

- `<S>/<N>` ∈ {`emulator-5554`/`24`, `AXCC6R3919012932`/`35`}.
- `<C>` ∈ {`phase6b3-presentation`, `phase6b3-ui-small`, `phase6b3-ui-cents`, `phase6b3-ui-insufficient`, `phase6b3-ui-stale`, `phase6b3-ui-unknown`}.

Captura de evidencia, una orden por escena. Es un lector pinado que exige el paquete sintético en primer plano:

```powershell
node scripts/phase6b3/capture-ui.cjs <S> <etiqueta>
```

Interacción con la pantalla real (secciones 5 y 6 del encargo). Requiere una decisión **separada** del propietario,
porque son escrituras de entrada en el dispositivo:
`adb -s <S> shell input tap <x> <y>`, `adb -s <S> shell input text <literal>`, `adb -s <S> shell input keyevent {4|66|67}`.
Solo se usan después de `capture-ui.cjs`, con el paquete sintético en primer plano, y con coordenadas tomadas de
la jerarquía capturada.

Efectos posibles en el dispositivo, todos sobre el paquete sintético:
- Instalación o actualización `install --no-streaming -r` del APK pinado.
- `am force-stop` y `pm clear` entre campañas independientes. En `unknown-restart` hay un cierre y una reapertura
  del proceso.
- Permiso de notificaciones (`pm grant`/`appops set`).
- `input keyevent 224` y `wm dismiss-keyguard`.
- Lectura de `dumpsys` power/battery/thermal y `logcat --pid` del proceso sintético.

Sin `uninstall`, sin wipe del AVD, sin reinicio del HONOR y sin escritura en `com.smartfin`.

Escrituras en el host: solo `docs/validacion-fase6b3-1/android/api{24,35}/…`, en carpetas nuevas.

## 5. Protección de `com.smartfin`

- Solo `dumpsys package com.smartfin`, antes y después de cada campaña. El runner aborta si cambia
  (`production-package-unchanged.json`).
- El UID sintético debe ser distinto del de producción, o el runner aborta. La base y el UID se comprueban en el
  propio `result.json`.
- El caso `isolation` exige que el paquete sintético **no pueda** leer la base de producción. Nunca se abren sus filas.
- `aapt dump badging` exige el paquete `com.smartfin.snapshot5b2.tests` y que el APK no sea depurable.

## 6. Extensión del guard que necesitaría el propietario

No la implementa el agente. Un módulo análogo a `phase6b2-runner.cjs`, cuya habilitación pueda retirarse, que
admita únicamente:
- Las 2 órdenes `run-all.ps1` y las 12 `run-android.ps1` literales anteriores, más
  `node scripts/phase6b3/refresh-harness.cjs`, `node scripts/phase6b3/capture-ui.cjs <S> <etiqueta>` y la orden
  Gradle de la etapa A.
- Con los pines siguientes:
  - Hashes de la sección 2 para runner y harness.
  - `source-fingerprints.json` posterior al refresco.
  - SHA-256 del APK de la etapa A.
  - Herramientas adb, aapt y node.
  - Ficheros e identidad del AVD.
  - Para el HONOR, serial, `ro.product.model=CRT-NX3` y `ro.build.version.sdk=35`.
  - Carpetas de salida inexistentes.
- La autorización de `input` adb, si se concede, por separado.

## 7. Fuera de alcance

Esquema, migraciones, driver, dependencias, reparación de saldos, semántica de cuotas, restauración o
respaldos automáticos, `BACKUP_PUBLICATION_UI_ENABLED` (sigue en `false`), analista semanal, campañas de
rendimiento ya aprobadas (sus caminos no cambiaron) y la siguiente fase.
