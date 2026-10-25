# SmartFin fase 5D: seguridad de entrega y recuperación Android

24 de octubre de 2026, America/Bogota. Implementación compatible y acotada;
no inicia 5E ni activa respaldos. Se aplicaron las skills financiera y de rendimiento
React Native, incluidas las referencias de hilos y medición nativa.

## 1. Auditoría y fallo anterior

Se revisaron AGENTS, arquitectura, base, módulos/Suscripciones, informes 4, 5A,
5B.1, 5B.2, 5B.3 y 5C; receptor, módulo de alarmas, coordinador, Worker/Headless,
fachada/runtime, repositorio y protocolo de época/limpieza. El alcance financiero
esperado es cero movimientos nuevos, mismos importes, obligaciones, saldos, deuda
y relaciones. Un acuse sí incrementa la revisión existente: los triggers de la
migración 2 incluyen subscription_reminders. No se elimina ni cambia ese incremento.

Antes de cambiar producción pasaron **629 pruebas / 57 suites / 8 snapshots**,
TypeScript y ESLint. Se conservan tres benchmarks omitidos. Los registros están en
`atomicidad-fase5d/baseline-*.log`. El árbol inicial de fases anteriores se preservó;
durante la sesión pasó a estar confirmado en Git por trabajo ajeno a esta entrega.

El receptor anterior abría una transacción, validaba, publicaba y después hacía
UPDATE/COMMIT. La publicación no se revierte si falla SQLite. Se congeló su fuente
en [baseline-sources](atomicidad-fase5d/baseline-sources/SmartFinSubscriptionReminderReceiver.kt).
El mismo APK ejecuta ese receptor y el actual contra fixtures sintéticos, con
NotificationManager real. Fallar después de notify deja una notificación activa
y SQL scheduled; volver a recibir produce **dos llamadas a notify, una identidad
tag/id y una notificación activa**. Esto no demuestra una sola alerta percibida.
También se reproduce fallo después del UPDATE anterior, cuyo rollback conserva
scheduled, y respuesta perdida después de su COMMIT, que conserva delivered.

La reproducción anterior congelada se ejecutó en el banco nativo junto con la
corrección; no se afirma que una campaña nativa anterior separada precediera al
primer cambio del archivo de producción. La línea base Jest/TS/lint sí lo precedió.

## 2. Política actual y alternativas

| Alternativa | Qué permite | Compromiso y decisión |
|---|---|---|
| Validar → notify → acuse | Reintentar mientras la intención siga siendo elegible | Puede duplicar el efecto si se perdió el acuse; **se conserva** |
| Registrar delivered antes de notify | Evitar volver a intentar | Muerte antes del efecto pierde definitivamente el aviso; rechazada |
| Reservar otro estado o reutilizar scheduled/applied_revision como claim | Coordinar un intento durable | Esos campos hoy confirman programación/revisión, no distinguen claim de publicación; requiere nuevo contrato/política y autorización |
| Reintentar resultado desconocido | Recuperar un efecto posiblemente ausente | Puede volver a alertar, sobre todo tras descarte/reboot; se conserva sin prometer entrega al menos una vez |
| No reintentar desconocidos | Reducir repetición | Puede perder un aviso nunca publicado; no autorizado |
| Consultar notificaciones activas | Observar el recurso que todavía existe | Su ausencia no prueba no entrega; no se usa como recibo financiero ni como decisión durable |
| Comparar época y admisión/limpieza | Rechazar otra historia aunque reutilice IDs | Se conserva el contrato durable de 5C |

Identidad/revisión/desired, delivery_status y applied_revision no pueden hacer
atómico NotificationManager con SQLite. No se promete exactamente una vez, hora
exacta ni entrega eventual incondicional. La intención puede dejar de ser elegible
por pago, cancelación o vencimiento; permisos, Doze y OEM también pueden impedirla.
No se introdujeron estados durables, reclamaciones, esquema ni contratos nuevos.

## 3. Implementación y ciclo completo

El único archivo de producción modificado es
`android/app/src/main/java/com/smartfin/SmartFinSubscriptionReminderReceiver.kt`.
Las demás modificaciones son documentación e infraestructura sintética.

