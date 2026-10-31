# SmartFin 6B.2: agregados del dashboard con centavos exactos y presentación monetaria

30 de octubre de 2026, America/Bogota. Esta fase corrige 6B-D3 y diagnostica 6B-D4
([auditoría 6B](auditoria-fase6b.md), [corrección 6B.1](correccion-fase6b1.md)).

Qué no cambia:

- Esquema, migraciones, driver y dependencias.
- Importes originales y saldos persistidos.
- Reglas contables, contrato de pagos de tarjeta, impuestos, notificaciones y protocolo de respaldos.
- `BACKUP_PUBLICATION_UI_ENABLED` sigue en `false`.
- No se implementan restauración, respaldos automáticos ni el analista semanal.
- 6B-C1, 6B-D5 y 6B-O1 quedan fuera.
- No se avanza a 6B.3.

Evidencias en [`correccion-fase6b2/`](correccion-fase6b2):

- `node/`: `reproduction-before-fix.json`, `results.json`, y las sondas 6B y 6B.1 ejecutadas sobre el código 6B.2.
- `android/api35/` y `android/api24/`: una carpeta por campaña, `compare.json` contra Node y `ui/` con jerarquía y captura. En `api24/`, las carpetas `-attempt-HHmmss` conservan el primer intento fallido (sección 10).
- `android-build.log` y `android-run-api35.log`.

Sondas: [`scripts/phase6b2/probes.ts`](../scripts/phase6b2/probes.ts).
Pruebas: [`dashboardAggregatesPhase6B2.test.ts`](../__tests__/dashboardAggregatesPhase6B2.test.ts).
Copia congelada del dashboard anterior: [`pre6B2DashboardSummary.ts`](../__tests__/helpers/pre6B2DashboardSummary.ts).

**Veredicto: 6B-D3 CORREGIDO; 6B-D4 corregido solo para el cero exacto; validación Android completa en API 35 y API 24** (sección 14).

## 0. Línea base

- Git en `6113758` (6B.1). Había cambios ajenos sin seguimiento: `.codex/`, `.claude/hooks/`, `.claude/settings.json` y `docs/dangerous-command-guard*.md`. Son el guard de comandos del propietario y se conservan sin tocar.
- Revisé AGENTS, ARQUITECTURA, BASE_DE_DATOS, los informes 6A, 6B y 6B.1, el código de `exactCopCents.ts`, `getDashboardSummary.ts`, los repositorios de cuentas y tarjetas, la posición compartida (`sharedFinancialTotalsSql.ts`, `readSharedFinancialTotals.ts`, `sharedCommandEffects.ts`) y los formateadores COP.
- Resultado antes de cambiar código:
  - Jest: 74 suites, 989 aprobadas, 1 fallida y 14 omitidas; 8 snapshots. La fallida fue `subscriptionAtomicityPhase4`, por un *timeout* de 5 s mientras `tsc` y ESLint corrían en paralelo. Sola aprueba 14/14, así que la línea base efectiva es 990.
  - `tsc`: 0 errores.
  - ESLint: 0 errores y las 5 advertencias previas.
  - `git diff --check`: limpio.

## 1. Reproducción de 6B-D3 antes de la corrección

El oráculo es `BigInt` en centavos sobre los textos decimales de cada escenario. No usa `exactCopCents` ni código de producción. La salida completa está en [reproduction-before-fix.json](correccion-fase6b2/node/reproduction-before-fix.json). Las sondas se ejecutaron sobre el código de `6113758` antes de tocar producción.

| Sonda | Agregado | Binario anterior | Decimal | Visible → esperado |
|---|---|---|---|---|
| P4: cuatro cuentas 36.360,06 + 36.224,28 + 19.556,65 + 5.458,51, cada una canónica | disponible y patrimonio | `97599.49999999999` | 97.599,50 | **$ 97.599 → $ 97.600** |
| Tres tarjetas con deuda de compras de producción 18.160,76 / 76.543,65 / 28.611,09 | deuda total | `123315.49999999999` | 123.315,50 | **$ 123.315 → $ 123.316** |
| Activos de los cuatro tipos (con inversión) menos tarjeta y préstamo | patrimonio | `21977729.499999996` | 21.977.729,50 | **$ 21.977.729 → $ 21.977.730** |
| Compra compartida (derecho de cobro 169.806,04) y reembolso sin aplicar (anticipo 58.752,99) | patrimonio | `8767355.499999998` | 8.767.355,50 | **$ 8.767.355 → $ 8.767.356** |
| Saldos canónicos 0,30 / −0,10 / −0,20 | disponible y patrimonio | `-2.7755575615628914e-17` | 0 | **−$ 0 → $ 0** |
| Secuencia económica de 12 operaciones con centavos | disponible y patrimonio | 8 valores no canónicos (no visibles) | — | — |

