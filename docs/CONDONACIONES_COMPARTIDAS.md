# Condonaciones de gastos compartidos

## Arquitectura

Esta fase añade dominio, persistencia, API futura, indicadores, pruebas y
documentación. No crea UI ni restauración de respaldos. Respeta las capas de
`ARQUITECTURA.md`, la skill financiera y la medición antes/después de la skill
React Native. Todas las bases de validación son sintéticas.

| Archivo bajo `src/modules/transactions/` | Responsabilidad |
|---|---|
| `types/SharedExpense.ts` | Eventos, estados y clasificación contable |
| `useCases/sharedLossDomain.ts` | Centavos, estados, pérdidas y recuperaciones |
| `useCases/sharedLossCommands.ts` | Comandos puros y validaciones |
| `useCases/createSharedExpenseApi.ts` | Fachada, previews y efectos |
| `repositories/sqliteSharedExpenseRepository.ts` | Diario, agregados y comandos transaccionales |
| `repositories/sharedTransactionIntegrity.ts` | Protección de edición/borrado, también general, rápida e IA |
| `database/sharedLossSchema.ts` | DDL de migración 4 |

## Base de datos

La migración 4 crea `shared_loss_events`, separada de movimientos, reembolsos y
aplicaciones. Guarda ID, tipo, gasto, persona, identidad de participación,
centavos INTEGER positivos seguros, fecha civil, motivo opcional, auditoría ISO,
evento original y cobro para recuperaciones.

Tipos: `forgiveness`, `forgivenessReversal`, `recovery`, `recoveryReversal`.
Gasto, contacto, cobro y evento tienen FK. La participación usa una identidad
histórica (`participation_key`) que sobrevive al borrado de una compra resuelta,
junto con su snapshot de reparto. No hay cascada que elimine el diario.
Índices: participación/tipo, cobro/tipo, fecha/tipo, evento original y unicidad de
reversión por evento. El repositorio rechaza modificar/retirar eventos y SQLite
rechaza UPDATE mediante trigger. El borrado financiero global explícito sí limpia
el diario antes de sus padres en una transacción.

Los triggers de revisión invalidan consultas/cursor y marcan cambios para respaldo.
La copia SQLite completa contiene la tabla; no se añadió CSV específico ni
restauración. Arranque difiere el DDL hasta la migración versionada, que se aplica
atómicamente. Pruebas de migración repetida y fallo después de CREATE conservan
las filas de una base sintética con versión 3.

## Tratamiento financiero

Clasificación: `unrecoveredSharedExpenseLoss`, pérdidas por reembolsos no
recuperados. Es independiente de la categoría original y del flujo bancario.
Los reversos reconocen su efecto en su propia fecha civil, conservando el original.

| Operación por X | Banco / deuda | Por cobrar | Anticipo | Pérdida | Patrimonio |
|---|---:|---:|---:|---:|---:|
| Condonación | 0 | −X | 0 | +X | −X |
| Reversión de condonación | 0 | +X | 0 | −X | +X |
| Registrar cobro real sin aplicar | +X / 0 | 0 | +X | 0 | 0 |
| Aplicar recuperación al cobro | 0 | 0 | −X | −X | +X |
| Revertir recuperación | 0 | 0 | +X | +X | −X |

Ingreso ganado y gasto de consumo generado son cero en todos los casos.
Registrar/eliminar/devolver dinero real afecta flujo bancario. Aplicar recuperación
no vuelve a ingresar dinero. Las pérdidas no se representan como `Transaction`.

Ejemplo solicitado: compra $30.000, propia $15.000, cobro $5.000 y condonación
$10.000. Banco queda intacto; por cobrar cero; pérdida $10.000; patrimonio cae
$10.000; ingreso cero; Alimentación $15.000; cobro aplicado $5.000. Estado:
`completedMixed`. Con banco inicial $1.000.000, disponible/patrimonio final $975.000.

