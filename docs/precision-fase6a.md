# SmartFin 6A — precisión monetaria del dashboard

26 de octubre de 2026, America/Bogota. Alcance cerrado: ingresos, gastos y ahorro **mensuales** del
dashboard (`monthlyIncome`, `monthlyExpenses`, `monthlySavings`). Sin cambios de esquema, migraciones,
driver, registro de movimientos, respaldos, borrado, notificaciones ni épocas.
`BACKUP_PUBLICATION_UI_ENABLED` sigue en `false`. No se implementó restauración ni el analista semanal.

Evidencia: [node/](precision-fase6a/node) y [android/](precision-fase6a/android).
Pruebas: [dashboardPhase6APrecision.test.ts](../__tests__/dashboardPhase6APrecision.test.ts).

## 1. Causa demostrada

`buildSummary` sumaba los `REAL` de SQLite como `Double` en el orden de la consulta
(`date DESC, created_at DESC`). Un importe de centavos (0,05; 12.345,01) no es representable en
binario; cada suma redondea a 53 bits y el error se acumula. Es un **error de suma**, no de
almacenamiento: cada importe guardado es el `Double` más cercano a su decimal y se recupera exacto.

Se hace visible solo cuando el total exacto termina en **,50** y la suma binaria cae en x,4999…:
`Intl` con `maximumFractionDigits: 0` redondea entonces hacia abajo. Ejemplo (100k/50 años, perfil
centavos, 1986-12): ingresos 72.300.006,94 − gastos 25.249.238,44 → ahorro exacto 47.050.768,50;
binario 47.050.768,49999998509…; visible $ 47.050.768 en lugar de $ 47.050.769.

Distinción de causas:

| Causa | ¿Existe? | Tratamiento |
|---|---|---|
| Suma binaria | Sí (574 de 598 meses con centavos; 7 visibles) | Corregida en 6A |
| Almacenamiento | Solo desde 2^46 COP (≈ 70 billones), donde dos centavos distintos comparten `Double` | Se conserva la suma anterior |
| Formateador `Intl` | Ver sección 7 | Con totales exactos ,50 |

## 2. Contrato de importes vigente

1. **Dos decimales como máximo:** la UI (`parseCopAmountDraft`, formulario de movimientos y pago de
   tarjeta) acepta ≤ 2 decimales y |x| ≤ `MAX_SAFE_INTEGER / 100`. Gastos compartidos y pérdidas
   guardan centavos enteros (`toMinor` rechaza > 2 decimales). Suscripciones redondea a 2 decimales.
2. **Derivados con fracción de centavo:** ninguno en los flujos que alimentan el dashboard. Impuesto
   4×1000, cuotas y pagos de tarjeta producen pesos enteros; la parte personal compartida es
   `amount_minor / 100.0` (división IEEE correctamente redondeada = `Double` canónico).
3. **Excepción:** el importe de un movimiento creado por IA (`executeAiCommandPlan`) y los datos
   heredados solo exigen finito y positivo; pueden traer fracciones de centavo. No se redondean.
4. **Máximo:** UI `MAX_SAFE_INTEGER / 100` ≈ 90.071.992.547.409,91 COP.
5. **Enteros seguros:** ×100 queda bajo 2^53 en todo ese rango, pero desde 2^46 COP el `Double`
   guardado ya no identifica un único centavo (paso 2^-6). La conversión exacta se limita a
   |x| < 2^46.
6. **Históricos fuera del contrato:** importes con más de dos decimales (IA/legado), magnitudes
   ≥ 2^46 y totales mensuales de centavos fuera del entero seguro. Para ellos la cifra afectada
   conserva **exactamente** el resultado anterior. No se pidió ni hizo falta cambiar el contrato.

## 3. Algoritmo implementado

[`exactCopCents.ts`](../src/shared/utils/exactCopCents.ts):

