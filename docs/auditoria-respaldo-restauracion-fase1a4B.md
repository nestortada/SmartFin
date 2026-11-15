# Auditoría de respaldo y recuperación: Etapa C sobre la Fase 1a.4B

7 de noviembre de 2026. Solo datos sintéticos. Sin push, sin commit, sin cambios de producción, migraciones, triggers, interfaz ni `com.smartfin`. No se inicia 1a.5.

## Respuesta a la pregunta de la Etapa

**No.** SmartFin no puede hoy respaldar y restaurar íntegramente sus datos financieros 1a.3B–1a.4B. Las razones, por orden de gravedad:

1. **La aplicación no tiene ningún mecanismo de restauración.** Un respaldo sólo puede recuperarse de forma manual, sustituyendo el archivo privado de la base, algo que un usuario sin acceso root no puede hacer.
2. **En la compilación actual no hay ningún respaldo accesible desde la interfaz.** `BACKUP_PUBLICATION_UI_ENABLED = false` deshabilita el botón de publicación y `performDriveBackup` lanza un error antes de escribir.
3. **El estado «al día» se decide comparando un contador numérico** (`financial_data_revision`), que puede coincidir entre historias distintas.
4. **La apertura no comprueba la presencia de las tablas de la migración 5** ni existe una comprobación de versión máxima.

Lo que sí se verifica: el archivo de copia contiene **todas** las tablas 1a.3B–1a.4B (imputaciones, revisiones, primeros ciclos, reglas de facturación y `command_id`), y un historial sintético con esas tablas se recupera exactamente cuando el archivo se sustituye a mano y se reabre con el arranque de la aplicación. Esa prueba no equivale a una restauración de producto.

## 1. Estado inicial de Git

| Elemento | Resultado |
|---|---|
| Rama | `main` (no se cambió) |
| HEAD | `0f566ee` («Fase 1a4B») |
| Commit validado | `b3ef6e5` es ancestro de HEAD |
| Diferencia `b3ef6e5..0f566ee` | 3 ficheros nuevos en `.claude/agents/` (141 líneas), sin código de producto |
| Árbol de trabajo al empezar | Limpio (`git status` vacío) |
| Commits o push en esta etapa | Ninguno |
| `core.autocrlf` | `true` en `C:/Program Files/Git/etc/gitconfig`; no hay `.gitattributes` en el repositorio |

Lecturas realizadas: `AGENTS.md`, `docs/ARQUITECTURA.md`, `docs/BASE_DE_DATOS.md`, `docs/abonos-extraordinarios-fase1a4B.md`, `docs/pendientes-fase1a4B.md`, migraciones (`src/database/migrations.ts`), esquema (`src/database/sqliteSchema.ts`, `installmentHistorySchema.ts`), apertura (`src/database/sqliteDatabase.ts`) y servicios/nativos de respaldo.

## 2. Inventario de mecanismos de respaldo

| Mecanismo | Estado en el código | Contenido | Exclusiones | Restaurable en la app | Accesible hoy |
|---|---|---|---|---|---|
| **A. CSV** (`SmartFinBackupCsv.kt`) | Implementado, Kotlin | `movimientos-AAAA.csv` (un año por fichero), `cuentas.csv`, `categorias.csv`, `subcategorias.csv`, `tarjetas-credito.csv`, `compras-cuotas.csv`, `personas.csv`, `gastos-compartidos.csv`, `participaciones.csv`, `reembolsos.csv`, `abonos-compartidos.csv`, `devoluciones-anticipos.csv` | `installment_allocations` (incluido `command_id`), `installment_plan_revisions`, `installment_first_cycles`, `credit_card_billing_rules`, `financial_data_revision`, `app_settings`, `ai_command_drafts`, `subscription_*`, `shared_loss_events`, `account_balance_history`, etc. | **No** (exportación de consulta) | Solo como parte de la generación v2 en Drive |
| **B. Copia SQLite** (`SmartFinLocalSnapshot.kt`, `localDatabaseSnapshot.ts`) | Implementado en captura privada; la publicación lo consume | Archivo completo `smartfin.db` (todas las tablas, incluidas las de 1a.3B–1a.4B) | Nada del esquema | **No hay restauración** | Solo vía publicación, deshabilitada |
| **C. Generación v2 en Drive** (`SmartFinBackupPublisher.kt`, fase 5B.2) | Implementado; sin UI activa | `smartfin-<UUID>--smartfin-backup.db` + CSV + `smartfin-generation-<UUID>.json` (SHA-256 por componente, revisión, `encrypted: false`) | Lo de B y A | **No** (solo verificación) | **No**: `BACKUP_PUBLICATION_UI_ENABLED = false` |
| **D. Raíz histórica v1** (`smartfin-backup.db`, `smartfin-manifest.json`, nombres fijos) | Solo lectura (`getBackupStatus` la señala como `legacyUnverified`) | Copia SQLite y CSV de versiones anteriores | Igual que B | **No** | No se escribe desde la compilación actual |
| **E. `backup_records`** | Tabla sin uso funcional | — | — | — | — |
| **F. Sincronización Google Drive / copia del sistema** | No existe API ni OAuth. La subida la gestionan Android y el proveedor SAF | Lo que el proveedor suba | No verificable desde la app | — | — |

