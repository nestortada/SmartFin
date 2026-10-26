# SmartFin 6B — auditoría final de integridad financiera interna

26 de octubre de 2026, America/Bogota. Fase de **auditoría**: no se modificó código de producción,
esquema, migraciones, driver, dependencias ni reglas financieras. `BACKUP_PUBLICATION_UI_ENABLED`
sigue en `false` (`src/modules/settings/services/backupPublicationPolicy.ts:5`). No se implementó
restauración, respaldos automáticos ni el analista semanal (fuera de alcance por decisión del
propietario). Solo datos sintéticos y el paquete aislado `com.smartfin.snapshot5b2.tests`; el HONOR
no se reinició. No se avanza a otra fase.

Evidencias: [`auditoria-fase6b/`](auditoria-fase6b) — `node/` (resultados JSON) y `android/api24|api35/`
(una carpeta por campaña, `compare.json` contra Node, `ui/` con jerarquía y captura).
Procedimiento: [`scripts/phase6b/`](../scripts/phase6b). Pruebas:
[`financialAuditPhase6B.test.ts`](../__tests__/financialAuditPhase6B.test.ts).

**Veredicto: CONDICIONADO** (sección 13).

## 0. Línea base

- Git limpio en `e9e5255` (6A). Revisados AGENTS, ARQUITECTURA, BASE_DE_DATOS, informes 1.1–6A,
  auditoría de integridad (`auditoria-integridad-financiera.md`), 5E.x y 6A, y el código de
  `exactCopCents.ts`, `getDashboardSummary.ts`, `saveManualTransaction.ts`,
  `creditCardTransactionRelations.ts`, `manageCreditCards.ts`, gastos compartidos y pérdidas,
  suscripciones, `executeAiCommandPlan.ts` y la coordinación SQLite.
- Antes de cualquier cambio: **Jest 72 suites / 944 aprobadas / 14 omitidas (7 suites), 8 snapshots;
  `tsc` 0 errores; ESLint 0 errores y 3 advertencias previas** (`scripts/phase5e3/androidHarness.js` y
  dos en `scripts/phase6a/androidHarness.js`; el informe 6A citaba 1, la diferencia son las dos
  advertencias del harness 6A); `git diff --check` limpio. Jest reescribe 5 artefactos de evidencia
  (tiempos); se restauraron con `git restore`.

## 1. Matriz de garantías auditadas

Leyenda: ✅ verificada con oráculo/invariante · ⚠️ verificada con defecto caracterizado · ➖ fuera de alcance.