- `toExactCopCents(x)`: rechaza no finitos y |x| ≥ 2^46; toma `c = Math.round(x·100)` y acepta
  `c`, `c−1` o `c+1` solo si `c / 100 === x` (la división IEEE reproduce el `Double` que
  `Number("…")` genera para ese decimal). Nunca redondea: si ningún candidato reproduce el valor,
  devuelve `undefined`. Bajo 2^46, |x − n/100| ≤ 2^-8 y el error de `x·100` ≤ 0,5, así que el
  centavo verdadero siempre está entre los tres candidatos; y es único porque el paso binario
  (≤ 2^-7) es menor que 0,01.
- `sumExactCopCents`: suma enteros comprobando `Number.isSafeInteger` en cada paso.
- [`getDashboardSummary.ts`](../src/modules/dashboard/useCases/getDashboardSummary.ts): ingresos y
  gastos se suman en centavos; ahorro = ingresos − gastos − pérdida neta compartida (que ya llega
  en centavos exactos) y se convierte una sola vez con `centavos / 100`. Cada cifra cuya entrada no
  cumple el contrato usa la suma binaria anterior en el mismo orden. Consultas SQL, predicados,
  parte personal compartida, condonaciones y recuperaciones no cambian.

No se usa `BigInt` en el bucle: todos los parciales son enteros seguros comprobados; `BigInt` solo
aparece en el oráculo de pruebas.

## 4. Casos donde cambia el resultado visible

Solo cuando el total exacto termina en ,50 y el binario quedaba en x,4999…
([node/scenarios.json](precision-fase6a/node/scenarios.json); la prueba exige que todo cambio
visible cumpla esa condición).

| Escenario | Campo | Anterior (exacto binario) | Decimal esperado | Nuevo | Diferencia exacta | Visible antes → ahora |
|---|---|---|---|---|---|---|
| incomeEndsInHalf | ingresos | 81236,499999999985448… | 81.236,50 | 81236,5 | +1,4551915228366852·10⁻¹¹ | $ 81.236 → $ 81.237 |
| incomeEndsInHalf | ahorro | 76236,499999999985448… | 76.236,50 | 76236,5 | +1,4551915228366852·10⁻¹¹ | $ 76.236 → $ 76.237 |
| expensesEndInHalf | gastos | 70000,499999999985448… | 70.000,50 | 70000,5 | +1,4551915228366852·10⁻¹¹ | $ 70.000 → $ 70.001 |
| negativeSavingsHalf | ahorro | −1500,49999999999954525… | −1.500,50 | −1500,5 | −4,547473508864641·10⁻¹³ | −$ 1.500 → −$ 1.501 (V8/HONOR) |
| centavosNoTies / centavosTies | gastos | 2,4999999999999995559… | 2,50 | 2,5 | +4,440892098500626·10⁻¹⁶ | $ 2 → $ 3 (V8/HONOR) |
| 100k/50 años, centavos: 1986-12, 1998-07, 2001-04, 2012-07 | ahorro | p. ej. 47050768,4999999850988… | 47.050.768,50 | 47050768,5 | +1,49·10⁻⁸ | $ 47.050.768 → $ 47.050.769 |
| 100k centavos: 1989-05 | ingresos | 76800005,4999999850988… | 76.800.005,50 | 76800005,5 | +1,49·10⁻⁸ | $ 76.800.005 → $ 76.800.006 |
| 100k centavos: 1990-03 | gastos | 25119502,4999999925494… | 25.119.502,50 | 25119502,5 | +7,45·10⁻⁹ | $ 25.119.502 → $ 25.119.503 |
| 100k centavos: 2016-05 | gastos | 24065229,4999999888241… | 24.065.229,50 | 24065229,5 | +1,12·10⁻⁸ | $ 24.065.229 → $ 24.065.230 |