1. Los casos de uso guardan intención y derivados junto al contrato financiero.
2. La fachada sincroniza después del commit. Conserva la reprogramación incluso
   con applied_revision vigente para reparar alarmas perdidas, como exige fase 4.
3. AlarmManager/PendingIntent mantienen sus identidades, revisión, alarmas inexactas
   y URI por época. No se cambió la política de programación.
4. El receptor adquiere un dueño exclusivo del coordinador nativo existente. No
   llama ni espera JS. Drena escritores/participantes antes de validar.
5. Comprueba admisión y limpieza de 5C, época del evento, revisión y desired;
   contrato active, ocurrencia pending, vencimiento civil no pasado y fire_at
   alcanzado. Cierra el cursor y conserva solo el contenido necesario.
6. Comprueba permiso global, POST_NOTIFICATIONS cuando corresponde y canal.
   Publica con el mismo tag/id, privacidad y PendingIntent de apertura.
7. Solicita setOnlyAlertOnce(true). Se verificó FLAG_ONLY_ALERT_ONCE en ambos
   sistemas, con identidad estable. No se afirma reducción sensorial medida.
8. Ejecuta un UPDATE condicional posterior, en autocommit, o conserva blocked
   cuando la plataforma está deshabilitada. Cierra la conexión y libera el dueño.
9. Una excepción encola recuperación después de liberar, sin repetir el comando
   financiero. Worker no conserva permisos nativos mientras espera Headless JS.

Se retira el BEGIN exterior del receptor porque mantenía una transacción mientras
esperaba Android. La exclusión del coordinador protege la ventana completa frente
a los participantes administrados, sin fingir atomicidad con el SO. Las pruebas
registran inTransaction=true antes de notify en el anterior y false en el actual.
Un escritor administrado encolado espera y continúa después del efecto/cierre.

## 4. Matriz de fallos

Los valores siguientes describen el fixture elegible con permiso, misma época,
una recepción inicial y una recuperación posterior.

| Punto | notify inicial / tras reintento | SQL tras fallo | Resultado actual |
|---|---:|---|---|
| Antes de publicar | 0 / 1 | scheduled | Reintenta |
| Inmediatamente después de publicar | 1 / 2 | scheduled | Resultado externo incierto; misma identidad activa |
| Antes del UPDATE | 1 / 2 | scheduled | Reintenta |
| UPDATE abortado por trigger SQLite real | 1 / 2 | scheduled | Reintenta sin cambio financiero |
| Respuesta perdida después del UPDATE autocommit | 1 / 1 | delivered | Reconoce confirmación, no republica |
| Muerte real antes de notify | 0 / 1 | scheduled | Nuevo proceso publica |
| Muerte real después de notify | 1 / 2 | scheduled | Nuevo proceso puede repetir alerta |
| Muerte real después del acuse | 1 / 1 | delivered | Nuevo proceso no republica |
| Notificación descartada tras publicación incierta | 1 / 2 | scheduled | Ausencia no se interpreta como no entrega |
| Permiso denegado | 0 | blocked | No registra delivered |
| Pagada/saltada/vencida, contrato pausado/cancelado, desired cancelado, fila borrada, revisión antigua, fire_at futuro | 0 | Sin acuse nuevo | Rechaza |
| Marcador de admisión de borrado o evento de época anterior | 0 | Sin acuse nuevo | Rechaza |

En la versión anterior, fallar después del UPDATE pero antes del COMMIT revertía
el acuse y permitía otra publicación. El actual no abre esa transacción exterior.
La pérdida de respuesta posterior se inyecta tras una escritura autocommit real;
no se presenta como corte eléctrico, disco lleno o fallo físico del almacenamiento.

## 5. Android real y recuperación

APK release/Hermes aislado **com.smartfin.snapshot5b2.tests**, con módulos nativos
reales, driver instalado y base **phase5b2_synthetic.db**. Se comprueban fuentes,
APK, UID distinto, ruta sintética, FK/integridad y metadatos de com.smartfin sin
cambios. No se abrió ni leyó su base personal, ni se usó Drive real.

