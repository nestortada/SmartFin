# Diseño de atomicidad financiera de SmartFin

Fecha: 11 de octubre de 2026. Estado: propuesta para autorización; no implementada.

## Alcance y evidencia

La recomendación es ampliar `databaseCoordination.ts` y `atomicSQLite.ts`, reutilizando el límite exterior de transacción que ya emplea la IA. Cada operación financiera compuesta debe conservar la conexión y su propiedad exclusiva desde la lectura del estado vigente hasta un único COMMIT o un ROLLBACK confirmado. Sus repositorios participan en ese límite; no confirman partes de la operación por separado.

Esta fase aplica la skill [smartfin-financial-domain](C:/Users/nesto/Proyectos/SmartFin/.agents/skills/smartfin-financial-domain/SKILL.md), las reglas de `AGENTS.md` y contrasta `ARQUITECTURA.md`, `BASE_DE_DATOS.md`, `SUSCRIPCIONES.md` y la [auditoría correctiva](C:/Users/nesto/Proyectos/SmartFin/docs/auditoria-integridad-financiera.md) con código y pruebas. Se conservan las correcciones anteriores. No se modifican producción, pruebas, skill, esquema, migraciones ni dependencias, y no se abre ninguna base financiera real.

Se volvieron a ejecutar las suites `financialIntegrity.test.ts`, `subscriptions.test.ts` y `aiSubscriptions.test.ts`: **54 pruebas aprobadas en 3 suites**, con SQLite real en memoria en los escenarios que utilizan el adaptador. Las caracterizaciones de estados parciales siguen aprobando porque describen el comportamiento actual; no demuestran rollback integral. No se implementaron ni ejecutaron las pruebas del diseño propuesto. Tampoco se ejecutó Android en esta fase. Los 214 tests, TypeScript y ESLint consignados en la auditoría anterior son evidencia de aquella corrección, no validaciones nuevas de esta propuesta.

En este documento, «observado» indica código revisado o prueba existente identificada; «propuesto» indica trabajo futuro. La revisión no atribuye a los módulos todavía vacíos, a tipos de devolución o a `transaction_splits` flujos financieros que no están implementados.

## 1. Diagnóstico actual

### 1.1 Mecanismos disponibles

- `sqliteDatabase.ts` comparte una conexión mediante una promesa; inicializa esquema, migraciones y claves foráneas. `closeSmartFinDatabase` no adquiere por sí mismo la cola exclusiva.
- `runSQLiteTransaction`, en `atomicSQLite.ts`, ejecuta programas generadores avanzados sincrónicamente desde callbacks del driver. Fuera de un ámbito exterior, abre una transacción del repositorio. Ante un error de dominio fuerza una sentencia inválida para que el driver haga rollback.
- `sqliteWithinExistingTransaction` devuelve un proxy marcado en un `WeakSet`. Dentro de ese proxy, los generadores ejecutan SQL mediante `executeSql` y no abren ni confirman una transacción adicional. Actualmente el marcador no acredita dueño, conexión vigente ni duración del ámbito; tampoco bloquea otros consumidores.
- `databaseCoordination.ts` serializa callbacks mediante una cadena de promesas. IA, API pública de suscripciones, mantenimiento y algunos llamadores de respaldo/cierre/borrado usan esa cola. Los flujos manuales no están todos incluidos. Un callback que espera otra adquisición de la misma cola puede bloquearse indefinidamente.
- `executeAiCommandPlan.ts` adquiere la cola, ejecuta `BEGIN IMMEDIATE`, pasa el proxy a los repositorios, ejecuta todas las acciones y confirma una vez. Intenta rollback ante error, pero descarta el error de rollback. La limpieza del borrador ocurre después, desde el hook.
- Los triggers de `financial_data_revision` pertenecen a las escrituras SQLite. Incrementan por escritura en tablas registradas, no una vez por operación de usuario. Deben conservarse; al revertir la transacción también se revierten sus incrementos.

