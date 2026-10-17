# Atomicidad financiera: fase 3A

17 de octubre de 2026. Alcance exclusivo: registro independiente de pagos de tarjeta.

## Estado y límite

`registerCreditCardPayment` conserva su contrato de éxito y ejecuta sus escrituras bajo
un permiso de conexión y un solo `BEGIN IMMEDIATE` / `COMMIT`. Incluye ambas reconciliaciones
completas, el débito bancario y la persistencia del pago con todos los efectos que el
repositorio vigente realiza. Un rechazo del cuerpo seguido de ROLLBACK confirmado restaura
todas las tablas, auditoría, referencias y revisión. El runner de fases 1/1.1 conserva los
resultados `confirmed`, `rolledBack` y `unknown`. El adaptador devuelve el valor confirmado,
propaga el error original cuando se confirma rollback y publica `SQLiteCommandFailure`
con su resultado `unknown` cuando no se confirma la terminación.

No se añaden compensaciones ni reintentos automáticos. No se cambian esquema, migraciones,
dependencias, driver, módulos nativos, reglas contables, edición/borrado manual de fase 2,
asociación de compras, IA o API de Suscripciones. Se preservan los cambios que ya estaban
en el árbol de trabajo, incluidos los de fechas civiles y gastos compartidos.

## Análisis y fallo reproducido

Se aplicó la skill `.agents/skills/smartfin-financial-domain/SKILL.md` y se contrastaron
AGENTS, arquitectura, base de datos, flujos, Suscripciones, diseño de atomicidad e informes
0/1/1.1/2 con los repositorios, SQL y llamadores actuales. `manageCreditCards.ts` administra
cuentas/perfiles y no registra este pago. El llamador de producto es
`CreditCardsScreen.handleRegisterPayment`; los otros llamadores encontrados son pruebas y
harnesses sintéticos (`scripts/sharedCommands` y `scripts/androidAtomicityPhase2`). No se
extendió la transacción de la gestión general ni se alteraron esos flujos.

La suite completa **antes de modificar producción** terminó con 438 pruebas aprobadas,
1 fallida y 3 omitidas; 40 suites aprobadas, 1 fallida y 3 omitidas; ocho snapshots aprobados.
El fallo previo es `subscriptions.test.ts:384`: espera `pending`, recibe `overdue` tras borrar
un gasto vinculado. Su fachada fija el reloj en 3 de octubre, pero el repositorio de
movimientos usa `new Date()`; la ocurrencia es del 15 de octubre y la fecha real de ejecución
es 17 de octubre. Esta discrepancia se registra y no se repara en fase 3A.

La [fuente anterior](atomicidad-fase3a/baseline/creditCardTransactionRelations.ts.before.txt)
y el [estado inicial de git](atomicidad-fase3a/baseline/git-status.txt) permiten distinguir
los cambios previos de esta entrega. `phase0CreditCardPayment.ts` conserva exclusivamente
para pruebas el cuerpo anterior del pago. Las caracterizaciones históricas lo llaman
explícitamente; no se actualizaron los ocho snapshots para ocultar el fallo anterior.
La reconciliación financiera importada por ese helper permanece sin cambios en esta fase.

| Escenario obligatorio (COP) | Banco | Deuda | Extracto | Patrimonio | Gasto del periodo | Pago |
|---|---:|---:|---:|---:|---:|---|
| Inicial, compra publicada de 250.000 | 1.000.000 | 250.000 | 250.000 | 750.000 | 250.000 | Ausente |
| Implementación anterior, falla INSERT del pago después del débito | 900.000 | 250.000 | 250.000 | 650.000 | 250.000 | Ausente |
| Fase 3A, mismo fallo y ROLLBACK confirmado | 1.000.000 | 250.000 | 250.000 | 750.000 | 250.000 | Ausente |
| Fase 3A, COMMIT confirmado | 900.000 | 150.000 | 150.000 | 750.000 | 250.000 | 100.000 |

Las pruebas comparan todos los campos de todas las tablas instaladas: saldos, movimientos,
cuotas/progreso, extractos, perfiles, entidades de suscripción/compartidos, revisión,
auditoría, referencias y tablas vacías, además de métricas y FK/integridad. La equivalencia
del éxito con el cuerpo anterior normaliza únicamente los IDs generados, manteniendo sus
referencias; no normaliza importes, fechas ni auditoría. Los snapshots de rollback no
normalizan ningún campo.

