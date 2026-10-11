# Atomicidad financiera: fase 1

Actualización: la [fase 1.1 correctiva](atomicidad-financiera-fase11.md) resuelve los bloqueos nativos y vuelve a validar los 14 casos en API 24 y API 35. Este documento conserva los resultados de la implementación inicial. La fase 2 requiere autorización explícita y no se implementó.

Fecha: 11 de octubre de 2026. Informe de implementación inicial, con evidencia Node y Android 15/API 35. La [validación posterior API 24 y comparación ampliada API 35](validacion-atomicidad-fase1-api24.md) ya se ejecutó: 11 de 14 casos pasan en cada entorno y tres fallan al reabrir una base con transacción nativa abandonada. Fase 2 sigue sin autorizar y no se implementó.

## Línea base y fuentes

Antes de editar producción se ejecutaron Jest completo, TypeScript y ESLint: 235 pruebas y 8 snapshots aprobados, 3 benchmarks omitidos; ambos controles estáticos con código 0. [Línea base](atomicidad-fase1/baseline.json). Los siete archivos de producción modificados estaban limpios al inicio: sus versiones anteriores se conservan en `atomicidad-fase1/baseline-sources/`. Los cambios previos en movimientos, acciones rápidas y su UI se conservaron.

Se aplicó `.agents/skills/smartfin-financial-domain/SKILL.md` y se revisaron `AGENTS.md`, `ARQUITECTURA.md`, `BASE_DE_DATOS.md`, diseño de atomicidad, informe/infraestructura de fase 0 y consumidores de SQLite. No se cambiaron reglas de dinero, estado/fecha, deuda, patrimonio, impuestos, pagos, cuotas ni suscripciones. Esquema, migraciones, dependencias y módulos Kotlin de producción permanecen intactos. No se abrió una base financiera real ni se añadieron llamadas de red, telemetría o sincronización.

## Arquitectura implementada

`databaseCoordination.ts` conserva una cola por runtime JavaScript. Cada adquisición crea un permiso con identidad, registrado en un WeakSet privado y revocado al terminar. Una llamada interna recibe explícitamente ese permiso y lo reutiliza; no se usa contexto ambiente ni AsyncLocalStorage.

`managedSQLite.ts` guarda la conexión nativa en metadatos privados y entrega un handle sin acceso al driver. Los métodos de promesa `executeSql`, `transaction`, `readTransaction` y `close` adquieren la misma cola. Se validan estado y vigencia antes de entrar y después de esperar. Una lectura ajena espera igual que una escritura. El SQL de control externo, incluso precedido por comentarios, se rechaza: BEGIN/COMMIT/ROLLBACK pertenecen al runner. Métodos no utilizados por el proyecto, como attach/detach/sqlBatch, se rechazan expresamente en el handle administrado, evitando devolver métodos nativos sin protección.

Cada conexión tiene una generación y estado `open`, `quarantined` o `closed`. Los ámbitos participantes comparten la conexión y permiso del dueño, con un token activo adicional. Al revocarse, no pueden ejecutar SQL, convertirse nuevamente en participantes ni abrir una transacción. Un handle prestado tampoco sobrevive a su permiso. Los callbacks de transacciones locales reciben un handle limitado y revocable; ni el resultado ni el callback de éxito exponen la transacción nativa.

`runSharedSQLiteTransaction` adquiere/reutiliza el permiso, crea un participante, ejecuta un BEGIN IMMEDIATE, espera el cuerpo y termina con COMMIT o ROLLBACK. Los repositorios construidos con ese participante usan los mismos generadores síncronos de `runSQLiteTransaction`, ejecutando sus SQL sin BEGIN adicional. Un runner anidado se rechaza. Las transacciones locales conservan el mecanismo de callbacks y aborto SQL existente.

`sqliteWithinExistingTransaction` ahora exige un participante vivo: dejó de poder marcar arbitrariamente una conexión como transaccional. Su único consumidor anterior era IA, que pasó al runner. No se construye un ámbito exterior alrededor de guardar, editar, borrar, transferir o pagar manualmente.

## Inventario de acceso y ciclo de vida

