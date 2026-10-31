# SmartFin 6B.1 — saldos y deudas persistidos con centavos exactos

26 de octubre de 2026, America/Bogota. Fase de **corrección** autorizada para 6B-D1 y 6B-D2
([auditoría 6B](auditoria-fase6b.md)). No se cambió esquema, migraciones, dependencias ni driver;
`BACKUP_PUBLICATION_UI_ENABLED` sigue en `false`; no se implementó restauración, respaldos automáticos
ni el analista semanal; no se modificaron saldos históricos ni se crearon movimientos. 6B-C1, 6B-D3,
6B-D4 (formato), 6B-D5 y 6B-O1 quedan fuera. No se avanza a 6B.2.

Evidencias: [`correccion-fase6b1/`](correccion-fase6b1) — `node/` (reproducción previa, resultados
antes/después y equivalencias) y `android/api24|api35/` (una carpeta por campaña, `compare.json` contra
Node, `ui/` con jerarquía y captura). Sondas: [`scripts/phase6b1/probes.ts`](../scripts/phase6b1/probes.ts).
Pruebas: [`financialCorrectionPhase6B1.test.ts`](../__tests__/financialCorrectionPhase6B1.test.ts).

**Veredicto: D1 y D2 CORREGIDOS para operaciones nuevas dentro del contrato de dos decimales** (sección 12).

## 0. Línea base

- Git limpio en `5656f36` (6B). Revisados AGENTS, ARQUITECTURA, BASE_DE_DATOS, auditoría 6B completa y
  sus sondas P1/P2/P3/P6, informes 3A, 3B, 6A y 6B, `exactCopCents.ts`, `saveManualTransaction.ts`,
  `creditCardTransactionRelations.ts`, `manageCreditCards.ts` y todos los casos de uso que escriben saldo
  o deuda (sección 2).
- Antes de cualquier cambio: **Jest 73 suites / 957 aprobadas / 14 omitidas (7 suites), 8 snapshots;
  `tsc` 0; ESLint 0 errores y 5 advertencias previas; `git diff --check` limpio.** Jest reescribe 5
  artefactos de evidencia de fases anteriores; se restauraron con `git restore`.

## 1. Reproducción original de D1 y D2

Antes de tocar producción se ejecutaron las sondas 6B.1 sobre el código de `5656f36`
([reproduction-before-fix.json](correccion-fase6b1/node/reproduction-before-fix.json)). Las mismas
sondas se ejecutan después sobre una copia congelada del código anterior
([`pre6B1SaveManualTransaction.ts`](../__tests__/helpers/pre6B1SaveManualTransaction.ts),
[`pre6B1CreditCardRelations.ts`](../__tests__/helpers/pre6B1CreditCardRelations.ts)) para comparar
antes/después en el mismo proceso, en Node y en Android.

| Sonda | Antes (5656f36) | Decimal |
|---|---|---|
| P1: ingresos 36.360,06 + 36.224,28 + 19.556,65 + 5.458,51 | saldo `97599.49999999999` → **$ 97.599** | 97.599,50 → $ 97.600 |
| P2: saldo 661.275,68, gasto 93.616,69 y borrado | `661275.6799999999`, no restaura | 661.275,68 |
| Caso A: compras = 229.831 y pago 229.831 | deuda `2.9103830456733704e-11`, extracto `pending`, **cierre rechazado** | 0 |
| Caso B: compras = 94.562 | deuda `94561.99999999999`; **pago de 94.562 rechazado**; cierre rechazado | 94.562 |
| P5: ingreso 0,30, gastos 0,10 y 0,20 | `-2.78e-17` → «−$ 0» | 0 |
| P6 centavos 150 / 1.000 pasos | 251 / 2.350 valores persistidos no canónicos | 0 |
| P6 pesos enteros 150 pasos | 0 diferencias | 0 |

## 2. Inventario de escritores monetarios