## Matriz financiera preservada

| Operación/predicado | Importe, fecha y referencias | Efectos |
|---|---|---|
| Reconciliación inicial y final | Todas las tarjetas reales activas, historial completo ordenado y cuotas actuales | Deuda `max(0, compras completas - pagos)`; conserva orden de suma y genera los mismos extractos de todas esas tarjetas |
| Compra `expense/outflow` no cancelada | Incluye `pending`; cuota activa múltiple aporta `monthlyAmount` al extracto | Deuda por compra completa; dashboard cuenta gasto solo si `posted`; cuota no es otro gasto |
| Pago `creditCardPayment` no cancelado | Identificado por tarjeta y contracuenta; incluye `pending` | Reduce deuda/extracto según fecha/ciclo; no se suma a ingreso/gasto |
| Registro de pago | Origen activo cash/bankAccount/savingsAccount; tarjeta creditCard activa; `min(round(amount), deuda)`; ISO de la intención | Débito único, outflow/posted/debit con origen y targetAccountId; exige fondos; patrimonio conservado en el escenario solicitado |
| Rechazo de validación | Importe no finito/no positivo antes de SQL; cuenta/tarjeta/fondos/deuda dentro del ámbito | No persiste tampoco la reconciliación inicial |

Se conserva el comportamiento heredado para importes positivos que redondean a cero
(p. ej. 0,4): puede registrarse pago de cero. No se introduce una regla monetaria nueva.
Tampoco se añade una validación de divisas que no existía en este flujo; los escenarios
requeridos usan COP. Se conservan `number`/SQLite REAL, fechas civiles vigentes,
redondeos a enteros y UPDATE + INSERT condicionado de cuentas/movimientos.
Los REPLACE heredados de extractos no se ampliaron ni refactorizaron.

## Coordinación, identidad y UI

`creditCardPaymentScope.ts` exige que los tres repositorios oficiales compartan exactamente
el mismo handle y crea repositorios con el participante del runner. Una mezcla de conexiones
se rechaza antes de BEGIN. Si recibe un participante activo reutiliza su transacción;
su resultado sigue siendo provisional hasta que el dueño exterior confirme. El ámbito
revocado rechaza acceso antes de enviar SQL. Los dobles sin metadatos SQLite conservan su
contrato de pruebas y no acreditan atomicidad de otro adaptador.

Dentro del permiso se comprueba por PK la identidad del movimiento antes de cualquier
escritura, se reconcilia, se releen cuentas y deuda, se validan los datos y se realizan
el débito, el movimiento y la reconciliación final. Una secuencia del runtime evita que dos
pagos del mismo milisegundo sobrescriban su movimiento. Dos intenciones diferentes se
serializan y la segunda usa la deuda y el saldo confirmados por la primera; si no hay fondos
se revierte también su reconciliación inicial.

El mismo objeto de solicitud independiente reutiliza su promesa y resultado/rechazo.
Se capturan sus valores antes de esperar al dueño de conexión. No se guarda un resultado
participante como recibo confirmado. No hay recibo durable universal: reconstruir una
solicitud o reiniciar el proceso no conserva esa identidad. Después de `unknown` hay que
verificar el estado explícitamente antes de otra intención; no se infiere del patrimonio.

La pantalla utiliza una guarda síncrona contra doble pulsación, bloquea otro envío tras
`unknown` durante esa instancia y publica cierre/refresco después de confirmar. Si falla
el toast posterior, informa que el pago quedó guardado. Las pruebas de pantalla usan
react-test-renderer ya instalado; no se añade RNTL ni otra dependencia.

## Fallos y evidencia Node

[Reporte de matriz, snapshots completos y reproducción](atomicidad-fase3a/node-fault-matrix.json).

| Configuración | Escrituras descubiertas | Fallos antes/después | Resultado exigido |
|---|---:|---:|---|
| Una tarjeta, compra 250.000, pago 100.000 | 10 | 20 | Error original, un ROLLBACK confirmado, cero COMMIT, snapshot inicial exacto |
| Dos tarjetas, segunda con compra en tres cuotas | 16 | 32 | Igualdad exacta incluyendo ambas deudas/extractos y cuotas originales |
| Total de matriz | 26 | 52 | Todas las posiciones alcanzadas y verificadas |

