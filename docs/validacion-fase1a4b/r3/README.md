# Fase 1a.4B — r3: corrección del oráculo Node y preparación Android

7 de noviembre de 2026. **Preparación**: no se compiló ningún APK, no se instaló nada y no se ejecutó ninguna campaña
Android. La Fase 1a.4B **no** está cerrada.

## 1. Estado inicial y causa

- Rama `main`, commit `34eab43`. Sin cambios versionados; solo estaban sin versionar los archivos de r2
  (`__tests__/phase1a4bR2Diagnostic.test.ts`, `scripts/phase1a4b/r2/`, `docs/validacion-fase1a4b/r2/`).
- Causa demostrada en r2 ([informe](../r2/README.md)) y no reinvestigada. Android empieza cada campaña con una base nueva;
  el oráculo Node reutilizaba una sola base para `register`, `reversal` y `guards`. El `seed()` inserta 2 categorías,
  y `categories` tiene triggers de respaldo, así que solo la primera campaña de la sesión sumaba +2. Valores: Android
  25→33, Node 23→31; la edición suma +8 en ambos.

## 2. Cambios realizados

| Archivo | Cambio |
|---|---|
| `__tests__/phase1a4bAndroidEquivalence.test.ts` | `campaigns1a4b`: `register`, `reversal` y `guards` en tres `session()` independientes (base `:memory:` nueva, esquema y migraciones, conexión cerrada al terminar). Modo candidato `SMARTFIN_1A4B_CANDIDATE`: escribe en una ruta nueva fuera de `docs/`, nunca sobre la referencia |
| `docs/validacion-fase1a4b/node/results.json` | Promoción auditada: 2 hojas (§4) |
| `scripts/phase1a4b/r3/promote-reference.cjs` | Promoción excepcional: exige el SHA original, exactamente esas dos diferencias y coincidencia byte a byte; archiva el original y genera un informe. Un segundo intento falla |
| `__tests__/phase1a4bCampaignIsolation.test.ts` | Pruebas A–F (§5) |
| `__tests__/phase1a4bR2Diagnostic.test.ts` | Lee el original archivado (`r3/reference-before/results.json`, `d26e3a53…`), que es lo que r2 comparó. Su evidencia en `docs/.../r2/` no cambia |
| `scripts/phase1a4b/r3/{inventory-r3,prepare-android-r3,make-runner-r3,apk-identity-r3}.cjs` | Inventario, workspace, runners e identidad del APK r3 |

Sin cambios en `seed()`, `probes.ts`, triggers, migración 5, producción, hooks ni guards. Las categorías siguen en las
observaciones y la comparación de `financial_data_revision` sigue siendo estricta.

Aislamiento: cada campaña crea su base, aplica `SQLITE_SCHEMA_STATEMENTS` y las migraciones versionadas, ejecuta su
`seed()` con el reloj fijo `withPhase1A2Clock` y cierra la conexión. Lo único que persiste en memoria del proceso entre
campañas es la secuencia `tx_manual_<n>` de `saveManualTransaction`. Las sondas la canonicalizan (`M1…`) y la prueba B
demuestra que no influye en el resultado.

## 3. Verificación antes de regenerar

El candidato (`artifacts/phase1a4b-r3/candidate-results.json`, determinista: dos ejecuciones iguales) frente al original:
**exactamente 2 diferencias**. Se compararon 48.851 hojas, con las mismas claves en el mismo orden, el mismo orden de filas y
el mismo tamaño (2.798.089 bytes). Sin cambios en importes, cuentas, deuda, cupo, patrimonio, movimientos, extractos,
imputaciones, revisiones, idempotencia ni cobertura de fallos (158 puntos 1a.4B y `writes` 18/19/13/29).

## 4. Promoción de la referencia

| | |
|---|---|
| SHA-256 original | `d26e3a53f5cb89d673a83886f5fd6af6932956615c42348e2e55c2b287ba675f` (archivado byte a byte en `r3/reference-before/results.json`) |
| SHA-256 nuevo | `1faa219207d86d95f7b55f3e3446243d3d6194bbd974e7018089e7acce41bd1b` |
| `$.phase1a4b.reversal.editAmount.observation.backupRevision` | 31 → **33** |
| `$.phase1a4b.guards.deletePurchase.observation.backupRevision` | 23 → **25** |
| Informe | [`reference-update.json`](reference-update.json) |
| Protección | El script exige `d26e3a53…`: tras la promoción, cualquier nuevo intento falla. Jest redirige a `artifacts/` toda escritura dirigida a `docs/`. La prueba de evidencia sigue negándose a sobrescribir |