| Área | Garantía | Resultado | Evidencia |
|---|---|---|---|
| Movimientos | Débito/crédito correctos, sin aplicar dos veces | ✅ pesos enteros; ⚠️ centavos (D1) | P6 enteros 150 pasos sin diferencia; `financialIntegrity` |
| Transferencias | Sin ingreso/gasto por capital; 4×1000 = `max(1, round(a·0,004))` | ✅ | P6 (transferencias con impuesto); 400.000 importes `≡125 mod 250` sin desvío de medio peso |
| Reversiones | Borrar restaura el estado anterior | ✅ enteros; ⚠️ centavos: residuo interno (D1) | P2 |
| Tarjetas | Compra aumenta deuda, gasto una vez, pago reduce banco y deuda, patrimonio constante | ✅ enteros; ⚠️ residuo binario de deuda (D2) | P3, P6, `financialAtomicityPhase3B` |
| Pagos | Rechazo de $0,01/$0,40/$0,49 antes de escribir | ✅ (contrato 3B) | `financialAtomicityPhase3B`, `creditCardPaymentScreen` |
| Cuotas/extractos | Cuota solo en extracto, sin gasto duplicado | ✅ | `financialIntegrity`, `creditCardTransactionRelations` |
| Gastos compartidos | Parte personal, terceros, reembolsos, condonación, sin ingreso ficticio | ✅ (enteros de centavos `amount_minor`) | `sharedExpenses` (25), `sharedForgiveness` (20), `sharedFinancialTotals` |
| Derechos de cobro / anticipos | Posición en centavos exactos | ✅ cálculo; ⚠️ suma al patrimonio en binario (D3) | `sharedFinancialTotals`, código del dashboard |
| Suscripciones | Compromiso sin gasto; conciliación idempotente; recordatorio sin efecto monetario | ✅ | `subscriptions` (27), `subscriptionAtomicityPhase4`, `aiSubscriptions` |
| IA | Plan validado, revisión obsoleta rechazada, commit único, comprobante e idempotencia | ✅ | `financialAtomicityPhase4` (11), `aiConfirmationPhase4`, `aiDraftRepository` |
| Atomicidad | BEGIN/COMMIT/ROLLBACK, `confirmed`/`rolledBack`/`unknown`, fallo antes/después de cada escritura | ✅ | fases 2, 3A, 3B, 4, 5E, 5E.1; Android `regression-*` |
| Borrado financiero | Intención durable, época, recuperación tras reinicio | ✅ | `financialDeletionPhase5C`, `financialDeletionRecoveryPhase5E4`; Android `regression-deletion-*` |
| Dashboard mensual (6A) | Ingresos/gastos/ahorro exactos con ≤ 2 decimales | ✅ | P6 (0 diferencias en 1.150 pasos con centavos), `dashboardPhase6APrecision` |
| Disponible / patrimonio / deuda | Coinciden con el decimal exacto | ⚠️ D1, D2, D3 | P1, P3, P4, P6 |
| Presentación | Sin «−$ 0» en indicadores normales | ⚠️ D4 | P5 |
| Historial | Paginación sin omitir/duplicar, filtros, desempates, invalidación de cursores | ✅ | `transactionHistoryPagination`, 5E.2/5E.3 (50 años), `useTransactionsPagination` |
| Respaldos | Solo regresiones | ✅ | sección 9 |
| Restauración, analista semanal | — | ➖ | Limitación de producto, no fallo de esta auditoría |

## 2. Invariantes matemáticos verificados

Oráculo independiente: `BigInt` en centavos sobre los **textos decimales** de cada importe
([`probes.ts`](../scripts/phase6b/probes.ts)), sin usar `exactCopCents` ni los cálculos de producción.
Para cada valor se registra el `Double` guardado, el decimal esperado, si el `Double` es el canónico
del decimal y la presentación `Intl` de ambos.

Secuencia sembrada P6 sobre los casos de uso de producción (ingreso, gasto débito, transferencia con
4×1000, compra a crédito, pago de tarjeta y borrado aleatorio de cualquier operación anterior), con
comprobación tras **cada** paso de saldo de banco y destino, deuda, disponible, patrimonio, deuda del
dashboard e ingresos/gastos/ahorro:

1. `saldo_banco = inicial + ingresos − gastos débito − (capital + 4×1000) − pagos` (± reversos).
2. `saldo_destino = Σ capital transferido`; la transferencia no genera ingreso ni gasto.
3. `deuda = max(0, Σ compras − Σ pagos)`; el pago no es gasto; la compra a crédito es gasto una vez.
4. `patrimonio = activos − deuda`; transferencias y pagos de tarjeta lo conservan; el 4×1000 lo reduce.
5. `ahorro = ingresos − gastos` del mes.
6. `integrity_check = ok` y `foreign_key_check` vacío al final de cada sonda.

| Perfil | Pasos | Diferencias guardadas | Diferencias de dashboard | Visibles |
|---|---|---|---|---|
| Pesos enteros (semilla 61) | 150 (16 pagos) | **0** | **0** | **0** |
| Centavos (semilla 62) | 150 (9 pagos) | 251 de 450 | disponible 123, patrimonio 112, deuda 100; **mensuales 0** | patrimonio 2 |
| Centavos (semilla 63) | 1.000 (84 pagos) | 2.350 de 3.000 | deuda 961, patrimonio 876, disponible 783; **mensuales 0** | deuda 7 |

