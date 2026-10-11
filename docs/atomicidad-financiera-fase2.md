# Atomicidad financiera: fase 2

11 de octubre de 2026. Implementación limitada a Movimientos manuales y acciones rápidas.

Altas, transferencias, ediciones históricas, borrados, conversiones débito/crédito y cambios
de cuotas comparten un dueño de conexión y un único BEGIN IMMEDIATE/COMMIT. Un fallo del
cuerpo seguido de ROLLBACK confirmado restaura todas las escrituras de esa operación.
COMMIT/ROLLBACK sin recibo confirmado producen `unknown`, bloquean la conexión y no disparan
reintentos financieros. No hay cambios de esquema, migraciones, contratos públicos de
repositorios, dependencias, versión del driver ni módulos Kotlin de respaldo/recordatorios.

## Línea base y reglas conservadas

Se aplicó `.agents/skills/smartfin-financial-domain/SKILL.md` y se revisaron AGENTS, arquitectura,
base de datos, flujos, suscripciones, diseño y los informes de fases 0, 1 y 1.1, contrastándolos
con llamadores, repositorios, SQL y pruebas. Las fases anteriores estaban presentes.

Antes de modificar producción pasaron **275 pruebas, 33 suites y ocho snapshots**; TypeScript
y ESLint también pasaron. Se conservaron el árbol de trabajo anterior y sus cambios sin
revertirlos. Los logs, el estado inicial y las fuentes originales de los dos casos de uso
están en [baseline](atomicidad-fase2/baseline/). No se abrió ninguna base financiera real.

Esta matriz describe los efectos previos caracterizados y preservados en éxito:

| Operación | Estado/tipo/dirección y referencias | Saldo/deuda | Ingreso/gasto/patrimonio |
|---|---|---|---|
| Ingreso/gasto débito | Fecha solicitada; identidad/createdAt/moneda/estado anteriores en edición | Ingreso suma; salida resta en cuenta no tarjeta y medio no crédito; el impacto manual no filtra por posted | Dashboard solo posted del prefijo mensual; ingreso o gasto una vez |
| Transferencia | Principal y `<id>-in`, direcciones y contracuentas cruzadas | Origen −importe, destino +importe, acompañante sin segundo impacto | Capital fuera de ingreso/gasto; patrimonio conservado |
| Impuesto 4×1000 | `<id>-4x1000`, gasto separado | Origen −max(1, round(importe × 0.004)) | Gasto e impacto patrimonial únicamente por impuesto |
| Compra de crédito | Movimiento completo; cuota relacionada, progreso preservado si términos no cambian | Deuda por compras completas no canceladas menos pagos, mínimo cero | Gasto publicado una vez; cuotas afectan extracto, sin otro gasto |
| Pago existente editado/borrado | Tipo creditCardPayment y destino preservados; medio puede ser debit | Reverso del débito anterior, nuevo impacto si procede, deuda y extracto reconciliados | Sin segundo gasto; no cambia la clasificación del pago |
| Gasto conciliado con suscripción | Movimiento, ocurrencia, proyecciones, alertas e intenciones relacionadas | Solo el movimiento modifica saldo/deuda | Editar actualiza actualAmount/paidAt; borrar/incompatibilizar reabre cobro; compromiso no se suma como gasto |

No se cambió el dinero COP/number/REAL, el orden de acumulación, las fechas civiles/ISO,
los predicados de estados, los redondeos, la deuda por compra completa ni la conservación de
progreso de cuotas sin cambios. No se añade una regla universal de saldo suficiente a los
manuales que antes permitían saldo negativo. Las nuevas precondiciones de conexión, identidad,
cuentas vigentes y conflicto evitan aplicar una intención sobre un estado obsoleto.

## Límite de operación y conflictos

`sqliteRepositoryScope.ts` asocia privadamente cada instancia SQLite con su handle. Los
contratos de repositorio siguen iguales. `manualTransactionScope.ts` exige el mismo ámbito
para cuentas, movimientos y tarjetas; rechaza mezclas antes de adquirir la conexión.
Construye repositorios participantes y reutiliza `runSharedSQLiteTransaction` de fase 1.
Si el llamador ya entrega un participante activo, lo reutiliza y deja el commit a su dueño.
No abre una transacción anidada, no readquiere la cola y no cambia el límite exterior de IA.
Los dobles de dominio sin SQLite conservan su comportamiento de prueba; no acreditan rollback.

