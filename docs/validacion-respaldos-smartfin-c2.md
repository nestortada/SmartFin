# Validación de respaldos y viabilidad de la opción B (Etapa C2)

7 de noviembre de 2026. Opción B aprobada: generaciones SQLite con puntero durable. Esta etapa **no** instala ni activa
ninguna base restaurada, no cambia el nombre de la base, no toca `src/`, `android/`, migraciones, triggers, interfaz ni
`BACKUP_PUBLICATION_UI_ENABLED` (sigue en `false`). Sin commit ni push. Diseño de partida:
[diseno-restauracion-segura-smartfin.md](diseno-restauracion-segura-smartfin.md).

## 1. Estado inicial de Git

| Elemento | Resultado |
|---|---|
| Rama / HEAD | `main` / `0f566ee` (desciende de `b3ef6e5`) |
| Archivos versionados modificados | Ninguno, ni al empezar ni al terminar (`git diff HEAD` vacío) |
| No versionados previos | Auditoría (`__tests__/backupRestoreAuditPhaseC.test.ts`, `docs/auditoria-respaldo-*`), C1 (`docs/diseno-restauracion-segura-smartfin.md`, `__tests__/restoreProtocolPocC1.test.ts`) |
| Nuevos en C2 | `__tests__/helpers/c2/{restoreCandidateValidator,contentFingerprint,databaseResolverModel}.ts`, `__tests__/restoreValidationC2.test.ts`, este documento |

Los prototipos viven en `__tests__/helpers/c2/` a propósito: son ejecutables y reutilizables, pero no forman parte de
la aplicación. En C3 se portarán a `src/` y a Kotlin con autorización.

## 2. Inventario completo de aperturas SQLite

Búsqueda exhaustiva en `src/`, `index.js`, `android/app/src/main` y el driver `react-native-sqlite-storage@6.0.1`
(`SQLitePlugin.java`): `openDatabase`, `openOrCreateDatabase`, `SQLiteOpenHelper`, `getDatabasePath`, `deleteDatabase`,
`attach`, `Room`, `databaseList`, nombres `*.db` literales o construidos. Resultado: **dos abridores de la base activa**
(driver JS y `withDatabase`), **uno de solo lectura** sobre la activa (captura), y varios sobre copias privadas.

| # | Archivo y función | Nombre usado | Momento | Proceso / hilo | Coordinador | ¿Conexión persistente? | Riesgo de generación antigua | Adaptación mínima (C3) |
|---|---|---|---|---|---|---|---|---|
| 1 | `src/database/sqliteDatabase.ts` `openSmartFinDatabase` → `sqliteLifecycle.openConfirmedSQLiteConnection` → driver `SQLitePlugin.openDatabase` | `SMARTFIN_DATABASE_NAME` = `smartfin.db` (fijo) → `getDatabasePath(name)` con `OPEN_READWRITE | CREATE_IF_NECESSARY` | Arranque (`AppNavigator`), tras respaldo, captura, mantenimiento de suscripciones y Headless (`subscriptionRuntime`, 5 sitios), `androidDriveBackupService` | Único proceso; hilo `DBRunner` del driver por nombre | Sí: apertura en `withDatabaseMaintenance`; cada consulta administrada pasa por la cola JS + dueño nativo | **Sí** (singleton `databasePromise`) | **Alto**: el singleton seguiría ligado al archivo anterior si no se cierra con recibo | Pedir el nombre al resolvedor bajo el permiso; ligar la conexión administrada a `generationId` y rechazar uso si cambió; nunca pasar al driver un nombre inexistente (evita `CREATE_IF_NECESSARY`) |
| 2 | `SmartFinSubscriptionRemindersModule.withDatabase(context, permit, block)` | `getDatabasePath("smartfin.db")` (fijo), `OPEN_READWRITE` sin crear; si no existe devuelve `null` | Por llamada | Hilos de executor del módulo, receptores y Worker | Exige participante (`assertParticipant`) | No (abre y cierra por llamada) | **Medio**: abriría el archivo fijo, no el activo | Sustituir la ruta por `SmartFinDatabaseLocation.resolve(context, permit)` |
| 2a | — llamadores: métodos del módulo (con token JS o independientes) | vía 2 | Petición JS | Executor | Token JS o independiente | No | vía 2 | vía 2 |
| 2b | — `SmartFinSubscriptionReminderReceiver.onReceive` | vía 2 | Alarma | `goAsync` + executor | `acquire(OWNER)` exclusivo + participante | No | vía 2 | vía 2; con diario pendiente: no abrir (no recuperar desde un receptor) |
| 2c | — `SmartFinSubscriptionRecoveryReceiver` → `enqueueRecovery` | vía 2 | Arranque del dispositivo / actualización | Hilo del receptor | Independiente | No | vía 2 | vía 2 |
| 2d | — `SmartFinSubscriptionWorker.doWork` → `SmartFinFinancialDeletion.recover` / `resourceEpoch` | vía 2 | WorkManager, **antes de JS** | Hilo del Worker | Independiente | No | vía 2 | vía 2; con diario pendiente: `Result.retry()` |
| 2e | — `SmartFinFinancialDeletion` (`resourceEpoch`, `inventory`, `read`, `write`, limpieza) y `backup()` | vía 2 | Borrado financiero y admisión de respaldos | Executor nativo | Token o independiente | No | vía 2 | vía 2 + admisión cruzada con el diario de restauración |
| 3 | `SmartFinLocalSnapshot.capture` (origen) | `getDatabasePath("smartfin.db")` (fijo), `OPEN_READONLY` | Captura de respaldo | Executor del módulo de ciclo de vida | Participante con token del dueño | No | **Alto**: copiaría el archivo fijo, distinto del descrito por JS | Usar la generación resuelta del mismo permiso que JS describió |
| 4 | `SmartFinLocalSnapshot.capture` (copia) y `discard` | `noBackupFilesDir/smartfin-local-snapshots/<uuid>/snapshot.db` | Captura / descarte | Executor | Participante | No | Ninguno (no es la activa) | Ninguna |
| 5 | `SmartFinBackupCsv.validate` / `export` | `snapshot.db` privada | Publicación | Executor de Drive | Bajo `SmartFinFinancialDeletion.backup` | No | Ninguno | Ninguna |
| 6 | Driver: `attach`, `deleteDatabase`, `createFromLocation`, `androidLockWorkaround` (reapertura tras `COMMIT`) | Por nombre | — | — | — | — | Ninguno: **no se usan** (`androidLockWorkaround` falso por defecto; no se pasa) | Prueba estática que lo mantenga |
| 7 | WorkManager (`androidx.work:work-runtime:2.11.2`) | Su propia base Room (`androidx.work.workdb`) | — | — | — | — | No contiene datos de SmartFin | Ninguna |
| 8 | `seedSmartFinDatabase` | vía 1 | Nunca (no se invoca) | — | — | — | — | Retirar o adaptar con 1 |
| 9 | Pruebas y scripts (`__tests__/helpers/realSQLite.ts`, `scripts/*`) | Archivos sintéticos | Solo Node | — | — | — | No son producción | — |