Referencias históricas intactas (mismo SHA que en el inventario r1): 1a.4A, 1a.4A r2, 1a.3B, 1a.3A, 1a.2 y 6B.3. 6A no
tiene `results.json`: su oráculo vive en `scripts/phase6a` y `__tests__/helpers`, sin cambios.

## 5. Pruebas de aislamiento (`phase1a4bCampaignIsolation.test.ts`, 7/7)

- Campañas aisladas = referencia promovida, campo a campo.
- **A.** `reversal` después de `register` = `reversal` sola en una base nueva.
- **B.** El orden `guards`, `reversal`, `register` da los mismos resultados.
- **C.** Repetir cada campaña en una base nueva da el mismo resultado completo.
- **D.** En una base nueva: seed 6 (4 cuentas + 2 categorías), antes de editar 25, final 33. Repetido en la misma base:
  4, 23 y 31. La edición D6 suma +8 en ambos casos. Todo lo demás del estado final es igual.
- **E.** Frente a la disposición antigua (base compartida) solo cambian las dos hojas de §4. La disposición antigua
  reproduce el original archivado.
- **F.** Una escritura ordinaria hacia `results.json` desde Jest se redirige; la promoción sin autorización, o repetida,
  falla sin tocar nada.

## 6. Validación Node

| Verificación | Resultado |
|---|---|
| Aislamiento A–F | 7/7 |
| Equivalencia 1a.4B (`phase1a4bAndroidEquivalence`) | 10/10 (determinista, independiente del orden de claves, sin neutralizaciones) |
| Pagos extraordinarios / idempotencia / D6 (`extraordinaryInstallmentPaymentPhase1a4B`) | PASS |
| Diagnóstico r2 | 6/6 |
| Migración 5 e historial (`installmentHistoryPhase1a3B`, `civilDateCheckPhase1a3B`), 1a.4A (`initialInstallmentRevisionPhase1a4A`, `phase1a4aAndroidEquivalence`) | PASS |
| 1a.3B y 1a.3A (`phase1a3bAndroidEquivalence`, `phase1a3aAndroidEquivalence`, `safePersistencePhase1a3A`) | PASS |
| 1a.2 (`creditCardStatementsPhase1a2`, `phase1a2StatementsProbes`); 6B.3 (`phase6b3HarnessRollbackOracle`, `phase6b3Reproduction`, `creditCardSettlementPhase6B3`); 6A (`dashboardPhase6APrecision`) | PASS |
| Jest completo, ejecución 1 | 1386 aprobadas, **1 fallo**, 14 omitidas (1401) |
| Jest completo, ejecución 2 | **1387 aprobadas, 0 fallos, 14 omitidas** (1401); 92 suites aprobadas, 7 omitidas |
| Reproducciones financieras | 29/29 (6 suites) |
| TypeScript | `tsc --noEmit` sin errores |
| ESLint | 0 errores; 5 advertencias previas en archivos no tocados (`phase5e3`, `phase6a`, `phase6b`) |
| `git diff --check` | Sin problemas (solo avisos LF/CRLF) |

**Fallo intermitente sin relación con esta ronda, que no se oculta:** en la ejecución 1,
`subscriptionAtomicityPhase4.test.ts` («maintenance requests share one run…») falló con `RangeError: Maximum call stack size
exceeded` en las transacciones con callbacks síncronos de `__tests__/helpers/realSQLite.ts`. Ni la suite ni el adaptador
ni `src/` cambiaron. Aislada pasó 3 de 3 (14/14) y en la ejecución 2 pasó. Riesgo: la profundidad de pila del adaptador
de pruebas está cerca del límite en ejecuciones largas con `--runInBand`. Queda documentado y fuera de alcance.

Las 14 pruebas omitidas son las mismas, documentadas históricamente. Ninguna ejecución ordinaria modificó `results.json`
(el SHA `1faa2192…` se comprobó tras cada ejecución).

