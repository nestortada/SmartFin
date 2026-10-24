# SmartFin fase 5B.3

Fecha de cierre: 24 de octubre de 2026, America/Bogota. Los registros conservan
sus instantes originales; no se cambian fechas de evidencias anteriores.

**Estabilización 5B.3 implementada; activación de producción condicionada.**
La bandera permanece en `false` y no se implementa ni se inicia 5C.

## Alcance y línea base

Se revisaron AGENTS, arquitectura/persistencia, módulos, Suscripciones, fases 5A,
5B.1, 5B.2, cierre de aceptación y contrato previo a 5C. Se conserva el árbol sucio
anterior, inventariado en [git-before.txt](git-before.txt). La línea base completa
pasó Jest (612 pruebas, 53 suites, 8 snapshots y tres benchmarks omitidos), TypeScript,
ESLint y diff-check: [resultados](baseline/quality-results.json). RN 0.85.3,
React 19.2.3, driver SQLite instalado 6.0.1 con el parche previo intacto.

Los cambios autorizados tienen **delta financiero esperado cero**: mismos saldos,
deuda, patrimonio, comprobantes IA y relaciones de Suscripciones/tarjetas. Cambian
admisión/presentación de tareas de Ajustes, observación de progreso y construcción
de filas CSV. No cambian consultas SQL, contrato v2, borrado, migraciones, driver,
dependencias ni verificaciones. [Auditoría de alcance](source-audit.json).

## UI-1: un dueño por operación

`createSettingsTaskRunner` admite sincrónicamente una tarea. Una segunda solicitud
no ejecuta su cuerpo ni altera busy/error/confirmación. Cada callback lleva una
identidad privada: si terminó su dueño, no puede actualizar una tarea posterior.
La instancia vive en AppNavigator y sobrevive al cambio de pantalla. El servicio
mantiene su guardia `active` y Kotlin su lock/registro durable; los botones deshabilitados
son una ayuda visual, no el mecanismo de integridad.

Se deshabilitan publicación, selección de carpeta, mutaciones de seguridad y el
botón de borrado mientras existe una tarea de Ajustes. La navegación y consultas
permanecen accesibles. Esto no implementa la barrera de borrado de 5C ni protege
otros procesos. El éxito verificado se conserva en un aviso independiente; si falla
el refresco posterior, el error indica que no se debe repetir la publicación.

Las pruebas cubren concurrencia, rechazo del segundo cuerpo, callbacks fuera de
orden, callbacks nativos de otro intento, progreso tardío, fallo de presentación
posterior al éxito y accesibilidad declarada del control. La reproducción original
está en [UI-1 anterior](../aceptacion-fase5b2/ui-audit.json). No se reutiliza ese
script de extracción antiguo como prueba del controlador nuevo.

## UI-2: recuperación observable

El publicador emite observaciones de verificación previa, inspección del snapshot,
validación externa, continuación segura, publicación, verificado e incierto.
No se inventan etapas con temporizadores. Cada evento contiene ID de trabajo, ID
de intento y secuencia; el servicio filtra intentos ajenos, secuencias anteriores
y callbacks recibidos después del resultado. Un fallo del observador no cambia
el resultado financiero ni provoca reintento. Se conserva un sondeo limitado a
una lectura en vuelo para compatibilidad con un puente anterior; no acredita sus
etapas detalladas. El APK actual usa los eventos nativos.

La recuperación sigue llamando al publicador con el ID original y `snapshotId=null`:
valida primero evidencia externa y después su recibo/snapshot original si hace falta.
Nunca captura la base actual para completar el trabajo anterior. Los estados durables
prepared, snapshotValidated, publicationPending, verified, failed y uncertain se
conservan; las nuevas etapas son observaciones transitorias. SAF y sincronización
remota siguen diferenciados, con `cloudSync=unconfirmed`.

Se corrigieron además dos mensajes observados en dispositivo: el acceso revocado
tiene prioridad sobre «desactualizado» y no dispara una sugerencia de actualizar;
un trabajo pendiente explica que se verifica su captura original, en lugar de
describir la creación de otra generación. Los errores aparecen también dentro de
la sección, con anuncio accesible, para que no queden solo fuera del área visible.

## Interfaz Android: evidencia ejecutada

