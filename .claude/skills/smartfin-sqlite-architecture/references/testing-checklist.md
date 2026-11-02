# Selección de pruebas y criterios de salida

## Preparar una verificación segura

Lee configuración, fixtures y efectos secundarios antes de ejecutar. Usa Node admitido por `package.json`, dependencias ya instaladas, reloj fijo y datos sintéticos. No instales paquetes ni abras bases reales por usar esta skill. Los temporales con archivo deben ser creados por el fixture y quedar fuera de datos de la app/respaldos del usuario. No ejecutar scripts de campañas que preparen APK, instalen, borren o controlen dispositivos sin autorización Android explícita.

En este árbol `jest.config.js` descubre TS/TSX, usa preset RN y `__tests__/setup/redirectEvidenceWrites.js`. Mantén `SMARTFIN_WRITE_EVIDENCE` sin activar; la evidencia nueva va por defecto a `artifacts/jest-evidence`, o a un directorio aislado seleccionado para el encargo. No sobrescribas JSON históricos bajo docs para hacer coincidir una prueba. Un benchmark `.test.js` o bajo variable puede no ejecutarse en la suite normal.

## Matriz mínima según riesgo

| Cambio | Verificación obligatoria | Suites de partida existentes |
|---|---|---|
| Consulta/filtro/proyección | Equivalencia completa y de orden, casos límite de fechas/Unicode/NULL/estados/empates, EXPLAIN con valores reales sintéticos y medición reproducida | `__tests__/transactionHistoryPagination.test.ts`, `__tests__/transactionHistoryRefinement.test.ts`, `__tests__/transactionHistoryPhase5E2RangePlan.test.ts`, `__tests__/creditCardReconciliationEquivalence.test.ts`, `__tests__/sharedFinancialTotals.test.ts` según consumidor |
| Índice/DDL/migración | Fixture de versión previa pertinente e instalación vacía, conservación de datos/relaciones, unicidad/CHECK/FK, interrupción/rollback, repetición y validación postmigración | `__tests__/subscriptions.test.ts`, `__tests__/sharedExpenses.test.ts`, `__tests__/sharedForgiveness.test.ts`; añadir casos de la nueva versión autorizada |
| Comando financiero/ámbito | Éxito y delta/equivalencia, fallo antes/después de cada escritura, snapshots completos iguales tras rollback, concurrencia determinista, COMMIT/ROLLBACK antes/después, no reintento, handle revocado | `__tests__/financialAtomicityInfrastructure.test.ts`, `__tests__/sharedSQLiteCoordination.test.ts`, `__tests__/financialAtomicityPhase2.test.ts`, `__tests__/financialAtomicityPhase3A.test.ts`, `__tests__/financialAtomicityPhase3B.test.ts`, `__tests__/financialAtomicityPhase4.test.ts`, `__tests__/subscriptionAtomicityPhase4.test.ts` según flujo |
| Conexión/driver/Android | Node más recibos perdidos/tardíos, cuarentena y generaciones; driver instalado/parche; prueba real de apertura/commit/close/reopen y ciclos nativos cuando esté autorizada | `__tests__/sqliteRecoveryLifecycle.test.ts`, `__tests__/sqliteAndroidRecoveryPatch.test.ts`, `__tests__/sharedSQLiteCoordination.test.ts`; campañas específicas bajo `scripts/` solo después de revisar su README y permisos |
| Captura/publicación/exportación | Checkpoint busy/incompleto, cierre/reapertura, hashes/esquema/conteos/revisión, copia parcial/manifiesto corrupto, reanudación original, precisión REAL/orden/años y exclusión de escritores | `__tests__/localSnapshotCoordination.test.ts`, `__tests__/backupPublication.test.ts`, `__tests__/backupRecoverabilityPhase5E5.test.ts`, `__tests__/backupCsvPhase5E6.test.ts`, `__tests__/backupCsvYearQueryPhase5E4.test.ts` |
| Borrado/ciclo de recursos | Commit de DELETE+intención+recibo, rollback total, unknown, limpieza pending, épocas y exclusión con backups/Headless, recuperación concurrente/reinicio aislado | `__tests__/financialDeletionPhase5C.test.ts`, `__tests__/financialDeletionRecoveryPhase5E4.test.ts` |
| Rendimiento dependiente de volumen | 1.000/10.000/100.000 con distribución de AGENTS, comparación funcional primero; tiempos SQL/JS/permiso/lectores y plataforma registrados | `__tests__/representativeHistory.test.ts`, `__tests__/transactionHistoryPhase5E3FiftyYears.test.ts`; leer condiciones de los otros benchmarks antes de seleccionarlos |

