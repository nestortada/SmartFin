# Fase 5B.2: generaciones verificables y recuperación de publicación

## Alcance y estado de activación

Se implementa publicación SAF desde una captura privada de 5B.1, sin cambiar el
driver, dependencias, esquema, migraciones, cálculos, restauración, borrado financiero,
cifrado ni política de recordatorios. No comienza 5C.

`BACKUP_PUBLICATION_UI_ENABLED` permanece en `false`. La ruta anterior que truncaba
archivos ya no es invocada ni está expuesta por Kotlin. La interfaz informa que la
publicación está pendiente de aceptación de compatibilidad y tiempos de captura.
No se debe activar cambiando esta constante sin revisar los resultados y obtener
la decisión solicitada al final de este informe.

## Riesgos comprobados en la línea base

`SmartFinDriveBackupModule.exportBackup` abría los nombres fijos con `wt`, copiaba
el main vivo y posteriormente consultaba el origen para los CSV. Eliminaba los CSV
anuales enumerados por el manifiesto anterior. Una excepción no restauraba los
bytes truncados. El manifiesto v1 contenía revisión/lista/fecha, sin tamaños ni
hashes; su existencia y la revisión no certificaban integridad. La pantalla
afirmaba una verificación más fuerte que la implementada. Estos hallazgos coinciden
con [5A](atomicidad-financiera-fase5a.md), sección 4.

El filtro de tarjetas era `credit_card`; el dominio y el fixture persisten
`creditCard`. La regresión Android exige que el predicado anterior devuelva cero,
que el correcto encuentre la tarjeta y que las filas/celdas exportadas coincidan.
El resto del contrato CSV se conserva: UTF-8/BOM, columnas, escape, consultas y
orden. Suscripciones y comprobantes IA están en el SQLite completo; el contrato
histórico no incluía CSV específicos de suscripciones y esta fase no los añade.

## Protocolo definitivo

1. Preparar un trabajo UUID durable, ligado a la URI elegida y fecha UTC. Rechazar
   otro trabajo activo o incierto sin decisión explícita sobre el anterior.
2. Capturar con el protocolo de 5B.1: ambos permisos, checkpoint WAL completo,
   integridad/FK/esquema/conteos/revisión, cierre con recibo, copia/hash/validación,
   reapertura verificada y liberación. Conservar cuarentena y `unknown`.
3. Guardar un recibo privado recuperable de captura, con identidad del trabajo,
   metadatos esperados y SHA-256. No es un comprobante financiero ni una publicación.
4. Devolver el handle recuperado a la composición antes de llamar a SAF. Rechazar
   publicación si falla captura, recuperación o liberación. CSV, hashes y SAF quedan
   fuera del permiso financiero; no abren `smartfin.db`.
5. Revalidar el snapshot por su UUID y recibo privados, sin aceptar una ruta JS.
   Exportar todos los CSV de esa misma copia READONLY. Preparar componentes y hashes.
6. Crear únicamente nombres nuevos `smartfin-<UUID>--<nombre-histórico>` en la raíz.
   Antes de abrir un destino, comprobar que su URI no existía antes de crearlo y
   que su nombre identifica el nuevo documento. Un nombre ya existente se relee y
   verifica; nunca se reabre para escribir, ni siquiera si está incompleto.
7. Cerrar cada stream y releer todos sus bytes; comparar tamaño y SHA-256. Persistir
   avance después de cada componente. Un fallo de cierre tampoco acredita rollback.
8. Escribir al final `smartfin-generation-<UUID>.json`, igualmente exclusivo, y
   verificar sus bytes y todos los componentes otra vez. Solo entonces registrar
   `verified` en privado y devolver éxito.

El manifiesto es un **candidato**, no un commit atómico del proveedor. Su descubridor
rechaza manifiestos ausentes/incompletos, identidades/nombres repetidos, campos
inválidos, archivos ausentes y discrepancias de tamaño/hash. Solo elige candidatos
íntegros, ordenados por `generatedAt` y UUID como desempate. Cada consulta revalida;
un éxito histórico no exime de volver a leer los archivos.

Para los trabajos propios también compara el manifiesto completo con su plan
durable: cambiar solo la revisión o quitar un CSV anual tampoco permite elegirlo,
aunque los componentes restantes conserven sus hashes. Los hashes no son firmas
criptográficas; no se introduce autenticación de respaldos de otras instalaciones.

