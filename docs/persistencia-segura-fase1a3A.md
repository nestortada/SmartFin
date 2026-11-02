# Fase 1a.3A: persistencia SQLite segura (sin `INSERT OR REPLACE` en tarjetas)

2 de noviembre de 2026. Rama `main`, commit base `c008e34` («fase 1 a1 y a2»), árbol limpio al empezar
(1a.1 y 1a.2 ya estaban confirmadas). Sin commit ni push. Validación Android **preparada, no ejecutada**.

## 1. Inventario y clasificación

Usos de `INSERT OR REPLACE` en `src/` (excluidas las pruebas):

| Tabla | Repositorio | Dependientes hoy | Dependientes previstos (migración 5) | Riesgo | Decisión |
|---|---|---|---|---|---|
| `installment_purchases` | `sqliteCreditCardRepository.saveInstallmentPurchases` | Ninguno | `installment_allocations`, `installment_plan_revisions` | **Alto**: la edición de un plan borraría sus imputaciones (`CASCADE`) o anularía referencias (`SET NULL`), renumera el `rowid` y resetea a DEFAULT las columnas que no escribe | Corregido |
| `credit_card_statements` | `…saveStatements` | Ninguno | Asociación pago–extracto (escenario C) | **Alto** en cuanto haya referencias; hoy solo cambia el `rowid` | Corregido |
| `credit_card_profiles` | `…saveProfiles` | Ninguno | — | Bajo: perdía el `created_at` guardado y el `rowid` | Corregido (mismo repositorio, mismo patrón) |
| `categories` | `sqliteCategoryRepository` | Movimientos, presupuestos, subcategorías, splits, suscripciones (FK sin acción) | — | Bajo: con `NO ACTION` la FK se comprueba al final de la sentencia y los hijos sobreviven; la tabla no tiene columnas sin escribir | Fuera de alcance, documentado |
| `subcategories` | `sqliteSubcategoryRepository` | Movimientos, splits, suscripciones (FK sin acción) | — | Bajo, igual que categorías | Fuera de alcance |
| `smart_alerts`, `merchant_mappings`, `app_settings` (×2) | alertas, movimientos, ajustes, borrado | Ninguno | — | Bajo: no financieras o sin referencias | Fuera de alcance |

Comportamiento comprobado en `node:sqlite` (3.53, `recursive_triggers = 0`): `REPLACE` sobre una fila
existente cambia el `rowid`, ejecuta las acciones `ON DELETE CASCADE` y `SET NULL` de los hijos, conserva hijos
`NO ACTION`, resetea las columnas no listadas a su DEFAULT y solo dispara el trigger `AFTER INSERT` (+1 en
`financial_data_revision`, ningún trigger DELETE). `PRAGMA foreign_key_check` queda vacío: la pérdida es
silenciosa.

Cuentas y movimientos ya usaban `upsertSQLiteRow` (UPDATE + INSERT … WHERE NOT EXISTS) desde fases anteriores.

## 2. Defectos reproducidos antes de corregir

`__tests__/safePersistencePhase1a3A.test.ts` crea tablas dependientes **sintéticas** (solo en la base de prueba)
que referencian `installment_purchases` (`CASCADE` y `SET NULL`) y `credit_card_statements` (`CASCADE`).

- La primera versión de la prueba, ejecutada con el repositorio de producción aún con `REPLACE`, falló en 10 de
  13 casos (identidad, hijos, columnas extra, trazas de escritura).
- La prueba de reproducción usa la copia congelada `__tests__/helpers/post3BCreditCardRepositoryBaseline.ts`
  (con `REPLACE`) y deja el defecto caracterizado de forma permanente: `rowid` renumerado, imputación borrada,
  revisión anulada a `NULL`, columna futura reseteada a DEFAULT y `foreign_key_check` vacío.

## 3. Estrategia SQL y compatibilidad con SQLite 3.9.2

Helper nuevo `src/database/saveSQLiteRowPreservingIdentity.ts`:

1. `SELECT 1 AS present FROM <tabla> WHERE <clave> = ?`.
2. Si no existe: `INSERT INTO … VALUES (…)` simple. Una violación de PK o FK inesperada **falla** (sin
   `OR IGNORE`).
3. Si existe: `UPDATE <tabla> SET <columnas del repositorio salvo clave y created_at> WHERE <clave> = ?`, y exige
   `rowsAffected === 1`.

Solo usa SQL disponible en 3.9.2: ni `ON CONFLICT … DO UPDATE` (3.24), ni `RETURNING` (3.35), ni `UPSERT`. Los
identificadores se validan con `/^[a-z_]+$/`; los valores van siempre ligados.

