# Fecha editable, hora opcional y gastos compartidos

La fase siguiente añade condonaciones, recuperaciones y reversiones mediante un
diario separado (migración 4). Sus reglas, nuevas operaciones y restricciones están
en [Condonaciones compartidas](CONDONACIONES_COMPARTIDAS.md); amplía los estados e
indicadores descritos aquí sin alterar banco ni consumo original.

Implementación local y offline. Fecha de revisión: 11 de octubre de 2026.

## Resultado

Movimientos permite editar la fecha y agregar, modificar o quitar una hora
explícita. Los ingresos, gastos y transferencias nuevos comienzan sin hora.
Gastos compartidos dispone de tipos, persistencia, repositorios, API, proyecciones
financieras y pruebas. Su interfaz queda pendiente, conforme al alcance solicitado.

Los cambios existentes del usuario en la deduplicación de acompañantes de
transferencias se conservaron. La prueba existente `__tests__/aiTransfers.test.ts`
se ejecutó en la suite completa y no fue modificada.

## Arquitectura y límite transaccional

La capacidad pertenece a `src/modules/transactions/`:

- `types/SharedExpense.ts`: contactos, compra compartida, participaciones,
  cobros, aplicaciones, devoluciones, resultado y efectos de comandos.
- `useCases/sharedExpenseDomain.ts`: centavos, reparto, estado, obligaciones
  por persona, corte por fecha civil y proyección de consumo personal.
- `useCases/createSharedExpenseApi.ts`: operaciones públicas y validación.
- `useCases/sharedCommandEffects.ts`: comparación de saldos, deuda, patrimonio,
  ingreso, gasto y flujo bancario antes y después de cada operación.
- `repositories/SharedExpenseRepository.ts`: contrato inyectable.
- `repositories/sqliteSharedExpenseRepository.ts`: adaptación SQLite y
  comprobante persistente del comando.
- `repositories/sharedTransactionIntegrity.ts`: protección en la frontera
  común de escritura y borrado, también utilizada por edición rápida e IA.
- `repositories/sharedFinancialProjectionSql.ts`: importe personal para las
  consultas del dashboard; el libro conserva el importe bancario.
- `repositories/sharedFinancialTotalsSql.ts`: agregación de cuentas por cobrar
  y anticipos para el dashboard; una fila, sin transportar todo el historial.
- `useCases/readSharedFinancialTotals.ts`: validación exacta de los centavos
  agregados recibidos como texto; no cambia fechas, importes ni saldos.

La fachada reutiliza los repositorios de cuentas, movimientos y tarjetas dentro
de `runSharedSQLiteTransaction`. Todos reciben el mismo participante SQLite.
Saldo, deuda, movimientos, cuotas, extractos, conciliaciones, repartos y
comprobante de comando se confirman o revierten juntos. No se introducen
transacciones anidadas ni callbacks async dentro del driver.

El identificador de comando lo proporciona el llamador y debe persistir durante
los reintentos. La solicitud se normaliza y se guarda junto al resultado.
Mismo ID y mismos datos: devuelve el resultado ya confirmado. Mismo ID y datos
distintos: error. Un fallo con rollback deja el ID disponible para reintentar.
Los resultados incluyen movimientos modificados, IDs eliminados y deltas
financieros; vincular un cobro existente devuelve cero cambio bancario.

## Contrato de fecha

`src/shared/utils/transactionDate.ts` centraliza tipos y validación.

| Entrada | Persistencia y presentación |
|---|---|
| Solo 5 de octubre | `date=2026-10-05`, `civilDate=2026-10-05`, precisión `date`; sin hora, zona ni instante inventados |
| 5 de octubre, 11 p. m. | Día civil `2026-10-05`, hora `23:00`, zona `America/Bogota`, instante `2026-10-06T04:00:00.000Z`, precisión `dateTime` |
| Registro antiguo con `2026-10-06T00:00:00Z` | Conserva la cadena y el día visible 6; no se presupone una hora indicada por el usuario |
| Edición antigua sin tocar fecha | Conserva la cadena original y metadatos nullable |
| Quitar hora explícita | Mantiene el día civil y guarda una fecha sin hora |

