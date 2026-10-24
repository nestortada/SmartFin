# Suscripciones: interfaz nativa, dominio y API local

La [fase 4 de atomicidad](atomicidad-financiera-fase4.md) conserva las mutaciones
transaccionales del repositorio y su participación exterior. Crear categoría o
subcategoría desde la fachada comparte commit con la sincronización derivada.
IA confirma el plan y su comprobante durable juntos; la pasada final acotada de
generación se completa antes del commit y los recordatorios se programan después.
No se crean gastos por generar compromisos u obligaciones.

Inicio, reanudación, montaje y Headless consolidan mantenimiento concurrente, con
un permiso por lote y hasta veinte lotes. Una revisión antes de terminar detecta
escritores intercalados. Los recordatorios se recuperan al finalizar; solo se omite
una cancelación ya confirmada en su misma revisión. La programación se vuelve a
solicitar para recuperar reinicios. Fallar plataforma conserva éxito financiero e
intención persistida para reintento. Los módulos Kotlin y el esquema no cambian.

Dominio e interfaz implementados el 3 de octubre de 2026. Acceso: Más → Suscripciones.

## Uso de la fachada pública

```ts
import { getSubscriptionApi } from '../modules/subscriptions';

const subscriptions = await getSubscriptionApi();
// Solicitar únicamente desde una acción explícita en primer plano.
await subscriptions.requestReminderPermission();
const { value: netflix, sync } = await subscriptions.createSubscription({
  name: 'Netflix',
  amount: 38900,
  recurrence: { periodicity: 'monthly' },
  anchorDate: '2026-10-15',
  accountId: existingAccountId,
  categoryId: existingExpenseCategoryId,
});
const next = await subscriptions.getNextSubscriptionCharge();
await subscriptions.confirmSubscriptionPayment({
  occurrenceId: next!.id,
  transactionId: existingPostedExpenseId,
});
```

Los identificadores de cuenta, categoría y movimiento deben existir. Crear una
suscripción o conciliar un gasto existente nunca cambia saldos ni deuda. Registrar
el movimiento real sigue siendo responsabilidad de Movimientos.

Las mutaciones devuelven `{ value, sync }`: `value` es el resultado financiero ya
confirmado en SQLite y `sync` informa disponibilidad, errores recuperables de
recordatorios, configuraciones heredadas inválidas y atrasos por procesar.
Un fallo de plataforma después del commit no invalida la suscripción guardada.

## API pública

| Operación | Entrada / resultado |
|---|---|
| `getSubscriptionApi()` | Fachada local; coordina sus operaciones con mantenimiento, respaldo y cierre |
| `createSubscription(input)` | Nombre, importe, recurrencia, fecha contractual y referencias opcionales |
| `updateSubscription(id, changes)` | Cambios descriptivos o de programación; estado mediante operaciones separadas |
| `pauseSubscription`, `resumeSubscription`, `cancelSubscription` | Identificador; cancelación definitiva, sin eliminación física |
| `getSubscriptions({ status? })`, `getActiveSubscriptions()` | Suscripciones válidas; configuraciones inválidas mediante diagnósticos |
| `getSubscriptionById(id)` | Suscripción o `undefined`; error si su configuración heredada es inválida |
| `getSubscriptionHistory(id, { limit?, offset? })` | Cobros y movimiento vinculado, más recientes primero; máximo 500 por página |
| `getUpcomingSubscriptionCharges({ from, to })` | Pendientes en rango civil inclusivo |
| `getOverdueSubscriptionCharges({ limit?, offset? })` | Vencidos paginados; el detalle usa páginas de 50 |
| `getSubscriptionFormOptions()` | Referencias existentes para el formulario; selección de cuentas activas COP compatibles |
| `getSubscriptionPaymentCandidates({ occurrenceId, query?, suggestedOnly?, limit?, offset? })` | Gastos compatibles no vinculados; sugerencias ±7 días o búsqueda manual |
| `getNextSubscriptionCharge()` | Próximo pendiente desde hoy, o `undefined` |
| `getSubscriptionSummary({ from, to }?)` | Activas, equivalentes mensual/anual, próximo cobro, próximos y vencidos |
| `getMonthlySubscriptionCommitment()`, `getAnnualSubscriptionCommitment()` | Equivalentes de suscripciones activas |
| `confirmSubscriptionPayment({ occurrenceId, transactionId })` | Vincula un gasto real confirmado compatible, sin crearlo de nuevo |
| `skipSubscriptionOccurrence(id, notes?)` | Salta pendiente/vencido sin crear movimiento |
| `findSubscriptionMatches(transactionId)` | Sugerencias ordenadas con puntuación y motivos; nunca concilia |
| `syncSubscriptions()` | Generación, vencimientos, proyecciones, alertas y recordatorios |
| `ensureUpcomingSubscriptionOccurrences`, `markOverdueOccurrences`, `syncSubscriptionCashFlow`, `syncSubscriptionAlerts` | Alias del mantenimiento integral para mantener todas las entidades coherentes |
| `syncSubscriptionReminders()` | Recupera únicamente los efectos de plataforma persistidos |
| `getReminderStatus()`, `requestReminderPermission()` | Disponibilidad y permiso; la segunda operación requiere primer plano |
| `getSubscriptionDiagnostics()` | Configuraciones inválidas conservadas para su revisión |
| `createSubscriptionApi(dependencies)` | Construcción inyectable con contrato de repositorio, servicio, reloj y generador de IDs |
| `calculateNextSubscriptionDate(anchor, recurrence, billingDay, after)` | Cálculo puro del siguiente vencimiento contractual |

