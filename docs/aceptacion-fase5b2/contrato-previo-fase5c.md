# Contrato que deberá respetar 5C

Diseño para revisión, **sin implementación ni autorización de borrado en este cierre**.
No cambia el caso de uso actual. Se apoya en 5A, secciones 7.3/8, y en el publicador
v2 actual. La revisión financiera no es una identidad de conjunto de datos.

## Invariante y carencia actual

Un borrado confirmado debe impedir que un trabajo de una historia anterior se
reanude o finalice como respaldo **actual**. Una copia anterior puede seguir siendo
íntegra e histórica, sin representar el conjunto local vigente. Un archivo remoto
puede aparecer después por sincronización demorada del proveedor; su aparición no
debe rehabilitar esa historia.

Hoy el lock privado de `SmartFinBackupPublisher` serializa publicaciones entre sí;
no participa en `deleteFinancialData`. El borrado actual cancela recordatorios antes
del DELETE; no invalida jobs/snapshots ni transmite un linaje al lector externo.
`retainFailed` conserva evidencia pero no constituye una revocación durable de
publicación: `publish` puede volver a recibir ese ID. `getBackupStatus` compara
revisiones y no conoce un corte de borrado. Por tanto, **el protocolo 5C aún falta**.
No activar publicación junto con ese borrado existente sin resolver este contrato.

## Estados y decisiones

| Estado anterior al borrado | Tratamiento propuesto en 5C | Qué no debe suceder |
|---|---|---|
| `prepared` sin captura | Revocar admisión/reanudación de ese ID; conservar metadatos mínimos de la decisión | Capturar datos nuevos y presentarlos como el trabajo anterior |
| `prepared` con recibo, `snapshotValidated` | Revocar uso para publicar; inventariar el snapshot privado y decidir su eliminación local autorizada | Adoptar el recibo al reiniciar y publicar después del borrado |
| `publicationPending` | Solicitar parada cooperativa; cerrar streams y esperar terminación real sin retener el permiso financiero; clasificar lo ya escrito | Tratar un timeout o una promesa rechazada como cancelación confirmada |
| `verified` | Conservar identidad e integridad histórica, marcarla fuera del conjunto vigente; no sobrescribirla | Presentarla como copia actual por ser el último manifiesto de la carpeta |
| `uncertain` | Revocación durable de finalización/reanudación; verificación explícita de documentos propios y evidencia mínima | Reintentar el trabajo automáticamente, borrar evidencia o asumir que no existe una copia remota |
| `failed` retenido | Misma regla de revocación por historia; el estado failed no basta para impedir una llamada explícita actual | Rehabilitar el ID antiguo después del borrado |

«Revocado/superado» es un estado/atributo nuevo por diseñar. No se presume que ya
exista en el enum de 5B.2. Una generación remota verificada no se borra por cambiar
su condición de actualidad.

## Orden de coordinación propuesto

1. Crear una solicitud identificada y una **barrera de admisión de ciclo de vida**
   compartida por UI, Headless y Kotlin. Suspender nuevas capturas/publicaciones y
   mantenimiento que pueda reconstruir derivados. Registrar intención recuperable
   de borrado en preparación; ante reinicio debe mantenerse el cierre de admisión.
2. Inventariar IDs propios de jobs, snapshots y documentos relacionados. Revocar
   cooperativamente la publicación anterior a la solicitud. Esperar capturas,
   exportadores y streams activos hasta su cierre real, **antes** de adquirir los
   permisos de SQLite. No esperar un callback JS de un Worker bajo permiso nativo.
3. El publicador debe comprobar la admisión/linaje al iniciar, antes de escribir el
   manifiesto final y antes de publicar el éxito actual. La zona final del manifiesto
   y la barrera de borrado deben tener un orden común: no basta un booleano consultado
   antes de un `await`. Si no se puede drenar con evidencia, mantener la operación
   pendiente y explicar el bloqueo; no liberar la exclusión de trabajo activo por plazo.
4. Drenado el trabajo anterior, adquirir en el orden existente **cola JS → dueño
   nativo → conexiones/participantes → transacción SQLite**. El commit de 5C deberá
   contener DELETE, comprobante de borrado y nuevo identificador de historia/época,
   además de la intención de limpieza que corresponda. La decisión de usar un almacén
   existente preservado o migración requiere revisión de esquema; no se resuelve
   mediante dos escrituras independientes a JSON y SQLite.