La conversión aplica la zona al instante completo y utiliza sus reglas
históricas mediante Intl. `createdAt` sigue siendo auditoría de creación.
Se validan días reales, años de cuatro cifras distintos de 0000 y horas
`00:00–23:59`. El repositorio rechaza metadatos incompletos o contradictorios.

El formulario presenta Fecha (`YYYY-MM-DD`) y Agregar hora (opcional).
Los listados muestran la hora solo si fue indicada. La IA conserva el formato
sin hora o la hora colombiana explícita; una fecha inexistente o un formato
ambiguo requiere aclaración. El servicio existente recibe el contrato actualizado;
no se añadió una integración de red.

Historial, meses, filtros, dashboard, métricas de cuentas, ciclos de tarjeta,
sugerencias de suscripciones y CSV usan la fecha civil, con fallback al prefijo
histórico. Transferencia principal, acompañante e impuesto comparten los
metadatos. El historial conserva páginas de 50, revisión financiera, invalidación
de cursores y desempates deterministas.

La entrada heredada `transactionDate` del caso de uso manual se conserva para
compatibilidad con llamadores anteriores. Los nuevos flujos de UI, IA y gastos
compartidos proporcionan `occurrence` explícitamente.

## Migración 3 y esquema

Las versiones 1 y 2 se conservan. La versión 3 es transaccional e idempotente;
el arranque deja sus tablas, índices y triggers a la migración versionada.
No reescribe fechas ni importes anteriores. El esquema instalado tiene 38 tablas.

| Tabla | Cambio y restricciones |
|---|---|
| `transactions` | Añade `civil_date`, `local_time`, `time_zone`, `date_precision`, todas nullable |
| `transaction_splits` | Añade `shared_expense_id`, `contact_id`, `amount_minor`, `shared_active`; conserva importe y campos anteriores |
| `shared_contacts` | Nombre local no vacío; ID reutilizable |
| `shared_expenses` | Compra única, total en centavos, fecha civil, descripción, estado y copia del reparto para historial tras borrar la compra |
| `shared_receipts` | Cobro único por movimiento y persona, importe en centavos, fecha y estado |
| `shared_allocations` | Aplicación de cobro a participación, importe, estado y referencia histórica estable |
| `shared_returns` | Devolución única por movimiento, vinculada al cobro original |
| `shared_commands` | ID de comando único, solicitud normalizada, resultado validado y auditoría |

Las tablas nuevas tienen FK, restricciones de estado y centavos positivos enteros
hasta `Number.MAX_SAFE_INTEGER`. La participación propia puede ser cero; los
centavos del split son no negativos. Un índice único parcial impide dos
participaciones activas de la misma persona en un gasto, incluida la parte propia.

Se añaden índices de participaciones, aplicaciones y cobros por persona, más
`idx_transactions_civil_day` y `idx_transactions_civil_sort`.
Cada tabla nueva participa en `financial_data_revision`. Borrar una compra
conserva el resumen histórico; la FK de aplicaciones puede quedar null después
del borrado del split, manteniendo su clave histórica y su registro inactivo.

El respaldo SQLite conserva todo el esquema y comprobantes. La exportación
Android agrega fecha civil, hora, zona, precisión y cadena original a movimientos,
más CSV de contactos, gastos, participaciones, cobros, aplicaciones y devoluciones.
El borrado financiero completo limpia estas tablas en orden compatible con FK.

## Reglas financieras

1. Una compra mantiene su importe bancario completo. Débito de $30.000:
   salida de $30.000. Crédito de $30.000: deuda de $30.000.
2. El consumo por categoría y periodo toma únicamente la participación propia.
   Cobros y devoluciones vinculados aportan cero ingreso/gasto personal.
