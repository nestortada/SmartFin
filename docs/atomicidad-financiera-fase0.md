# Atomicidad financiera: fase 0

Fecha: 11 de octubre de 2026. Alcance: infraestructura, caracterización y oráculos de prueba. No implementa fases 1/2 ni autoriza su inicio.

## Fuentes y límite observado

Se revisaron `AGENTS.md`, la skill `.agents/skills/smartfin-financial-domain/SKILL.md`, `ARQUITECTURA.md`, `BASE_DE_DATOS.md`, `MODULOS_Y_FLUJOS.md`, `SUSCRIPCIONES.md`, `auditoria-integridad-financiera.md`, `diseno-atomicidad-financiera.md`, `financialIntegrity.test.ts` y sus helpers. Se contrastaron `saveManualTransaction`/`deleteManualTransactionSafely`, `creditCardTransactionRelations`, los repositorios SQLite de cuentas/movimientos/tarjetas y `atomicSQLite` con la secuencia SQL real.

Las cuentas y el lote de movimientos usan transacciones locales diferentes. Los extractos se escriben por `executeSql` separado. El pago incluye reconciliación inicial, débito, movimiento y reconciliación final. Borrar un gasto confirma primero su reverso, después elimina acompañantes y finalmente el original. Una transacción local exitosa no garantiza atomicidad del caso de uso completo.

El diseño conserva el encabezado histórico «propuesta para autorización». La instrucción del usuario autoriza exclusivamente esta fase 0. La discrepancia documental sobre Suscripciones como marcador, la deduplicación supuestamente no aprovechada y la atomicidad de borrado financiero indicada en el diseño no se convierte en cambios de dominio ni documentación histórica. La evidencia vigente procede del código y las pruebas.

No se escribió en `src/`, esquema, migraciones, dependencias o configuración. Se conservaron los cambios previos presentes al iniciar, incluidas las correcciones de movimientos/pagos y las optimizaciones de pantalla, dashboard e historial. Todas las bases nuevas se abren exclusivamente con `DatabaseSync(':memory:')`. No se llama `openSmartFinDatabase`, no se accede a archivos de datos del usuario y no se envían datos por red.

## Infraestructura y archivos

| Archivo | Responsabilidad |
|---|---|
| `__tests__/helpers/realSQLite.ts` (modificado) | Inyección de un fallo antes/después de SQL, por posición de escritura o fragmento SQL y ocurrencia; traza de lecturas/escrituras/BEGIN/COMMIT/ROLLBACK; barreras explícitas en API de promesas; reloj SQL opcional |
| `__tests__/helpers/financialIntegrityFixture.ts` (modificado) | Conserva fixture y expectativas existentes; fija también el reloj SQL en `FINANCIAL_TEST_DATE` |
| `__tests__/helpers/financialState.ts` (nuevo) | Snapshot de todas las tablas instaladas y todas sus columnas; métricas; FK e integridad; diferencias y oráculo `requireIntegralRollback` |
| `__tests__/helpers/financialAtomicityScenarios.ts` (nuevo) | Cuatro escenarios y runner reutilizable `runFinancialScenario`, con base nueva, estado inicial/final, error real y traza de la operación |
| `__tests__/financialAtomicityPhase0.test.ts` (nuevo) | Cuatro reproducciones explícitas y barrido de cada escritura antes/después; repetición exacta; caminos exitosos y referencias de transferencia/pago |
| `__tests__/financialAtomicityInfrastructure.test.ts` (nuevo) | Verifica el propio instrumento: rollback local real, error de dominio/SQL, pérdida de respuesta, barreras, restricciones e hijos |
| `__tests__/__snapshots__/financialAtomicityPhase0.test.ts.snap` (nuevo) | Ocho oráculos de caracterización: cuatro pares completos inicial/final y cuatro matrices de puntos |
| `docs/atomicidad-financiera-fase0.md` (nuevo) | Evidencia, límites y criterios para la siguiente fase |

