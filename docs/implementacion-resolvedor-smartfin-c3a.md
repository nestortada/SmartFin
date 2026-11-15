# Resolvedor único de SQLite y vinculación de conexiones (Etapa C3A)

7 de noviembre de 2026. Opción B (generaciones con puntero). C3A implementa **solo** el resolvedor, la adopción de
`smartfin.db` y el control de conexiones. No restaura archivos, no activa generaciones, no borra nada y no habilita
respaldos (`BACKUP_PUBLICATION_UI_ENABLED = false`). Sin commit ni push.

> **Límite principal.** El código Kotlin está escrito pero **no compilado ni ejecutado**: no hay `kotlinc` en el
> entorno y compilar Android no estaba autorizado. Todo lo verificado aquí es Node: el código JS de producción real y
> una especificación ejecutable (port de prueba) de la tabla de decisión Kotlin. C3A queda **preparada para validación
> Android**, no aprobada en Android.

## 1. Estado inicial de Git

| Elemento | Resultado |
|---|---|
| Rama / HEAD | `main` / `0f566ee` (desciende de `b3ef6e5`) |
| Archivos versionados modificados antes de empezar | Ninguno |
| No versionados heredados | Auditoría, C1 y C2 (documentos, PoC, prototipos `__tests__/helpers/c2/`) |

## 2. Arquitectura implementada

```
                     ┌───────────────────────────────────────────────┐
                     │ SmartFinDatabaseLocation (Kotlin, única tabla) │
                     │  metadatos AtomicFile en noBackupFilesDir      │
                     └───────────────┬───────────────┬───────────────┘
   RECOVERY_OWNER (solo JS) ─────────┘               └──────── NO_RECOVERY (nativos)
   SmartFinDatabaseLifecycle.resolveDatabase(token)             withDatabase · Worker · receptores
   → databaseLocation.ts (valida unknown, sin reglas)          · borrado financiero · captura
   → openSmartFinDatabase → driver(name resuelto)
   → managedSQLite: conexión ligada a la generación
```

- **Una sola fuente de verdad**: la tabla de decisión vive solo en `SmartFinDatabaseLocation.kt`. JS no decide nada:
  pide la resolución con su token del coordinador y valida la respuesta. No hay dos resolvedores con reglas duplicadas.
- El port TS de la tabla (`__tests__/helpers/c3a/locationModel.ts`) es **solo de prueba**: especificación ejecutable y
  casos de referencia para la futura prueba instrumental Kotlin.
- Plataformas sin resolvedor (Node, iOS fuera de alcance): enlace `managed: false` sobre `smartfin.db`, sin garantías
  de generación; en Android un nativo sin resolvedor provoca `RESOLVER_UNAVAILABLE`, nunca un nombre por defecto.

## 3. Contrato de metadatos (formato 1)

Archivo `noBackupFilesDir/smartfin-database-location.json`, escrito siempre con `AtomicFile` (contenido viejo o nuevo,
nunca parcial). Fuera de SQLite: el esquema no cambia y la base no se toca.

```json
{
  "formatVersion": 1,
  "installationId": "<uuid>",
  "datasetId": "<uuid>",
  "locationEpoch": 1,
  "activeGeneration": {
    "generationId": "<uuid>",
    "fileName": "smartfin.db",
    "status": "initializing | active",
    "origin": "legacyAdoption | freshInstall",
    "fileIdentity": "<st_dev>:<st_ino> | null",
    "recordedAt": "<ISO UTC>"
  }
}
```

Reglas de validación (Kotlin, y en JS sobre la respuesta): `formatVersion` desconocido ⇒ `METADATA_UNSUPPORTED`; JSON
ilegible ⇒ `METADATA_CORRUPT`; campos ausentes o UUID inválidos ⇒ `METADATA_INVALID`; `fileName` distinto de
`smartfin.db` o `smartfin-<uuid>.db` ⇒ `GENERATION_UNRECOGNIZED`; `active` exige identidad, `initializing` no.

Evolución prevista: `formatVersion` 2 (C3B) añadirá `previousGeneration`, `restoreId` y huella de contenido cuando
existan esas garantías; un lector de formato 1 rechazará el 2 (`METADATA_UNSUPPORTED`), nunca lo interpretará a medias.
No se incluyen ahora campos de huella ni `snapshotId` para no simular garantías inexistentes.

## 4. Identidades