| Grupo | API 24, emulador | API 35, HONOR CRT-NX3 |
|---|---:|---:|
| Matriz anterior/actual, concurrencia, AlarmManager real, SQL y estados inválidos | 27 | 27 |
| Permiso de notificación deshabilitado | 2 | 2 |
| Alarmas programadas, WorkManager y Headless reales | 2 | 2 |
| Tres muertes de proceso y tres verificaciones posteriores | 9 | 9 |
| Reinicio normal del proceso | 4 | 4 |
| Borrado confirmado e ID reutilizado en otra época | 2 | 2 |
| Captura, publicación v2, recuperación y respuestas perdidas de apertura/cierre | 57 | 57 |
| Reinicio real del dispositivo: preparación y verificación | 4 | 4 |
| Reinstalación real del paquete sintético: preparación y verificación | 4 | 4 |
| Total | **111** | **111** |

**46 campañas / 222 controles** en el consolidado final. Solo los directorios
accepted-* cuentan como aceptación. [Resultados, huellas y tiempos](atomicidad-fase5d/summary.json).
El banco ejecuta realmente AlarmManager, PendingIntent, receptor, NotificationManager,
WorkManager y Headless JS. No reemplaza esos servicios por mocks.

Los dos sistemas se reiniciaron realmente; boot_id cambia en
`boot-before.json`/`boot-after.json`. El HONOR se desbloqueó con asistencia del
usuario. La verificación conserva identidad, fecha civil y movimientos; repara
el recurso OS mediante mantenimiento sin repetir comandos financieros.
La reinstalación real usa el mismo APK sintético, conserva datos y ejercita
MY_PACKAGE_REPLACED. No se instala ni detiene el paquete financiero.

Antes de invocar explícitamente la recuperación posterior al reboot, el recurso
ya existía en API 24 y todavía no existía en el HONOR. La invocación real de
WorkManager/Headless lo reparó en ambos. **No se acredita reparación automática
tras boot en el HONOR** ni se atribuye una causa al fabricante: el verificador
aplaza mantenimiento al iniciar hasta su llamada explícita. Se conserva la
recuperación por apertura/primer plano como ruta de reparación.

BOOT, TIME_SET, TIMEZONE_CHANGED y MY_PACKAGE_REPLACED también se prueban como
callbacks inyectados sobre el receptor real. **No se hizo una campaña controlada
de modificación real del reloj/zona del sistema**; esa cobertura no equivale a
probar recomputación completa en cambios de zona, DST o saltos de fecha reales.

## 6. Compatibilidad financiera y época 5C

Las comparaciones excluyen solo la fila de recordatorio que debe cambiar y
exigen el incremento exacto de revisión causado por su trigger. Las otras 38
tablas del fixture, incluidas vacías, se comparan completas con columnas,
relaciones y auditoría. Se ejecutan foreign_key_check e integrity_check.
No se crea gasto, ingreso, pago ni movimiento por notificar. La recuperación
real también compara movimientos antes/después y conserva la fecha de obligación.

El esquema vigente del fixture contiene 40 tablas, frente a las 39 anunciadas
en el resumen histórico de BASE_DE_DATOS.md; se usan las tablas descubiertas en
sqlite_master y no ese conteo documental como límite de verificación.

La exclusión nativa impide que un commit de pago/cancelación/borrado administrado
se interponga entre validación y publicación. Si el borrado se confirma primero,
el evento antiguo falla por época/filas. Si el receptor termina primero, el
inventario de borrado puede recoger sus recursos. Un marcador de admisión cierra
la recepción comprobada antes del efecto. No se incorporan cancelaciones globales
tardías; la limpieza de 5C sigue usando recursos exactos y previousEpoch.

El test borra, crea otra suscripción/recordatorio con el mismo ID y publica en la
nueva época. Repetir limpieza completada o recibir trabajo/evento antiguo no
cancela esa notificación nueva. Se preservan las verificaciones previas al DELETE.
Esto protege un solo proceso administrado; no acredita escritores ajenos al
coordinador, otra instalación, downgrade o restauración.

## 7. Muestras de rendimiento