Hallazgos que el diseño C1 no tenía:

- **El Worker abre la base antes que JS** (`recover` y `resourceEpoch` al empezar `doWork`). La recuperación de una
  restauración no puede depender únicamente del arranque JS: los abridores independientes deben **negarse** a abrir con
  un diario pendiente.
- **El receptor de alarmas toma un dueño exclusivo** (`acquire(OWNER)`). Aunque sea exclusivo, no debe ejecutar la
  recuperación (verificación de integridad y huella de una base grande dentro de `goAsync`). En el contrato, la política
  de recuperación es explícita por llamador, no por tipo de permiso.
- `withDatabase` ya no crea bases (`file.exists()` antes de abrir). El driver sí crea (`CREATE_IF_NECESSARY`).

## 3. Arquitectura del resolvedor único

Componente nativo `SmartFinDatabaseLocation` (Kotlin, fuente de verdad) y fachada TS sobre el puente. Contrato:

```
resolve(context, permit, policy) -> Resolution
  policy: RECOVERY_OWNER  (solo openSmartFinDatabase bajo withExclusiveDatabase)
          NO_RECOVERY     (receptores, Worker, módulo de recordatorios, borrado, captura)
  Resolution:
    Open(name, generationId, adoptLegacy)      // el archivo existe; nunca se crea
    CreateFreshInstall("smartfin.db")          // solo RECOVERY_OWNER y solo instalación nueva real
    RecoverFirst                               // solo RECOVERY_OWNER con diario pendiente
    Refuse(code)                               // JOURNAL_CORRUPT, RESTORE_PENDING, POINTER_CORRUPT, POINTER_INVALID,
                                               // ACTIVE_GENERATION_MISSING, POINTER_LOST, DATABASE_LOST, NOT_INITIALIZED
```

Tabla de decisión (implementada como modelo puro en `databaseResolverModel.ts` y probada caso por caso):

