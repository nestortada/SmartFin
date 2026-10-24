# Base de datos de SmartFin

La fase 4 no añade tablas, columnas, índices ni migraciones. ai_command_drafts.phase
reserva internamente confirmed y plan_json conserva revisión local o comprobante
con el resumen financiero. Los contratos públicos siguen mostrando solo borradores
clarifying/review; guardar/cancelar activos preserva comprobantes. El mismo ID
confirmado no admite otro contenido y su consumo comparte commit con el plan.
La revisión del catálogo rechaza cambios desde generación; los borradores legados
sin evidencia necesitan verificación y una solicitud nueva. No hay idempotencia
universal entre IDs, restauraciones o versiones antiguas.
[Contrato y límites](atomicidad-financiera-fase4.md).

> Fechas y gastos compartidos actualizados: 11 de octubre de 2026 (migración 3).
> Condonaciones: migración 4; diario, recuperaciones y reversos en [Condonaciones compartidas](CONDONACIONES_COMPARTIDAS.md).
> Fuentes de verdad: `src/database/sqliteSchema.ts`, `src/database/sqliteDatabase.ts` y los repositorios `sqlite*Repository.ts` de cada modulo.

Documentos relacionados: [Arquitectura](ARQUITECTURA.md), [Módulos y flujos](MODULOS_Y_FLUJOS.md) y [Seguridad y privacidad](SEGURIDAD_Y_PRIVACIDAD.md).

## 1. Resumen ejecutivo

SmartFin usa una base de datos **SQLite local** llamada `smartfin.db`, mediante `react-native-sqlite-storage`. No existe un servidor, sincronizacion remota, telemetria ni una API de persistencia. En Android el usuario puede exportar manualmente una copia visible a una carpeta de Google Drive mediante el selector de documentos del sistema, sin API de Drive ni OAuth.

El esquema instalado contiene **39 tablas**, incluida la revisión financiera y el registro de migraciones. Las tablas compartidas administran contactos, gastos compartidos, cobros, aplicaciones, devoluciones, comandos y el diario de pérdidas (migración 4). Entre las tablas funcionales existentes están:

- `app_settings`
- `accounts`
- `categories`
- `merchant_mappings`
- `transactions`
- `credit_card_statements`
- `credit_card_profiles`
- `installment_purchases`
- `smart_alerts`

Las demas tablas dejan preparado el modelo para subcategorias, presupuestos, sobres, suscripciones, prestamos, metas, inversiones, recibos, impuestos, flujo de caja, salud financiera y respaldos. Que una tabla exista no significa que su modulo ya tenga repositorio o interfaz terminados.

## 2. Tecnologia y ubicacion

| Elemento | Implementacion |
|---|---|
| Motor | SQLite embebido en el dispositivo |
| Libreria | `react-native-sqlite-storage` `^6.0.1` |
| Archivo logico | `smartfin.db` |
| Ubicacion | `location: 'default'`, resuelta por la libreria para cada plataforma |
| Apertura | Una promesa compartida mantiene una sola conexion durante la vida de la app |
| Integridad referencial | `PRAGMA foreign_keys = ON` al aplicar el esquema |
| Fechas | Fecha civil `YYYY-MM-DD`; hora y zona opcionales, con instante ISO UTC cuando existe hora explícita; auditoría ISO |
| Moneda de dominio actual | `COP` |
| Importes | Libro existente: `REAL`; nuevo dominio compartido: centavos `INTEGER` seguros, sin migración monetaria global |
| Identificadores | `TEXT`, generados por la aplicacion |

Archivos principales:

| Archivo | Responsabilidad |
|---|---|
| `src/database/sqliteSchema.ts` | DDL de las tablas, claves foraneas e indices |
| `src/database/sqliteDatabase.ts` | Apertura, cierre, aplicacion del esquema y migraciones ligeras |
| `src/database/sqliteRows.ts` | Validacion y conversion segura de filas SQLite |
| `src/database/seedSmartFinDatabase.ts` | Carga de cuentas, categorias y transacciones mock; esta funcion existe pero el arranque normal usa su propio seed condicional |
| `src/navigation/AppNavigator.tsx` | Abre/cierra la conexion y ejecuta el seed inicial usado por la app |

## 3. Flujo de inicializacion

```mermaid
flowchart TD
    A[AppNavigator se monta] --> B[openSmartFinDatabase]
    B --> C[Abrir smartfin.db]
    C --> D[Activar foreign_keys]
    D --> E[CREATE TABLE/INDEX IF NOT EXISTS]
    E --> F[Migraciones ligeras]
    F --> G[Cargar app_settings]
    G --> H{Hay categorias?}
    H -- No --> I[Insertar categorias mock]
    H -- Si --> J{Hay cuentas?}
    I --> J
    J -- No --> K[Insertar cuentas mock]
    K --> L[Sembrar demo de tarjetas]
    J -- Si --> M[Base lista]
    L --> M
```

