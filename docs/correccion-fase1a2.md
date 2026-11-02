# SmartFin — Fase 1a.2: corrección de extractos multiciclo

1 de noviembre de 2026, America/Bogota. Rama `main`, commit `f113947`, con la Fase 1a.1 sin confirmar en el
árbol de trabajo (motor `installmentPlan.ts` y sus pruebas). Sin commit ni push. Solo datos sintéticos y SQLite
en memoria.

Evidencias: [`correccion-fase1a2/node/before.json`](correccion-fase1a2/node/before.json) (antes de modificar
producción) y `after.json` (después). Pruebas:
[`creditCardStatementsPhase1a2.test.ts`](../__tests__/creditCardStatementsPhase1a2.test.ts), con los escenarios de
[`phase1a2StatementScenarios.ts`](../__tests__/helpers/phase1a2StatementScenarios.ts).

**Veredicto:** el defecto de los extractos multiciclo está corregido en Node.

> **Actualización:** la equivalencia Node–Android está validada en API 24 y API 35. `phase1a2-statements` da
> 13/13 en cada dispositivo, con 5.530 campos y 0 diferencias, y las regresiones 6B.3 aprueban (103/103 por
> dispositivo). Cierre de atomicidad r2 (matriz con reloj fijado): 66/66 por dispositivo, con los 12 puntos de fallo
> de escritura del extracto ejercitados, más 53/53 de protección histórica. **Fase 1a.2 cerrada**: ver
> [`validacion-fase1a2/README.md`](validacion-fase1a2/README.md), secciones 6 y 7.

## 1. Defecto reproducido (antes del cambio)

`before.json` se generó con los escenarios A–D sobre el código sin modificar. Lo produjo una prueba de captura
temporal que ejecutaba las mismas funciones del helper.

| Escenario | Antes | Esperado |
|---|---|---|
| A · 600.000 a 6 cuotas, corte día 20 | `[100.000, 0, 0, 0, 0, 0, 0]` | `[100.000 × 6, 0]` = 600.000 |
| B · A + 300.000 a 3 cuotas (nov.) | `[100.000, 100.000, 0, …]` = 200.000 | `[100.000, 200.000, 200.000, 200.000, 100.000, 100.000, 0]` = 900.000 |
| C · Pago de 400.000 el 12 nov. por el extracto de octubre | Noviembre: total 0, `paid`, aunque hay 50.000 de compras nuevas | Ver sección 4 (limitación) |
| D · Fechas límite | Solo el primer ciclo factura | Cada ciclo factura su cuota |

En todos los escenarios, la deuda, el banco, el cupo, el gasto, el ingreso, el patrimonio, los movimientos y los
registros de cuotas eran coherentes. El defecto estaba únicamente en el extracto.

## 2. Causa raíz

`reconcileCreditCardTransactionsInScope` solo sumaba las compras **fechadas dentro del ciclo**, y a una compra a
cuotas le asignaba `monthly_amount`. Las cuotas 2 a n de compras de meses anteriores no tenían ninguna fuente,
porque no existía un calendario. Además, `monthly_amount = Math.round(total / n)` en pesos crea o pierde dinero.

## 3. Cambios

| Archivo | Cambio |
|---|---|
| `src/modules/creditCards/useCases/creditCardStatementCharges.ts` (nuevo) | `statementChargesForCycle`, función pura. Calcula los cargos de un ciclo con el motor (`buildInstallmentPlan` + `installmentBilledInCycle`) y etiqueta el origen de cada cargo |
| `src/modules/creditCards/useCases/creditCardTransactionRelations.ts` | La reconciliación usa los cargos del motor. Protege los históricos: el extracto solo se escribe para el ciclo evaluado, nunca si la tarjeta ya tiene un extracto de un ciclo posterior y nunca sobre uno `closed`. Conserva el `created_at` guardado. Devuelve un `CreditCardReconciliationReport` de diagnóstico (los llamadores existentes lo ignoran) |
| `src/modules/creditCards/repositories/sqliteCreditCardRepository.ts` | Solo un comentario: el SQL de `saveStatements` no cambia (ver sección 5) |
| `scripts/phase6b1/probes.ts` | Solo el tipo de `reconcileCreditCardTransactions`, que ahora devuelve un informe |
| Pruebas | Suite nueva; reproducciones de Fase 0 promovidas; equivalencia 3A.1 ajustada a la protección de históricos (sección 7) |

No cambian:
- la deuda: sigue siendo `max(0, Σ compras − Σ pagos)` sobre todo el historial;
- los saldos, el gasto (cada compra cuenta una vez, sin movimientos por cuota) y el patrimonio;
- los pagos, `paid_installments`, `monthly_amount` y el estado de las compras;
- el esquema y las migraciones.