Cada escritura tiene índice desde 1, incluyendo UPDATE/INSERT condicionado con cero filas afectadas y DELETE sin coincidencias. La traza conserva orden global, SQL, parámetros, índice de escritura, si se ejecutó y resultado (`ok`, `sql-error`, `injected-before`, `injected-after`). `executed` no significa confirmado: el COMMIT/ROLLBACK posterior determina el estado. Los triggers se ejecutan realmente dentro de SQLite; sus escrituras no se cuentan como SQL separado del adaptador.

`injectFault` es de un solo disparo para permitir rollback e inspección posteriores. `failOn` conserva el comportamiento anterior, sin alterar las caracterizaciones existentes. `resetTrace` reinicia posiciones; se usa después de preparar y fotografiar el fixture, antes de armar un fallo. Un punto no alcanzado falla la prueba por ausencia del error y de la entrada inyectada.

El snapshot enumera las tablas mediante `sqlite_master`, ordena las filas por todas sus columnas y conserva tablas vacías, estados, saldos, deuda, principales/acompañantes, dedupe, cuotas/progreso/fechas, extractos/perfiles, splits, contratos/ocurrencias, proyecciones, alertas, recordatorios, borradores, migraciones y revisión. No excluye auditoría ni usa tolerancias monetarias. Incluye disponible, patrimonio, ingreso/gasto/ahorro del periodo de octubre de 2026; los saldos de todas las cuentas y las deudas originales por entidad siguen también en las filas completas. Para otros periodos habrá que parametrizar o añadir sus métricas.

Jest fija el reloj JS. El fixture registra una función SQL de prueba que fija únicamente `strftime('%Y-%m-%dT%H:%M:%fZ','now')`: cualquier otra expresión falla explícitamente. No se cambia el DDL ni se sustituyen los triggers; sus incrementos y rollback siguen siendo reales. Este reloj permite comparar también `applied_at` y `financial_data_revision.updated_at` sin ignorarlos.

## Cuatro estados parciales reproducidos

Todos los importes son COP; cuentas activas; ingreso mensual 0. Banco inicial 1.000.000, destino 0, tarjeta con saldo 0. Compra de crédito y gasto débito: 250.000. Pago: 100.000. El impuesto de una transferencia de 100.000 es 400 según la regla existente.

| Escenario / estado inicial | Operación y punto exacto de fallo | Persistido después del rechazo | Estado exigido por futura atomicidad antes de COMMIT |
|---|---|---|---|
| Transferencia: banco 1.000.000, destino 0, deuda 0, movimientos vacíos; disponible/patrimonio 1.000.000, gasto 0 | Transferir 100.000 a destino con 4×1000; fallo **antes del primer INSERT INTO transactions**, después del COMMIT de saldos | Banco 899.600, destino 100.000, deuda 0; disponible/patrimonio 999.600; sin principal, pata destino o impuesto; gasto 0 | Snapshot inicial completo: banco 1.000.000, destino 0, patrimonio 1.000.000; sin movimientos nuevos y sin incremento de revisión |
| Pago: banco 1.000.000, deuda/extracto 250.000, una compra; patrimonio 750.000, gasto 250.000 | Registrar pago 100.000 desde banco; fallo **antes del INSERT INTO transactions del pago**, tras reconciliación inicial y COMMIT del débito | Banco 900.000, deuda/extracto 250.000; compra existente, pago ausente; patrimonio 650.000, gasto 250.000 | Snapshot inicial completo: banco 1.000.000, deuda/extracto 250.000, compra intacta; patrimonio 750.000 |
| Borrado: banco 750.000, deuda 0, gasto débito original 250.000; patrimonio 750.000 | Borrar gasto; reproducción histórica falla **antes del primer DELETE FROM transactions**, cuyo parámetro apunta al acompañante `<id>-in` inexistente, después del COMMIT del reverso | Banco 1.000.000 y patrimonio 1.000.000; gasto original 250.000 intacto | Snapshot inicial completo: banco/patrimonio 750.000, gasto original y todos sus hijos intactos |
| Edición: banco 900.000, deuda/extracto 150.000, compra 250.000 y pago 100.000; patrimonio 750.000 | Editar pago a 50.000 conservando ID y tarjeta destino; fallo **antes del INSERT OR REPLACE INTO credit_card_statements**, tras confirmar saldo, movimiento y deuda | Banco 950.000, deuda 200.000, pago 50.000; extracto antiguo 150.000; patrimonio 750.000 y gasto 250.000 | Snapshot inicial completo: banco 900.000, deuda/extracto 150.000, pago original 100.000, referencias/auditoría/revisión intactas |