Con diferencia interna pero el mismo texto: oneDecimal, fractionalTies1000 (5E.2:
258,2999999999997 → 258,30000000000001), multiYearCentavos, ahorro de expensesEndInHalf/centavos
y 574 de 598 meses del perfil centavos de 100k (53 de 58 en 10k, 7 de 7 en 1k).

## 5. Casos idénticos

Igualdad bit a bit (`Object.is`) exigida en Node y en los dos dispositivos:

- Importes enteros y medios pesos: los 7 + 58 + 598 meses de los historiales representativos
  oficiales; escenarios integers y halfPesos.
- Toda cifra cuyo resultado binario ya era el decimal exacto.
- Cancelados, pendientes, `refund`, transferencias y pagos de tarjeta siguen excluidos.
- Disponible, deuda, patrimonio, conteo reciente y las cinco cifras de pérdidas compartidas.
- Ruta síncrona con repositorios simulados.
- Escenarios legacy: subCentAmounts, ambiguousMagnitude (≥ 2^46) y unsafeTotal (centavos
  > `MAX_SAFE_INTEGER`).

## 6. Importes históricos y derivados

No se reescribe ni redondea ningún dato. Un importe heredado o de IA con fracción de centavo, una
magnitud ≥ 2^46 COP o un total no seguro hace que **esa cifra** del mes conserve la suma anterior;
las demás cifras del mes que sí cumplen siguen siendo exactas. Gasto compartido: el dashboard sigue
sumando la parte personal (`amount_minor / 100.0`), y la pérdida neta por condonación entra en el
ahorro en centavos exactos (escenario 30.000,15 con parte propia 15.000,07, condonación 1.000,01 e
ingresos 0,05 + 0,15 + 0,30 → ahorro −18.249,91, idéntico al anterior en este caso).
Valores negativos guardados conservan su signo. Cerrar el agujero de IA (validar dos decimales al
confirmar) **cambiaría el contrato** y requiere autorización: no se hizo.

## 7. Android API 24 y API 35

APK sintético `com.smartfin.snapshot5b2.tests` (UID aislado, release Hermes, metadatos de
producción sin cambios), workspace `C:/sf-6a-20261026` preparado con
[prepare-android.cjs](../scripts/phase6a/prepare-android.cjs) (solo se refrescaron
`getDashboardSummary.ts` y `exactCopCents.ts`). Emulador API 24 y HONOR CRT-NX3 API 35; sin bases
personales ni reinicios.

| | API 24 | HONOR API 35 |
|---|---|---|
| Campañas aprobadas | 35/35 | 35/35 |
| Matriz de precisión (15 escenarios + compartido) | ✓ | ✓ |
| Centavos 10k / 100k: meses, idénticos, cambio interno, visible | 58/5/53/0 · 598/24/574/7 | igual |
| Texto visible = formato interno (7 escenarios, `MetricsGrid`/`NetWorthCard` de producción) | ✓ | ✓ |
| `Intl` 0,5 / 2,5 / −0,5 / 0,49999999999999994 / −0,49999999999999994 | $1 / $3 / −$1 / **$1** / **−$1** | $1 / $3 / −$1 / **$0** / **−$0** |

Antes de 6A, negativeSavingsHalf, centavosNoTies y centavosTies se **mostraban distinto** en cada
dispositivo (p. ej. gastos $ 3 en API 24 y $ 2 en HONOR): el formateador de API 24 redondea los
binarios muy próximos a ,5, el de HONOR/V8 no. Después de 6A los valores internos y el texto son
**idénticos en los dos dispositivos y en Node** en todos los escenarios y en los 7 meses visibles
de 100k. Incluso en API 24 cambian incomeEndsInHalf y expensesEndInHalf, cuyo error (10⁻¹¹) ya no
alcanza su redondeo interno. Ingresos, gastos, ahorro, patrimonio y deuda verificados por campaña;
patrimonio y deuda no cambian.

## 8. Rendimiento del dashboard