Los derechos de cobro y los anticipos ya eran exactos: SQL suma `amount_minor` entero y `readSharedFinancialTotals` divide entre 100. La imprecisión aparecía al sumarlos en binario al patrimonio. No existe un agregado aparte de «posición neta» en el dashboard: la posición entra solo en el patrimonio.

## 2. Inventario de agregados del dashboard

| Clase | Agregado | Origen | Política 6B.2 |
|---|---|---|---|
| 1. Suma de valores almacenados | Disponible: Σ `balance` de cuentas activas de efectivo, banco y ahorro | `accounts` | Centavos exactos; binario si queda fuera de contrato |
| 1 | Activos del patrimonio (disponible + inversión) | `accounts` | Igual |
| 2. Deudas derivadas | Deuda total: Σ `debtBalance` de tarjetas y préstamos activos. La deuda de cada tarjeta la reconcilia 6B.1 y queda persistida; el dashboard solo la lee | `accounts` | Igual (lectura; la reconciliación no se toca) |
| 3. Activos − pasivos | Patrimonio base | Derivado | Centavos exactos con comprobación de entero seguro en cada paso |
| 4. Derechos de cobro y anticipos | `receivables`, `thirdPartyAdvances` | SQL entero `amount_minor` → `/100` | Se incorporan al patrimonio en centavos (`toExactCopCents` recupera el entero por debajo de 2^46 COP) |
| 5. Registros históricos | Ingresos y gastos del mes | `transactions` | 6A, sin cambios |
| 5 | Pérdidas, reversiones y recuperaciones del mes | SQL entero | Sin cambios |
| 5 | `recentTransactionCount` | Conteo | Sin cambios |
| 6. Derivados de otras métricas | Ahorro = ingresos − gastos − pérdida neta | Métricas 6A | 6A, sin cambios (D5 fuera) |
| 6 | Patrimonio = base + cobro − anticipos | Clases 3 y 4 | Exacto (este cambio) |

Mismo cálculo fuera del dashboard, alineado para que las pantallas coincidan:

- `TransactionsScreen` (Saldo de Movimientos): misma definición que disponible. Ahora usa `sumCopAmounts`.
- `getDebitCardsOverview.totalAvailable`: banco y ahorro activos. Ahora usa `sumCopAmounts`.

Se conservan sin cambios, por compatibilidad:

- `sharedFinancialSnapshot` y `sharedFinancialEffects`. Sus deltas se persisten en `shared_commands.result_json` y se reproducen en comandos idempotentes. Cambiarlos alteraría resultados guardados. No se muestran en el dashboard.
- `availableCredit = límite − usado` de tarjetas: una sola resta de presentación.
- Métricas mensuales y tendencia semanal de cada tarjeta débito (riesgo pendiente, sección 13).

Los saldos persistidos no se tocan: eso correspondía a 6B.1.

## 3. Algoritmo implementado

Cambios en [`exactCopCents.ts`](../src/shared/utils/exactCopCents.ts), reutilizando `toExactCopCents` y `sumExactCopCents`:

- `addSafeCents(a, b)`: suma dos enteros seguros, o devuelve `undefined` si falta un operando o el resultado no es entero seguro. Si el total exacto sale del rango seguro, el `double` redondea a al menos 2^53, así que nunca vuelve como un entero seguro incorrecto.
- `copAggregate(cents, binary, site)`: si los centavos existen y son seguros, devuelve `cents / 100 + 0` (una sola conversión, nunca −0). Si no, devuelve **exactamente** el valor binario anterior y lo registra.
- `sumCopAmounts(amounts, site)`: Σ exacta, o la suma binaria anterior en el mismo orden.
- `getCopAggregateFallbacks` / `resetCopAggregateFallbacks`: contador en memoria, local, separado del de escritores de 6B.1. Así el contrato de 6B.1 (contar solo escrituras persistidas) queda intacto.

