# SmartFin 5E.1 — compatibilidad del historial y contención de recuperación

24 de octubre de 2026, America/Bogota. Alcance exclusivo: 5E-001 y 5E-002.
No inicia fase 6 ni habilita publicación de respaldos. La aceptación integrada
completa de 5E es una decisión separada.

**Resultado: 5E-002 y 5E-001 aceptados funcionalmente en el alcance comprobado.**
Pasan **76 campañas Android / 662 controles**, 38 campañas y 331 controles por
plataforma, más 646 pruebas Jest. **La aceptación integrada de 5E y distribución
continúan pendientes** por rendimiento y rutas de recuperación/validación aún
abiertas. No se habilitan respaldos de producción.

## Fuentes y línea base

Se contrastaron AGENTS, arquitectura/base, informes 5C/5D/5E, ambos defectos,
comparadores y fixtures de 5E, las dos skills solicitadas y los llamadores reales
JS/Kotlin. Se conserva el cambio previo del receptor de entrega de 5D; el parche
nuevo afecta la clase de recuperación ubicada en el mismo archivo.

Línea base: 644 pruebas aprobadas, 58 suites ejecutadas, tres benchmarks omitidos,
ocho snapshots. TypeScript estricto, ESLint y diff-check pasan. Registros en
[baseline](atomicidad-fase5e1/baseline/quality-results.json). El runner original
registró primero `baseline-fix` bajo 5E y se copió íntegro al directorio de 5E.1.

Los contratos preservados son: cero delta financiero por consultar o recuperar;
el commit de borrado contiene las mismas 36 eliminaciones; solo ese comando
puede aplicarlas. La recuperación cancela identidades exactas de la época anterior
y avanza una intención durable. No se cambia política de entrega incierta,
redondeo, esquema, migraciones, dependencias ni driver.

## 5E-002: reproducción, causa y corrección

La reproducción original se repitió con el APK diagnóstico de 5E en el HONOR:
[original-contention](atomicidad-fase5e1/android/api35/original-contention/result.json).
El mutex real rechaza otro hilo y la excepción del executor del receptor llega al
manejador por defecto. El diagnóstico antiguo la intercepta exclusivamente para
guardar evidencia; **ese resultado reproduce el defecto, no acredita la corrección**.
El crash físico anterior permanece en [el defecto original](atomicidad-fase5e/defecto-5e-002.md).
No se volvió a reiniciar físicamente el teléfono.

`recover()` hacía `check(cleanup.tryLock())` antes de su try/finally. Esa ubicación
evita liberar un lock ajeno y se conserva. Se sustituye el rechazo genérico por
`CleanupAlreadyRunningException`, subclase de IllegalStateException con el mismo
mensaje. El contrato JSON y las validaciones JS de recuperación no cambian.

El executor de `SmartFinSubscriptionRecoveryReceiver` distingue esa contención
de otras excepciones. Registra contención como diferida; registra solo el nombre
de clase de errores inesperados, sin mensaje, stack, IDs ni datos financieros.
Después intenta encolar el mantenimiento existente, sujeto a admisión/época.
`finish()` y `shutdown()` conservan finally, y el shutdown se ejecuta incluso si
finish falla. No se añade espera sobre JS/SAF ni se libera ningún permiso activo.

WorkManager ya convierte el rechazo de recover en retry. Su Worker sigue liberando
participación nativa antes de esperar Headless JS, compara época antes de iniciar
el mantenimiento y conserva su registro de ejecución hasta el drenaje. El puente
JS sigue rechazando fallos de recover mediante Promise. No se extiende una captura
vacía ni se traduce contención en éxito financiero.

La intención SQLite y el marcador privado mantienen su contrato 5C: una contención
no los modifica; un error inesperado no los elimina. Si la admisión sigue cerrada,
encolar recursos nuevos sigue prohibido. El propietario activo, un Worker ya
existente en retry o recuperación posterior por inicio/primer plano pueden reanudar.
No se promete un nuevo mecanismo autónomo de recuperación ni reparación BOOT OEM.

