# 5E-001 — Historial paginado incompatible con el planificador de API 24

Estado: defecto de producción reproducido; corrección **no aplicada**.
Prioridad: bloqueo de lanzamiento para la plataforma mínima soportada.

## Reproducción

El APK sintético usa el repositorio vigente, esquema/migraciones actuales y el
driver instalado, con la única sustitución del nombre de base. En la campaña
`phase5e-performance`, después de ejecutar la historia financiera común y completar
el fixture de 1.000 movimientos, falla `getTransactionPage` con filtros `all`,
búsqueda vacía y orden `newest`.

La consulta que falla está en `hasCanonicalDates`,
`src/modules/transactions/repositories/sqliteTransactionHistory.ts:83`:

```sql
SELECT COALESCE(civil_date || 'T' || COALESCE(local_time, '00:00') || ':00.000Z', date) AS date
FROM transactions INDEXED BY idx_transactions_civil_sort WHERE 1 = 1 LIMIT 1;
```

SQLite Android devuelve `SQLiteException: no query solution (code 1)`. El intento
original queda en `android/api24/performance/result.json` y su Logcat. No se cuenta
como campaña aceptada. No basta la aprobación de las consultas en `node:sqlite`.

El índice lo crea la migración existente en
`src/modules/transactions/database/sharedExpenseSchema.ts:63`. Es un índice de la
expresión de orden y `created_at DESC`; la consulta inicial lo fuerza sin un
predicado ni orden que utilice la expresión. El probe `historyCompatibility`
ejecuta directamente en Kotlin la sentencia original y variantes de solo lectura,
registra SQLite/DDL y distingue el planificador del puente JS. Sus resultados se
guardan en `integrated-final2/result.json`, caso
`api24-expression-index-history-compatibility-probe`.

## Propuesta mínima para un encargo de corrección

Retirar el hint obligatorio **solo de la consulta de primera fila**, dejando al
planificador elegir su acceso. El probe directo en SQLite 3.9.2 falla con la
sentencia original y devuelve una fila sin el hint, o añadiendo ORDER BY sobre
la expresión. La consulta DISTINCT original también pasa y no necesita cambiarse
según esta evidencia. Conservar
las expresiones, validaciones de fechas, orden explícito de las páginas,
comparación JS heredada, cursores, revisión, cancelación y límites de caché.
Otra opción a contrastar es añadir el orden de expresión a la primera comprobación.
No cambiar índices/esquema, driver, representación monetaria ni dependencias.

Antes de aceptar la corrección: repetir las consultas reales completas en API 24
y API 35, con fechas civiles, horas explícitas, legado mixto, filtros, búsquedas y
paginación; comparar IDs/orden/importes y medir 1k/10k/100k. Los probes prueban
consultas concretas, no certifican por sí solos todo ese parche.

## Efecto y alcance

La campaña física 5E posterior verifica también HONOR CRT-NX3/API 35 con SQLite
3.44.5. El probe original y sus variantes pasan; el caso de uso entrega páginas
en 1k/10k/100k sin parche. Esto acota la reproducción a la plataforma mínima
observada y no elimina el defecto API 24. Evidencia:
`android/api35/integrated-final2/result.json` y `performance-final/result.json`.

El error ocurre en una lectura, antes de los pagos/capturas medidos en ese intento.
No demuestra corrupción ni modificación monetaria. Las mediciones posteriores
registran `historyOutcome.status=failed` y el tiempo del intento fallido separado;
continúan únicamente las demás etapas. Nunca presentan ese tiempo como latencia
de una página entregada ni declaran corregido el historial.
