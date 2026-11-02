# Recuperación, driver, snapshots y respaldos

## Conocer las fronteras reales

| Nivel | Evidencia vigente y límite |
|---|---|
| Node sintético | `__tests__/helpers/realSQLite.ts` usa `node:sqlite`, normalmente `:memory:`; `syntheticPath` solo para temporales creados por el llamador. Inyecta fallos antes/después de SQL, conserva trazas y barreras. Sus callbacks son síncronos y no reproducen bridge, DBRunner ni sesiones Android |
| Driver RN instalado | `react-native-sqlite-storage` 6.0.1, comprobado en package instalado; declaración `^6.0.1` no basta para fijar versión. Leer `node_modules/react-native-sqlite-storage/lib/sqlite.core.js`, `sqlite.js` y rama Java usada por autolinking |
| Android | La app declara minSdk 24 en `android/build.gradle`; el driver Java usa SQLite de plataforma. No existe una versión SQLite única para todos los dispositivos. Las campañas históricas registran 3.9.2 en API 24; registrar `sqlite_version()` y configuración reales en cada campaña nueva |
| Coordinación nativa | `android/app/src/main/java/com/smartfin/SmartFinDatabaseCoordinator.kt` protege fábricas participantes del proceso. Verificar todo punto nativo que abra SQLite, en especial recordatorios, Worker, recepción y captura; no inferir cobertura multiproceso |

El Node instalado en la auditoría era 24.16.0 y `package.json` exige `>=24.16.0 <25`. Documentación antigua que menciona Node >=22.13 no es el requisito vigente del proyecto. El número de SQLite de Node se registra al ejecutar la validación, no se adivina.

## Driver y parches

`scripts/patchReactNativeSqliteStorage.js` es `postinstall`: reemplaza jcenter por mavenCentral, ajusta AGP a 8.9.2 y exige driver 6.0.1 antes de aplicar `scripts/sqliteAndroidRecoveryPatch.js`.

El parche aprobado añade, en la rama de cierre del DBRunner Java instalado, `while (this.mydb.inTransaction()) { this.mydb.endTransaction(); }` antes de cerrar. Libera sesiones abandonadas **en ese hilo**, conserva flags nativos de commit y no transforma el resultado JS `unknown` en rollback. El parche falla si el layout no es el esperado y es idempotente; no añade reintentos financieros. La auditoría confirmó sus líneas en el Java instalado sin ejecutar postinstall ni instalar dependencias.

Al modificar driver/patch: comparar fuente instalada, versión bloqueada y destino de autolinking; probar idempotencia, anclas ausentes/duplicadas y error explícito. Ejecutar `__tests__/sqliteAndroidRecoveryPatch.test.ts`. No ejecutar el script de parche como una simple comprobación, pues escribe `node_modules`. Cambiar driver exige pruebas autorizadas del driver real, no solo este test textual.

`src/database/sqliteLifecycle.ts` espera callback de apertura nativa: la Promise del driver puede resolver primero un objeto provisional. Recibos perdidos de apertura/cierre/verificación deben fallar y no resucitar la conexión con callbacks tardíos. `src/database/sqliteDatabase.ts` retiene fallo de inicialización; `managedSQLite` conserva generaciones/cuarentena y errores de cierre. No borres esos estados para forzar reapertura en un mismo runtime.

## Procedimiento de fallo y reapertura

1. Clasifica dónde se perdió evidencia: antes/después de escritura, BEGIN, COMMIT, ROLLBACK, close, open o verificación de estado. Conserva error original y errores de rollback/recuperación; fallo de transporte no equivale a fallo de SQL.
2. Para `unknown`, conserva el bloqueo/revocación del flujo. Nunca repitas el cuerpo por timeout ni emitas un rollback especulativo. Sigue [la clasificación transaccional](transactions-and-concurrency.md).
3. Reabre solo mediante el ciclo administrado vigente si ese estado lo admite. Una cuarentena/fallo retenido puede requerir reinicio del proceso y revisión explícita; no aceptes handles escapados o provisionalmente abiertos.
4. En fixture sintético aislado, comprueba estado persistido, recibos específicos, FK, integridad, revisión y relaciones al reabrir. Simula por separado fallo previo a COMMIT y respuesta perdida después del COMMIT, que puede dejar todo confirmado.
5. Para cierre inesperado de proceso, utiliza campaña sintética autorizada con archivo, puntos de interrupción y reapertura independientes. No extrapoles un rechazo de Promise o `close()` normal a durabilidad frente a terminación abrupta/pérdida de energía. Verifica journal/synchronous reales antes de atribuir garantías; esta arquitectura no fija universalmente WAL ni demuestra todos esos escenarios.

No elimines manualmente WAL/SHM/journals para desbloquear la app, certificar una copia o reparar un error. SQLite debe gestionar su recuperación. La revisión no detecta corrupción de bytes ni sustituye hashes/validación.

## Protocolo de captura local implementado