| Escritor | Ruta real | Valor escrito | Consumidores | Transacción |
|---|---|---|---|---|
| `applyAccountImpact` (`saveManualTransaction.ts`) | Alta, edición (reverso + nuevo impacto), borrado (`deleteManualTransactionSafely`), transferencias y su pata `-in`, 4×1000, acciones rápidas (`updateTransactionQuickly` → `saveManualTransaction`), IA (`executeAiCommandPlan` → save/delete), compra compartida (`createSharedExpenseApi` → save/delete) | `accounts.balance_amount`; `debt_balance_amount` solo si la cuenta es tarjeta (ruta inalcanzable desde el flujo manual, que excluye tarjetas) | Dashboard, Movimientos, Débito, efectos compartidos | Ámbito manual (fase 2/3B), lote IA (fase 4), comando compartido |
| `cashMovement` (`createSharedExpenseApi.ts`) | Reembolso recibido (`recordReceipt`) y devolución de anticipo (`returnAdvance`) | `balance_amount` | Igual | Comando compartido |
| `registerCreditCardPaymentInScope` | Pago de tarjeta (pantalla de tarjetas) | Débito del origen; `remainingDebt` del resultado | Pantalla de tarjetas, dashboard | `withCreditCardPaymentScope` (3A) |
| `reconcileCreditCardTransactionsInScope` | Llamado tras compra/edición/borrado de crédito o pago, pago (antes y después), acciones rápidas, guardar/asociar tarjeta, cierre (3B) | `debt_balance_amount` de cada tarjeta activa; `credit_card_statements.total_amount`, `minimum_payment_amount`, `status` | Dashboard (deuda, patrimonio), `getCreditCardsOverview` (usado, disponible, extracto), validación de pago y cierre | Ámbito del llamador |
| `manageDebitCards.saveDebitCard`, alta de cuenta en `TransactionsScreen`, `ensureUnclassifiedCreditCardAccount` | Valor introducido o 0; no acumulan | — | — | Sin cambios (no es `saldo + delta`) |

Consumidores sin escritura, sin cambios: `sumBalances`/`sumDebts` del dashboard (6B-D3),
`sharedFinancialSnapshot`/`sharedFinancialEffects` (agregados y deltas informativos de comandos
compartidos, validados solo como finitos), `getCreditCardsOverview` (`availableCredit = límite − usado`,
presentación no persistida). Suscripciones no escriben saldo ni deuda; registran gastos por
Movimientos y concilian vínculos.

## 3. Causa de cada defecto

- **D1.** Cada escritor guardaba `saldo + delta` en `Double`. Con centavos el resultado de la suma
  binaria no es el `Double` canónico del decimal; el error queda **persistido** y la siguiente operación
  parte de él. El borrado aplicaba `−delta` sobre un valor ya desviado, por lo que no restauraba.
- **D2.** La reconciliación recalculaba `Σ compras − Σ pagos` en binario y lo guardaba. El pago usa
  `min(round(importe), deuda)` y exige pesos enteros: con `94561.99999999999` el mínimo no es entero y
  se rechaza; tras un pago exacto queda un residuo (`2,9·10⁻¹¹`) que ningún pago acepta y que bloquea el
  cierre (`usedCredit > 0`).

## 4. Cambios de producción

1. [`exactCopCents.ts`](../src/shared/utils/exactCopCents.ts): `addCopAmounts(base, delta, site)` y
   `differenceOfCopSums(plus, minus, site)`. Convierten con `toExactCopCents` (sin redondear), operan en
   enteros seguros y convierten **una sola vez** a `céntimos / 100`. Solo se usa la ruta exacta si todos
   los operandos son canónicos de ≤ 2 decimales bajo 2^46 y el resultado es entero seguro bajo
   2^46 COP; en otro caso devuelven **exactamente** la suma binaria anterior, en el mismo orden, con
   `path: 'binaryLegacy'`, y la registran en un contador local en memoria por escritor
   (`getCopArithmeticFallbacks`), sin persistencia ni red.