| Identidad | Significado | Dónde vive | Cuándo cambia |
|---|---|---|---|
| `installationId` | Instalación local de la app | Metadatos | Al adoptar o inicializar; se pierde al borrar los datos de la app |
| `datasetId` | Conjunto lógico de datos financieros | Metadatos | Hoy solo al adoptar/inicializar. En R3/C3B: al borrar datos financieros y al restaurar |
| `generationId` | Archivo SQLite concreto | Metadatos (+ conexión JS) | Por cada generación; `smartfin.db` adoptada recibe uno |
| `fileIdentity` | Comprobación física `st_dev:st_ino` | Metadatos | Si el archivo se sustituye o recrea (SQLite actualiza en sitio) |
| `locationEpoch` | Versión lógica de la resolución | Metadatos (+ conexión JS) | Cada activación futura (C3B) |
| `snapshotId` | Respaldo concreto | `generationId` de la captura/publicación existente | Pendiente de R3 completo |

`financial_data_revision` no se usa como identidad de nada.

## 5. Política provisional de retención

- Ninguna generación se elimina automáticamente; C3A no contiene código de borrado de bases.
- `smartfin.db` permanece intacta en instalaciones existentes (comprobado: SHA-256 idéntico tras adoptar, abrir, repetir
  un comando y cerrar).
- No se activa ninguna generación restaurada; no hay limpieza automática.
- Una generación anterior no puede reactivarse silenciosamente: una generación invalidada queda en lista de bloqueo de
  proceso y su reapertura se rechaza (`GENERATION_INVALIDATED`) antes de llamar al driver.
- Política definitiva (cuotas, espacio, borrado seguro) antes de habilitar restauraciones reales.

## 6. Integración JS/Kotlin

| Pieza | Cambio |
|---|---|
| `SmartFinDatabaseLocation.kt` (nuevo) | Tabla de decisión, metadatos, adopción, inicialización, confirmación, registro de la conexión JS abierta, `activeFile` para la captura |
| `SmartFinDatabaseLifecycleModule.kt` | `resolveDatabase(token)`, `confirmFreshInstall(token, generationId)`, `releaseDatabaseBinding(token, generationId)`, todos bajo `withParticipant(token)` |
| `src/database/databaseLocation.ts` (nuevo) | Validación estricta de la respuesta nativa, `DatabaseResolutionError`, registro e invalidación de vinculaciones |
| `src/database/sqliteDatabase.ts` | Resolver antes de abrir; nombre resuelto al driver; confirmar instalación nueva tras verificar; descartar y liberar conexiones obsoletas |
| `src/database/managedSQLite.ts` | Conexión ligada a `DatabaseBinding`; cada acceso rechaza una generación obsoleta (cerrar sigue permitido) |
| `localDatabaseSnapshot.ts` | Envía `generationId` de la conexión descrita para que Kotlin copie exactamente esa generación |

## 7. Inventario actualizado de aperturas

Nueva búsqueda estática (y prueba automática `databaseOpenersStaticC3A.test.ts`, que falla si aparece otra):

| Apertura | Antes | Ahora |
|---|---|---|
| Driver JS (`sqliteLifecycle.openConfirmedSQLiteConnection`) | `smartfin.db` fijo | Nombre de `resolveDatabase` bajo el dueño exclusivo |
| `withDatabase` (módulo de recordatorios, receptores, Worker, borrado financiero) | `getDatabasePath("smartfin.db")` | `SmartFinDatabaseLocation.resolve(NO_RECOVERY)` |
| `SmartFinLocalSnapshot.capture` origen | `getDatabasePath("smartfin.db")` | `activeFile(context, generationId de JS)` |
| `SmartFinLocalSnapshot` copia/descarte, `SmartFinBackupCsv` | Copias privadas | Sin cambio (no es la activa) |
| `getDatabasePath` / literal `"smartfin.db"` en Kotlin | 2 sitios | Solo `SmartFinDatabaseLocation.kt` |
| Driver `attach`, `deleteDatabase`, `createFromLocation`, `androidLockWorkaround` | No usados | Siguen sin usarse (prueba estática) |
| `SMARTFIN_DATABASE_NAME` | Usado por el driver | Exportado por compatibilidad, sin uso en aperturas |

## 8. Adopción de `smartfin.db`

Sin metadatos y con `smartfin.db` presente (todas las instalaciones actuales): una única escritura atómica de metadatos
`status=active, origin=legacyAdoption` con `fileIdentity` del archivo. No se copia, renombra, recrea ni abre en
escritura para adoptar. La puede realizar cualquier llamador (también el Worker antes de JS) porque no toca la base y
se serializa con un cerrojo del proceso.

