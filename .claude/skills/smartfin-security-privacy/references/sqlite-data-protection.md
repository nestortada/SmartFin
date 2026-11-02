# Protección del archivo financiero SQLite

## Mapa que se debe revalidar

- `src/database/sqliteDatabase.ts`: apertura `smartfin.db`, `location: 'default'`, migraciones y comprobación FK/integridad/revisión. `src/database/sqliteSchema.ts` define tablas y activa FK.
- `src/database/{atomicSQLite.ts,databaseCoordination.ts,managedSQLite.ts,sqliteLifecycle.ts}`: ámbitos compartidos, permisos, conexiones y cuarentena. Expande las llaves como rutas independientes al buscar.
- `android/app/src/main/java/com/smartfin/SmartFinLocalSnapshot.kt`: usa `context.getDatabasePath("smartfin.db")`; copia privada a `noBackupFilesDir/smartfin-local-snapshots/<UUID>/snapshot.db`. Recibos y trabajos contienen metadatos sensibles.
- `scripts/patchReactNativeSqliteStorage.js` y `scripts/sqliteAndroidRecoveryPatch.js`: parches necesarios del driver, que usa SQLite Android. No hay configuración de SQLCipher/clave de base en la apertura revisada.

## Revisión

1. Sigue la resolución nativa del archivo, UID y contexto de almacenamiento por plataforma. No hardcodees `/data/data` como única ruta ni uses `adb pull`/`run-as` sobre producción. Comprueba permisos únicamente en un entorno sintético autorizado; el código no prueba modos efectivos de una instalación.
2. Inventaría archivo principal, `-wal`, `-shm`, rollback journal, temporales, snapshots, recibos y copias. Todos pueden contener datos o metadatos sensibles. No copies solo el principal mientras hay escritores, ni borres auxiliares manualmente. Sigue el checkpoint/cierre/captura/reapertura confirmado del servicio existente.
3. Separa tres propiedades: atomicidad/FK/integridad estructural; confidencialidad; autenticidad frente a manipulación. `integrity_check`, SHA-256 y revisiones financieras no son cifrado ni firma.
4. Revisa cada SQL alcanzable desde búsqueda, IA, formulario, archivo o puente: usa parámetros para valores. Identificadores, ORDER BY y tablas dinámicas necesitan listas cerradas de constantes. El `DELETE FROM ${tableName}` de `sqliteFinancialDataRepository.ts` usa un inventario constante: no lo declares injection solo por interpolación.
5. Sigue `unknown` desde límites JS/nativos/JSON hasta tipos validados; rechaza referencias inexistentes, datos no finitos, estructuras malformadas y consultas arbitrarias antes de escribir. No envíes SQL generado por IA al driver.
6. Coordina conexiones TS, Headless, recordatorios y Kotlin mediante los mecanismos existentes. Revisa cualquier `android:process` nuevo: un mutex del proceso no establece exclusión interproceso. Delega cambios transaccionales/migraciones a `smartfin-sqlite-architecture`.
7. Respeta la [preferencia explícita de respaldos en Drive sin cifrado propio](backups-and-recovery.md): no propongas cifrado, contraseñas o gestión de claves como requisitos de sus copias/exportaciones. Si un encargo específico pide evaluar cifrado de la base operativa, delimita amenazas, compatibilidad API/driver, instalaciones existentes, recuperación, auxiliares y rendimiento; esa evaluación no cambia la preferencia de respaldos ni autoriza instalar dependencias.
8. Para borrado, sigue el [protocolo de recuperación](backups-and-recovery.md). `DELETE` confirmado no acredita eliminación forense de páginas, WAL, flash, copias del SO o proveedor. No ejecutes `VACUUM`, `secure_delete` ni destrucción de claves como solución universal sin analizar retención/recuperación.

## Aceptación sintética

Prueba entradas con apóstrofes, Unicode, `%`/`_` y texto parecido a instrucciones SQL como datos literales, sin comandos destructivos reales. Comprueba filas ajenas, relaciones e importes; las pruebas deben alcanzar el repositorio real aislado para afirmar protección de esa consulta. Verifica apertura fallida/cuarentena, fallos intermedios y conservación del resultado confirmado. Node no acredita permisos del sistema de archivos ni cifrado/driver Android.

Pruebas existentes a seleccionar: `__tests__/sqliteRecoveryLifecycle.test.ts`, `__tests__/localSnapshotCoordination.test.ts`, `__tests__/financialDeletionPhase5C.test.ts`, `__tests__/sqliteAndroidRecoveryPatch.test.ts`. Son evidencia por escenario, no un pentest completo.