2. `applyAccountImpact`: saldo y deuda con `addCopAmounts` (`manualTransaction.balance|debt`).
3. `cashMovement` compartido: `addCopAmounts` (`sharedExpense.cashMovement`).
4. Reconciliación de tarjetas: deuda = `max(0, differenceOfCopSums(compras, pagos))`; cargos y total del
   extracto con la misma función (cuotas activas siguen aportando `monthlyAmount`); `minimumPaymentAmount`
   y `status` se derivan como antes del total, ahora exacto.
5. Pago de tarjeta: débito del origen y `remainingDebt` con `addCopAmounts`. La validación
   `min(round(importe), deuda)` + entero seguro ≥ $1 (contrato 3B) **no cambia**.

Sin cambios: importes de movimientos, 4×1000 (`max(1, round(a·0,004))`), cuotas (`round(total/n)`),
reglas de inclusión, predicados, órdenes de lectura, `BEGIN/COMMIT/ROLLBACK`, recibos IA, épocas, CSV,
esquema y presentación.

## 5. Antes/después contra el oráculo decimal

Oráculo: `BigInt` en céntimos sobre los textos decimales, sin `exactCopCents`
([`probes.ts`](../scripts/phase6b1/probes.ts), [prueba](../__tests__/financialCorrectionPhase6B1.test.ts)).

| Comprobación | Antes | Después |
|---|---|---|
| 120.060 pares en pesos enteros (incl. 0, ±1, 2^30, 2^46−1, 2^46, 2^53−1, `MAX_SAFE_INTEGER`−1) | — | **idénticos bit a bit** a `base + delta` |
| 50.000 sumas de 0, 1 y 2 decimales, con negativos | 11.127 habrían diferido | **50.000 = oráculo** |
| 10.000 deltas acumulados y revertidos | — | vuelve a `661275.68` exacto; cada paso = oráculo |
| P6 pesos enteros, 150 pasos (16 pagos) | 0 diferencias | **traza idéntica paso a paso a la anterior** |
| P6 centavos 150 pasos | 251 no canónicos; activo−deuda≠patrimonio decimal en 142 | **0 / 0** |
| P6 centavos 1.000 pasos (84 pagos) | 2.350 no canónicos; 985 | **0 / 0** |
| P1 | `97599.49999999999` ($ 97.599) | `97599.5` ($ 97.600) |
| Transferencias con centavos y 4×1000 (1.234,56 / 99,99 / 250,05 / 80.000,33; borrado de una) | origen `918189.0599999999` | `918189.06`; impuestos idénticos ($ 326) |
| Ingreso/gasto/ahorro mensual (6A) | 0 diferencias | 0 diferencias |

Las sondas 6B originales se reejecutaron sobre el código corregido; sus pruebas `defect 6B-D1/D2/D4`
caracterizaban el error y se reescribieron al valor del oráculo, como prescribía el informe 6B
(`6B-D1 corrected in 6B.1…`, `6B-D2 corrected in 6B.1…`). D3 (agregación del dashboard), C1 y D5 siguen
caracterizados sin cambios.

## 6. Reversiones y pagos completos

- **P2:** gasto → `567658.99` (= oráculo); borrado → `661275.68` **bit a bit**.
- **200 altas aleatorias + edición (importe y cuenta) + borrado en orden aleatorio:** ambas cuentas
  vuelven bit a bit a `123456.78` y `0.01` (antes: `123456.78000000717`).
- **Caso A:** deuda tras compras `229831`; pago `229831` → deuda **`0`**, banco `770169`, extracto
  `0 / paid`, gasto del mes sigue en 229.831 (el pago no es gasto), **tarjeta cerrada**.
- **Caso B:** deuda `94562`; **pago de 94.562 aceptado**, deuda `0`, extracto `paid`, cierre aceptado.
  El intento posterior de $1 se rechaza por «no tiene saldo pendiente», no por un residuo.