La matriz final pasa **seis escenarios por API, doce en total**:
[API 24](ui/api24/ui-results.json), [HONOR API 35](ui/api35/ui-results.json).
Se ejecuta la UI de AppNavigator/SettingsScreen/DriveBackupSection actual en el
paquete release aislado, con el gate habilitado únicamente en su copia de pruebas.
Cada caso conserva XML, PNG y eventos nativos por ID de trabajo/intento.

| Escenario | Resultado observado |
|---|---|
| Respaldo manual/doble pulsación | Un ID de trabajo, captura visible, carpeta/publicación deshabilitadas; se conservan las guardias de servicio/nativo |
| Salir y regresar | El dueño y «Capturando SQLite…» siguen activos al volver a Ajustes |
| Publicación | «Publicando y verificando archivos… 0/14» corresponde al publicador; termina con SAF verificado y sincronización remota sin confirmar |
| Fallo y reinicio | Recupera el mismo ID, muestra inspección del snapshot original y continuación segura; termina verificado |
| Manifiesto escrito/respuesta fallida | Tras reiniciar muestra validación de componentes externos y verifica el ID original sin volver a inspeccionar/capturar la base viva |
| Acceso revocado | Muestra pérdida de acceso y renovación de la carpeta original, sin confundirla con datos desactualizados |
| Bytes parciales/inciertos | Verificación rechazada tras reiniciar; conserva el ID incierto, su evidencia y la generación válida anterior |

Las pausas de prueba permiten observar etapas reales y están excluidas del banco
de latencia. Se usan fallos de un proveedor SAF sintético, no revocación de permisos
de una carpeta real. «Reinicio» es del proceso, no un reboot del SO. Se verifican
etiquetas, rol de botón, estados disabled y anuncios de texto básicos; no se
certifica TalkBack, FPS ni TTI. El lector de evidencias ejecutado está en
`scripts/phase5b3/verify-ui.cjs`. Un fallo de transporte de lectura de XML se
reanudó con lecturas de UI; no se repitió ninguna operación financiera incierta.

## Diagnóstico y optimización CSV

La medición pareada exporta el mismo snapshot privado con el writer anterior y un
candidato, alternando el orden. Se excluye el primer par de calentamiento y se
comparan tamaño y SHA-256 de **todos** los CSV en cada par. API 24 es emulador;
API 35 es el HONOR CRT-NX3. No atribuir sus diferencias a la API por sí sola.

En 100.000 movimientos, la mediana pareada previa a incorporar el candidato fue
2.989,17 → 2.614,67 ms en API 24 (12,5%) y 12.607,69 → 11.386,34 ms en HONOR
(9,7%). El candidato reutiliza un StringBuilder por fila y obtiene columnCount
una vez; mantiene BOM, UTF-8, saltos de línea, nulls, orden, escape, consultas y
scope READONLY. No retiene todo el CSV en memoria. [Diagnóstico API 24](diagnostic/api24/csv/result.json),
[diagnóstico API 35](diagnostic/api35/csv/result.json).

Los tiempos de CPU del hilo están próximos a los tiempos de pared en estas muestras;
no se reprodujo el pico de 36,74 s de CSV en ellas. Eso no identifica la causa del
pico histórico ni prueba ausencia de GC, contención o variación térmica. No hay
perfil de stacks/Perfetto y no se declara causa raíz del outlier resuelta. El cambio
pequeño reduce trabajo de construcción, pero no rediseña captura/reapertura/integridad.

Las capturas completas reutilizan la campaña de aceptación: cinco procesos nuevos
y cinco capturas calientes tras un calentamiento por tamaño/API. «Frío» se refiere
al proceso, no a disco frío ni reinicio del teléfono. La apertura inicial se separa
de la reapertura y las verificaciones. Cada snapshot conserva banco, tarjeta,
comprobante IA y exactamente 1.000/10.000/100.000 movimientos; el escritor sintético
añade +1 COP solo después de liberar la captura y la copia mantiene el saldo anterior.

El harness mide captura y el publicador nativo mediante su entrada compatible
`publishSnapshot`, sin montar AppNavigator ni representar sus renders. La ruta UI
usa además `publishSnapshotWithProgress`: sus eventos están verificados funcionalmente
en dispositivo, pero este banco de tiempos no aísla su coste adicional ni mide
latencia desde la pulsación, FPS o TTI. Los tiempos no incluyen la sincronización
de Drive. No se convierten en una garantía para todos los dispositivos.