- Repetición: con metadatos válidos no se vuelve a escribir (probado: 1 escritura tras 3 aperturas y reinicios).
- Interrupción: `AtomicFile` deja los metadatos ausentes; el siguiente arranque adopta de nuevo, sin haber tocado la
  base (probado con fallo inyectado en la escritura).
- Prueba financiera con historial 1a.4B sintético (compra, imputación activa, abono borrado con reversión D6,
  `command_id`): tras adoptar, abrir, repetir un comando (`replayed`) y cerrar, el **SHA-256 del archivo**, la **huella
  canónica C2** y `financial_data_revision` son idénticos.

## 9. Instalación nueva

Solo la apertura JS (`RECOVERY_OWNER`), sin metadatos, sin `smartfin.db` y sin generaciones: escribe metadatos
`initializing`, el driver crea el archivo, se aplican esquema y migraciones y se verifican integridad, FK y revisión;
**solo entonces** `confirmFreshInstall` pasa a `active` con la identidad del archivo. Si algo falla antes, queda
`initializing` y el siguiente arranque reanuda la misma generación (probado). Mientras tanto, los nativos reciben
`NOT_INITIALIZED` (equivalente al «todavía no hay base» anterior) y no inicializan nada.

## 10. Puntero o metadatos corruptos

| Situación | Código | ¿Recuperación requerida? |
|---|---|---|
| JSON ilegible | `METADATA_CORRUPT` | Sí |
| Formato futuro | `METADATA_UNSUPPORTED` | Sí |
| Campos incompletos | `METADATA_INVALID` | Sí |
| Generación no reconocida o con ruta | `GENERATION_UNRECOGNIZED` | Sí |
| Archivo registrado ausente | `DATABASE_LOST` | Sí |
| Archivo sustituido (otra identidad) | `FILE_IDENTITY_MISMATCH` | Sí |
| Generación sin metadatos | `POINTER_LOST` | Sí |
| Diario de restauración pendiente | `RESTORE_PENDING` (reintentable) | Sí |

Ninguno vuelve a `smartfin.db` por defecto ni crea una base. En JS llegan como `DatabaseResolutionError(code, retryable,
recoveryRequired)` a `openSmartFinDatabase`; el arranque no continúa como instalación nueva. La interfaz actual muestra
su mensaje genérico de apertura fallida (sin cambios de UI en C3A).

## 11. WorkManager

- No asume que JS inicializó nada: usa `NO_RECOVERY`.
- Instalación existente sin metadatos: puede adoptar (no destructivo) y continuar.
- Instalación nueva o inicialización pendiente: `withDatabase` devuelve `null` como antes ⇒ comportamiento previo.
- `RESTORE_PENDING` ⇒ `Result.retry()` (backoff acotado de WorkManager).
- Cualquier otro `Unavailable` (perdida, corrupta, ajena) ⇒ `Result.failure()`: error permanente, sin bucle.
- Nunca crea la base ni sobrescribe un estado pendiente.

## 12. Receptores

El receptor de alarmas conserva `acquire(OWNER)` exclusivo y su participante. `withDatabase` resuelve antes de abrir:
con diario pendiente o metadatos inválidos lanza `Unavailable` **sin abrir**, el receptor lo captura (como cualquier
error) y encola la recuperación; `enqueueRecovery` vuelve a resolver, falla y no encola nada. No hay esperas
artificiales. El receptor de recuperación (`BOOT_COMPLETED`) sigue el mismo camino.

## 13. Vinculación e invalidación de conexiones

- Cada conexión administrada JS guarda `DatabaseBinding` (`generationId`, `fileName`, `fileIdentity`, `locationEpoch`,
  `installationId`, `datasetId`) y lo expone en `sqliteConnectionState`.
- `validate()` (cada consulta, transacción, participante y control) rechaza una generación invalidada o distinta de la
  activa: «SQLite connection belongs to an obsolete database generation». Cerrar sigue permitido.
- `invalidateDatabaseGeneration(id)` (interno, para C3B) bloquea esa generación en el proceso; `openSmartFinDatabase`
  descarta la conexión obsoleta, libera su vínculo nativo y no reabre esa generación (`GENERATION_INVALIDATED`), antes
  de llamar al driver.