## 7. Auditoría preventiva (solo lectura)

| Grupo | Sesiones Node frente a campañas Android | Riesgo |
|---|---|---|
| 1a.4B register / reversal / guards | Antes compartida; **ahora 1:1** | Corregido |
| 1a.4B idempotency, atomicity, unknown + restart | 1:1 (sesión propia; restart en archivo y `PreserveData` en Android) | Ninguno |
| 1a.4A (7 campañas) | 1:1 | Ninguno |
| 1a.3B (upgrade, startup ×3, migration-atomicity, integrity, flows) | 1:1 | Ninguno |
| 1a.3A (identity, atomicity, unknown, unknown-restart) | 1:1 | Ninguno |
| 1a.2 statements | Node: una sesión por sonda; Android: una base por campaña | Bajo: la observación excluye `categories`, `subcategories`, `app_settings` y `financial_data_revision`, y la misma parte ya pasó en Android en 1a.4A r2 |
| 6B.3 / 6A | Oráculos propios, sin cambios; ya aprobados en Android | Ninguno |

Solo el `seed()` de 1a.4B inserta en una tabla con triggers que el reset no vacía (`categories`). Ninguna otra sonda
inserta en `categories` ni en `subcategories`. `app_settings` no tiene triggers de respaldo. Los relojes están fijados en
todas las sondas.

`android_metadata`: la tabla solo existe en Android. Los oráculos de estado ya la excluyen explícitamente
(`name <> 'android_metadata'`). El reset genera en Android un `DELETE FROM "android_metadata"` de más, que solo afecta a
las trazas diagnósticas de r2, donde se clasificó de forma explícita como evento de plataforma (sin normalización
general). Las campañas r3 no comparan trazas.

## 8. Preparación Android r3 (sin compilar)

| Elemento | Valor |
|---|---|
| Workspace | `C:/sf-1a4b-r3-20261107`, nuevo, copiado del r1 auditado (`5cbf8940…`, APK `e65e614a…`); sin `build/`; `node_modules` como junction |
| Atestación | `bf4a27c0292c9832a86ad5d55180e0ec03bd760a30e8552c88ede485b85daf54`, fase `1a.4B r3`, 390 archivos, embebida idéntica en `assets/` |
| Diferencias frente a r1 | Solo `phase1a4bNodeExpected.json` (exactamente las 2 hojas) y la atestación; las otras cuatro partes Node son idénticas byte a byte; no se incluye ningún archivo de r2 |
| Código | `src/` idéntico a r1, con la lógica real de 1a.4B (`reverseActivePaymentAllocations`, `requireNoActiveInstallmentAllocations`, `recordInitialInstallmentRevision`). `extraordinaryInstallmentPayment` solo aparece en su propio archivo: no se exporta desde `index.ts` ni se usa en pantallas |
| Expectativas | `editAmount` = **33**, `deletePurchase` = **25**; sin exclusiones |
| Paquete | `com.smartfin.snapshot5b2.tests` |
| Inventario | `r3/authorization/inputs.sha256.json` (930 entradas); `verify`: guards, producción, referencias históricas y evidencias r1/r2 intactos; añadidos solo los dos runners |
| Identidad del APK | `apk-identity-r3.cjs` rechaza r1, r2 (intentos 1 y b) y todos los anteriores |
| Runners | `run-android-r3.ps1` y `run-all-r3.ps1`, derivados mecánicamente (hashes r1 fijados): `emulator-5554` (API 24) y `AXCC6R3919012932` (API 35), las 32 campañas, `pm clear` del paquete sintético antes de cada campaña salvo las de reinicio, evidencia en `r3/android/api<N>/` |

Campañas por dispositivo: **502 casos** y **356 puntos de fallo**. Nuevas 1a.4B: 213 casos (register 9, reversal 13,
guards 15, idempotency 4, atomicity 165, unknown 3, unknown-restart 4) y 158 puntos (2 × (18 + 19 + 13 + 29)).
Históricas: 289 casos y 198 puntos, con las sondas y partes de referencia sin cambios respecto de r1.

## 9. Comandos (requieren una nueva autorización)

Desde `C:/Users/nesto/Proyectos/SmartFin`, un comando por llamada:

1. `node scripts/phase1a4b/r3/inventory-r3.cjs verify`
2. En `C:/sf-1a4b-r3-20261107/android`: `./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'`
3. `node scripts/phase1a4b/r3/apk-identity-r3.cjs`
4. `./scripts/phase1a4b/r3/run-all-r3.ps1 -Serial emulator-5554 -Api 24`
5. Solo si API 24 aprueba todo: `./scripts/phase1a4b/r3/run-all-r3.ps1 -Serial AXCC6R3919012932 -Api 35`
6. `node scripts/phase1a4b/r3/inventory-r3.cjs verify`

## 10. Riesgos pendientes y veredicto

- Fallo intermitente de pila en `subscriptionAtomicityPhase4` (§6), ajeno a 1a.4B.
- La asimetría de sesiones de 1a.2 (§7) tiene riesgo bajo y está probada en Android.
- `results.json` y la prueba de equivalencia quedan modificados sin commit: hasta que se confirmen, el workspace r3 depende
  del estado actual del checkout (el runner verifica los hashes).

**Veredicto: preparación r3 aprobada.** Node y Android usan condiciones iniciales equivalentes, la referencia actual
contiene solo las dos correcciones autorizadas, las referencias históricas, los guards y los invariantes financieros
siguen intactos, las pruebas Node relevantes pasan y el workspace y la atestación r3 están listos. Compilación y
ejecución Android pendientes de autorización.

## 11. Ejecución r3 (7 de noviembre de 2026): detenida en `phase1a3b-flows` (API 24)

**Comprobaciones previas:** sin incidencias.

- Inventario r3 (`verify`): guards, producción, referencias históricas y evidencias r1/r2 intactos.
- Atestación: `bf4a27c0292c9832a86ad5d55180e0ec03bd760a30e8552c88ede485b85daf54`, embebida idéntica, 0 diferencias
  workspace–atestación y checkout–atestación.
- Referencia: `1faa219207d86d95f7b55f3e3446243d3d6194bbd974e7018089e7acce41bd1b`, con solo las dos hojas aprobadas.
- El caso de uso solo aparece en su propio archivo.
- Sin procesos residuales de compilación o validación.

**APK r3:** `C:/sf-1a4b-r3-20261107/android/app/build/outputs/apk/release/app-release.apk`.

- SHA-256 `f4ffd9d8520cdd640be90f48031268040588f1bf2f060354c8e2562248696af5`, 33.810.364 bytes.
- Build offline en 4 min 16 s ([log](android-build.log)).
- Atestación embebida `bf4a27c0…`, Hermes (`C6 1F BC 03`), paquete `com.smartfin.snapshot5b2.tests`, release sin
  `debuggable`.
- Frente a r1 solo cambia `phase1a4bNodeExpected.json`.
- `apk-identity-r3.cjs` rechazó los APK y atestaciones de r1, r2 y anteriores ([identidad](authorization/apk-identity.json)).

### API 24 (`emulator-5554`, AVD `SmartFin_Guard_Synthetic_API24`), [log](android-api24.log)

| Campaña | Resultado | Puntos de fallo |
|---|---|---|
| `phase1a4b-register` | 9/9 | — |
| `phase1a4b-reversal` | 13/13 (`editAmount`: `backupRevision` = **33**, 181 campos iguales a Node) | — |
| `phase1a4b-guards` | 15/15 (`deletePurchase`: `backupRevision` = **25**, 166 campos iguales a Node) | — |
| `phase1a4b-idempotency` | 4/4 | — |
| `phase1a4b-atomicity` | 165/165 | 158 `rolledBack` confirmados |
| `phase1a4b-unknown` | 3/3 (`unknown`, sin reintento, conexión retirada) | — |
| `phase1a4b-unknown-restart` | 4/4 (un pago y una imputación; la repetición no escribe) | — |
| 1a.4A (7 campañas) | 66/66 | 28 |
| `phase1a3b-upgrade`, `-startup-seed`, `-startup-upgrade`, `-upgrade-restart` | 16/16 | — |
| `phase1a3b-migration-atomicity` | 33/33 | 30 |
| `phase1a3b-integrity` | 13/13 (incluido el cambio de contrato D6 `activeAllocationGuards`) | — |
| `phase1a3b-flows` | **2/3, fallo en `v4-v5-flows`** | — |
| Resto (1a.3A, 1a.2, 6B.3, 6A: 11 campañas) | **No ejecutadas** (política de detención) | — |