## 4. Reglas nuevas de reconciliación

1. **Compra sin plan activo de varias cuotas:** aporta su importe completo al ciclo que contiene su fecha. Es la
   regla anterior (`singleCharge`).
2. **Plan completo (`projected` o `confirmed`):** aporta solo la cuota que el motor asigna a ese ciclo, en
   centavos exactos.
   - Regla D1: primera cuota en el ciclo de la compra. Regla D2: el residuo va a la última cuota.
   - Las compras de meses anteriores aparecen cuando les toca, nunca dos veces en el mismo ciclo, y la suma de
     todos los ciclos es el capital exacto.
3. **Plan que no se puede programar** (`pendingVerification`, `requiresDecision` o `invalid`):
   - no se inventa ningún calendario;
   - para no quitar un cargo que ya se reconocía, se conserva la regla heredada: `monthly_amount`, solo en el
     ciclo de la compra (`legacyUnverified`);
   - se informa el motivo en `notices`.
   - Casos acotados: tarjeta sin `closingDay`; compra hecha el día del corte (la tarjeta no tiene política para
     ese día); importe histórico inexacto; cuotas de 0 centavos. En este último caso el `monthly_amount`
     heredado ya es 0, así que no se factura ninguna cuota nula como obligación válida.
4. **Estado proyectado:** el extracto guardado no tiene columna para distinguir proyectado de confirmado (no hay
   migración 5).
   - La distinción se conserva en el informe de la reconciliación (`installmentProjected` /
     `installmentConfirmed` / `legacyUnverified`).
   - Hoy todos los planes son `projected`: no hay dónde guardar un primer ciclo confirmado.
5. **Pagos dentro del ciclo:** se mantiene la regla vigente. El total es `max(0, cargos del ciclo − pagos fechados
   en el ciclo)` y el pago mínimo, `Math.round(10 % del total)`.
   - **Limitación (escenario C):** un pago hecho en noviembre para el extracto de octubre compensa los cargos de
     noviembre (150.000 = 50.000 nuevos + cuota 2 de 100.000 → total 0, `paid`).
   - El modelo no asocia pagos con extractos, así que esa asociación no se inventa. La deuda (550.000) es
     correcta.
6. **Ciclos futuros:** `statementChargesForCycle` los proyecta en memoria (prueba de 100.000 a 7 cuotas). No se
   guardan extractos futuros.

## 5. Protección de históricos e `INSERT OR REPLACE`

- **Cómo se guardan:** con id `statement-auto-<tarjeta>-<inicio>-<fin>`. Antes, cada reconciliación reemplazaba
  el ciclo evaluado con `INSERT OR REPLACE`. Los ciclos anteriores quedaban congelados en su última
  reconciliación, muchos con `open` y total 0.
- **Criterio de ciclos modificables:** solo el ciclo que contiene la fecha evaluada, y solo si:
  - no existe un extracto guardado de la misma tarjeta con un corte posterior (`supersededByLaterCycle`), y
  - el guardado de ese ciclo no está `closed` (`storedClosed`).
- **Qué no se toca:** los extractos anteriores, incluidos los `open` antiguos, ni siquiera cuando el reloj
  retrocede. La deuda se sigue reconciliando, porque se deriva de los movimientos.
- **El estado `paid` del ciclo en curso:** es provisional y se recalcula, como antes. Una compra posterior en el
  mismo ciclo debe aparecer. Un `paid` de un ciclo ya cerrado no se reescribe.
- **`INSERT OR REPLACE` en extractos:** borra e inserta la fila. Ninguna tabla referencia `credit_card_statements`,
  así que solo se pierde el `rowid`.
  - El `created_at` ahora se conserva desde el dominio.
  - **Se mantiene el SQL** porque las campañas de atomicidad 6B.3 validadas en Android (API 24 y 35) cuentan los
    puntos de escritura e inyectan fallos por ese texto. Probé un upsert y cambiaba esos 10 puntos de fallo
    validados, así que lo revertí.
  - Eliminar los `INSERT OR REPLACE` peligrosos en tablas con hijos (por ejemplo `installment_purchases`) sigue
    siendo requisito previo de la Fase 1a.3.
- **Diagnóstico de solo lectura:** `statementChargesForCycle` puede evaluar un ciclo histórico sin escribir nada.
  La prueba muestra que un `open` antiguo con 0 debería tener la cuota 3 (100.000) y lo deja intacto. No se
  hace ninguna corrección retroactiva.

