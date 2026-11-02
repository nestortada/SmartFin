# SmartFin — Fase 0: línea base confiable y reproducción de defectos

1 de noviembre de 2026, America/Bogota. Fase de **diagnóstico**: no se modificó código de producción
(`src/`, `android/`), esquema, migraciones, dependencias ni reglas contables. Solo datos sintéticos y SQLite
en memoria. Sin commits ni push.

Pruebas: [`__tests__/reproductions/`](../__tests__/reproductions) (`npm run test:reproductions`).
Evidencias: [`linea-base-fase0/node/`](linea-base-fase0/node) (generadas a propósito con
`SMARTFIN_WRITE_EVIDENCE=1`).

## A. Estado inicial

- `main` en `09c7ac8` («Mejorar el hook», 1 nov 2026), árbol limpio. La auditoría de referencia es de
  `8985346`; desde entonces entró 6B.3 (liquidación «Pagar deuda total»), así que se comprobó todo de nuevo.
- Node `v24.16.0` (SQLite de `node:sqlite` 3.53.0), npm 11.13.0. Única instalación de Node del sistema;
  además existe el Node 24.11.1 (SQLite 3.50.4) que trae Playwright, usado solo para reproducir 2.1.
- Hook PreToolUse `dangerous-command-guard.cjs` v2 activo. Bloqueó `git restore` (ver 2.3); no se eludió.
- Dispositivos (consultas `adb` de solo lectura): `emulator-5554` API 24 y HONOR `CRT-NX3` API 35.
- Línea base: Jest **77 suites aprobadas, 7 omitidas; 1.044 pruebas aprobadas, 14 omitidas; 8 snapshots**
  (383 s). `tsc` 0 errores. ESLint 0 errores, 5 advertencias previas (`scripts/phase5e3`, `phase6a`, `phase6b`).
- Problema previo confirmado: esa ejecución reescribió 6 evidencias versionadas (solo tiempos medidos):
  `atomicidad-fase3a1/node-equivalence.json`, `atomicidad-fase4/node-maintenance-comparison.json`,
  `atomicidad-fase4/node-subscriptions-matrix.json`, `correccion-fase6b1/node/results.json`,
  `correccion-fase6b2/node/results.json`, `performance/shared-commands/node-reader-wait.json`.

## B. Cambios realizados

| Área | Cambio |
|---|---|
| Node | `.nvmrc` = `24.16.0`; `engines.node` = `>=24.16.0 <25` (`package.json` y raíz de `package-lock.json`). Scripts `typecheck` y `test:reproductions`. |
| Arnés NUL | `transactionHistoryRefinement.test.ts`: filas identificadas por `rowid` y comprobación byte a byte (`hex(CAST(value AS BLOB))` frente a `Buffer` en UTF‑8/16le/16be); la prueba de repositorio verifica además los bytes almacenados con NUL. |
| Evidencias | `__tests__/setup/redirectEvidenceWrites.js` (en `setupFiles`): las escrituras, renombrados y borrados hacia `docs/` van a `artifacts/jest-evidence/docs/` (ignorado por Git). `SMARTFIN_WRITE_EVIDENCE=1` restaura la escritura intencional; las lecturas de evidencia histórica no cambian. |
| CI | `.github/workflows/ci.yml`: checkout, Node desde `.nvmrc`, `npm ci`, verificación no mutante de los parches SQLite, `tsc`, ESLint, Jest estable, reproducciones, árbol limpio y artefacto de evidencias. |
| Reproducciones | `jest.reproductions.config.js` y 7 suites `*.repro.ts[x]` separadas de la estable. |
| Documentación | Este informe y la sección 7 de `PRUEBAS_Y_CALIDAD.md`. |

### 2.1 NUL y versión de Node