Cada cuenta usa UPDATE + INSERT condicionado, incluidos INSERT que no agregan fila.
La matriz cubre reconciliación inicial, origen, movimiento, reconciliación final y cada
extracto de todas las tarjetas. Verifica el recibo de ROLLBACK, no solo la presencia de
su solicitud en traza. Las restricciones/triggers son los de producción sobre SQLite real
en memoria; no se usan bases financieras del usuario.

Además se prueban validaciones, no finitos, parcial, exceso de deuda, redondeo, mismo objeto
repetido, colisión de identidad, conexiones distintas, concurrencia por deuda/fondos,
lectores en espera, `pending/cancelled`, cuotas y otra tarjeta, participación/revocación
y pérdida de recibos antes/después de COMMIT/ROLLBACK. Los tests existentes de fase 2
siguen cubriendo las ediciones y borrados que esta fase no modifica.

## Android, rendimiento y controles finales

Build release aprobado: JDK 17, Hermes, ABI arm64-v8a/x86_64 y driver instalado con
el parche de recuperación existente, sin cambios adicionales. El harness reutiliza la
infraestructura de fases 1.1/2 y el paquete sintético `com.smartfin.atomicityphase1.tests`.
Cada fixture abre un nombre nuevo de pruebas. No abre la base de `com.smartfin`; los
metadatos de ese paquete permanecieron iguales en las diez campañas.
En el emulador no estaba instalado el paquete de producción.

| Verificación | Android 7 / API 24, emulador x86_64 | Android 15 / API 35, HONOR CRT-NX3 |
|---|---:|---:|
| SQLite nativo | 3.9.2 | 3.44.5 |
| Casos de pagos fase 3A | 72 aprobados | 72 aprobados |
| Puntos antes/después de escrituras con snapshot inicial exacto | 52 | 52 |
| Regresión crítica de recuperación fase 1.1 | 17 aprobados | 17 aprobados |
| Pago y dos reconciliaciones, base pequeña | 36 ms | 74 ms |
| Espera de lector, base pequeña | 37 ms | 76 ms |
| Pago y dos reconciliaciones, 100.000 movimientos adicionales | 18.377 ms | 30.375 ms |
| Espera de lector, 100.000 movimientos adicionales | 18.378 ms | 30.419 ms |

[Resultados API 24](atomicidad-fase3a/api24/result.json),
[resultados API 35](atomicidad-fase3a/api35/result.json),
[resumen consolidado de las diez campañas](atomicidad-fase3a/validation-summary.json),
[build](atomicidad-fase3a/android-build.log), [hash del APK](atomicidad-fase3a/apk-hash.json).
Entorno, logcat, fingerprints y metadatos antes/después están junto a cada reporte.
Los 72 casos incluyen la matriz, validaciones, pago parcial/exceso, round/cap, repetición,
concurrencia por deuda/fondos, lectores excluidos, cuatro pérdidas de recibo y dos mediciones.
No hubo timeout ni fallo de FK/integridad en esas campañas.

La recuperación se repitió con el mismo APK: `core` (14 casos), `begin-after`,
`commit-before` y `rollback-before` (uno cada una), en ambas API. Incluye las
regresiones de sesión/cierre, reapertura, préstamo/revocación, lectores y los controles
negativos de recuperación que mantienen cuarentena. Las cuatro incertidumbres específicas
del pago mantienen `unknown` y no repiten la solicitud: tras reapertura solo COMMIT
ejecutado con recibo perdido deja el pago; los demás casos conservan el snapshot inicial
completo. La persistencia observada no reclasifica automáticamente el resultado incierto.

Las duraciones corresponden a una muestra por tamaño/entorno, sin fixture ni snapshot
incluidos en `operationMs`. La espera del lector sí incluye su consulta final. No son
percentiles ni una certificación de rendimiento de todos los dispositivos; emulador y
hardware físico son distintos y se ejecutaron simultáneamente. La traza confirma dos
lecturas completas del historial en cada pago. No se perfiló por separado el coste nativo,
bridge y mapeo JS.