Cambios en [`getDashboardSummary.ts`](../src/modules/dashboard/useCases/getDashboardSummary.ts), `sumBalanceFigures`. Por cada cuenta activa se conservan dos valores: centavos exactos (`sumExactCopCents`) y la suma binaria anterior (mismo filtro y orden `ORDER BY name`).

```
disponible = copAggregate(c(disponible), Σbin disponible)
deuda      = copAggregate(c(deuda),      Σbin deuda)
patrimonio = copAggregate(c(activos) − c(deuda) + c(cobro) − c(anticipos),   cada paso con addSafeCents,
                          (Σbin activos − Σbin deuda) + cobro − anticipos)  ← expresión binaria anterior, intacta
```

Cada agregado cae a binario de forma independiente. Ejemplo: con un saldo de inversión desviado, disponible y deuda siguen exactos y solo el patrimonio usa la ruta anterior.

No se redondea ningún saldo individual ni se usan tolerancias. Fuera del dashboard asíncrono, la posición compartida es opcional: la ruta síncrona del repositorio simulado calcula `activos − deuda` exactamente igual que antes.

Igual que las cifras mensuales de 6A, el agregado no exige quedar por debajo de 2^46 COP: `cents / 100` ya es el `double` más cercano al decimal exacto. Los operandos sí deben ser canónicos y estar por debajo de 2^46.

## 4. Comparación contra el oráculo `BigInt`

Datos de [results.json](correccion-fase6b2/node/results.json):

| Comprobación | Anterior | 6B.2 |
|---|---|---|
| 8 sondas (P4, deuda, patrimonio mixto, posición compartida, cero, pequeños y medios, fuera de contrato, secuencia económica) | 16 diferencias con el oráculo | **0** |
| 20.000 conjuntos aleatorios de 1–8 cuentas (seis tipos, 10 % cerradas, 15 % negativas, 0–2 decimales) | 13.272 de 60.000 cifras distintas del oráculo; **43 visibles** | **0** |
| 20.000 conjuntos en pesos enteros | — | **idénticos bit a bit** |
| 5.000 conjuntos con un operando fuera de contrato | — | agregados afectados **idénticos bit a bit** |
| Dashboard síncrono (repositorio simulado) | — | igual (`toEqual`) |
| Casos fuera de contrato: saldo desviado `97599.49999999999`, residuo `−2,78·10⁻¹⁷`, tres decimales, ≥ 2^46, total > `MAX_SAFE_INTEGER` en centavos, patrimonio intermedio inseguro | — | **idénticos bit a bit**; caídas registradas por agregado |
| Lectura del dashboard | — | instantánea de todas las tablas idéntica antes y después en todas las evaluaciones |

## 5. Disponible, deuda y patrimonio

Después de la corrección:

| Sonda | Disponible | Deuda total | Patrimonio |
|---|---|---|---|
| P4 | `97599.5` → **$ 97.600** | 0 | `97599.5` → **$ 97.600** |
| Tres tarjetas | 1.000.000 | `123315.5` → **$ 123.316** | `876684.5` → $ 876.685 |
| Patrimonio mixto | `1054000.99` | `192362.37` | `21977729.5` → **$ 21.977.730** |
| Posición compartida | `8656302.45` | 0 | `8767355.5` → **$ 8.767.356** |
| Cero por agregación | `0` → **$ 0** | 0 | `0` → **$ 0** |
| Sobregiro −15.000,25 y deuda 84.999,25 | −$ 15.000 | $ 84.999 | `-99999.5` → −$ 100.000 |

## 6. Patrimonio y gastos compartidos

`Patrimonio = Activos − Pasivos + Derechos de cobro − Anticipos` se comprobó tras **cada paso** de la secuencia económica, contra el oráculo y contra el delta esperado de cada operación. Las reglas contables no se modificaron.