Causa demostrada: `node:sqlite` de Node 24.11.1 trunca al **leer** un TEXT con NUL (`'a\0SECRET'` →
`'a'`), aunque SQLite guarda los 8 bytes (`hex` = `6100534543524554`). Node 24.16.0 devuelve la cadena completa.
Las 3 pruebas `test.each` construían el conjunto de candidatos con las cadenas devueltas, así que fallaban con
24.11.1 (reproducido: 3 fallidas, 6 aprobadas) aunque el prefiltro SQL sí incluía la fila. Tras el cambio, 9/9
en ambas versiones. No se quitó ninguna aserción: la comprobación de candidatos se mantiene y se añadió la de
bytes, que detecta truncado o corrupción en el almacenamiento. Es un problema del adaptador de pruebas: la app
usa `react-native-sqlite-storage`, no `node:sqlite`.

### 2.2 Instalación

`npm run postinstall` es idempotente sobre la instalación actual («ya estaba parcheado» y «parche de
recuperacion de sesiones verificado»; hashes sin cambios). El fallo de la auditoría aparece si se instala sin
scripts (`--ignore-scripts`). La CI usa `npm ci` con scripts y después comprueba, sin parchear, `build.gradle`
(sin `jcenter()`) y `SQLitePlugin.java` (`sqliteAndroidRecoveryPatch.test.ts`). No se ejecutó `npm ci` en local
para no borrar `node_modules`, que contiene compilaciones Android.

### 2.3 Evidencias

Comprobado: con la redirección, `creditCardReconciliationEquivalence` (escribe sin `mkdir`) y
`financialAuditPhase6B` dejan sus JSON en `artifacts/`; los SHA‑256 de los 14.270 archivos versionados de `docs/`
no cambian. **Pendiente para el propietario:** el guard denegó `git restore` de los 6 archivos reescritos por la
ejecución de línea base (DG2: descarta cambios del árbol). Siguen modificados (solo tiempos) y deben
restaurarse a mano:

```bash
git restore -- docs/atomicidad-fase3a1/node-equivalence.json docs/atomicidad-fase4/node-maintenance-comparison.json docs/atomicidad-fase4/node-subscriptions-matrix.json docs/correccion-fase6b1/node/results.json docs/correccion-fase6b2/node/results.json docs/performance/shared-commands/node-reader-wait.json
```

## C. Resultados de reproducción

Convención: prueba de **caracterización** (fija el comportamiento actual) + `test.failing` de **aceptación**
(comportamiento esperado; criterio de la Fase 1). Se verificó que cada aceptación falla por su aserción y no por
un error del arnés.