- **Ciclo de tarjeta:** compra 300.000,30 en 3 cuotas + 4.229,90 + 89.392,54; pago parcial 100.000,
  reverso del pago, reverso de la compra a cuotas, pago de 93.622, reverso de otra compra. Deuda y banco
  = oráculo en los 7 pasos; extractos `193622.44 → 93622.44 → 193622.44 → 93622.44 → 93622.44 → 0.44 → 0`
  (la cuota aporta 100.000 al extracto y la compra completa a la deuda, como antes).
- Acciones rápidas débito → crédito → débito con 36.224,28: saldo y deuda exactos, gasto una sola vez.

## 7. Saldos históricos desviados

No se reparan. Un saldo persistido por el código anterior (p. ej. `97599.49999999999`) **no** es
canónico y `toExactCopCents` devuelve `undefined`; cualquier operación nueva sobre él sigue la ruta
binaria anterior (`97599.49999999999 − 100.25 = 97499.24999999999`, idéntico al comportamiento previo) y
queda registrada en `getCopArithmeticFallbacks()`. Se ve como $ 97.599 aunque el decimal pretendido fuera
97.599,50: el redondeo de la presentación **no** lo hace correcto.

Detección (solo lectura, sobre una copia):

```sql
-- Candidatos: el REAL guardado no es el double de un importe de dos decimales.
SELECT id, name, balance_amount, debt_balance_amount FROM accounts
WHERE balance_amount <> round(balance_amount, 2)
   OR (debt_balance_amount IS NOT NULL AND debt_balance_amount <> round(debt_balance_amount, 2));
```

y, en código, `toExactCopCents(account.balance.amount) === undefined`. La consulta se comprobó en
SQLite (prueba `read-only detection…`): 0 falsos positivos en 20.000 importes canónicos aleatorios
hasta ±10¹³ COP (y 200.000 en una verificación previa) y los 6 valores desviados de las sondas
detectados. Un candidato puede ser un dato
legítimo fuera de contrato (importes IA con más decimales, ≥ 2^46): no se debe redondear
automáticamente. Reparar exige reinterpretar movimientos (recalcular desde el saldo inicial, que no se
conserva) y requiere **autorización y propuesta separadas**.

**Deuda de tarjetas:** es un valor derivado que la reconciliación recalcula siempre desde los
movimientos. Cuando una operación existente dispara la reconciliación (compra/edición/borrado de crédito,
pago, acción rápida, guardar/asociar/cerrar tarjeta) una deuda desviada guardada por la versión anterior
pasa a ser el decimal exacto (sonda `historicalDrift`: `94561.99999999999` → tras pagar 50.000, `44562`).
No ocurre al abrir la app ni en lectura. No cambia ningún movimiento, no crea movimientos ni eventos
contables: solo se añaden las filas de la propia operación (gasto y pago) y el *upsert* del extracto que
la reconciliación ya hacía (idéntico antes y después). El saldo bancario desviado de esa sonda **no** se
corrige.

## 8. Pagos de tarjeta y extractos: compatibilidad

- Contrato 3B intacto: importe finito positivo, `round(importe) ≥ 1`, `min(round(importe), deuda)` entero
  seguro ≥ $1, saldo suficiente. Mismos mensajes.
- **6B-C1 sigue igual:** compra de 10.000,40; pagos 10.001 → rechazado; 10.000,40 → 10.000; 10.000,
  1 y 0,40 → rechazados; cierre rechazado. La única diferencia es que la deuda restante es ahora
  **exactamente `0.4`** (antes `0.3999999999996362`): deuda real, no residuo.
- Extracto: mismo rango, mismos cargos (cuota activa = `monthlyAmount`), `min = round(total·0,1)`;
  `status` paid/pending/open derivado del total exacto.
- Patrimonio: activo − deuda = patrimonio se cumple en decimales exactos en todos los pasos de P6
  (`wealthMismatch = 0`). Las cifras del dashboard que suman varias cuentas siguen siendo binarias (D3).