Las cuentas se leen dentro del permiso. La fila editada/eliminada se relee por ID en el
adaptador del repositorio y se compara en todos sus campos persistidos, incluso si updatedAt
coincide en el mismo milisegundo. Una edición eliminada o modificada y un borrado obsoleto
se rechazan con `ManualTransactionConflict`. Borrar una fila ya ausente no vuelve a revertir
su saldo. Una pata inflow de transferencia se rechaza indicando usar el movimiento de origen,
evitando tratar el acompañante como otra operación principal.

El ID de un alta incluye una secuencia por runtime; antes del impacto se comprueba que no
existan el principal ni sus IDs derivados. El índice de dedupe existente sigue vigente.
Repetir el mismo objeto de solicitud standalone reutiliza su promesa/resultado, incluido un
rechazo unknown; no ejecuta otra vez el comando. Los resultados de un participante son
provisionales y no se guardan como confirmaciones: un ámbito revocado no puede reutilizarse
después del rollback exterior. Esto no es un recibo durable ni una garantía exactamente una
vez para solicitudes reconstruidas o después de reiniciar el proceso.

Todas las escrituras que antes realizaba cada operación quedan dentro del mismo ámbito:
preparación de crédito sin clasificar, reversos, saldos nuevos, principal/acompañantes/impuesto,
eliminaciones, cuotas, deuda, extractos y la conciliación de suscripciones del repositorio.
Los generadores participantes conservan sus consultas y UPDATE + INSERT condicionado; los
usos heredados de REPLACE en cuotas/extractos no se ampliaron. Los triggers de revisión se
confirman/revierten junto con esas tablas. No se aplican compensaciones financieras.

La pantalla refresca el historial y cierra/resetéa el formulario tras confirmar el movimiento,
antes del aviso de tarjeta pendiente. Un fallo de ese aviso muestra **Movimiento guardado**;
no se presenta como fallo del gasto confirmado. Conflictos e incertidumbre muestran sus
mensajes explícitos. Las pruebas de pantalla verifican ese comportamiento.

## Cuatro estados parciales históricos

Los ocho snapshots originales permanecen intactos. `phase0ManualTransactions.ts` contiene
la implementación congelada anterior, exclusivamente para caracterización. Las pruebas de
fase 0 y las caracterizaciones parciales anteriores la usan explícitamente. Las regresiones
funcionales y la aceptación de fase 2 usan producción. No se actualizaron snapshots para
ocultar diferencias.

| Caso de fase 0 | Antes: persistencia parcial tras rechazo | Fase 2, rollback confirmado |
|---|---|---|
| Transferencia 100.000 con impuesto; falla INSERT de movimientos | Banco 899.600, destino 100.000, sin movimientos, gasto 0 | Banco 1.000.000, destino 0, sin movimientos nuevos; todas las tablas y revisión iniciales |
| Pago; falla INSERT después del débito | Registro independiente deja banco 900.000, deuda 250.000 y pago ausente | El registro independiente sigue fuera de fase 2. Editar/borrar un pago existente desde Movimientos sí restaura su snapshot: banco 900.000, deuda/extracto 150.000 y pago 100.000 intactos |
| Borrado de gasto 250.000; falla después de reverso | Banco 1.000.000 con gasto original todavía existente | Banco 750.000 y gasto/hijos originales íntegros |
| Edición de pago 100.000→50.000; falla extracto | Banco 950.000, deuda 200.000, pago 50.000, extracto antiguo 150.000 | Banco 900.000, deuda/extracto 150.000 y pago original 100.000; relaciones/auditoría/revisión intactas |

En éxito se conserva la transferencia con banco 899.600, destino 100.000, tres movimientos,
gasto 400 y patrimonio 999.600. Editar el pago a 50.000 deja banco 950.000 y deuda/extracto
200.000, patrimonio 750.000 y gasto 250.000. Se compara el éxito histórico y actual por todas
las filas/columnas y métricas, normalizando exclusivamente IDs recién generados y manteniendo
sus relaciones. El pago independiente mantiene su caracterización parcial de fase 0 y no
se presenta como protegido.

## Inyección de fallos y validación Node

La aceptación usa SQLite real en memoria, el esquema/migraciones de producción y el reloj
fijo de fase 0. Descubre cada escritura alcanzada en éxito y repite el caso en bases nuevas
fallando antes y después. Exige un ROLLBACK realmente completado, ausencia de COMMIT y
`requireIntegralRollback` sobre tablas completas, métricas, revisión, auditoría, FK e integridad.
No usa tolerancias nuevas ni compara únicamente el dashboard.