El borrado también se comprueba antes y después del DELETE **del original** (tercera coincidencia), con un split hijo sintético: el repositorio restaura movimiento e hijo mediante rollback local, mientras el reverso bancario anterior permanece confirmado. Así se distingue la etiqueta de la auditoría del parámetro SQL exacto que produjo el rechazo original.

En éxito, transferencia guarda tres movimientos con IDs derivados y contracuentas cruzadas, banco 899.600, destino 100.000, gasto 400 y patrimonio 999.600. Pago produce banco 900.000 y deuda/extracto 150.000. Borrado elimina el gasto y deja banco 1.000.000. Edición deja banco 950.000 y deuda/extracto 200.000, pago 50.000. Pago y edición conservan patrimonio 750.000 y gasto 250.000. Ese patrimonio idéntico también aparece en la edición incoherente: el total del dashboard por sí solo no sirve como oráculo.

## Cobertura e interpretación

| Flujo | Escrituras del camino exitoso | Puntos antes/después | Ejecuciones con fallo de la matriz (dos repeticiones) |
|---|---:|---:|---:|
| Transferencia con impuesto | 11 | 22 | 44 |
| Registro de pago | 10 | 20 | 40 |
| Borrado de gasto | 21 | 42 | 84 |
| Edición de pago | 8 | 16 | 32 |
| Total | 50 | 100 | 200 |

Las matrices capturan el SQL y parámetros exactos, métricas finales, nombres de tablas/métricas diferentes y SHA-256 del snapshot completo. Las cuatro reproducciones guardan además filas completas legibles antes/después. Cada punto vuelve a ejecutarse desde otra base y exige igualdad exacta de ambos snapshots y trazas. Los hashes no sustituyen la inspección: el runner devuelve las filas completas y el documento describe los estados principales. Si cambia un flujo, el descubrimiento automático encuentra sus nuevas posiciones y el snapshot exige revisión explícita.

Se verifican FK activas, `foreign_key_check` vacío e `integrity_check='ok'` en cada ejecución. También se provocan errores reales de FK de origen/destino, PK de cuenta, índice único de dedupe, unicidad de fecha por suscripción, vínculo único a movimiento y CHECK de importe/estado de ocurrencia. Tras cada rechazo se exige snapshot intacto. Las referencias sin FK no quedan acreditadas por `foreign_key_check`: quedan visibles en las tablas completas; la transferencia comprueba además sus referencias e IDs explícitamente. No se infiere validación universal de referencias polimórficas en módulos ajenos a estos escenarios.

Se prueba el aborto por SQL realmente inválido que usa el generador y un error de dominio después de DELETE con cascada; ambos restauran filas, hijos y revisión dentro de la transacción local. Las barreras suspenden una llamada de promesa antes/después de SQL y permiten intercalar una lectura sin sleeps. Nunca esperan dentro del callback síncrono de `transaction`.

Antes/después de BEGIN y COMMIT locales tienen pruebas separadas. Antes de COMMIT puede restaurarse el estado local; después de COMMIT con respuesta perdida se conserva la escritura y se rechaza la operación, sin intentar representar ese resultado como rollback. Esto prueba el adaptador de pruebas y la persistencia real de Node, no una política de resultados de producción. No se han introducido transacciones exteriores compartidas alrededor de los escenarios.

**Caracterización actual:** las cuatro pruebas y matrices fijan escrituras parciales confirmadas; aprobarlas significa que se reprodujeron esos riesgos. No actualizar snapshots para ocultar inconsistencias o hacer aprobar una futura implementación.

