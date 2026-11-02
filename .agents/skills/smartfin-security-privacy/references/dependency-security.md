# Dependencias y cadena de suministro

## Base del proyecto

`package.json` declara React Native 0.85.3, React 19.2.3, `react-native-sqlite-storage ^6.0.1`, `react-native-config`, `rn-speech-recognition` y Node `>=24.16.0 <25`. Comprueba siempre versiones resueltas en `package-lock.json` y el paquete instalado: un rango no prueba una versión.

`postinstall` ejecuta `scripts/patchReactNativeSqliteStorage.js`: modifica repositorio/AGP del paquete Android y llama `scripts/sqliteAndroidRecoveryPatch.js`; exige driver 6.0.1. No es suficiente actualizar npm y conservar el parche sin revisarlo. Gradle incorpora WorkManager 2.11.2 y dependencias transitivas de RN; SDK 36 no es la versión del SQLite efectivo del SO.

`.github/workflows/ci.yml` usa `npm ci` con scripts, verifica parches y ejecuta tipos/lint/Jest/reproducciones. No se observó allí un escáner dedicado de secretos/CVE ni evidencia del estado remoto de branch protection. No atribuyas a CI controles por su nombre ni modifiques el workflow en una auditoría.

## Procedimiento

1. Inventaría manifest, lockfile, Gradle/wrapper, repositorios, plugins, scripts lifecycle y parches. Revisa origen, versiones, integridad/provenance disponible y scripts que ejecutan código al instalar. Empieza con inspección local y, si sirve, `npm ls --depth=0 --ignore-scripts`/`npm explain <paquete>` sin instalación.
2. Para una alerta, registra advisory/CVE y fuente oficial, rango afectado y versión resuelta, directa/transitiva, runtime/dev/build, plataforma/API y llamada alcanzable. Explica capacidades del atacante, entrada necesaria e impacto sobre SmartFin; CVSS del paquete no equivale automáticamente a severidad del producto.
3. Verifica fuentes del mantenedor, advisories oficiales y recomendaciones Android para la versión afectada. Un falso positivo requiere justificación; ausencia de coincidencia en un escaneo no acredita ausencia de vulnerabilidades. Una dependencia de desarrollo puede comprometer build/CI aunque no vaya en APK.
4. `npm audit --json` consulta un registro y transmite metadatos de dependencias: delimita ese envío antes de ejecutarlo en un entorno privado; no lo combines con secretos ni bases. Esta skill no exige llamada de red. Si no se consulta, informa que no se evaluaron CVE actuales, sin declarar «sin vulnerabilidades».
5. Propón actualización mínima o mitigación y revisa APIs, RN/React/Node, minSdk/target, Gradle, autolinking, permisos, licencia, SQLite, parches y datos instalados. No instales, actualices ni uses `npm audit fix` automáticamente; `fix` ejecuta instalación y puede activar scripts.
6. Para un cambio autorizado, usa lockfile reproducible y compara comportamiento, driver/parches y artefactos. Selecciona QA por la ruta afectada; campañas Android solo con autorización específica. Verifica que no se pierdan recuperación ni atomicidad para satisfacer una alerta.

## Aceptación de una decisión

Entrega `paquete@versión | advisory/fecha | cadena transitiva | ruta alcanzable | probabilidad/impacto SmartFin | decisión y alternativa | compatibilidad/parche | pruebas | residual`. Ejemplo sintético: una CVE en parser de archivos no se descarta como «dev» sin comprobar si procesa entradas del repositorio durante build; tampoco se declara explotable en el teléfono si solo existe en una herramienta no distribuida.