La campaña final retiene **el recover real tras adquirir su mutex**, llama un
segundo recover desde otro hilo, despacha por el SO un broadcast privado explícito
al receptor real y ejecuta un Worker real por WorkManager. Verifica dos veces que
el contendiente continúa excluido, que el Worker queda ENQUEUED tras un intento,
que el propietario termina y que recover posterior reconoce completed. Conserva
PID antes/después y SQLite usable. **No instala ningún manejador de excepciones sin
capturar**. Una excepción en el executor habría terminado el proceso e impedido
producir ese informe. También inyecta IOException antes de recover, tanto con
cleanupPending como completed, para probar el límite genérico sin perder estado.

Un APK complementario conserva las mismas fuentes de producción y prueba la
simultaneidad estricta con **el propio receptor como dueño activo de recover**.
Mientras permanece retenido después de adquirir el mutex, WorkManager ejecuta
otro Worker que queda en retry. Un tercer recover confirma que el permiso sigue
ocupado y el receptor aún no ha finalizado. Después de liberar la barrera, el
receptor termina y otro mantenimiento WorkManager/Headless completa, conservando
todas las tablas financieras. Su carpeta es `final-receiver-worker`; no se
sustituye esta evidencia por la prueba con dueño de otro hilo.

## 5E-001: SQL y equivalencia

La reproducción directa previa al parche se repitió en API 24/SQLite 3.9.2:
[original-integrated](atomicidad-fase5e1/android/api24/original-integrated/result.json),
caso `api24-expression-index-history-compatibility-probe`. El SQL original falla;
sin hint y con ORDER BY de la expresión pasan. El DISTINCT original pasa.
Las campañas finales también reconstruyen el SQL anterior mediante un proxy de
lectura del repositorio real después de sembrar cada volumen; guardan el error
del driver y separan intento fallido de página entregada.

Consulta inicial anterior:

```sql
SELECT COALESCE(civil_date || 'T' || COALESCE(local_time, '00:00') || ':00.000Z', date) AS date
FROM transactions INDEXED BY idx_transactions_civil_sort WHERE <filtros> LIMIT 1;
```

Consulta inicial corregida:

```sql
SELECT COALESCE(civil_date || 'T' || COALESCE(local_time, '00:00') || ':00.000Z', date) AS date
FROM transactions WHERE <filtros> LIMIT 1;
```

Se eligió retirar solo ese hint frente a añadir un orden sin necesidad funcional:
la primera fila determina longitud/formato candidato; el DISTINCT posterior
comprueba homogeneidad y validez de todo el conjunto. Cualquier primera fila
produce la misma decisión canónico/heredado. No se quitan comprobaciones,
cancelación ni revisión. El resto de hints permanece.

La validación completa descubrió otra limitación del mismo planificador mínimo
que quedaba oculta detrás del error inicial. Con claves civiles iguales y
created_at iguales, el orden ascendente retornaba rowid ASC a pesar de solicitar
DESC. En 1.000 filas, devolvía history-252, history-504, history-756; la referencia
exige history-756, history-504, history-252. API 35 sí respetó el SQL original.
[Probe directo y EXPLAIN](atomicidad-fase5e1/android/api24/order-cast-probe/result.json).
Modificar solo rowid con +rowid o CAST no corrigió ese plan. No era una diferencia
del comparador del harness: se reprodujo directamente en Kotlin/SQLite.

Por eso el parche mínimo de compatibilidad también expresa la **clave textual de
orden ascendente** como CAST AS TEXT, equivalente para la expresión TEXT existente:

```sql
-- Antes, para oldest:
ORDER BY COALESCE(civil_date || 'T' || COALESCE(local_time, '00:00') || ':00.000Z', date) ASC,
         created_at DESC, rowid DESC LIMIT ?;
-- Después, solo para oldest en el camino canónico:
ORDER BY CAST(COALESCE(civil_date || 'T' || COALESCE(local_time, '00:00') || ':00.000Z', date) AS TEXT) ASC,
         created_at DESC, rowid DESC LIMIT ?;
```

SQLite 3.9.2 usa entonces una ordenación temporal y respeta todos los desempates.
El predicado keyset, los bindings, el índice, el orden newest, el camino heredado
y las páginas de 50 permanecen. Se mide el costo del sort, sin añadir índices,
migraciones, dependencias ni cambiar el driver. No se sustituye la paginación por
una lectura completa para el camino canónico.