- Volumen (equivalencia 3A.1 adaptada, [evidencia](correccion-fase6b1/node/equivalence-3a1-after-fix.json)):
  con importes `1000000000000.1` la deuda binaria anterior quedaba hasta **7 centavos** por debajo del
  decimal (`10000000402545.38` frente a `.45`). Las celdas derivadas (deuda, total/mínimo/estado del
  extracto) se comparan ahora con un oráculo BigInt y, cuando la deuda supera 2^46 COP, se exige igualdad
  bit a bit con el resultado anterior (ruta binaria). Todo lo demás sigue siendo idéntico al oráculo
  congelado de 3A.1.

## 9. Resultados Android API 24 y API 35

APK sintético `com.smartfin.snapshot5b2.tests` (UID aislado, release Hermes), workspace
`C:/sf-6b1r-20261026` preparado con [prepare-android.cjs](../scripts/phase6b1/prepare-android.cjs) desde
el de 6B: **`refreshed` = exactamente los 4 archivos de producción de 6B.1**; se añadieron las sondas
6B.1, las copias congeladas pre‑6B.1 y su despachador (las campañas 6B y anteriores siguen disponibles).
Metadatos del paquete de producción sin cambios en cada campaña. Sin bases personales; el HONOR no se
reinició.

| | Emulador API 24 / SQLite 3.9.2 | HONOR CRT-NX3 API 35 / SQLite 3.44.5 |
|---|---|---|
| Campañas válidas | **39 / 39 aprobadas** | **39 / 39 aprobadas** |
| Sondas 6B.1 (14, antes y después) contra Node, valor a valor | idénticas | idénticas |
| Sondas 6B (12) sobre el código corregido contra Node | idénticas | idénticas |
| Volúmenes 1k/10k/100k × centavos/pesos: deudas y oráculo contra Node | idénticos ([compare](correccion-fase6b1/android/api24/compare.json)) | idénticos ([compare](correccion-fase6b1/android/api35/compare.json)) |
| `integrity_check` / `foreign_key_check` | ok / 0 en cada sonda y volumen | ok / 0 |
| UI de producción (`NetWorthCard`, `MetricsGrid`) = formato interno | ✓ 3 escenas | ✓ 3 escenas |
| Regresión 6A: precisión (18), centavos 10k/100k (598 meses: 24 idénticos / 574 cambio interno / 7 visibles, igual que 6A/6B) | ✓ | ✓ |
| Regresiones 5E.6 / 5E.5 / 5E.3 / 5D / 5C / 5E / 5E.1 (22 campañas: CSV, recuperabilidad, fallos, épocas, historial 50 años, notificaciones, borrado con reinicios, publicación, integración, recuperación) | ✓ | ✓ |

Lo que se ve en pantalla (mismo texto en ambos):

| Escena | Antes (6B) | Ahora |
|---|---|---|
| P1 saldo disponible / patrimonio | $ 97.599 | **$ 97.600** (= ingresos del mes) |
| P5 saldo disponible / patrimonio | −$ 0 | **$ 0** |
| Caso B deuda total | $ 1 (residuo tras pagar 94.561) | **$ 0** tras pagar 94.562; disponible y patrimonio $ 905.438 |

Volumen representativo (AGENTS.md: 1.000 en 6 meses, 10.000 en 5 años, 100.000 en 50 años calendario;
fixtures oficiales con la variante de centavos de 6A y sin ella). Se reconcilia toda la historia con la
implementación congelada y la nueva, alternadas en el mismo proceso y base, y se comprueban las deudas
contra céntimos enteros de SQLite; después se ejecutan 25 operaciones de producción con centavos sobre
esa historia (ingreso, gasto, compra a crédito, su borrado y pago) y se verifican banco y deuda contra
el oráculo.