Los 1.000 pasos ocurren el mismo día: es una prueba de corrección, no una referencia de rendimiento.
Con pesos enteros todos los invariantes se cumplen bit a bit. Con centavos los invariantes contables
se cumplen como decimales, pero los `REAL` guardados dejan de ser el `Double` del decimal (sección 3).

## 3. Precisión de disponible, deuda y patrimonio

Clasificación usada: (1) diferencia interna de coma flotante, (2) diferencia visible de presentación,
(3) diferencia contable sustantiva, (4) valor almacenado incorrectamente, (5) dato fuera del contrato.

| Sonda | Escenario | Guardado / calculado | Decimal | Visible → esperado | Clase |
|---|---|---|---|---|---|
| P1 | Cuatro ingresos 36.360,06 + 36.224,28 + 19.556,65 + 5.458,51 en una cuenta | saldo **97599,49999999999** | 97.599,50 | cuenta, disponible y patrimonio **$ 97.599 → $ 97.600**; ingresos del mes (6A) $ 97.600 | 4 + 2 |
| P2 | Saldo 661.275,68, gasto 93.616,69 y borrado | **661275,6799999999** | 661.275,68 | $ 661.276 (igual) | 4 + 1 |
| P3a | Compras 96.496,10 + 64.804,55 + 68.530,35 (= 229.831) y pago de 229.831 | deuda tras pago **2,91·10⁻¹¹** | 0 | $ 0; **pagos rechazados y cierre bloqueado** | 4 + 3 funcional |
| P3b | Compras 4.229,90 + 89.392,54 + 939,56 (= 94.562) | deuda **94561,99999999999** | 94.562 | pago de $ 94.562 **rechazado**; tras pagar 94.561 queda **$ 1 imposible de pagar**; cierre bloqueado | 4 + 3 |
| P4 | Cuatro cuentas con esos saldos, cada una guardada exacta | disponible y patrimonio **97599,49999999999** | 97.599,50 | **$ 97.599 → $ 97.600** | 1 + 2 |
| P5 | Ingreso 0,30, gastos 0,10 y 0,20 | saldo **−2,78·10⁻¹⁷** | 0 | **«−$ 0»** en cuenta, disponible y patrimonio | 4 + 2 |
| P7 | Compra legítima de 10.000,40; pagos 10.001 / 10.000,40 / 10.000 / 1 / 0,40 | deuda 0,3999999999996362 tras pagar 10.000 | 0,40 | $ 0; los demás pagos rechazados; **cierre bloqueado** | contrato 3B |

Causas demostradas:

- **Saldos (D1).** `applyAccountImpact` guarda `balance + delta` en `Double`
  (`saveManualTransaction.ts:103`; igual en el pago de tarjeta, `creditCardTransactionRelations.ts`, y en
  los efectos compartidos). Cada operación con centavos redondea y el error **queda persistido**: el
  saldo sale del contrato de dos decimales y el siguiente cálculo parte de él. El borrado aplica
  `−delta` y tampoco restaura el valor anterior.
- **Deuda (D2).** `reconcileCreditCardTransactions` recalcula `Σ compras − Σ pagos` en binario y lo
  guarda. Luego `registerCreditCardPayment` usa `min(round(importe), deuda)` y exige un entero seguro:
  si la deuda es 94561,99999999999 el mínimo no es entero y el pago completo se rechaza; un residuo
  de 2,9·10⁻¹¹ o 0,99999999998 nunca alcanza $1 entero. `deleteCreditCard` exige `usedCredit = 0`.
- **Agregados del dashboard (D3).** `sumBalances`/`sumDebts` y `netWorth + receivables − advances`
  suman en binario en el orden del repositorio (`ORDER BY name`): con saldos exactos puede verse $1 menos.
  Es el mismo mecanismo que 6A corrigió solo para las cifras mensuales.
- **«−$ 0» (D4).** Consecuencia de D1 más `Intl` con `signDisplay: auto`; ocurre en Node, API 24 y HONOR.