| Diario | Puntero | Archivos | Marcador de instalación | Resultado |
|---|---|---|---|---|
| corrupto | — | — | — | `Refuse(JOURNAL_CORRUPT)` |
| pendiente | — | — | — | `RecoverFirst` (RECOVERY_OWNER) / `Refuse(RESTORE_PENDING)` |
| — | corrupto | — | — | `Refuse(POINTER_CORRUPT)` (nunca volver a `smartfin.db` por defecto: podría ser una generación antigua) |
| — | válido | nombre inválido (no `smartfin.db` ni `smartfin-<uuid>.db`) | — | `Refuse(POINTER_INVALID)` (sin rutas) |
| — | válido | activa ausente | — | `Refuse(ACTIVE_GENERATION_MISSING)` (nunca crear) |
| — | válido | activa presente | — | `Open(activa, generationId)` |
| — | ausente | hay `smartfin-<uuid>.db` | — | `Refuse(POINTER_LOST)` |
| — | ausente | `smartfin.db` | no | `Open(smartfin.db, legacy, adoptLegacy=true)` |
| — | ausente | `smartfin.db` | sí | `Open(smartfin.db, legacy)` |
| — | ausente | ninguno | sí | `Refuse(DATABASE_LOST)` (R6) |
| — | ausente | ninguno | no | `CreateFreshInstall` (RECOVERY_OWNER) / `Refuse(NOT_INITIALIZED)` |

Garantías:

1. **Identidad única**: el puntero (o su ausencia) determina una sola generación; nada más elige nombres.
2. **Resolución antes de abrir**: todos los abridores de §2 pasan por `resolve`; una prueba estática en C3 prohíbe
   `getDatabasePath("smartfin.db")` y `openDatabase(` fuera del resolvedor.
3. **JS y Kotlin**: la tabla vive en Kotlin; JS la consulta con su token y la cachea solo dentro del permiso.
4. **Coordinación**: `resolve` exige participante vigente (`assertParticipant`); con dueño exclusivo el resultado no
   puede cambiar hasta liberar.
5. **Punteros inválidos**: rechazo con diagnóstico, nunca selección por defecto.
6. **Sin bases vacías silenciosas**: solo `CreateFreshInstall`, y solo sin marcador, sin base y sin generaciones.
7. **Separación de rutas**: arranque normal (`Open`), primera adopción (`adoptLegacy`), recuperación (`RecoverFirst`).
8. **Conexiones residuales**: la conexión administrada guarda su `generationId`; `makeHandle` lo compara con el del
   permiso vigente y rechaza si cambió. Las aperturas nativas son por llamada y siempre se resuelven de nuevo.

## 4. Tratamiento de la base heredada `smartfin.db`

- Sin puntero, `smartfin.db` **es** la generación `legacy`. No se copia, no se renombra y no se duplica.
- Primera apertura con el código C3: se escribe el **marcador de instalación** (`noBackupFilesDir`, `AtomicFile`) tras
  una apertura verificada. Desde entonces, la desaparición de la base es `DATABASE_LOST`, no una instalación nueva.
- El puntero solo aparece con la primera restauración (`previous = smartfin.db`). `smartfin.db` sigue intacto como
  generación anterior.
- Instalación nueva: sin base, sin marcador y sin generaciones ⇒ se crea `smartfin.db` como hoy.
- `allowBackup="false"`: Android no restaura por su cuenta archivos sueltos de `databases/`, así que no hay mezclas de
  generaciones sin puntero procedentes del sistema.
- Borrar datos desde Ajustes del sistema elimina base, puntero y marcador a la vez ⇒ instalación nueva legítima.

## 5. Contrato del validador

`validateRestoreCandidate(source, stagingDir, referenceDir) → ValidationResult` (prototipo en
`__tests__/helpers/c2/restoreCandidateValidator.ts`).

| Campo | Significado |
|---|---|
| `status` | `accepted`, `acceptedAfterMigration` o `rejected` |
| `diagnostics[]` | `{code, detail}` con códigos estables (`TRUNCATED`, `FUTURE_VERSION`, `MISSING_TRIGGER`, `FIN_ALLOCATION_AMOUNT`, …) |
| `sourceSha256` / `stagedSha256` | Integridad del archivo leído y de la copia privada |
| `validatedFile` | Copia privada validada (`candidate.db`, `work.db` si fue WAL, `migrated.db` si se migró) |
| `migratedFrom` | Versión de origen si se migró |
| `fingerprint` | Huella canónica v1 (§9) |
| `summary` | Versión, revisión, cuentas, movimientos, compras, imputaciones activas/revertidas, revisiones, pendientes, extractos |
| `integrityPassed` | Distingue «rechazada pese a `integrity_check` ok» |

Orden de comprobaciones: existencia y tamaño → copia privada con SHA-256 → cabecera (`SQLite format 3\0`, tamaño de
página potencia de 2, tamaño múltiplo de página, nº de páginas de la cabecera si es válido) → normalización WAL en copia
de trabajo → `integrity_check` → `foreign_key_check` (con `PRAGMA foreign_keys=ON` explícito) → `user_version` →
`schema_migrations` → migración en copia si es antigua → estructura completa → relaciones financieras → resumen y huella.