Las dos pruebas Node nuevas comparan todos los objetos y todos los campos de
cursores contra la variante SQL anterior sobre SQLite moderno, además del hook
congelado. La suite existente conserva el recorrido 100k, Unicode/NUL/literales,
offsets y fechas inválidas. El test de cancelación necesitó adaptar el selector
de su punto de inyección al SQL inicial sin hint; conserva las mismas aserciones
de dos consultas, rechazo inmediato y ausencia de prueba de caché reutilizable.
No se actualizó ningún snapshot.

En Android se recorre cada página contra el comparador congelado, proyectando
explícitamente la clave civil y comparando los objetos originales completos.
Comprueba total exacto, ambos órdenes, IDs/offset del cursor heredado, búsquedas
ASCII y Unicode positivas/negativas, filtros conjuntos, fecha heredada, vacío,
cancelación, mutación real durante la consulta y cursor obsoleto por revisión.

## Android, integridad y rendimiento

La campaña usa release/Hermes aislado, SQLite 3.9.2 en emulador API 24 y SQLite
3.44.5 en HONOR CRT-NX3/API 35. Solo se manipula el paquete sintético y su proveedor
SAF. Cada directorio contiene environment, resultado, Logcat, huellas originales,
adaptaciones y comprobación de metadatos de `com.smartfin` sin cambios. No se
abrió su base instalada. El banco está en `C:/sf-5e1-20261024` y el procedimiento
está en [scripts/phase5e1](../scripts/phase5e1/README.md).

Los resultados finales se consolidan en [summary.json](atomicidad-fase5e1/summary.json).
El consolidado exige fuentes originales vigentes, APK atestado, todos los controles
aprobados, metadatos del paquete real sin cambios y `historyOutcome=passed` en las
tres cargas de rendimiento. Completar el harness con historial fallido no aprobaría
este cierre. Los [tres APK y sus huellas](atomicidad-fase5e1/apk-groups.json) se
conservan fuera del checkout para reproducir las campañas.
Los intentos anteriores permanecen excluidos: broadcast TIME_SET protegido del
harness, detección incorrecta de un rechazo del driver como Error y divergencia
real del orden ascendente antes del CAST. Ninguno cuenta como aprobación final.

La comparación heredada de 100k en HONOR requirió ampliar la observación del
harness. Antes del límite inicial de 35 minutos se sustituyó únicamente su
observador de escritorio; la app mantuvo el **PID 24404**, sin reinicio ni
resiembra. El observador nuevo verifica el APK, las fuentes y el proceso original
y recoge su mismo informe, sin repetir consultas ni comandos financieros desde
fuera de la campaña. [Registro del relevo](atomicidad-fase5e1/observer-handoff.json)
y [continuación](atomicidad-fase5e1/android/api35/final-history-legacy-100000/observation-continuation.json).
La latencia y duración prolongadas permanecen visibles y no equivalen a una
aceptación de rendimiento. La continuación de campañas empieza después de ese
resultado; ningún intento incompleto se cuenta como aprobado.
El primer chequeo de recogida esperaba un `config.pid` que el formato existente
no contiene. Se conserva su [error de observador](atomicidad-fase5e1/continued-api35-identity-check-attempt.log);
se corrigió para contrastar el PID observado continuamente, UID, paquete, ruta
sintética y APK. Se volvió a recoger el mismo informe del mismo proceso, sin
reejecutar la campaña. Ese error no es un defecto de producción.

A las 18:51 Bogotá se observó el HONOR `Asleep`, conectado a energía y sin
mantener pantalla (`mStayOn=false`). Las mediciones anteriores de 5E habían usado
pantalla mantenida encendida. Se guardó el valor previo real del ajuste, `null`,
y se aplicó temporalmente 15; `svc power stayon true` confirmó después Awake y
`mStayOn=true`. El proceso continuó siendo 24404. Las cifras detalladas que
preceden/cruzan ese cambio son diagnósticas y no un experimento controlado para
atribuir diferencias al parche. La campaña integrada de rendimiento posterior
se ejecuta bajo la condición de pantalla mantenida; el ajuste previo se restaura
al cierre. [Condición observada](atomicidad-fase5e1/honor-power-before.txt),
[ajuste](atomicidad-fase5e1/honor-power-adjustment.json) y
[condición efectiva](atomicidad-fase5e1/honor-power-effective.txt).

