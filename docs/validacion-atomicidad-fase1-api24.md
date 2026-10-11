# Validación de fase 1 en Android API 24

Informe histórico anterior a la corrección. Véase la [fase 1.1](atomicidad-financiera-fase11.md) para los resultados posteriores: los 14 casos originales y los tres controles adicionales de recuperación fallida pasan en API 24 y API 35. La fase 2 sigue pendiente de autorización explícita.

**Resultado: no autorizar todavía la fase 2.** La campaña se ejecutó con datos sintéticos en Android API 24 y se repitió con los mismos criterios en API 35. En cada entorno pasan 11 de 14 casos; tres fallan al utilizar una conexión reabierta después de abandonar una transacción nativa. No se modificó producción para corregirlos.

## Alcance y seguridad

Se revisaron `AGENTS.md`, la skill `smartfin-financial-domain`, el diseño aprobado y el informe de fase 1. Se reutilizó `scripts/androidAtomicityPhase1/`, ampliando exclusivamente su instrumentación y pruebas. No se avanzó a fase 2 ni se alteraron contratos, reglas, esquema, migraciones, dependencias, minSdkVersion o módulos Kotlin de producción. Las optimizaciones y modificaciones anteriores se conservaron.

El usuario autorizó expresamente instalar las herramientas SDK y la imagen después de recibir identificación, tamaño y requisitos. Se instalaron fuera del proyecto. La aplicación release/Hermes sigue siendo `com.smartfin.atomicityphase1.tests`; el preparador excluye los módulos Kotlin de producción. Cada base tiene nombre `atomicity_phase1_<timestamp>_<secuencia>.db` en el sandbox sintético. No se invoca `openSmartFinDatabase` ni se abre `smartfin.db`. En API 24 no está instalado `com.smartfin`; en API 35 se verificaron sus metadatos de instalación antes/después, sin acceder a su base.

Al finalizar se detuvo el emulador creado para esta campaña y las aplicaciones sintéticas. El AVD y la imagen instalada se conservan para reutilización. Los hashes de coordinación de producción y del driver coinciden con los de la evidencia API 35 anterior; solo cambió el harness y su documentación.

## Entorno comprobado

| Propiedad | API 24 | API 35 |
|---|---|---|
| Equipo | AVD `SmartFin_Atomicity_API24`, perfil Nexus 5X | HONOR CRT-NX3 físico |
| Sistema | Android 7.0/API 24 | Android 15/API 35 |
| ABI | x86_64 | arm64-v8a |
| SQLite observado | 3.9.2 | 3.44.5 |
| journal_mode observado | persist | truncate |
| foreign_keys | 1 | 1 |
| Runtime | Release/Hermes | Release/Hermes |
| Driver | react-native-sqlite-storage instalado, copia sin modificaciones | La misma copia y APK |

Imagen oficial `system-images;android-24;google_apis;x86_64`, revisión 27. Al iniciar solo existían el AVD Pixel_10_Pro_XL y su imagen Android 37.2; no había herramientas `cmdline-tools`. Se instalaron Command-line Tools 23 y la imagen API 24. Host Windows, WHPX operativo, Emulator 37.1.11.0, Java 17.0.12, AVD con 2 GiB RAM. Se ejecutó sin ventana, audio ni snapshots, en `emulator-5556`. El APK declara minSdk 24 y contiene ambas ABI; se compiló sin cambiar el proyecto Android de producción.