Con importes enteros (la mayoría del uso en COP) no hay desviación: P6 enteros, los historiales
representativos de 6A y las sondas de 5E.3 son exactos. El efecto requiere movimientos con centavos.

## 4. Validación adicional de la fase 6A

- `toExactCopCents`: el barrido de 6A (±20.000,00 céntimo a céntimo y ±2.000 céntimos alrededor de cada
  potencia de 10 y de 2^30…2^46) sigue aprobado en la suite completa. La conversión nunca redondea: un
  valor con más de dos decimales, `NaN`/`±∞` o |x| ≥ 2^46 devuelve `undefined`.
- Sumas positivas y negativas e importes negativos heredados: P9 (`unsafeCombinedSavings`) guarda
  ingreso 60.000.000.000.000,01 y gasto −60.000.000.000.000,02. Cada subtotal es seguro; el ahorro en
  centavos (12.000.000.000.000.003) no lo es y el código vuelve a la suma binaria, cuyo resultado
  coincide aquí con el decimal 120.000.000.000.000,03. Coherente.
- Pérdidas compartidas: llegan como `minor / 100` y `toExactCopCents` las convierte siempre (6A, escenario
  compartido; repetido en Android dentro de `regression-6a-precision`).
- **Rutas mixtas (D5).** P8: ingresos 43.377,24 + 61.500,34 + 12.772,93 (ruta exacta, **$ 117.651**) y
  dos gastos heredados de 0,005 (IA/legado, ruta binaria, $ 0). Como un componente no es exacto, el
  ahorro usa **toda** la suma binaria: 117650,49999999999 → **$ 117.650**, mientras ingresos − gastos
  visibles dan $ 117.651 y la intención decimal (117.650,500) también. Solo ocurre con importes fuera del
  contrato de dos decimales (clase 5); 6A lo documentó como riesgo residual.
- En el resto de combinaciones (ingresos y gastos exactos, pérdidas exactas) `monthlySavings` es
  exacto: 0 diferencias mensuales en los 1.150 pasos con centavos de P6.

## 5. Idempotencia de IA y suscripciones

Sin hallazgos nuevos. Suite completa y revisión de código:

- IA: revisión del catálogo capturada antes de interpretar, rechazo conservador con revisión distinta,
  todas las escrituras en un `BEGIN IMMEDIATE`, comprobante `confirmed` en el mismo commit, repetición del
  mismo ID/contenido sin escrituras, otro contenido con el mismo ID rechazado, borrador heredado sin
  revisión no ejecutable (`financialAtomicityPhase4`, `aiConfirmationPhase4`, `aiDraftRepository`).
- IA acepta importes finitos positivos con más de dos decimales (`executeAiCommandPlan.ts:51`): es la
  entrada que alimenta D5 y la deriva de D1. Restringirla cambia el contrato (sección 12).
- Suscripciones: crear/generar/vencer/pausar/cancelar no crea movimientos; `confirmPayment` vincula un
  gasto existente compatible, repetirlo es idempotente y un movimiento no se vincula a otra ocurrencia;
  editar/borrar el gasto reabre la obligación atómicamente; recordatorios después del commit sin efecto
  monetario (`subscriptions`, `subscriptionAtomicityPhase4`, `aiSubscriptions`, Android
  `regression-notifications*`).

## 6. Atomicidad y recuperación

Sin hallazgos nuevos. Las matrices de fases 2, 3A, 3B, 4, 5E y 5E.1 (fallo antes/después de cada
escritura descubierta, comparación de todas las tablas, auditoría, revisión y métricas) pasan en la
suite completa. Solo un ROLLBACK confirmado acredita reversión; `unknown` bloquea el reenvío en la
instancia y no hay reintento automático. En Android, `regression-deletion-*` (rollback, pérdida
antes/después, `unknown` y confirmado tras reinicio), `regression-failures`, `regression-epochs`,
`regression-integrated(-restart)` y `regression-recovery` repiten la recuperación tras reinicio de
proceso con el driver real. El servicio y las alarmas de Android no participan en el rollback SQLite:
los recordatorios se reprograman después del commit y se recuperan tras reinicio (fase 4/5D).