| Defecto | Estado | Evidencia | Prueba |
|---|---|---|---|
| Extractos multiciclo | **Confirmado** | 600.000 a 6 cuotas, 7 ciclos (cierre día 20): extractos `[100.000, 0, 0, 0, 0, 0, 0]`, del 2.º en adelante `open`. Con otra compra de 300.000×3 en el 2.º ciclo: `[100.000, 100.000, 0, …]` (esperado 900.000 en total). Deuda (600.000), gasto (una vez, en octubre) y patrimonio (400.000) **son coherentes**: solo falla el extracto, que solo suma compras fechadas dentro del ciclo. **Corregido en la [Fase 1a.2](correccion-fase1a2.md)**: la reproducción se retiró y sus aceptaciones son regresiones estables. | `creditCardStatements.repro.ts` (retirada en 1a.2) |
| Progreso de cuotas | **Confirmado** | Pagando 100.000 por ciclo la deuda llega a 0, `paidInstallments` sigue en 0, el plan `active` y el cierre se rechaza («compras a cuotas vigentes»). Igual con «Pagar deuda total». Ningún código de producción escribe `paid_installments` (solo la siembra demo). Facturadas vs pagadas: **pendiente de decisión** (tras 3 ciclos: 300.000 pagados, 1 extracto con cargo, progreso 0). | `creditCardInstallmentProgress.repro.ts` |
| Redondeo | **Confirmado** | Se guarda una sola cuota `Math.round(total / n)` en pesos: 100.000/3 → 33.333 (−1); 100.000,50/3 → 33.334 (+1,50); 100.000,01/3 → −1,01; 2/3 → +1; 1/3, 0,40/2 y 0,01/2 → cuota 0. 600.000/6 exacto. Compra, deuda y gasto conservan el total exacto; solo se desvía lo facturado. | `installmentRounding.repro.ts` |
| Primera instalación | **Confirmado** | Base nueva (mismo `applySchema` + migraciones): 0 categorías, sin «Otros». Crear una categoría funciona; borrarla falla («No existe la categoria Otros…») y el movimiento conserva su categoría (FK íntegra). Con «Otros» presente la reasignación funciona. El borrado financiero elimina «Otros» y el fallo reaparece. Referencias de tarjeta: **descartado** (la «Tarjeta por clasificar» se crea bajo demanda con FK válidas). | `firstInstallCategories.repro.ts` |
| Cuenta débito | **Descartado** (hipótesis) · hallazgos nuevos | Renombrar desde `DebitCardsScreen` deja 123.456,78 exacto (`REAL`), sin movimientos ni cambio de patrimonio. **Ambiguo:** el campo «Saldo actual» muestra `123457`; reescribirlo cambia el saldo +0,22 sin movimiento. **Confirmado (nuevo):** renombrar una cuenta con saldo −50.000,25 lo deja en 0 (`Math.max(0, …)`), sin movimiento. | `debitAccountEdit.repro.tsx` |
| Validación IA | **Confirmado** (parcial) | Rechazados sin escrituras: 0, −5, −0,40, `NaN`, ±∞ (el mensaje de 0 sigue con mojibake «Monto invÃ¡lido.», 6B-O1). Válidos exactos: 0,30, 0,49, 0,01, 1.234,56. **Aceptados fuera de contrato:** 0,004, 0,005, 10,005, 1e‑7 (saldo 999.999,996, etc.). Un importe positivo **sí** termina en 0: la cuota de una compra a crédito (0,40×2, 1,20×3). Suscripciones: 0,004 rechazado, 0,005 → 0,01 (ambiguo). | `aiAmountValidation.repro.ts` |
| Reconocimiento de voz | **Pendiente** (no ejecutable) | `rn-speech-recognition` 1.0.8, permisos `RECORD_AUDIO` e `INTERNET`. La app no pide `requiresOnDeviceRecognition`: se usa el servicio del sistema (`createSpeechRecognizer`), que puede usar red. Servicio por defecto: emulador API 24 → `GoogleRecognitionService` (googlequicksearchbox); HONOR → `GoogleTTSRecognitionService` (com.google.android.tts). Un error de red llega como mensaje genérico. No hay prueba sin conexión: requiere cambiar la conectividad del dispositivo y hablar al micrófono. El asistente IA (Gemini) es remoto en cualquier caso. | `speechRecognitionOptions.repro.tsx` |

## D. Resultados finales

| Verificación | Resultado |
|---|---|
| Jest estable (`npm test -- --ci --runInBand`) | **77 suites aprobadas, 7 omitidas, 0 fallidas; 1.044 aprobadas, 14 omitidas; 8 snapshots** (623 s). Igual que la línea base: sin regresiones. |
| Reproducciones (`npm run test:reproductions`) | 7 suites, 38 pruebas en verde: 23 de caracterización/descarte y 15 `test.failing` que fallan como se espera. |
| `tsc --noEmit` | 0 errores |
| ESLint | 0 errores; las mismas 5 advertencias previas |
| `git diff --check` | limpio |
| Evidencias históricas | SHA‑256 de los archivos versionados de `docs/` idénticos antes y después de las pasadas finales (salvo los 6 de la línea base, ver 2.3, y `PRUEBAS_Y_CALIDAD.md`, editado a mano) |
| GitHub Actions | Configurada y YAML validado; **no ejecutada** (sin push) |
| Android API 24 / API 35 / HONOR | **No ejecutado**: no hubo cambios de producción que validar y las campañas en dispositivo requieren autorización expresa. Solo consultas `adb` de lectura (API, modelo, servicio de voz) |