## Recurrencias y dinero

Recurrencias tipadas: `weekly`, `biweekly` (14 días), `monthly`, `bimonthly`,
`quarterly`, `semiannual`, `yearly` y `{ periodicity: 'custom', interval, unit }`,
donde `unit` es `days`, `weeks` o `months` e `interval` es entero positivo.

Las fechas de cobro son civiles `YYYY-MM-DD`; las marcas de auditoría son ISO UTC.
El día contractual se conserva: 31 de enero → 28/29 de febrero → 31 de marzo.
El calendario local del teléfono define hoy y la hora del recordatorio. Cambiar
zona horaria reprograma avisos sin cambiar fechas ni pagos históricos.

El equivalente anual usa `12 / meses` para intervalos mensuales y
`365.2425 / días` para diarios/semanales. El equivalente mensual divide la suma
anual sin redondear entre 12. Ambos resultados se redondean a dos decimales.
No equivalen al gasto real de un mes específico. Se conserva la limitación
heredada de dinero con JS/SQLite REAL; el redondeo se centraliza y rechaza valores
no finitos o inseguros. No se ha migrado el resto de SmartFin a unidades enteras.

## Historial y estados

- Suscripción: `active`, `paused`, `cancelled`.
- Cobro: `pending`, `overdue`, `paid`, `skipped`.
- Pendiente puede vencer, pagarse o saltarse; vencido puede pagarse o saltarse.
- Cambiar precio o regla afecta pendientes estrictamente posteriores a hoy;
  pagos, saltos manuales y obligaciones pasadas conservan sus importes.
- Pausa/cancelación conserva futuros cobros como saltados con motivo. Reanudar
  restaura solo fechas futuras válidas saltadas por pausa y no recupera periodos
  suspendidos. Cambiar regla conserva cobros retirados con motivo `rescheduled`.
- Un pago confirmado conserva `expectedAmount`, `actualAmount` y el movimiento.
  Una edición compatible actualiza el importe real; eliminar o invalidar el gasto
  desvincula el cobro y lo deja pendiente/vencido. Es la excepción explícita a la
  estabilidad del estado pagado, ejecutada atómicamente con la transacción real.

Se proyectan 90 días y siempre el siguiente cobro. El cursor persistido permite
procesar atrasos activos en lotes de 500; el mantenimiento procesa hasta 20 lotes
por ejecución y reintenta si queda trabajo. La protección única de SQLite evita
duplicados incluso al repetir generación y conciliación.

## Persistencia, proyecciones y alertas

