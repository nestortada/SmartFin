# SmartFin — aceptación integrada, fase 5E

24 de octubre de 2026, America/Bogota. **Veredicto: BLOQUEADO.**
No autoriza distribución, habilitación de respaldos ni fase 6.

## 1. Matriz, dependencias y alcance

Se aplicaron `smartfin-financial-domain` y `react-native-best-practices`, con sus
referencias de hilos y medición nativa. Se consultaron AGENTS, arquitectura,
base de datos, módulos/flujos, Suscripciones, informes 0–5D, estabilización 5B.3,
lector v2 y contrato de época/limpieza. El código vigente prevalece sobre las
descripciones históricas. El [mapa de integración](atomicidad-fase5e/matriz-integracion.md)
identifica participantes, barreras, fallos y garantías anteriores.

El checkout ya contenía cambios de 5D, incluido el receptor Kotlin. Se conservaron.
Las huellas iniciales protegen **476 archivos existentes**; no se modifica producción,
driver, esquema, migraciones, dependencias, dinero ni política de entrega incierta.
Los archivos nuevos son pruebas, harness y documentación de aceptación.

Antes de cambios se ejecutaron los cuatro controles: TypeScript estricto, ESLint
y diff-check pasaron; Jest no ejecutó pruebas por EPERM en su caché temporal del
sandbox. Su repetición fuera del sandbox pasó **629 pruebas**, con tres benchmarks
omitidos existentes. La comprobación TypeScript de esa repetición coincidió con
la primera versión del harness nuevo y detectó dos firmas incorrectas de la prueba;
se conserva ese resultado y no se presenta como una línea base limpia conjunta.
La primera corrida original y la calidad final están archivadas por separado.

## 2. Escenarios ejecutados y pendientes

Hay una historia financiera común ejecutada tanto en `node:sqlite` como en
Hermes/Android, usando los casos de uso y repositorios actuales. A ella se agregan
matrices de fallos y regresiones nativas sobre fixtures auxiliares. Estos últimos
se identifican como regresiones; no reemplazan el ciclo combinado nuevo.

El inventario API 24 está en [summary.json](atomicidad-fase5e/summary.json), el
físico en [summary-api35.json](atomicidad-fase5e/summary-api35.json) y el conjunto
en [summary-integrated.json](atomicidad-fase5e/summary-integrated.json), con
campañas, controles, APK, métricas, tiempos y pendientes. Solo se consolidan las
carpetas finales que enumera el script; los intentos fallidos quedan excluidos.

El HONOR inicialmente no estaba disponible; el propietario lo conectó después y
autorizó expresamente su reinicio físico. La campaña posterior usa API 35 real y
fuentes vigentes atestadas; las evidencias históricas de 5D no se contabilizan
como una campaña nueva. Quedan pendientes el recorrido real de
apertura/primer plano montando AppNavigator en UI aislada y la integración externa
del analista semanal. Las invocaciones explícitas del runtime sí se distinguen.

## 3. Pruebas financieras

El fixture contiene banco, efectivo, ahorro, tarjeta, compra a tres cuotas,
extractos/deuda, ingreso, gasto, transferencia y 4×1000; compra compartida,
reembolso aplicado, condonación, suscripción pagada y pendiente, recordatorios,
comprobante IA confirmado y revisión financiera. La auditoría de apertura es una
fila sintética explícita: no se atribuye al alta manual una auditoría automática
que su implementación no promete.

Los comandos reales comprueban **14 estados completos**. El cierre del fixture,
antes de los cambios posteriores de las campañas de respaldo, es:

| Métrica | COP |
|---|---:|
| Disponible | 1.148.700 |
| Deuda | 60.000 |
| Patrimonio | 1.088.700 |
| Ingreso mensual | 200.000 |
| Gasto mensual | 151.300 |