| Paso (operación de producción) | Δ patrimonio esperado | Resultado |
|---|---|---|
| Ingreso 36.360,06 | +36.360,06 | ✓ |
| Gasto 19.556,65 | −19.556,65 | ✓ |
| Transferencia propia 1.234,56 | 0 (sin patrimonio ficticio) | ✓ |
| Transferencia 80.000,33 con 4×1000 | −320 (solo el impuesto) | ✓ |
| Compra a crédito 76.543,65 | −76.543,65; deuda +76.543,65 | ✓ |
| Pago de tarjeta 50.000 | 0; banco −50.000 y deuda −50.000 | ✓ |
| Compra compartida 30.000,30 (parte propia 15.000,15) | −15.000,15; derecho de cobro +15.000,15 | ✓ |
| Reembolso aplicado 5.000,05 | 0; **ingreso del mes sin cambio** | ✓ |
| Condonación 4.000,04 | −4.000,04; pérdida neta 4.000,04; **sin ingreso** | ✓ |
| Anticipo recibido 20.000,07 | 0 (anticipo +20.000,07) | ✓ |
| Devolución de anticipo 4.999,92 | 0 | ✓ |
| Borrado del gasto | +19.556,65 | ✓ |

Totales: 12 pasos, **0 diferencias con el oráculo, 0 violaciones de regla, 0 escrituras del dashboard**. El código anterior tenía 8 diferencias internas en la misma secuencia.

La posición compartida entra **una sola vez**. La SQL agrega cada relación por separado, y en el patrimonio se suma el cobro y se resta el anticipo exactamente una vez. Los valores leídos son `169806.04` y `58752.99`, iguales al oráculo.

## 7. Diagnóstico de «−$ 0» (6B-D4)

Con `Intl` (`signDisplay: auto`), cualquier valor negativo que redondea a 0 se muestra «−$ 0»:

| Caso | Ejemplo | Origen tras 6B.1/6B.2 | Tratamiento |
|---|---|---|---|
| Cero matemático exacto | saldos 0,30 − 0,10 − 0,20 | Antes: residuo de la suma binaria del dashboard. Ahora: `+0` exacto | **Corregido por el agregado**: muestra $ 0 |
| Cero negativo IEEE | `-0` | No lo produce ninguna ruta del dashboard: las sumas empiezan en `+0` y la ruta exacta normaliza. Puede aparecer en otras entradas | **Corregido en `formatCurrency` y `formatCOP`**: `value === 0 ? 0 : value`. No cambia ningún otro valor (prueba sobre ±20.000,00 céntimo a céntimo y casos límite) |
| Residuo no canónico | `−2,78·10⁻¹⁷` guardado antes de 6B.1 | Saldo histórico desviado | **Sin cambio**: no es un cero exacto, sigue mostrando −$ 0 (ruta binaria) |
| Negativo real de menos de $1 | saldo −0,40; patrimonio −0,40 con deuda 0,40 | Dato legítimo | **Sin cambio**: −$ 0 conserva el signo |
| Deuda real de menos de $1 | deuda 0,40 | Dato legítimo (6B-C1) | **Sin cambio**: se muestra $ 0 y el valor interno sigue siendo `0.4` |

La normalización ocurre antes de `Intl` y no usa `signDisplay`, así que no depende de cómo cada versión de Android implemente ICU. En el HONOR (API 35, Hermes) `-0` pasa de «−$ 0» a «$ 0», y los demás casos de la tabla se muestran igual que antes. En el emulador API 24 (Hermes) se verificó lo mismo: `-0` pasa de «−$ 0» a «$ 0», y las cinco escenas visibles coinciden con API 35 (sección 10).

El ICU de API 24 difiere en un dato de plataforma que el comparador informa pero no compara: `Intl` sobre el `double` límite `-0.49999999999999994` da «−$ 1» en API 24 y «−$ 0» en API 35 y Node, igual con el formateador anterior y el actual. Ninguna ruta exacta del dashboard produce ese valor (los agregados exactos son decimales de dos cifras); solo podría venir de la ruta binaria fuera de contrato (sección 12).

**Necesita tu autorización (no aplicada).** Los importes no nulos menores de $1 hoy se muestran como $ 0 o −$ 0. Opciones para decidir:

- (a) Mantenerlo así: es lo vigente.
- (b) Mostrar dos decimales cuando `0 < |x| < 1` (por ejemplo «$ 0,40» y «−$ 0,40»).
- (c) Un indicador «< $ 1».

Las opciones (b) y (c) cambian la política visual global y deben validarse en API 24 y API 35.

## 8. Diferencias visibles intencionales