El [catálogo oficial de imágenes](https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml) identificó `x86_64-24_r27.zip`, descarga 1.119.800.108 bytes y contenido expandido de aproximadamente 3,1 GB. El [catálogo de herramientas](https://dl.google.com/android/repository/repository2-3.xml) identificó `commandlinetools-win-16111833_latest.zip`, 154.957.218 bytes. Se verificó su SHA-1 `57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d` antes de extraerlo. Había aproximadamente 136 GiB libres y la aceleración WHPX pasó el chequeo.

## Infraestructura ampliada

- `Harness.jsx`: snapshots de todas las tablas instaladas, ordenadas por todas sus columnas; rollback de cuentas, deuda, movimiento padre, hijo y revisión; FK e integrity_check reales; BEGIN antes/después; expiración de permisos prestados; reapertura normal y después de incertidumbre; inspección del saldo persistido cuando la reapertura responde.
- Instrumentación de cierre con `CLOSE REQUEST` y `CLOSE RESPONSE`, etapa precisa de reapertura y estado del handle. La traza SQL registra **intentos**, incluso las sentencias cuyo fallo se inyecta antes de ejecutar. El punto `before/after` determina si se alcanzó el driver; la presencia del texto COMMIT/ROLLBACK en la traza no acredita su ejecución.
- Watchdog de 30 segundos por caso. No completa promesas del driver ni simula un rollback; registra fallo y detiene esa campaña.
- `run.ps1`: selector de campaña con intent ACTION_VIEW y comprobación de que el reporte corresponde a la campaña solicitada. Los tres casos problemáticos se ejecutan en procesos separados; después del reporte se fuerza la detención únicamente del paquete sintético. El aislamiento permite ejecutar los restantes escenarios sin conservar su conexión nativa bloqueada.

La campaña `core` incluye 11 casos. `begin-after`, `commit-before` y `rollback-before` contienen un caso cada una. Se utilizó el mismo APK y harness en ambos entornos. Los casos principales y BEGIN-after se repitieron para comprobar reproducibilidad; los reportes de repetición se conservan por separado.

## Resultados de los 14 casos

| Caso | API 24 | API 35 | Evidencia exigida |
|---|---|---|---|
| Callbacks reales y aborto local del generador | Pasa | Pasa | Callback avanza una vez; error de dominio conserva snapshot completo |
| Fallo antes de UPDATE compartido | Pasa | Pasa | rolledBack y estado idéntico |
| Fallo después de UPDATE compartido | Pasa | Pasa | Escritura real seguida de rollback exacto |
| Error FK real | Pasa | Pasa | Revierte UPDATE anterior, revisión y referencias; FK clean |
| Padre, hijo, deuda y revisión | Pasa | Pasa | Revierte saldo 1.000.000→900.000, deuda 250.000→150.000, pago 100.000 y split; todas las tablas iguales, integrity_check=ok |
| Fallo antes de BEGIN | Pasa | Pasa | unknown, cuerpo cero, sin rollback ajeno, conexión descartada y reapertura utilizable |
| Dos dueños, lectura ajena y checkpoint | Pasa | Pasa | Barrera determinista: primero→lector→segundo→checkpoint; lector ve 900.000 confirmado; dos BEGIN sin nesting |
| Runner anidado, préstamo y revocación | Pasa | Pasa | Rechazo de nesting; préstamo sin autoespera; permiso vencido rechazado antes del driver |
| Respuesta perdida después de COMMIT | Pasa | Pasa | unknown, cuerpo una vez, conexión anterior inutilizable, reapertura con saldo confirmado 900.000 |
| Respuesta perdida después de ROLLBACK | Pasa | Pasa | unknown, cuerpo una vez, reapertura con saldo inicial 1.000.000; no reclasifica el resultado como rolledBack |
| Cierre solicitado durante transacción y reapertura | Pasa | Pasa | Cierre espera al COMMIT; generación distinta; saldo confirmado persiste; handle anterior rechazado |
| Respuesta perdida después de BEGIN | **Falla** | **Falla** | Timeout en primera sentencia de la conexión reabierta |
| Fallo antes de COMMIT | **Falla** | **Falla** | Timeout en primera sentencia de la conexión reabierta |
| Fallo antes de ROLLBACK | **Falla** | **Falla** | Timeout en primera sentencia de la conexión reabierta |

Los fallos `before` impiden enviar la sentencia; `after` se inyecta cuando el driver ya respondió. Son fallos deterministas del adaptador JS alrededor del driver real, no fallos físicos de almacenamiento.

### Bloqueo reproducido y límite del informe anterior

En los tres casos fallidos la transacción nativa sigue abierta al iniciar la recuperación. El runner devuelve `unknown`, revoca el ámbito y solicita cierre. **El callback de cierre sí responde** y el handle anterior queda `closed`, sin dueño. `SQLite.openDatabase` también responde al reabrir el mismo nombre. Sin embargo, `PRAGMA foreign_keys=ON` no responde durante el límite de 30 segundos; no se alcanza la consulta del saldo. El diagnóstico conserva `stage: reopen: foreign_keys pending` y ambas marcas de cierre.

BEGIN-after no ejecuta el cuerpo ni solicita rollback sin propiedad confirmada. COMMIT-before y ROLLBACK-before ejecutan una sola vez el UPDATE sintético; la finalización no llega al driver por el fallo previo. No se reintenta la operación financiera ni se introduce una compensación.

El informe anterior comprobaba que el handle era inutilizable después de incertidumbre, pero no reutilizaba esa misma base en una nueva conexión. Sus 11 aprobaciones siguen siendo evidencia de ese alcance anterior; **no acreditan recuperación utilizable**. Esta ampliación descubre el mismo problema en API 35 y API 24. La primera ejecución exploratoria API 35 se conserva en `android35-comparacion/`; las campañas finales tienen selectores y diagnóstico explícitos.

El driver nativo instalado reconoce BEGIN/COMMIT/ROLLBACK y llama `SQLiteDatabase.beginTransaction`, `setTransactionSuccessful/endTransaction` y `endTransaction` respectivamente (`SQLitePlugin.java`, alrededor de líneas 670–707). Su cierre llama `SQLiteDatabase.close` (alrededor de 490–495). Por tanto, estos controles no se ejecutan únicamente como SQL textual. La relación entre una sesión nativa todavía abierta y la espera posterior es una hipótesis compatible con la traza y el código; **no se atribuye una causa interna definitiva ni se declara un deadlock demostrado con dump de hilos**. El hecho comprobado es una espera sin respuesta suficiente para incumplir la recuperación y ausencia de bloqueos.

## Cobertura de los diez requisitos solicitados

| Requisito | Conclusión |
|---|---|
| BEGIN, COMMIT, ROLLBACK reales | Comprobados con cambios persistidos/revertidos y driver nativo sin parches |
| Fallos antes/después de escrituras | Comprobados; errores de dominio y FK adicionales |
| Rollback con referencias y revisión | Snapshot completo exacto y comprobación FK/integrity |
| Dos operaciones concurrentes | Exclusión y orden comprobados con barrera, sin sleeps de sincronización |
| Lecturas durante una transacción | Lector ajeno espera; no observa estado parcial |
| Ausencia de nesting | Rechazo explícito y número de BEGIN exterior verificado |
| Permisos prestados/revocados | Comprobados; no ejecución de SQL tras revocación |
| Cierre/reapertura | Normal y después de finalización real pasan; tras transacción abandonada falla |
| Respuestas perdidas COMMIT/ROLLBACK | Después de ejecución pasan incluyendo reapertura; antes de ejecución falla la reapertura |
| Ausencia de bloqueos | **No satisfecha**: tres timeouts en cada Android |

## Verificación y artefactos

Jest completo: **31 suites y 257 pruebas aprobadas**, 3 suites/benchmarks omitidos existentes, **8 snapshots aprobados**, sin actualización de expectativas. TypeScript (`npx tsc --noEmit`) y ESLint (`npm run lint`) pasan. El APK release universal compila; permanecen warnings heredados de Gradle/dependencias y del módulo de reporte sintético, sin cambios en Kotlin de producción.

- [Resumen verificable y comparación](atomicidad-fase1/api24-verification.json).
- [API 24 core](atomicidad-fase1/android24-core/result.json) y [API 35 core](atomicidad-fase1/android35-core/result.json).
- Fallos API 24: [BEGIN-after](atomicidad-fase1/android24-begin-after/result.json), [COMMIT-before](atomicidad-fase1/android24-commit-before/result.json), [ROLLBACK-before](atomicidad-fase1/android24-rollback-before/result.json).
- Fallos API 35: [BEGIN-after](atomicidad-fase1/android35-begin-after/result.json), [COMMIT-before](atomicidad-fase1/android35-commit-before/result.json), [ROLLBACK-before](atomicidad-fase1/android35-rollback-before/result.json).
- Repeticiones: directorios `android24-core-repeat`, `android35-core-repeat`, `android24-begin-after-repeat`, `android35-begin-after-repeat`.
- Cada campaña conserva entorno, badging APK, hashes de fuentes, reporte, logcat y metadatos de producción antes/después. Un logcat vacío en release no reemplaza la traza y diagnóstico JS.
- Logs: `jest-api24-validation.log`, `typescript-api24-validation.log`, `eslint-api24-validation.log`, `android-api24-sdk-install.log`, `android-api24-avd-create.log`, `android-api24-build.log` y `android-api24-build-final.log`, bajo `atomicidad-fase1/`.

## Reproducción

Instalación de entorno, después de autorización y con SDK/JDK ya configurados:

```powershell
$env:JAVA_HOME='C:/Program Files/Java/jdk-17'
# Las herramientas de línea de comandos deben estar extraídas en cmdline-tools/latest.
# Se usa archivo para evitar la separación por ';' del sdkmanager.bat de Tools 23.
$packageFile=Join-Path $env:TEMP 'smartfin-api24-packages.txt'
Set-Content -LiteralPath $packageFile -Value 'system-images;android-24;google_apis;x86_64' -Encoding ascii
& "$env:ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat" "--sdk_root=$env:ANDROID_HOME" "--package_file=$packageFile"
'no' | & "$env:ANDROID_HOME/cmdline-tools/latest/bin/avdmanager.bat" create avd -n SmartFin_Atomicity_API24 -k 'system-images;android-24;google_apis;x86_64' -d 'Nexus 5X'
Start-Process -FilePath "$env:ANDROID_HOME/emulator/emulator.exe" -ArgumentList @('-avd','SmartFin_Atomicity_API24','-port','5556','-no-window','-no-snapshot','-no-audio','-gpu','software') -WindowStyle Hidden
adb -s emulator-5556 shell getprop sys.boot_completed # esperar 1
```

Crear un directorio de harness nuevo; no reemplazar el de una campaña existente:

```powershell
node scripts/androidAtomicityPhase1/prepare.js C:/sfatomicity-api24-new
& C:/sfatomicity-api24-new/android/gradlew.bat -p C:/sfatomicity-api24-new/android assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain
./scripts/androidAtomicityPhase1/run.ps1 -Harness C:/sfatomicity-api24-new -Serial emulator-5556 -Campaign core -Output docs/atomicidad-fase1/reproduccion-api24-core
./scripts/androidAtomicityPhase1/run.ps1 -Harness C:/sfatomicity-api24-new -Serial emulator-5556 -Campaign begin-after -Output docs/atomicidad-fase1/reproduccion-api24-begin-after
./scripts/androidAtomicityPhase1/run.ps1 -Harness C:/sfatomicity-api24-new -Serial emulator-5556 -Campaign commit-before -Output docs/atomicidad-fase1/reproduccion-api24-commit-before
./scripts/androidAtomicityPhase1/run.ps1 -Harness C:/sfatomicity-api24-new -Serial emulator-5556 -Campaign rollback-before -Output docs/atomicidad-fase1/reproduccion-api24-rollback-before
```

Los tres comandos finales devolvieron fallo con el código anterior a fase 1.1; no se convirtieron en aprobaciones por caracterizar un defecto. Cambiar únicamente Serial/Output permite repetir sobre API 35. La ejecución detiene el paquete sintético, pero no desinstala la aplicación ni elimina sus bases.

## Límites, pruebas pendientes y autorización

Todos los 14 casos se ejecutaron en ambos entornos. En los tres timeouts no pudo completarse la lectura del estado financiero después de reabrir: se documenta como **no verificado**, sin deducir rollback del cierre. El cierre/reapertura normal y las pérdidas de respuesta después de finalización sí verifican persistencia.

No se ejecutaron apagado físico, agotamiento de almacenamiento, muerte del proceso durante COMMIT, contención entre conexiones Kotlin independientes, recordatorios/receptores de producción ni proveedor de respaldo: requieren un harness adicional y exceden esta campaña aislada. El checkpoint probado no es una copia integral de respaldo. No se probaron todos los fabricantes API 24; el emulador valida esa imagen y ABI, mientras API 35 se probó físicamente. El journal observado puede depender del sistema/fabricante, sin atribuirlo exclusivamente al nivel API. No se ejecutaron benchmarks omitidos ni se repitieron mediciones de rendimiento físico.

Node en memoria sigue acreditando invariantes, snapshots y coordinación JS, pero no reproduce la gestión de sesiones, conexiones y callbacks de `SQLiteDatabase` Android. Esta diferencia explica por qué una prueba Node aprobada no autoriza inferir reapertura nativa. La cola tampoco abarca conexiones nativas externas al runtime JS.

Para autorizar fase 2, primero debe resolverse en un encargo de fase 1 separado la recuperación de transacciones nativas abandonadas y demostrar que la conexión nueva puede verificar FK, integrity_check, revisión y estado financiero sin esperas indefinidas, reintentos financieros automáticos ni falsos resultados de rollback. Deben pasar estos mismos 14 casos en API 24 y API 35, mantener Jest/TypeScript/ESLint y preservar las caracterizaciones parciales anteriores. La política ante incertidumbre debe conservar la distinción entre resultado desconocido y reversión confirmada. Después corresponderá revisión y autorización explícita del usuario.

**La condición de aceptación completa no se cumple. Fase 2 permanece sin autorizar y no se implementó.**