El pago de tarjeta reduce activo y deuda sin otro gasto. Conciliar la suscripción
reutiliza el gasto existente; repetir el vínculo no duplica movimientos. Recibir
5.000 de un tercero reduce el derecho de cobro sin registrar ingreso ni otro
gasto. Condonar 10.000 reduce patrimonio y conserva el diario de pérdidas. Repetir
el plan IA reconoce su comprobante sin ejecutar de nuevo sus impactos.

Se rechaza **$0,40 COP** sin escrituras. No se añaden tolerancias monetarias ni se
actualizan snapshots. Cada estado pequeño descubre tablas y columnas, compara
filas completas e incluye auditoría, revisión, referencias, cuotas/extractos,
obligaciones, compartidos, pérdidas y comprobantes, más FK/integridad. Node tiene
39 tablas de aplicación; Android añade `android_metadata`, con 40 en el inventario.

## 4. Coordinación JavaScript/Kotlin y atomicidad

En Node se retiene una escritura intermedia del pago y se encola el dashboard:
no devuelve el estado parcial. La escritura manual y dos mantenimientos
concurrentes terminan serializados, sin controles anidados. Un plan IA revisado
encolado detrás de un cambio manual rechaza la revisión obsoleta sin otro impacto.

Las matrices nuevas usan la historia común completa:

| Unidad | Escrituras descubiertas | Fallos antes/después verificados |
|---|---:|---:|
| Transferencia con impuesto | 11 | 22 |
| Pago y reconciliación | 10 | 20 |
| Plan IA con transferencia y comprobante | 13 | 26 |
| Borrado, intención y recibo | 38 | 76 |
| Total | 72 | **144** |

Un rollback confirmado conserva exactamente todas las tablas/columnas y métricas.
Se prueban antes/después de BEGIN, COMMIT y ROLLBACK con base sintética en disco:
los **seis resultados son unknown**, sin reintentar el cuerpo. La inspección
forense tras cerrar/reabrir distingue la escritura efectivamente confirmada de la
ausente; nunca convierte esa reapertura en un comprobante del comando anterior.

Android ejecuta coordinador, receptores, recordatorios, captura, publicación,
borrado, Worker y Headless reales. Las regresiones comprueban drenaje del receptor,
espera del participante administrado, préstamo de token y liberación. El orden
se mantiene JS → nativo → SQLite; Worker libera participación antes de esperar JS.
Estas garantías siguen limitadas al proceso y a participantes administrados.

La contienda heredada de 5D usaba un SELECT. Se conserva como regresión de lectura
y se añade una campaña complementaria con el caso de uso real de pago mientras
el receptor mantiene su dueño exclusivo. El pago espera; al liberar, banco pasa
de 1.000.000 a 999.999 y deuda de 3.000 a 2.999, con un solo creditCardPayment y
ningún gasto nuevo. El resto de su matriz nativa también pasa. El APK complementario
se atesta por separado, con idénticas fuentes de producción.

## 5. Respaldo y publicación v2

El ciclo nuevo captura la historia común, encola una escritura real, publica la
copia anterior y compara el banco, comprobante IA, tarjeta y tablas del snapshot.
SAF no modifica la base viva. El verificador compara tamaños, SHA-256, inventarios,
IDs anuales y celdas de `tarjetas-credito.csv` con su consulta sobre el snapshot,
incluido el predicado `creditCard`.

Un fallo creando `categorias.csv` deja disponible la generación completa anterior.
Después de otro cambio vivo, reanudar conserva el snapshot original y no vuelve
a escribir SQLite ni `cuentas.csv` ya verificados. Un manifiesto parcial no se
selecciona. Las regresiones añaden corrupción, fallos de componentes/manifiesto,
captura/checkpoint/reapertura y respuestas perdidas.

El proveedor es un DocumentsProvider de pruebas del UID sintético. **No se escribe
en Drive real.** Relectura SAF acredita bytes servidos por ese proveedor, no
sincronización remota, fsync ante corte eléctrico ni durabilidad universal.