3. Una entrada creada suma dinero una sola vez a la cuenta receptora.
   Vincular una entrada publicada existente conserva identidad, importe y saldo.
4. El cobro sin aplicar es anticipo de terceros. La parte ajena de una compra
   activa es cuenta por cobrar hasta aplicar el cobro.
5. Patrimonio = activos actuales + cuentas por cobrar − deuda actual − anticipos
   sin aplicar o devolver. El disponible conserva solo cuentas líquidas.
6. Las fechas de compra, cobro y devolución son independientes. Un abono de
   noviembre no traslada el consumo de octubre.
7. Los porcentajes se expresan hasta dos decimales, suman 100 % y distribuyen
   centavos mediante mayor residuo; los empates siguen el orden suministrado.
   Los montos suman exactamente el total. Se rechazan cero en terceros/abonos,
   negativos, no finitos, más de dos decimales e importes fuera de rango.
8. Un cobro puede aplicarse parcialmente a varias compras de la misma persona,
   respetando dinero disponible y pendiente. El excedente requiere
   `excessPolicy: 'keepAsAdvance'` si se enviaron aplicaciones.
9. Entradas publicadas `income`, `refund` y `manualAdjustment` compatibles pueden
   vincularse, también si fueron importadas. Se excluyen transferencias propias,
   pagos de tarjeta, crédito y otras entradas incompatibles.
10. Una compra a crédito por clasificar requiere una tarjeta real. Editar solo
    fecha/hora conserva importes, saldos, deuda y progreso de cuotas.
11. El importe compartido se modifica junto a un reparto nuevo mediante
    `updatePurchase`; la edición general y la IA no pueden romperlo.
12. Cancelar con abonos aplicados está bloqueado. Desvincular convierte el importe
    en anticipo sin mover dinero; devolverlo exige una salida explícita. Cancelar
    sin aplicaciones conserva la compra y restaura su gasto completo.
13. Eliminar un cobro reabre las participaciones, revierte su dinero una vez y
    conserva historial. Un cobro con devoluciones activas exige resolverlas.
    Eliminar una devolución restaura el anticipo. Eliminar una compra con
    aplicaciones activas exige resolverlas antes.

## API para la futura interfaz

`createSharedExpenseApi(createSqliteSharedExpenseRepository(database))` expone:

| Operaciones | Uso |
|---|---|
| `listContacts`, `saveContact` | Personas locales reutilizables; no accede a la agenda del teléfono |
| `createPurchase`, `sharePurchase` | Crear compra y reparto juntos, o dividir una compra publicada |
| `updateDistribution`, `updatePurchase` | Cambiar reparto; cambiar compra y reparto en la misma operación |
| `recordReceipt` | Crear cobro/anticipo o vincular entrada existente; puede aplicar varios abonos |
| `applyReceipt`, `unlinkAllocation` | Aplicar saldo disponible o desvincular sin mover dinero |
| `returnAdvance` | Devolver dinero mediante un movimiento real |
| `cancelDivision`, `deleteMovement` | Cancelar reparto o eliminar movimiento con validaciones y reversos |
| `getExpense`, `getHistory`, `getPosition` | Resumen, trazabilidad y cuentas por cobrar/anticipos por persona |
| `getPersonalEntries` | Proyección para informes y presupuestos; no altera movimientos de origen |
| `previewCancellation`, `previewDistribution`, `previewReceiptLink` | Consultar efectos y bloqueos antes de confirmar |

Todas las mutaciones reciben un ID de comando estable. Las vistas previas no
reservan dinero ni autorizan el commit: las validaciones se repiten en la operación.
Los estados de reembolso se calculan: `pending`, `partiallyReimbursed`,
`completed`. La UI debe revisar además `expense.status` para mostrar
`cancelled` o `deleted`; estas divisiones no conservan obligaciones activas.

Ejemplo sin ejecutar sobre datos reales:

```ts
const api = createSharedExpenseApi(createSqliteSharedExpenseRepository(database));
const { entityId: contactId } = await api.saveContact('contacto-1', 'Amiga');
const compra = await api.createPurchase('compra-1', {
  purchase: {
    accountId: 'davivienda', amount: 30000, categoryId: 'alimentacion',
    merchantName: 'Restaurante', operationType: 'Débito',
    occurrence: { kind: 'date', date: '2026-10-05' },
  },
  distribution: {
    mode: 'amounts', personalAmount: 15000,
    participants: [{ contactId, amount: 15000 }],
  },
});
const detalle = await api.getExpense(compra.entityId);
await api.recordReceipt('cobro-1', {
  contactId, accountId: 'nequi', amount: 15000,
  occurrence: { kind: 'date', date: '2026-10-08' },
  applications: [{
    participationId: detalle.participants[0]!.participationId, amount: 15000,
  }],
});
```

Para un cobro importado, sustituir cuenta/importe/fecha por
`transactionId: idExistente`. Para un anticipo, omitir las aplicaciones y
utilizar `applyReceipt` cuando exista la compra.

## Los cinco escenarios

Datos sintéticos: Davivienda inicia en $1.000.000, Nequi en $0 y no hay deuda.
Las compras se asignan a Alimentación. Todos los cobros aportan ingreso personal $0.

| Caso | Movimientos y participación | Saldo disponible | Por cobrar / anticipo | Gasto propio / patrimonio |
|---|---|---:|---:|---:|
| A: después | Compra $30.000 el día 5; propia $15.000. Cobro $15.000 el día 8, aplicado a Amiga | Tras compra $970.000; final $985.000 | Tras compra $15.000 / $0; final $0 / $0 | $15.000 / $985.000 |
| B: antes | Cobro $15.000 día 1; compra $30.000 día 5; luego se aplica el anticipo | Antes $1.015.000; final $985.000 | Antes $0 / $15.000; final $0 / $0 | $15.000 / $985.000 |
| C: parcial | Compra $30.000; cobro $10.000; luego otro abono $5.000 | Parcial $980.000; final $985.000 | Parcial $5.000 / $0; final $0 / $0 | $15.000 / $985.000 en ambas etapas |
| D: varias personas | Compra $90.000: propia $30.000, A $20.000, B $25.000, C $15.000 | Tras compra $910.000; al recibir todo $970.000 | Al comprar $60.000 / $0; final $0 / $0 | $30.000 / $970.000 |
| E: otra cuenta | Davivienda paga $30.000; Nequi recibe $15.000 y se aplica | Davivienda $970.000 + Nequi $15.000 = $985.000 | $0 / $0 | $15.000 / $985.000 |

En A/E: flujo bruto de salida $30.000, entrada $15.000; consumo propio $15.000.
En B el patrimonio antes de comprar sigue en $1.000.000: el anticipo compensa el
dinero recibido. En C un cobro posterior de noviembre completa la obligación y
el gasto propio permanece en octubre.

Compra con tarjeta: disponible inicial $1.000.000, deuda $30.000 y cuenta por
cobrar $15.000 dan patrimonio $985.000. Recibir $15.000 deja disponible
$1.015.000, deuda $30.000, por cobrar $0 y patrimonio $985.000. Pagar después
la tarjeta reduce disponible a $985.000 y deuda a $0, sin un segundo gasto.

## Pruebas y validación

Todos los datos financieros de prueba son sintéticos, con SQLite real en memoria
mediante `node:sqlite`; ninguna migración se probó contra la base del usuario.

- Cinco escenarios, importación/vínculo sin duplicación, crédito y pago de tarjeta,
  abonos parciales, varias personas, varias compras de una persona y otra cuenta.
- Deltas de banco, disponible, deuda, patrimonio, consumo, ingreso y flujo bruto.
- Centavos, porcentajes, parte propia cero, valores inválidos y restricciones SQL.
- Reintentos después de reconstruir la API, conflicto de comando, vínculos repetidos
  y colisión con identidad importada.
