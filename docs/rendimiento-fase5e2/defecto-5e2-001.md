# Defecto 5E2-001 — orden newest erróneo en SQLite 3.9.2 (Android API 24)

**Estado:** corregido en el adaptador del historial durante 5E.2; pendiente de aceptación integrada.
**Severidad:** alta (duplicados y omisiones visibles en el historial; no altera saldos ni datos persistidos).
**Origen:** latente desde 5E.1 (y antes en API 24). No lo introdujo 5E.2, pero 5E.2 lo habría
expuesto a más datos al llevar fechas heredadas `YYYY-MM-DD` a la ruta keyset.

## Evidencia

- Campaña `phase5e2-history-civil-1000` en `emulator-5554` (API 24, SQLite 3.9.2): el recorrido
  completo newest devolvió `history-137` dos veces, con páginas idénticas en 5E.1 y en el primer
  build de 5E.2 ([intento conservado](android/attempt1-order-defect/api24/history-civil-1000)).
- `EXPLAIN QUERY PLAN` en 3.9.2 para `ORDER BY clave DESC, created_at DESC, rowid DESC`:
  `SCAN TABLE transactions USING INDEX idx_transactions_civil_sort`, **sin** `USE TEMP B-TREE`.
  El índice es `(clave ASC, created_at DESC)`: el recorrido inverso entrega `created_at ASC`
  dentro de cada clave, pero el planificador lo considera ya ordenado. En SQLite moderno el mismo
  SQL muestra `USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY`.
- [Sonda de orden](android/api24/order-probe/result.json), mismo APK y filas, contra el orden
  calculado en JS (listado completo y páginas keyset de 51):

| Variante | civil 1000 / legacyDay 3000 (`created_at` distinto en empates) | legacyTied 1000 (`created_at` constante) |
|---|---|---|
| newest actual (5E.1) | **incorrecto** (1015 filas, 979 distintas / 2977, 2937) | correcto |
| newest `+created_at` | **incorrecto** (3.9.2 elimina el `+` unario) | correcto |
| newest `COALESCE(created_at, created_at)` | **incorrecto** | correcto |
| newest `CAST(clave AS TEXT)` | correcto | correcto |
| oldest `CAST(clave AS TEXT)` (5E.1) | correcto | correcto |
| oldest `clave ASC` / `+created_at` / `COALESCE` | correcto | **incorrecto** (101 filas, 51 distintas) |

En HONOR API 35 (SQLite 3.44.5) todas las variantes son correctas.

## Por qué no se detectó en 5E.1

Los fixtures Android de 5E.1 usaban `created_at` constante (`'2026-10-24'`). Con esa forma el
recorrido inverso coincide por casualidad con el orden pedido. El caso heredado de 5E.1 siempre
caía en la ruta de compatibilidad, pero su escaneo por lotes usa el mismo `ORDER BY` y el mismo
keyset, de modo que también era vulnerable con empates de clave y `created_at` distintos.

## Corrección

`ORDER_KEY_SQL = CAST(clave AS TEXT)` en ambos sentidos, para páginas keyset y para el escaneo de
compatibilidad: la misma técnica que 5E.1 aplicó a oldest. La clave ya es TEXT (afinidad TEXT de
`date`, `civil_date`, `local_time`; el driver no enlaza BLOB), de modo que el valor ordenado no
cambia. Fuerza el ordenamiento completo de las filas candidatas; para que ese coste no sea
proporcional al historial, cada lote se acota al rango de claves que contiene sus primeras
`LIMIT` filas (`batchRange`, misma condición; ver informe).

## Verificación

- Node (SQLite moderno): suites de historial, 5E.1 y pantalla (149 pruebas) con equivalencia exacta contra 5E.1 congelado.
- Android API 24 y API 35: recorridos contra un oráculo JS independiente del planificador
  (orden clave/created_at/rowid calculado en JS y semántica congelada del hook), registrando
  aparte si 5E.1 coincide. Ver `android/api24` y `android/api35`.