Totales ejecutados: 21 de 32 campañas, **343 de 344 casos** (de 502 previstos) y **216 de 356 puntos de fallo**, todos con
rollback confirmado (ninguno `unknown`). Las 7 campañas nuevas de 1a.4B pasan íntegramente (213/213, 0 diferencias frente
a Node en 8.110 campos comparados). API 35 (`AXCC6R3919012932`, conectado): **no ejecutado**.

### Primera discrepancia: `phase1a3b-flows / v4-v5-flows`

`scripts/phase1a4b/phase1a3bProbes.ts:918` (sonda 1a.3B derivada para 1a.4B por `derive-probes.cjs`) exige el texto
literal del error de SQLite:

- Node (SQLite 3.53.0): `other: no such table: installment_allocations`.
- Android (SQLite 3.9.2 a través de `SQLiteConnection`):
  `other: no such table: installment_allocations (code 1): , while compiling: SELECT 1 AS found FROM installment_allocations a …`.

Mismo error y misma tabla. El driver Android añade el código y la sentencia al mensaje. `errorClass()` no tiene una
clase para «no such table», así que devuelve el texto completo del driver. La referencia Node guarda ese texto en
`$.phase1a3b.flows.version4Incompatible.outcome`. Es un defecto del **arnés** introducido en la derivación 1a.4B, que se
ejercitó por primera vez en Android en esta ronda: r1 se detuvo antes. Producción no está implicada: en versión 4 el
paso protegido falla como en Node, porque las tablas de imputación no existen.

Lo que esta ejecución **no** demostró: la sonda lanzó el error antes de comprobar `stateUnchanged` en versión 4 y antes de
ejecutar la mitad versión 5 de `flows`. Esas comprobaciones siguen sin verificar en Android.

Corrección mínima propuesta (requiere autorización; no aplicada):

- Clasificar el error por su contenido estable en las sondas derivadas, a través de `derive-probes.cjs` (hash fijado).
  Por ejemplo: `/no such table: (\w+)/` → `other: no such table: <tabla>`, que en Node produce exactamente la misma
  cadena, así que no hace falta cambiar ninguna referencia.
- Después, nuevo workspace, atestación y APK (r4) y repetición completa en API 24 desde la primera campaña.
- Alternativa: una clase nueva (`missingTable:<tabla>`). Exigiría cambiar una hoja de la referencia actual y la
  expectativa de `phase1a4bAndroidEquivalence.test.ts:320`.

### Estado final

- `com.smartfin`: `production-package-unchanged.json` con `unchanged: true` en las 21 campañas (no está instalado en el
  emulador).
- Inventario r3 (`verify`): sin cambios, guards intactos.
- Emulador API 24 apagado (se arrancó para la ronda con `-no-snapshot-save`).
- Sin commit ni push. Sin cambios en producción, migraciones, triggers, oráculos ni aserciones durante la ejecución.

**Veredicto:** la validación Android r3 **no** se aprueba. API 24 está incompleta (343/344 casos ejecutados, 11 campañas
pendientes) y API 35 no se ejecutó. La Fase 1a.4B no está validada técnicamente. Las limitaciones de idempotencia
después de editar o borrar un pago siguen abiertas (§12).

## 12. Idempotencia: campos verificables (sin cambios)

| Momento | Verificable bajo el mismo `command_id` | No verificable |
|---|---|---|
| Pago vigente sin editar | compra, tarjeta, importe imputado, importe del pago, cuenta origen | — |
| Tras editar o borrar el pago | compra, tarjeta, importe imputado (fila de imputación) | importe original del pago y cuenta origen (`otherPaymentAmount` y `otherSource` se responden `replayed` con 0 escrituras) |

Android API 24 lo confirmó, igual que Node. Repetir el comando nunca recrea el pago ni reactiva la imputación revertida
(`repeatAfterEdit` y `repeatAfterDeletion`: 0 escrituras, estado `reversed`). La limitación de los campos no verificables
**sigue abierta**.