## 6. Borrado y limpieza recuperable

El commit contiene los **36 DELETE** existentes y las dos escrituras de ciclo de
vida/recibo. La matriz común verifica rollback completo en 76 posiciones. La
regresión nativa añade conservación de AlarmManager ante rollback y fallos de
reserva, COMMIT, cancelación/progreso y recuperación.

Un publicador SAF retenido rechaza el borrado antes de adquirir permiso financiero.
Después, el borrado de la historia común confirma y un fallo inyectado antes de
cancelar recordatorios deja **confirmed + cleanup pending**. El siguiente proceso
completa solo la limpieza; las tablas financieras no se borran otra vez.

Los trabajos anteriores rechazan publicación. Las generaciones externas conservan
sus bytes y se etiquetan históricas mediante la evidencia local de época. Una
suscripción real nueva reutiliza identidades bajo otra época; su alarma sobrevive
a recuperación anterior y al rechazo de un Headless obsoleto. No se intenta
resolver un resultado unknown suponiendo rollback ni se revocan copias externas.

## 7. Notificaciones y recuperación

Las campañas del APK actual prueban elegibilidad, pagada/cancelada, revisión y época
antiguas, delivered, permiso denegado, notify sin acuse, fallo del UPDATE y tres
muertes reales del proceso. Se inspeccionan estados SQL y llamadas/identidades OS.
Un acuse perdido después de publicar puede permitir otra llamada con la misma
identidad. Se conserva esta política y `setOnlyAlertOnce`; no se promete exactamente
una vez, sonido, vibración, banner percibido ni hora exacta.

WorkManager/Headless y el servicio de recordatorios se ejecutan realmente. Los
callbacks inyectados de BOOT/TIME/TIMEZONE/PACKAGE son pruebas explícitas del
receptor, no cambios reales de reloj. El reboot del emulador se registra con
boot_id antes/después y muestrea la alarma **antes** de llamar recuperación manual.
La recuperación automática del HONOR sigue sin acreditar; una llamada del harness
no la acredita. El recorrido de UI AppNavigator/primer plano completo no se certifica.

En el reboot **actual API 24**, boot_id cambió, pero `automaticAlarm=false` antes
de la llamada explícita; esta reparó el recurso en **368,45 ms** sin repetir
finanzas. Tampoco se acredita recuperación automática API 24 en esta campaña.

En HONOR se ejecutó el reboot físico autorizado: boot_id distinto y usuario
RUNNING_UNLOCKED. Dos observaciones antes de abrir el harness, a las 22:17:31Z y
22:18:08Z, no encontraron proceso ni alarmas del paquete sintético. La primera
apertura del verificador terminó por excepción nativa **5E-002**, no por un
resultado aprobado. El reintento explícito con el mismo fixture y APK pasa:
`automaticAlarm=false`, reparación por WorkManager **89,75 ms**, sin repetir
finanzas. No se infiere que nunca pueda ocurrir reparación automática fuera de
esas ventanas. El stack no identifica la acción del receptor que sufrió el crash.
El verificador aplaza mantenimiento al abrir para inspeccionar el estado: esta
ventana no demuestra que el sistema nunca lo recuperaría más tarde ni identifica
una causa del SO. La observación histórica positiva de 5D no sustituye esta prueba.

## 8. Android API 24/35 y código ejecutado

API 24 usa emulador x86_64, release/Hermes, paquete
`com.smartfin.snapshot5b2.tests`, base `phase5b2_synthetic.db`, UID propio y SAF
sintético. Cada campaña verifica APK, hashes originales/adaptados y embebidos,
ruta/UID y metadatos de `com.smartfin` antes/después. No se abre su base instalada.
Los controles pequeños comparan filas; los grandes guardan columnas, conteos y
hashes de todas las tablas mediante streaming nativo, además de integridad/FK.