Formato v2: `generationId`, `financialRevision`, `components` (nombre, nombre lógico,
bytes, SHA-256), `csvFiles`, `state: complete`,
`validation: provider-readback-sha256`, `cloudSync: unconfirmed`.
Conserva `formatVersion`, `database`, `generatedAt`, `revision`, `files`,
`encrypted: false`. `revision` es el alias compatible de `financialRevision`,
jamás una identidad de generación ni de bytes.

## Compatibilidad y decisión externa

Los lectores comprobables en el checkout son el estado nativo y la UI de Ajustes;
la documentación histórica también describe lectura de nombres fijos en raíz.
No se encontró aquí el código/configuración del análisis semanal externo. No se
modifica ese proceso ni se presume que pueda seguir referencias.

Los documentos históricos `smartfin-manifest.json`, `smartfin-backup.db`, CSV fijos
y anuales permanecen intactos. La lectura v1 se etiqueta `legacyUnverified`; no se
presenta como copia certificada ni como actualizada. Los v2 se descubren por nombres
independientes en la misma carpeta, sin índice mutable ni necesidad de renombrado.

**El análisis semanal deberá actualizarse antes de activar esta ruta**: enumerar
`smartfin-generation-*.json`, validar v2 y todos sus componentes, seleccionar la
última generación íntegra y usar sus referencias. Si no hay v2 válido, puede
informar explícitamente que usa una copia histórica sin certificar; no inferir que
los CSV fijos son actuales. Si carece de lectura binaria/hash, debe abstenerse de
anunciar una generación verificada. No basta comparar `revision`.

Decisión presentada: aceptar la raíz histórica congelada y migrar esos lectores a
v2. Actualizar los nombres históricos en varias escrituras volvería a exponerlos a
mezclas y no se implementa como compatibilidad aparente.

## Registro y recuperación

`noBackupFilesDir/smartfin-backup-jobs/<UUID>.json` usa `AtomicFile`, formato interno 1.
Contiene únicamente identidad, URI destino, fecha, estados, referencia a snapshot,
manifiesto esperado, avance y tiempos. No contiene contraseñas ni filas financieras.
`receipt.json` en la carpeta privada de captura conserva su evidencia de validación.
No se utiliza `backup_records` ni se migra el esquema.

Estados: `prepared`, `snapshotValidated`, `publicationPending`, `verified`, `failed`
y `uncertain`. Una excepción SAF conserva `uncertain`; no se interpreta como
ausencia de escrituras. El registro sobrevive sin una promesa JS pendiente.

Inicio/consulta de estado enumera los trabajos propios pendientes. La reanudación
requiere una acción explícita, abre/verifica antes el singleton mediante su API
administrada y no captura datos nuevos. Primero verifica una generación externa
ya completa contra el plan durable; esto permite reconocer el éxito después de
perder la respuesta. En otro caso exige el snapshot/recibo originales. Puede
adoptar un recibo único ligado al trabajo si murió antes de registrar el UUID del
snapshot. No adivina la asociación por revisión ni reutiliza otro snapshot.

Los componentes ya íntegros no se escriben otra vez. Un componente ausente puede
crearse; uno parcial/corrupto o un manifiesto ilegible exige revisión explícita y
no se trunca. Sin snapshot recuperable, no reconstruye el respaldo con datos vivos.
La decisión «Conservar sin reanudar» marca fallo y retiene toda la evidencia;
permite crear posteriormente otro trabajo independiente. No borra nada.

La limpieza local de 5B.1 rechaza snapshots ligados a trabajos de publicación.
No existe eliminación automática de generaciones, archivos de terceros o evidencia
incierta. Una reversión futura debe conservar el lector v2 y los trabajos; no debe
restaurar la ruta destructiva v1.

## Archivos y contratos modificados

| Archivo | Responsabilidad de esta fase |
|---|---|
| `SmartFinDriveBackupModule.kt` | Fachada SAF existente: preparar/publicar/verificar trabajos y descubrir v2; desaparece la exportación del archivo vivo |
| `SmartFinBackupPublisher.kt` | Protocolo, registro durable, exclusión de trabajos, escritura exclusiva, relectura y descubrimiento |
| `SmartFinBackupCsv.kt` | Exportador histórico extraído, exclusivamente READONLY sobre snapshot; corrección de `creditCard` |
| `SmartFinLocalSnapshot.kt` | Recibo privado recuperable, protección de snapshots ligados a trabajos, tiempos de integridad/hash separados; conserva exclusión y verificaciones |
| `localDatabaseSnapshot.ts` | Identidad opcional del trabajo transportada en los metadatos de captura |
| `androidDriveBackupService.ts` | Estados tipados, captura/recuperación antes de SAF, rechazo de concurrencia, reanudación explícita y progreso sin callbacks tardíos |
| `backupPublicationPolicy.ts` | Bloqueo explícito de activación de UI |
| `AppNavigator.tsx` | Reasigna handle/repositorio recuperados antes de publicar; presenta progreso y decisiones de recuperación |
| `DriveBackupSection.tsx` | Explica generación, historial congelado, trabajos pendientes y límite de sincronización |
| `backupPublication.test.ts`, `driveBackupService.test.ts` | Verificación de contrato TS, errores, concurrencia, recuperación y finalización de progreso |
| `scripts/phase5b2/`, `docs/atomicidad-fase5b2/` | Harness aislado, proveedor SAF con fallos, campañas, calidad y evidencias |