Se conservan [los intentos iniciales y sus límites](attempt-notes.json). La primera
tanda API 24 se interrumpió por conexión al servidor ADB; no cuenta como campaña
aprobada. Se repite después de finalizar las compilaciones. La primera tanda
completa de HONOR se conserva separada, anterior a los ajustes de presentación;
la tabla final usa la repetición de cierre. No se ocultan incumplimientos ni se
seleccionan únicamente las muestras más rápidas.

## Resultados de latencia y presupuesto

Se completaron **60 muestras medidas**, cinco frías de proceso y cinco calientes
por volumen/API, más seis calentamientos excluidos, en 42 campañas.
[Muestras y verificación](summary.json), [desglose completo](performance.md).
Máximos observados en milisegundos, combinando ambas condiciones:

| API | Movimientos | Espera del escritor | Publicación posterior |
|---|---:|---:|---:|
| 24 | 1.000 | 494,29 | 240,86 |
| 24 | 10.000 | 507,25 | 500,72 |
| 24 | 100.000 | 1.882,35 | 3.493,51 |
| 35 | 1.000 | 1.215,36 | 433,05 |
| 35 | 10.000 | 1.100,67 | 960,73 |
| 35 | 100.000 | 5.854,97 | 17.222,40 |

En esta repetición se cumplen los objetivos provisionales: ≤2 s hasta 10.000,
≤6 s para 100.000 y ≤20 s posteriores. El máximo de finalización del escritor en
HONOR/100.000 fue 5.881,17 ms. La UI advierte de la pausa con bases grandes.
No se elevaron límites ni se retiraron verificaciones. El margen grande es pequeño:
145 ms respecto a 6 s y 2,78 s respecto a 20 s; n=5 por condición no es un p95 ni
una certificación para otros OEM.

El cierre anterior registró 6.275,96 ms de espera y 38.230,67 ms posteriores.
Esta repetición no vuelve a mostrar esos extremos, pero las condiciones de CPU,
caché y temperatura no están controladas como en un laboratorio. **La comparación
causal de la optimización es la prueba pareada**, no restar máximos de campañas
históricas distintas. El pico de 36,74 s de CSV sigue sin causa raíz identificada.

La segunda comprobación de exportación sobre snapshots completos pasa también
comas/comillas, Unicode, saltos de línea y nulls en un clon privado:
[API 24](diagnostic-final/api24/csv/result.json),
[API 35](diagnostic-final/api35/csv/result.json). Los hashes por archivo coinciden y
el hash del snapshot original no cambia. El baseline congelado coincide con los
bytes de producción al iniciar: [comparación](diagnostic-comparison.json).

Las etapas muestran que captura e integridad no se vuelven baratas por acelerar
CSV: fuente JS, fuente Kotlin, validación del snapshot y reapertura siguen haciendo
su trabajo bajo la coordinación requerida. No se propone omitir pasos ni abrir
permisos antes de terminar. Si nuevas muestras incumplen, la respuesta proporcional
es perfilado de esas etapas/CPU y revisión del protocolo por separado, con autorización
antes de cambiar driver, captura o esquema. No reintentar operaciones financieras.

El respaldo automático sigue deshabilitado; su objetivo previo de ≤250 ms no se
acredita y no se extrapola desde el respaldo manual. Tampoco se acredita un SLA
de Drive remoto a partir del proveedor SAF sintético.

## Lector externo

La [especificación v2](../aceptacion-fase5b2/lector-semanal-v2.md) y el
[bloque de instrucciones](../aceptacion-fase5b2/instrucciones-analista-semanal.md)
se conservan. Se añade [un ejemplo binario sintético](reader-example/) con tres
manifiestos: uno completo válido, uno con un componente ausente y uno posterior
con contenido de tamaño igual pero hash incorrecto. El lector del ejemplo valida
referencias, bytes/hashes, integridad/FK/revisión/años SQLite y fecha UTC real;
selecciona únicamente el primero. [Resultado ejecutado](reader-example-results.json).

Es una base mínima para probar el lector, no un snapshot completo restaurable de
SmartFin. La fecha seleccionada, 2026-10-24 02:10 UTC, se muestra como 2026-10-23
21:10 en America/Bogota. La falta de capacidad de hash sigue obligando a informar
verificationUnavailable conforme a las instrucciones; no se simuló una herramienta
externa con esa capacidad. No se modificó ninguna conversación/automatización ChatGPT.