Nota de alcance: D1/D2 no son defectos de atomicidad. Un rollback restaura **exactamente** el estado
anterior (comparación bit a bit en 3B/4); el residuo de D1 aparece en operaciones **confirmadas**.

## 7. Consistencia SQLite

Cada sonda 6B termina con `PRAGMA integrity_check = ok` y `foreign_key_check` vacío en Node, API 24
(SQLite 3.9.2) y HONOR (SQLite 3.44.5). El reinicio de datos de las sondas descubre las tablas desde
`sqlite_master` (sin lista fija). Las matrices previas comparan todas las tablas, auditoría, revisión
financiera, comprobantes IA, referencias compartidas, cuotas, extractos, obligaciones e intención de
borrado.

## 8. Resultados Android API 24 y API 35

APK sintético `com.smartfin.snapshot5b2.tests` (UID aislado, release Hermes), workspace
`C:/sf-6b-20261026` preparado con [prepare-android.cjs](../scripts/phase6b/prepare-android.cjs) desde el
de 6A: **ningún archivo de producción refrescado** (`refreshed: []`); se añadieron solo las sondas y su
despachador. Metadatos del paquete de producción sin cambios en cada campaña. Sin bases personales ni
reinicios físicos.

| | Emulador API 24 / SQLite 3.9.2 | HONOR CRT-NX3 API 35 / SQLite 3.44.5 |
|---|---|---|
| Sondas 6B (12) contra Node, valor a valor | **idénticas** ([compare](auditoria-fase6b/android/api24/compare.json)) | **idénticas** ([compare](auditoria-fase6b/android/api35/compare.json)) |
| `integrity_check` / `foreign_key_check` por sonda | ok / 0 | ok / 0 |
| UI de producción (`NetWorthCard`, `MetricsGrid`) = formato interno, 4 escenas | ✓ (2.º intento, ver abajo) | ✓ |
| Regresión 6A: precisión (18 casos), centavos 10k/100k | ✓ · 100k: 598 meses / 24 idénticos / 574 cambio interno / 7 visibles | igual |
| Regresiones 5E.6/5E.5/5E.3/5D/5C/5E/5E.1 (24 campañas) | ✓ | ✓ |
| `Intl` 0,5 / 2,5 / −0,5 / 0,49999999999999994 / −0,49999999999999994 / −2,78·10⁻¹⁷ | $1 / $3 / −$1 / $1 / −$1 / **−$0** | $1 / $3 / −$1 / $0 / −$0 / **−$0** |

Lo que se ve en pantalla (API 24 y HONOR, mismo texto):

| Escena | Ingresos del mes | Saldo disponible | Patrimonio neto | Deuda total |
|---|---|---|---|---|
| P1 balanceAccumulation | $ 97.600 | **$ 97.599** | **$ 97.599** | $ 0 |
| P4 aggregateBalances | $ 0 | **$ 97.599** | **$ 97.599** | $ 0 |
| P5 negativeZero | $ 0 | **−$ 0** | **−$ 0** | $ 0 |
| P3b cardResidueBelow | $ 0 (gastos $ 94.562) | $ 905.439 | $ 905.438 | **$ 1** |

Los defectos D1–D4 son, por tanto, **visibles en la interfaz real** con el driver y `Intl` reales, y
idénticos en ambas plataformas (no dependen de la versión de SQLite ni de ICU: los `Double` guardados
coinciden bit a bit). La diferencia de `Intl` entre plataformas solo aparece en binarios no exactos
muy próximos a ±0,5, como ya documentó 6A.