- Lado nativo: las aperturas nativas son por llamada y resuelven cada vez, así que no conservan archivos obsoletos.
  Kotlin registra qué generación tiene abierta la conexión JS (`resolveForJs` / `releaseJsBinding` en el cierre
  confirmado); `openJsBinding()` es la precondición que C3B debe exigir antes de activar otra generación, para no
  depender solo de una variable JS.

## 14. Protección contra bases vacías

El driver crea si falta (`CREATE_IF_NECESSARY`), así que la protección está antes: el resolvedor solo entrega un nombre
existente salvo en instalación nueva verificada. Probado: diario pendiente, base registrada perdida y metadatos
corruptos ⇒ error tipado, **el driver no se invoca** y no aparece ningún `smartfin.db`. La pérdida de una base ya
registrada es ahora detectable (`DATABASE_LOST`), lo que cubre el caso R6 de la auditoría.

## 15. Concurrencia

- Dos `openSmartFinDatabase` simultáneos: una resolución, una apertura del driver, el mismo handle (cola JS +
  dueño nativo).
- En Kotlin, `resolve`, adopción y confirmación se serializan con un cerrojo de proceso; dos llamadores nunca escriben
  identidades distintas (proceso único, `allowBackup="false"`).
- Una conexión residual intenta leer y escribir tras invalidar su generación ⇒ rechazo.

## 16. Resultados Node y regresiones

| Conjunto | Resultado |
|---|---|
| `__tests__/databaseResolverC3A.test.ts` (nuevo) | 32/32 (16 de especificación Kotlin, incluidos los 13 escenarios C2; 16 de integración JS) |
| `__tests__/databaseOpenersStaticC3A.test.ts` (nuevo) | 4/4 |
| `__tests__/localSnapshotCoordination.test.ts` | 14/14 (ver nota) |
| Suite Jest completa (`npx jest --runInBand`, una sola ejecución) | **99 suites aprobadas, 7 omitidas; 1.607 pruebas aprobadas, 14 omitidas, 0 fallos**; 8/8 snapshots. Incluye auditoría, C1, C2, 1a.4B, atomicidad y consumidores de `managedSQLite`. Omitidas: las suites condicionadas por variables de entorno, como en la línea base. Sin fallo intermitente de `subscriptionAtomicityPhase4` en esta ejecución |
| `npx tsc --noEmit` | Sin errores |
| ESLint (archivos modificados y nuevos) | 0 errores, 0 advertencias |
| `git diff --check` | Sin errores (solo avisos informativos LF/CRLF) |

Nota: `localSnapshotCoordination` simula el módulo nativo; sin resolvedor, la app ahora se niega a abrir
(`RESOLVER_UNAVAILABLE`), que es el comportamiento buscado. Se añadió al simulador `resolveDatabase`,
`confirmFreshInstall` y `releaseDatabaseBinding`, sin registrar llamadas en su traza: **todas sus aserciones y
secuencias originales siguen idénticas**. No se tocó ningún oráculo.

Fallos durante el desarrollo (corregidos, todos del arnés o de aserciones mías): mezcla de registros de módulos tras
`jest.resetModules`, una aserción que esperaba promesa rechazada donde `managedSQLite` lanza de forma síncrona (contrato
previo, no cambiado), y la reapertura de una generación invalidada, que era segura pero llegaba al driver; ahora se
rechaza antes (`assertResolutionUsable`).

## 17. Archivos de producción modificados

| Archivo | Tipo |
|---|---|
| `android/app/src/main/java/com/smartfin/SmartFinDatabaseLocation.kt` | Nuevo (**sin compilar**) |
| `android/app/src/main/java/com/smartfin/SmartFinDatabaseLifecycleModule.kt` | +3 métodos de puente (**sin compilar**) |
| `android/app/src/main/java/com/smartfin/SmartFinSubscriptionRemindersModule.kt` | `withDatabase` resuelve (**sin compilar**) |
| `android/app/src/main/java/com/smartfin/SmartFinLocalSnapshot.kt` | Origen resuelto (**sin compilar**) |
| `android/app/src/main/java/com/smartfin/SmartFinSubscriptionWorker.kt` | Clasificación reintentable/permanente (**sin compilar**) |
| `src/database/databaseLocation.ts` | Nuevo |
| `src/database/sqliteDatabase.ts` | Resolución, confirmación, liberación |
| `src/database/managedSQLite.ts` | Vinculación y rechazo de generaciones obsoletas |
| `src/modules/settings/services/localDatabaseSnapshot.ts` | `generationId` en la captura |