Archivos: `.nvmrc`, `.gitignore`, `package.json`, `package-lock.json` (solo `engines`), `jest.config.js`,
`jest.reproductions.config.js`, `.github/workflows/ci.yml`, `__tests__/setup/redirectEvidenceWrites.js`,
`__tests__/transactionHistoryRefinement.test.ts`, `__tests__/reproductions/*` (7 suites y 3 helpers),
`docs/PRUEBAS_Y_CALIDAD.md`, este informe y `docs/linea-base-fase0/node/*.json`.

## E. Preparación para la Fase 1

1. **Defectos confirmados:** extractos multiciclo; progreso de cuotas y cierre bloqueado; redondeo de cuotas
   (pérdida/creación y cuotas de 0); «Otros» ausente en instalación nueva y tras el borrado financiero; reinicio
   a 0 de saldos negativos al editar una cuenta débito; importes IA con más de dos decimales; 6B-O1 sigue visible.
2. **Decisiones de negocio:** cuándo avanza `paidInstallments` (al facturar, al pagar, orden de imputación entre
   compras); ciclo de la primera cuota (el de la compra o el siguiente); reparto del residuo de redondeo (p. ej.
   última cuota); rechazar o redondear importes con más de dos decimales (movimientos y suscripciones); si el
   formulario débito puede reescribir el saldo y cómo (ajuste con movimiento, solo lectura o centavos); si las
   cuentas débito pueden tener saldo negativo.
3. **Riesgos de compatibilidad:** datos ya guardados con `monthly_amount` redondeado y `paid_installments = 0`;
   importes IA heredados fuera de contrato; extractos ya persistidos con total 0; bases instaladas sin categorías.
   Cualquier corrección que siembre «Otros» o recalcule progreso necesita migración revisada.
4. **Criterios de aceptación:** las pruebas `test.failing` de cada archivo `*.repro.ts[x]`. Al corregir, la
   caracterización falla, la aceptación pasa y ambas se reportan: se elimina la caracterización y la aceptación
   pasa a la suite estable.
5. **Bloqueantes:** primera ejecución de la CI en GitHub (requiere push); validación Android API 24 / API 35 y
   prueba de voz sin conexión, que necesitan autorización expresa. Además, las campañas `phase6b3-probes`
   versionadas en `validacion-fase6b3-1/android/api24|api35/` terminaron con `passed: false` en ambos dispositivos
   (`scenarioA … statement.minimum_payment_amount: Android=0 Node=1000`): la aceptación Android de 6B.3 sigue abierta
   y debe resolverse antes de declarar Android validado.
   **Actualización (Fase 1a.1):** la discrepancia ya está resuelta. Las campañas vigentes de
   `validacion-fase6b3-1/android/api24|api35/` (`phase6a-precision`, `phase6b3-atomicity`, `phase6b3-probes`,
   `phase6b3-unknown` y `phase6b3-unknown-restart`) aprueban 102/102 casos en cada dispositivo, con 1.715 campos
   de equivalencia Node–Android sin diferencias por dispositivo. Los intentos fallidos se conservan en
   `attempt-0N/` como evidencia del incidente.

### Cierre operativo (1 nov 2026)

- Las 6 evidencias de 2.3 difieren en 132 valores, todos numéricos y todos campos de tiempo (`oldMs`,
  `optimizedMs`, `operationMs`, `readerMs`, `medianMs`, `runs`, `readerWaitMs`); ninguna línea más. Se pueden
  restaurar sin pérdida, pero el propietario decidió dejarlas como están: no deben añadirse al commit de la Fase 0.
- CI: lockfile sincronizado con `package.json`; 0 conflictos de mayúsculas en 1.739 importaciones relativas de
  `src/`, `__tests__/` y `scripts/` (Linux distingue mayúsculas); todas las rutas que leen las pruebas existen y están
  versionadas; un único umbral de tiempo (30 s) en la suite estable.