**Aceptación futura:** `requireIntegralRollback(before, after)` exige igualdad exacta de todas las tablas/columnas, métricas, revisión y referencias. Ahora se demuestra que rechaza los cuatro estados parciales. En fases 1/2 deberá usarse como aserción positiva únicamente cuando se haya confirmado rollback integral; los casos de pérdida de respuesta/resultado desconocido y efectos posteriores al commit necesitan aserciones distintas. No hay tests `todo`/omitidos que presenten esa garantía futura como implementada. Cuando cambie un límite, revisar su caracterización y añadir aceptación explícita, conservando la evidencia histórica de esta fase.

## Validación

Entorno: Node v24.16.0, SQLite real `node:sqlite`, esquema y migraciones de producción sobre bases en memoria. El helper requiere Node con `DatabaseSync` y registro de funciones (Node >=22.13); no se cambió el requisito de Node en `package.json`.

Comandos reproducibles (sin `-u`):

```powershell
npm test -- --runInBand __tests__/financialAtomicityInfrastructure.test.ts __tests__/financialAtomicityPhase0.test.ts __tests__/financialIntegrity.test.ts __tests__/subscriptions.test.ts __tests__/aiSubscriptions.test.ts __tests__/saveManualTransaction.test.ts __tests__/creditCardTransactionRelations.test.ts
npm test -- --runInBand
npx tsc --noEmit
npm run lint
```

Resultados finales: **235 pruebas aprobadas**, 3 omitidas existentes; **30 suites aprobadas**, 3 suites de benchmark omitidas; **8 snapshots aprobados**. La selección financiera ampliada pasó **88 pruebas en 7 suites**. Esta fase añade **21 pruebas ejecutadas** (8 de escenarios/matrices y 13 del instrumento); la matriz ejecuta 200 operaciones con fallo para 100 posiciones distintas, además de las reproducciones y controles locales. TypeScript (`npx tsc --noEmit`) y ESLint (`npm run lint`) terminaron con código 0. `git diff --check` no detectó errores. La última ejecución completa se hizo sin actualizar snapshots. Los benchmarks omitidos existentes no son pruebas de rendimiento ni se presentan como validación Android.

## Límites y criterios para autorizar fase 1

- Node ejecuta callbacks SQL sincrónicamente; no reproduce la cola, puente, locking ni scheduling de `react-native-sqlite-storage` en Android. Las barreras cubren API de promesas, no ventanas de callbacks nativos.
- La base en memoria no demuestra recuperación de proceso, durabilidad en disco, apagado, BUSY entre conexiones, journal/checkpoint, copia de respaldo ni concurrencia con Kotlin. Dos fixtures son bases independientes, no dos conexiones a un archivo compartido.
- La fase 0 no implementa permisos de conexión, revocación de ámbitos, runner exterior, resultado desconocido ni coordinación nativa. Inyecta un fallo por ejecución; campañas combinadas de fallo original + rollback/cierre y aislamiento de conexiones requieren ampliar escenarios en fases posteriores.
- Los cuatro fixtures y 100 posiciones cubren estos caminos, no todos los comandos/rutas de SmartFin. Las restricciones y los splits se prueban aparte; no se acredita con ello todo el ciclo de suscripciones, alertas o recordatorios Android.
- Autorizar fase 1 requiere revisar esta evidencia, mantener las caracterizaciones actuales y aprobar el alcance del diseño: dueño de conexión, cobertura de todos sus consumidores/lecturas, ciclo de vida, permiso prestado sin deadlock, revocación y política de incertidumbre sin reintento automático. Preparar pruebas de concurrencia/rollback fallido y un harness Android aislado antes de publicar garantías del driver.
- Para iniciar fase 1 deben estar verdes Jest, TypeScript y ESLint, sin cambios de esquema/dependencias ni pérdida de las correcciones/optimizaciones anteriores. La autorización de esta entrega no se extiende a producción ni a fase 1.