## 6. Política de versiones

| Candidata | Resultado | Prueba |
|---|---|---|
| Versión 5 | Validación completa | Aceptada |
| Versiones 1–4 contiguas | Migración con `applyVersionedMigrations` solo sobre `migrated.db` y validación completa desde cero | v4 reconstruida ⇒ `acceptedAfterMigration` |
| Versión > 5 | Rechazo **antes** de crear ninguna copia de trabajo | `FUTURE_VERSION`; el staging solo contiene `candidate.db` intacta |
| Sin `schema_migrations` o vacía | Rechazo | `NO_MIGRATIONS` |
| Versiones no contiguas | Rechazo | `NON_CONTIGUOUS_VERSIONS` |
| `user_version ≠ 0` | Rechazo (ninguna base SmartFin lo escribe) | `USER_VERSION` |
| Versión 5 con estructura incompleta | Rechazo | `MISSING_TABLE` |

Ni migración 6 ni cambios en la migración 5.

## 7. Validaciones de esquema

La estructura esperada se genera del DDL y las migraciones actuales sobre una base vacía (mismo orden que
`applySchema`). Se compara:

- tablas y columnas **por nombre** (`PRAGMA table_info`: tipo, `notnull`, `dflt_value`, `pk`), porque `ALTER TABLE ADD
  COLUMN` cambia el orden y el texto almacenado de `CREATE TABLE`;
- tablas desconocidas (rechazo: origen ajeno o futuro);
- índices y triggers por nombre **y** SQL normalizado (espacios), incluidos guards, transición, validaciones y
  `backup_revision_*` de la migración 5.

Pruebas (todas rechazadas y con el archivo original intacto): migración 5 incompleta, sin `schema_migrations`, versión
futura, versiones no contiguas, tabla obligatoria ausente, tabla desconocida, columna ausente, índice ausente, trigger
ausente, trigger alterado, `user_version` desconocido, huérfano con FK.

Para C3: la referencia debe congelarse como manifiesto estático versionado (generado y comprobado contra el DDL en una
prueba), porque Kotlin no puede ejecutar el DDL de TypeScript. Riesgo abierto: instalaciones antiguas con texto de
triggers distinto (§18).

## 8. Pruebas de integridad financiera

Comprobaciones que el esquema no garantiza por FK. Todas con `integrity_check = ok` y rechazo:

| Código | Regla | Caso probado |
|---|---|---|
| `FIN_ALLOCATION_PURCHASE` | Imputación activa con compra existente; toda imputación con historial | Imputación hacia compra inexistente |
| `FIN_ALLOCATION_PAYMENT` | Imputación activa con pago `creditCardPayment` existente | Ídem |
| `FIN_ALLOCATION_CARD` | Tarjeta destino del pago = tarjeta de la compra | Pago imputado redirigido a otra cuenta |
| `FIN_ALLOCATION_AMOUNT` | Σ imputaciones activas ≤ importe del pago (centavos) | Importe del pago reducido a 1 |
| `FIN_ALLOCATION_CARDINALITY` | Máximo una imputación activa por pago | — (regla del caso de uso) |
| `FIN_ALLOCATION_REVISION` | Cada imputación tiene su revisión `allocation` | — |
| `FIN_REVERSAL_REVISION` | Cada revertida tiene `allocationReversal`; una `allocationReversal` apunta a una revertida | Revisión de reversión eliminada |
| `FIN_REVISION_SEQUENCE` | Revisiones contiguas desde 0 | Revisión 0 eliminada |
| `FIN_REMOVED_PURCHASE_HISTORY` | Compra eliminada ⇒ última revisión `purchaseRemoval` | — |
| `FIN_PENDING_REASON` | Motivos ∈ `INSTALLMENT_PLAN_PENDING_REASONS` (el repositorio rechazaría otros al leer) | Motivo desconocido |
| `FIN_FIRST_CYCLE` / `FIN_BILLING_RULE` / `FIN_PURCHASE_CARD` | Primeros ciclos, reglas y compras sobre cuentas `creditCard` | Regla de facturación sobre `bank` |
| `FIN_COMMAND_EVIDENCE` | Un `command_id` no se liga a dos pagos distintos | Comando duplicado |
| `FIN_REVISION_COUNTER` | `financial_data_revision` con una fila `id=1` entera ≥ 0 | — |
| `DELETION_PENDING` | Copia no tomada a mitad de un borrado financiero | Marcador `cleanupPending` |

Además, sobre una copia de la candidata validada: abrirla con el orden de la app no cambia su huella; repetir el
comando activo devuelve `replayed`, el revertido `replayed` con `allocation.status = reversed`, y ninguna de las dos
escribe (traza sin escrituras).

## 9. Definición de huella canónica (formato v1)