| Mediana reconciliación (ms), anterior → 6B.1 | API 24 | HONOR | Node |
|---|---|---|---|
| 1.000 centavos / pesos | 32,3 → 34,0 / 40,5 → 38,3 | 23,7 → 23,6 / 24,2 → 23,9 | 2,6 → 2,4 / 2,5 → 2,6 |
| 10.000 centavos / pesos | 77,4 → 75,9 / 73,3 → 76,1 | 87,9 → 90,0 / 87,0 → 88,1 | 15,5 → 17,2 / 13,7 → 16,3 |
| 100.000 centavos / pesos | 731 → 772 / 966 → 948 | 1.527 → 1.539 / 1.542 → 1.536 | 172 → 190 / 180 → 173 |

Sin regresión atribuible: las diferencias cambian de signo entre ejecuciones y dispositivos (como mucho
+6 % en un caso de API 24, −2 % en otro). La reconciliación lee toda la historia de tarjetas desde 3A.1;
a 50 años eso cuesta ~0,75 s (API 24) y ~1,5 s (HONOR), y un pago (dos reconciliaciones) ~1–3 s, igual
con ambas implementaciones: es un coste previo, no de 6B.1. Dashboard 6A (`phase6a-performance`):
API 24 105,6/109,5/134,0 → 104,0/97,6/137,9 ms; HONOR 14,7/15,1/90,1 → 14,1/14,4/78,2 ms (no depende
de este cambio). Las sondas de 1.000 operaciones en un día son estrés de corrección, no rendimiento.

Incidencias de entorno (evidencia en `android/api*/_interrumpidas/`): el HONOR se desconectó de ADB por
USB durante la primera serie (todas sus campañas fallaron con «device not found» sin ejecutarse); en API
24 el host se suspendió durante `volume-100000-pesos` y tras el salto de reloj fallaron campañas con
«receipt timed out»; un relanzamiento mío mientras la serie seguía viva se rechazó por el mutex. Todo se
repitió desde cero con el mismo APK; ninguna campaña válida falló.

## 10. Pruebas financieras y calidad

- Final: **Jest 74 suites / 990 aprobadas / 14 omitidas, 8 snapshots** (+1 suite, +33 pruebas);
  `tsc` 0; ESLint 0 errores, las 5 advertencias previas; `git diff --check` limpio. Artefactos de fases
  anteriores reescritos por Jest restaurados; las versiones posteriores a la corrección se guardan en
  `correccion-fase6b1/node/` (`probes-6b-after-fix.json`, `equivalence-3a1-after-fix.json`).
- Nueva suite `financialCorrectionPhase6B1` (33): oráculo de los helpers (enteros, 1–2 decimales,
  negativos, repeticiones, −0, fuera de contrato, 2^46 y `MAX_SAFE_INTEGER`, registro de caídas); sondas
  antes/después; compartidos (compra 30.000,30, reembolso 20.000,07, devolución 4.999,92: banco exacto);
  IA (ingreso, gasto, transferencia con 4×1000 exactos; repetición del recibo sin escrituras; importe
  0,005 por la ruta anterior y registrado); acciones rápidas; resumen de tarjetas; **fallo antes/después
  de cada escritura** del pago total con centavos (10 escrituras, 20 puntos) y de una compra a cuotas de
  0,01 (6 escrituras, 12 puntos) con rollback íntegro de todas las tablas; COMMIT `unknown` sin reintento
  y conexión retirada; volúmenes representativos; detección de saldos desviados.
- Pruebas previas modificadas, con motivo: `financialAuditPhase6B` (las caracterizaciones de D1/D2/D4
  pasan a exigir el oráculo) y `creditCardReconciliationEquivalence` (celdas derivadas de deuda/extracto
  contra oráculo BigInt; el resto, bit a bit con el oráculo congelado). Suscripciones: sus suites
  (`subscriptions`, `subscriptionAtomicityPhase4`, `aiSubscriptions`, etc.) pasan sin cambios; no
  escriben saldo ni deuda.
- Ingreso/gasto/ahorro mensual (6A) sin cambios: 0 diferencias en P6 y en los volúmenes; los agregados
  del dashboard que no dependen de saldos o deuda son idénticos.

