# Mapa de arquitectura y auditoría

## Alcance y vigencia

Auditoría del árbol de trabajo del 1 de noviembre de 2026, sobre HEAD `09c7ac8ebcc9ffe3eb835089a203dcb78acb0a34` **con cambios locales preexistentes**. No identifica ese commit como una copia exacta del árbol. Las huellas de las fuentes inspeccionadas y configuraciones están en la entrega de validación; revalida cualquier afirmación si cambian. Se leyeron instrucciones, documentación, DDL, migraciones, coordinación, repositorios, ámbitos, servicios, Kotlin, driver instalado y pruebas. No se abrió una base del usuario ni se ejecutó Android.

## Esquema y relaciones

`src/database/sqliteSchema.ts` define `smartfin.db`, DDL base y triggers. `src/database/migrations.ts` instala las versiones **1, 2, 3 y 4** en `schema_migrations`. No usa `PRAGMA user_version` como contador de migración. `src/database/sqliteDatabase.ts::applySchema` aplaza DDL compartido y pérdidas hasta las migraciones correspondientes: ejecutar todas las constantes sin ese filtro no reproduce exactamente el arranque sobre una instalación antigua.

El esquema instalado tiene **39 tablas**. El [inventario derivado](schema-inventory.md) enumera todas las PK, FK, acciones de borrado e índices; el [JSON](schema-inventory.json) contiene columnas, DDL, CHECK, unicidad e instrucciones completas de triggers, incluidos índices automáticos. Fue obtenido de una base sintética en memoria aplicando el DDL vigente y el generador real de migraciones, con un adaptador aislado. No es una base financiera.

Fuentes adicionales imprescindibles para reconstruirlo:

- `src/modules/subscriptions/database/schema.ts`: columnas de recurrencia, ocurrencias y recordatorios (migración 2).
- `src/modules/transactions/database/sharedExpenseSchema.ts`: fechas civiles, participación, seis tablas compartidas, índices de fecha/posición y triggers (migración 3).
- `src/modules/transactions/database/sharedLossSchema.ts`: diario de pérdidas, FK diferida autorreferente, CHECK e índices (migración 4).

La mayoría de PK son `id TEXT`. Excepciones: `app_settings.setting_key`, `credit_card_profiles.account_id`, `financial_data_revision.id` (CHECK id=1), `schema_migrations.version` y la PK compuesta `transaction_tax_tags(transaction_id,tax_tag_id)`. Las relaciones polimórficas de presupuestos, alertas y flujo de caja no tienen FK; `participation_key` también exige validación de dominio. `foreign_key_check` no detecta por sí solo inconsistencias en esas referencias.

Importes del libro/cuentas: `REAL` y `number` COP. Compartidos/pérdidas: centavos `INTEGER` con CHECK de tipo, signo y rango seguro. No hay conversión global. Los estados del núcleo se validan en TypeScript; algunas tablas nuevas sí tienen CHECK. `shared_loss_no_update` prohíbe UPDATE del diario; **no prohíbe DELETE**, necesario en el borrado financiero.

Los triggers de revisión cubren las 24 tablas de `BACKUP_TRACKED_TABLES`, dos de suscripciones, seis compartidas y el diario de pérdidas. Este último tiene INSERT/DELETE de revisión y un BEFORE UPDATE que aborta. No confundas la revisión con checksum, ID de dataset o contador de comandos: varias sentencias del mismo comando pueden incrementarla; un rollback confirmado revierte sus incrementos. `app_settings`, `ai_command_drafts`, `backup_records` y mensajes heredados no forman parte de la lista base de seguimiento.

## Capas y repositorios vigentes

UI/hook → caso de uso → contrato/repositorio → adaptador SQLite. Plataforma en servicios/Kotlin. Ninguna regla financiera nueva ni SQL directo debe añadirse a pantallas.