Preguntas respondidas:

- **¿Qué ocurre con la base activa durante la copia?** La captura cierra la conexión administrada (`closeSmartFinDatabase` bajo `withExclusiveDatabase`), copia el archivo y lo vuelve a abrir. La restauración no existe, así que la base activa nunca se sustituye.
- **¿Admite copias de versiones anteriores?** Sólo se han verificado la reconstrucción de un esquema v4 (migración 5 ausente) y la migración de su compra; ver sección 9.
- **¿Qué validaciones hay antes de restaurar?** No aplica: no hay restauración. Antes de publicar, la captura valida el archivo con `integrity_check`, `foreign_key_check`, conteos por tabla, revisión, `user_version` y `schema_version`, y reverifica el SHA-256 del archivo copiado.
- **¿Qué pasa si falla la restauración?** No hay ninguna ruta de restauración que pueda fallar. Sí hay un fallo de publicación: el trabajo queda `uncertain` o `failed` con evidencia conservada (`retainFailed`), y `prepare` no crea otro respaldo mientras exista un trabajo pendiente.

## 3. Diferencias entre CSV y respaldo SQLite

| Aspecto | CSV | Copia SQLite |
|---|---|---|
| Finalidad | Consulta y análisis en hojas de cálculo | Copia íntegra de la base |
| Tablas 1a.3B–1a.4B | Ninguna | Todas |
| Restaurable | No | Solo manualmente (no hay procedimiento de producto) |
| Verificación | Por SHA-256 del componente y del manifiesto | Igual, más `integrity_check` y FK sobre la copia |
| Formato | UTF-8 con BOM, RFC 4180 | Binario SQLite |

**Conclusión:** el CSV no debe presentarse como respaldo recuperable. Hoy la cadena de documentación lo describe como exportación (correcto), pero el manifiesto v2 lo incluye en `components` junto al archivo SQLite. Sin ampliar el CSV, esa mezcla debería aclararse en la interfaz o en el manifiesto.

## 4. Mapa del flujo real de respaldo

```
SettingsScreen → performDriveBackup  [BACKUP_PUBLICATION_UI_ENABLED=false ⇒ lanza error, sin escrituras]
                 (si estuviera activo)
 exportDriveBackup (androidDriveBackupService.ts)
  ├─ preparePublication → SmartFinBackupPublisher.prepare  (trabajo 'prepared', AtomicFile, datasetEpoch)
  ├─ captureLocalDatabaseSnapshot(jobId)  (withExclusiveDatabase)
  │    ├─ openSmartFinDatabase(permit) → PRAGMA journal_mode
  │    ├─ si WAL: PRAGMA wal_checkpoint(TRUNCATE), exige busy=0, log=0, checkpointed=0
  │    ├─ describe() en TS: foreign_keys, sqlite_master, conteos, revision, user_version, schema_version
  │    ├─ closeSmartFinDatabase(permit)
  │    ├─ native.capture(): RO open del origen → describe sin integridad → copia byte a byte + SHA-256
  │    │    → relectura RO de la copia con integridad completa → comparación de metadatos
  │    │    → recibo AtomicFile (receipt.json) con expected + snapshot
  │    └─ openSmartFinDatabase(permit) de nuevo (siempre, incluso tras fallo)
  └─ publishOriginal → SmartFinBackupPublisher.publish
       ├─ snapshot(): valida recibo, tamaño, SHA-256 y describe de la copia
       ├─ CSV desde la copia (SmartFinBackupCsv.export)
       ├─ manifiesto v2 (candidato) y writeOnce por componente (createDocument + copia + readback)
       └─ manifiesto final smartfin-generation-<UUID>.json; luego validate() completo
```

Garantías observadas en el código: sólo se publica tras relectura íntegra; cada componente nuevo lleva UUID; no se trunca ni se borra ningún fichero existente del proveedor. Límite: un fallo tras `createDocument` deja un componente parcial con el nombre final; el manifiesto se escribe al final, así que ese componente nunca se selecciona, pero bloquea reintentos del mismo UUID hasta revisión explícita.

## 5. Mapa del flujo real de restauración