Fuentes: `src/modules/settings/services/localDatabaseSnapshot.ts`, `android/app/src/main/java/com/smartfin/SmartFinLocalSnapshot.kt` y ciclo nativo.

1. Mantiene permiso exclusivo JS+nativo, rechaza participante activo y modos journal distintos de WAL/DELETE/TRUNCATE/PERSIST. No presupone que WAL esté activado.
2. En WAL exige checkpoint TRUNCATE **completo**: una fila con busy=0, log=0 y checkpointed=0; una respuesta busy sin excepción también falla.
3. Describe FK habilitadas, esquema, conteos, revisión y versiones; cierra el driver con recibo antes de copiar. El origen no ejecuta dos veces verificaciones completas costosas: integridad/FK exhaustivas se realizan sobre la copia de bytes iguales.
4. Kotlin abre/describe el origen cerrado en modo RO, habilita explícitamente FK, copia a UUID privado en `noBackupFilesDir`, sincroniza archivo y valida la copia RO: esquema, conteos, revisión, FK, integridad y SHA-256 origen/copia.
5. PERSIST/TRUNCATE son modos de conexión: RO puede observar DELETE. Conserva la comprobación de familia WAL, sin exigir igualdad textual imposible para todos los modos.
6. Reabre singleton y devuelve handle nuevo antes de liberar ambos permisos; si falla captura o recuperación, `LocalSnapshotFailure` preserva ambos errores. Una captura válida no aclara un comando financiero anterior `unknown`.

Los temporales abandonados no se descubren automáticamente como respaldos válidos. La limpieza se limita a recursos privados propios y deja a SQLite administrar auxiliares; no tocar el archivo financiero ni sus journals.

## Publicación y exportación implementadas

`src/modules/settings/services/androidDriveBackupService.ts` prepara un trabajo, captura y publica con `android/app/src/main/java/com/smartfin/SmartFinBackupPublisher.kt`. SAF/`DocumentsContract` es integración del proveedor Android, sin OAuth ni API propia de Drive. Mantén autorización local-first de la tarea y no añadas llamadas remotas.

La publicación v2 usa trabajos `AtomicFile`, nombres UUID, `smartfin-generation-UUID.json`, revisión/época y hash/tamaño de cada componente. Selecciona una generación solo tras releer y validar todos los archivos; no basta encontrar un manifiesto o una copia. Los nombres fijos heredados no se actualizan como si fueran el contrato v2. `backup_records` sigue sin ser historial operativo de estos trabajos.

`verifyDriveBackupJob(id)` verifica/reanuda **el trabajo y snapshot originales**, no recaptura el estado actual bajo la misma identidad. Fallos parciales conservan evidencia y estados prepared/snapshotValidated/publicationPending/verified/failed/uncertain. Validar lectura a través del proveedor no acredita subida completada al servidor remoto.

`src/modules/settings/services/backupPublicationPolicy.ts` mantiene `BACKUP_PUBLICATION_UI_ENABLED=false`. La existencia del publisher y sus pruebas no autoriza activar ese gate. Los CSV se producen en `android/app/src/main/java/com/smartfin/SmartFinBackupCsv.kt`; consulta [rendimiento](performance.md) para exactitud y orden Android.

No hay un procedimiento integrado de restauración de la app acreditado. `__tests__/backupRecoverabilityPhase5E5.test.ts` y utilidades de fase 5E.5 verifican copias/generaciones sintéticas en una estación aislada; eso demuestra recuperabilidad de esos artefactos bajo sus condiciones, no restauración UX ni cualquier archivo real. No abras carpetas de respaldo del usuario para validarlo.

## Eliminación financiera implementada

`src/modules/settings/useCases/deleteFinancialData.ts` coordina con `src/modules/settings/services/financialDeletionLifecycle.ts` y `android/app/src/main/java/com/smartfin/SmartFinFinancialDeletion.kt`.

La admisión durable excluye respaldo/borrado simultáneo; bajo permiso se obtiene inventario, y `src/modules/settings/repositories/sqliteFinancialDataRepository.ts` borra 36 tablas en orden FK y confirma intención cleanupPending + recibo en `app_settings` con el mismo commit. Conserva settings, migraciones y contador de revisión. La limpieza OS/WorkManager/alarmas/snapshots/trabajos ocurre **después**, fuera de permisos SQLite, y puede quedar pendiente recuperable. Solo esos efectos idempotentes se repiten; el borrado financiero no se reenvía por incertidumbre.

Épocas de dataset rechazan trabajos/recordatorios anteriores; generaciones externas se consideran históricas. El código no elimina copias externas SAF como efecto del borrado local. DELETE no borra el archivo SQLite ni realiza borrado físico garantizado/VACUUM; no prometas eliminación forense.

Prueba rechazo/admisión, rollback confirmado, unknown, limpieza pendiente, llamada concurrente de recuperación y reinicio sintético. `running` no significa completed: `__tests__/financialDeletionRecoveryPhase5E4.test.ts` verifica espera acotada y deduplicación de recuperación. No conviertas pending/unknown en éxito al volver al primer plano.