- Edición con abonos, edición general/rápida/IA protegidas, conservación de cuotas,
  cancelación, reactivación, borrado de compra/cobro/devolución y trazabilidad.
- Abrir una transferencia conserva el 4x1000 real, aunque su fila no esté en la
  página visible. Editar fecha desde el formulario o la IA mantiene impuesto,
  acompañante, cuentas y cuotas; una edición de categoría sin cambio conserva
  la subcategoría existente.
- Fallos antes de escrituras relevantes y después del comprobante, con rollback
  de compras, cobros, modificaciones, eliminaciones y devoluciones.
- Fechas sin hora y 23:00; legado UTC, quitar hora, límites de mes/año, offset
  histórico de Bogotá, suscripciones, impuesto y transferencia, 55 movimientos
  paginados e invalidación de cursor.
- Migración repetida, fallo durante ALTER con rollback, FK, revisión y borrado total.
- Pruebas de componente del editor mediante el harness existente de
  react-test-renderer, incluidos campos editables, error de fecha y quitar hora.

Los snapshots de caracterización de fase 0 se actualizaron por las columnas
nullable, versión 3, seis tablas vacías y campos SQL nuevos. Los indicadores
financieros originales de esas pruebas se conservan; esa caracterización no
demuestra rollback integral del antiguo código fuera del ámbito compartido.

Resultados automatizados de cierre:

| Comando | Resultado |
|---|---|
| `npm test -- --runInBand` | 37 suites aprobadas, 380 pruebas aprobadas, 8 snapshots aprobados; 3 suites/pruebas opt-in de rendimiento omitidas |
| `npx tsc --noEmit` | Aprobado |
| `npm run lint` | Aprobado, sin errores ni advertencias |
| `android/gradlew.bat :app:compileDebugKotlin` | BUILD SUCCESSFUL; avisos del entorno sobre SDK XML y deprecaciones Gradle |
| `git diff --check` | Sin errores de whitespace |

La suite de fechas contiene 21 pruebas aprobadas, incluida edición por IA que
conserva impuesto y cuotas. La suite compartida contiene
41 pruebas aprobadas. No se afirma validación visual ni del driver en dispositivo
a partir de SQLite Node.

## Límites y pendientes de dispositivo e interfaz

- Falta la interfaz de gastos compartidos: personas, reparto, selección/vínculo de
  cobros, excedentes, anticipos, devoluciones, vistas previas y estados.
- Presupuestos e informes siguen siendo marcadores; la consulta/proyección está
  preparada y probada, sin pantallas nuevas.
- La nueva contabilidad de terceros usa centavos; saldos existentes y métricas
  públicas conservan `number`/`REAL`. No se migró todo el libro ni se modificó
  el redondeo heredado de cuotas, pagos o impuesto.
- `getPosition(asOf)` calcula obligaciones por fechas de movimientos con el
  reparto/aplicaciones vigentes. No reconstruye versiones anteriores de una
  clasificación ni balances históricos de cuentas. El dashboard conserva
  saldos/deuda actuales aunque consulte un mes pasado.
- Los estados cancelado/eliminado conservan copia del reparto y registros de
  aplicaciones; no implementan un libro contable inmutable de todas las versiones.
- Los contactos son locales y se identifican por ID; nombres iguales son posibles.
- Las consultas nuevas cargan el estado compartido completo. El historial conserva
  su paginación; optimizar grandes volúmenes de repartos queda para mediciones
  reales, sin imponer límites que omitan datos.
- Falta validar en dispositivo Android el teclado, accesibilidad y distribución
  visual de Fecha/Agregar hora, persistencia tras reinicio y apertura de una base
  instalada. La compilación Kotlin no sustituye esas comprobaciones.
- La exportación nativa compiló; falta comprobar con el selector de documentos del
  dispositivo los CSV nuevos y un respaldo/restauración completo.