Patrimonio mantiene activos + por cobrar − deuda − anticipos. No se resta otra
vez la pérdida: la reducción de la cuenta por cobrar ya produce ese efecto.
Disponible, deuda y cuotas no cambian por condonar.

## API pública futura

| Operación | Entrada/resultado |
|---|---|
| `forgiveParticipation(commandId, input)` | `{participationId, amount, date, reason?}`; total usando pendiente o parcial |
| `recoverForgiveness(commandId, input)` | `{forgivenessId, receiptId, amount, date, reason?}` |
| `reverseLossEvent(commandId, input)` | `{eventId, date, reason?}`; reversión completa de pérdida/recuperación vigente |
| `previewForgiveness`, `previewRecovery`, `previewLossReversal` | Mismas entradas y validaciones; efectos sin escribir o error explicativo |
| `getExpense`, `getHistory`, `getPosition(asOf?)` | Persona, compra, abonos, condonado, recuperado, pendientes y eventos |
| `getLossEntries(startDate?, endDateExclusive?)` | Diario clasificado, delta firmado y flujo bancario cero |
| `getLossPeriodTotals(startDate, endDateExclusive)` | Pérdidas, reversiones, recuperaciones y pérdida neta |

Todas las mutaciones usan comandos estables y comprobantes en `shared_commands`.
Reintento con contenido idéntico devuelve el resultado confirmado incluso tras
reabrir SQLite; mismo ID con otros datos falla. Las previews no reservan saldo;
el commit valida otra vez. El ámbito compartido existente serializa comandos y
usa `BEGIN IMMEDIATE` con rollback del diario/comprobante y operaciones bancarias.

Estados: `pending`, `partiallyReimbursed`, `completed` (reembolso completo),
`partiallyForgiven`, `fullyForgiven`, `completedMixed`, por obligación y gasto.
Consultar además `expense.status` para cancelación/eliminación. Recuperación
mantiene la clasificación original y aparece en `recoveredAmount`.

## Recuperación posterior y protección

`recordReceipt` registra o vincula dinero real y conserva la API anterior. Sin
aplicaciones deja anticipo e ingreso personal cero, incluso al vincular `income`
importado. La interfaz futura deberá ofrecer aplicación al pendiente, mantener
anticipo o recuperación de una condonación concreta. Nunca se aplica dinero
automáticamente a una cuenta por cobrar inexistente.

Recuperar consume anticipo y reduce pérdida en la fecha de recuperación. Ejemplo:
pérdida $15.000 en octubre, cobro/recuperación $5.000 en noviembre. Octubre conserva
sus $15.000 de pérdida; noviembre tiene ingreso cero, consumo cero y pérdida neta
−$5.000. Banco recibe una sola vez y patrimonio aumenta $5.000 al reconocerla.

Condonación no supera pendiente; recuperación no supera pérdida ni cobro disponible.
Abonos + condonaciones vigentes no superan participación. Reducir participación,
cancelar/eliminar compra o reducir/eliminar cobro exige resolver los vínculos
incompatibles. Revertir pérdida exige recuperaciones netas cero. Revertir recuperación
libera anticipo; devolver efectivo requiere después `returnAdvance` explícito.
No se permite repetir reversión, revertir reversos ni recuperar pérdida revertida.

Fechas siguen el orden civil de la obligación: condonación después de compra,
abonos y eventos; recuperación después de cobro/eventos; reversión después de
eventos. Abonos aplicados no preceden al último evento de pérdida. Edición de
cobro/compra mantiene esos límites. Esta política conservadora evita pendientes
históricos negativos tras reversión; corregir el diario exige reversión/evento nuevo.

## Dashboard y rendimiento