Sin cambios en migraciones, triggers, esquema, casos de uso financieros, interfaz, publicación, hooks ni guards.
Pruebas: nuevas `databaseResolverC3A`, `databaseOpenersStaticC3A`, `helpers/c3a/locationModel.ts`; adaptado el
simulador nativo de `localSnapshotCoordination`.

## 18. Riesgos pendientes

1. **Kotlin sin compilar**: errores de compilación o diferencias con la especificación solo aparecerán al compilar
   (requiere autorización). Es el primer paso de la validación.
2. **Identidad por inodo**: estable en ext4/f2fs para escrituras de SQLite en sitio; hay que comprobarlo en API 24 y 35
   (incluida la reapertura tras reinicio del dispositivo). Si un fabricante cambiara inodos, `FILE_IDENTITY_MISMATCH`
   bloquearía la app: es un fallo seguro pero grave.
3. **UI**: el arranque recibe un error tipado, pero la pantalla sigue mostrando el mensaje genérico; falta presentar
   «recuperación requerida» (cambio de interfaz no autorizado en C3A).
4. **Headless JS** con resolución rechazada: la tarea falla y el Worker reintenta según su lógica previa.
5. **Diario pendiente sin recuperación**: en C3A bloquea todas las aperturas hasta que exista C3B; solo puede aparecer
   si alguien crea el archivo, porque nada lo escribe todavía.
6. **TOCTOU del driver**: entre resolver y abrir, un borrado externo del archivo haría que el driver lo creara. Bajo el
   dueño exclusivo ningún código de SmartFin borra bases; un borrado externo requeriría acceso privilegiado.
7. **iOS**: sin resolvedor (fuera de alcance del proyecto).

## 19. Plan Android (API 24 y API 35, no ejecutado)

Aplicación sintética aislada `com.smartfin.resolverc3a.tests` (nunca `com.smartfin`), datos sintéticos, autorización
previa para compilar e instalar.

| # | Caso | Esperado |
|---|---|---|
| 1 | Compilación de los 5 archivos Kotlin | Sin errores |
| 2 | Conformidad Kotlin con los casos de `locationModel.ts` (prueba instrumental con el mismo listado) | Mismos códigos y escrituras |
| 3 | Instalación nueva | `initializing` → `active` tras verificar; base creada una vez |
| 4 | Adopción de `smartfin.db` existente (base sintética precargada) | Metadatos `legacyAdoption`; SHA-256 de la base idéntico |
| 5 | Adopción interrumpida (`kill -9` durante `AtomicFile`) | Metadatos ausentes o completos; base intacta |
| 6 | WorkManager antes de JS (forzar trabajo tras `force-stop`) | Adopta o `NOT_INITIALIZED`; nunca crea |
| 7 | Receptor con diario pendiente o metadatos corruptos | No abre; no encola bucles |
| 8 | Aperturas concurrentes (UI + Headless + receptor) | Una resolución por permiso; sin identidades distintas |
| 9 | Puntero inválido / generación no reconocida | Rechazo tipado; driver no invocado |
| 10 | Base perdida tras instalación registrada | `DATABASE_LOST`; ningún archivo nuevo |
| 11 | Conexión residual tras invalidar | Rechazo en JS; `openJsBinding` liberado tras cierre |
| 12 | Reinicio del proceso y del dispositivo | Misma generación; inodo estable |
| 13 | Integridad financiera (historial 1a.4B sintético) | Saldos, movimientos, imputaciones, revisiones y contador idénticos |
| 14 | Captura de respaldo | Copia la generación descrita; rechaza si cambió |
| 15 | Regresiones Android 1a.4B y 5B.1 con el APK sintético | Sin diferencias |

## 20. Recomendación

Criterios de C3A verificados en Node: todas las aperturas pasan por el resolvedor (prueba estática); ninguna elige por
suposición ni crea bases vacías; `smartfin.db` se conserva byte a byte; las conexiones quedan ligadas a su generación y
las obsoletas se invalidan; WorkManager y receptores fallan de forma segura (según la especificación); un diario
pendiente bloquea las aperturas; no cambia ningún resultado financiero, migración, trigger ni oráculo.

**No se puede declarar terminada la integración Android**: el Kotlin no se ha compilado. Se recomienda, antes de C3B,
autorizar la compilación y la validación instrumental de §19 (casos 1–15). Después, C3B (diario, instalación de
generaciones y activación protegida) sobre este resolvedor.