**356 puntos de rollback aprobados en 15 caminos**. La
[matriz detallada](atomicidad-fase2/node-fault-matrix.json) incluye altas de ingreso/débito/crédito,
preparación sin clasificar, transferencia e impuesto, cambio de destino/retirada del impuesto,
conversión de transferencia a gasto, cambios de cuenta/fecha, pagos existentes, acciones
rápidas y suscripciones pagadas de enero fuera del horizonte futuro. También se verifican
edición/borrado concurrentes, lector en espera, acciones repetidas, colisión de ID antes de
escrituras, FK/dedupe reales, cuentas obsoletas, igualdad de timestamps, mezcla de conexiones,
ámbitos revocados y pérdida de respuesta COMMIT sin reintento. Los importes no finitos
manuales y los conteos no finitos rápidos se rechazan antes de escribir.

Jest completo final: **310 pruebas aprobadas, 34 suites, ocho snapshots**; tres benchmarks
preexistentes siguen omitidos. TypeScript estricto y ESLint pasan. `git diff --check` pasa.
Se conservaron las suites de rendimiento, fases 0/1/1.1, IA y suscripciones.
[Jest](atomicidad-fase2/jest-final.log), [TypeScript](atomicidad-fase2/typescript-final.log),
[ESLint](atomicidad-fase2/eslint-final.log), [diff check](atomicidad-fase2/diff-check.log).

## Android y rendimiento

APK release/Hermes de prueba con el driver instalado parcheado, ABI arm64-v8a/x86_64.
API 24 usa el AVD sintético; API 35 usa HONOR CRT-NX3. Nombres de base nuevos y exclusivos
del paquete de prueba; no se abre ni modifica la base de `com.smartfin`. Los fingerprints
verifican que las fuentes financieras del APK coinciden con el checkout final. Los reportes
incluyen entorno, trazas, SQL/punto exacto de fallo y metadatos de producción antes/después.

| Verificación final | API 24 | API 35 |
|---|---:|---:|
| Casos fase 2, incluidas matrices y controles | 250 aprobados | 250 aprobados |
| Puntos antes/después de escritura con rollback íntegro | 244 | 244 |
| Regresión de recuperación fase 1.1 | 17 aprobados | 17 aprobados |
| Validación/apertura de base con 100.000 movimientos | 322 ms | 1.073 ms |
| Conversión rápida sobre esa base | 8.729 ms | 18.291 ms |
| Espera observada del lector durante esa operación | 8.730 ms | 18.361 ms |

[API 24](atomicidad-fase2/verified-api24/result.json) y
[API 35](atomicidad-fase2/verified-api35/result.json) pasan sin errores de FK, discrepancias
de snapshots ni deadlocks observados en sus casos. La campaña distingue COMMIT antes/después
con recibo perdido y ROLLBACK perdido: devuelve unknown, no repite la solicitud, cierra el
handle y reabre/verifica la base sintética. Que la reapertura muestre saldo inicial o confirmado
no reclasifica automáticamente la intención anterior.

Se repitieron las campañas críticas de fase 1.1 con el mismo APK final: `core` (14 casos),
`begin-after`, `commit-before` y `rollback-before` (un caso cada una) en ambas API.
Todas pasaron. [Recuperación API 24](atomicidad-fase2/recovery-api24-core/result.json),
[recuperación API 35](atomicidad-fase2/recovery-api35-core/result.json) y
[resumen consolidado con las ocho campañas](atomicidad-fase2/validation-summary.json).

Las diez matrices Android cubren transferencias, pagos existentes, borrados, crédito/cuotas,
ambas conversiones rápidas y conciliaciones históricas de suscripciones. La matriz Node
amplía otros cinco caminos. No se atribuyen esos caminos adicionales a Android.

La campaña intermedia se conserva en `atomicidad-fase2/api24` y `api35`: tuvo una expectativa
incorrecta sobre qué cuenta débito elegía el fallback (el orden por nombre era distinto), y
la conversión grande API 35 superó el watchdog de 60 segundos. **No se contabiliza como
aprobada.** Se corrigió la aserción para comparar todos los saldos/deudas y se sustituyeron
lecturas completas usadas únicamente para localizar una fila por la consulta interna por ID.
La conciliación sigue leyendo el historial completo. La actividad aislada mantiene la pantalla
encendida, evitando que el bloqueo de pantalla interfiera en la campaña.

El límite de inicialización/verificación de 10 segundos no se cambió: no produjo un rechazo
innecesario con estas bases. No es una garantía para cualquier tamaño/dispositivo. La espera
de lectura durante una conciliación grande es material y permanece documentada; no se
sacaron escrituras del límite atómico ni se redujo la conciliación a las páginas visibles.
SectionList, páginas de 50, filtros/búsquedas, cachés/revisiones y consultas optimizadas del
dashboard no se modificaron.

