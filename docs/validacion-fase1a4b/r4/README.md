# Fase 1a.4B — r4: clasificación estable de «no such table» y preparación Android

7 de noviembre de 2026. **Preparación**: no se compiló ningún APK, no se instaló nada y no se ejecutó ninguna campaña
Android. La Fase 1a.4B **no** está aprobada.

## 1. Estado inicial

- Rama `main`, commit `34eab43`.
- Modificados sin commit (r3): `__tests__/phase1a4bAndroidEquivalence.test.ts` y `docs/validacion-fase1a4b/node/results.json`.
- Sin versionar: pruebas y scripts r2/r3 y evidencias `docs/validacion-fase1a4b/r2/` y `r3/`.
- Evidencia r3 conservada: APK `f4ffd9d8…`, atestación `bf4a27c0…`, 343/344 casos, parada en
  `phase1a3b-flows / v4-v5-flows` ([informe r3](../r3/README.md), §11).

## 2. Causa raíz reproducida

`__tests__/phase1a4bSqliteErrorClassification.test.ts`, parte 1 (escrita y aprobada **antes** de corregir):

- Mensajes reales:
  - Node: `no such table: installment_allocations`.
  - Android, leído de `r3/android/api24/phase1a3b-flows/result.json`:
    `no such table: installment_allocations (code 1): , while compiling: SELECT 1 AS found FROM installment_allocations a …`.
- Ninguno de los dos llega a las ramas previas de `errorClass()` (RAISE propios, CHECK, UNIQUE, FK, NOT NULL), así que r3
  devolvía `'other: ' + texto`. Las representaciones eran distintas aunque el error era el mismo.
- La consulta es la guarda 1a.4B `hasActiveAllocationsForPurchaseTransaction`. El patrón exacto se comprueba en Node y en
  la sentencia que Android cita después de `while compiling:`. Se ejecuta sobre la base v4: `DROP TABLE IF EXISTS
  installment_allocations` antes del intento, sin recreación.
- Errores SQL en toda la ejecución Node, ambos registrados:
  1. La guarda: `no such table`.
  2. El `DELETE FROM "accounts"` de la primera ronda de `resetSyntheticData`, que falla por FOREIGN KEY y se reintenta por
     diseño al resembrar la mitad v5.

  No hay una segunda causa en el paso protegido.
- Escrituras antes del fallo: **las hay** (`UPDATE` + `INSERT … WHERE NOT EXISTS` de `transactions`) dentro de la
  transacción `BEGIN IMMEDIATE` de `saveManualTransaction`. La guarda se ejecuta en `saveTransactionInstallments`, después
  de guardar el movimiento. Inmediatamente después viene `ROLLBACK`, no se confirma nada y la sonda compara el estado
  completo antes y después (todas las tablas, `rowid` y esquema).

## 3. Corrección (solo arnés)

| Archivo | Cambio |
|---|---|
| `scripts/phase1a4b/derive-probes.cjs` | Cuarto reemplazo mecánico sobre la fuente 1a.4A fijada (`07abad27…`): `missingTableName()` y su uso al principio de `errorClass()`; la mitad v4 de `flows` registra el mensaje completo del driver (`PHASE1A3B_V4_GUARDED_STEP_ERROR:` en el log) y lo añade al error si la comprobación falla |
| `scripts/phase1a4b/phase1a3bProbes.ts` | Regenerado por el generador (`d78e6073…` → `4883d7ef…`; +24/−4 líneas, solo esos dos puntos) |
| `__tests__/phase1a4bSqliteErrorClassification.test.ts` | Reproducción, pruebas positivas, negativas y malformadas, v4/v5 (27 pruebas) |

Sin cambios en `scripts/phase1a3b/probes.ts`, `scripts/phase1a4a/phase1a3bProbes.ts` (fuentes históricas), producción,
migración 5, triggers, oráculos ni guards.

**Clasificación anterior:** `'other: ' + mensaje completo`.

**Clasificación nueva:** `other: no such table: <tabla>`, solo cuando el mensaje es exactamente uno de estos:
- `no such table: <identificador>` (node:sqlite).
- `no such table: <identificador> (code 1): , while compiling: <SQL>`, o con `(code 1 SQLITE_ERROR)` /
  `(code 1 SQLITE_ERROR[1])` (driver Android). La sentencia citada debe nombrar esa misma tabla como palabra completa.

Cualquier otro mensaje conserva su clase anterior o su texto completo. La cadena resultante es idéntica a la que Node ya
producía, así que no cambia ninguna referencia.

## 4. Pruebas del clasificador