Detalles importantes:

1. El esquema se ejecuta cada vez que se abre la base mediante sentencias idempotentes `CREATE ... IF NOT EXISTS`.
2. Si no hay categorias, se cargan las categorias mock.
3. Si no hay cuentas, se cargan cuentas mock y datos demo de tarjetas. Despues de borrar datos financieros se recrean las cuentas con saldo cero y no se vuelve a cargar la demo de tarjetas.
4. La conexion se cierra al desmontar `AppNavigator`.

## 4. Modelo relacional

El siguiente diagrama muestra las relaciones declaradas. Las uniones punteadas representan referencias polimorficas guardadas como texto y no forzadas por una clave foranea.

```mermaid
erDiagram
    ACCOUNTS ||--o{ TRANSACTIONS : origen
    ACCOUNTS ||--o{ TRANSACTIONS : destino
    CATEGORIES ||--o{ TRANSACTIONS : clasifica
    SUBCATEGORIES ||--o{ TRANSACTIONS : detalla
    RAW_FINANCIAL_MESSAGES ||--o{ TRANSACTIONS : origina

    CATEGORIES ||--o{ SUBCATEGORIES : contiene
    CATEGORIES ||--o{ MERCHANT_MAPPINGS : asigna
    SUBCATEGORIES ||--o{ MERCHANT_MAPPINGS : asigna
    ACCOUNTS ||--o{ MERCHANT_MAPPINGS : asocia

    TRANSACTIONS ||--o{ TRANSACTION_SPLITS : divide
    CATEGORIES ||--o{ TRANSACTION_SPLITS : clasifica
    SUBCATEGORIES ||--o{ TRANSACTION_SPLITS : detalla
    ACCOUNTS ||--o{ ACCOUNT_BALANCE_HISTORY : registra

    CATEGORIES ||--o{ ENVELOPES : agrupa
    ENVELOPES ||--o{ ENVELOPE_MOVEMENTS : mueve
    TRANSACTIONS ||--o{ ENVELOPE_MOVEMENTS : respalda

    CATEGORIES ||--o{ RECURRING_SUBSCRIPTIONS : clasifica
    SUBCATEGORIES ||--o{ RECURRING_SUBSCRIPTIONS : detalla
    ACCOUNTS ||--o{ RECURRING_SUBSCRIPTIONS : cobra

    ACCOUNTS ||--o{ LOANS : representa
    LOANS ||--o{ AMORTIZATION_SCHEDULE_ITEMS : calendario
    TRANSACTIONS ||--o{ AMORTIZATION_SCHEDULE_ITEMS : paga

    ACCOUNTS ||--o{ CREDIT_CARD_STATEMENTS : genera
    ACCOUNTS ||--o| CREDIT_CARD_PROFILES : configura
    ACCOUNTS ||--o{ INSTALLMENT_PURCHASES : financia
    TRANSACTIONS ||--o{ INSTALLMENT_PURCHASES : origina

    ACCOUNTS ||--o{ FINANCIAL_GOALS : vincula
    ACCOUNTS ||--o{ INVESTMENT_ASSETS : contiene
    TRANSACTIONS ||--o{ RECEIPT_ATTACHMENTS : adjunta
    TRANSACTIONS ||--o{ TRANSACTION_TAX_TAGS : etiqueta
    TAX_TAGS ||--o{ TRANSACTION_TAX_TAGS : aplica
    ACCOUNTS ||--o{ CASH_FLOW_EVENTS : proyecta
```

## 5. Diccionario de tablas

### Configuracion y nucleo financiero