Historiales representativos oficiales (1k/6 meses, 10k/5 años, 100k/50 años), mediana de 9
ejecuciones alternadas en Android y 21 en Node, mismo proceso y base:

| Volumen | Node pre‑6A → 6A | API 24 pre‑6A → 6A | HONOR pre‑6A → 6A |
|---|---|---|---|
| 1.000 | 1,13 → 1,15 ms | 25,1 → 23,4 ms | 13,4 → 13,7 ms |
| 10.000 | 1,12 → 1,20 ms | 12,4 → 12,1 ms | 15,2 → 14,8 ms |
| 100.000 | 1,12 → 1,26 ms | 12,0 → 12,2 ms | 48,9 → 48,8 ms |

Diferencia dentro del ruido (≈ 170 filas por mes); consultas y planes sin cambios. Las pruebas de
importes extremos, empates y concentración se mantienen como escenarios de estrés separados.

## 9. Regresiones y calidad

- Línea base (antes de producción): Jest 71 suites/933 pruebas aprobadas (7 suites omitidas),
  `tsc` limpio, ESLint 0 errores y 1 advertencia previa, `git diff --check` limpio.
- Final: Jest **72 suites/944 pruebas** aprobadas (7 omitidas), `tsc` limpio, ESLint igual a la
  línea base, `git diff --check` limpio.
- Pruebas ajustadas: `dashboardSummary` (historias sintéticas con centavos: cifras mensuales contra
  el oráculo 6A independiente, el resto contra el baseline congelado) y los diagnósticos 5E.3/5E.5,
  que ahora diagnostican la copia congelada pre‑6A. Sin tolerancias.
- Android, ambos dispositivos: sonda CSV 5E.6, recuperabilidad 1k, fallos, épocas, historial
  paginado 50 años (1k y 100k), precisión 5E.3, notificaciones (matriz, permiso denegado, worker,
  época), borrado recuperable (rollback, limpieza, pérdida antes/después, unknown y confirmado tras
  reinicio), núcleo, publicación, integrado + reinicio y recuperación 5E.1.
- Node: movimientos, transferencias, tarjetas y pagos (incluido el rechazo de $0,40), gastos
  compartidos, condonaciones, suscripciones, IA y comprobantes, historial, borrado, respaldos v2 y
  CSV 5E.6, auditoría e integridad SQLite: dentro de la suite completa.
- Dos regresiones de borrado fallaron en el primer intento por omitir en el orquestador sus campañas
  preparatorias (`lost-before`/`lost-after`); con el orden de 5E.6 pasan. El primer lector UI del
  HONOR no encontró la línea de logcat; ahora lee el informe de la campaña. Intentos conservados con
  sufijo `-attempt-*`.

## 10. Riesgos residuales

| Riesgo | Severidad | Nota |
|---|---|---|
| Importes de IA/heredados con fracción de centavo mantienen la suma binaria y su posible ±$1 | Baja | Requiere decidir si se valida a dos decimales al confirmar (cambio de contrato) |
| `Intl` muestra «−$ 0» para valores en (−0,5; 0) y difiere entre API 24 y HONOR con binarios no exactos | Baja | Preexistente, del formateador; solo afecta a cifras en ruta legacy o negativas pequeñas |
| Disponible, patrimonio y deuda siguen sumando saldos `REAL` en binario | Baja | Fuera del alcance mensual de 6A; saldos de cuentas con centavos podrían mostrar el mismo efecto |
| Magnitudes ≥ 2^46 COP no son exactas | Muy baja | El `Double` guardado ya no distingue centavos |

## 11. Veredicto

**Fase 6A aceptada dentro del alcance probado.** Las cifras mensuales con importes de hasta dos
decimales son exactas y consistentes entre Node, API 24 y HONOR; las demás conservan bit a bit el
resultado anterior; no se modificó esquema, almacenamiento, reglas contables ni flujos financieros,
y el rendimiento no cambia de forma medible. No se avanza a la siguiente fase.