## 6. Antes y después (verificado por pruebas)

**Magnitudes financieras:** banco, deuda, cupo, gasto, ingreso, patrimonio, movimientos, registros de cuotas,
`integrity_check` y `foreign_key_check` son **idénticos** a `before.json` en cada paso de A, B, C y D. Solo
cambian los extractos.

| Escenario | Extracto antes → después | Pago mínimo | Estado |
|---|---|---|---|
| A | 100.000, 0×6 → 100.000×6, 0 | 10.000 en cada ciclo facturado | `pending` (antes `open` desde el 2.º ciclo) |
| B | Σ 200.000 → Σ 900.000 (oráculo BigInt) | 10.000 / 20.000 | `pending` |
| C oct. | 400.000 → 400.000 | 40.000 | `pending` |
| C nov. | 0 `paid` → 0 `paid` (cargos 50.000 → 150.000; pagos del ciclo 400.000) | 0 | sin cambio (limitación) |
| D 100.000 / 3 | 33.333 → 33.333,33 · 33.333,33 · 33.333,34 | 3.333 | proyectado |
| D corte 31 | 75.000 → 75.000 el 31 ene, 28 feb, 31 mar y 30 abr | 7.500 | proyectado |
| D bisiesto (corte 30) | 100.000 → 100.000 el 29 feb, 30 mar y 30 abr de 2028 | 10.000 | proyectado |
| D compra el día del corte | Igual que antes (100.000 solo en oct.) | Igual | `legacyUnverified` + `missingClosingDayPurchasePolicy` |
| D tarjeta sin corte | Igual que antes (mes calendario) | Igual | `legacyUnverified` + `missingClosingDay` |
| D 0,01 / 2 | 0 `open` → 0 `open` | 0 | `requiresDecision` |
| D una cuota | Igual | Igual | `singleCharge` |

**Flujos ordinarios sin cuotas:** compras con centavos, compra el día del corte, gasto débito, transferencia,
reembolso y pago parcial dan extractos y cuentas iguales a la copia congelada anterior a 6B.3.

## 7. Pruebas

- **Suite nueva (estable):** 25 pruebas.
  - Escenarios A–D y regresiones promovidas de la Fase 0.
  - Protección de extractos `closed`, `paid` y `open` antiguos, y del retroceso de reloj.
  - Reconciliación repetida.
  - Edición y eliminación.
  - Pagos parciales y de deuda total: el plan queda intacto y no se marca como saldado.
  - Fallos inyectados con triggers `RAISE(ABORT)`, con rollback íntegro de pago, débito, deuda y extractos.
  - Proyección futura, no mutación de entradas.
- **Fase 0:**
  - se eliminó `creditCardStatements.repro.ts`: sus caracterizaciones ya no se cumplen y sus aceptaciones pasaron
    a la suite estable;
  - en `installmentRounding.repro.ts` la aceptación pasó a la estable y se conserva la caracterización de
    `monthly_amount` redondeado, que no cambia.
  - Las evidencias de `linea-base-fase0/node/` se conservan.
- **Equivalencia 3A.1 (1.000, 10.000 y 100.000 filas):** sigue comparando todas las tablas bit a bit, con tres
  excepciones justificadas, todas por la protección de históricos:
  - los extractos de ciclos anteriores a uno guardado que la copia congelada crea al retroceder la fecha (se
    exige que cada uno sea realmente anterior);
  - el `rowid` de los extractos, desplazado por esas filas;
  - `financial_data_revision.revision`, que debe diferir exactamente en una revisión por cada extracto omitido.
- **Atomicidad:** las suites de atomicidad 0, 3A, integridad, 6B.3 y coordinación no cambian (mismo SQL y mismos
  puntos de escritura). Los estados `confirmed`, `rolledBack` y `unknown` no cambian, y no hay reintentos ni
  compensaciones.

## 8. Validación Android (pendiente de autorización)

La validación de 6B.3 está cerrada: API 24 102/102, API 35 102/102, 1.715 campos sin diferencias. Como esta fase
cambia la lógica de reconciliación, hay que volver a validar Node–Android con el código actual. **No se ha
compilado ni ejecutado nada en Android.**

Procedimiento propuesto. Sigue el patrón de
[`validacion-fase6b3-1/authorization/README.md`](validacion-fase6b3-1/authorization/README.md) y requiere
autorización expresa:

1. **Workspace:** crear un workspace nuevo, por ejemplo `C:/sf-1a2-<fecha>`, a partir de `C:/sf-6b3-20261101`.
   Refrescar las fuentes de producción que cambiaron:
   - `installmentPlan.ts`
   - `creditCardStatementCharges.ts`
   - `creditCardTransactionRelations.ts`
   - `sqliteCreditCardRepository.ts` (solo el comentario)
   - `shared/utils/exactCopCents.ts` (sin cambios; dependencia)
2. **Campaña nueva `phase1a2-statements`:** reutiliza las funciones de `phase1a2StatementScenarios.ts` (escenarios
   A–D) en el APK sintético `com.smartfin.snapshot5b2.tests`. Compara campo a campo con Node:
   - extractos;
   - deuda, banco y patrimonio;
   - `integrity_check` y `foreign_key_check`.
3. **Campañas 6B.3:** volver a ejecutarlas para confirmar que no hay regresiones (sondas, atomicidad, `unknown`,
   reapertura y `phase6a-precision`).
4. **Comandos** (un comando por llamada, con los hooks activos):

```powershell
node scripts/phase6b3/prepare-android.cjs   # adaptar a destino sf-1a2 y fuentes de la lista
./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'
./scripts/phase6b3/run-all.ps1 -Serial emulator-5554 -Api 24
./scripts/phase6b3/run-all.ps1 -Serial AXCC6R3919012932 -Api 35
```

En ningún caso se toca el paquete personal `com.smartfin`.

> **Actualización:** la campaña ya está preparada (arnés, referencia Node de 5.530 campos, preparador, runner e
> inventario), pero no se ha ejecutado. El procedimiento vigente, la matriz por dispositivo (115 casos) y los
> criterios de cierre están en [`validacion-fase1a2/README.md`](validacion-fase1a2/README.md); los comandos de
> arriba se conservan como propuesta original. El análisis del escenario C está en
> [`analisis-escenario-c-fase1a2.md`](analisis-escenario-c-fase1a2.md).

## 9. Riesgos y decisiones restantes

- **Pagos y extractos:** la limitación del escenario C solo se resuelve con imputaciones (Fase 1a.3 o posterior),
  o con una regla de extracto que arrastre saldos anteriores. Esa regla cambiaría el modelo de extractos y
  requiere decisión.
- **Política del día de corte (`closingDayPurchasePolicy`):** no existe en los metadatos. Las compras hechas ese
  día siguen con la regla heredada.
- **Cuotas de 0 centavos (`requiresDecision`):** siguen sin facturarse y requieren decisión.
- **Estado proyectado en el extracto:** no hay dónde guardarlo. Hoy solo aparece en el informe.
- **Tarjetas sin día de corte:** usan meses calendario y la regla heredada.
- **Extractos antiguos `open` con totales heredados:** se conservan como estaban. Si se quieren corregir, hará
  falta una decisión explícita y una corrección auditada.
- **Prueba inestable `subscriptionAtomicityPhase4`:** en la ejecución completa puede fallar por desbordamiento de
  pila en la recursión síncrona del adaptador de pruebas `realSQLite`, en un módulo que esta fase no toca. Aislada
  pasa (14/14), y también después de `installmentPlan.test.ts` con el orden forzado (93/93).
  - **Diagnóstico posterior:** no es una regresión. El adaptador `realSQLite` llama de forma síncrona al callback
    de `transaction.executeSql`, así que cada sentencia del programa de `runSQLiteTransaction` anida otro `advance`
    en la pila.
  - El mantenimiento de esa prueba (una suscripción diaria desde 2022, con reloj fijo) ejecuta muchas sentencias
    por lote. Con la pila por defecto (984 KB) pasa; con `--stack-size=700` falla siempre, tanto en el árbol actual
    como en una copia limpia de `HEAD f113947` sin 1a.1 ni 1a.2.
  - El fallo intermitente se debe a la variación del tamaño de los marcos según el estado del JIT. El driver
    Android invoca los callbacks de forma asíncrona y no acumula pila.
  - **Corrección propuesta en tarea aparte:** hacer asíncrono el callback del adaptador de pruebas (por ejemplo
    con `queueMicrotask`) y añadir una prueba con `--stack-size` reducido. No se ha cambiado nada.

## 10. Preparación para la Fase 1a.3

- Eliminar `INSERT OR REPLACE` en `installment_purchases`, porque tendrá hijos (imputaciones y revisiones). En la
  auditoría 1a, `REPLACE` + `CASCADE` borró hijos sin aviso.
- Migración 5 sin `ON DELETE CASCADE`, con un primer ciclo confirmado por compra y la política del día de corte
  por tarjeta. Así los planes podrán pasar a `confirmed`.
- Las imputaciones deben alimentar `statementChargesForCycle` y el informe sin cambiar la deuda.