| Tabla | Proposito y campos principales | Relaciones | Uso actual |
|---|---|---|---|
| `app_settings` | Preferencias clave/valor: `setting_key` (PK), `setting_value`, `updated_at`. Guarda tema, biometria y credencial local. | Ninguna | Lectura y escritura |
| `accounts` | Cuentas y productos: nombre, tipo, estado, moneda, saldo, deuda, cupo, institucion y descripcion. `id` es PK. | Tabla padre de movimientos y varios productos | Lectura y escritura |
| `categories` | Categorias de ingreso/gasto/deuda/inversion/transferencia/ajuste. Guarda nombre, macro-categoria y color. | Padre de clasificaciones | Lectura, escritura y eliminacion con reasignacion |
| `subcategories` | Detalle por categoria, color, estado y auditoria. | `category_id -> categories.id` | Esquema preparado; mantenimiento al borrar categorias |
| `transactions` | Libro de movimientos: importe, moneda, descripcion, fecha, cuenta, categoria, tipo, direccion, estado, comercio, medio de pago, pista de tarjeta, clave de deduplicacion y notas. | Cuentas, categorias, subcategorias y mensaje de origen | Lectura, escritura, recategorizacion y eliminacion |
| `transaction_splits` | Participación personal y de terceros; importe en centavos, contacto, gasto compartido y estado activo. | Movimiento con `ON DELETE CASCADE`; gasto compartido y contacto | API de gastos compartidos; también conserva campos heredados |
| `merchant_mappings` | Regla aprendida comercio -> categoria/subcategoria/cuenta. Incluye patron, contador y ultima coincidencia. | Categorias, subcategorias y cuentas | Lectura y escritura parcial |
| `raw_financial_messages` | Tabla historica que conservaba mensajes automaticos y resultados del parser. Permanece en el esquema por compatibilidad con bases instaladas. | Puede ser padre de `transactions` | Sin escrituras ni lecturas desde la aplicacion |
| `account_balance_history` | Fotografias historicas de saldo y deuda por cuenta. | `account_id -> accounts.id` con `ON DELETE CASCADE` | Esquema preparado |

### Presupuestos, sobres y recurrencias

| Tabla | Proposito y campos principales | Relaciones | Uso actual |
|---|---|---|---|
| `budgets` | Presupuesto por alcance, importe, periodo, fechas y umbrales de alerta 50/80/90/100 %. | `scope_type` y `scope_id` son una referencia logica, no FK | Esquema preparado |
| `envelopes` | Sobre de ahorro/gasto con objetivo, saldo, prioridad y categoria. | `category_id -> categories.id` | Esquema preparado; mantenimiento al borrar categorias |
| `envelope_movements` | Entradas/salidas de un sobre, opcionalmente ligadas a una transaccion. | Sobre con `CASCADE`; transaccion sin accion de borrado declarada | Esquema preparado; se limpia al borrar transacciones |
| `recurring_subscriptions` | Regla contractual, importe, estado, cursor y recordatorios | Categoria, subcategoria y cuenta | API e interfaz nativa funcionales |

### Deudas y tarjetas de credito

| Tabla | Proposito y campos principales | Relaciones | Uso actual |
|---|---|---|---|
| `loans` | Prestamo: principal, saldo pendiente, tasa anual, plazo, cuota y fechas. | `account_id -> accounts.id` | Esquema preparado |
| `amortization_schedule_items` | Cuotas de un prestamo con capital, interes, saldo y estado. | Prestamo con `CASCADE`; transaccion opcional | Esquema preparado; se limpia al borrar transacciones |
| `credit_card_statements` | Extractos por tarjeta: periodo, vencimiento, total, pago minimo y estado. | `account_id -> accounts.id` con `ON DELETE CASCADE` | Lectura y escritura |
| `credit_card_profiles` | Configuracion financiera 1:1 de tarjeta; actualmente tasa de interes mensual. | PK/FK `account_id -> accounts.id` con `ON DELETE CASCADE` | Lectura y escritura |
| `installment_purchases` | Compra a cuotas: transaccion, tarjeta, total, numero de cuotas, pagadas, valor mensual y estado. | Transaccion con `CASCADE`; cuenta | Lectura, escritura y reasignacion |
| `smart_alerts` | Alertas tipadas con severidad, entidad relacionada, estado y fechas. | Referencia logica por tipo/id, no FK | Se usa para avisar tarjetas faltantes |

Los metadatos visuales de una tarjeta (`closingDay`, `paymentDay`, ultimos cuatro digitos y cuota de manejo) no tienen columnas propias. Se serializan como JSON dentro de `accounts.description`, con el prefijo `smartfin:credit-card:`.

La fase 3B conserva este esquema y los métodos de escritura existentes. La gestión
compuesta utiliza repositorios participantes de un único `runSharedSQLiteTransaction`:
cuenta/perfil, compras asociadas, referencias de cuotas, reconciliación, extractos y
alertas se confirman juntos cuando pertenecen a la misma acción. El cierre conserva
historial y comparte commit con la reconciliación previa de la pantalla. Un ROLLBACK
confirmado debe conservar todas las filas y la revisión, incluidos los triggers.