Las regresiones de 5C/5D reutilizan las matrices de borrado/rollback y limpieza,
respuestas perdidas, entrega incierta, Worker/Headless, tres muertes de proceso,
época antigua y nueva, captura/publicación v2. El ciclo integrado de 5E vuelve a
ejecutar movimientos, transferencias/impuesto, tarjeta/pago, IA/comprobante,
Suscripciones, compartidos/condonación y borrado. Rechaza $0,40 COP antes de
escribir y conserva la idempotencia de comprobantes/vínculos. El proceso siguiente
reanuda solo limpieza y crea una suscripción/alarma nueva que sobrevive a la época
antigua. No se reejecuta el borrado financiero para reparar recursos.

[Rendimiento anterior/posterior y desglose](atomicidad-fase5e1/rendimiento.md).
Los tiempos de intento fallido API 24 no son latencia de entrega. Las muestras
detalladas separan check inicial, await SQL/puente, admisión, filas JS y resto de
construcción. El check contiene SQL y la admisión pertenece al await: no se suman.
Un replay nativo independiente de los mismos SELECT/bindings mide admisión/apertura,
SQL hasta primera fila y lectura del cursor. No instrumenta ni modifica el driver;
avanzar el cursor puede ejecutar SQLite y sus tiempos no se restan de la página real.

El fixture heredado integrado 5E conserva date sin hora ni civil_date. Sigue
usando el camino existente de lotes de 200 y ordenación JS antes de entregar
la primera página. Retirar el hint inicial no elimina ese trabajo. El CAST afecta
solo oldest canónico y no explica ni corrige automáticamente los 79–83 s previos
del fixture heredado newest del HONOR. Cualquier optimización adicional requiere
una fase separada que preserve comparación exacta, revisión y compatibilidad.

Resumen de primera página del **mismo fixture integrado**:

| Plataforma | 1.000 | 10.000 | 100.000 |
|---|---:|---:|---:|
| API 24, 5E anterior | falla 5E-001 | falla 5E-001 | falla 5E-001 |
| API 24, 5E.1 | 40,49 ms | 359,76 ms | 12.981,16 ms |
| HONOR API 35, repetición 5E anterior | 87,95 ms | 2.406,75 ms | 83.001,38 ms |
| HONOR API 35, 5E.1 con pantalla mantenida | 275,06 ms | 3.223,64 ms | 62.289,62 ms |

La muestra física anterior inicial fue 79.202,57 ms a 100k. La nueva muestra
62,29 s sigue siendo lenta: no se presenta como rendimiento aceptado ni se
atribuye su diferencia al hint. También variaron etapas no modificadas por el
parche, como dashboard y captura; no es un ensayo aleatorizado ni un percentil.
La captura/admisión HONOR 100k actual es 4.812/4.815 ms; no elimina el incumplimiento
histórico de 6.257 ms ni acredita margen representativo universal.

En el fixture detallado heredado 100k del HONOR se observaron 115,26 s para
newest, 104,77 s para oldest, 528,46 s para búsqueda ASCII positiva y 433,29 s para
negativa. Sus condiciones de energía no fueron constantes y se conservan como
diagnóstico, sin atribución causal. El muestreo del [SQLite real](atomicidad-fase5e1/honor-legacy-dbinfo.txt)
muestra SELECT de exploración, operaciones recientes de 103–105 ms y ninguna
espera de conexión en ese instante. El replay nativo y los timers JS señalan
trabajo de consulta/materialización/búsqueda; no es evidencia de un bloqueo del
mutex de limpieza ni de que el cambio de compatibilidad resuelva esa lentitud.

Propuesta de trabajo independiente: medir planes y filas recorridas de los lotes
heredados y ensayar una prueba estricta para el subconjunto homogéneo de fechas
válidas `YYYY-MM-DD`, cuyo orden puede ser equivalente sin construir todos los
IDs. Conservar fallback para offsets, formatos mixtos y fechas inválidas; no
reescribir historia ni normalizar fechas instaladas incidentalmente. Evaluar por
separado el tamaño del lote de exploración, manteniendo las 50 filas visibles y
el mismo contrato de cancelación/revisión. Para oldest canónico, investigar si
una comprobación acotada del motor permite conservar el plan indexado en versiones
verificadas y usar el orden equivalente conservador en las demás. No inferir esa
capacidad solo de Android API. Ninguna propuesta se implementa en 5E.1.

## Riesgos y aceptación integrada