| Persistencia | Responsabilidad y límite observado |
|---|---|
| `src/modules/accounts/repositories/sqliteAccountRepository.ts` y `src/modules/accounts/repositories/saveSqliteAccounts.ts` | Lectura de cuentas; lote mediante generador atómico y UPDATE + INSERT condicionado |
| `src/modules/transactions/repositories/sqliteTransactionRepository.ts` | Libro completo, proyecciones mensuales/días, guardado/borrado con reconciliación compartida y de suscripciones; metadatos/reglas de comercio y recategorización |
| `src/modules/transactions/repositories/sqliteTransactionHistory.ts` | Páginas, filtros, pruebas de orden, revisión, compatibilidad de fechas y cachés acotadas; no reemplaza el libro completo de otros consumidores |
| `src/modules/creditCards/repositories/sqliteCreditCardRepository.ts` | Cuentas/perfiles, extractos, compras a cuotas, asociación y cierre; varios métodos individuales conservan bucles/REPLACE, su atomicidad compuesta depende del ámbito exterior |
| `src/modules/creditCards/repositories/sqliteCreditCardAlertRepository.ts` | Alertas de tarjeta faltante; participante creado por la composición de gestión |
| `src/modules/categories/repositories/sqliteCategoryRepository.ts` | Catálogo, guardado y reasignación/borrado; la secuencia de reasignación no abre una transacción propia |
| `src/modules/categories/repositories/sqliteSubcategoryRepository.ts` | Subcategorías; conserva REPLACE; no inferir atomicidad de un lote aislado |
| `src/modules/subscriptions/repositories/sqliteSubscriptionRepository.ts` | Carga/persistencia de estado mediante generadores, ocurrencias, conciliación, proyecciones y deseos de recordatorios |
| `src/modules/transactions/repositories/sqliteSharedExpenseRepository.ts` | Estado compartido, lecturas agregadas, comandos con comprobante durable y único commit |
| `src/modules/transactions/repositories/sqliteSharedCommandReads.ts` | Lecturas acotadas para comandos compartidos, con registro de participante |
| `src/modules/transactions/repositories/sqliteAiDraftRepository.ts` | Borradores activos y comprobantes internos confirmed; preserva comprobantes al limpiar activos |
| `src/modules/settings/repositories/sqliteSettingsRepository.ts` | Preferencias explícitas; no sobrescribe todas las claves internas de ciclo de vida |
| `src/modules/settings/repositories/sqliteFinancialDataRepository.ts` | DELETE ordenado + intención/recibo de borrado en un commit; conserva configuración, registro de migraciones y revisión |

Los contratos y fachadas de dashboard/cuentas consumen estas lecturas; la existencia de tablas de presupuestos, préstamos, metas o reportes no demuestra módulos funcionales.

## Conexión, permisos y transacciones

| Archivo | Garantía y alcance |
|---|---|
| `src/database/sqliteDatabase.ts` | Promesa singleton; apertura confirmada, esquema/migraciones, FK activas, `foreign_key_check`, `integrity_check` y revisión entera no negativa antes de publicar el handle; fallo de apertura se retiene |
| `src/database/sqliteLifecycle.ts` | Recibo nativo frente a objeto provisional del driver; timeout de 10 s para recibos, no concesión anticipada de permisos |
| `src/database/databaseCoordination.ts` | Cola JS compartida UI/Headless, permiso validado por WeakSet y token Kotlin; adquirir JS antes de nativo; préstamo evita reencolar al mismo propietario |
| `src/database/managedSQLite.ts` | Proxy sin exposición raw, generaciones, revocación/expiración, bloqueo de control SQL y de transacciones anidadas; cierre fallido deja cuarentena y fallo retenido |
| `src/database/sqliteRepositoryScope.ts` | WeakMap privado repositorio→handle; permite verificar identidad de conexión y reconstruir repositorios participantes sin añadir SQLite al contrato de dominio |
| `src/database/atomicSQLite.ts` | Runner compartido `BEGIN IMMEDIATE` y resultados ternarios; runner local de generadores síncronos desde callbacks o sentencias del participante exterior |
| `android/app/src/main/java/com/smartfin/SmartFinDatabaseCoordinator.kt` | Gate de proceso con propietario/generación y participantes nativos; invalidación/cuarentena impide nuevos accesos. No es un bloqueo entre procesos distintos |
| `src/database/nativeDatabaseLifecycle.ts` y `android/app/src/main/java/com/smartfin/SmartFinDatabaseLifecycleModule.kt` | Frontera tipada de coordinación, captura y ciclo de borrado |