La asociación consulta todo el historial `account_id=por clasificar/payment_method=credit`
en el orden anterior, sin cargar movimientos ajenos ni limitarse a una página. Conserva
la decisión final de coincidencia en el dominio. La reconciliación mantiene la consulta
optimizada de fase 3A.1 y sus sumas JS. El pago exige un importe efectivo entero seguro
positivo después del redondeo y el límite por deuda: rechaza $0,40 y límites fraccionarios
inválidos, sin migrar ni corregir datos históricos. [Informe de fase 3B](atomicidad-financiera-fase3b.md).

### Metas, inversiones y documentos

| Tabla | Proposito y campos principales | Relaciones | Uso actual |
|---|---|---|---|
| `financial_goals` | Meta, objetivo, avance, fecha, prioridad y estado. | Cuenta vinculada opcional | Esquema preparado |
| `investment_assets` | Activo, tipo, cantidad, precios, moneda, plataforma y fecha de compra. | Cuenta opcional | Esquema preparado |
| `receipt_attachments` | URI local del recibo, datos extraidos y texto OCR. | Transaccion; `ON DELETE SET NULL` | Esquema preparado; se elimina manualmente al borrar transacciones |
| `tax_tags` | Etiquetas fiscales configurables. | Padre de la tabla puente | Esquema preparado |
| `transaction_tax_tags` | Relacion N:M entre transacciones y etiquetas fiscales. | Ambas FK con `ON DELETE CASCADE` | Esquema preparado |
| `cash_flow_events` | Evento proyectado con fecha y entidad de origen | Cuenta opcional; origen polimorfico sin FK | Proyecciones de suscripciones; sin impacto en saldo |
| `financial_health_scores` | Puntaje total y componentes de ahorro, deuda, emergencia, credito, metas y gasto variable. | Ninguna | Esquema preparado |
| `backup_records` | Registro de respaldo local: URI, cifrado, estado, fechas y error. | Ninguna | Esquema preparado |
| `financial_data_revision` | Contador interno que aumenta mediante triggers cuando cambia una tabla financiera. | Ninguna | Deteccion de respaldos desactualizados |

## 6. Respaldo visible en Google Drive (Android)

La integracion usa Storage Access Framework de Android. La primera vez, el usuario pulsa **Elegir carpeta** y selecciona o crea una carpeta dentro de Google Drive. Android conserva el permiso para esa carpeta; SmartFin no recibe credenciales de Google y no usa una API remota.

Cada actualizacion genera o reemplaza:

- `smartfin-backup.db`: copia completa y sin cifrar de SQLite;
- `movimientos-AAAA.csv`: un archivo por cada año con movimientos, cuenta, categoria, comercio, medio de pago y fechas;
- `cuentas.csv`, `categorias.csv`, `subcategorias.csv`, `tarjetas-credito.csv` y `compras-cuotas.csv`;
- `smartfin-manifest.json`: revision, fecha, lista de archivos y declaracion `encrypted: false`.

Los CSV usan UTF-8 con BOM, encabezados estables y escapado compatible con RFC 4180. Esto facilita abrirlos en Excel o analizarlos desde herramientas con acceso autorizado a Drive. Los importes se exportan como valores numericos y las fechas conservan su representacion ISO.

Antes de copiar la base, la aplicacion ejecuta un checkpoint de WAL y cierra SQLite. Luego vuelve a abrirla. El contador `financial_data_revision` aumenta con triggers para inserciones, actualizaciones y eliminaciones en las tablas financieras. Si la revision local supera la del manifiesto de Drive, se muestra un aviso dentro de SmartFin con la opcion **Actualizar ahora**. No se solicitan permisos para leer notificaciones del sistema.

La actualizacion es iniciada por el usuario. El estado **al dia** significa que SmartFin escribio los archivos y pudo volver a leer el manifiesto mediante el proveedor de documentos. No confirma que la transferencia a los servidores de Google haya terminado. Sin API de Drive, Android y el proveedor controlan la subida real a la nube; el usuario debe comprobar **Carga completa** en la aplicacion de Google Drive o verificar que los archivos aparezcan en `drive.google.com` desde otro dispositivo.

SmartFin intenta conservar el permiso de lectura/escritura entre reinicios. Si un proveedor solo concede acceso temporal, el respaldo actual se completa y Ajustes muestra una advertencia. Si Android pierde posteriormente el acceso, SmartFin elimina la referencia vencida y solicita seleccionar de nuevo la misma carpeta.

La capacidad de escritura se confirma intentando crear o reemplazar los archivos del respaldo. No se usa `FLAG_DIR_SUPPORTS_CREATE` como bloqueo previo porque algunos proveedores de documentos en la nube no anuncian ese indicador de manera consistente aunque acepten escrituras.

