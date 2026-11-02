# Respaldos, CSV, recuperación y eliminación

## Distinguir capacidades

| Etapa | Implementación observada | Lo que no acredita |
|---|---|---|
| Captura local | `src/modules/settings/services/localDatabaseSnapshot.ts` y `SmartFinLocalSnapshot.kt`: cierre/checkpoint coordinado, snapshot privado validado y reapertura | Publicación externa o restauración |
| Publicación | `androidDriveBackupService.ts`, `SmartFinDriveBackupModule.kt`, `SmartFinBackupPublisher.kt`: árbol SAF, generaciones UUID, SQLite+CSV y manifiesto final v2 | Entrega definitiva a nube, cifrado o firma |
| Verificación/recuperación de trabajo | relectura de tamaño/SHA-256, estado durable, descubrimiento/reintento del trabajo | Autenticidad de un archivo controlado junto con su manifiesto por un atacante |
| Restauración financiera | No se encontró importador operativo que reemplace/reintegre la base desde respaldo en las rutas auditadas | No presentar generador, lector externo o recuperación como restaurador |
| Borrado financiero | `deleteFinancialData.ts`, `sqliteFinancialDataRepository.ts`, `financialDeletionLifecycle.ts`, `SmartFinFinancialDeletion.kt`: commit durable y limpieza recuperable | Borrado forense o eliminación de copias externas |

Los nombres Kotlin anteriores están bajo `android/app/src/main/java/com/smartfin/`; los servicios TS bajo `src/modules/settings/services/` y los casos/repositorios bajo su carpeta de módulo. `backupPublicationPolicy.ts` mantiene `BACKUP_PUBLICATION_UI_ENABLED=false`: implementación accesible al harness no equivale a función habilitada en UI. No habilites el flag al auditar.

## Procedimiento de revisión

1. Traza origen y clasificación de cada componente: base completa incluye preferencias, conversaciones/borradores IA y contactos, además del libro; CSV y manifiesto exponen entidades, fechas, revisión, tamaño e identidad de generación. Revisa selección, finalidad y minimización por consumidor.
2. Comprueba almacenamiento privado de captura/trabajos, modos reales cuando haya entorno autorizado, URI y permisos del proveedor. Inventaría recibos, parciales, errores y snapshots retenidos para recuperación. Retención para reintento no justifica conservar indefinidamente datos.
3. Sigue exclusión de escritores, checkpoint WAL completo, cierre con recibo, copia, validación y reapertura. No recomiendes borrar WAL/SHM/journal ni copiar el principal de una base activa. Para garantías SQLite usa la skill de arquitectura.
4. Verifica nombres/UUID seguros, rutas de componentes, duplicados, límites de tamaño/conteo, versión de manifiesto, estado completo, tamaños y hashes. El publicador usa nombres exclusivos y escribe manifiesto final: no presentes parciales como respaldo válido. Un lector externo requiere su propio análisis de entradas y límites.
5. Separa checksum de autenticidad: la comparación contra trabajo privado vincula una publicación local a su evidencia durable; un manifiesto descubierto sin ese ancla no es una firma del autor. SHA-256 por sí solo no impide que cambien componentes y manifiesto juntos. Para cifrado/firma propone formato, compatibilidad de lectores y custodia/recuperación de claves antes de implementar.
6. El manifiesto actual declara `encrypted=false` y `cloudSync=unconfirmed`. No afirmes cifrado de exportación ni sincronización garantizada porque el proveedor usa Drive o releyó bytes. La protección TLS del proveedor y permisos compartidos se deben comprobar en su contexto, sin acceder a la cuenta del usuario.
7. Examina CSV por delimitadores, comillas, CR/LF, Unicode, tipos y fórmulas. `SmartFinBackupCsv.kt` escapa sintaxis CSV y conserva representación monetaria; no neutraliza prefijos de fórmula para una hoja de cálculo. Quoting no basta. Usa valores inventados como `=1+1` para evaluación documental; no abras fórmulas que ejecuten comandos/red.
8. Propón cualquier salida segura para hojas de cálculo como variante de presentación con contrato claro. No antepongas caracteres al respaldo canónico ni redondees importes incidentalmente: puede romper roundtrip, hashes y lectores. Verifica equivalencia con `smartfin-financial-domain` y QA.
9. Revisa permisos perdidos, proveedor sin acceso durable, archivo parcial, readback distinto y proceso interrumpido. Conserva incertidumbre; no repitas cambios financieros para resolver un error de publicación. No borres automáticamente generaciones ni evidencia de fallo.
10. Para una futura restauración, exige selección/autorización explícitas, autenticidad según amenaza, compatibilidad/esquema y límites, validación en copia aislada, gate de escritores, commit/recuperación y comprobación financiera. Definirlo no autoriza implementarlo ni abrir respaldos reales.

## Eliminación y recuperación actuales

El inventario constante de `sqliteFinancialDataRepository.ts` borra tablas financieras en transacción, conserva `app_settings` y registra intención/comprobante. Los estados `confirmed`, `rolledBack`, `unknown` y limpieza pendiente no son equivalentes. `SmartFinFinancialDeletion.kt` cancela recursos/recordatorios y elimina recursos privados identificados, sin seguir URI de proveedor ni borrar respaldos externos. Revisa épocas para evitar que trabajos viejos se presenten como datos actuales después del borrado.

Explica qué queda: preferencias de acceso y credencial nativa no forman parte del borrado de finanzas; copias publicadas pueden subsistir y SQLite puede conservar páginas reutilizables. No prometas borrado seguro de flash ni revocación retroactiva de lectores externos. Evalúa retención con [privacidad](privacy-and-compliance.md).

Pruebas relacionadas: `__tests__/backupPublication.test.ts`, `__tests__/backupRecoverabilityPhase5E5.test.ts`, `__tests__/backupCsvPhase5E6.test.ts`, `__tests__/financialDeletionRecoveryPhase5E4.test.ts`. Lee fixtures/escrituras antes de ejecutarlas; algunas recorren evidencia histórica y no son pruebas de confidencialidad.