Fallo de instrumentación corregido: en API 24 los cuatro lectores de UI fallaron porque
`NetWorthCard` muestra su título en mayúsculas («PATRIMONIO NETO») y el lector heredado de 6A lo
buscaba con mayúsculas exactas. Se cambió solo [ui.cjs](../scripts/phase6b/ui.cjs) para compararlo sin
distinguir mayúsculas y se repitieron los cuatro casos; los intentos originales se conservan con sufijo
`-attempt-reader-case`. El HONOR ya usó el lector corregido.

## 9. Calidad y rendimiento

- Final: **Jest 73 suites / 957 aprobadas / 14 omitidas, 8 snapshots** (+1 suite, +13 pruebas de 6B;
  ninguna prueba previa modificada); `tsc` 0; ESLint **0 errores**, 5 advertencias: las 3 previas y 2
  `no-bitwise` del generador sembrado de `scripts/phase6b/probes.ts`. No se corrigieron porque cambiar
  el archivo invalidaría la atestación de hash del APK ya ejecutado; son advertencias de estilo en
  instrumentación. `git diff --check` limpio. Artefactos reescritos por Jest restaurados.
- Las pruebas `defect 6B-…` **caracterizan el resultado incorrecto actual** a propósito y deben
  reescribirse al valor del oráculo cuando se autorice la corrección. No se introdujo ninguna tolerancia
  ni se cambiaron límites de pruebas.

Rendimiento del dashboard con la acumulación de 6A, historiales representativos oficiales
(1k / 6 meses, 10k / 5 años, 100k / 50 años), mediana, pre‑6A → 6A alternados en el mismo proceso:

| Volumen | Node (21 ejecuciones) | API 24 (9) | HONOR (9) |
|---|---|---|---|
| 1.000 | 1,09 → 1,19 ms | 21,5 → 22,6 ms | 14,9 → 14,7 ms |
| 10.000 | 0,99 → 1,17 ms | 17,9 → 16,7 ms | 16,5 → 15,5 ms |
| 100.000 | 1,10 → 1,23 ms | 16,4 → 15,9 ms | 92,6 → 94,9 ms |

Sin regresión atribuible a 6A: las diferencias están dentro del ruido y cambian de signo. El HONOR a
100k marcó ~93 ms con **ambas** implementaciones (en 6A, ~49 ms): variación del entorno del
dispositivo (condiciones en `device-conditions.json`), no de 6A, porque la comparación es en el mismo
proceso y base. Las sondas de 1.000 operaciones en un día y los importes extremos son pruebas de
corrección/estrés, no referencias de rendimiento.

## 10. Defectos reales encontrados

| ID | Defecto | Severidad | Clase | Reproducción |
|---|---|---|---|---|
| **6B-D2** | La deuda de tarjeta acumula error binario: tras pagar el total exacto puede quedar un residuo (2,9·10⁻¹¹ o 0,99999999998) que ningún pago acepta y que **bloquea el cierre**; el pago del total exacto puede rechazarse | **Media‑alta** (bloqueo funcional; hasta $1 de deuda que no existe) | 4 + 3 | P3a, P3b |
| **6B-D1** | El saldo de cada cuenta se guarda acumulando en binario: con centavos sale del contrato de dos decimales, la reversión no restaura el valor y puede verse $1 menos que el decimal exacto | **Media** (dato persistido; visible solo cerca de ,50) | 4 + 2 | P1, P2, P6 |
| **6B-D3** | Disponible, deuda total y patrimonio del dashboard suman saldos en binario: saldos exactos pueden mostrar $1 menos | **Baja‑media** | 1 + 2 | P4 |
| **6B-D4** | Un saldo cero alcanzado con centavos se muestra «−$ 0» | **Baja** | 2 (consecuencia de D1) | P5 |
| **6B-D5** | Con importes heredados/IA de más de dos decimales, el ahorro vuelve entero a la suma binaria y puede diferir en $1 de ingresos − gastos visibles | **Baja** | 5 | P8 |
| **6B-C1** | Una deuda legítima con centavos (compra de 10.000,40) nunca puede saldarse ni cerrarse la tarjeta (consecuencia del contrato de pago entero de 3B) | **Media** (decisión de producto) | contrato | P7 |
| 6B-O1 | Mensaje con mojibake visible: «Monto invÃ¡lido.» (`saveManualTransaction.ts:394`) | Muy baja (presentación) | 2 | código |