Calidad final: **646 pruebas aprobadas, 59 suites ejecutadas y ocho snapshots**;
se mantienen tres benchmarks omitidos. TypeScript estricto, ESLint y diff-check
pasan. Se repitió el conjunto completo tras adaptar el punto de cancelación y
tras la expresión compatible de orden. [Cierre de calidad](atomicidad-fase5e1/closure/quality-results.json).
El primer intento final conservado detectó correctamente que el inyector del test
de cancelación buscaba el SQL anterior; se corrigió el inyector, sin relajar sus
aserciones. ESLint adicional para JS/CJS del banco usa parser ECMAScript 2022.

La [auditoría contra línea base](atomicidad-fase5e1/scope-from-baseline.json)
identifica solo tres archivos de producción modificados y un test existente,
además del nuevo test de dos casos. La corrida de calidad protege 478 archivos y
acredita que ninguno cambia durante su ejecución. El APK complementario de
contienda de pago comparte las mismas [319 fuentes originales comunes](atomicidad-fase5e1/contender-source-equivalence.json)
con el primario; este añade cuatro fuentes de pruebas/fixtures y atesta 323.
El complemento receptor/Worker comparte las mismas 323 y añade únicamente su
preparador de pruebas, con 324 fuentes originales atestadas. Ninguna diferencia
entre grupos afecta a las fuentes de producción.

Permanecen fuera de certificación la recuperación automática tras reboot OEM,
la ruta UI completa de apertura/primer plano, percepción de alertas, lectores
externos v2, apagado físico, otros procesos/escritores y garantías universales de
durabilidad. No se cambia la política de notificación incierta ni se interpreta
ausencia de alerta como recibo de no entrega. Los presupuestos de 100k y el costo
de ordenar oldest se evalúan con las muestras, sin prometer una optimización general.

`BACKUP_PUBLICATION_UI_ENABLED` continúa false. Repetir aceptación integrada con
estas fuentes/huellas y atender por separado las rutas y límites de rendimiento
pendientes antes de decidir distribución o habilitación de respaldos.

El [cierre de sesión](atomicidad-fase5e1/session-closure.json) confirma las dos apps
sintéticas detenidas, el ajuste HONOR restaurado exactamente a `null`/valor efectivo
0 y el emulador de esta tarea cerrado. El teléfono permanece conectado. No se
reinició físicamente ni se abrió su base financiera personal.

## Archivos de implementación

- `android/app/src/main/java/com/smartfin/SmartFinFinancialDeletion.kt`: excepción
  de contención específica; mutex y recuperación durable conservados.
- `android/app/src/main/java/com/smartfin/SmartFinSubscriptionReminderReceiver.kt`:
  captura/log seguro de la recuperación y finally del executor; conserva 5D.
- `src/modules/transactions/repositories/sqliteTransactionHistory.ts`: hint inicial
  retirado y expresión textual equivalente de orden oldest.
- `__tests__/financialAtomicityPhase5E1.test.ts`: equivalencia exacta de páginas/cursores.
- `__tests__/transactionHistoryRefinement.test.ts`: adaptación del punto de cancelación.
- `scripts/phase5e1/`: preparación, probes aislados, runner, comparador reutilizado,
  campañas, calidad y consolidación; `docs/atomicidad-fase5e1/`: evidencia.

## Veredictos individuales

| Defecto | Veredicto y evidencia |
|---|---|
| **5E-002** | **CERRADO para la excepción de contención reproducida.** Receptor y Worker reales, dos recover concurrentes, receptor propietario, pending/completed, excepción inesperada, reinicio de proceso y nueva época pasan en ambas API. El proceso permanece utilizable sin manejador de excepciones del harness; intención y exclusión permanecen, sin repetir finanzas. No certifica recuperación BOOT automática. |
| **5E-001** | **CERRADO en compatibilidad y equivalencia funcional.** API 24/3.9.2 entrega páginas y respeta desempates; API 35/3.44.5 mantiene resultados. Recorren íntegramente 1k/10k/100k, ambos órdenes, filtros/búsquedas, legado y revisiones, con equivalencia exacta y sin duplicados/omisiones en los fixtures. El rendimiento sigue abierto. |

Recomendación: mantener 5E pendiente de aceptación integrada y no distribuir ni
activar respaldos. Repetir su aceptación con estas huellas después de resolver o
aceptar explícitamente las latencias, observar recuperación automática/UI y cerrar
las validaciones externas pendientes. El trabajo posterior requiere un encargo
separado; no se inicia fase 6.
