# Rendimiento con historiales representativos

Lee `AGENTS.md` vigente. No sacrifiques precisión, integridad, amplitud de conciliación o ámbito atómico para mejorar tiempos. Usa la skill de rendimiento React Native disponible solo si el problema incluye listas, memoria o renderizados; para planes/índices usa `smartfin-sqlite-architecture`.

## Demostrar primero la distribución

Fuente común: `__tests__/helpers/representativeHistory.ts`, semilla fija 20261025 y día de referencia 2026-10-25 en el checkout auditado. No reemplaces por hoy sin declarar otro fixture.

| Movimientos | Intervalo auditado | Comprobación |
|---|---|---|
| 1.000 | 2026-04-26 a 2026-10-25 | Seis meses, varias cuentas/categorías/tipos |
| 10.000 | 2022-01-01 a 2026-10-25 | Cinco años calendario, no una sola carga temporal |
| 100.000 | 1977-01-01 a 2026-10-25 | Exactamente cincuenta años calendario; cincuenta CSV anuales, no 51 |

Antes de medir, registra COUNT, MIN/MAX de fecha civil, conteos agrupados por año/mes y diversidad de cuentas, categorías/tipos/estados. Compara límites y número de años con el fixture. Comprueba huecos/concentraciones y que `createdAt` no sustituye indebidamente la fecha de negocio. `__tests__/representativeHistory.test.ts` documenta comprobaciones, pero ejecutar todo ese archivo puede generar también 100k; no lo uses como supuesto test rápido.

No uses 100k en un día, mes o importación única para aceptación SmartFin. Los escenarios de 100k deben abarcar décadas (40+ años); el fixture predeterminado usa 50. Empates de 1k/10k sí sirven como casos de corrección de paginación, identificados separadamente del benchmark representativo.

## Protocolo de medición

1. Define el presupuesto/umbral y la ruta real evaluada; si no existe objetivo aprobado, reporta mediciones y diferencias sin inventar un SLA. Identifica fuentes antes/después, misma semilla, esquema/índices, estado y salida.
2. Demuestra equivalencia antes de aceptar velocidad: filas/orden/cursor, saldos/deuda/patrimonio, importes exactos y vínculos. Incluye NULL, empates, búsqueda Unicode, filtros y extremos temporales según la consulta.
3. Separa coste de generar datos de la operación. Registra warm-up, repeticiones, muestra en frío/caliente y distribución (mediana/p95 si hay suficientes muestras); conserva muestras crudas y método. No atribuyas percentiles útiles a una muestra minúscula.
4. Mide latencia extremo a extremo y componentes SQL, JS y espera de permisos/lectores; conteo de consultas, filas devueltas/procesadas cuando sean observables, plan EXPLAIN, memoria heap/RSS y memoria nativa si se dispone. No presentes filas devueltas como filas escaneadas sin instrumentación.
5. En listas registra tamaño de página, respuesta al filtro, renderizados relevantes, frames/jank si hay herramienta nativa y alcance de captura. Un conteo de renders Node no demuestra FPS de dispositivo.
6. Para bloqueos usa barreras y mide llegada/liberación del lector y escritor; verifica instantánea estable junto con tiempos. No reduzcas la transacción para mejorar la muestra.
7. Compara en entornos equivalentes: Node/SQLite/ICU, máquina/carga; o Android API/ABI/modelo, build release/debug, Hermes, APK, temperatura/energía. No compares Node contra Android ni debug contra release como un antes/después válido. Si varían, registra diagnóstico separado.

## Selección y condiciones

Inspecciona `__tests__/transactionHistoryRefinementPerformance.test.ts`, `transactionHistoryPhase5E3FiftyYears.test.ts`, `creditCardAssociationScaling.test.ts`, `dashboardPerformance.test.ts` y `backupCsvYearQueryPhase5E4.test.ts`. No todo archivo Performance tiene umbral ni todo caso 100k está condicionado.

Condiciones observadas que requieren revisión explícita antes de activar:

- `SMARTFIN_DASHBOARD_BENCHMARK`: benchmark de dashboard; valor `baseline` selecciona fuente histórica.
- `SMARTFIN_5E4_LARGE=1`: CSV anual con 100k representativos.
- `SMARTFIN_6A_BENCHMARK`: tiempos del dashboard; su presencia activa el caso.
- `SMARTFIN_6A_EVIDENCE`: puede añadir tamaños 100k y escrituras de resultados, además de evidencia.
- `SMARTFIN_5E5_DIAGNOSTIC`: añade tamaño/evidencia diagnóstica.
- `SMARTFIN_COMMAND_PERF=1`: caso en `__tests__/sharedCommandPerformance.test.js`, que sigue excluido de Jest estable aunque se active la variable.

No copies instrucciones históricas que usen fixtures concentrados prohibidos por AGENTS. Comprueba SQL de generación y distribución antes de lanzar el caso. Revisa salida/versiones externas exigidas por baselines; su ausencia es infraestructura pendiente, no una regresión financiera.

Un cambio menor no activa campañas 100k ni Android. Si el requisito sí exige volumen, programa los tamaños necesarios con tiempo máximo, aislamiento y evidencia nueva; no declares validado 100k por extrapolar 1k.