**No existe.** Búsqueda realizada en `src/` y `android/app/src/main/java/com/smartfin/`: no hay ninguna función que lea una copia SQLite y la sustituya en `smartfin.db`. `SmartFinDriveBackupModule` sólo lee manifiestos y metadatos; `SmartFinBackupPublisher` sólo escribe; `SmartFinLocalSnapshot.discard` sólo borra la captura privada. La única lectura de un respaldo es la verificación de integridad de una generación publicada.

Consecuencia: el procedimiento de recuperación real es manual y no está soportado por la aplicación. No se ha simulado éxito: el Estado D de la prueba sustituye el archivo a mano y reabre con el mismo orden de arranque que `applySchema` y las migraciones, lo que documenta lo que haría falta, no lo que hace el producto.

## 6. Análisis de SQLite y WAL

| Punto | Hallazgo |
|---|---|
| Modo de journal | La aplicación no configura WAL ni `journal_mode`. El modo efectivo en Android no se verificó en dispositivo; en Node la base nueva queda en `delete`. La captura acepta `wal`, `delete`, `truncate` y `persist`, y rechaza el resto |
| WAL | Sólo si el archivo está en WAL: se hace `wal_checkpoint(TRUNCATE)` y se exige resultado completo |
| Conexiones abiertas al copiar | La conexión administrada se cierra antes de la copia. La validación nativa usa una conexión RO separada y la cierra. El permiso del coordinador impide que otra conexión de la app escriba durante la copia |
| Transacciones pendientes | `describe` rechaza una transacción activa (`owned`) y la captura exige ausencia de participantes |
| Coherencia entre `smartfin.db` y `-wal`/`-journal` | La copia sólo toma el archivo principal. No se verifica la ausencia de `-journal` ni el tamaño de `-wal` tras el cierre; se confía en que SQLite haya completado el checkpoint y eliminado el WAL al cerrar la última conexión |
| Riesgo de copiar mientras hay escrituras | **Demostrado** (prueba `evidencia: una copia…`, sección 15): con una transacción abierta y páginas comprometidas modificadas, la copia de bytes pasa `integrity_check` y contiene 988 filas no confirmadas de 1000. La protección es procedimental (coordinador y cierre), no comprobada por SQLite |
| Checkpoint / API de backup | No se usa la API de backup de SQLite; la copia es de bytes, válida únicamente con la exclusión garantizada |
| Cierre y reapertura | Reapertura obligatoria tras la captura, también en fallo; un fallo de reapertura queda en cuarentena (`openingFailure`) |
| Validación del respaldo | `integrity_check`, `foreign_key_check`, conteos, revisión y SHA-256 sobre la copia |

**Clasificación:** riesgo **medio, condicionado**. No se ha demostrado una pérdida con el driver real: depende de que ningún otro escritor abra la base durante la captura. Ver R7.

## 7. Tablas incluidas y excluidas

La copia SQLite incluye todas las tablas. Verificado en la prueba (conteos del Estado B):

| Tabla | Filas en el respaldo sintético | En CSV |
|---|---|---|
| `installment_allocations` (con `command_id`) | 4 | No |
| `installment_plan_revisions` | 11 | No |
| `installment_first_cycles` | 1 | No |
| `credit_card_billing_rules` | 1 | No |
| `installment_purchases` | 4 | Sí (`compras-cuotas.csv`) |
| `credit_card_statements` | 3 | Hay un CSV (`tarjetas-credito.csv`); su consulta no se revisó |
| `transactions` | 7 | Sí (`movimientos-AAAA.csv`) |
| `accounts` | 4 | Sí (`cuentas.csv`) |
| `financial_data_revision` | 1 | No |
| `schema_migrations` | 5 | No |
| `app_settings` | 0 en el fixture | No |
| `backup_records` | 0 | No |

Observaciones sobre datos fuera del archivo SQLite:

- **Credencial local.** El secreto no está en `app_settings`: la aplicación guarda allí sólo la bandera `localCredentialEnabled` y el secreto va al almacén nativo de seguridad. El respaldo no lleva el secreto. Esto no se verificó leyendo el módulo nativo en un dispositivo.
- **Recibos.** `receipt_attachments` guarda sólo la URI local; el archivo del recibo no forma parte del respaldo.
- **Estado de la aplicación.** No hay datos financieros fuera de SQLite con excepción de los CSV y manifiestos derivados.

Conclusión: el archivo SQLite es suficiente para recuperar el modelo financiero (si se pudiera restaurar), pero el CSV no lo es. No hay datos financieros imprescindibles fuera del archivo.

## 8. Resultado del fixture sintético y de las pruebas

Fixture: base en archivo temporal propio (`smartfin-auditoria-c-*`), reloj fijo `2026-10-11T12:00:00Z`, COP en centavos. Se construyó con los casos de uso reales de 1a.3B–1a.4B (`registerExtraordinaryInstallmentPayment`, `saveManualTransaction`, `deleteManualTransactionSafely`, repositorios SQLite) y, para lo que no tiene ruta de producción, con escrituras de prueba documentadas:

| Requisito de la etapa | Cómo se cumple |
|---|---|
| 1. Cuenta bancaria con saldo | `bank` con 1.000.000 |
| 2. Tarjeta de crédito | `card` (cierre el día 20) y `card2` (sin día de cierre) |
| 3. Compra a varias cuotas | Compra de 600.000 en 6 cuotas |
| 4. Revisión `original` | Revisión 0 al crear la compra (`projected`) |
| 5. Abono extraordinario imputado | `cmd-abono-1`, 100.000 imputados |
| 6. Excedente como abono general | `cmd-excedente-1`: pago 150.000, imputado 100.000 |
| 7. Revisión `allocation` | Automática |
| 8. Reversión D6 | Edición del importe de `cmd-abono-1` |
| 9. Revisión `allocationReversal` | Automática |
| 10. Compra `pendingVerification` | `card2` sin día de cierre |
| 11. Revisión confirmada posterior | `confirmStatement` (**escritura de prueba**: no hay ruta de producción que confirme extractos) |
| 12. `statementAdjustmentRequired` | Reversión del abono tras la confirmada |
| 13. Revisión 0 perezosa | Compra creada con la versión intermedia (sin revisión 0) y abono posterior |
| 14. Reglas de facturación | `saveBillingRules` (`closingCycle`) |
| 15. Primer ciclo | `saveFirstCycle` (origen `user`) |
| 16. Comando idempotente procesado | Repetición de `cmd-excedente-1` (0 escrituras) |
| 17. Historial y extractos | 7 movimientos y 3 extractos |
| Pago editado y eliminado con evidencia de `command_id` | `cmd-abono-1` editado; `cmd-del-1` eliminado y su imputación queda `reversed` con el comando |

Valores del Estado A (verificados contra la aritmética del dominio): saldo bancario 710.000 = 1.000.000 − 90.000 − 150.000 − 50.000 + 50.000 (devuelto al borrar `cmd-del-1`); deuda de `card` 750.000 = 1.040.000 de compras − 290.000 de pagos; patrimonio −340.000; gastos del mes 1.340.000. Contador `financial_data_revision` = 85.

## 9. Resultados de la copia y de la restauración (Estados B–D)

| Estado | Resultado |
|---|---|
| **B. Respaldo** (réplica en Node de los pasos de archivo de `SmartFinLocalSnapshot.capture`, **no** el código Kotlin) | Journal `delete`; integridad `ok`; 0 violaciones FK; copia de 638.976 bytes; SHA-256 de copia igual al origen; conteos iguales; el archivo de respaldo no cambia en el Estado C |
| **C. Modificación posterior** | Contador 85 → 109; el archivo de respaldo mantiene su SHA-256 |
| **D. Restauración** (sustitución manual del archivo y reapertura) | Estado completo idéntico al Estado A: todas las tablas, métricas, `integrity_check = ok`, `foreign_key_check` vacío |

Comprobaciones posteriores (sección 7 del enunciado), todas en verde:

1. Compras a cuotas: 4 filas idénticas.
2. Historial de revisiones: `P1` 5 revisiones (incluida la confirmada y la `statementAdjustmentRequired`), `P2` pendiente, `P3` con `lazyInitialRevision`.
3. Imputaciones activas y revertidas: 2 `active`, 2 `reversed`, sin reactivación.
4. Reglas y primer ciclo: iguales a A.
5. Saldos y deuda: iguales a A.
6. Extractos: 3.
7. `pendingVerification`: iguales a A.
8. Restricciones: un nuevo abono sobre `P1` (con `statementAdjustmentRequired`) se rechaza con **cero escrituras**.
9. Idempotencia: repetir `cmd-excedente-1` devuelve `replayed` sin escrituras.
10. Sin dinero adicional: métricas idénticas tras el intento bloqueado.
11. Sin reactivación: `cmd-abono-1` devuelve `replayed` con `allocation.status = reversed` y sin escrituras.
12. Transacción nueva válida: `post-restore-1` se registra una vez y su repetición no escribe.
13. No hay fusión con el Estado C: no sobrevive ninguna fila creada tras el respaldo (`stmt-post-C`, imputación `post-C`, compra de la prueba C).

Huérfanos por valor: `installment_allocations.payment_transaction_id` no tiene FK. El único huérfano es la imputación `reversed` de `cmd-del-1`, cuyo pago se borró; es el comportamiento esperado (evidencia histórica). Ninguna revisión queda sin compra.

## 10. Verificación de imputaciones y revisiones