| Entrada | Resultado |
|---|---|
| Node, falta `installment_allocations` | `other: no such table: installment_allocations` |
| Android r3 real, misma tabla con sufijo | La misma clase |
| `(code 1 SQLITE_ERROR)` y `(code 1 SQLITE_ERROR[1])` | La misma clase (formato no observado aún en API 35: si difiere, la campaña se detendrá y mostrará el texto completo) |
| Falta `installment_plan_revisions` (Node y Android) | `other: no such table: installment_plan_revisions` (distinta) |
| FOREIGN KEY (Node y `(code 787)`) | `foreignKey` |
| CHECK / UNIQUE | `check` / `unique` |
| Sintaxis, transacción anidada, `database is locked` | `other: <texto completo>` |
| RAISE propio | `raise:antes de eliminarlo` |
| Sin nombre, sin espacio, texto añadido, prefijo `Error:`, `main.tabla`, código 11, sentencia de otra tabla, prefijo de nombre (`…_old`), sufijo sin sentencia | No reconocido: texto completo |
| `undefined` / objeto sin `message` | `accepted` / `other: {"code":5}` |

## 5. v4 y v5 en Node

- **v4:** `{firstGuardedStep: 'editTerms', outcome: 'other: no such table: installment_allocations', stateUnchanged: true}`.
  `ROLLBACK` inmediato, sin transacción abierta; la siguiente transacción (migración 5 reaplicada) abre y confirma.
  Saldos, deuda, patrimonio y movimientos sin cambios: comparación de estado completo dentro de la sonda.
- **v5:** después de `INSERT INTO schema_migrations VALUES (5…` no hay ningún error «no such table». El flujo completo
  (crear, editar condiciones, pagar, borrar el pago y borrar la compra) es igual a la referencia, incluidas revisiones,
  movimientos, extractos y D6.
- Aserciones de la sonda conservadas: la comparación v4 sigue siendo **literal** contra la cadena estable y el estado
  completo se sigue comparando.

## 6. Oráculos

- Suite de equivalencia 1a.4B 10/10, aislamiento 7/7 y diagnóstico r2 6/6 contra la referencia actual.
- Candidato generado con el arnés corregido: **idéntico byte a byte** a `docs/validacion-fase1a4b/node/results.json`
  (`1faa219207d86d95f7b55f3e3446243d3d6194bbd974e7018089e7acce41bd1b`). No se regeneró nada.
- `editAmount` = 33 y `deletePurchase` = 25 se mantienen.
- Referencias históricas (1a.4A, 1a.4A r2, 1a.3B, 1a.3A, 1a.2, 6B.3) con el mismo SHA que en el inventario r3. 6A sin
  cambios.

## 7. Validación Node

| Verificación | Resultado |
|---|---|
| Reproducción, clasificador y v4/v5 | 27/27 |
| Equivalencia 1a.4B, aislamiento y diagnóstico r2 | 23/23 |
| Pagos extraordinarios/D6, 1a.4A, 1a.3B, 1a.3A, 1a.2, 6B.3 y 6A (suites específicas) | PASS |
| Jest completo | **1414 aprobadas, 0 fallos, 14 omitidas** (1428); 93 suites aprobadas, 7 omitidas |
| Reproducciones financieras | 29/29 |
| TypeScript / ESLint / `git diff --check` | Sin errores / 0 errores (5 advertencias previas en `phase5e3`, `phase6a`, `phase6b`) / limpio |

Fallo intermitente conocido (`subscriptionAtomicityPhase4`, desbordamiento de pila en `realSQLite`): esta vez pasó. Sigue
documentado y sin modificar. La referencia no cambió tras ninguna ejecución.

## 8. Auditoría preventiva de mensajes de error (solo lectura)

| Campañas pendientes | Qué se compara | ¿Clase estable? | Riesgo entre motores |
|---|---|---|---|
| 1a.3B `flows` (mitad v5 y v4) | Clase de error y estado completo | Sí (r4) | Corregido |
| Resto de 1a.3B | Ya aprobado en r3; RAISE por fragmentos, CHECK, UNIQUE, FK y NOT NULL por clase | Sí | Ninguno |
| 1a.3A (identity, atomicity, unknown) | FK por expresión regular (`foreignKey: true/false`), identidad del fallo inyectado, `SQLiteCommandFailure`/`unknown` | Sí | Ninguno |
| 1a.2 statements / atomicity-historical | Estados y totales; no compara errores | — | Ninguno |
| 6B.3 probes / atomicity / unknown | Mensajes literales de **validación JS** del caso de uso (`rejected: …`), fallo inyectado por identidad, `unknown` | Mensajes propios, iguales en ambos motores | Ninguno; ya aprobados en Android |
| 6A precision | Cifras del dashboard; no compara errores | — | Ninguno |

Las referencias de 1a.3A, 1a.2 y 6B.3 no contienen ningún texto de driver SQLite. En la referencia 1a.4B solo había uno,
este. No se encontró otro defecto.