| Consumidor | Acceso / cambio de coordinación |
|---|---|
| Navegación y repositorios de pantallas | `openSmartFinDatabase` entrega el handle administrado. Cuentas, movimientos, tarjetas, categorías, ajustes y borradores usan sus contratos existentes sobre ese handle |
| Dashboard e historial paginado | Cada SQL/revisión pasa por la cola; se mantienen cachés, checks de revisión, orden de acumulación, filtros, páginas y cancelación. Sus consultas y hooks no se modificaron |
| Manual, acciones rápidas y reconciliaciones | Transacciones locales/SQL separados administrados; no se agregó un COMMIT global al caso de uso |
| IA | El límite BEGIN/COMMIT que ya existía usa ahora el runner. Los repositorios comparten participante; la sincronización posterior de recordatorios usa permiso prestado, conservando su comportamiento |
| API pública de Suscripciones y Headless JS | `subscriptionRuntime` presta el permiso para abrir, construir repositorios y ejecutar cada operación pública/mantenimiento. Reconstruye la API tras reapertura; no utiliza repositorios de una conexión cerrada |
| Borrado financiero | Se mueve la adquisición existente al único llamador de navegación, que construye el repositorio con handle prestado. El caso de uso conserva cancelación nativa previa y borrado SQL; no cambia el contrato financiero ni el orden de efectos |
| Respaldo | La adquisición existente presta permiso a checkpoint, revisión, cierre y reapertura. El proveedor y módulos Kotlin quedan fuera del runner SQL, como antes |
| Inicialización/seed | Apertura y DDL/migraciones ocurren bajo el coordinador; inicialización usa handle prestado. Seed recibe el handle administrado. No cambia contenido ni número de migraciones |
| Cierre | Solicitudes externas esperan al dueño. La conexión se bloquea antes del cierre; si falla, no se entrega nuevamente. Handles antiguos conservan su generación cerrada |
| Kotlin directo | Recordatorios/receptor y respaldo abren conexiones propias: esta fase **no** los protege mediante la cola JS |

Se revisaron todos los usos de `openSmartFinDatabase`, `closeSmartFinDatabase`, `withDatabaseMaintenance`/`withExclusiveDatabase`, SQL de control y métodos de driver en `src/`. Las posibles readquisiciones estaban en apertura dentro de Suscripciones, cierre/reapertura dentro de respaldo y repositorio dentro de borrado. Esas rutas ahora prestan su permiso. La limpieza de navegación ya pasa el permiso a `closeSmartFinDatabase` mediante el callback del coordinador.

El permiso es explícito: una nueva ruta que invoque la cola desde su propio callback sin prestarlo todavía sería un error de composición y podría esperar por sí misma. No se infiere quién llama una función asíncrona mediante una bandera global. Las rutas existentes se adaptaron y las composiciones prestadas tienen pruebas sin sleeps.

## Resultados y recuperación

| Resultado del runner | Evidencia y conducta |
|---|---|
| `confirmed` | El driver respondió con éxito a COMMIT. Devuelve el valor del cuerpo. Efectos de recordatorios posteriores no convierten esa confirmación en rollback |
| `rolledBack` | El cuerpo falló tras BEGIN confirmado y el driver respondió con éxito a ROLLBACK. Devuelve el error original. Las pruebas exigen igualdad exacta de filas, hijos y revisión |
| `unknown` | BEGIN sin respuesta verificable, COMMIT fallido/perdido o ROLLBACK no confirmado. Conserva error original, error de rollback y de cierre cuando existen. No reejecuta el cuerpo |

Ante `unknown`, revoca el ámbito y bloquea la conexión antes de intentar cerrarla. Un cierre exitoso marca `closed`; uno fallido conserva `quarantined`. Las operaciones ya en cola vuelven a validar y fallan antes de ejecutar SQL. No se intenta rollback cuando no se confirmó la propiedad de BEGIN, ni después de una respuesta de COMMIT incierta. La reapertura ocurre solo en una solicitud posterior, bajo permiso: primero debe resolverse el cierre anterior y después se verifican FK e `integrity_check` antes de entregar otra generación. Reabrir no reclasifica la operación anterior ni acredita que no hubo cambios.