Las rutas Kotlin anteriores parten de `android/app/src/main/java/com/smartfin/`;
las de servicios TS, de `src/modules/settings/services/`. La UI usa sus carpetas
existentes. Coordinador nativo, driver, esquema, migraciones, dependencias y caso de
uso de borrado mantienen sus bytes de la línea base. Los cambios anteriores sin
commit no se descartaron. El inventario con hashes se incluye en el resumen final.

## Efectos financieros y límites

| Operación | Saldo/deuda/ingreso/gasto/patrimonio | Tablas/auditoría/revisión |
|---|---|---|
| Preparar, publicar, verificar, fallar o retener trabajo | Delta cero | Sin escrituras en la base viva |
| Capturar/cerrar/reabrir | Delta cero | Copia íntegra según 5B.1; no recrea comprobantes |
| Cambio financiero posterior | Conserva su efecto habitual solo en origen | No cambia el snapshot ni los archivos de ese trabajo |
| Recuperación tras reinicio | No ejecuta comandos financieros | Verifica la evidencia existente; no deduce rollback por ausencia de recibo |

`AtomicFile` ofrece recuperación de reemplazo de metadatos, no una transacción con
SAF ni certificación de apagado eléctrico. La exclusión de trabajos es del proceso
de la aplicación. El proveedor sigue pudiendo revocar permisos, devolver errores,
mantener cachés locales o sincronizar incompletamente con sus servidores. La
relectura verifica lo servido por SAF, no su durabilidad remota. No se certifican
proveedores deshonestos que aliasen documentos de forma indetectable ni todos los
OEM, disco lleno físico o pérdida eléctrica.

## Validación y rendimiento

La línea base aprobó 605 pruebas, 52 suites ejecutadas y 3 benchmarks omitidos;
TypeScript, ESLint y `git diff --check` en cero.
[Línea base y auditoría de fuentes](atomicidad-fase5b2/baseline/quality-results.json).
La regresión final aprueba **612 pruebas / 53 suites ejecutadas / 8 snapshots**,
con los mismos tres benchmarks omitidos. TypeScript estricto, ESLint y diff-check
terminan en cero y la auditoría confirma que las fuentes no cambiaron durante la
ejecución. [Calidad final](atomicidad-fase5b2/final/quality-results.json),
[Jest completo](atomicidad-fase5b2/final/jest.log).

Los harness usan `com.smartfin.snapshot5b2.tests`, UID/base propios, release/Hermes,
copias atestadas de los componentes Kotlin reales y un `DocumentsProvider`
sintético protegido por `MANAGE_DOCUMENTS`. Nunca acceden a la carpeta real de
Drive ni a los archivos instalados de `com.smartfin`. Los fallos de IO, revocación
y pérdida de respuesta son inyecciones declaradas. El error de cierre se inyecta
inmediatamente después de cerrar el stream real, antes de verificar su destino;
no se presenta como un fallo físico del dispositivo.

Las **32 campañas finales aprueban 148 controles: 74 por API**, con las mismas
fuentes finales en ambos dispositivos. El generador normal (sin `--partial`)
produce `complete: true` y `pending: []`.
[Resumen, hashes e inventario](atomicidad-fase5b2/validation-summary.json).

| Campaña | API 24 | HONOR API 35 |
|---|---:|---:|
| Publicación, fallos por cada CSV, corrupción, permisos, concurrencia y preservación | 28 | 28 |
| Reinicio de publicación y verificación sin volver a escribir | 2 | 2 |
| Regresiones 5B.1: core, reinicio, recibos de cierre/apertura perdidos, revocación y destrucción real del host | 29 | 29 |
| Rendimiento: tres muestras por cada volumen | 9 | 9 |
| Tres cortes reales de proceso y sus recuperaciones | 6 | 6 |