Ninguno afecta a importes enteros, que no presentan desviaciones en ninguna sonda.

## 11. Riesgos de producto fuera del alcance

- Restauración de respaldos no implementada y publicación desactivada: limitación del producto, no fallo
  de esta auditoría mientras siga desactivada.
- Analista semanal: excluido por decisión del propietario.
- Magnitudes ≥ 2^46 COP: el `Double` no distingue centavos (6A).
- Deuda de «tarjeta por clasificar» fuera del dashboard hasta asociarla (regla vigente).
- Coordinación limitada al mismo runtime/conexión; sin recibo durable universal fuera de IA.

## 12. Correcciones mínimas propuestas (tareas separadas, no aplicadas)

1. **D2 + D1 (recomendada primero).** Guardar saldos y deuda en el `Double` canónico del decimal:
   cuando ambos operandos tienen ≤ 2 decimales y están bajo 2^46, calcular `(c(saldo) + c(delta)) / 100`
   con `toExactCopCents`, y reconciliar la deuda como `sumExactCopCents(compras) − sumExactCopCents(pagos)`;
   en caso contrario conservar la suma actual (misma política que 6A). Cambia resultados persistidos:
   requiere autorización, pruebas de equivalencia con enteros (deben quedar bit a bit) y una decisión
   sobre saldos históricos ya desviados (no reescribir sin autorización; la deuda se corrige sola en la
   siguiente reconciliación porque se recalcula desde los movimientos; los saldos no).
2. **D3.** Aplicar la acumulación en centavos de 6A a `sumBalances`, `sumDebts` y a la posición
   compartida del patrimonio, con caída a la suma actual fuera de contrato. Sin cambio de contrato.
3. **C1.** Decisión de producto: permitir que el pago salde exactamente una deuda con centavos (p. ej.
   aceptar `importe = deuda` cuando la deuda es un decimal de dos cifras) o redondear la deuda residual
   < $1. Cambia el contrato de 3B: requiere aprobación explícita.
4. **D4.** Normalizar en `formatCurrency` los valores que redondean a 0 (o `signDisplay: 'negative'`
   con verificación en API 24, donde el soporte de `Intl` difiere). Tras 1–2 desaparece casi siempre.
5. **D5.** Validar a dos decimales los importes de IA al confirmar (cambio de contrato, ya señalado en
   6A) o calcular el ahorro con las cifras ya calculadas cuando solo un componente es heredado.
6. **O1.** Corregir la codificación del literal.

## 13. Veredicto

**CONDICIONADO.**

El núcleo financiero es **íntegro en estructura y atomicidad**: reglas contables, invariantes,
idempotencia de IA y suscripciones, rollback exacto, recuperación tras reinicio, integridad SQLite,
historial y respaldos (regresiones) se cumplen en Node, API 24 y HONOR. Con **importes en pesos enteros**
todos los indicadores son exactos bit a bit, y 6A sigue siendo correcto.

No puede declararse estable sin condiciones porque, con importes de dos decimales que la propia UI
acepta, hay defectos reales y visibles en el **valor persistido** de saldos y deuda (D1, D2) y en los
agregados del dashboard (D3, D4). El más grave (D2) bloquea pagar o cerrar una tarjeta. Ninguno es un
fallo de atomicidad ni bloquea el desarrollo normal de funcionalidades que no toquen esos cálculos.

Condiciones para pasar a **aprobado**:

1. Tarea separada y autorizada para D2 + D1 (sección 12.1), con decisión explícita sobre saldos
   históricos ya desviados.
2. Tarea separada para D3 (sección 12.2).
3. Decisión de producto sobre C1 (sección 12.3).

D4, D5 y O1 pueden agruparse con esas tareas o posponerse sin bloquear. No se avanza a otra fase.