## Contrato de 5C preservado

Se mantiene [el contrato previo](../aceptacion-fase5b2/contrato-previo-fase5c.md):
admisión y revocación durables, drenaje real antes de SQLite, orden JS → nativo →
SQLite, recibo/época coherentes con DELETE y distinción entre historia íntegra y
conjunto vigente. Los eventos de progreso no constituyen cancelación, revocación
ni comprobante de borrado. Los 36 DELETE y los registros durables no se modifican.
El estado visual único no reemplaza ese protocolo. No se ejecuta borrado financiero.

## Calidad y límites pendientes

El control completo final pasa **620 pruebas, 55 suites y 8 snapshots**; continúan
los tres benchmarks omitidos de antes. TypeScript estricto, ESLint y diff-check
pasan: [resultados](quality/quality-results.json), [Jest](quality/jest-results.json).
Se conservan respaldos, recuperación SQLite, comprobantes IA, Suscripciones,
tarjetas, pagos mínimos, movimientos, gastos compartidos y dashboard, incluido el
rechazo de $0,40 COP que redondea a cero. No se cambió esa regla.

En Android pasan **114 controles en 14 campañas**, 57 por API: núcleo de captura,
restart-verify, publicación, recuperación de publicación, verificación posterior
y respuestas perdidas de cierre/apertura. [Resumen nativo](regressions-summary.json).
Se atestan APK, fuentes, paquete/base/UID sintéticos y metadatos de la aplicación
real sin cambios; los resultados Node no sustituyen esta evidencia del driver.

Una corrida intermedia desbordó la pila de una prueba de mantenimiento de
Suscripciones cuyo código no fue modificado. Pasaron su repetición aislada y las
corridas completas posteriores, sin subir timeouts ni cambiar lógica financiera.
Se conserva el fallo en [quality-attempt2](quality-attempt2/jest.log) y el
[rechequeo aislado](subscription-recheck.log). No se atribuye una causa raíz ni
se presenta el problema como corregido por 5B.3.

La auditoría protege los 464 archivos iniciales, incluyendo driver, borrado,
esquema, dependencias y módulos financieros. Solo difieren los archivos del alcance
autorizado. Las fuentes de captura/publicador/CSV/driver del banco de latencia
coinciden con el código final. Después del banco se ajustaron dos archivos de
presentación (prioridad de acceso revocado, sugerencia y ayuda para pendientes),
que no se montan allí: [diferencias explícitas](measurement-ui-only.diff) y hashes
medidos/actuales en summary.json. El APK final de UI sí valida esos ajustes.

Persisten condiciones antes de habilitar: incorporación y pruebas reales del
lector externo v2; aceptación explícita del presupuesto manual con ese margen y
dispositivos representativos; resolver el contrato de coexistencia con el borrado.
Una copia SAF íntegra sigue sin confirmar sincronización remota. El pico histórico
de CSV no se reprodujo ni tiene diagnóstico causal cerrado. No hay certificación
automática, TalkBack, FPS, TTI, pérdida eléctrica ni todos los OEM.

## Recomendación sobre 5C

**Recomiendo autorizar 5C como trabajo separado y acotado al contrato previo, con
la publicación de producción todavía desactivada.** Su aceptación debe exigir
revocación/drenaje, orden de locks, commit de borrado con recibo/época y pruebas de
trabajos antiguos que reaparezcan después. No recomiendo activar respaldos junto
con el borrado existente antes de cumplir ese contrato. Esta recomendación no es
una autorización recibida: no se ha iniciado 5C ni modificado los 36 DELETE.

La estabilización de interfaz y la optimización pequeña quedan implementadas.
**La habilitación de producción continúa condicionada**, incluso cuando la campaña
actual satisface los objetivos provisionales de latencia. No se cambió la bandera.

El [registro de cierre](session-closure.json) confirma los procesos sintéticos
detenidos, ajuste temporal del HONOR restaurado a `0` y emulador de esta sesión
apagado. No se abrió la base personal ni Drive real, no se detuvo la aplicación
real y no se modificó el analista externo. Los fixtures son exclusivamente sintéticos.