`smartfin-content-fingerprint/v1` (`__tests__/helpers/c2/contentFingerprint.ts`):

1. Tablas: todas las de `sqlite_master` (`type='table'`, sin prefijo `sqlite_`), ordenadas por bytes UTF-8. En
   `app_settings` se excluyen las claves `__smartfin_*` (estado de plataforma: ciclo de vida del borrado y la futura
   identidad de dataset). Así, escribir la identidad en la generación instalada no altera la huella.
2. Columnas: nombres de `PRAGMA table_info` ordenados por bytes; cada valor va precedido de su nombre.
3. Valores calculados por SQLite para no depender de versiones de `printf` ni de la plataforma:
   `typeof(c)` y `CASE typeof(c) WHEN 'integer' THEN CAST(c AS TEXT) WHEN 'real' THEN c ELSE hex(c) END`.
   - `n` (NULL), `i<len>:<decimal de 64 bits>`, `r:<16 hex IEEE-754 big-endian de sqlite3_column_double>`,
     `t<bytes>:<hex minúsculas de los bytes UTF-8>`, `b<bytes>:<hex>`.
   - REAL nunca se convierte a texto: `quote()` y `printf` de SQLite no garantizan ida y vuelta exacta entre versiones.
4. Fila: `<len(nombre)>:<nombre>=<valor>;` por columna; `rowDigest = SHA-256(fila)`.
5. Tabla: `SHA-256("table:<n>\ncolumns:<...>\nrows:<k>\n" + rowDigests ordenados)`. Ordenar digests la hace
   independiente de `rowid`, orden de inserción y `VACUUM`.
6. Huella: `SHA-256("smartfin-content-fingerprint/v1\n" + "<tabla> <digest>" por línea)`.

Distinción: el **SHA-256 del archivo** prueba que unos bytes concretos no cambiaron (cambia con `VACUUM`, páginas
libres o journal); la **huella** prueba igualdad de contenido. Ninguna prueba autenticidad: quien pueda reescribir la
base puede recalcular ambas. La huella no sustituye a `integrity_check` ni a las validaciones.

Reproducibilidad en Android: `typeof`, `CAST`, `hex` y `CASE` existen en SQLite 3.9.2; Kotlin lee el REAL con
`Cursor.getDouble` → `doubleToRawLongBits` (exacto, mismo `sqlite3_column_double`) y el resto como texto ASCII. Los
vectores de §10 son la referencia de conformidad para C3.

## 10. Pruebas de huella

- Vectores exactos: `n`; `i16:9007199254740993` (> 2^53, exacto); `i2:-5`; `r:3fb999999999999a` (0,1);
  `r:4125aae0051eb852` (710.000,01, verificado con un `Float64Array` independiente); `t2:c3b1` («ñ»); `b2:00ff`.
- Determinista y **independiente del archivo**: `VACUUM INTO` cambia el SHA-256 y conserva la huella.
- Independiente del orden de inserción y del `rowid`.
- Sensible a: un centavo (`710000` vs `710000.01`), REAL exacto (`0.1+0.2` vs `0.3`), tipo (`'100'` vs `100`,
  `710000` INTEGER vs `710000.0` REAL), `NULL` vs `''`, y un centavo en un saldo de la base completa.
- Claves `__smartfin_*` de `app_settings` no la alteran; un ajuste normal sí.
- `financial_data_revision` no basta: dos copias con el mismo contador y contenido distinto tienen huellas distintas.

## 11. Garantías de solo lectura

Comprobadas en las pruebas:

- El archivo elegido **nunca se abre con SQLite**: se lee como bytes y se copia. Su SHA-256 es idéntico antes y después
  en todos los casos (aceptados, migrados, WAL y rechazados).
- La inspección abre la copia privada en `readOnly`; su SHA-256 no cambia tras validar.
- Normalización WAL y migración solo en `work.db` / `migrated.db`, distintas de `candidate.db`.
- Versión futura: no se crea ninguna copia de trabajo (`staging` contiene solo `candidate.db`).
- La base activa sintética conserva su SHA-256 durante la validación.

En Android: el stream SAF se abre con `openInputStream` (lectura) y el permiso no se persiste.

## 12. Protocolo de activación

Precondiciones: candidata `accepted`/`acceptedAfterMigration`; coordinador sin cuarentena; sin borrado financiero
pendiente; confirmación explícita del usuario.

1. **Validación** (§5) fuera del permiso, sin tocar la activa.
2. **Generación inactiva**: copia de `validatedFile` a `databases/smartfin-<restoreId>.db.part`, `fd.sync()`,
   comprobación de SHA-256 y huella sobre el `.part`; si se aprueba la identidad de dataset (R3), escribirla **antes**
   en esta copia (claves `__smartfin_*`, fuera de la huella).