No ejecutes toda la tabla por una edición acotada. Selecciona suites por llamadas/entidades/riesgo. Los cambios estructurales/tipos/producción requieren también `npm run typecheck` y checks pertinentes del proyecto; ante impacto transversal amplía a la suite completa. Una entrega solo de documentación/skill requiere validación de formato, enlaces, rutas, coherencia y aplicación a escenarios, no cambios de producción para justificar tests.

Ejemplo focalizado, desde la raíz:

```powershell
npm test -- --runInBand --runTestsByPath __tests__/sharedSQLiteCoordination.test.ts __tests__/sqliteRecoveryLifecycle.test.ts __tests__/sqliteAndroidRecoveryPatch.test.ts
```

## Comparar estado financiero, no solo promesas

`__tests__/helpers/realSQLite.ts` aporta trazas/fallos/barreras; `__tests__/helpers/financialState.ts` y `__tests__/helpers/financialIntegrityFixture.ts` aportan snapshots de tablas y métricas. Usa fixtures del ámbito actual; no cambies consumidores a helpers phase0 para obtener aceptación.

Compara saldos por cuenta, deuda por tarjeta, patrimonio/disponible, ingresos/gastos por periodo, cuotas/extractos, vínculos compartidos/suscripciones, auditoría y revisión. Para una refactorización, exige igualdad; para cambio funcional, delta esperado y resto equivalente. Normaliza únicamente IDs/auditoría generados que estén fuera del objetivo, conservando relaciones. Una suma global puede ocultar compensaciones erróneas entre cuentas.

Incluye no finitos y límites seguros en entradas afectadas; decimales, cantidades grandes, importes heredados fraccionarios y fechas mixtas. No atribuyas a todo el dominio la validación implementada en un único flujo.

## Distinguir caracterización y aceptación

Antes de usar una prueba como oráculo, lee qué código ejecuta y qué estado exige. `__tests__/financialIntegrity.test.ts`, `__tests__/financialAtomicityPhase0.test.ts`, helpers phase0 y baselines históricos pueden ejecutar versiones congeladas que documentan escrituras parciales. No justifican introducir ese comportamiento en el código actual.

`jest.reproductions.config.js` usa `.repro.ts/.repro.tsx` con caracterización y `test.failing`: verde puede significar que la aceptación **sigue fallando como se esperaba**. Reporta esos resultados separados de regresiones estables. Una prueba reparada debe promoverse siguiendo la metodología del proyecto, no eliminando la aserción.

## Qué debe quedar en el informe

- Comando/configuración, Node/SQLite y plataforma, fixture/semilla/intervalo temporal, resultados y omisiones reales.
- Para SQL: consulta/plan/muestras antes/después y equivalencia. Para transacciones: posiciones de fallo, snapshots, número de BEGIN/COMMIT y resultado ante finalización incierta.
- Para migración: versiones y variantes ensayadas, preservación y PRAGMA. Para plataforma: distinguir mock Node, verificación estática del parche, evidencia histórica Android y campaña real nueva.
- Límites explícitos: pruebas omitidas/skipped, tolerancias justificadas, falta de autorización de dispositivo o ausencia de restauración implementada. Una suite verde no certifica funcionalidad que nunca ejecutó.