## 11. Riesgos pendientes

### 6B-C1 (sin cambios en esta fase) y propuesta separada

Una deuda legítima con centavos (p. ej. 0,40 tras pagar 10.000 de una compra de 10.000,40) sigue sin
poder pagarse y bloquea el cierre. 6B.1 eliminó el residuo artificial (`2,9·10⁻¹¹`, `0,99999999998`);
la deuda de 0,40 es real y **no** se perdona ni se redondea. El pago de $0,40 se sigue rechazando.

Propuesta para autorizar aparte (no implementada):

1. **Liquidación exacta explícita.** Aceptar `importe = deuda` cuando la deuda es canónica de dos
   decimales (ruta exacta de 6B.1) y el usuario elige «pagar total»; el pago guarda ese importe con
   centavos, el origen se debita por el mismo decimal (`addCopAmounts`) y la deuda queda en 0 exacto.
   Los pagos parciales siguen en pesos enteros ≥ $1 (contrato 3B).
2. No redondear la deuda ni condonar: si el banco real cobra pesos enteros, el usuario registra el
   pago real y el ajuste como movimiento explícito.
3. Efectos a validar antes de aprobar: débito bancario con centavos (cuentas que solo admiten pesos),
   patrimonio (activo y pasivo bajan lo mismo), extracto `paid`, CSV/respaldos con importes de dos
   decimales (ya soportados por 5E.6), y que el pago no cuente como gasto.
4. Pruebas: P7 (10.000,40) completo hasta cierre, pagos 0,01/0,40/0,49 (siguen rechazados salvo el total
   exacto), atomicidad del pago y Android.

### Otros

- **Saldos ya desviados** (sección 7): siguen desviados hasta una reparación autorizada.
- **D3:** disponible, deuda total y patrimonio del dashboard suman varias cuentas en binario: con saldos
  exactos aún puede verse $1 menos (P4). Fuera de alcance (6B.2 si se autoriza).
- **D4:** la causa de formato (`Intl` con `signDisplay: auto`) sigue para valores no canónicos; con saldos
  exactos el cero es `+0`.
- **D5:** importes IA/heredados con más de dos decimales siguen la ruta binaria (registrada).
- `availableCredit = límite − usado` y los agregados de `sharedFinancialSnapshot` son restas/sumas de
  presentación no persistidas; no se cambiaron.
- Magnitudes ≥ 2^46 COP: ruta binaria anterior por diseño.

## 12. Veredicto independiente

**6B-D1 — CORREGIDO** para operaciones nuevas cuyos saldo y variación cumplen el contrato (≤ 2 decimales,
bajo 2^46 COP). Cada escritor real (manual, edición, borrado, transferencias y 4×1000, acciones rápidas,
IA, compartidos y pago de tarjeta) guarda el `Double` canónico del decimal exacto; las reversiones
restauran bit a bit; con pesos enteros el resultado es idéntico al anterior. **No corregido, por diseño:**
saldos ya desviados (se detectan, no se reparan; requieren autorización aparte) y datos fuera de contrato
(ruta anterior, registrada).

**6B-D2 — CORREGIDO.** La deuda y los extractos se recalculan en céntimos exactos desde los movimientos;
los casos A y B dejan deuda exactamente cero, el pago del total exacto se acepta y la tarjeta se puede
cerrar. Una deuda desviada guardada por la versión anterior se vuelve exacta en la siguiente
reconciliación disparada por una operación, sin crear ni modificar movimientos. Por encima de 2^46 COP o
con importes de más de dos decimales se conserva el resultado anterior.

Atomicidad, recibos IA, época de borrado, recuperación Android, suscripciones, historial, respaldos v2 y
CSV 5E.6: sin cambios y verificados en Node, API 24 y HONOR. **6B-C1 sigue abierto** (deuda real con
centavos impagable con el contrato vigente; propuesta en la sección 11), igual que D3, D4 (formato) y D5.
No se avanza a 6B.2.