3. **Persistencia**: `Os.rename(.part → .db)`, `Os.fsync` del directorio, sin auxiliares (`-journal/-wal/-shm`) junto a
   la nueva generación.
4. **Bloqueo exclusivo**: `withExclusiveDatabase` (cola JS y dueño nativo).
5. **Operaciones activas**: el permiso solo se concede cuando terminan los participantes; si la conexión administrada
   tiene transacción propia, se aborta la restauración sin cambios. No se cancela ninguna operación financiera a medias.
6. **Cierre**: `onDatabase(undefined)` a la UI; `closeSmartFinDatabase(permit)` con recibo; sin recibo ⇒ cuarentena y
   restauración abortada antes del diario.
7. **Sin conexiones residuales**: `sqliteConnectionState().status === 'closed'`; ningún participante nativo vigente
   (garantizado por el dueño exclusivo); alarmas y notificaciones del epoch actual canceladas con el inventario del
   borrado financiero.
8. **Protección de la actual**: no se escribe ni se borra; si estaba en WAL, `wal_checkpoint(TRUNCATE)` completo antes de
   cerrar.
9. **Diario** `switching` (`AtomicFile`, con `restoreId`, candidata, anterior, huella, SHA-256).
10. **Puntero** `{active, generationId, previous, restoreId, contentDigest}` con `AtomicFile` + `fsync` del directorio;
    diario `verifying`.
11. **Reapertura**: `openSmartFinDatabase(permit)` resuelve la nueva generación; el SHA-256 de la generación debe ser
    igual antes y después de esa apertura (una candidata v5 no recibe escrituras al abrir; la PoC C1 lo comprobó).
12. **Verificación financiera**: integridad, FK, estructura, huella igual a la validada, resumen igual al confirmado y
    comprobación de evidencia de comandos sin ejecutar comandos.
13. **Confirmación**: diario `completed` escrito y sincronizado. **Ese es el instante en que la restauración queda
    confirmada.** Después: reprogramar recordatorios desde la base restaurada, reponer repositorios en la UI y liberar el
    permiso. Ninguna escritura financiera puede ocurrir antes de este punto, porque el permiso exclusivo sigue tomado.
14. **Recuperación**: §13.

Regla de no retroceso: antes de `completed` la candidata no ha recibido escrituras, por lo que revertir es seguro. Desde
`completed`, la recuperación solo avanza (termina reprogramación y limpieza) y **nunca** vuelve a `previous`; volver
atrás exigiría una nueva restauración explícita de esa generación.

## 13. Protocolo de recuperación

Ejecutado solo por `openSmartFinDatabase` con la política `RECOVERY_OWNER`, antes de abrir nada. El resto de abridores
recibe `Refuse(RESTORE_PENDING)`: el Worker devuelve `retry`, los receptores no actúan y los métodos de recordatorios
fallan de forma recuperable.

| Diario | Puntero | Acción |
|---|---|---|
| `staging` | anterior | Borrar `.part` y la generación no activada; borrar diario |
| `switching` / `verifying` | anterior | Igual (no hubo conmutación efectiva) |
| `switching` / `verifying` | candidata | Verificar (§12, paso 12): correcta ⇒ `completed`; incorrecta ⇒ puntero a `previous`, `failed`, candidata conservada |
| `completed` | candidata | Terminar reprogramación y limpieza; nunca retroceder |
| `failed` | cualquiera | Asegurar puntero en `previous`; conservar candidata para diagnóstico |
| ilegible | — | `JOURNAL_CORRUPT`: cuarentena, sin abrir ni crear nada |
| — | activa y `previous` no verifican | Cuarentena con diagnóstico; nunca una base vacía |

`.tmp` y `.part` huérfanos se eliminan siempre; las generaciones nunca se borran en la recuperación. La PoC C1 ejercitó
estas reglas en 13 puntos de cierre (6 reversiones, 5 terminaciones y 2 casos limpios).

## 14. Matriz de fallos Android (preparada, no ejecutada)

Paquete sintético aislado `com.smartfin.restorec4.tests` (nunca `com.smartfin`), datos sintéticos, campañas por
autorización. Cada caso en API 24 y API 35.