## 9. Preparación Android r4 (sin compilar)

| Elemento | Valor |
|---|---|
| Workspace | `C:/sf-1a4b-r4-20261107`, nuevo, copiado del r3 auditado (`bf4a27c0…`, APK `f4ffd9d8…`); sin `build/` |
| Atestación | `97e1a907b5a27442975938f70e4ce88b9f1be78cce7682f1f1c8f1d7cdb8831e`, fase `1a.4B r4`, 390 archivos, embebida idéntica |
| Diferencias frente a r3 | Solo `phase1a3bProbes.ts` (y la atestación). Producción, las cinco partes de referencia y los demás arneses son idénticos byte a byte |
| Comprobaciones | Lógica real 1a.4B activa; `extraordinaryInstallmentPayment` solo en su propio archivo (no se exporta desde `index.ts` ni se usa en pantallas); expectativas 33, 25 y v4 `other: no such table: installment_allocations` |
| Inventario | `r4/authorization/inputs.sha256.json` (1094 entradas, incluye las evidencias r1/r2/r3); cambios frente a r3 solo en `derive-probes.cjs` y `phase1a3bProbes.ts`; `verify` sin cambios: guards, producción, referencias y evidencias intactos |
| Identidad del APK | `apk-identity-r4.cjs` rechaza r1, r2 (1 y b), r3 y anteriores |
| Runners | `run-android-r4.ps1` y `run-all-r4.ps1`, derivados de los r3 (hashes fijados): solo cambian workspace, identidad y rutas `r4/`. Mismos dos dispositivos y las mismas 32 campañas |

Nota: el inventario r4 se recapturó una vez porque `make-runner-r4.cjs` tenía un falso positivo en su comprobación
anti-rutas r3 (abortó sin escribir) y se corrigió después de la primera captura. El workspace no depende de ese script.

Campañas por dispositivo: **502 casos y 356 puntos de fallo** (158 de 1a.4B y 198 de regresión), incluidos
`phase1a3b-flows` con las mitades v4 y v5 completas. Ningún caso se omite ni se marca como aprobado.

## 10. Comandos (requieren una nueva autorización)

Desde `C:/Users/nesto/Proyectos/SmartFin`:

1. `node scripts/phase1a4b/r4/inventory-r4.cjs verify`
2. En `C:/sf-1a4b-r4-20261107/android`: `.\gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'`
3. `node scripts/phase1a4b/r4/apk-identity-r4.cjs`
4. Arrancar el AVD `SmartFin_Guard_Synthetic_API24` en el puerto 5554 y ejecutar `./scripts/phase1a4b/r4/run-all-r4.ps1 -Serial emulator-5554 -Api 24`
5. Solo si API 24 completa las 32 campañas: `./scripts/phase1a4b/r4/run-all-r4.ps1 -Serial AXCC6R3919012932 -Api 35`
6. `node scripts/phase1a4b/r4/inventory-r4.cjs verify`

## 11. Riesgos y veredicto

- El formato del mensaje en API 35 no se ha observado. El clasificador acepta las dos variantes documentadas de Android
  y, ante cualquier otra, mostrará el texto completo y detendrá la campaña: no se oculta.
- El paso protegido de v4 escribe dentro de la transacción antes de fallar y lo revierte. No se confirma nada (lo
  verifica la comparación de estado completo).
- El fallo intermitente de `subscriptionAtomicityPhase4` sigue fuera de alcance.
- Hay cambios sin commit (r3 y r4). El runner verifica los hashes del checkout frente a la atestación r4.

**Veredicto: preparación r4 aprobada.** El mismo error se representa igual en Node y Android; errores distintos siguen
siendo distintos; v4 y v5 siguen verificados; los oráculos no cambian; las pruebas Node pasan; producción, triggers y
guards están intactos; el workspace y la atestación r4 están listos. Compilación y ejecución Android pendientes de
autorización.

## 12. Ejecución r4 (7 de noviembre de 2026): API 24 aprobada, API 35 detenida en `phase1a3b-flows`

**Comprobaciones previas:** sin incidencias. `inventory-r4.cjs verify` sin cambios (1094 entradas, incluida la versión
corregida de `make-runner-r4.cjs`); atestación `97e1a907…8831e`, embebida idéntica, 0 diferencias workspace–atestación y
checkout–atestación; runners r4 rederivados en un directorio temporal e idénticos byte a byte; referencias históricas y
1a.4B con los mismos SHA que en r3; las 201 evidencias r1/r2/r3 intactas; el caso de uso solo aparece en
`extraordinaryInstallmentPayment.ts` (sin export en `index.ts` ni uso en pantallas); sin procesos de validación previos
(los únicos `java` eran el servidor MCP de Maestro).