> Privacidad: estos archivos no estan cifrados. Cualquier persona, aplicacion o servicio de IA con acceso a la carpeta podra leer la informacion financiera.

## 7. Valores de dominio implementados

SQLite almacena estos valores como `TEXT`; las restricciones se expresan en TypeScript, no mediante `CHECK` en la base.

| Concepto | Valores actuales |
|---|---|
| Tipo de cuenta | `cash`, `bankAccount`, `savingsAccount`, `creditCard`, `loan`, `investment` |
| Estado de cuenta | `active`, `inactive`, `closed` |
| Tipo de transaccion | `income`, `expense`, `internalTransfer`, `creditCardPayment`, `loanPayment`, `investment`, `refund`, `manualAdjustment` |
| Direccion | `inflow`, `outflow`, `neutral` |
| Estado de transaccion | `posted`, `pending`, `cancelled` |
| Medio de pago | `debit`, `credit` |
| Tipo de categoria | `income`, `expense`, `debt`, `investment`, `transfer`, `adjustment` |
| Moneda | `COP` |
| Estado de extracto | `open`, `pending`, `paid`, `overdue`, `closed` |
| Estado de compra a cuotas | `active`, `paid`, `cancelled` |

## 8. Repositorios y operaciones disponibles

La interfaz de usuario recibe la conexion y crea repositorios por modulo. Los repositorios convierten filas SQLite a tipos de dominio; las pantallas no ejecutan SQL directamente.

| Repositorio/servicio | Operaciones principales |
|---|---|
| `sqliteAccountRepository` | Listar cuentas; guardar una coleccion de cuentas |
| `sqliteCategoryRepository` | Listar/guardar categorias; borrar una categoria reasignando referencias |
| `sqliteTransactionRepository` | Listar/guardar/borrar; consultar proyecciones de importes por periodo y conteos diarios; actualizar categorias; guardar/consultar reglas de comercio; borrar compras a cuotas relacionadas |
| `sqliteCreditCardRepository` | Listar y cerrar tarjetas; guardar tarjetas, extractos, perfiles y compras a cuotas; reasignar compras |
| `sqliteCreditCardAlertRepository` | Consultar, crear y resolver alertas de tarjeta faltante |
| `sqliteSettingsRepository` | Cargar y guardar preferencias |
| `sqliteFinancialDataRepository` | Vaciar todas las tablas financieras conservando `app_settings` |

Los mocks de cuentas, categorias y transacciones implementan contratos equivalentes para pruebas y datos iniciales.

## 9. Captura automatica retirada

SmartFin ya no solicita permisos de SMS ni acceso al lector de notificaciones del sistema. Se retiraron:

- los permisos Android `READ_SMS` y `RECEIVE_SMS`;
- el `BroadcastReceiver` de SMS;
- el `NotificationListenerService`;
- el modulo nativo que solicitaba permisos y emitia eventos a React Native;
- el parser, el servicio de ingestion y la creacion automatica de transacciones;
- el onboarding y los controles de ajustes relacionados.

Los movimientos se registran mediante los flujos manuales de la aplicacion. Las alertas internas de SmartFin, como una tarjeta pendiente de configurar, se conservan porque no acceden a SMS ni a notificaciones de otras aplicaciones.

`raw_financial_messages`, `transactions.source_message_id` y `transactions.dedupe_key` permanecen como elementos de compatibilidad del esquema. No se usan para capturar nuevos datos y evitan una reconstruccion destructiva de bases SQLite existentes.

## 10. Migraciones e indices

El arranque aplica DDL idempotente y migraciones versionadas en `schema_migrations`. La versión 1 verifica las columnas heredadas de movimientos y borradores mediante PRAGMA table_info; la versión 2 añade anclaje, recurrencia personalizada, cursor y recordatorios a recurring_subscriptions, junto con las tablas subscription_occurrences y subscription_reminders. El registro de versión y los cambios se confirman en una transacción. Los errores reales ya no se ignoran. No se reconstruyen ni borran tablas existentes.

Indices definidos:

- busqueda de transacciones por fecha, cuenta, categoria, subcategoria y mensaje fuente;
- unicidad de subcategoria por categoria/nombre;
- busqueda de reglas por texto crudo;
- mensajes por fecha de recepcion;
- historico de saldos por cuenta/fecha;
- presupuestos por alcance;
- movimientos por sobre;
- suscripciones por proximo cobro;
- prestamos por cuenta y cuota unica por prestamo/numero;
- extractos por cuenta/vencimiento;
- perfiles y compras a cuotas por cuenta;
- metas por estado, inversiones por cuenta y recibos por transaccion;
- flujo de caja por fecha, alertas por estado y puntajes por fecha.