No describir la cola como snapshot transaccional de cualquier secuencia de lecturas. Sin permiso prestado, cada llamada administrada vuelve a adquirir permiso; una operación que requiera consistencia debe usar su ámbito vigente. Más detalle en [transacciones](transactions-and-concurrency.md).

Composición multientidad comprobada: `src/modules/transactions/useCases/manualTransactionScope.ts`, `src/modules/creditCards/useCases/creditCardPaymentScope.ts`, `src/modules/creditCards/useCases/creditCardManagementScope.ts`, `src/modules/creditCards/useCases/creditCardManagementCommands.ts`, `src/modules/transactions/useCases/executeAiCommandPlan.ts`, la fachada compartida y `src/modules/subscriptions/services/subscriptionRuntime.ts`. No se extiende automáticamente a otro método del mismo repositorio ni a efectos Android.

## Respaldo, recuperación y eliminación

La captura local coordina permisos, valida checkpoint, describe esquema/conteos/revisión, cierra con recibo, copia/verifica en Kotlin y reabre antes de liberar. La publicación v2 mantiene trabajos durables, archivos UUID y hashes por componente; su bandera de UI está desactivada. El borrado tiene admisión durable, intención/recibo SQLite y limpieza Android recuperable. Consulta [recuperación y respaldos](recovery-and-backups.md) para las fuentes y garantías precisas. No hay restauración integrada en la app demostrada por estos componentes.

## Contradicciones que se comprobaron

| Afirmación histórica | Evidencia actual y conclusión |
|---|---|
| `docs/BASE_DE_DATOS.md` §13–14 propone introducir migraciones y describe borrado/lotes como no transaccionales | `migrations.ts` aplica 1–4; `sqliteFinancialDataRepository.ts` usa runner compartido; cuentas y movimientos usan generadores. Recomendaciones históricas, no diagnóstico global vigente. Categorías aún requiere análisis propio |
| §6 describe reemplazo de archivos fijos y controles de actualización disponibles | `androidDriveBackupService.ts::exportDriveBackup` captura/publica v2; `SmartFinBackupPublisher.kt` usa generaciones UUID; `backupPublicationPolicy.ts` devuelve false. No activar UI ni sustituir lectores heredados por asumir aquel contrato |
| Copias de `smartfin-financial-domain` niegan flujo compartido y enumeran solo migraciones 1/2 en algunos párrafos | `createSharedExpenseApi.ts`, repositorio compartido, esquema 3/4 y pruebas actuales demuestran API persistente. No demuestran una interfaz completa de compartidos. No se editó esa skill |
| Historial descrito como lote fijo 200 y simple cursor de fecha textual | `sqliteTransactionHistory.ts` usa orden civil CAST, rango indexado, pruebas de fechas y lotes que crecen de 200 a 6.400; las pruebas 5E.2/5E.3 y refinamiento son más recientes que el relato de fases 3/3.1 |
| Todo agregado conserva sumas binarias anteriores | `src/shared/utils/exactCopCents.ts` y el dashboard añaden acumulación exacta de centavos cuando es representable, con fallback. Una optimización debe conservar esa decisión actual |
| Una suite verde que reproduce un estado parcial acepta ese comportamiento | `__tests__/financialIntegrity.test.ts`, helpers phase0 y `jest.reproductions.config.js` incluyen caracterización; `test.failing` verde puede significar defecto vigente. Clasificar cada caso antes de usarlo como aceptación |

Estas contradicciones están documentadas, no reparadas por esta entrega. Una auditoría antigua bajo `docs/` sirve para localizar evidencia, no para certificar el código actual.

## Evolución propuesta, separada de lo implementado

- Actualizar secciones históricas y copias de la skill financiera en una tarea específica.
- Auditar ámbitos de categorías y REPLACE heredados antes de ampliarlos; no cambiar indiscriminadamente los usos existentes.
- Mantener validación de driver en API mínima y moderna, orden de índices de expresión y fallos de recibos cuando haya autorización Android.
- Diseñar y validar restauración integrada si se solicita. Captura/publicación recuperable no la implementa.
- Evaluar cambios monetarios o cifrado únicamente con requisitos y migraciones explícitos; quedan fuera de esta skill y entrega.