- Ninguna imputación activa se revierte ni se reactiva al restaurar.
- La revisión posterior confirmada se conserva intacta; la correctiva (`allocationReversal`) queda `pendingVerification` con `statementAdjustmentRequired` y capital 40.000.000 centavos, parte de la confirmada tal y como se diseñó.
- La revisión 0 perezosa conserva su procedencia (`lazyInitialRevision`).
- El historial de revisiones es de sólo inserción: los triggers de `UPDATE` y `DELETE` sobre `installment_plan_revisions` siguen activos tras la restauración.

## 11. Comparación de estados antes y después

| Magnitud | A (antes) | D (restaurado) | C (posterior, descartado) |
|---|---|---|---|
| Contador `financial_data_revision` | 85 | 85 | 109 |
| Filas `installment_allocations` | 4 | 4 | 5 (imputación `post-C`) |
| Filas `credit_card_statements` | 3 | 3 | 4 (`stmt-post-C`) |
| Saldo banco | 710.000 | 710.000 | no medido por separado (el estado completo difiere) |
| Deuda `card` | 750.000 | 750.000 | no medida por separado (el estado completo difiere) |

La igualdad se comprobó sobre el volcado completo de tablas (`financialState`), no sólo sobre agregados.

## 12. Verificación de idempotencia

Ver sección 9, puntos 9–12. La comprobación incluye el reinicio de la base (reapertura del archivo). No se encontró ninguna repetición que escriba dinero.

Límite ya documentado en 1a.4B: tras editar o borrar el pago no queda su importe original en ninguna columna. Esta etapa no lo cambia (no se implementa huella de `command_id`).

## 13. Comportamiento ante fallos (sintético)

| Escenario | Resultado observado | Detección |
|---|---|---|
| Archivo truncado a la mitad | Falla la apertura o la integridad, y el SHA-256 del manifiesto no coincide | **Sí**, por manifiesto (la validación por SHA-256 es la única que captura siempre la copia incompleta) |
| Byte alterado dentro de una página | SQLite puede abrirlo; el SHA-256 no coincide | **Sí**, sólo por manifiesto |
| Fichero que no es SQLite | Apertura fallida explícita | Sí |
| Ruta inexistente | SQLite crea una base vacía sin señal de instalación previa | **No** (R6) |
| Escritura cortada sobre la base activa | Base ilegible; no existe copia previa del activo | **No hay recuperación** (R1) |
| Copia con transacción abierta | Pasa `integrity_check`; contiene filas no confirmadas | **No** por SQLite; sólo la exclusión procedimental (R7) |
| Error al escribir o leer el respaldo (publicación) | Trabajo `uncertain` o `failed`, evidencia conservada, sin borrar ficheros del proveedor | Sí (estados del trabajo) |
| Restauración interrumpida | No aplica: no existe restauración | — |

Prioridad de la etapa cumplida: la app nunca sustituye la base activa, así que un fallo de respaldo no destruye la base válida. Lo contrario tampoco está garantizado: no hay procedimiento que restaure.

## 14. Compatibilidad de migraciones

| Pregunta | Resultado |
|---|---|
| `PRAGMA user_version` | La aplicación **nunca lo escribe**; queda en 0 en todas las bases (verificado). La documentación lo menciona como opción, no como mecanismo |
| Versionado real | Tabla `schema_migrations` con versiones 1–5, aplicadas en una transacción por versión |
| Orden de apertura | `applySchema` ejecuta DDL idempotente omitiendo las sentencias de 1a.3B, 3, 4 y 5 (las crea su migración), luego las migraciones que falten, luego las comprobaciones de integridad y revisión |
| Restaurar una base antigua (v4 reconstruido) | **Verificado**: la migración 5 se aplica, crea la revisión 0 `original` `pendingVerification`/`firstCycleUnconfirmed`, conserva todas las transacciones y `integrity_check = ok` |
| Restaurar una base más nueva (migración 6 desconocida) | **Verificado**: se abre sin error ni rechazo; la versión 6 queda en la tabla. No hay validación de versión máxima |
| Tabla de la migración 5 ausente | **Verificado**: se abre sin error; `schema_migrations` dice 5; consultar la tabla falla con `no such table`. La apertura no detecta ni repara (R4) |
| Migración 5 | No modificada. No se ha creado migración 6 |

Versiones: **verificadas** esquema actual (v5) y reconstrucción de v4. **No verificadas**: v0 (anterior a `schema_migrations`), v1, v2 y v3 por separado, y cualquier base real de dispositivo. Una app antigua abriendo una base v6 no se ha probado: la lógica de migraciones no tiene ninguna comprobación de versión, por lo que cabe esperar el mismo comportamiento permisivo, pero no está demostrado.

## 15. Pruebas automatizadas añadidas

Fichero: `__tests__/backupRestoreAuditPhaseC.test.ts`, 27 pruebas, sin datos personales, con SQLite real (`node:sqlite`) y los casos de uso reales de 1a.3B–1a.4B. Grupos:

- Estados A–D (15 pruebas, incluido el volcado opcional de evidencia): estado C distinto del respaldo, integridad del archivo, restauración completa, integridad SQLite y FK, tablas críticas, contador, huérfanos por valor, restricciones, sin dinero adicional, idempotencia, sin reactivación, transacción nueva, no fusión con C, límite del contador.
- Fallos (7 pruebas): truncado, corrupto, no-SQLite, ruta inexistente, escritura cortada sobre la base activa, copia sin escritor, copia con escritor abierto.
- Compatibilidad (5 pruebas): `user_version`, base v4 migrada, base v6, tabla ausente, copia de dos historias con el mismo contador.

Límites de las pruebas:

- **Estado B es una réplica en Node** de los pasos de archivo del Kotlin. No ejecuta `SmartFinLocalSnapshot`, ni SAF, ni el driver de Android.
- **Estado D es una sustitución manual** del archivo y una reapertura con el orden de arranque de la app. No existe restauración de producto.
- **Confirmación de extractos** y **escrituras de prueba** para la revisión confirmada están marcadas como tales; no hay ruta de producción que confirme extractos.
- **No hay prueba instrumental Android.** Se deja para una autorización posterior (sección 20).

Resultados de las pruebas añadidas: **27/27 aprobadas**. Volcado de evidencia (sin datos personales): `docs/auditoria-respaldo-fase1a4B/evidencia-sintetica.json`.

## 16. Resultados de calidad

| Verificación | Resultado |
|---|---|
| `__tests__/backupRestoreAuditPhaseC.test.ts` | 27/27 |
| Regresiones (14 suites, incluida la suite nueva): 1a.4B, equivalencias 1a.4A y 1a.4B, historial 1a.3B, recuperabilidad 5E.5, CSV 5E.4/5E.6, publicación, controles de respaldo, Drive, borrado 5C/5E.4, coordinación de snapshot | 237 aprobadas, 1 omitida (omisión preexistente condicionada por variable de entorno) |
| `npx tsc --noEmit` | Sin errores |
| ESLint en el fichero nuevo | 0 errores, 0 advertencias |
| `git diff --check` | Sin errores de espacios; sólo el aviso informativo de CRLF/LF |
| `npm test -- --runInBand` completo | **No ejecutado** en esta etapa (no se repitió Jest completo) |
| `npm run lint` completo | **No ejecutado** en esta etapa |

## 17. Riesgo de finales de línea

Hechos verificados:

- `core.autocrlf=true` en la configuración global de Git y **ausencia de `.gitattributes`**.
- Índice: todos los blobs en LF. En el árbol de trabajo, 4.127 ficheros coinciden con LF, **9.393 ficheros** están en CRLF (`i/lf w/crlf`) y 1.461 están mezclados.
- Ejemplo: `.agents/skills/agent-device/SKILL.md`: hash del árbol de trabajo `ca8b4170…`, hash del blob en el índice `e5bd465a…`. Un fichero de `src/database/sqliteSchema.ts` con LF coincide con su blob (`c749c167…`).

Qué usa hashes de bytes:

| Tipo | Ejemplo | Riesgo |
|---|---|---|
| **Contenido del repositorio Git** (blob) | Hashes internos de Git | Estable: no depende del checkout |
| **Árbol de trabajo** | `scripts/phase1a4b/apk-identity.cjs` (hashea `path.join(root, file)`); `scripts/phase1a4b/authorization-inventory.cjs` (`inputs.sha256.json`); `scripts/phase1a4b/run-android.ps1` (compara `source.Value` con `Get-FileHash`) | **Alto**: en otro checkout con `autocrlf=true` los ficheros CRLF tienen otro hash y la verificación falla o, peor, se recalibra con bytes distintos |
| **Artefactos generados** | APK, `source-fingerprints.json` de `docs/aceptacion-fase5b2/…`, `apk-identity.json` | Dependen del estado del árbol y de la plataforma; hay que fijarlos al contenido de LF |

Política mínima propuesta (no aplicada):

```gitattributes
* text=auto eol=lf
*.db binary
*.sqlite binary
*.apk binary
*.aab binary
*.jar binary
*.png binary
*.jpg binary
*.ttf binary
*.otf binary
*.keystore binary
```

Notas de aplicación, que requieren autorización:

1. Un cambio de `.gitattributes` con renormalización rehace el árbol de trabajo (≈ 9.400 ficheros) y debe ir en un commit propio, sin mezclarlo con código.
2. Los inventarios existentes (`inputs.sha256.json`, `source-fingerprints.json`) se calcularon sobre bytes del árbol; tras normalizar a LF habrá que volver a calcularlos y registrar la transición, sin recalibrar los hashes validados anteriores.
3. `git diff --check` ya avisa de la mezcla; la política la resuelve.

## 18. Defectos encontrados, clasificados por severidad