| Etapa, fixture de un recordatorio | API 24 | HONOR API 35 |
|---|---:|---:|
| Validación de admisión/época, adquisición y apertura incluidas | 9,44 ms | 9,29 ms |
| Consulta y elegibilidad | 1,38 ms | 1,43 ms |
| Publicación y contador privado de prueba | 1,87 ms | 7,08 ms |
| UPDATE de acuse/autocommit | 13,17 ms | 2,24 ms |
| Primera recuperación WorkManager/Headless | 299,10 ms | 125,24 ms |

Son muestras individuales bajo instrumentación, no percentiles ni comparación
de latencia anterior/posterior. El contador del probe añade I/O al intervalo de
publicación; no se atribuye todo ese tiempo a NotificationManager. No se midió FPS,
TTI ni una carga masiva. La operación ocurre fuera del hilo principal y no espera
callbacks JS con un permiso que esos callbacks necesitan.

## 8. Calidad, intentos y límites

Jest final: **629 pruebas, 57 suites, 8 snapshots**, tres benchmarks omitidos
anteriores. TypeScript estricto, ESLint y diff-check pasan. Se conservan movimientos
y tarjetas atómicos, comprobantes IA, compartidos/condonaciones, pagos positivos
que redondean a cero rechazados, dashboard/historial paginado, suscripciones,
respaldos v2 y borrado recuperable. [Calidad](atomicidad-fase5d/quality/quality-results.json).
Los reportes históricos regenerados por Jest se restablecieron a sus bytes previos.
Una corrida ESLint inicial tenía una advertencia del probe ya retirada; la corrida
final sin advertencias está en `eslint-final.log`.

Los intentos no aceptados se conservan: primer borrado del resultado ADB durante
arranque del emulador; expectativa incorrecta de revisión invariable; interferencia
de mantenimiento pendiente del HONOR sobre un fixture manual. No se cambió el
dominio ni se aumentaron timeouts para ocultarlos. La barrera durable de mantenimiento
es exclusivamente del APK sintético y se retira para WorkManager/Headless/reboot.
Los mutex por dispositivo rechazaron dos inicios de campaña solapados antes de
ejecutar escenarios; no se cuentan como controles aprobados.

Quedan sin certificar sonido, vibración, banners percibidos, cambios reales de
reloj/zona, pérdida eléctrica, disco lleno, todos los OEM y escritores en otro
proceso. setOnlyAlertOnce no evita una alerta nueva si Android ya descartó el recurso.
Los títulos relativos heredados pueden perder precisión si Android retrasa un
aviso varios días sin superar el vencimiento; no se cambió esa presentación ni
se introdujo una política de descarte de entregas tardías.

## 9. Veredicto sobre 5E

La mejora compatible de 5D queda implementada y comprobada dentro de las campañas
descritas, sin intercambiar silenciosamente duplicación por pérdida definitiva.
La aceptación completa debe reconocer los límites de reloj/zona y percepción
de alertas pendientes; **no recomiendo avanzar automáticamente ni doy por
autorizada 5E**. Una política distinta de entrega incierta, reclamaciones, estados
durables, identidad o esquema requiere propuesta y autorización separadas.

BACKUP_PUBLICATION_UI_ENABLED continúa en false. No se implementan restauración,
borrado físico, manifiesto v2 nuevo ni capacidades financieras adicionales.
[Procedimiento reproducible](../scripts/phase5d/README.md).

El [cierre de sesión](atomicidad-fase5d/session-closure.json) confirma los paquetes
sintéticos detenidos, el ajuste temporal del HONOR restaurado a 0 y el emulador
iniciado para esta tarea cerrado. Se conserva el APK aislado y sus fuentes fuera
del checkout para reproducir la validación.

Referencias primarias de plataforma consultadas, sin sustituir evidencia de dispositivo:
[Notification.Builder.setOnlyAlertOnce](https://developer.android.com/reference/android/app/Notification.Builder#setOnlyAlertOnce(boolean))
y [NotificationManager.getActiveNotifications](https://developer.android.com/reference/android/app/NotificationManager#getActiveNotifications()).