**APK r4:** `C:/sf-1a4b-r4-20261107/android/app/build/outputs/apk/release/app-release.apk`.

- SHA-256 `aa720dd012d2b19b10fab7f4acb843d096f246dfe25e98531797974a0842dd11`, 33.811.916 bytes, compilación offline en
  5 min 13 s ([log](android-build.log)).
- `apk-identity-r4.cjs`: aprobado ([identidad](authorization/apk-identity.json)); frente a r3 solo cambia `phase1a3bProbes.ts`;
  APK y atestaciones r1, r2 (1 y b), r3 y anteriores rechazados por lista.
- Hermes (`C6 1F BC 03`), `com.smartfin.snapshot5b2.tests`, release sin `debuggable`, arm64-v8a + x86_64; el bundle contiene
  el código 1a.4B y el nuevo clasificador; las cinco partes de referencia embebidas son idénticas byte a byte a las
  generadas desde `node/results.json` (`1faa2192…`).

### API 24 (`emulator-5554`, AVD `SmartFin_Guard_Synthetic_API24`, `-no-snapshot-save`), [log](android-api24.log)

32/32 campañas, **568/568 casos**, **356/356 puntos de fallo**, 48.699 campos comparados con Node y 0 diferencias.

- `phase1a3b-flows / v4-v5-flows`: aprobado, 543 campos iguales a Node. Mensaje del driver:
  `no such table: installment_allocations (code 1): , while compiling: SELECT 1 AS found FROM installment_allocations a …`
  → `other: no such table: installment_allocations`; `stateUnchanged: true`; mitad v5 completa.
- 1a.4B: register 9, reversal 13, guards 15, idempotency 4, atomicity 165 (158 `rolledBack` iguales a Node), unknown 3,
  unknown-restart 4.
- Regresiones: 1a.4A 66 (28), 1a.3B 66 (30), 1a.3A 55 (32), 1a.2/6B.3/6A 168 (108).
- `com.smartfin` sin cambios en las 32 campañas (no instalado en el AVD). Emulador apagado al terminar.

Nota de recuento: la tabla de `docs/validacion-fase1a4b/README.md` §3 suma 502, pero sus filas suman 568
(213 + 66 + 66 + 55 + 168). Los recuentos por grupo observados coinciden fila por fila. Los 356 puntos sí cuadran.

### API 35 (`AXCC6R3919012932`, HONOR CRT-NX3), [log](android-api35.log)

20 campañas aprobadas y una fallida (21 de 32): **344 casos ejecutados, 343 aprobados**, **216/216 puntos ejercitados con
rollback**, 40.244 campos comparados y 0 diferencias hasta la parada. Las 7 campañas 1a.4B (213/213), 1a.4A (66/66) y
1a.3B hasta `integrity` aprueban.

**Primera discrepancia: `phase1a3b-flows / v4-v5-flows`.** Texto completo del driver (de `result.json`; el logcat
del HONOR quedó vacío):

```
no such table: installment_allocations (Sqlite code 1 SQLITE_ERROR): , while compiling: SELECT 1 AS found FROM installment_allocations a
        JOIN installment_purchases p ON p.id = a.installment_purchase_id
        WHERE p.transaction_id = ? AND a.status = 'active' LIMIT 1;, (OS error - 2:No such file or directory)
```

Frente a las variantes aceptadas cambian dos cosas: `(Sqlite code 1 SQLITE_ERROR)` en lugar de `(code 1 …)`, y el sufijo
`, (OS error - 2:No such file or directory)` tras la sentencia. Misma tabla, misma sentencia de la guarda y mismo código
SQLite 1: la semántica es la misma. El clasificador la rechazó tal como se diseñó (texto completo, sin ampliar).

No verificado en API 35: `stateUnchanged` de la mitad v4 (la comprobación va después de la clasificación) y toda la mitad v5.
No ejecutadas: 1a.3A, 1a.2, 6B.3 y 6A (11 campañas, 140 puntos).

### Estado final

- `com.smartfin` sin cambios en las 21 campañas del HONOR (`lastUpdateTime 2026-10-11 16:27:48`).
- `inventory-r4.cjs verify` al final: sin cambios (guards, producción, referencias y evidencias intactos).
- Sin cambios en producción, arnés, clasificador, aserciones u oráculos. Sin recompilar. Sin commit ni push.

**Veredicto:** la validación Android r4 **no** se aprueba. API 24 completa y aprobada; API 35 incompleta por un tercer
formato del mensaje «no such table» que el clasificador no acepta. La Fase 1a.4B no está validada técnicamente. Las
limitaciones de idempotencia tras editar o borrar el pago y la reconciliación bancaria siguen abiertas.