5. Conservar `confirmed`, `rolledBack` y `unknown`. Solo un rollback confirmado
   acredita reversión. Unknown mantiene bloqueada la admisión y no repite DELETE,
   comandos IA ni movimientos. Tras reinicio, recuperar primero el singleton y
   comprobar el recibo/época autoritativos; la ausencia de un JSON privado no prueba
   rollback. Un snapshot viejo tampoco prueba que un comando financiero nunca ocurrió.
6. Tras commit confirmado, liberar SQLite/nativo/JS en orden inverso. Publicar la
   época nueva al coordinador; marcar trabajos anteriores como superados y limpiar
   exclusivamente recursos autorizados e inventariados. Los efectos OS/reminders
   deben recuperarse después del commit, con fallos separados del éxito financiero.
7. Reabrir admisión únicamente después de una recuperación coherente. Una nueva
   copia del conjunto posterior al borrado requiere un ID nuevo, una nueva captura
   y el contexto de época vigente. No reutilizar una generación ni sus comprobantes.

La coordinación sigue acotada al proceso administrado. Otro proceso requeriría un
protocolo adicional; no se deduce IPC de los locks actuales.

## Contrato externo de actualidad: decisión necesaria

El v2 actual no incluye una identidad de historia ni una evidencia de borrado. Un
analista que solo enumere manifiestos válidos no puede saber que hubo un borrado
local, especialmente estando offline. Ni `revision` ni `generatedAt` solucionan eso.

Antes de 5C deben aprobarse conjuntamente:

- Una identidad de conjunto/época independiente de revisión y generación, ligada
  durablemente al commit de borrado y a los futuros trabajos de respaldo.
- Su representación externa versionada o extensión negociada, con reglas para
  v2 históricos. No inventar ese campo en archivos existentes ni modificar sus hashes.
- Cómo obtiene el analista el contexto vigente: evidencia de época/corte de borrado
  compartida por un canal autorizado o un protocolo de marcadores versionados que
  deba verificar. Una mera escritura SAF no confirma que ese contexto llegó al remoto.
- Comportamiento conservador si ese contexto no es accesible: permitir análisis
  histórico explícito, pero `datasetCurrency=unknown`, sin afirmar «copia actual».

El orden «más reciente» solo se aplica dentro del conjunto vigente conocido. Los
respaldos históricos mantienen su integridad, pero se excluyen de la selección de
actualidad. Esta actualización del analista externo requiere autorización y pruebas
propias; no está realizada por este documento.

## Autorizaciones que debe pedir la futura 5C

| Decisión | Alcance a explicitar |
|---|---|
| Borrado financiero local | Tablas/derivados/comprobantes incluidos, preservación de ajustes y evidencia mínima |
| Snapshots y CSV privados | Incluir sus datos financieros en la limpieza o retenerlos excepcionalmente; no anunciar borrado total si permanecen |
| Evidencia incierta | Qué metadatos mínimos conservar y cómo resolver privacidad frente a recuperación; sin retener contenido completo innecesario |
| Copias externas verificadas | Conservarlas por defecto; eliminarlas requiere petición específica de proveedor/IDs, sin tocar documentos ajenos |
| Cambiar contrato externo | Época, corte y reglas del analista; incorporación efectiva y tratamiento de v1/v2 |
| Resultado remoto incierto | Explicar que borrar localmente no retira bytes ya aceptados por un proveedor ni copias de terceros |

## Matriz exigible antes de aceptar 5C

Probar cada estado de la tabla, publicaciones activas antes/durante/después del
manifiesto, respuesta perdida, proceso muerto en cada transición y reinicio offline.
Intercalar IA, mantenimiento de Suscripciones, pagos, lectores y capturas reales
en API 24/35 con proveedor sintético. Exigir que ningún job revocado vuelva a
publicar como actual; ningún recibo financiero se recree; los cambios SQL y la
intención compartan commit; fallos OS posteriores no repitan finanzas. Probar
también un manifiesto antiguo que llega tarde al remoto y un analista sin contexto
de época. Comparar tablas, auditoría, revisión, épocas, jobs, snapshots y documentos
propios. Esta matriz es requisito futuro, no una prueba ejecutada de 5C.