| ID | Severidad | Archivo y función | Comportamiento demostrado | Riesgo financiero | Corrección mínima propuesta | Prueba que lo demostraría | Requiere |
|---|---|---|---|---|---|---|---|
| **R1** | **Crítico** | No existe. Lectura: `SmartFinBackupPublisher.kt` (solo escribe), `SmartFinDriveBackupModule.kt` (solo lee manifiestos), `localDatabaseSnapshot.ts` (`discardLocalDatabaseSnapshot`) | No hay restauración. El Estado D sólo funciona sustituyendo el archivo a mano | Sin restauración no hay recuperación de datos financieros; un usuario no puede volver al respaldo | Caso de uso de restauración: validar manifiesto y SHA-256 componente a componente; abrir la copia en staging RO; comprobar esquema, versión, integridad, FK y revisión; copiar el activo a un respaldo de seguridad; sustituir con `rename` atómico; reabrir y verificar; revertir si falla | Estados A–D en Node (ya existen como sustitución manual) y **prueba instrumental Android** de sustitución y reapertura | Producción, interfaz y nativo. Requiere decisión de producto y autorización |
| **R2** | **Crítico (estado actual)** | `src/modules/settings/services/backupPublicationPolicy.ts` (`BACKUP_PUBLICATION_UI_ENABLED = false`); `src/navigation/AppNavigator.tsx` (`performDriveBackup`); `DriveBackupSection.tsx` | No hay publicación accesible en la compilación actual. El botón está deshabilitado y `performDriveBackup` lanza antes de escribir | El usuario no obtiene ninguna copia nueva; la documentación §6 describe el flujo anterior como si estuviera disponible | No cambiar la bandera sin el contrato de lectores externos; comunicar el estado real en la pantalla | Prueba de interfaz: botón deshabilitado y mensaje visible | Decisión de producto antes de activar |
| **R3** | **Alto** | `SmartFinBackupPublisher.discover` / `datasetCurrency`; `SmartFinDriveBackupModule.getBackupStatus` (`outdated = currency != "current" || revision != currentRevision`) | **Demostrado**: dos copias de una misma base que reciben operaciones distintas con el mismo número de escrituras llegan al mismo contador; la comparación de revisión no las distingue | Un respaldo de otra historia aparece como «al día» y el usuario deja de publicar | Identidad de historia (UUID en `app_settings`, incluido en el manifiesto y regenerado tras cualquier restauración); comparar identidad además de revisión | `backupRestoreAuditPhaseC`: «el contador financiero puede coincidir…» pasaría a exigir identidades distintas | Producción (TS y Kotlin). Requiere autorización |
| **R4** | **Alto** | `src/database/sqliteDatabase.ts` `applySchema` (omite `INSTALLMENT_HISTORY_SCHEMA`); `src/database/migrations.ts` (migración 5 por versión) | **Demostrado**: tabla `installment_first_cycles` ausente con `schema_migrations` = 5 → apertura correcta, error `no such table` al consultar. Ni la apertura ni la validación de la copia comprueban tablas requeridas | Historial de imputaciones y reglas inaccesible; el respaldo parece válido | Verificar presencia de tablas y columnas requeridas por la versión antes de aceptar la apertura; sin cambiar la migración 5 | `backupRestoreAuditPhaseC`: «tabla de la migración 5 ausente…» pasaría a esperar rechazo | Producción. Requiere autorización |
| **R5** | **Alto** | `src/database/migrations.ts` y `sqliteDatabase.ts` (sin comprobación de versión máxima); `PRAGMA user_version` no escrito | **Demostrado**: base con migración 6 se abre sin rechazo | Una app antigua podría escribir sobre un esquema que no conoce | Rechazar apertura si `schema_migrations` contiene versiones superiores a las conocidas; decidir si escribir `user_version` | `backupRestoreAuditPhaseC`: «base con un esquema más nuevo…» pasaría a esperar rechazo | Producción. Decisión de compatibilidad |
| **R6** | **Medio** | `src/database/sqliteDatabase.ts` (`openSmartFinDatabase` crea la base); no hay marcador de instalación previa; el seed de arranque no se invoca (`seedSmartFinDatabase` sólo está exportada) | **Demostrado**: una ruta inexistente produce una base vacía sin señal | Pérdida silenciosa percibida como instalación nueva | Guardar un marcador de instalación en `app_settings` y en el manifiesto; avisar si falta | `backupRestoreAuditPhaseC`: «ruta inexistente…» | Producción. Requiere autorización |
| **R7** | **Medio (condicionado)** | `SmartFinLocalSnapshot.capture`; `localDatabaseSnapshot.ts` | **Demostrado** a nivel de archivo: copia con transacción abierta contiene 988 filas no confirmadas y pasa `integrity_check`. La captura depende del coordinador | Snapshot inconsistente si otro escritor (otro proceso o una conexión no coordinada) actúa durante la captura | Comprobar en nativo la ausencia de `-journal` y, si WAL, el tamaño cero de `-wal` tras cerrar; prueba instrumental de escritor concurrente | `backupRestoreAuditPhaseC`: «evidencia: una copia de archivo…» | Nativo y prueba de dispositivo |
| **R8** | **Medio** | Futura restauración (no existe) | La sustitución de la base activa no es atómica en la práctica sin procedimiento | Pérdida de la base válida si la restauración se interrumpe | Diseño de R1: copia de seguridad del activo y `rename` atómico | Prueba instrumental de interrupción | Parte de R1 |
| **R9** | **Medio** | `SmartFinBackupCsv.kt` (`EXPORTS`); manifiesto v2 (`components` incluye CSV) | **Verificado por lectura**: los CSV no incluyen las 4 tablas 1a.3B–1a.4B; el manifiesto los presenta como componentes | Un usuario podría creer que el CSV es recuperable y perder imputaciones y reglas | Aclarar en interfaz y manifiesto que el CSV es exportación no restaurable; no ampliar el CSV en esta etapa | Prueba de contenido de `EXPORTS` (grep) | Interfaz o manifiesto. Sin cambio de esquema |
| **R10** | **Medio** | Repositorio: `core.autocrlf` sin `.gitattributes`; `scripts/phase1a4b/*` | Hashes de árbol distintos de los de índice en 9.393 ficheros | Verificaciones de identidad no reproducibles en otro equipo | Política de §17 con commit propio y recálculo de inventarios | Comparación de hashes tras `git checkout` en un equipo con `autocrlf=true` | Repositorio. Requiere autorización |
| **R11** | **Bajo** | `docs/BASE_DE_DATOS.md` §3 (seed al arrancar), §6 (nombres fijos y flujo de publicación), §10; `docs/ARQUITECTURA.md` §4 | Documentación que no coincide con el código | Decisiones basadas en documentación obsoleta | Actualizar documentación | Revisión documental | Solo documentación |
| **R12** | **Info** | `app_settings` | Contiene sólo banderas (`localCredentialEnabled`, tema, biometría). El secreto está en el almacén nativo | Sin hallazgo de exposición de secretos en el archivo | Mantener | — | — |