Una instalación limpia `npm ci` en `C:/sfatomicity-phase2-dependencies` ejecutó postinstall.
Los hashes del Java de recuperación, sqlite.core.js y build.gradle coinciden exactamente
con el driver instalado. La segunda aplicación del parche es idempotente.
[Instalación](atomicidad-fase2/clean-install.log),
[hashes](atomicidad-fase2/clean-patch-hashes.json),
[idempotencia](atomicidad-fase2/clean-patch-idempotence.log).
No cambió el alcance del parche ni se reinstalaron dependencias del checkout de producción.

## Archivos cambiados exclusivamente en esta fase

| Área | Archivos |
|---|---|
| Adaptadores internos nuevos | `src/database/sqliteRepositoryScope.ts`; `src/modules/transactions/useCases/manualTransactionScope.ts` |
| Operaciones manuales | `saveManualTransaction.ts`; `updateTransactionQuickly.ts` bajo `src/modules/transactions/useCases/` |
| Participación de repositorios | `src/modules/accounts/repositories/sqliteAccountRepository.ts`; `src/modules/creditCards/repositories/sqliteCreditCardRepository.ts`; `src/modules/transactions/repositories/sqliteTransactionRepository.ts` |
| Publicación de resultado UI | `src/modules/transactions/ui/TransactionsScreen.tsx` |
| Aceptación y evidencia histórica | `__tests__/financialAtomicityPhase2.test.ts`; `helpers/phase0ManualTransactions.ts`; `helpers/financialIntegrityFixture.ts`; `helpers/financialAtomicityScenarios.ts`; `financialAtomicityInfrastructure.test.ts`; `financialIntegrity.test.ts`; `transactionsScreen.test.tsx` |
| Harness y entrega | `scripts/androidAtomicityPhase2/{prepare.js,ManualCampaign.js,run.ps1,README.md}`; este informe y `docs/atomicidad-fase2/` |

La lista no atribuye a fase 2 los cambios de fases anteriores ya presentes en git status.
`atomicSQLite.ts`, `managedSQLite.ts`, coordinación, ciclo de vida, scripts del parche, IA,
Suscripciones y Kotlin de producción se reutilizaron sin modificarlos en esta fase.

## Límites y decisión de fase 3

La garantía cubre el ámbito SQL de los comandos manuales sobre los repositorios SQLite
oficiales y la conexión administrada del runtime JS. No incluye conexiones Kotlin directas,
otros procesos, notificaciones, archivos de respaldo, muerte de proceso durante COMMIT,
apagado, almacenamiento lleno ni todos los dispositivos API 24. Los fallos son inyecciones
deterministas en el adaptador de promesas alrededor del driver real, no fallos físicos.

No existe recibo durable universal: una solicitud reconstruida puede representar otra alta;
unknown exige verificación explícita antes de repetir. No se reparan datos financieros
históricos incoherentes. El registro independiente de pagos y la gestión completa de tarjetas
todavía conservan límites parciales; IA, API de Suscripciones y coordinación nativa mantienen
el alcance de sus fases anteriores. La latencia del historial grande requiere una tarea de
rendimiento específica si se quiere reducir, conservando equivalencia financiera.

Siguen existiendo discrepancias históricas: el diseño conserva su encabezado de propuesta,
la skill describe los commits manuales anteriores y el mapa inicial de MODULOS_Y_FLUJOS
presenta Suscripciones como marcador. Este informe y sus pruebas documentan la fase vigente;
no se reinterpretaron esas discrepancias como nuevas reglas ni se hicieron reparaciones ajenas.

Recomiendo autorizar una fase 3 separada y acotada al registro independiente de pagos de
tarjeta: su persistencia parcial sigue reproducida, mientras que fase 2 y la regresión crítica
de recuperación pasan en Node y ambas API. Debe conservar la política de unknown y exigir
snapshots completos y rollback confirmado. La latencia medida requiere seguimiento separado;
estos resultados no certifican todos los dispositivos ni fallos físicos. No se inicia fase 3
en esta entrega.

## Reproducción

```powershell
$env:SMARTFIN_PHASE2_REPORT = "$PWD/docs/atomicidad-fase2/node-fault-matrix.json"
npm test -- --runInBand
npx tsc --noEmit
npm run lint
git diff --check
```

[Preparación y ejecución Android](../scripts/androidAtomicityPhase2/README.md).