La migración 1 registra las columnas heredadas de movimientos/borradores tras
introspección. La migración 2 amplía `recurring_subscriptions` y crea
`subscription_occurrences` y `subscription_reminders`; ambas versiones se
registran en `schema_migrations`. Se aplican en una transacción sin borrar datos.
Una configuración heredada inválida queda excluida del dominio operativo y genera
una alerta estable; su fila original permanece intacta.

Una ocurrencia produce un evento `expense`, importe positivo y estado
`projected`, identificado por `source_entity_type = subscription_occurrence`.
Representa una salida prevista, sin impacto contable. Pagar/saltar cancela el
evento. Las obligaciones anteriores a una pausa siguen visibles.

Alertas: `subscription_upcoming` (hasta cinco días), `subscription_overdue`,
`subscription_account_invalid`, `subscription_configuration_invalid` y
`subscription_price_changed`. Los IDs estables impiden duplicados. Las alertas de
precio conservan evidencia del cambio; una discrepancia vinculada se resuelve si
el movimiento vuelve al importe esperado o se desvincula.

No se cambia automáticamente una cuenta inactiva. La eliminación de categorías
utiliza la reasignación existente. Nuevas tablas participan en la revisión de
respaldo; la copia SQLite completa ya las incluye. El borrado financiero cancela
recordatorios y elimina las nuevas filas en orden, preservando ajustes y versiones.

## Recordatorios Android

El contrato `SubscriptionReminderService` oculta permisos, alarmas y WorkManager.
Configuración inicial: 3 días antes, 1 día antes y el mismo día a las 09:00;
configurable o desactivable por suscripción. En iOS el servicio informa
`unsupported`, sin impedir dominio/persistencia.

SQLite conserva intención, revisión y confirmación de plataforma. Después del
commit se programan alarmas inexactas con PendingIntent inmutable e identidad
estable. El receptor vuelve a validar revisión, estado del cobro y suscripción;
una alarma antigua nunca constituye prueba de gasto. El contenido público en
pantalla bloqueada es genérico; al desbloquear se muestra nombre e importe.

WorkManager 2.11.2 renueva el horizonte cada 24 horas mediante Headless JS y los
mismos casos de uso TypeScript. También recupera tras reinicio, actualización,
cambio de hora/zona y primer plano. El worker espera un resultado explícito y
reintenta fallos; no requiere pantalla, servidor, red ni un timer JS permanente.

Android puede retrasar alarmas/trabajos por Doze, batería o políticas del fabricante.
La detención forzada suspende ejecución hasta reabrir la app. Permiso o canal
desactivado impiden mostrar avisos; se conserva la intención. No se garantiza una
hora exacta ni ejecución cuando el sistema impide ejecutar la aplicación.

## Validación

Las pruebas de dominio usan SQLite real con `node:sqlite` (Node >=22.13; verificado
con Node 24), mocks de plataforma y reloj inyectado. Cubren recurrencias,
migraciones repetidas/interrumpidas, rollback, idempotencia, historial, cambios
contables, borrado, alertas y recuperación de recordatorios.

```sh
npm test -- --runInBand
npx tsc --noEmit
npm run lint
```

Las pruebas Android instrumentadas usan una base aislada para alarmas/receptor y
el worker real para mantenimiento Headless JS. Para debug debe existir Metro
accesible y un dispositivo/emulador conectado:

```sh
npm start
adb reverse tcp:8081 tcp:8081
cd android
./gradlew connectedDebugAndroidTest
```

## Compatibilidad y verificación de entrega

Se reemplazó REPLACE en cuentas y movimientos por UPDATE e INSERT condicionado
atómicos: conserva referencias y funciona con el SQLite de Android API 24,
sin exigir ON CONFLICT DO UPDATE. El runtime de promesas SQLite se habilita una
sola vez para evitar envolturas repetidas al consumir la fachada.

Verificación de dominio e interfaz: 21 suites / 139 pruebas Jest aprobadas, TypeScript y ESLint sin errores. APK debug compilado y siete pruebas instrumentadas validadas en Android API 37 (cuatro nativas con permiso concedido, receptor y UI con permiso denegado, y recorrido completo de Netflix); las capturas y comandos están en [Diseño y validación](design/subscriptions/README.md). No se compiló iOS en Windows; su interfaz comparte los componentes nativos y los recordatorios informan no soportado. Los límites de Android y de REAL están descritos arriba.