| # | Caso | Procedimiento | Resultado esperado |
|---|---|---|---|
| A1 | `AtomicFile` real | Escribir puntero N veces con `kill -9` aleatorio dentro de `startWrite/finishWrite` | Lectura siempre del contenido viejo o nuevo; nunca ilegible |
| A2 | Reinicio del proceso | `am force-stop` / `kill -9` en cada uno de los 13 puntos del protocolo | Recuperación igual a la PoC: anterior o candidata completa |
| A3 | Reinicio del dispositivo | En emulador con instantánea desechable: `adb reboot` tras `switching` y tras `completed` | Igual a A2; puntero y diario coherentes |
| A4 | Durabilidad de la generación | Corte tras `rename` sin `fsync` de directorio (emulador `-no-snapshot`, apagado forzado) | Puntero autodescriptivo resuelve el caso |
| A5 | `Os.fsync` de directorio | Ejecutar en `databases/` y `noBackupFilesDir` | Funciona o falla de forma controlada; se registra por API |
| A6 | WAL y journal | Base activa en WAL y en DELETE; journal caliente en la anterior | La anterior conserva sus auxiliares; la candidata se instala sin ellos |
| A7 | Fallo de escritura | Directorio de destino sin permiso de escritura (sintético) | `.part` no activado; diario fuera; anterior activa |
| A8 | Falta de espacio | Llenar el almacenamiento del emulador con un archivo de relleno | Rechazo previo (`StatFs`) o `recovering` limpio |
| A9 | URI SAF | `ACTION_OPEN_DOCUMENT` sobre proveedor local; copia en streaming | SHA-256 del stream = archivo; URI no persistido |
| A10 | Pérdida de permiso | Revocar o eliminar el documento durante la copia | Staging fallido; nada cambia |
| A11 | Kotlin + JS | Restauración con Headless y mantenimiento de suscripciones en cola | Esperan al permiso; ninguna escritura en la generación anterior |
| A12 | Receptores activos | Alarma y `BOOT_COMPLETED` durante `switching` | `Refuse(RESTORE_PENDING)`; sin abrir |
| A13 | Puntero corrupto | Escribir bytes basura en el puntero (y su `.bak`) | `POINTER_CORRUPT`; sin crear base |
| A14 | Generación inexistente | Puntero válido a un archivo borrado | `ACTIVE_GENERATION_MISSING`; sin crear base |
| A15 | Diario incompleto | Diario `switching` con puntero en cada valor | Tabla de §13 |
| A16 | Conexión residual | Retener el handle JS anterior e intentar usarlo tras conmutar | Rechazo por `generationId` / estado `closed` |
| A17 | Huella Node = Android | Misma base sintética en ambos | Huella y vectores idénticos |
| A18 | Validador en SQLite 3.9.2 | Matriz de §6–8 | Mismos códigos que Node |

## 15. Resultados Node

| Conjunto | Resultado |
|---|---|
| `__tests__/restoreValidationC2.test.ts` (nuevo) | **51/51** |
| `__tests__/restoreProtocolPocC1.test.ts` (C1) | 14/14 |
| `__tests__/backupRestoreAuditPhaseC.test.ts` (auditoría) | 27/27 |
| Regresiones: 1a.4B, equivalencia Android 1a.4B (oráculo Node), revisión inicial 1a.4A, historial 1a.3B, recuperabilidad 5E.5, publicación, coordinación de captura, recuperación de borrado 5E.4 | En verde |
| Total ejecutado (11 suites) | **277/277**, 0 fallos |
| `npx tsc --noEmit` | Sin errores |
| ESLint (ficheros nuevos y de C1/auditoría) | 0 errores, 0 advertencias |
| `git diff --check` / `git diff HEAD` | Sin errores / sin cambios en archivos versionados |

Durante la elaboración fallaron dos aserciones mías (no del validador): el resumen esperaba 4 movimientos y 1 extracto
(el fixture genera 3 y 2, uno por la conciliación) y un vector REAL estaba mal calculado a mano; ambos se corrigieron
contra un cálculo independiente. No se regeneró ningún oráculo histórico. **Nada de esto valida Android.**

## 16. Compatibilidad con API 24 (SQLite 3.9.2)

- Validador: solo usa `sqlite_master`, `PRAGMA table_info/integrity_check/foreign_key_check/user_version/journal_mode`,
  `typeof`, `hex`, `CAST`, `CASE`, `LIKE … ESCAPE`, `round`, `GROUP BY/HAVING`, `COUNT(DISTINCT)`. Todos disponibles. No
  usa `pragma_table_info()` (3.16), `table_xinfo` (3.26), `sqlite_schema` (3.33), funciones JSON ni ventanas.
- Las pruebas usan `VACUUM INTO` y `ALTER TABLE DROP COLUMN` **solo para fabricar variantes** en Node; no forman parte del
  validador.
- Android: `AtomicFile` (17), `Os.rename/fsync/open` (21), `noBackupFilesDir` (21), `StatFs.getAvailableBytes` (18),
  `ACTION_OPEN_DOCUMENT` (19), `SQLiteDatabase.deleteDatabase(File)` (16). `StorageManager.getAllocatableBytes` (26) **no**.
- Riesgo: el límite de 999 parámetros de 3.9.2 no afecta (consultas sin parámetros masivos).