**Una escritura por fila, como `REPLACE`.** Se evaluó omitir el UPDATE cuando la fila es idéntica. Se descartó:
con relojes fijos el pago de la matriz 6B.3 pasaba de 10 a 9 escrituras (desaparecía el punto de fallo del
extracto en la posición 3) y cambiaba la semántica de `financial_data_revision`. Con la paridad, las
posiciones de escritura y los incrementos de revisión son exactamente los validados en Android; solo cambia el
verbo SQL. Lo innecesario que sí se elimina es el DELETE implícito con su reinserción, y no se añade una segunda
escritura de sondeo (a diferencia de `upsertSQLiteRow`).

El SELECT y la escritura se ejecutan con el mismo `database` que recibe el repositorio: dentro de un ámbito
compartido es el participante del propietario, que ya tiene `BEGIN IMMEDIATE`, así que no hay carrera ni
transacción anidada. Fuera de un ámbito (siembra demo) el comportamiento por fila es el mismo que antes:
autocommit por sentencia; una carrera produciría un error de PK visible, nunca una sobrescritura silenciosa.

## 4. Archivos y funciones modificados

| Archivo | Cambio |
|---|---|
| `src/database/saveSQLiteRowPreservingIdentity.ts` | Nuevo helper (sección 3) |
| `src/modules/creditCards/repositories/sqliteCreditCardRepository.ts` | `saveStatements`, `saveInstallmentPurchases` y `saveProfiles` usan el helper (clave `id`, `id` y `account_id`). Mismas columnas y valores que antes |
| `__tests__/safePersistencePhase1a3A.test.ts` | Nuevo: 13 pruebas (reproducción, identidad, hijos, extractos, atomicidad, `unknown`) |
| `__tests__/financialIntegrity.test.ts`, `financialAtomicityPhase3A.test.ts`, `helpers/financialAtomicityScenarios.ts` | El selector de fallo apunta a la nueva escritura real del extracto (`UPDATE credit_card_statements`) en la misma posición |
| `__tests__/creditCardStatementsPhase1a2.test.ts` | El fallo inyectado del extracto cubre INSERT **y** UPDATE; la repetición exige ahora el mismo `rowid` |
| `__tests__/__snapshots__/financialAtomicityPhase0.test.ts.snap` | Solo texto SQL y orden de parámetros del extracto (el `id` pasa al `WHERE`, `created_at` no se reescribe). Ninguna escritura añadida ni eliminada |
| `__tests__/creditCardReconciliationEquivalence.test.ts` | Comentario: el renumerado es de la copia congelada |
| `docs/BASE_DE_DATOS.md`, `docs/INDICE.md` | Descripción de las tablas y riesgo 2 actualizados; enlace a este informe |

Sin cambios en esquema, migraciones, casos de uso, reglas contables, hooks ni arneses Android.

## 5. Integridad referencial

- Hijos `CASCADE` y `SET NULL` sintéticos intactos tras editar un plan (por la UI de edición y por el
  repositorio) y tras reescribir un extracto con un pago.
- `PRAGMA foreign_key_check` vacío en todos los escenarios.
- Una compra a cuotas con `transaction_id` inexistente se rechaza con `FOREIGN KEY constraint failed` y no deja
  filas.
- Ciclos posteriores conservan el primer extracto, su `rowid` y su hijo; totales `[100k ×6, 0]`.

## 6. Identidad y registros dependientes

- `id`, `rowid` y `created_at` iguales antes y después en planes, extractos y perfiles.
- Una columna añadida por `ALTER TABLE` (simula la migración 5) conserva su valor: `REPLACE` la reseteaba.
- Con los mismos datos, el plan guardado por el repositorio nuevo es idéntico campo a campo al del anterior
  (salvo el id de movimiento generado) y el incremento de revisión es el mismo (+1 por fila).
- Plan editado sin cambio de condiciones: conserva `paid_installments` y `monthly_amount`. Con cambio de
  condiciones (3 → 6 cuotas) conserva la identidad y los hijos, y reinicia el plan como antes (ver 11).

## 7. Atomicidad

- Edición de un plan con dependientes: matriz de las 6 escrituras × antes/después = 12 puntos, todos rollback
  confirmado; todas las tablas, revisión, métricas, integridad y `rowid` iguales al estado previo; un único
  `BEGIN`, sin `COMMIT`.
- `COMMIT` antes/después: resultado `unknown`, una sola `UPDATE installment_purchases`, un solo `BEGIN`, sin
  reintento.
- Regresiones: `phase6b3HarnessRollbackOracle` sin cambios (8 escrituras con reloj histórico; 10 con reloj
  alineado, extractos en las posiciones 3 y 10), matrices de las fases 2, 3A, 3B, 4 y 5 y el resto de la suite.

## 8. Resultados

| Verificación | Resultado |
|---|---|
| `npx jest __tests__/safePersistencePhase1a3A.test.ts` | 13/13 |
| Extractos multiciclo (`creditCardStatementsPhase1a2`, `phase1a2StatementsProbes`) | Verdes; las sondas reproducen `docs/validacion-fase1a2/node/results.json` (5.530 campos) sin diferencias |
| `npm test -- --runInBand` | 82 suites aprobadas y 7 omitidas; 1.192 pruebas aprobadas, 14 omitidas, 0 fallos; 8/8 snapshots |
| `npm run test:reproductions -- --runInBand` | 6 suites, 29/29 |
| `npx tsc --noEmit` | Sin errores |
| `npm run lint` | 0 errores; 5 advertencias previas en `scripts/phase5e3`, `scripts/phase6a` y `scripts/phase6b` (no tocados) |
| `git diff --check` | Limpio |

