# Verificación posterior a 3B

Fuentes sintéticas de diagnóstico; no se integran en la app. Protocolo completo:
[protocolo.md](../../docs/performance/post3b/protocolo.md).

Preparar **una carpeta nueva fuera del repositorio** con el mismo entorno Android/JDK
del harness 3B y sus dependencias instaladas. `prepare.js` reutiliza sus guardas,
conserva una copia de la versión anterior del repositorio y añade exclusivamente
instrumentación a las copias. Nunca ejecutar la preparación sobre el checkout.

```powershell
node scripts/androidPost3BPerformance/prepare.js C:/sfpost3b-reproduction
& C:/sfpost3b-reproduction/android/gradlew.bat -p C:/sfpost3b-reproduction/android app:assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'
./scripts/androidPost3BPerformance/run.ps1 -Harness C:/sfpost3b-reproduction -Serial emulator-5554 -Output docs/performance/post3b/reproduction-api24 -Campaign post-probe
```

Repetir secuencialmente por dispositivo con `post-fragments`, `post-close`,
`post-associate`, `phase3b`, `phase3a`, `phase2`, `core`, `begin-after`,
`commit-before` y `rollback-before`. No ejecutar dos campañas sobre el mismo
dispositivo; las API pueden trabajar en paralelo. Para tiempos, esperar a que
terminen compilación, Jest y cualquier otro trabajo pesado del host.

Ejecutar además `post-reader-control`: contrasta el fixture original del cierre
3B y asociaciones de 1.000/10.000 con captura real del lector, controles/cola y
sin detalle SQL ni muestreo de memoria. Las campañas detalladas iniciales conservan
un intervalo legado calculado después de esperar al escritor; ese campo no prueba
espera efectiva y se etiqueta expresamente en el resumen. La versión actual del
harness corrige ese contador también en las campañas detalladas reproducidas.

La ejecución de referencia está en `C:/sfpost3b-performance-20261018`. Cada salida
guarda configuración, fingerprints de fuentes instrumentadas, datos JSON, logcat y
metadatos del paquete de producción antes/después. Los únicos paquetes que instala,
inicia o detiene el runner son `com.smartfin.atomicityphase1.tests`. Las bases
son nuevas y sintéticas, con nombres validados por el comparador nativo.

`post-probe` caracteriza la sentencia anterior y la corregida sin filas coincidentes.
`post-fragments` comprueba rollback de la asociación completa y del repositorio
independiente, incluida una excepción real de SQLite en el segundo fragmento.
`post-close` y `post-associate` incluyen comparación exacta de todas las tablas
fuera de las ventanas temporales. La asociación que falla en el original API 24
primero acredita rollback; luego usa un oráculo SQL de literales, explícito y solo
de pruebas, para contrastar el resultado exitoso completo. Su tiempo se excluye.

Para resumir las carpetas `final-api24-*` y `final-api35-*`:

```powershell
node scripts/androidPost3BPerformance/summarize.js
```

Los artefactos `exploratory-*-v1` conservan una ejecución descartada por un error
del propio harness: tres retornos no esperaban el comparador antes del cierre en
`finally`. No constituyen fallos de producto ni mediciones finales.

Limitaciones: instrumentación y muestreo de memoria añaden coste; n=3/5 no estima
percentiles de producción; emulador y teléfono no son una comparación de hardware.
Los tiempos del driver incluyen cola nativa, SQLite, conversión y puente. Las sondas
nativas SELECT son rondas separadas y no se restan para estimar coste de puente.
La espera del lector comienza al solicitarlo y acaba tras su SELECT final.