## 17. Compatibilidad con API 35 (SQLite 3.44.5)

Todo lo anterior existe. Funciones modernas (`VACUUM INTO`, `pragma_table_info`) estarían disponibles pero **no** se
usan para mantener una sola implementación. Diferencia relevante a medir en C4: comportamiento de `AtomicFile` (las
versiones recientes escriben en un archivo nuevo y renombran; las antiguas usan `.bak`); ambos garantizan viejo o nuevo,
pero la recuperación debe probarse en las dos.

## 18. Bloqueos arquitectónicos

**No se encontró ninguna conexión imposible de incorporar al resolvedor.** Todas las aperturas de la base activa
reciben un permiso del coordinador o se ejecutan dentro de él, y las nativas abren por llamada. Restricciones que C3
debe respetar (no son bloqueos):

1. El driver crea la base si no existe (`CREATE_IF_NECESSARY`): el resolvedor solo puede entregar nombres existentes,
   salvo `CreateFreshInstall`.
2. El singleton JS debe cerrarse con recibo antes de conmutar; un cierre fallido deja el proceso en cuarentena y la
   restauración no puede continuar hasta reiniciar.
3. El Worker y los receptores abren antes o sin JS: deben negarse con diario pendiente.
4. El epoch de borrado y las alarmas (`datasetEpoch`) viajan dentro de la base: hay que cancelar y reprogramar.
5. Restauración y borrado financiero deben excluirse mutuamente (marcador de admisión y diario).

Riesgos abiertos: triggers con texto histórico distinto en instalaciones antiguas (puede producir rechazos legítimos;
hace falta reunir esquemas de versiones anteriores); `fsync` de directorio no verificado; coste de integridad y huella
con 100 000 movimientos repartidos en 50 años en API 24 (medir en C4).

## 19. Archivos que requeriría modificar C3

| Archivo | Cambio |
|---|---|
| `android/app/src/main/java/com/smartfin/SmartFinDatabaseLocation.kt` (nuevo) | Resolvedor, puntero, marcador, diario |
| `android/app/src/main/java/com/smartfin/SmartFinRestore.kt` (nuevo) | Staging SAF, validador nativo, huella, instalación, recuperación |
| `android/.../SmartFinDatabaseLifecycleModule.kt` | Métodos `resolve`, `stageRestore`, `inspectRestore`, `installRestore`, `recoverRestore` |
| `android/.../SmartFinSubscriptionRemindersModule.kt` | `withDatabase` usa el resolvedor (política `NO_RECOVERY`) |
| `android/.../SmartFinLocalSnapshot.kt` | Origen = generación resuelta del permiso |
| `android/.../SmartFinFinancialDeletion.kt` | Admisión cruzada con el diario de restauración |
| `android/.../SmartFinSubscriptionWorker.kt`, `SmartFinSubscriptionReminderReceiver.kt` | Tratar `RESTORE_PENDING` (retry / no actuar) |
| `src/database/sqliteDatabase.ts` | Nombre resuelto, `generationId` ligado a la conexión, recuperación previa |
| `src/database/managedSQLite.ts` | Rechazo de handles con `generationId` distinto |
| `src/database/nativeDatabaseLifecycle.ts` | Tipos del puente |
| `src/modules/settings/useCases/restoreCandidateValidation.ts`, `restoreFromBackup.ts` (nuevos) | Port del prototipo C2 y orquestación |
| `src/modules/settings/database/restoreSchemaManifest.ts` (nuevo) | Referencia estática de estructura v5 |
| Pruebas | Prueba estática de abridores; Node con el código real; instrumental (C4) |

Sin cambios de esquema (como mucho una clave reservada en `app_settings` si se aprueba R3), sin migración 6, sin tocar
triggers, CSV ni la publicación.

## 20. Recomendación

C2 cumple sus criterios: inventario exhaustivo (§2), contrato implementable del resolvedor (§3, modelo probado),
validador que detecta respaldos incompletos, incompatibles y financieramente inconsistentes aunque `integrity_check`
apruebe (§6–8), versiones futuras rechazadas sin copia de trabajo, migraciones solo en copias aisladas, base activa y
archivo elegido intactos (§11), huella determinista y reproducible por especificación (§9–10), recuperación con estados
y garantías (§12–13) y plan instrumental (§14).

Se recomienda autorizar C3 con este alcance y orden: (1) resolvedor y ligadura por `generationId` sin restauración
(cambio estructural aislado, verificable con las suites actuales), (2) validador y huella en Kotlin con los vectores de
§10, (3) diario, instalación y recuperación, (4) prueba estática de abridores. Decisiones previas necesarias: identidad
de dataset (R3), aplicar R4/R5 en la apertura normal y política de retención de la generación anterior. La seguridad en
Android solo podrá afirmarse tras C4.