## 11. Borrado de datos

La opcion de borrar datos financieros:

1. espera mantenimiento activo y cancela recordatorios de suscripciones;
2. ejecuta DELETE sobre las tablas financieras en orden dentro de una transacción;
3. mantiene claves foráneas habilitadas y revierte el lote si falla;
4. conserva app_settings, schema_migrations y el contador de revisión;
5. no recrea movimientos ni suscripciones automáticamente.

No elimina el archivo `smartfin.db`. Tampoco ejecuta `VACUUM`, por lo que SQLite puede conservar espacio interno reutilizable aunque las filas ya no sean consultables por la aplicacion.

## 12. Privacidad y seguridad

- La arquitectura es local-first y offline-first.
- No hay llamadas propias de red ni una API de SmartFin para persistir datos. En Android, Google Drive puede sincronizar los archivos elegidos mediante su proveedor de documentos.
- Los recibos y respaldos se modelan mediante URI local.
- La aplicacion no solicita acceso a SMS ni a las notificaciones del sistema.
- La biometria y la credencial local controlan acceso a la aplicacion, pero **el codigo revisado no configura cifrado de la base SQLite**.
- El respaldo visible en Drive se implementa sin cifrado por decision del usuario; `backup_records` sigue sin utilizarse como historial funcional.
- Instalaciones que usaron versiones anteriores pueden conservar filas historicas en `raw_financial_messages` hasta que el usuario borre sus datos financieros.

Por tanto, la proteccion del archivo depende actualmente del almacenamiento y las medidas de seguridad del sistema operativo. Para datos reales conviene evaluar cifrado en reposo, politica de retencion de mensajes crudos y ocultamiento de datos sensibles en logs.

## 13. Riesgos y deuda tecnica observada

Prioridad alta:

1. **Migraciones:** ahora versionadas y atómicas para las versiones 1 y 2; los cambios futuros deben mantener ese patrón.
2. **`INSERT OR REPLACE`:** cuentas y movimientos ahora conservan sus filas mediante UPDATE e INSERT condicionado en una transacción; revisar los demás usos heredados. En SQLite REPLACE puede eliminar la fila en conflicto antes de insertarla. En tablas padre como `accounts` o `transactions` esto puede activar acciones `ON DELETE` y perder filas hijas. La implementación usa UPDATE e INSERT WHERE NOT EXISTS para admitir también el SQLite del Android mínimo (API 24), sin depender de la sintaxis moderna ON CONFLICT DO UPDATE.
3. **Importes en `REAL`:** el punto flotante puede introducir errores de redondeo. Para contabilidad se recomienda guardar unidades menores enteras (centavos) o una representacion decimal controlada.
4. **Escrituras por lote sin transaccion:** los bucles de guardado y el borrado total pueden quedar aplicados parcialmente si una sentencia falla.
5. **Base sin cifrado explicito:** contiene saldos y movimientos; instalaciones actualizadas tambien pueden conservar mensajes financieros historicos.

Prioridad media:

6. Los estados y tipos no tienen restricciones `CHECK`; una escritura fuera de TypeScript puede introducir valores invalidos.
7. La FK `transactions.source_message_id` y la tabla `raw_financial_messages` son compatibilidad historica sin uso funcional.
8. Algunas eliminaciones se resuelven manualmente aunque el esquema tenga acciones FK distintas; por ejemplo, los recibos se borran en vez de conservarse con `transaction_id = NULL`.
9. Los metadatos visuales de tarjeta se almacenan como JSON en `accounts.description`; esto dificulta validarlos, consultarlos e indexarlos.
10. El seed de arranque esta duplicado respecto de `seedSmartFinDatabase`, lo que puede hacer que ambos flujos diverjan.
11. Varias tablas anticipadas aun no tienen repositorio, caso de uso ni pruebas funcionales.

## 14. Recomendaciones de evolucion

Orden sugerido:

1. Introducir migraciones numeradas y atomicas usando `PRAGMA user_version` o una tabla `schema_migrations`.
2. Sustituir `INSERT OR REPLACE` por UPSERT y envolver operaciones de lote en transacciones SQLite.
3. Definir una estrategia monetaria unica basada en enteros de unidad menor.
4. Añadir cifrado en reposo o documentar formalmente el modelo de seguridad aceptado.
5. Planificar una migracion versionada si se decide eliminar definitivamente las columnas y tablas historicas de captura automatica.
6. Separar los metadatos de tarjeta en columnas o en una tabla 1:1 tipada.
7. Crear repositorios por modulo a medida que se habiliten presupuestos, prestamos, metas y demas funciones; no acceder a SQLite desde las pantallas.
8. Añadir pruebas de migracion desde bases antiguas, integridad FK, borrado total y persistencia tras reinicio.