La cola del driver ordena tareas individuales, pero no identifica al dueño de una secuencia de `executeSql` separada por `await`. Una consulta o escritura ajena sobre la misma conexión puede ejecutarse entre BEGIN y COMMIT. SQLite permite a esa conexión ver sus propias escrituras todavía no confirmadas; por eso bloquear solo otros escritores no protege las lecturas de la interfaz. [Documentación de aislamiento de SQLite](https://www.sqlite.org/isolation.html).

### 1.2 Inventario de unidades compuestas

«Local» significa atomicidad dentro del método del repositorio, sin extensión automática al caso de uso que lo llama. Las prioridades se refieren al diseño futuro.

| Operación y entrada | Escrituras relacionadas | Protección observada | Límite necesario / prioridad |
|---|---|---|---|
| Alta manual: ingreso, gasto débito/crédito | Cuenta especial si procede, saldos, movimiento, cuotas, deuda y extractos | Cuentas y movimientos tienen transacciones locales distintas; cuotas/extractos pueden ser escrituras separadas | Caso de uso completo, incluida preparación persistente / P0 |
| Transferencia manual | Ambos saldos, principal, `<id>-in`, impuesto `<id>-4x1000`, eliminación de acompañantes obsoletos | Lote de movimientos local; no comparte commit con saldos | Principal y todos sus efectos / P0 |
| Edición histórica manual | Reverso anterior, nuevo impacto, movimiento, acompañantes, cuotas, deuda/extractos y conciliación vinculada | Sin transacción global | Lectura vigente + reverso + reemplazo completo / P0 |
| Borrado manual | Reversos, acompañantes, cuotas, movimiento, deuda/extractos, vínculos de suscripción | Borrado de cada movimiento y su conciliación localmente atómico; reverso y otros borrados separados | Toda la eliminación financiera / P0 |
| Acciones rápidas de gasto | Conversión vía `saveManualTransaction`; notas/cuotas y reconciliación en otra ruta | Correcciones reutilizan dominio; no constituyen límite global | Una unidad por acción, leyendo estado persistido / P0 |
| Registro de pago de tarjeta | Reconciliación inicial, saldo origen, pago con contracuenta, reconciliación final y extractos | Varias confirmaciones independientes | Incluir ambas reconciliaciones y validación de fondos / P0 |
| Reconciliación de tarjetas | Saldos de deuda de cuentas y extractos de las tarjetas elegibles | Cuenta localmente atómica; lote de extractos separado | Todas las escrituras que produce la invocación actual / P0 |
| Asociación de crédito por clasificar | Cuenta del gasto, cuenta de cuotas y reconciliación | Sin commit común | Asociación completa / P0 |
| Alta/edición de tarjeta | Cuenta, perfil opcional; en pantalla asociación pendiente y resolución de alertas | Métodos separados | Definir comando de pantalla completo y confirmar una vez / P1 |
| Cierre/edición de cuenta o tarjeta | Validaciones del estado y escritura de cuenta; cierre conserva historial | Escritura local; lecturas de validación pueden precederla | Lectura-validación-escritura bajo el mismo dueño / P1 |
| Suscripciones: contrato, generación, cambio, conciliación | Contrato, ocurrencias, proyecciones, alertas e intenciones de recordatorio | `repository.mutate` usa un generador transaccional; API pública coordinada | Conservar el límite existente y hacerlo participante / P1 |
| Editar/borrar gasto conciliado | Movimiento, ocurrencia y derivados; además saldos/tarjetas en el flujo manual | El repositorio de movimientos ya comparte transacción con derivados de suscripción | Ampliar al flujo financiero exterior; no duplicar conciliación / P0 |
| IA: plan completo | Acciones de varias entidades y referencias entre acciones | BEGIN/COMMIT exterior y cola compartidos; actores fuera de cola pueden interferir | Conservar lote y añadir propiedad, ciclo de vida y consumo del borrador / P0-P1 |
| Recategorización y eliminación de categoría | Movimientos, splits, subcategorías, reglas de comercio, suscripciones/envelopes y eliminación | Reasignación con múltiples SQL sin transacción exterior fuera de IA; reglas de comercio pueden guardarse aparte | Una unidad para el comando completo / P1 |
| Lotes de perfiles, cuotas, extractos y otras entidades | Varias filas por llamada; algunos usan `INSERT OR REPLACE` | No todos los lotes son atómicos fuera de un ámbito exterior | Adaptación local de lotes expuestos; participación exterior / P1 |
| Borrado financiero | Borrado ordenado de tablas financieras | Repositorio usa un generador atómico; caso de uso cancela Android ANTES del borrado | Conservar rollback SQL y diseñar limpieza nativa posterior recuperable / P1 |
| Inicialización/semillas y borradores IA | Lotes de entidades; borrador elimina otros antes de insertar | Semillas por repositorio, no lote global; borrador con escrituras separadas | Inicialización controlada y guardado de borrador localmente atómico / P2 |

La generación de mantenimiento de suscripciones trabaja en lotes acotados. Cada lote es una unidad válida; no se propone una transacción abierta durante los veinte lotes posibles ni durante un ciclo de vida completo de la aplicación. Crear un gasto desde Suscripciones y luego vincularlo sigue siendo un flujo explícito de dos acciones; no se transforma silenciosamente en una confirmación automática.

### 1.3 Fallos ya reproducidos

Fixture de la auditoría: banco inicial 1.000.000 COP; cuando existe compra de crédito, importe 250.000, gasto del periodo 250.000 e ingresos 0.

| Fallo inyectado | Estado parcial observado | Estado exigido tras rollback de la unidad propuesta |
|---|---|---|
| Inserción de transferencia de 100.000 con impuesto | Banco 899.600, destino 100.000, sin movimientos ni gasto de impuesto; patrimonio 999.600 | Banco 1.000.000, destino 0; sin movimientos nuevos; gasto 0, patrimonio 1.000.000 |
| Inserción de pago de 100.000 | Banco 900.000, deuda 250.000, sin pago; patrimonio 650.000 | Banco 1.000.000, deuda 250.000, sin pago; patrimonio 750.000, gasto 250.000 |
| Borrado de gasto débito de 250.000 | Banco restaurado a 1.000.000 pero gasto de 250.000 aún existente | Banco 750.000 y gasto original intacto; patrimonio 750.000 |
| Escritura de extracto al editar pago a 50.000 | Banco 950.000, deuda 200.000 y pago 50.000; extracto conserva 150.000 | Banco 900.000, deuda y extracto 150.000, pago original 100.000; patrimonio 750.000 |

En el último caso el éxito completo, sin fallo, debe producir banco 950.000, deuda/extracto 200.000 y pago 50.000. No basta comprobar patrimonio: coincide en varios estados coherentes e incoherentes. Las pruebas deben comparar también cada entidad y referencia.

Las correcciones de conversión débito↔crédito, borrado/edición de pago, conservación de cuotas sin cambios y rechazo manual de importes no finitos permanecen. La atomicidad no cambia los predicados, impuestos, redondeos ni el tratamiento histórico de las cuotas.

### 1.4 Interacción nativa y documentación

`SmartFinSubscriptionRemindersModule.withDatabase` abre otra conexión Android `OPEN_READWRITE`. El receptor `SmartFinSubscriptionReminderReceiver` usa su propia transacción: valida revisión/estado, publica la notificación, actualiza entrega y confirma. No participa en la cola JavaScript. La revisión condicional y la transacción nativa protegen parte de su consistencia, pero una notificación ya emitida no se revierte si después falla SQLite.

El respaldo de `SmartFinDriveBackupModule` copia el archivo y abre una conexión de lectura para CSV. El llamador JavaScript hace checkpoint y cierra su conexión dentro de la cola, pero eso no demuestra ausencia de un receptor nativo concurrente. La coherencia entre archivo, CSV y revisión requiere también coordinación con conexiones nativas. Un proveedor de documentos puede fallar después de escribir parte del respaldo; esos archivos no están dentro de una transacción SQLite.

Discrepancias relevantes: `BASE_DE_DATOS.md` presenta la deduplicación como no aprovechada aunque IA utiliza el índice parcial; algunos riesgos históricos de borrado no reflejan que el repositorio de borrado financiero ya es transaccional. El mapa inicial de módulos presenta Suscripciones como marcador pese a su implementación actual. Estas discrepancias no se corrigen ni se usan como reglas financieras en esta fase.

## 2. Arquitectura propuesta

### 2.1 Propiedad explícita y una conexión administrada

Ampliar los dos mecanismos existentes, sin sustituir repositorios ni introducir un ORM, una unidad de dinero nueva o compensaciones:

1. **Coordinador:** conservar la cola de `databaseCoordination.ts`, añadiendo un permiso de propiedad por operación, generación de conexión y estado activo. Apertura/cierre/respaldo/borrado y acceso público a la conexión deben respetarlo.
2. **Conexión administrada:** el adaptador público de `sqliteDatabase.ts` encola `executeSql`, `transaction` y lecturas externas. El runner conserva acceso interno a la conexión real mientras posee el permiso. El proxy participante ejecuta directamente dentro de ese permiso. De otro modo, encolar cada SQL del dueño detrás de su propia operación causaría deadlock.
3. **Ámbito participante:** ampliar `sqliteWithinExistingTransaction` con metadatos de dueño, generación y vigencia, revocables en COMMIT/ROLLBACK. Todos los repositorios de una unidad se construyen con ese mismo ámbito. Un proxy escapado o de una conexión cerrada debe fallar antes de ejecutar SQL.
4. **Runner exterior:** extraer el patrón asíncrono BEGIN/COMMIT de IA a `atomicSQLite.ts`, con manejo explícito de errores y propiedad. `runSQLiteTransaction` mantiene sus generadores: standalone abre su transacción local bajo el coordinador; participante solo ejecuta sentencias, como hoy.
5. **Casos de uso:** un punto de entrada adquiere el permiso una vez. Las llamadas internas reciben el ámbito y lo reutilizan, sin adquirir otra vez la cola ni abrir transacciones anidadas. UI solo entrega la intención y publica el resultado confirmado.

La implementación debe distinguir tipos internos para una conexión administrada y un ámbito activo; no usar `any`, una bandera global «hay transacción», contexto ambiente mutable ni una dependencia de `AsyncLocalStorage`. El marcador puede seguir siendo privado y asociado al proxy, con validación de su propietario. No se expone BEGIN/COMMIT en repositorios de dominio.

La adaptación de todos los consumidores de la conexión es prerrequisito para extender el runner a movimientos manuales. No es seguro liberar primero un wrapper que protege únicamente escritores: lecturas y otros métodos todavía podrían observar o integrar cambios no confirmados. Buscar también llamadas directas y repositorios creados con una conexión anterior al cierre.

La apertura e inicialización también son propiedad del coordinador: esquema y migraciones usan acceso interno mientras se construye el handle, sin esperar a la promesa de apertura desde el mismo callback. Los callbacks que ya poseen un permiso de mantenimiento usan apertura/lectura prestada, no una nueva adquisición. Conservar la inicialización y migraciones existentes; no cambiar su contenido ni sus números.

### 2.2 Secuencia y resultados

Secuencia contractual propuesta; no es código de producción:

```text
adquirir permiso de conexión
  comprobar generación, estado y ausencia de transacción ajena
  BEGIN con el driver existente
  crear ámbito participante activo
  leer entidades vigentes y validar intención/versiones
  ejecutar casos de uso existentes con repositorios de ese ámbito
  guardar todas las entidades derivadas y, si aplica, consumir borrador
  COMMIT una vez
  revocar ámbito
  publicar resultado financiero confirmado
  procesar efectos posteriores al commit según su protocolo
liberar permiso
```

Ante un error antes del commit, revocar el ámbito e intentar ROLLBACK únicamente si esta operación consiguió abrir su transacción. No intentar revertir una transacción desconocida si falla BEGIN. No continuar con una cuenta restaurada manualmente ni con una segunda reconciliación «reparadora».

Resultados internos necesarios:

- **Confirmado:** COMMIT confirmado; un fallo de refresco, limpieza de UI o servicio nativo no cambia el resultado financiero.
- **Revertido:** se confirmó ROLLBACK de la transacción abierta y se conserva el estado inicial completo.
- **Resultado desconocido:** fallo o pérdida de respuesta de COMMIT, o rollback cuya terminación no pudo verificarse. No afirmar que no hubo cambios ni reejecutar automáticamente el cuerpo financiero.

Si rollback no se confirma, poner la conexión en estado no utilizable, impedir nuevas operaciones sobre ella y cerrarla/reabrirla bajo el mismo coordinador; si el cierre falla, mantener bloqueado su uso. La recuperación verifica estado e integridad antes de devolver una conexión administrada. Reabrir no convierte por sí solo un resultado desconocido en «revertido». Conservar el error original y el de cierre/rollback sin registrar datos financieros sensibles.

SQLite no admite anidar BEGIN/COMMIT. Algunos errores revierten solo una sentencia y dejan escrituras previas activas: el runner debe resolver el límite completo. [Transacciones SQLite](https://www.sqlite.org/lang_transaction.html). No se añadirán SAVEPOINT por repositorio como sustituto del dueño exterior.

### 2.3 Lecturas vigentes, concurrencia y revisiones

El formulario puede conservar su intención mientras espera, pero las cuentas, el movimiento anterior y sus acompañantes deben leerse nuevamente dentro de la unidad. No aplicar reversos a partir del saldo o la fila enviados por una pantalla antigua. Las acciones rápidas ya leen el estado persistido; esas lecturas deben quedar bajo el nuevo límite, junto con sus escrituras.

La serialización evita sobrescrituras entre operaciones del mismo runtime. Para una edición que ya quedó obsoleta antes de adquirir el permiso, diseñar una comprobación explícita de versión/estado esperado. La revisión financiera existente permite un rechazo conservador sin esquema nuevo, aunque produce conflictos por cambios no relacionados. `updatedAt` por sí solo no acredita una versión única. La política de interfaz ante conflicto necesita aprobación; no inventar una fusión contable.

Lecturas simples externas esperan al final de la unidad. Un cálculo basado en varias consultas debe conservar un permiso de lectura durante el cálculo o un snapshot SQLite cuando haya escritores en conexiones diferentes. El dashboard conserva su verificación de revisión, caché por conexión/revisión y orden de acumulación. El historial conserva páginas de 50, cursores, cancelación, filtros y revisión antes/después: no retener el permiso mientras se recorren todas las páginas ni sustituir el historial completo utilizado por reconciliaciones por las filas visibles.

Mantener los triggers y sus incrementos actuales. La publicación de cambios/caché/UI ocurre después del commit. Un rollback debe restaurar también `financial_data_revision`; no disparar invalidaciones con revisiones de estados intermedios. Un nuevo handle después de cierre cambia la generación del ámbito y la identidad usada por cachés.

### 2.4 Límites concretos de dominio

- **Manual y acciones rápidas:** lectura vigente, creación de cuenta por clasificar si hace falta, reverso original y del impuesto, impacto nuevo, guardado de cuentas y movimientos, acompañantes, eliminación de derivados obsoletos, cuotas y reconciliación existente. Conservación de IDs, fecha/`createdAt`, referencias y progreso según las reglas actuales.
- **Pago de tarjeta:** incluir reconciliación inicial, validación de origen/tarjeta/fondos, importe limitado a la deuda, débito, movimiento `creditCardPayment` y reconciliación final. Si la validación falla, tampoco se confirman las escrituras de la reconciliación inicial.
- **Reconciliación/asociación:** incluir cuentas y todos los extractos que la función actual modifica; no reducir incidentalmente el conjunto de tarjetas ni cambiar los predicados de `pending`/`cancelled`. Asociación incluye la cuenta del gasto y de las cuotas.
- **Tarjeta desde pantalla:** componer guardado de cuenta/perfil, asociación que ya realiza el flujo y resolución de alertas SQLite. Toasts, cierre de modal y refresco de estado quedan posteriores al commit. Cierre de cuentas/tarjetas conserva historial y reglas actuales, pero valida dentro del mismo permiso.
- **Suscripción:** conservar la mutación transaccional existente. El repositorio de movimientos ya actualiza o limpia el vínculo y derivados: el wrapper exterior lo incluye sin repetir esa lógica. Proyecciones/cuotas/alertas no se convierten en gastos adicionales.
- **Categorías:** reasignaciones y eliminación, o recategorización junto con regla de comercio cuando sea una sola acción del usuario, comparten commit. No migrar todos los usos heredados de `INSERT OR REPLACE` en esta tarea; registrar sus riesgos referenciales y probar las filas hijas.

Los casos de uso existentes siguen siendo la fuente de impacto financiero. Los nuevos wrappers coordinan repositorios y lecturas; no duplican fórmulas de saldo, deuda, impuesto o conciliación en UI ni en el runner.

### 2.5 Reintentos e idempotencia

Atomicidad no significa ejecución exactamente una vez después de una respuesta perdida. Se propone:

1. Identidad estable de la intención durante su ejecución/reintento; no regenerarla en cada pulsación. Comprobar duplicados dentro de la misma transacción ANTES de aplicar saldo.
2. Reutilizar `transactions.dedupe_key` y el índice parcial existente donde el flujo ya dispone de esa identidad. Si existe la clave, validar compatibilidad de la intención y devolver el resultado existente o rechazar conflicto. No hacer el débito y después confiar en que falle el índice único. Para transferencias, comprobar el grupo completo de acompañantes.
3. Edición: leer la versión actual y validar precondición. Repetir una asignación al mismo estado puede ser una operación sin cambio; no volver a aplicar el reverso de una copia antigua. Borrado: si el principal ya no existe, no aplicar otro reverso; ante ambigüedad no atribuir su ausencia necesariamente a este comando.
4. IA: comprobar el borrador esperado y consumir SOLO ese borrador dentro de la misma transacción que el plan. Al revertir permanece disponible. Al confirmar no puede volver a ejecutarse aunque falle el refresco del hook. Eliminarlo después mediante `clearActiveDraft()` no ofrece esta garantía y puede afectar un borrador nuevo.
5. Reintentar automáticamente el cuerpo solo cuando se acredita rollback y siguen válidas sus precondiciones. No reintentar una operación completa por fallo de programación de recordatorios, exportación, refresco de UI o resultado desconocido.

Limitación deliberada: el índice de movimientos y el consumo del borrador no almacenan un recibo general de todas las operaciones. La ausencia de un borrador no distingue cancelación de confirmación; tampoco permite reconstruir siempre un resultado, un importe de pago limitado por la deuda, una edición seguida de otra edición o una eliminación histórica. La fase inicial garantiza detener un reintento ambiguo, no promete deduplicación durable universal. Si se exige recuperar automáticamente TODOS esos resultados después de reinicio, se necesita un registro durable de comandos/recibos con política de retención y una fase de esquema autorizada aparte. No se propone esconder ese registro en textos de movimientos ni inferirlo de saldos.

### 2.6 Efectos nativos, mantenimiento, cierre y respaldo

Las intenciones de recordatorio de suscripciones ya se guardan dentro de la mutación SQL. Mantenerlas como mecanismo de recuperación: programar/cancelar tras commit; confirmar `applied_revision` mediante escritura condicional posterior. El fallo del servicio deja intención pendiente, no invalida el gasto/contrato. Ese acuse es otra unidad de entrega, no un segundo commit de la operación financiera.

Al principio, conservar el permiso durante la breve sincronización nativa posterior, como hace la API pública actual, evita cambiar ordenamientos. Esa sincronización debe usar la conexión administrada prestada por el dueño, sin volver a encolar detrás de sí misma. Separar el mutador interno de dominio del método público que adquiere el permiso y hace efectos. No llamar la API pública de suscripciones desde una unidad que ya posee la cola. Los errores de efectos deben devolverse separados de «confirmado».

La cola JavaScript solo coordina su runtime. Para las conexiones Android directas, extender el acceso nativo existente con un permiso de ciclo de vida compartido entre receptor, acceso de recordatorios y respaldo. Durante checkpoint/cierre/copia/CSV no deben entrar escritores nativos; adquirir ese permiso ANTES del checkpoint y liberarlo tras exportar/reabrir. Durante borrado excluir el receptor hasta terminar el commit y la fase inmediata de limpieza. Orden fijo: permiso JS → permiso nativo; un receptor que posee el permiso nativo no debe esperar a JS. La recuperación Headless se encola después de liberar el permiso nativo. Si existe otro proceso, un mutex en memoria no basta: verificar manifiesto/runtime y decidir coordinación adicional antes de ofrecer esa garantía.

La conexión nativa conserva su transacción y comprobaciones de revisión. Auditar sus PRAGMA por conexión, tiempos de espera y comportamiento ante BUSY; no asumir que hereda `foreign_keys` de la conexión JS. La publicación del receptor requiere un protocolo posterior al commit con identidad de notificación estable y recuperación del acuse. No es posible atomizar SQLite y `NotificationManager`; un crash entre ambos deja una ventana de entrega/reentrega. Su rediseño debe ser una fase de entrega nativa explícita, con pruebas de cancelación y privacidad, y sin prometer «exactamente una notificación».

El permiso nativo debe poder prestarse a llamadas iniciadas por su dueño JS, con token y liberación garantizada; no mantener un mutex bloqueante del hilo del bridge mientras se espera un callback que debe ejecutarse en ese mismo hilo. Receptor y exportador actuales son los consumidores concretos a integrar. Validar liberación ante desconexión del runtime y excepción nativa antes de activar este protocolo.

**Borrado:** mover simplemente `cancelAll()` después del borrado no basta: actualmente descubre IDs leyendo `subscription_reminders`, que ya no existirían. Diseño recomendado sujeto a autorización: capturar los IDs antes de borrar, persistir una intención de limpieza con esos IDs en almacenamiento existente preservado por el borrado, confirmar el borrado, y cancelar IDs explícitos después; repetir solo la limpieza en recuperación. `app_settings` permite una clave interna sin migración, pero hay que aprobar su contenido, limpieza y exclusión del flujo de ajustes del usuario. El protocolo debe resolver también cancelación de WorkManager y evitar que una limpieza antigua cancele recordatorios recién creados. Si esa ampliación no se autoriza, mantener documentada la limitación; no afirmar atomicidad de la cancelación nativa.

**Respaldo:** mantener checkpoint, cierre, exportación y reapertura dentro del permiso exclusivo, incorporando exclusión nativa. La revisión y los CSV deben representar la misma base estable. Fallo de exportación no provoca reejecución financiera. La publicación completa de varios archivos en un proveedor documental es otra garantía; no se implementa como parte del rollback financiero.

## 3. Implementación incremental propuesta

Las fases son cambios revisables, sin modificación contable ni migración obligatoria. Una fase posterior no se activa antes de aceptar sus prerrequisitos. El runner no debe caer silenciosamente al flujo no atómico si falla.

### Fase 0 — Oráculos, inventario e inyección de fallos

- **Problema:** las pruebas actuales acreditan algunos estados parciales, pero no todas las posiciones de fallo.
- **Archivos:** `__tests__/helpers/realSQLite.ts`, `financialIntegrityFixture.ts`, `financialIntegrity.test.ts`; nuevas suites de coordinación/atomicidad; harness sintético Android existente.
- **Cambios:** añadir índice de sentencia y barreras controladas; distinguir fallo antes y después de cada SQL exitoso; snapshot completo ordenado de tablas afectadas/revisión y métricas. Mantener caracterizaciones actuales separadas hasta corregir cada flujo.
- **Riesgos:** un mock de callback puede representar mal el driver; una aserción solo del dashboard puede omitir filas inconsistentes.
- **Pruebas/aceptación:** reproducir los cuatro estados de §1.3, FK activas, `foreign_key_check` vacío, reloj fijo y ninguna apertura de `smartfin.db`. Inyección determinista, sin retrasos aleatorios.
- **Reversión:** retirar infraestructura de prueba no afecta persistencia ni datos de producción.

### Fase 1 — Dueño de conexión y runner reutilizable

- **Problema:** otros consumidores entran en el BEGIN exterior; proxies sin vigencia, cola no reentrante y rollback no verificado.
- **Archivos:** `src/database/{databaseCoordination,atomicSQLite,sqliteDatabase,index}.ts`; `src/navigation/AppNavigator.tsx` y consumidores de conexión; `executeAiCommandPlan.ts`, `subscriptionRuntime.ts` y fábricas de repositorios según inventario. Revisar lecturas compuestas de dashboard, `getCreditCardsOverview.ts`, `getDebitCardsOverview.ts` y sus hooks para agrupar su permiso de lectura.
- **Cambios:** conexión administrada, permiso explícito/prestado, generación y revocación del ámbito; runner con estados confirmado/revertido/desconocido. Adaptar los propietarios existentes y TODOS los accesos públicos a la conexión antes de añadir nuevos BEGIN exteriores. Mantener el generador síncrono standalone.
- **Riesgos:** deadlock si el dueño reencola sus SQL; callback `async` finalizado por el driver; cierre durante una operación; pérdida de orden de cola. No mantener permiso durante interacción humana ni llamada al modelo IA.
- **Pruebas:** dos comandos y lectura ajena con barreras; standalone frente a participante; no transacciones anidadas; proxy usado después del cierre; BEGIN/COMMIT/ROLLBACK fallidos; recuperación de conexión; piloto con driver Android y mismos casos.
- **Aceptación:** un dueño desde BEGIN hasta terminación; ninguna lectura/escritura JS ajena dentro; una pareja BEGIN/COMMIT en éxito; rollback verificable; bloqueo de conexión en incertidumbre; IA y suscripciones mantienen resultados y efectos.
- **Reversión:** cambio sin esquema; revertir el conjunto coordinador/consumidores como unidad. Si falla en producción, deshabilitar nuevas mutaciones afectadas hasta corregir, no habilitar un fallback parcial. El código revertido no repara ni deshace operaciones ya confirmadas.

### Fase 2 — Movimientos manuales, transferencias y acciones rápidas

- **Problema:** saldos confirmados sin movimientos, borrados incompletos y edición con snapshots antiguos.
- **Archivos:** `transactions/useCases/{saveManualTransaction,updateTransactionQuickly}.ts`, `transactions/repositories/sqliteTransactionRepository.ts`, `accounts/repositories/saveSqliteAccounts.ts`, `transactions/ui/TransactionsScreen.tsx` y sus llamadores. Bajo `src/modules/` salvo indicación contraria.
- **Cambios:** wrapper de operación exterior con repositorios participantes, lectura vigente y precondiciones; incluir cuenta especial, saldos, principal/acompañantes/impuesto, borrados, cuotas y reconciliaciones que el caso de uso ya invoca. UI publica únicamente resultado confirmado. Identidad estable para altas con protección previa al impacto, donde corresponda.
- **Riesgos:** aplicar acompañante dos veces; perder destino de pago; regenerar cuotas sin cambios; encolar lectura dentro del dueño; conflicto entre formulario antiguo y cuenta actual.
- **Pruebas:** fallo tras cada SQL de alta/edición/borrado; débito↔crédito; transferencias sin/con impuesto, cambio de destino y retirada de impuesto; pagos históricos editados/borrados; acciones rápidas repetidas; gasto conciliado antiguo, cuotas parcialmente pagadas, importes no finitos.
- **Aceptación:** primeros tres casos de §1.3 restauran snapshots completos; fallo del extracto en edición también restaura el pago anterior. Éxito equivale a las reglas corregidas anteriores, con IDs/FK/progreso y totales iguales. Verificar driver Android antes de liberar la fase.
- **Reversión:** sin cambios de esquema; revertir wrappers y llamadores juntos, preservando las correcciones de la auditoría. No eliminar esas correcciones al revertir atomicidad.

### Fase 3 — Pagos, reconciliación y gestión de tarjetas/cuentas

- **Problema:** débito sin pago, deuda y extractos divergentes; cuenta/perfil/asociación incompletos; validación de cierre obsoleta.
- **Archivos:** `creditCards/useCases/{creditCardTransactionRelations,manageCreditCards}.ts`, `creditCards/repositories/sqliteCreditCardRepository.ts`, `accounts/useCases/manageDebitCards.ts`, `creditCards/ui/CreditCardsScreen.tsx`, flujo de creación/asociación en `TransactionsScreen.tsx` y resolución SQLite de alertas.
- **Cambios:** una unidad para registrar pago, reconciliar, asociar o guardar tarjeta con las acciones ya agrupadas por su pantalla. Volver participantes los lotes de cuotas/extractos/perfiles; conservar transacción local si se invocan solos. Lecturas/validaciones de cierre dentro del dueño. Alertas SQLite dentro y efectos UI después.
- **Riesgos:** limitar por una deuda antigua; reducir el conjunto de tarjetas reconciliadas; modificar redondeos o filtros; referencias perdidas por REPLACE heredado; convertir metadatos de intereses en cargos nuevos.
- **Pruebas:** fallos por cada cuenta/extracto/cuota/perfil de lotes de varias tarjetas; pagos superiores a deuda, fondos insuficientes, compra pendiente/cancelada, asociación de cuotas existentes, cierre concurrente con pago.
- **Aceptación:** pago fallido restaura origen, deuda, movimientos y todos los extractos; reconciliación inválida no confirma parcialmente. Éxito conserva gasto una vez y patrimonio correspondiente. Comparar tarjetas no seleccionadas afectadas por la función actual; validar Android.
- **Reversión:** sin migraciones; devolver el conjunto de wrappers/repositorios a la versión anterior manteniendo la auditoría correctiva. No efectuar compensaciones para datos confirmados.

### Fase 4 — IA, borradores y suscripciones participantes

- **Problema:** confirmación perdida tras consumir el plan financieramente, borrador persistente que permite repetir; adquisición doble de cola; fallo nativo confundido con fallo financiero.
- **Archivos:** `transactions/useCases/executeAiCommandPlan.ts`, `transactions/repositories/sqliteAiDraftRepository.ts`, `transactions/hooks/useAiAssistantController.ts`; `subscriptions/useCases/{createSubscriptionApi,createSubscriptionInCommand}.ts`, `subscriptions/repositories/sqliteSubscriptionRepository.ts`, `subscriptions/services/subscriptionRuntime.ts`.
- **Cambios:** IA usa runner común; validar y consumir borrador esperado en el commit del lote; guardar borradores con límite local seguro. Separar dominio participante y sincronización posterior; conservar intenciones persistidas y acuses condicionales. No llamar API coordinada desde un dueño existente.
- **Riesgos:** borrar un borrador nuevo; confundir ausencia con comprobante de éxito; crear gasto al confirmar compromiso; programar antes de commit; reintentar el lote por fallo de refresco.
- **Pruebas:** fallo en cada acción y al consumir borrador; creación con referencias a cuentas/categorías previas en el lote; duplicación de claves; respuesta perdida tras commit; recordatorio fallido/permiso denegado; vínculo existente repetido y eliminación histórica; mantenimiento frente a IA.
- **Aceptación:** lote y consumo atómicos; fallo mantiene borrador ejecutable y base original; commit no se reaplica por error posterior; recordatorios fallidos mantienen solo entrega pendiente. Tests existentes de suscripción e IA y validación Android aprobados.
- **Reversión:** compatible con tablas actuales, aunque un borrador consumido ya no puede reconstruirse al revertir código. Revertir runner/hook/consumo juntos; no recrear automáticamente comandos ejecutados.

### Fase 5 — Ciclo de vida nativo, respaldo y borrado

- **Problema:** cierre/copia/borrado JS sin exclusión del receptor nativo; cancelación irreversible anterior al commit; entrega de notificación antes de persistir.
- **Archivos:** `src/navigation/` en los handlers de respaldo/cierre, `databaseCoordination.ts`, `sqliteDatabase.ts`; `settings/useCases/deleteFinancialData.ts`, `settings/repositories/sqliteFinancialDataRepository.ts`; módulos Android `SmartFinSubscriptionRemindersModule`, `SmartFinSubscriptionReminderReceiver`, `SmartFinDriveBackupModule` y recuperación de suscripciones.
- **Cambios:** permiso nativo de ciclo de vida prestado durante checkpoint/copia/CSV/reapertura y borrado; orden de bloqueos documentado. Intención durable de limpieza con IDs y recuperación posterior al borrado, solo si se autoriza la alternativa de §2.6. Diseñar entrega nativa posterior al commit como subfase separada.
- **Riesgos:** deadlock entre JS/receptor; alarmas no cancelables después de perder IDs; limpieza antigua sobre recordatorios nuevos; fallo al reabrir; crash entre commit y efecto; exportación parcialmente publicada.
- **Pruebas:** receptor activo durante respaldo/borrado; fallo de borrado tras cada DELETE; fallo/reinicio antes/después de cancelar cada ID; commit sin respuesta; fallo de checkpoint/copia/reapertura; revisión consistente de archivo y CSV. Instrumentación nativa imprescindible.
- **Aceptación:** rollback SQL conserva toda la base financiera; ningún efecto irreversible previo al commit del borrado; limpieza pendiente recuperable según el protocolo autorizado; archivo/CSV representan una revisión estable sin escritores nativos. Advertencia de entrega/exportación nunca induce repetir finanzas.
- **Reversión:** permiso nativo puede revertirse con sus llamadores; una intención persistida exige compatibilidad hasta agotarla. No retirar su recuperación con trabajos pendientes. No revertir cambios SQL de borrado ya confirmados mediante datos inventados.

Esta fase no bloquea demostrar rollback de los flujos manuales en bases sintéticas, pero sí bloquea afirmar seguridad integral de respaldo/borrado en Android. No incluirla silenciosamente en una corrección pequeña de saldo.

### Fase 6 — Referencias, lotes secundarios y aceptación global

- **Problema:** recategorizaciones parciales, lotes fuera de ámbito y posibles regresiones de consultas optimizadas.
- **Archivos:** `categories/repositories/sqliteCategoryRepository.ts` y subcategorías, casos de uso de categorías y recategorización en movimientos; `seedSmartFinDatabase.ts` y rutas de inicialización; suites financieras, de historial/dashboard, benchmarks y harness Android.
- **Cambios:** aplicar runner a comandos de reasignación y completar atomicidad local de lotes descubiertos; conservar límites de inicialización existentes hasta distinguir semillas de datos del usuario. Actualizar documentación/skill solamente con garantías verificadas durante implementación.
- **Riesgos:** ampliar innecesariamente el alcance a módulos futuros; borrar referencias por REPLACE; bloquear lectura durante todo el scroll; invalidar cachés o alterar orden de sumas.
- **Pruebas/aceptación:** reasignación conserva totales y referencias; FK, índices únicos, progreso y conciliación sin cambios. Jest completo, TypeScript y ESLint; equivalencia contra baselines de dashboard/historial; benchmarks de fases 1, 2, 3 y 3.1 bajo el mismo protocolo, con bloqueo breve medido y sin regresión funcional. Campaña Android global en bases aisladas.
- **Reversión:** cambios de lotes/reasignación independientes sin migración; mantener la infraestructura validada de propiedad. Revertir optimizaciones solo si fuese una decisión específica autorizada, no como respuesta automática a un problema de atomicidad.

## 4. Matriz de riesgos y compatibilidad

| Riesgo / requisito | Nivel | Tratamiento propuesto | Evidencia o límite |
|---|---|---|---|
| Saldo/deuda/extracto parcialmente confirmado | Crítico | Unidad exterior para todos los repositorios | Cuatro escenarios reproducidos; solución pendiente |
| SQL ajeno participa o lee cambios no confirmados | Crítico | Conexión administrada y dueño explícito, también para lecturas | Riesgo estructural observado; barreras de concurrencia pendientes |
| Doble impacto tras pérdida de respuesta | Crítico | Dedupe previa, precondiciones, consumo de borrador; detener resultado desconocido | No hay recibo durable universal |
| Fallo de rollback o conexión reutilizada cerrada | Alto | Revocación, generación y aislamiento de conexión no utilizable | No confirmado actualmente por el runner IA |
| Cola adquirida dentro de sí misma | Alto | Permiso prestado explícito y rutas internas sin adquisición | Prohibir composición accidental de APIs públicas |
| Conexión Android directa durante respaldo/borrado | Alto | Permiso nativo compartido y orden fijo de bloqueos | Cola JS no la cubre; requiere instrumentación |
| Efecto OS irreversible antes de commit | Alto | Intención persistida y entrega posterior separada | Notificación/cancelación no pueden compartir commit SQLite |
| Saldo o fila antiguos de pantalla | Alto | Lecturas vigentes y política explícita de conflicto | Serialización sola no resuelve una edición obsoleta |
| Referencias y cuotas perdidas | Alto | Conservar UPDATE+INSERT de padres, FK y oráculos de hijos | Atomicidad no corrige automáticamente REPLACE heredado |
| SQLite Android API 24 | Alto | BEGIN/COMMIT/ROLLBACK y SQL ya empleado; sin UPSERT moderno, RETURNING ni STRICT | Compatible por construcción; validación del driver pendiente |
| Callback del driver y tipo real de BEGIN | Alto | Generadores síncronos; runner exterior probado con driver instalado | Node no acredita semántica de puente Android |
| Revisión financiera/cachés/paginación | Medio-alto | Triggers intactos; invalidación posterior; permisos por lectura/página | Preservar fases de rendimiento anteriores |
| COP `number`/REAL, redondeos y orden | Medio-alto | Sin migrar representación ni reescribir cálculos | Errores numéricos existentes no se solucionan por atomicidad |
| Durabilidad frente a apagado o hardware | Alto | Verificar modo actual y recuperación; no cambiar PRAGMA en esta fase | SQLite depende de journal, filesystem y almacenamiento |
| Exportación de varios archivos | Medio-alto | Separar éxito financiero y resultado de exportación | No se promete publicación atómica del proveedor |

La inspección de `node_modules/react-native-sqlite-storage/lib/sqlite.core.js` muestra callbacks de transacción síncronos y tareas `executeSql` sin el límite completo de una operación financiera. En el `SQLitePlugin.java` instalado, Android reconoce BEGIN y utiliza `SQLiteDatabase.beginTransaction()`; COMMIT se traduce a `setTransactionSuccessful()` y `endTransaction()`. Por tanto, no inferir de la cadena `BEGIN IMMEDIATE` las mismas características de locking que Node ni aplicar ciegamente políticas de reintento de COMMIT del motor C al puente Android. No se modifica el driver ni su parche Gradle.

La durabilidad ante caída de proceso no se demuestra con una excepción en una base en memoria. Depende de configuración y almacenamiento; no se cambiarán journal ni synchronous sin una decisión independiente. [Commit atómico de SQLite](https://www.sqlite.org/atomiccommit.html).

## 5. Estrategia de pruebas

### 5.1 SQLite real en memoria: contrato de dominio y rollback

Usar `node:sqlite` con el helper existente, FK habilitadas, esquema/migraciones reales y reloj fijo. Una base nueva por escenario. No usar repositorios simulados como evidencia de rollback SQL.

Para cada operación exitosa, registrar su secuencia de sentencias; repetir desde el mismo fixture con fallo en cada posición:

1. Antes de BEGIN y antes de la primera escritura.
2. Después de cada INSERT/UPDATE/DELETE exitoso y antes de la siguiente sentencia o del COMMIT. Incluir UPDATE+INSERT condicionado aunque uno afecte cero filas, todos los miembros de lotes, borrados de hijos y persistencia de conciliaciones/intenciones.
3. Error SQL de restricciones, error de dominio y rechazo del adaptador; para el camino de callbacks, una sentencia SQL que realmente falle dentro del generador.
4. Antes de COMMIT; COMMIT que no se ejecuta; COMMIT que sí se ejecuta pero pierde su respuesta. Son casos distintos. Fallo de ROLLBACK y cierre no confirmado se prueban como incertidumbre, no como rollback aprobado.
5. Después de COMMIT en recordatorios, acuses, borrador/UI y refresco. Exigir resultado financiero confirmado y ningún reintento del cuerpo.

Los triggers forman parte de la misma sentencia: comprobar sus cambios y rollback, sin fingir un punto de fallo JavaScript dentro de un trigger. El helper actual inyecta fallos por SQL; habrá que añadir índices y hooks de sentencia exitosa para cubrir todos los puntos. En un camino standalone, no lanzar desde un callback sin asegurar que el driver aborta: usar el mecanismo de aborto existente y probarlo.

Tras un fallo revertido exigir igualdad exacta del snapshot inicial: cuentas y estados; movimientos principales/acompañantes/dedupe; cuotas/progreso/vencimiento; extractos/perfiles; splits y referencias; contratos/ocurrencias/vínculos; proyecciones/alertas/recordatorios; borrador si participa; revisión financiera. Comparar también disponible, deuda, patrimonio, ingresos/gastos/ahorro por periodos y totales por cuenta. `PRAGMA foreign_key_check` vacío y unicidades vigentes. No aceptar una nueva tolerancia monetaria para ocultar diferencias.

| Familia | Cobertura mínima propuesta |
|---|---|
| Manual | Ingreso y gasto; débito↔crédito; importe, origen, destino, fecha y medio históricos; cuotas iguales y cambiadas |
| Transferencia | Sin/con impuesto; cada acompañante; cambio de destino; reverso; borrado; repetir intención |
| Tarjetas | Compra, cuota, pago limitado, saldo insuficiente; pago con medio débito; edición/borrado; varias tarjetas y extractos |
| Suscripciones | Contrato sin gasto; confirmar vínculo existente; repetir vínculo; modificar/eliminar/incompatibilizar gasto antiguo; recuperación de intenciones |
| IA | Varias acciones con referencias; fallo de cada acción y consumo; claves repetidas; borrador cancelado o sustituido; respuesta perdida |
| Integridad | Reasignación de categoría; hijos de padres actualizados; cierre; borrado financiero con tablas relacionadas |
| Entradas | Infinity, -Infinity, NaN en cada ruta afectada; fechas/estados/decimales según reglas vigentes |
| Concurrencia | Dos pagos y fondos compartidos; edición frente a borrado; quick frente a formulario; IA frente a mantenimiento; lectura durante escritura; cierre/respaldo/borrado esperando unidad |

Controlar concurrencia con barreras entre sentencias y comprobar orden de ejecución, no solo resultado final. El helper síncrono de Node puede no mostrar las ventanas del puente; añadir escenarios que cedan explícitamente entre llamadas. Para varias conexiones/locks se requieren pruebas adicionales sobre un archivo sintético temporal; dos bases `:memory:` independientes no representan conexiones a la misma base.

### 5.2 Driver Android y bases sintéticas aisladas

Bloque de aceptación obligatorio antes de publicar cada fase financiera. Usar el driver y configuración instalados, API 24 y al menos una versión Android actual soportada; Hermes y build comparable al de las optimizaciones. Nombre de base exclusivo del harness o variante de aplicación de prueba. Los módulos Kotlin actuales fijan `smartfin.db`: antes de probarlos, habilitar una ruta SOLO de test o aplicación con sandbox aislado. No ejecutar receptor, respaldo ni borrado de pruebas contra la app/base real del usuario.

Repetir los casos principales y todas las posiciones de escritura mediante un adaptador de prueba que rechace antes/después de SQL confirmado o produzca un error SQL real, según el camino. Verificar scheduling de callbacks, ejecución entre tareas, ausencia de anidación, BEGIN/COMMIT/ROLLBACK efectivos, BUSY con conexión nativa, permiso de ciclo de vida y reapertura.

Con almacenamiento sintético en disco: finalizar el proceso antes de COMMIT y reabrir; finalizarlo después de COMMIT y antes de devolver respuesta; cortar durante recuperación/acuse. Comprobar que SQLite recupera estado anterior o estado completo, nunca un subconjunto. La terminación de proceso verifica recuperación del proceso, no equivale a un apagado físico. Para recordatorios, comprobar IDs, revisiones, cancelaciones y ausencia de duplicación financiera; la entrega OS conserva la limitación indicada en §2.6.

Para respaldo, intercalar receptor nativo y exportación con barreras; confirmar que archivo y CSV tienen la revisión declarada. Para borrado, verificar rollback SQL y que la limpieza posterior no interfiere con recordatorios nuevos. La campaña requiere artefactos y logs sintéticos sin datos reales.

### 5.3 Equivalencia y rendimiento preservado

Ejecutar Jest completo, `npx tsc --noEmit` y `npm run lint` tras implementación. Revisar suites de dashboard, historial, paginación y refinamiento contra sus baselines; conservar filtros, orden de suma, páginas de 50, cancelación y caché de revisión de hasta ocho entradas. Mantener las optimizaciones documentadas en `docs/performance/` para fases 1, 2, 3 y 3.1.

Los benchmarks omitidos en Jest no acreditan rendimiento. Repetir el protocolo sintético existente en Android y registrar duración de la unidad, tiempo de espera de lectura y respuesta de UI. Aceptar una coordinación necesaria para integridad no autoriza eliminar las optimizaciones ni cambiar reglas financieras. Si se detecta una regresión, reducir el tiempo dentro del permiso sin desplazar escrituras fuera del commit; cualquier optimización adicional se evalúa por separado.

## 6. Límites y decisiones para autorizar implementación

1. **Esta entrega no autoriza ni ejecuta implementación.** Se recomienda aprobar fases 0–3 primero, conservando la cobertura de todos los consumidores como condición de la fase 1. Las fases 4–6 completan garantías de comandos, ciclo de vida y referencias.
2. **Política de conflictos:** aprobar el rechazo de edición obsoleta y su presentación. No transformar un formulario antiguo en una nueva operación sin informar al usuario.
3. **Resultado desconocido:** aprobar detener reintentos automáticos y mostrar estado pendiente de verificación. Sin recibos durables no se puede prometer recuperación automática exactamente una vez para toda operación.
4. **Limpieza nativa de borrado:** autorizar el protocolo durable, su almacenamiento interno existente y el permiso nativo antes de implementarlos. No mover `cancelAll` aisladamente ni usar compensación como sustituto del rollback.
5. **Entrega nativa y respaldo:** autorizar la ampliación pequeña de coordinación Kotlin y su campaña de pruebas. La garantía financiera SQL no incluye reversión de notificaciones o publicación atómica de archivos externos.
6. **Esquema futuro:** si se exige un recibo general durable de comandos, preparar propuesta independiente de esquema/migración y retención. No es parte de las fases iniciales sin esquema y no se modifica nada aquí.
7. **Datos históricos:** ninguna de estas fases repara automáticamente una base que ya tenga saldos/extractos divergentes. Cualquier diagnóstico o reparación de datos reales requiere alcance y autorización propios.

El diseño conserva local-first, offline-first y privacy-first, las reglas financieras vigentes, las correcciones anteriores y el modelo de repositorios. La garantía verificable buscada es un estado financiero completo o el estado anterior completo por unidad SQL, más una política explícita para incertidumbre y efectos posteriores. Una promesa universal de revertir «cualquier fallo» después de un commit confirmado o de un efecto del sistema operativo no sería técnicamente correcta.

## Fuentes concretas revisadas

| Evidencia | Ubicación |
|---|---|
| Participación de generadores y transacción standalone | [atomicSQLite.ts](C:/Users/nesto/Proyectos/SmartFin/src/database/atomicSQLite.ts:14) |
| Cola de mantenimiento y exclusividad | [databaseCoordination.ts](C:/Users/nesto/Proyectos/SmartFin/src/database/databaseCoordination.ts:4) |
| Apertura/cierre compartidos | [sqliteDatabase.ts](C:/Users/nesto/Proyectos/SmartFin/src/database/sqliteDatabase.ts:27) |
| Commit por repositorio en el flujo manual | [saveManualTransaction.ts](C:/Users/nesto/Proyectos/SmartFin/src/modules/transactions/useCases/saveManualTransaction.ts:458) |
| Movimiento y conciliación dentro de un generador | [sqliteTransactionRepository.ts](C:/Users/nesto/Proyectos/SmartFin/src/modules/transactions/repositories/sqliteTransactionRepository.ts:157) |
| Reconciliación y pago separados | [creditCardTransactionRelations.ts](C:/Users/nesto/Proyectos/SmartFin/src/modules/creditCards/useCases/creditCardTransactionRelations.ts:308) |
| Mutación transaccional de suscripción | [sqliteSubscriptionRepository.ts](C:/Users/nesto/Proyectos/SmartFin/src/modules/subscriptions/repositories/sqliteSubscriptionRepository.ts:413) |
| Limpieza posterior del borrador IA | [useAiAssistantController.ts](C:/Users/nesto/Proyectos/SmartFin/src/modules/transactions/hooks/useAiAssistantController.ts:290) |
| Reasignación con varias escrituras | [sqliteCategoryRepository.ts](C:/Users/nesto/Proyectos/SmartFin/src/modules/categories/repositories/sqliteCategoryRepository.ts:32) |
| Cancelación nativa anterior al borrado | [deleteFinancialData.ts](C:/Users/nesto/Proyectos/SmartFin/src/modules/settings/useCases/deleteFinancialData.ts:8) |
| Otra conexión y transacción en receptor | [SmartFinSubscriptionReminderReceiver.kt](C:/Users/nesto/Proyectos/SmartFin/android/app/src/main/java/com/smartfin/SmartFinSubscriptionReminderReceiver.kt:24) |
| Apertura nativa directa | [SmartFinSubscriptionRemindersModule.kt](C:/Users/nesto/Proyectos/SmartFin/android/app/src/main/java/com/smartfin/SmartFinSubscriptionRemindersModule.kt:134) |
| Copia del archivo y exportación CSV | [SmartFinDriveBackupModule.kt](C:/Users/nesto/Proyectos/SmartFin/android/app/src/main/java/com/smartfin/SmartFinDriveBackupModule.kt:170) |
| Checkpoint/cierre/reapertura del respaldo | [AppNavigator.tsx](C:/Users/nesto/Proyectos/SmartFin/src/navigation/AppNavigator.tsx:297) |

Las rutas y líneas corresponden al checkout revisado en esta fecha, incluidas las correcciones de la auditoría todavía presentes en el árbol de trabajo.