Si falla la inicialización y no se puede cerrar su conexión, se conserva una referencia bloqueada y se exige resolver ese cierre antes de abrir otra. Los errores de finalización de transacciones locales que el driver instalado etiqueta como «error while trying to commit/roll back» también bloquean el handle; los errores ordinarios conservan el comportamiento local previo. La clasificación de tres estados corresponde al runner exterior, sin cambiar retornos financieros existentes.

IA conserva el resultado público en éxito y el error original tras rollback. Para incertidumbre propaga `SQLiteCommandFailure`, cuyo mensaje indica que el resultado no está confirmado y debe verificarse antes de repetirlo. No se agregó un reintento automático. El borrador IA todavía se limpia posteriormente en su hook: su consumo durable y la recuperación exactamente una vez no pertenecen a esta fase.

## Archivos de implementación y prueba

- Nuevo `src/database/managedSQLite.ts`; ampliados `atomicSQLite.ts`, `databaseCoordination.ts` y `sqliteDatabase.ts`.
- Adaptados `src/modules/transactions/useCases/executeAiCommandPlan.ts`, `src/modules/subscriptions/services/subscriptionRuntime.ts`, `src/modules/settings/useCases/deleteFinancialData.ts` y `src/navigation/AppNavigator.tsx`. En navegación cambió coordinación, sin cambios visuales.
- Nueva suite `__tests__/sharedSQLiteCoordination.test.ts` con 22 pruebas. Los helpers de fase 0 permiten fixture administrado opcional y runner reutilizable con esa opción; `realSQLite.ts` registra/instrumenta también CLOSE. Los snapshots y expectativas existentes no se actualizaron.
- Nuevo harness aislado en `scripts/androidAtomicityPhase1/`: preparador, aplicación JS, módulo Kotlin exclusivo de reporte y runner ADB. Los módulos Kotlin de producción no se copian al harness.
- Este informe, baseline/fuentes anteriores, logs de compilación/Jest y artefactos Android en `docs/atomicidad-fase1/`.

## Validación Node/SQLite

La suite nueva verifica: BEGIN antes/después sin cuerpo ni rollback ajeno; fallo antes/después de escritura; rollback de padre/hijo/revisión; dos dueños y lectura externa con barrera; único BEGIN/COMMIT y rechazo de nesting; préstamo y expiración de permisos; respuesta perdida de COMMIT y de ROLLBACK; cierre no confirmado; lectura en cola bloqueada tras incertidumbre; callback revocable sin acceso al nativo; cierre/checkpoint/reapertura; API pública y mantenimiento de suscripciones sin gasto o saldo; cuatro caracterizaciones parciales de fase 0 a través del handle administrado.

Jest completo: **257 pruebas aprobadas**, 3 benchmarks omitidos existentes; **31 suites aprobadas**, 3 omitidas; **8 snapshots aprobados**. [Log](atomicidad-fase1/jest-final.log). Los 100 puntos de fallo de fase 0 mantienen sus snapshots originales, sin `-u`. TypeScript y ESLint pasan. Los avisos de lint encontrados durante implementación se corrigieron.

Reproducción:

```powershell
npm test -- --runInBand __tests__/sharedSQLiteCoordination.test.ts __tests__/aiSubscriptions.test.ts __tests__/subscriptions.test.ts __tests__/financialAtomicityPhase0.test.ts
npm test -- --runInBand
npx tsc --noEmit
npm run lint
```

## Validación Android separada

Aplicación release/Hermes `com.smartfin.atomicityphase1.tests`, dispositivo HONOR CRT-NX3, Android 15/API 35; driver instalado `react-native-sqlite-storage` copiado **sin instrumentar su implementación**. Cada fixture usa un nombre `atomicity_phase1_<timestamp>_<secuencia>.db` en el sandbox de ese paquete. No se llama la apertura de producción ni se accede a `smartfin.db` del paquete `com.smartfin`.