## 15. Guia para cambios futuros

Al modificar la persistencia:

1. Actualizar el esquema para instalaciones nuevas.
2. Añadir una migracion versionada para instalaciones existentes.
3. Mantener el SQL dentro de `repositories`, `services` o adaptadores de `src/database`.
4. Actualizar los tipos de dominio y los validadores de filas.
5. Añadir indices solo a partir de consultas reales y comprobar su plan de ejecucion.
6. Ejecutar pruebas y `tsc --noEmit`.
7. Actualizar este documento, especialmente el estado de uso de cada tabla.

## Persistencia de Suscripciones

- `subscription_occurrences`: ID, suscripción, fecha/importe esperado, importe real nullable, cuenta esperada, estado, movimiento nullable, fecha de pago/salto, motivo y notas. UNIQUE(subscription_id, expected_date), FK de suscripción CASCADE y FK de movimiento conservada hasta desvinculación explícita. Índice único parcial de transaction_id e índice status/expected_date.
- `subscription_reminders`: intención de plataforma, offset, revisión, fecha UTC programada, contenido, revisión aplicada, estado de entrega y error recuperable. UNIQUE(occurrence_id, offset_days), FK CASCADE e índice de entrega/intención.
- `schema_migrations`: versión aplicada y fecha, preservada durante el borrado financiero.
- Las nuevas tablas tienen triggers de revisión del respaldo. La copia SQLite completa contiene sus datos; no se añadieron exportaciones CSV específicas.
- Mutaciones de suscripciones y cambios de movimientos vinculados son transaccionales. Guardar un pago actualiza importe real; eliminar/incompatibilizar un movimiento desvincula antes de borrarlo. No existe gasto automático por vencimiento.

El esquema actual incorpora borradores de IA y las tres tablas anteriores. [Modelo, API y límites monetarios](SUSCRIPCIONES.md).

La interfaz no requiere migraciones adicionales. Las consultas tipadas incorporan opciones de cuentas/categorías/subcategorías, vencidos paginados y candidatos compatibles de pago. Los candidatos excluyen gastos ya vinculados; las sugerencias usan ±7 días y la búsqueda manual permite otras fechas. Las mismas reglas de confirmación se vuelven a validar dentro de la transacción.

## Consultas del dashboard: optimización de fase 2

Estas secciones describen las fases originales. La migración 3 incorpora
`idx_transactions_civil_day` y `idx_transactions_civil_sort`: las consultas
actuales usan fecha civil y proyectan el consumo personal. El patrimonio lee
también cuentas por cobrar y anticipos. El detalle vigente está en
[Gastos compartidos y fechas](GASTOS_COMPARTIDOS_Y_FECHAS.md).

La posición financiera del dashboard usa una única consulta agregada en
`sharedFinancialTotalsSql.ts`. Agrupa aplicaciones por `participation_key` y
participaciones, cobros y devoluciones por contacto antes de combinar sus
totales. Filtra estados activos sin limitar registros. Los resultados enteros
se devuelven como texto decimal para validar el rango seguro en TypeScript.
Se aprovechan las claves e índices existentes de la migración 3; no se añade
otra migración, índice, tabla ni proyección persistente. `getState()` permanece
para comandos y consultas de detalle. El dashboard hace cuatro lecturas en
lugar de nueve, conservando las consultas mensuales/civiles de movimientos.

El dashboard ya no carga todos los movimientos mediante `getTransactions`. El repositorio de transacciones incorpora `getTransactionAmounts` (proyección mensual de importe/tipo/dirección, con filtros de fecha, estado y operaciones) y `getTransactionCountsByDay` (`COUNT(*)` agrupado por prefijo de día dentro de un rango). Ambos aprovechan `idx_transactions_date`; no se añadió esquema ni migración.

El caso de uso conserva las sumas JavaScript y su orden para evitar cambios de precisión en importes `REAL`, las reglas de ingresos/gastos y el intervalo reciente de 30 × 24 horas con fechas locales. Saldos, deuda y patrimonio siguen leyendo cuentas persistidas. `getTransactions` y sus demás consumidores permanecen intactos.

[Análisis, comparación funcional, mediciones reproducibles y limitaciones](performance/dashboard-phase2.md).

## Historial de movimientos: fase 3

`getTransactionPage(query, cursor?, isCancelled?)` añade lectura paginada al repositorio existente; `getTransactions()` permanece intacto. No hay migraciones, nuevos índices ni dependencias. `getTransactionMonths()` devuelve todos los prefijos de mes disponibles, sin depender de las páginas visibles.