El banco conserva los módulos Kotlin actuales con transformaciones de aislamiento
y probes. Se corrige únicamente el preparador para reaplicar hooks de limpieza
sobre el objeto actual que 5D copiaba después; no cambia el protocolo de producción.
El APK y sus fuentes se conservan en `C:/sf-5e-20261024`; los hashes están junto a
cada campaña. Para API 35 se compiló la misma copia con ABI arm64-v8a y x86_64;
los APK x86 anteriores y sus huellas se conservaron antes de recompilar.

HONOR CRT-NX3/API 35: paquete sintético UID 10292; `com.smartfin` UID 10284.
SQLite 3.44.5, zona America/Bogota. Las 319 huellas de fuentes originales de ambos
preparados coinciden con el checkout vigente. La campaña física vuelve a ejecutar
el ciclo financiero, las 25 regresiones y la contienda de pago real; no reutiliza
resultados del emulador. La configuración temporal de pantalla se registra para
restaurarla al cierre y los metadatos del paquete real se comparan por campaña.

El consolidado actual contiene **31 campañas API 24 y 249 controles del harness**:
25 campañas de regresión/200 controles, ciclo integrado/9, reinicio/nueva época/3,
medición/6, reboot/4 y contienda financiera complementaria/27. Su segundo APK y
fuentes se conservan en `C:/sf-5e-contender-20261024`; ambos grupos se identifican
en el consolidado. Los tres volúmenes de medición registran explícitamente el
fallo del historial; completar el harness no significa aprobar esa etapa ni 5E.

La extensión física contiene **33 campañas API 35 / 257 controles**: las mismas
31 campañas requeridas/249 controles, otra medición/6 y un diagnóstico de
contención/2. Total **64 campañas con informe / 506 controles del harness** entre
plataformas. El crash sin informe no se incluye como campaña aceptada. La segunda
medición marca el exceso de presupuesto; el diagnóstico pasa al reproducir el
defecto, sin presentarlo como aprobación de la aplicación. Su tercer APK y fuentes
se conservan en `C:/sf-5e-race-20261024`; todos los grupos tienen huellas separadas.

## 9. Rendimiento y bloqueos

Muestras funcionales individuales API 24; no son percentiles ni garantías OEM.
La carga histórica sintética se siembra por SQL con su ajuste bancario y luego se
ejecutan los casos de uso reales. Cada volumen parte de una historia/época nueva.
El conteo inicial es 1k/10k/100k; pago y escritor concurrente agregan dos movimientos
al origen, y el snapshot incluye solo los anteriores a su barrera.

| Etapa, ms | 1.000 | 10.000 | 100.000 |
|---|---:|---:|---:|
| Dashboard | 17,43 | 114,90 | 4.512,60 |
| Historial paginado | falla 5E-001 | falla 5E-001 | falla 5E-001 |
| Pago y reconciliación | 36,10 | 43,14 | 162,87 |
| Mantenimiento | 48,06 | 46,60 | 66,82 |
| Captura SQLite | 279,07 | 416,41 | 2.037,30 |
| Espera hasta admisión financiera | 281,13 | 417,66 | 2.038,24 |
| Espera + finalización financiera | 315,22 | 469,34 | 2.077,76 |
| Exportación CSV nativa | 31,94 | 181,67 | 3.930,31 |
| Escritura SAF nativa | 17,76 | 26,05 | 512,45 |
| Relectura SAF nativa | 12,95 | 38,55 | 272,85 |
| Publicación total observada | 314,99 | 490,36 | 5.474,07 |
| Borrado + limpieza | 252,62 | 265,19 | 1.685,22 |