Referencia de fase 2: la conversión rápida de 100.000 movimientos tardó 8.729 ms en API 24
y **18.291 ms en API 35**, con lector de 8.730/18.361 ms
(`atomicidad-financiera-fase2.md:137`). El pago actual es otra operación y hace ambas
reconciliaciones; esas mediciones muestran un bloqueo material, pero no permiten atribuir
una regresión causal entre versiones o únicamente al nivel API. Se documenta el coste sin
recortar el historial, cambiar sumas o sacar escrituras del ámbito.

[Preparación y reproducción Android](../scripts/androidAtomicityPhase3A/README.md).
`C:/sfatomicity-phase3a-20261017` conserva el checkout/APK aislado utilizado. La aplicación
de pruebas queda detenida; no se instaló ni actualizó el paquete financiero de producción.

## Controles finales de código y límites

- Jest completo: **472 pruebas aprobadas, 1 fallo previo, 3 omitidas**; 42 suites
  aprobadas, una fallida y tres omitidas; ocho snapshots aprobados.
  [Log íntegro](atomicidad-fase3a/jest-full.log). Las 34 pruebas nuevas corresponden
  a 31 escenarios parametrizados de aceptación y tres de pantalla.
- TypeScript (`npx tsc --noEmit`): código 0.
  [Log](atomicidad-fase3a/typescript-final.log).
- ESLint (`npm run lint`): código 0, sin avisos.
  [Log](atomicidad-fase3a/eslint-final.log).
- `git diff --check`: código 0. Los mensajes informativos de conversión LF/CRLF
  del árbol existente no son errores de whitespace.
  [Log](atomicidad-fase3a/diff-check.log).
- [Auditoría de alcance](atomicidad-fase3a/scope-audit.json): reconciliación idéntica a
  la fuente inicial; núcleo financiero del pago idéntico salvo identidad del movimiento.
- [Fingerprints del código compilado frente al checkout](atomicidad-fase3a/current-source-verification.json):
  fuentes financieras, infraestructura y driver coinciden; no se atribuyen resultados a
  una versión distinta de la compilada.

Las pruebas Node utilizan Node v24.16.0 y SQLite real `:memory:`. No acreditan por sí solas
scheduling del bridge Android ni recuperación en disco. La garantía de coordinación sigue
limitada al mismo runtime JS y conexión administrada; no se certifican conexiones Kotlin
independientes, otros procesos, muerte de proceso durante COMMIT, corte de energía,
almacenamiento lleno ni todos los fabricantes. Las inyecciones deterministas alrededor
del driver no equivalen a fallos físicos ni a desaparición silenciosa de todos los callbacks.

Un recibo perdido de COMMIT se mantiene `unknown` incluso si la reapertura demuestra que
el pago quedó persistido. Un recibo perdido de ROLLBACK tampoco se etiqueta `rolledBack`.
La recuperación de fase 1.1 no repite el cuerpo financiero. La UI no incorpora un asistente
de conciliación de comandos inciertos ni un registro durable de intenciones en esta fase.

La reconciliación hace dos lecturas/materializaciones del historial completo por pago,
una antes y otra después de insertar el movimiento; recorre ese conjunto por tarjeta.
El coste de traer/mapear/filtrar esas filas puede ser significativo con 100.000 movimientos.
No se sustituyen por páginas del historial ni se altera el orden de sumas. La consulta por
PK nueva solo comprueba colisión de identidad. Reducir las lecturas globales sin cambiar la
semántica de reconciliación necesita otra tarea de rendimiento; aquí no se mueven escrituras
fuera del COMMIT común ni se hace una refactorización general.

Permanecen discrepancias documentales históricas: `diseno-atomicidad-financiera.md` conserva
su encabezado de propuesta; el apartado «Límites y decisión de fase 3» de
`atomicidad-financiera-fase2.md` describe el pago anterior como parcial; la skill aún describe
los commits manuales previos a fase 2. Este informe y las pruebas de fase 3A establecen el
límite vigente del registro independiente. La gestión general de tarjetas continúa fuera
de alcance: guardar cuenta/perfil, asociar compras y cerrar tarjeta no reciben una nueva
unidad global en esta entrega. No se inicia otra fase.