También se verificó recuperación tras reinicio real del emulador: Android ejecutó
SmartFinSubscriptionWorker con resultado SUCCESS sin abrir una pantalla de SmartFin.

## Archivos de esta implementación

Creados (sin incluir archivos previos del usuario):

- `.eslintignore`.
- `src/database/atomicSQLite.ts`, `databaseCoordination.ts`, `migrations.ts`, `upsertSQLiteRow.ts`.
- `src/modules/accounts/repositories/saveSqliteAccounts.ts`.
- `src/modules/subscriptions/types/index.ts`.
- `src/modules/subscriptions/database/schema.ts`.
- `src/modules/subscriptions/repositories/SubscriptionRepository.ts`, `sqliteSubscriptionRepository.ts`.
- `src/modules/subscriptions/useCases/recurrence.ts`, `subscriptionLifecycle.ts`, `createSubscriptionApi.ts`.
- `src/modules/subscriptions/services/SubscriptionReminderService.ts`, `androidSubscriptionReminderService.ts`, `subscriptionRuntime.ts`.
- `android/app/src/main/java/com/smartfin/SmartFinSubscriptionRemindersModule.kt`, `SmartFinSubscriptionReminderReceiver.kt`, `SmartFinSubscriptionWorker.kt`.
- `android/app/src/main/res/drawable/ic_subscription_reminder.xml`.
- `android/app/src/androidTest/java/com/smartfin/SubscriptionReminderTest.kt`.
- `__tests__/helpers/realSQLite.ts`, `__tests__/subscriptionRecurrence.test.ts`, `__tests__/subscriptions.test.ts`.
- `docs/SUSCRIPCIONES.md`.

Modificados:

- `src/database/sqliteDatabase.ts` y `src/modules/subscriptions/index.ts`.
- `src/modules/accounts/repositories/sqliteAccountRepository.ts`, `src/modules/creditCards/repositories/sqliteCreditCardRepository.ts`, `src/modules/transactions/repositories/sqliteTransactionRepository.ts`.
- `src/modules/settings/repositories/sqliteFinancialDataRepository.ts`, `src/modules/settings/useCases/deleteFinancialData.ts`.
- `src/app/App.tsx`, `src/navigation/AppNavigator.tsx`, `index.js` (solo composición y ciclo de vida).
- `android/app/build.gradle`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/com/smartfin/SmartFinNativePackage.kt`.
- `jest.config.js`, `__tests__/financialDataRepository.test.ts`.
- `README.md`, `docs/ARQUITECTURA.md`, `docs/BASE_DE_DATOS.md`, `docs/MODULOS_Y_FLUJOS.md`, `docs/PRODUCTO_Y_ALCANCE.md`, `docs/ROADMAP.md`.

Los cambios existentes de IA y del esquema base se conservaron; no forman parte
 del inventario de cambios propios anterior. La entrega de interfaz añade pantallas y navegación nativas sin alterar la separación entre compromiso y gasto real.

## Interfaz basada en Stitch

Las cuatro referencias descargadas se conservan en [Diseño y capturas](design/subscriptions/README.md). El HTML no se ejecuta. La interfaz usa componentes React Native y valores de SQLite, con tema claro y oscuro, Manrope local licenciada, ancho máximo 520 y controles de al menos 44.

- Listado: resumen equivalente, siguiente cobro, filtros y acceso a próximos cobros.
- Formulario: datos contractuales, referencias, todas las recurrencias, intervalo personalizado, calendario, vista previa sin persistir y recordatorios configurables. Los días 29–31 conservan el anclaje contractual.
- Próximos: rangos inclusivos de 7/30 días o personalizados, agrupación por fecha y vencidos separados con Vincular/Saltar.
- Detalle: datos contractuales, acciones según estado e historial paginado de 50, esperado/real/diferencia y motivo del salto; movimiento vinculado en consulta.
- Vinculación: búsqueda, puntuación y razones, selección explícita y comparación esperado/real. Nunca crea gastos ni atribuye diferencias a impuestos o comisiones sin evidencia.
- Estados: carga, vacío, error/reintento, cuenta inactiva, diagnóstico heredado y recordatorios desactivados/bloqueados/no disponibles. Los diagnósticos conservan datos y no ofrecen una reparación no soportada.

El botón Atrás cierra primero el modal y luego retrocede. El listado mantiene navegación inferior. El permiso de notificaciones solo se solicita desde un botón explícito; el panel ofrece ajustes del dispositivo y reintento de programación. El éxito financiero y los errores de recordatorios se muestran por separado.

### Archivos de interfaz

Creados: `ui/SubscriptionsScreen.tsx`, `SubscriptionUpcoming.tsx`, `SubscriptionForm.tsx`, `SubscriptionDetail.tsx`, `SubscriptionPaymentSheet.tsx`, `subscriptionDesign.tsx`, `ui/components/CivilDateField.tsx`, `SubscriptionCards.tsx`; `hooks/useSubscriptionsController.ts`, `useSubscriptionQuery.ts`; `useCases/subscriptionPresentation.ts`; pruebas `subscriptionInterface.test.tsx`, `subscriptionPresentation.test.ts` y `SubscriptionInterfaceTest.kt`; fuentes locales y licencia `src/assets/fonts/OFL-Manrope.txt`; referencias y capturas `docs/design/subscriptions/`.

Modificados: tipos, repositorio SQLite y fachada de suscripciones; `AppNavigator.tsx`, `BottomNavigation.tsx` y consumidores del menú Más (dashboard, movimientos, cuentas, tarjetas, categorías y ajustes); recursos de fuentes Android/iOS y `react-native.config.js`; pruebas SQLite; README y los cinco documentos de producto/arquitectura/flujos/base/roadmap. No se añadió una migración para la interfaz. Los cambios previos del usuario permanecen conservados.

### Límites comprobados de compilación

El APK debug usa Metro. Un intento anterior de `assembleRelease` fue bloqueado por Device Guard al ejecutar Hermes (salida 4551). La compilación posterior del 3 de octubre de 2026 terminó correctamente sin modificar el motor ni las políticas del equipo: `android/app/build/outputs/apk/release/app-release.apk`, con código incluido, no depurable y sin dependencia de Metro.

## Mejoras de edición y registro desde Suscripciones

- Los importes del formulario y de un cobro individual incluyen separadores de miles y coma decimal mientras se escriben; el formulario de Movimientos usa el mismo helper y conserva los decimales.
- Los selectores de categoría y subcategoría ofrecen Crear categoría/Crear subcategoría. Se reutilizan las reglas del módulo Categorías, incluidos nombres duplicados; la subcategoría requiere una categoría de gasto válida. El borrador de suscripción se conserva y la referencia creada se selecciona.
- Vincular muestra Registrar nuevo gasto. Abre el formulario existente de Movimientos con importe, comercio, cuenta y referencias sugeridos. Guardar crea un gasto real y aplica sus efectos contables normales; regresar no lo concilia automáticamente. La selección y confirmación del vínculo siguen siendo explícitas. La búsqueda manual al regresar permite también fechas fuera de ±7 días.
- Cada cobro pendiente, vencido o pagado del historial ofrece Editar importe de este cobro. Cambia únicamente `expected_amount` de esa ocurrencia, actualiza sus proyecciones y recordatorios y conserva contrato, otros meses, movimiento e importe real. Los saltados no se editan. Los cambios de importe de un movimiento real se realizan en Movimientos.

API añadida: `createSubscriptionCategory(name)`, `createSubscriptionSubcategory(categoryId, name)` y `updateSubscriptionOccurrenceAmount(occurrenceId, amount)`. La composición inyecta los repositorios de Categorías. No se añadieron migraciones ni se elimina la base instalada.

Archivos adicionales/modificados: `src/shared/utils/copAmountInput.ts`, presentación y fachada/lógica/runtime de Suscripciones, formulario/detalle/panel de vinculación/pantalla raíz, `AppNavigator.tsx`, `TransactionsScreen.tsx`, `AddTransactionModal.tsx`, pruebas de importes/SQLite/interfaz y recorrido instrumentado `enhancementsCreateCategoriesExpenseAndOneDateAmount`.

Verificación adicional: 21 suites / 139 pruebas Jest, TypeScript y ESLint aprobados; recorrido Android de las cuatro mejoras aprobado en emulador. Capturas en `docs/design/subscriptions/validation/enhancements-*.png`. El teléfono físico y su base de datos no se modificaron.

## Creación desde Hablar con IA

El asistente existente acepta `entity: subscription` y `operation: create`, tanto desde texto como desde la transcripción de voz. Interpreta nombre, comercio, importe COP, cuenta, categoría/subcategoría y sus referencias a registros creados antes en el lote; fecha contractual civil, día de facturación, periodicidad y recurrencia personalizada; recordatorios activados/desactivados, días de anticipación y hora/minuto del dispositivo. Al crear, el estado es activo y la moneda COP.

Si faltan datos, el asistente pregunta localmente. Las categorías pueden elegirse o crearse respondiendo con un nombre nuevo. Antes de guardar, todos los parámetros aparecen en una revisión editable y se exige **Confirmar todo**. Las correcciones de voz/texto revisan el borrador; no modifican una suscripción ya guardada. Actualizar, cancelar o eliminar suscripciones mediante IA todavía no está soportado.

Ejemplo: «Crea una suscripción de Netflix por 44.900 pesos cada mes, desde el 31 de octubre de 2026, día de facturación 31, con mi cuenta Banco, categoría Entretenimiento, sin subcategoría, comercio Netflix, y recordatorios tres días antes, un día antes y el mismo día a las nueve de la mañana». Los nombres se resuelven contra el catálogo real; ante ambigüedad se pide selección. También se puede pedir «cada dos meses» o «cada diez días» usando recurrencia personalizada.

La creación reutiliza validaciones, cálculo contractual, ocurrencias, proyecciones y alertas del dominio. Se guarda la intención de recordatorios dentro de la transacción del lote y se programa después del commit, sin pedir permiso de notificaciones automáticamente. Un fallo de plataforma se informa como recordatorio pendiente sin revertir la suscripción. El identificador derivado del borrador y la acción impide duplicar una suscripción al repetir su confirmación.

No se crean movimientos ni se alteran saldos o deuda por crear una suscripción. Un lote puede incluir además un movimiento explícitamente solicitado; ese movimiento conserva sus efectos contables normales. El acceso se coordina con mantenimiento, respaldo y borrado. No se añadieron migraciones ni servicios remotos: se reutiliza la integración Gemini que ya tenía Hablar con IA.

Pruebas de esta integración: interpretación estructurada de Gemini simulada, aclaraciones y revisión, referencias de categorías/subcategorías creadas en el lote, recurrencia personalizada, SQLite real, rollback, confirmación repetida, validación de referencias/configuración y fallo de recordatorios después del commit. La interpretación con Gemini real y el reconocimiento de voz del teléfono no se verificaron en esta entrega.

Validación: 22 suites / 153 pruebas Jest, TypeScript y ESLint; APK debug compilado. El caso Android `aiSubscriptionReviewCommitsWithoutCreatingExpense` pasó con un borrador persistido de prueba, revisión explícita y comprobaciones de suscripción, recordatorios, ausencia de movimientos y saldo intacto. Capturas: `docs/design/subscriptions/validation/ai-subscription-review.png` y `ai-subscription-saved.png`. No se instaló ni modificó la aplicación del teléfono físico.

Archivos de la integración: tipos, parser/normalización/preguntas/revisión del asistente, prompt y esquema de Gemini, ejecutor transaccional y bloqueo de confirmación duplicada; `src/database/atomicSQLite.ts` para participar en la transacción del lote sin abrir otra; `src/modules/subscriptions/useCases/createSubscriptionInCommand.ts` y `subscriptionFromAiFields.ts`; pruebas `aiSubscriptions.test.ts`, respuesta simulada de Gemini y test Android. Se conservan las modificaciones previas del usuario.