- Disponible, deuda total y patrimonio pueden subir $1 cuando el decimal exacto termina en ,50 y la suma binaria quedaba justo por debajo: P4, tres tarjetas, patrimonio mixto y posición compartida. En la muestra aleatoria esto ocurrió en 43 de 60.000 cifras.
- «−$ 0» pasa a «$ 0» cuando el agregado es exactamente cero, y en cualquier `-0` IEEE que llegue a los formateadores.
- El Saldo de Movimientos y el «Saldo total disponible» de Débito usan la misma acumulación exacta, así que coinciden con el dashboard (sonda P4: 97.599,50 en las tres pantallas; Débito muestra solo banco y ahorro).
- La campaña Android `phase6a-precision` de 6A falla a propósito en «shared: netWorth changed». Esa comprobación exige patrimonio bit a bit igual al dashboard **pre‑6A**. En su escenario el patrimonio pasa de `990000.2699999999` a `990000.27`, que es el decimal exacto. La presentación no cambia ($ 990.000). Lo reproduce una prueba Node nueva con el mismo escenario. El arnés 6A no se modificó porque está atestado en el APK. No es una regresión.

## 9. Compatibilidad con 6A y 6B.1

| Garantía | Resultado |
|---|---|
| Ingresos, gastos y ahorro del mes (6A) | Idénticos bit a bit en todas las sondas, los volúmenes y la secuencia |
| Saldos canónicos, reversiones exactas, deudas sin residuos, pagos completos (6B.1) | `financialCorrectionPhase6B1` (33 pruebas) sin cambios; sus resultados Node sobre 6B.2 solo difieren en tiempos |
| Sondas de la auditoría 6B sobre el código 6B.2 | 0 diferencias de dashboard en las secuencias con centavos (antes 335 y 2.620); la prueba «defect 6B-D3» se reescribió al oráculo, como prescribía 6B |
| Gastos compartidos, condonación, suscripciones, comprobantes IA | Suites completas aprobadas sin cambios |
| Reconciliación y contrato de pago de tarjetas | No se tocan: el dashboard solo lee `debtBalance` |
| Saldos históricos desviados | No se corrigen; el agregado afectado usa la ruta binaria anterior |

Pruebas previas modificadas: solo `financialAuditPhase6B` (la caracterización de D3 ahora exige el oráculo).

## 10. Resultados Android

Paquete sintético `com.smartfin.snapshot5b2.tests` (release Hermes, UID aislado). El workspace es `C:/sf-6b2r-20261030`, preparado con [prepare-android.cjs](../scripts/phase6b2/prepare-android.cjs) a partir del de 6B.1. La compilación (`assembleRelease`, `arm64-v8a,x86_64`, BUILD SUCCESSFUL) está en `android-build.log`. Sin bases personales; el HONOR no se reinició; los metadatos del paquete de producción no cambiaron en ninguna campaña.

Observaciones de entorno:

- `refreshed` contiene los 6 archivos de producción de 6B.2 y 3 archivos de 6B.1 (`saveManualTransaction.ts`, `creditCardTransactionRelations.ts`, `createSharedExpenseApi.ts`). En estos tres solo cambian los fines de línea: la copia de trabajo está en CRLF por `core.autocrlf` y la atestación 6B.1 en LF. El contenido es idéntico al índice de Git.
- Por la misma causa, 4 archivos atestados de 6B.1 (`scripts/phase6b1/androidHarness.js`, `probes.ts` y los dos `pre6B1*`) se normalizaron a LF con [normalize-lf.cjs](../scripts/phase6b2/normalize-lf.cjs). Ese script solo escribe si el resultado es idéntico al blob del índice. `git diff` no muestra cambios de contenido.
- Un primer intento de preparación (`C:/sf-6b2-20261030`) se detuvo en esa comprobación después de copiar. Quedó incompleto y no se usa.