- Las tres pruebas de rendimiento son opt-in y permanecen omitidas en la suite
  normal; no se atribuyen nuevas mediciones de rendimiento.

## Archivos creados o modificados

### Nuevos

- `__tests__/helpers/sharedExpenseFixture.ts`
- `__tests__/sharedExpenses.test.ts`
- `__tests__/transactionDates.test.ts`
- `src/modules/transactions/database/sharedExpenseSchema.ts`
- `src/modules/transactions/repositories/SharedExpenseRepository.ts`
- `src/modules/transactions/repositories/sharedCommandResultValidation.ts`
- `src/modules/transactions/repositories/sharedFinancialProjectionSql.ts`
- `src/modules/transactions/repositories/sharedTransactionIntegrity.ts`
- `src/modules/transactions/repositories/sqliteSharedExpenseRepository.ts`
- `src/modules/transactions/types/SharedExpense.ts`
- `src/modules/transactions/useCases/createSharedExpenseApi.ts`
- `src/modules/transactions/useCases/getManualTransactionFormOptions.ts`
- `src/modules/transactions/useCases/sharedCommandEffects.ts`
- `src/modules/transactions/useCases/sharedExpenseDomain.ts`
- `src/shared/utils/transactionDate.ts`
- `docs/GASTOS_COMPARTIDOS_Y_FECHAS.md`

### Modificados

- `__tests__/__snapshots__/financialAtomicityPhase0.test.ts.snap`
- `__tests__/dashboardSummary.test.ts`
- `__tests__/subscriptions.test.ts`
- `__tests__/transactionHistoryRefinement.test.ts`
- `__tests__/transactionsScreen.test.tsx`
- `android/app/src/main/java/com/smartfin/SmartFinDriveBackupModule.kt`
- `docs/ARQUITECTURA.md`
- `docs/BASE_DE_DATOS.md`
- `docs/MODULOS_Y_FLUJOS.md`
- `src/database/migrations.ts`
- `src/database/sqliteDatabase.ts`
- `src/database/sqliteSchema.ts`
- `src/modules/accounts/ui/components/DebitCardInsights.tsx`
- `src/modules/accounts/useCases/getDebitCardsOverview.ts`
- `src/modules/creditCards/ui/components/CreditCardInsightCards.tsx`
- `src/modules/creditCards/useCases/creditCardTransactionRelations.ts`
- `src/modules/creditCards/useCases/getCreditCardsOverview.ts`
- `src/modules/dashboard/useCases/getDashboardSummary.ts`
- `src/modules/settings/repositories/sqliteFinancialDataRepository.ts`
- `src/modules/subscriptions/repositories/sqliteSubscriptionRepository.ts`
- `src/modules/subscriptions/ui/SubscriptionPaymentSheet.tsx`
- `src/modules/subscriptions/ui/SubscriptionsScreen.tsx`
- `src/modules/subscriptions/useCases/createSubscriptionApi.ts`
- `src/modules/subscriptions/useCases/subscriptionLifecycle.ts`
- `src/modules/subscriptions/useCases/subscriptionPresentation.ts`
- `src/modules/transactions/hooks/useAiAssistantController.ts`
- `src/modules/transactions/index.ts`
- `src/modules/transactions/repositories/sqliteTransactionHistory.ts`
- `src/modules/transactions/repositories/sqliteTransactionRepository.ts`
- `src/modules/transactions/types/Transaction.ts`
- `src/modules/transactions/ui/TransactionsScreen.tsx`
- `src/modules/transactions/ui/components/AddTransactionModal.tsx`
- `src/modules/transactions/ui/components/TransactionCard.tsx`
- `src/modules/transactions/ui/transactionsScreenFormatters.ts`
- `src/modules/transactions/useCases/aiCommandPlanner.ts`
- `src/modules/transactions/useCases/executeAiCommandPlan.ts`
- `src/modules/transactions/useCases/saveManualTransaction.ts`
- `src/modules/transactions/useCases/index.ts`
- `src/services/geminiCommandService.ts`