Los cortes usan `Process.killProcess` con trabajo durable en `prepared` después
de capturar, o en `publicationPending` antes del manifiesto y después de su
verificación externa pero antes de guardar el éxito local. Después del último
corte posterior al manifiesto, la recuperación no escribe ningún componente. Antes del manifiesto,
escribe solo ese documento; no reescribe SQLite ni CSV ya verificados. La
recuperación del trabajo todavía preparado adopta su recibo original único.
Los tres casos cambian el origen después de capturar y comprueban que el respaldo
conserva el saldo anterior. Las matrices de publicación también conservan las
tablas/auditoría/revisión, comprobantes IA y datos de Suscripciones en SQLite.

La regresión de tarjetas observa cero filas con `credit_card` y una con
`creditCard`, compara todas las celdas exportadas de cuentas/tarjetas y comprueba
IDs históricos de los CSV anuales. Las reexportaciones deterministas desde el
SQLite publicado deben tener exactamente los mismos tamaños y hashes.

Los intentos iniciales de configuración del proveedor y la señal de finalización
del instrumento de destrucción del host se corrigieron en el harness. No se
contabilizan como aprobaciones; las campañas finales se repitieron completas.
La atestación impide instalar un APK con fuentes anteriores. No se adaptó el driver.

La pantalla del HONOR se mantuvo despierta temporalmente por USB (`0 → 15 → 0`),
se detuvieron ambos paquetes sintéticos y se cerró el emulador iniciado para esta
validación. Cada campaña compara los metadatos de `com.smartfin` antes/después;
no se accedió a su base instalada ni a Google Drive real.
[Cierre y restauración del entorno](atomicidad-fase5b2/session-closure.json).

Se conserva el protocolo de captura de 5B.1. Se separan integridad del snapshot y
hash de destino en la instrumentación; la copia incluye el digest de origen.
La integridad de una copia inmutable podría trasladarse fuera de la barrera solo
con una separación durable entre «copiada» y «validada», recuperación y nuevas
pruebas de revocación. Esta entrega no hace esa optimización ni elimina controles.
Por ello no promete una mejora de latencia o FPS. El bloqueo UX observado en 5B.1
es una condición pendiente de aceptación, no una garantía de distribución.

| Movimientos | Captura API 24 | Captura HONOR API 35 | Lector HONOR | Operación financiera HONOR | Publicación sintética HONOR, fuera de barrera |
|---|---:|---:|---:|---:|---:|
| 1.000 | 375,81–555,24 ms | 299,75–313,08 ms | 304,51–319,52 ms | 310,10–324,92 ms | 168,17–181,48 ms |
| 10.000 | 653,75–728,45 ms | 881,71–1.489,88 ms | 891,34–1.507,08 ms | 901,77–1.523,59 ms | 547,34–564,62 ms |
| 100.000 | 2.557,90–2.973,77 ms | 4.276,91–4.502,50 ms | 4.287,74–4.514,62 ms | 4.299,18–4.525,56 ms | 10.218,92–10.372,15 ms |

[Desglose por etapa y límites de comparación](atomicidad-fase5b2/performance.md),
[muestras completas](atomicidad-fase5b2/performance-samples.json).
Con 100.000 movimientos en HONOR, las medianas de fuente JS, fuente Kotlin,
integridad de snapshot y reapertura son 976,27 / 889,21 / 831,47 / 1.523,18 ms;
hash de destino, 30,29 ms. Desplazar únicamente ese hash no resolvería la espera.
La exportación CSV posterior cuesta 8.929,27 ms de mediana y no retiene el permiso
financiero. No se atribuye el cambio respecto a 16,82 s históricos a una mejora de
código: no se reprodujeron las mismas condiciones térmicas/energéticas/cachés.

## Decisión sobre 5C

La implementación y su evidencia técnica quedan completas para revisión dentro
del alcance probado. **No recomiendo activar para distribución ni avanzar aún a
5C** sin aceptar esta entrega, la transición de lectores semanales y el presupuesto
de bloqueo de captura. Persisten hasta 4,53 s de espera de operación financiera en
esta muestra HONOR; no hay presupuesto UX aprobado ni certificación remota SAF.
`BACKUP_PUBLICATION_UI_ENABLED` sigue en `false`. No se inicia ninguna fase posterior.

La publicación ya iniciada conserva su snapshot aunque la base viva cambie. El
futuro 5C deberá definir el tratamiento de estos trabajos y su evidencia ante un
borrado; esta fase conserva exactamente el caso de uso de borrado existente.