## 19. Plan mínimo de corrección y validación Android

Orden propuesto. Cada punto requiere autorización explícita; ninguno se ejecuta aquí.

1. **Decisión de producto sobre la restauración (R1, R8).** Sin esta decisión no hay recuperación. Propuesta: restauración sólo desde generación verificada, con copia de seguridad previa del activo y reapertura verificada.
2. **Identidad de historia y marcador de instalación (R3, R6).** Cambios pequeños en `app_settings` y en el manifiesto. Pruebas: las dos pruebas marcadas en la tabla de R3 y R6, más la de interfaz.
3. **Verificación de esquema en apertura y versión máxima (R4, R5).** Cambios en `sqliteDatabase.ts`. Pruebas: las dos pruebas de compatibilidad, que pasarían a esperar rechazo. Sin migración 6 y sin modificar la 5.
4. **Restauración en Node sobre sintético (R1).** Los Estados A–D pasan de sustitución manual a un caso de uso real, con las mismas comprobaciones.
5. **Campaña Android instrumental `phase1a4c-restore-*` (preparar, no ejecutar).** Cubre: sustitución y reapertura, interrupción a mitad de copia, escritor concurrente durante la captura (R7), y apertura de una copia v4 y v6. Ejecución en API 24 y API 35 sólo tras autorización específica para compilar e instalar.
6. **Interfaz (R2, R9).** Mensaje de estado real y aclaración del CSV. Sin activar la publicación hasta cerrar el contrato de lectores externos.
7. **Política de finales de línea (R10).** Commit propio con `.gitattributes`, recálculo de inventarios y registro de la transición.
8. **Documentación (R11).** Actualizar `BASE_DE_DATOS.md` y `ARQUITECTURA.md`.

Lo que no cubre esta etapa: ejecución de la app en dispositivo, comportamiento real de SAF y de Google Drive, escritura real del proveedor, y el código Kotlin de captura y publicación (sólo se leyó).

## 20. Estado final

- Ninguna corrección aplicada. Sin commit, sin push, sin cambios de producción, migraciones, triggers, interfaz, `com.smartfin` ni instalación de APK.
- Único fichero nuevo de código: `__tests__/backupRestoreAuditPhaseC.test.ts` (27 pruebas, verdes).
- Este informe y el volcado de evidencia sintética en `docs/auditoria-respaldo-fase1a4B/`.
- No se ha iniciado 1a.5. Quedan pendientes las decisiones de R1, R2 y R10, que requieren autorización del propietario antes de cualquier cambio.