**11 casos aprobados**: callbacks y aborto local del generador; fallo antes/después de escritura compartida; error FK real con reverso completo de filas/revisión; dos dueños, lector y checkpoint con barrera; ámbito revocado; rechazo de nesting y permiso prestado; COMMIT antes/después con respuesta perdida; ROLLBACK antes/después con respuesta perdida; cierre que espera al dueño. Las pérdidas de respuesta se inyectan en el adaptador JS alrededor de sentencias que ejecuta el driver real: no representan fallo físico del almacenamiento.

[Resultados](atomicidad-fase1/android/result.json), [entorno](atomicidad-fase1/android/environment.json), [APK](atomicidad-fase1/android/apk-badging.txt), [hashes](atomicidad-fase1/android/source-fingerprints.json), [metadatos de producción intactos](atomicidad-fase1/android/production-package-unchanged.json). Se guarda Logcat del proceso aislado. La aplicación sintética queda instalada y detenida.

El primer build con el JDK de Android Studio falló en CMake; con JDK 17 instalado compiló. Se conservan logs del intento, build JDK 17 y build final. No se instalaron dependencias ni se parcheó el driver. Los warnings Gradle/dependencias heredados no se presentan como fallos financieros.

En la campaña inicial no había dispositivo ni imagen API 24 instalada: ADB mostraba solo API 35 y el único AVD usaba Android 37.2. El APK declaraba minSdk 24; esto no acreditaba ejecución API 24. Posteriormente, con autorización del usuario para instalar la imagen, se completó la [campaña API 24](validacion-atomicidad-fase1-api24.md). La recuperación tras transacción abandonada falla también en API 35; las 11 aprobaciones iniciales no verificaban reutilizar la misma base después de ese cierre.

Reproducción, en un directorio nuevo externo al repositorio y sin instalar nada en producción:

```powershell
node scripts/androidAtomicityPhase1/prepare.js C:/sfatomicity1-new
$env:JAVA_HOME='C:/Program Files/Java/jdk-17'
& C:/sfatomicity1-new/android/gradlew.bat -p C:/sfatomicity1-new/android assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
./scripts/androidAtomicityPhase1/run.ps1 -Harness C:/sfatomicity1-new -Serial AXCC6R3919012932
```

El runner verifica applicationId/release antes de instalar, elimina únicamente el reporte sintético previo, conserva resultados y comprueba metadatos de `com.smartfin` antes/después. No abre datos de producción. Para otro dispositivo usar otro directorio de salida, y ABI de build apropiada.

## Límites y decisión de fase 2

Los cuatro estados parciales originales siguen reproducibles: esta fase protege cada ámbito transaccional existente y prepara unidades futuras, sin extenderlas a manuales. Un resultado desconocido sigue necesitando revisión explícita; ni cerrar/reabrir ni conservar patrimonio acredita una confirmación financiera. No hay recibo durable universal ni reparación automática de historial.

La cola cubre un runtime JS y una conexión administrada; no conexiones Kotlin directas, otros procesos, efectos OS, archivos de respaldo o durabilidad ante caída física. Node en memoria no acredita locks entre conexiones/recuperación en disco. Los tests Android no prueban apagado, BUSY nativo concurrente, receptor de recordatorios o proveedor de respaldo. La política de conflicto de una edición obsoleta y el consumo durable del borrador quedan para el alcance aprobado posterior.

No se eliminaron optimizaciones: pasan equivalencias de dashboard/historial, paginación/refinamiento y pantalla. Sus consultas/cachés siguen intactas; esta campaña no repitió los benchmarks físicos de rendimiento. La cola añade espera necesaria durante el dueño, por lo que la latencia de lecturas bajo cargas grandes deberá medirse al extender operaciones.

**Recomendación actual: no autorizar fase 2.** La campaña API 24 se completó, pero la ampliación detectó tres bloqueos de reapertura tanto en API 24 como en API 35. Debe resolverse y volver a validarse esa recuperación en un encargo separado de fase 1; los resultados iniciales Node/API 35 no demostraban esa garantía. La coordinación con conexiones Kotlin independientes tampoco se declara comprobada. Fase 2 deberá exigir snapshot inicial íntegro tras rollback confirmado para cada unidad manual, conservando la caracterización histórica y distinguiendo incertidumbre de reversión.
