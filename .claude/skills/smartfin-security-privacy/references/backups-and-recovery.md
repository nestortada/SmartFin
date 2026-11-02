# Respaldos, CSV, recuperación y eliminación

## Decisión arquitectónica vigente

**Preferencia explícita del propietario, registrada el 2026-11-01:** «Los respaldos financieros se mantendrán en Google Drive sin cifrado adicional implementado por SmartFin».

Conserva el diseño de capturas SQLite, CSV, generaciones y publicación mediante SAF/proveedor Drive. La decisión no exige cambiar formatos, lectores, driver, migraciones o dependencias. No propongas AES-GCM, contraseñas de cifrado ni gestión de claves como requisitos de implementación o aceptación de respaldos. No reintroduzcas esas exigencias mediante un requisito de firma/MAC. Solo reconsidera esta preferencia si el propietario la cambia explícitamente.

Mantén las verificaciones de integridad, tamaños, SHA-256 y manifiestos, así como almacenamiento privado, coordinación y permisos Android. No habilites publicación ni amplíes permisos por registrar esta decisión. La preferencia se refiere a los respaldos de Drive: no cambia el tratamiento de credenciales locales, secretos de servicios o firma de distribución de la app.

Comunica siempre: **los respaldos no tienen cifrado propio de SmartFin; cualquier persona con acceso suficiente al archivo podría leer sus datos personales y financieros**. Aceptar este diseño no elimina todos los riesgos de confidencialidad. No atribuyas al proveedor garantías de cifrado, control de lectores o sincronización que no se hayan verificado, ni presentes un hash como confidencialidad o prueba criptográfica de autoría.

## Prioridades dentro del diseño actual

1. **Acceso:** revisar quién puede leer la carpeta/archivos de Drive, permisos compartidos y concesiones URI Android; limitar acceso a lo necesario. No afirmar que el PIN de SmartFin protege una copia abierta fuera de la app. Proponer revisión/revocación por el propietario cuando corresponda, sin operar su cuenta ni cambiar permisos sin autorización.
2. **Temporales:** inventariar capturas, CSV, recibos, parciales y trabajos; definir retención y limpieza explícitas de recursos propios cuando ya no sean necesarios para recuperación. Conservar evidencia ante incertidumbre y respetar los vínculos de trabajo; no borrar WAL/SHM/journals ni copias externas automáticamente. El almacenamiento privado reduce exposición, pero no la elimina en un dispositivo comprometido.
3. **Publicación deliberada:** comprobar acción explícita de la persona, destino y alcance de datos antes de publicar; si falta un control, reportarlo como propuesta pendiente. Evitar publicación por arranque, tarea de recuperación o contenido IA sin la intención autorizada correspondiente. Mantener el gate de activación existente y no crear otra captura o destino como respuesta automática a un resultado incierto.
4. **Integridad y transparencia:** conservar generación exclusiva, manifiesto final, relectura y hashes; describir el límite de autenticidad y que los archivos son legibles para quien tenga acceso suficiente. Ni el riesgo residual ni la preferencia autorizan debilitar estos controles.

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
5. Separa checksum de autenticidad: la comparación contra trabajo privado vincula una publicación local a su evidencia durable; un manifiesto descubierto sin ese ancla no es una firma del autor. SHA-256 por sí solo no impide que cambien componentes y manifiesto juntos. Conserva las comprobaciones y registra ese riesgo residual; prioriza control de acceso, procedencia y revisión explícita, sin exigir cifrado, firma/MAC o gestión de claves ni cambiar el formato actual.
6. El manifiesto actual declara `encrypted=false` y `cloudSync=unconfirmed`, coherente con la decisión de no añadir cifrado propio. No afirmes cifrado de exportación ni sincronización garantizada porque el proveedor usa Drive o releyó bytes. La protección TLS del proveedor y permisos compartidos se deben comprobar en su contexto, sin acceder a la cuenta del usuario. Advierte que acceso suficiente al archivo permite leer sus datos.
7. Examina CSV por delimitadores, comillas, CR/LF, Unicode, tipos y fórmulas. `SmartFinBackupCsv.kt` escapa sintaxis CSV y conserva representación monetaria; no neutraliza prefijos de fórmula para una hoja de cálculo. Quoting no basta. Usa valores inventados como `=1+1` para evaluación documental; no abras fórmulas que ejecuten comandos/red.
8. Conserva el diseño de exportación y documenta el riesgo al abrir texto controlado en hojas de cálculo. No antepongas caracteres al respaldo canónico ni redondees importes incidentalmente: puede romper roundtrip, hashes y lectores. Una variante de presentación requiere un encargo específico y contrato claro; si se autoriza, verifica equivalencia con `smartfin-financial-domain` y QA.
9. Revisa permisos perdidos, proveedor sin acceso durable, archivo parcial, readback distinto y proceso interrumpido. Conserva incertidumbre; no repitas cambios financieros para resolver un error de publicación. No borres automáticamente generaciones ni evidencia de fallo.
10. Para una futura restauración, exige selección/autorización explícitas, autenticidad según amenaza, compatibilidad/esquema y límites, validación en copia aislada, gate de escritores, commit/recuperación y comprobación financiera. Definirlo no autoriza implementarlo ni abrir respaldos reales.

## Eliminación y recuperación actuales

El inventario constante de `sqliteFinancialDataRepository.ts` borra tablas financieras en transacción, conserva `app_settings` y registra intención/comprobante. Los estados `confirmed`, `rolledBack`, `unknown` y limpieza pendiente no son equivalentes. `SmartFinFinancialDeletion.kt` cancela recursos/recordatorios y elimina recursos privados identificados, sin seguir URI de proveedor ni borrar respaldos externos. Revisa épocas para evitar que trabajos viejos se presenten como datos actuales después del borrado.

Explica qué queda: preferencias de acceso y credencial nativa no forman parte del borrado de finanzas; copias publicadas pueden subsistir y SQLite puede conservar páginas reutilizables. No prometas borrado seguro de flash ni revocación retroactiva de lectores externos. Evalúa retención con [privacidad](privacy-and-compliance.md).

Pruebas relacionadas: `__tests__/backupPublication.test.ts`, `__tests__/backupRecoverabilityPhase5E5.test.ts`, `__tests__/backupCsvPhase5E6.test.ts`, `__tests__/financialDeletionRecoveryPhase5E4.test.ts`. Lee fixtures/escrituras antes de ejecutarlas; algunas recorren evidencia histórica y no son pruebas de confidencialidad.