Mes (prefijo literal), cuenta (transferencias internas solo por cuenta propia; otros tipos también por contracuenta) y categoría se filtran en SQL. La búsqueda conserva `toLowerCase().includes()` de JavaScript, incluidos Unicode, espacios y `%`/`_` literales, leyendo proyecciones en lotes de 200 hasta completar 50 coincidencias o agotar el historial. No se impone un límite total a la búsqueda.

Fechas UTC canónicas homogéneas usan cursor de fecha, `created_at DESC` y `rowid DESC`, con rango sobre `idx_transactions_date`; se lee una fila de anticipación. El desempate conserva el recorrido descendente del índice de la consulta anterior. La revisión de `financial_data_revision` se comprueba antes y después de cada página; cualquier escritura obliga a reiniciar toda la generación.

Para offsets, precisión mixta, fechas locales o inválidas, el orden textual no equivale a `Date` de JavaScript. La ruta de compatibilidad filtra una proyección por lotes, conserva solo ID/fecha, aplica el comparador estable anterior y después materializa páginas por ID. Esto mantiene resultados incluso con `NaN` y fechas normalizadas, pero requiere trabajo y memoria proporcionales al número de candidatos en esa ruta. Se documenta expresamente; no se omiten registros. [Evidencia y reproducción](performance/transactions-phase3.md).

En fase 3.1 el prefiltro ASCII utiliza `INSTR(LOWER(campo), ?) OR LENGTH(CAST(campo AS BLOB)) <> LENGTH(campo)`. La desigualdad deja pasar Unicode y NUL para que JavaScript conserve la decisión final; elimina el escaneo `GLOB` por carácter del prefiltro anterior. No hay cambios de esquema, índices o reglas financieras. Una comprobación positiva de fechas canónicas en todo el historial puede reutilizarse en cualquier subconjunto de la misma revisión; una negativa exige comprobar cada filtro. Cada página, incluso un vacío reutilizado, sigue verificando la revisión antes y después. Las comprobaciones se publican únicamente tras completar una consulta sin cancelación ni escrituras concurrentes. [Validación y evidencia de fase 3.1](performance/transactions-phase31.md).

## Captura SQLite local, fase 5B.1

La captura privada coordina la conexión administrada y las fábricas Kotlin en el
mismo proceso. Conserva el driver/esquema y todas las tablas, incluidos comprobantes
IA, compartidos, cuotas, suscripciones, historial de saldos y metadatos. Requiere
checkpoint WAL TRUNCATE con resultado completo, cierre confirmado y ausencia de
participantes antes de la copia. Rechaza modos OFF/MEMORY o resultados inciertos.
No elimina manualmente WAL/journal ni interpreta una revisión como checksum.

El archivo nuevo se escribe/sincroniza en `noBackupFilesDir`, con identidad UUID
privada; se abre READONLY, configura/verifica FK, comprueba integridad, esquema,
conteos y revisión y compara SHA-256 de los bytes leídos del origen con la copia.
PERSIST/TRUNCATE son modos de conexión; una apertura RO puede observar DELETE.
Las conexiones RO usan un PRAGMA FK explícito porque Android omite ese ajuste de
configuración en ellas. La limpieza de un temporal propio deja que SQLite cierre
sus auxiliares, sin desvincular manualmente WAL/SHM del archivo financiero.

No hay migración, restauración o política nueva de retención/publicación externa.
Un temporal abandonado no se descubre como respaldo válido ni se publica al
reiniciar. La reapertura no convierte un COMMIT sin respuesta en rollback.
[Protocolo, resultados y límites](atomicidad-financiera-fase5b1.md).

## Publicación verificable, fase 5B.2

La publicación nueva consume exclusivamente esa captura privada y no modifica
el esquema financiero. Los trabajos se conservan en archivos privados `AtomicFile`;
`backup_records` sigue sin funcionar como su historial. Los nombres fijos descritos
en la sección histórica de Drive quedan intactos y no se actualizan. Nuevos archivos
`smartfin-<UUID>--<nombre>` y manifiestos `smartfin-generation-<UUID>.json` se añaden
a la carpeta. El formato v2 distingue identidad, revisión financiera y SHA-256 de
cada componente. Solo una relectura íntegra permite seleccionar una generación.
El filtro CSV de tarjetas usa ahora el valor persistido `creditCard`.
La activación de UI está pendiente del acuerdo de lectores/latencia; la
sincronización remota del proveedor no está certificada.
[Contrato y recuperación](atomicidad-financiera-fase5b2.md).