Resultados financieros anteriores y posteriores: oráculos 1a.2 (5.530 campos) y 6B.3 sin cambios, equivalencia de
reconciliación y escenarios A–D de 1a.2 idénticos a `before.json`. Ningún saldo, deuda, patrimonio, extracto o
movimiento cambia.

## 9. Impacto sobre los puntos de fallo de Android

- Mismo número y posición de escrituras: `phase6b3-atomicity` 10/10/10, `phase1a2-atomicity-historical` 8/8/8.
  El arnés inyecta por número de escritura, no por texto SQL, así que no hay que modificarlo.
- Cambia el verbo de las escrituras de extracto (3 y 10): de `INSERT OR REPLACE` a `UPDATE` cuando el extracto
  existe, `INSERT` cuando es nuevo. Se añade un `SELECT` antes de cada una, que no es punto de escritura.
- El APK `fb5898e1…` de 1a.2 r2 **no** contiene este código y no sirve como evidencia.

## 10. Procedimiento para validar en API 24 y API 35 (requiere autorización)

> Preparado en [validacion-fase1a3a/README.md](validacion-fase1a3a/README.md): campañas, referencia Node, workspace
> `C:/sf-1a3a-20261102` y comandos exactos. Lo que sigue es el plan original.

Mismo esquema que 1a.2 r2, con piezas nuevas: los scripts de 1a.2 fijan su workspace y su atestación
(`phase: '1a.2'`) y no deben reutilizarse tal cual.

1. **Preparar el staging** (crear scripts, sin ejecutar nada en dispositivos): `scripts/phase1a3a/` derivado de
   `scripts/phase1a2/` con workspace nuevo, atestación `phase: '1a.3A'` que rechace las de 6B.3 y 1a.2, inventario
   de autorización y runner derivado con `make-runner.cjs`.
2. **Sonda de identidad en el driver real** (campaña nueva `phase1a3a-identity`): portar los escenarios de la
   sección 6 (dependientes sintéticos, `rowid`, `created_at`, columna extra, FK, revisión) al arnés. Es la prueba
   que importa entre versiones: API 24 usa SQLite 3.9.2.
3. Con autorización: preparar el workspace, compilar el release
   (`./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'`),
   registrar la identidad del APK, arrancar el AVD `SmartFin_Guard_Synthetic_API24` sin wipe y ejecutar las
   campañas en `emulator-5554` y `AXCC6R3919012932`, solo con el paquete sintético
   `com.smartfin.snapshot5b2.tests`.
4. Criterios por dispositivo: `phase1a3a-identity` sin diferencias frente a Node; `phase1a2-statements` 13/13
   con 5.530 campos y 0 diferencias; `phase6b3-atomicity` 66/66 (10/10/10); `phase1a2-atomicity-historical`
   53/53 (8/8/8); `phase6b3-probes` 12/12; `phase6b3-unknown` 3/3; `phase6b3-unknown-restart` 3/3;
   `phase6a-precision` 18/18. Guards sin cambios (`verify`) y `com.smartfin` sin modificaciones.

## 11. Riesgos pendientes

- **Edición con cambio de condiciones (para 1a.3B):** `saveTransactionInstallments` reinicia
  `paid_installments` a 0 y recalcula `monthly_amount`. La fila conserva identidad e hijos, pero cuando existan
  imputaciones el plan reiniciado ya no coincidirá con ellas. Hace falta una regla de revisión de plan
  (`installment_plan_revisions`). No se ha cambiado.
- `categories`, `subcategories`, `smart_alerts`, `merchant_mappings` y `app_settings` siguen con `REPLACE`. Hoy no
  pierden hijos. Si alguna recibe una FK con `CASCADE`/`SET NULL` o columnas que su repositorio no escriba, hay
  que migrarla al helper.
- Escenario C (pago de un ciclo anterior) sigue documentado como limitación independiente; no se ha tocado.
- Sin evidencia de dispositivo de esta implementación hasta ejecutar la sección 10.

## 12. Preparación para la migración 5

- Las tablas nuevas pueden referenciar `installment_purchases(id)` y `credit_card_statements(id)` con
  `ON DELETE CASCADE` sin que una edición o una reconciliación borre sus filas.
- Las columnas que añada la migración 5 a esas tablas sobreviven a los guardados actuales, porque el UPDATE solo
  escribe las columnas que el repositorio conoce. Un INSERT nuevo usará sus DEFAULT.
- El helper sirve para las tablas nuevas (clave configurable) con las mismas garantías de una escritura por fila
  y participación en el ámbito transaccional existente.
