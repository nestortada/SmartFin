# Correcciones acotadas 5E.1

Solo el paquete `com.smartfin.snapshot5b2.tests`, su base
`phase5b2_synthetic.db` y el proveedor SAF sintético. Nunca usar el checkout como
destino ni abrir la base de `com.smartfin`. El runner comprueba fuentes originales,
adaptaciones, huella incrustada en APK release, UID y metadatos del paquete real.

1. `node scripts/phase5e1/quality.cjs baseline` (usar otro nombre si ya existe).
2. `node scripts/phase5e1/prepare-android.cjs C:/sf-5e1-20261024`.
3. En su carpeta `android`, JDK 17: `./gradlew.bat assembleRelease
   '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain`.
4. `./scripts/phase5e1/run-affected.ps1 -Serial emulator-5554 -Api 24` y, en otro
   proceso, `-Serial AXCC6R3919012932 -Api 35`. Nunca solapar campañas del mismo serial.
   Después de que termine cada serial, ejecutar la contienda de pago real con
   otro APK preparado mediante `node scripts/phase5e/prepare-android.cjs
   C:/sf-5e1-contender-20261024 --financial-contender`, compilado con las mismas ABI.
   Usar el runner de 5E.1 con ese `-Harness`, `-Campaign phase5d-matrix`, el serial
   correspondiente y salida `docs/atomicidad-fase5e1/android/api24/final-financial-contention`
   (o api35). No sustituir el APK mientras hay una campaña activa.
   El otro complemento se prepara con `node scripts/phase5e1/prepare-receiver-worker.cjs
   C:/sf-5e1-receiver-worker-20261024`, se compila igual y se ejecuta con el runner,
   ese `-Harness`, `-Campaign phase5e1-receiver-worker` y salida `final-receiver-worker`
   en cada API. Prueba al receptor real como propietario activo, Worker en retry
   mientras ese receptor permanece pausado y Headless real después de liberarlo.
5. `node scripts/phase5e1/quality.cjs closure` y
   `node node_modules/eslint/bin/eslint.js scripts/phase5e1 --ext .js,.cjs
   --parser-options '{"ecmaVersion":2022}'`.
6. `node scripts/phase5e1/summarize.cjs` consolida solo `final-*` y `regression-*`;
   conserva intentos previos como excluidos, sin convertir reproducciones en aprobación.

Las fuentes de 5E/5D/5C se reutilizan. `phase5e1-recovery` pausa el **recover real**
después de adquirir su mutex. Otro hilo llama recover, el SO despacha un broadcast
privado explícito al receptor real y WorkManager ejecuta el Worker real. Comprueba
su retry, que el segundo participante no libera el mutex ajeno y que el propietario
puede terminar. **No instala un manejador de excepciones sin capturar**. Registra
PID antes/después y vuelve a consultar SQLite. El broadcast privado no representa
BOOT ni un cambio real de reloj. Se inyecta una IOException inesperada justo antes
de recover para probar el catch genérico y la intención pendiente/completada.

`phase5e1-history-{civil,legacy}-{1000,10000,100000}` recorre páginas completas
contra el comparador congelado de 5E, proyectando explícitamente las claves civiles
y manteniendo los objetos originales para comparar todos sus campos. Comprueba
los IDs completos del cursor heredado, páginas de 50, búsquedas ASCII/Unicode y
negativas, filtros combinados, cancelación, mutación durante página, revisión y
vacío. `phase5e1-history-mixed-1000` añade offsets, fecha inválida y fecha civil
heredada. Siembra datos sintéticos por SQL; no mide altas individuales.

El caso `original-production-page-sql-reproduction` restaura únicamente el hint
inicial y el ORDER BY previos a 5E.1 sobre un proxy de lectura del repositorio real.
No es un parche de producción. Se conserva el error del driver como objeto con
message, en lugar de suponer que siempre es una instancia de Error.

Las mediciones de página distinguen comprobación inicial, espera de admisión,
await de SQL/puente, materialización JS y construcción/resto JS. La comprobación
inicial contiene consultas y la espera es parte del await; **no sumar esas columnas**.
Una repetición nativa independiente de los mismos SELECT y bindings separa
admisión/apertura, consulta hasta primera fila y lectura del cursor. Su materialización
incluye los avances del cursor; no es una medida dentro del driver ni se resta del
tiempo de entrega de producción. El driver instalado y copiado conserva sus bytes.

`phase5e1-order-probe -PreserveData` permite reproducir directamente el fallo de
desempate SQLite 3.9.2 y EXPLAIN QUERY PLAN. El CAST de la clave textual fuerza
el orden completo ascendente; modificar solo rowid no corrige ese planificador.
El costo del sort temporal se mide y documenta; no se rediseña el historial.

No se realiza reboot físico. Las regresiones de reinicio matan solo el proceso
sintético. `phase5e-integrated` seguido de `phase5e-restart -PreserveData` conserva
el commit de borrado pendiente entre procesos y prueba suscripción/alarma nuevas
frente a limpieza y Headless de época anterior. Las demás campañas de 5C/5D
comprueban los fallos de limpieza, entrega incierta y v2 sin cambiar su política.

La comparación heredada 100k del HONOR necesitó continuar la observación más allá
de la ventana inicial del runner. `observer-handoff.json` conserva la identidad
del observador de escritorio detenido; **el proceso Android no se detuvo**.
`harvest-running.ps1 -ExpectedPid 24404` verificó PID, APK instalado, fuentes,
paquete/UID y metadatos previos antes de recoger el mismo informe. Para reproducir
una continuación, identificar el PID real actual y detener solo el observador
verificado, nunca la app. El script rechaza un mutex aún poseído por otro runner.
No instala, abre, resiembra ni repite comandos. Tras un resultado correcto,
`resume-after-legacy.ps1` ejecuta únicamente las campañas que faltan. Esta extensión
de observación no convierte una latencia excesiva en cumplimiento de rendimiento.

Se conservan los intentos fallidos de instrumentación (broadcast protegido y
detección del error del driver) y la divergencia real de desempate, con sus APK y
fuentes atestados por campaña. Solo las carpetas finales forman la aceptación.