Los tiempos del intento fallido del historial se guardan aparte y **no miden una
página entregada**. El dashboard de 100k requiere investigación de rendimiento;
no se ha aislado su causa ni se declara corregido. No hay presupuesto universal
de dashboard acordado. Las capturas/esperas y publicaciones de estas muestras
caben en los objetivos manuales provisionales ≤2 s hasta 10k, ≤6 s a 100k con aviso
y ≤20 s de publicación con progreso. No se certifica aquí la percepción del aviso
ni el progreso de UI, porque BACKUP_PUBLICATION_UI_ENABLED sigue desactivado.
No se optimizan asociaciones masivas de tarjetas ni se rediseña SQLite.

La [medición HONOR](atomicidad-fase5e/rendimiento-honor.md) registra por separado
ambas muestras y la investigación del historial heredado. En la primera muestra
100k: dashboard 4.937,56 ms, historial 79.202,57 ms, captura 5.814,62 ms,
admisión financiera 5.817,40 ms, CSV 13.295,91 ms y publicación 15.012,60 ms.
Estos tiempos tampoco son garantías. El historial sí devuelve una página en
SQLite 3.44.5, pero su latencia exige evaluación antes de aceptar el rendimiento.
La repetición conserva el problema: historial 83.001,38 ms y dashboard
5.009,51 ms. Captura 6.253,93 ms y admisión 6.257,00 ms **exceden los seis segundos**
en una de las dos muestras. La reapertura aumenta de 1.543,16 a 2.048,79 ms;
se documenta esa contribución temporal sin inventar su causa interna. La
publicación repetida tarda 15.688,71 ms y sigue bajo veinte segundos. No se
declara cumplimiento universal ni se sustituye la muestra lenta por la rápida.

## 10. Analista semanal

El [lector de fixtures](../scripts/phase5e/reader-contract.cjs) enumera tres
manifiestos binarios: selecciona el íntegro, rechaza componente ausente y corrupción
del mismo tamaño por SHA-256. Verifica inventario, referencias, revisión y SQLite.
Prueba cambio de día UTC→Bogotá y el límite inclusivo de 168 h, +1 ms y fecha futura.
La antigüedad se distingue del corte semanal solicitado, integridad, sincronización
y actualidad de época. Un dataset íntegro revocado sigue siendo histórico, aunque
sea reciente. Sin evidencia de época, su actualidad externa es unknown.

El nativo reconoce el fixture v1 como `legacyUnverified`. El ejemplo externo es
una base mínima de lector, no una copia restaurable de la app. El parser JSON no
detecta claves duplicadas; esa limitación queda registrada. **No se modificó ni
se ejecutó una automatización de ChatGPT**, y el analista externo sigue pendiente
de implementar/probar el contrato y un canal autorizado de contexto de época.

## 11. Defectos y limitaciones comprobadas

**[5E-001](atomicidad-fase5e/defecto-5e-001.md):** el historial paginado falla en
SQLite 3.9.2/API 24 al forzar el índice de expresión en la comprobación inicial.
Se reproduce con el caso de uso y directamente en Kotlin; el DISTINCT actual pasa.
Propuesta mínima: retirar solo ese primer hint, o añadir su orden compatible,
con validación completa separada. No se aplica el parche de producción.

**[5E-002](atomicidad-fase5e/defecto-5e-002.md):** después del reboot HONOR, el
receptor real lanzó sin capturar `Cleanup already running` desde `recover()` y
terminó el proceso. El mutex rechaza otro propietario; el executor del receptor
carece de catch. El crash queda conservado en DropBox/exit-info y excluido de las
campañas aceptadas. Propuesta mínima: manejar la excepción de recuperación en
ese executor y conservar intención/reintento bajo las barreras actuales, sin
repetir borrado ni comandos financieros. Ningún parche se aplica a producción.
La campaña `recovery-contention` reproduce determinísticamente el segundo
`recover()` y la excepción no capturada del receptor real, usando el mutex real.
Solo el harness intercepta esa excepción para escribir el informe; todas las
tablas/columnas, conteos, hashes, FK e integridad permanecen iguales.

