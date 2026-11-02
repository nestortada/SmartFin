# Atomicidad, concurrencia y recuperación

Consulta primero los contratos vigentes de `smartfin-sqlite-architecture`; esta referencia organiza la prueba. Fuentes: `src/database/atomicSQLite.ts`, `src/database/databaseCoordination.ts`, `src/database/sqliteDatabase.ts` y los repositorios participantes del flujo. Un permiso de mantenimiento no es un commit; una cadena de `await` no es una transacción.

## Matriz por escritura

1. Prepara un fixture nuevo por caso, FK activas y relojes controlados. Captura snapshot completo con `__tests__/helpers/financialState.ts` y métricas independientes. Obtén primero una ejecución exitosa y su traza de SQL.
2. Descubre todas las escrituras del camino (también las que afectan cero filas), incluidas auditoría, revisión, conciliación y derivados; cuenta propietario, `BEGIN`, `COMMIT` y ausencia de transacciones anidadas. No fijes un número antiguo de puntos como cobertura universal.
3. Con `__tests__/helpers/realSQLite.ts`, inyecta un fallo de una sola vez antes y después de cada escritura usando `injectFault({write: n, phase: 'before'|'after'})`; consulta firmas actuales. Repite desde el mismo estado inicial, no reutilices una base ya mutada.
4. Inyecta además en `BEGIN`, `COMMIT` y `ROLLBACK` por SQL/ocurrencia. Separa error antes de ejecutar de error después de ejecutar: pérdida de respuesta de COMMIT puede dejar efectos confirmados. Control SQL no cuenta como INSERT/UPDATE/DELETE en el índice de escritura del helper.
5. Verifica resultado, traza, snapshot y recursos. Un rechazo de promesa no prueba rollback. No ocultes revisión/auditoría en la igualdad de rollback; normaliza únicamente identidades generadas fuera del objetivo al comparar ejecuciones exitosas, manteniendo sus relaciones.

| Resultado | Evidencia exigida |
|---|---|
| `confirmed` | Todas las entidades/deltas esperados en el mismo commit, referencias íntegras y una publicación de éxito; un fallo posterior de toast/recordatorio no reaplica finanzas |
| `rolledBack` | ROLLBACK confirmado y snapshot íntegro idéntico al inicial, sin saldos, recibos o derivados parciales; permite usar `requireIntegralRollback` |
| `unknown` | Conserva la incertidumbre; bloqueo de reenvío y cuarentena/recuperación según contrato. No llama al cuerpo financiero otra vez, no compensa ni afirma ausencia de cambios. Verifica generación/conexión recuperada y comprobante específico cuando exista |

No deduzcas rollback por ausencia de un comprobante que no tiene garantía universal. Los lotes IA tienen un recibo particular; no lo extiendas al guardado manual o a otro ID. Prueba repetición del mismo ID/contenido y rechazo del mismo ID con contenido distinto donde esté implementado.

## Carreras deterministas

Usa barreras como `pauseNextExecuteSql` y eventos de llegada/liberación, con tiempo máximo y liberación en `finally`. Evita carreras basadas en dormir un tiempo arbitrario o en `Promise.all` sin demostrar solapamiento. El adaptador síncrono de callbacks no acredita la concurrencia del driver Android.

- Escritura A pausada: inicia B y una lectura pública; comprueba que B no escribe dentro del ámbito ajeno y el lector ve la instantánea estable o espera según el contrato. Consulta la ruta administrada, no un SELECT crudo que eluda coordinación.
- Repite doble envío, edición con datos obsoletos, escritura durante mantenimiento por lotes, respaldo/cierre/borrado y recuperación. Registra orden, revisión, duración de espera y ausencia de interbloqueo.
- Comprueba liberación de permisos y revocación de participantes después de finalizar; prueba respuestas tardías y generaciones antiguas para que no reabran uso de un handle inválido.
- Para reinicio usa un archivo sintético creado en temporal único: close/reopen, recuperación repetida y estado/recibo persistido. SQLite Node no acredita durabilidad ante pérdida eléctrica ni coordinación entre procesos de Android.
- No agregues reintentos para lograr verde. Prueba solo la política ya definida, con límite y resultado observable; ante unknown detén el reenvío financiero.

## Suites para seleccionar

Desde la raíz, por ejemplo:

```powershell
npm test -- --runInBand --runTestsByPath __tests__/financialAtomicityInfrastructure.test.ts __tests__/sharedSQLiteCoordination.test.ts __tests__/sqliteRecoveryLifecycle.test.ts
```

Para el comando concreto: `__tests__/financialAtomicityPhase2.test.ts`, `financialAtomicityPhase3A.test.ts`, `financialAtomicityPhase3B.test.ts`, `financialAtomicityPhase4.test.ts` y `subscriptionAtomicityPhase4.test.ts`. Para recursos: `localSnapshotCoordination.test.ts`, `financialDeletionRecoveryPhase5E4.test.ts`, `backupPublication.test.ts` y `backupRecoverabilityPhase5E5.test.ts` bajo `__tests__/`.

Lee los caminos ejecutados: los helpers phase0/baselines pueden exigir estados parciales como caracterización. No los sustituyas por aceptación actual ni consideres repositorios mock como prueba de atomicidad SQLite. Antes de ejecutar suites de respaldo revisa corrupción de copias, temporales y lectura de evidencia histórica según la estrategia de aislamiento.