| | HONOR CRT-NX3 API 35 / SQLite 3.44.5 | Emulador API 24 / SQLite 3.9.2 |
|---|---|---|
| Sondas 6B.2 (8, anterior y producción) contra Node, valor a valor | **idénticas** ([compare](correccion-fase6b2/android/api35/compare.json)) | **idénticas** ([compare](correccion-fase6b2/android/api24/compare.json)) |
| Sondas 6B.1 (14) y 6B (12) sobre el código 6B.2 contra su ejecución Node | **idénticas** | **idénticas** |
| Volúmenes 1k/10k/100k: agregados y cifras mensuales contra Node | **idénticos** | **idénticos** |
| Total comparado valor a valor (`compare.json`) | 37, 0 diferencias | 37 (mismas claves), 0 diferencias |
| `integrity_check` / `foreign_key_check` | ok / 0 | ok / 0 |
| UI de producción (NetWorthCard, MetricsGrid, cabecera de Débito) igual al formato interno, 5 escenas | ✓ | ✓ |
| Regresiones (6A centavos y rendimiento, 5E.6, 5E.5, 5E.3 historial 50 años, 5D, 5C, núcleo, publicación, 5E, 5E.1) | **37/38 aprobadas**; `phase6a-precision`, diferencia intencional (sección 8) | Misma serie: **38/39 campañas aprobadas**; solo `phase6a-precision`, por la misma diferencia intencional |

Lo que se ve en pantalla en el HONOR (en API 24 las cinco escenas muestran exactamente los mismos textos):

| Escena | Saldo disponible | Patrimonio neto | Deuda total | Débito: saldo total |
|---|---|---|---|---|
| P4 | **$ 97.600** (antes $ 97.599) | **$ 97.600** | $ 0 | $ 61.239 |
| Tres tarjetas | $ 1.000.000 | $ 876.685 | **$ 123.316** (antes $ 123.315) | $ 1.000.000 |
| Posición compartida | $ 8.656.302 | **$ 8.767.356** (antes $ 8.767.355) | $ 0 | $ 8.656.302 |
| Cero por agregación | **$ 0** (antes −$ 0) | **$ 0** | $ 0 | $ 0 |
| Saldo real −0,40 | −$ 0 (signo conservado) | −$ 0 | $ 0 | −$ 0 |

**Emulador API 24 (31 de octubre de 2026).** AVD nuevo `SmartFin_Guard_Synthetic_API24` (imagen `sdk_google_phone_x86_64`, 7.0 NYC), autorizado por el propietario mediante una excepción del guard limitada al comando exacto `./scripts/phase6b2/run-all.ps1 -Serial emulator-5554 -Api 24`. La excepción verifica en cada lanzamiento los hashes del runner, sus dependencias, la atestación y el APK, y la identidad del AVD (ver [dangerous-command-guard-claude.md](dangerous-command-guard-claude.md)). Mismo APK que en API 35 (`85af989b…`). En todas las campañas: UID de pruebas 10078, base `/data/user/0/com.smartfin.snapshot5b2.tests/databases/phase5b2_synthetic.db`, `com.smartfin` ausente en el AVD y metadatos de producción sin cambios. El AVD no se reinició ni se borró.

- **Primer intento:** los 39 casos fallaron en ~17 s, antes de instalar nada. `pm path` del paquete de pruebas, ausente en un AVD nuevo, sale con código 1 sin salida, y el runner lo trataba como error de ADB. Desde 5D todos los runners asumían el paquete ya instalado.
- **Corrección del runner, solo en [`run-android.ps1`](../scripts/phase6b2/run-android.ps1):** un código distinto de cero **sin salida** significa «no instalado» y lleva a instalar el APK atestado. Cualquier error con mensaje sigue deteniendo el runner. No cambian código de producción, pruebas, APK ni atestación.
- **Segundo intento:** 39 campañas en ~13,5 min (02:48–03:02Z), 38 aprobadas. Las evidencias del primer intento se conservan byte a byte en las carpetas `-attempt-`. Una vigilancia de integridad no detectó cambios en los archivos auditados durante la campaña.

## 11. Rendimiento y calidad final

Mediana del dashboard, código anterior → 6B.2, alternados en el mismo proceso y base. Historiales oficiales: 1.000 en 6 meses, 10.000 en 5 años y 100.000 en 50 años calendario (1977‑01‑01 → 2026‑10‑25). Los saldos se probaron en pesos y en centavos:

| Volumen | Node (11 ejecuciones) pesos / centavos | HONOR (9) pesos / centavos | Emulador API 24 (9) pesos / centavos |
|---|---|---|---|
| 1.000 | 1,00 → 1,00 / 1,04 → 1,00 ms | 16,6 → 17,2 / 17,2 → 17,2 ms | 12,3 → 13,2 / 11,4 → 13,1 ms |
| 10.000 | 0,98 → 1,03 / 0,97 → 1,01 ms | 17,8 → 16,9 / 16,9 → 17,5 ms | 21,4 → 19,8 / 12,4 → 11,8 ms |
| 100.000 | 1,04 → 1,05 / 1,02 → 1,03 ms | 30,0 → 34,1 / 34,3 → 34,1 ms | 13,4 → 12,6 / 12,8 → 12,2 ms |

El cambio añade O(número de cuentas) y no depende del número de movimientos. El emulador corre en x86_64 sobre el host y su dispersión es mayor (ejecuciones individuales de 9,5 a 43,7 ms); sus tiempos no son comparables con un teléfono, pero tampoco muestran un efecto del cambio. Las diferencias cambian de signo entre variantes, dentro del ruido. Las campañas 6A de rendimiento (`regression-6a-performance-*`) también aprobaron. Las sondas concentradas en un día son pruebas de corrección, no referencias de rendimiento.

Calidad final:

- Jest: 75 suites aprobadas y 7 omitidas, 1.010 pruebas aprobadas y 14 omitidas, 8 snapshots. La línea base tenía 74 suites y 990 pruebas; se añaden 1 suite y 20 pruebas de 6B.2.
- `tsc`: 0 errores.
- ESLint: 0 errores y las 5 advertencias previas.
- `git diff --check`: limpio.
- Jest reescribe artefactos de evidencia de fases anteriores (tiempos y sondas previas). El guard del propietario bloquea `git restore`, así que no se pudieron restaurar desde aquí. Sus valores sobre 6B.2 se guardaron en `correccion-fase6b2/node/probes-6b*-on-6b2.json`.

## 12. Limitaciones de datos históricos

- Un saldo desviado por código anterior a 6B.1 no es canónico. Todo agregado que lo incluya usa la ruta binaria anterior y puede seguir mostrando $1 menos o −$ 0. No se repara: requiere una autorización aparte (ver la consulta de detección en el informe 6B.1, sección 7).
- Los importes de más de dos decimales (legado o IA), los importes ≥ 2^46 COP y los totales que superan el rango seguro en centavos conservan el resultado anterior, bit a bit.

## 13. Riesgos pendientes

- **6B-C1:** una deuda legítima menor de $1 (por ejemplo 0,40) sigue sin poder pagarse y bloquea el cierre de la tarjeta. Requiere una decisión funcional separada. No se condona ni se redondea. En el dashboard la deuda se muestra $ 0 aunque el valor interno es 0,40 (sección 7, opciones b y c).
- **6B-D5:** el ahorro mensual con importes heredados de más de dos decimales vuelve completo a la suma binaria. Sin cambios.
- **ICU de API 24:** redondea distinto el `double` límite `-0.49999999999999994` («−$ 1» frente a «−$ 0»). No lo produce ninguna ruta exacta; afecta solo a valores binarios fuera de contrato (sección 7).
- Métricas mensuales y tendencia semanal de cada tarjeta débito, y deltas informativos de comandos compartidos: siguen siendo sumas binarias. No son el dashboard; los deltas compartidos están persistidos.
- Política visual de importes no nulos menores de $1: pendiente de autorización (sección 7).

## 14. Veredicto

- **6B-D3: CORREGIDO** para operandos dentro del contrato (dos decimales, por debajo de 2^46 COP, totales seguros). Disponible, deuda total y patrimonio, incluidos derechos de cobro y anticipos, son el `double` del decimal exacto. Con pesos enteros el resultado es idéntico bit a bit al anterior. Fuera de contrato se conserva el resultado binario anterior, por agregado. El dashboard no escribe en la base.
- **6B-D4: corregido para el cero exacto** (por el agregado y por la normalización de `-0`). Los negativos reales menores de $1 y los residuos históricos se siguen mostrando con signo, por diseño. La política para importes pequeños no nulos queda para tu decisión.
- **Validación:** Node completa. HONOR API 35 completa (37/38; la restante es la diferencia intencional demostrada). Emulador API 24 completo (38/39 campañas; la restante es la misma diferencia intencional), con 37 resultados idénticos a Node y la misma UI visible que API 35.

No se avanza a 6B.3.