`monthlyExpenses` conserva consumo. Nuevos campos: `monthlyForgivenessLosses`,
`monthlyLossReversals`, `monthlyLossRecoveries`, `monthlyRecoveryReversals`,
`monthlyNetLosses`. `monthlySavings` = ingreso − consumo − pérdida neta, resultado
personal del periodo, separado del flujo bancario. Historial/conteo no incluyen
pérdidas. La UI no se modificó para mostrar estas métricas.

Dashboard conserva agregados SQL por relación, evitando multiplicar centavos,
y añade una lectura mensual indexada. Pasa de cuatro a cinco consultas; cada
agregado de terceros devuelve una fila. No carga diario/contactos/repartos completos.

Medición Node 24.16.0, 100.000 movimientos sintéticos, tres calentamientos y siete
muestras. Baseline usa la fachada y SQL agregados previos conservados en helpers.
Vacío exige igualdad exacta; diario poblado exige deltas financieros exactos.

| Gastos | Antes (ms) | Diario vacío (ms) | Diario poblado (ms) | Eventos |
|---:|---:|---:|---:|---:|
| 0 | 1,52 | 1,77 | 1,62 | 0 |
| 100 | 1,73 | 1,94 | 2,26 | 500 |
| 1.000 | 4,26 | 4,27 | 8,57 | 5.000 |
| 5.000 | 14,76 | 16,14 | 30,25 | 25.000 |

Son medianas locales, sin umbral universal ni garantía Android. El diario incluye
condonaciones, reversos y recuperaciones. Filas retornadas: 171 antes, 172 después;
en el mayor caso, bytes 13.507 → 13.590. SQL, muestras y EXPLAIN están en
`performance/shared-forgiveness/node-comparison.json`. Reproducir:

```powershell
$env:SMARTFIN_FORGIVENESS_PERF='1'
npx jest --runInBand --testMatch '**/__tests__/sharedForgivenessPerformance.test.js'
```

## Pruebas y límites

Resultados de cierre:

| Control | Resultado |
|---|---|
| `npm test -- --runInBand` | 39 suites aprobadas, 433 pruebas y 8 snapshots; 3 pruebas opt-in anteriores omitidas |
| `npx tsc --noEmit` | Aprobado |
| ESLint de los archivos de esta fase | Aprobado, sin errores ni advertencias |
| `npm run lint` | 4 errores previos en el script de auditoría Android indicado abajo |
| Benchmark opt-in de condonaciones | Aprobado; ejecutado por separado |
| `git diff --check` | Aprobado |

`sharedForgiveness.test.ts` verifica ejemplo, total/parcial, múltiples personas y
condonaciones, cobros anteriores/posteriores, meses diferentes, centavos exactos,
recuperación/reversión, idempotencia, concurrencia, rollback antes/después de diario
y comprobante, crédito/pago, cancelación/borrado, edición general/rápida, migración,
FK y cierre/reapertura de un archivo temporal sintético. Ninguna prueba abrió la
base financiera instalada. Los snapshots de fase 0 solo cambian por tabla vacía,
versión 4 y hashes asociados; conservan sus cifras financieras.

Límites pendientes: validar driver SQLite/Hermes en Android real; UI e informes;
restauración y CSV del diario. Dashboard usa saldos/deuda actuales aunque se consulte
un mes anterior. `getPosition(asOf)` incorpora fechas del diario pero usa repartos y
vínculos vigentes; no reconstruye todas las ediciones históricas de la fase anterior.
Saldos bancarios heredados siguen `REAL`/`number`; no hay migración monetaria global.
Comandos/historial siguen cargando relaciones completas; esta medición es del
dashboard. Lint global tiene cuatro errores anteriores de `performance` no definido
en `scripts/androidSharedPosition/SharedPositionApp.jsx`.

La skill financiera mantiene un mapa anterior que describe gastos compartidos
como pendientes. El código y `GASTOS_COMPARTIDOS_Y_FECHAS.md` ya incluyen la fase
de repartos: esta implementación usa esa API vigente como base y conserva sus
reglas, sin convertir aquella observación antigua en una restricción funcional.