Se corrigen fallos del harness: serializar un handle provocaba rechazo de toJSON
y ausencia de informe; ahora se guardan únicamente snapshot/tiempos y existe una
reproducción Jest. Otra aserción trataba como inesperado el rechazo correcto de
Headless antiguo. El fixture legacy inicialmente consultaba antes de abrir SQLite;
se corrige el orden. Todos esos intentos y los errores de caché se conservan.
No se los cuenta como defectos financieros ni como campañas aprobadas.

No se certifican apagado eléctrico, disco lleno físico, otros procesos/escritores
ajenos al coordinador, todos los OEM, restauración/downgrade, percepción de alertas,
cambios reales de reloj/zona ni actualizaciones del analista externo.

## 12. Bloqueos priorizados de lanzamiento

1. Corregir y aceptar 5E-002: la contención de recuperación no debe terminar el
   proceso. Probar receptor/Worker/JS concurrentes y preservación de nueva época.
2. Corregir y aceptar 5E-001 en API 24, conservando equivalencia y rendimiento.
3. Mantener pendiente la recuperación automática tras reboot HONOR hasta observarla
   realmente; tampoco se observó automáticamente en la ventana API 24 actual.
   Validar también apertura/primer plano en UI aislada.
4. Investigar/aceptar el historial heredado de 79–83 s y dashboard de ~5 s a 100k,
   y la admisión HONOR de 6,26 s frente al objetivo provisional de 6 s. No decidir
   habilitación de respaldos sin margen representativo y verificación de aviso/progreso.
5. Incorporar/probar el lector externo v2 y resolver evidencia autorizada de época;
   integridad y siete días de antigüedad no acreditan vigencia después del borrado.

## 13. Calidad y veredicto

Jest completo final: **644 pruebas aprobadas / 58 suites ejecutadas / 8 snapshots**,
con los tres benchmarks omitidos anteriores. Incluye **15 pruebas 5E nuevas**.
TypeScript estricto, ESLint y `git diff --check` pasan. Los reportes históricos
regenerados se restituyen a sus bytes iniciales; las nuevas evidencias permanecen
en 5E. [Calidad final API 24](atomicidad-fase5e/closure/quality-results.json) y
[cierre HONOR](atomicidad-fase5e/honor-closure/quality-results.json). La nueva
línea base y el cierre HONOR pasan los cuatro controles, con 477 archivos
protegidos y ninguna modificación; Jest de cierre tarda 147.375 ms. El lector
de consolidación CJS se comprueba además con ESLint y parser ECMAScript 2022,
pues el recorrido por defecto de ESLint no incluye la extensión CJS.
El [control final posterior al diagnóstico](atomicidad-fase5e/honor-final/quality-results.json)
conserva la repetición de los cuatro controles. El [cierre del dispositivo](atomicidad-fase5e/session-honor-closure.json)
confirma paquete real sin cambios, paquete sintético detenido y ajuste temporal
de pantalla restaurado de 15 a su valor original 0. No se desconecta el teléfono.

**BLOQUEADO para la aceptación completa de 5E y para distribución.** Las garantías
financieras pasan en los escenarios descritos, pero existen un defecto de lectura
real en la plataforma mínima, un cierre por contención de recuperación en HONOR,
un exceso del presupuesto provisional y rutas de
recuperación/validaciones externas pendientes. La publicación UI
sigue en false; no se cambian datos reales ni se inicia fase 6.

## 14. Trabajo acotado antes de fase 6

Encargo separado para los parches mínimos de contención del receptor e historial,
con regresión Node/API 24/API 35
y medición equivalente. Después, cerrar las rutas de recuperación automática/UI,
cerrar el contrato/validación del analista externo y revisar los tiempos de 100k.
Repetir solo las campañas afectadas con el mismo fixture y hashes finales, y
emitir otro veredicto de aceptación. No requiere ampliar arquitectura, migraciones,
driver ni dependencias por lo demostrado aquí.

[Procedimiento reproducible](../scripts/phase5e/README.md).
