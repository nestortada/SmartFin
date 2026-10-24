# Atomicidad financiera: fase 3B

17 de octubre de 2026. Alcance: gestión/asociación de tarjetas y corrección de pagos
positivos cuyo importe efectivo es nulo o inválido. No inicia fases posteriores.
La implementación y las pruebas críticas de fase 3B están verificadas en ambas API.
La validación Android se completó el 18 de octubre de 2026: las catorce campañas de
API 24/API 35 están aprobadas. La interrupción previa del celular quedó resuelta con
una nueva ejecución de las cinco campañas que faltaban, sin cambios de producción.

## Fuentes y línea base

Se aplicaron `smartfin-financial-domain` y `react-native-best-practices`, siguiendo
AGENTS, arquitectura, base de datos, diseño de atomicidad e informes 0/1/1.1/2/3A/3A.1.
Se siguieron los llamadores de gestión/relaciones, repositorios, `CreditCardsScreen`,
`TransactionsScreen`, IA y el runner compartido. El checkout empezó limpio.

Antes de cambiar producción: **488 pruebas aprobadas, tres benchmarks preexistentes
omitidos y ocho snapshots aprobados**; TypeScript estricto y ESLint con código 0.
Las fuentes anteriores de los cinco archivos solicitados están en
[baseline](atomicidad-fase3b/baseline/), junto a los logs de
[Jest](atomicidad-fase3b/baseline-jest.log),
[TypeScript](atomicidad-fase3b/baseline-typescript.log) y
[ESLint](atomicidad-fase3b/baseline-eslint.log).

`phase3BManageCreditCards.ts` y `phase3BCreditCardRelations.ts` congelan exclusivamente
para pruebas la implementación anterior. No sustituyen fuentes de producción ni se
actualizaron los ocho snapshots históricos. Los oráculos de fase 0, las regresiones
manuales de fase 2 y las consultas optimizadas de fase 3A.1 permanecen activos.

## Diagnóstico y matriz de efectos

Antes, guardar cuenta y perfil confirmaba por separado; asociar movimientos, cambiar
referencias de cuotas y reconciliar también. La pantalla resolvía después las alertas.
El cierre de pantalla reconciliaba primero y validaba/cerraba en otra unidad. Incluso
una validación fallida podía dejar confirmada la reconciliación previa.

| Operación y estado inicial | Efectos financieros preservados | Límite nuevo |
|---|---|---|
| Crear/editar tarjeta activa, con/sin perfil | Misma identidad, createdAt, saldo/deuda heredados, cupo y metadatos; misma fórmula de tasa mensual | Lectura vigente, validación, cuenta y perfil comparten commit |
| Asociar crédito por clasificar | Reasigna compras que coinciden con pistas; conserva importe, moneda, fecha, estado, ID y progreso de cuotas; reconcilia todas las tarjetas activas | Movimientos, referencias de cuotas, deuda y extractos juntos |
| Guardar desde ambas pantallas | Mantiene la asociación anterior y resuelve la alerta bajo las mismas condiciones/nombre que cada pantalla usaba | Cuenta/perfil + asociación + alerta en un solo commit |
| Reconciliar | Compras completas no canceladas, incluidos pending; pagos no cancelados; cuotas solo en el extracto | Todas las cuentas/extractos alcanzados juntos |
| Cerrar desde pantalla | Primero reconcilia; exige ausencia de cuotas vigentes, cupo utilizado y obligaciones del periodo; cierra sin borrar historia | Reconciliación, validaciones y cambio de estado juntos |
| Pago válido | min(round(amount), deuda), débito único de origen; no genera segundo gasto; conserva patrimonio en los fixtures | Ámbito de fase 3A intacto |
| Pago efectivo nulo/fraccionario/inseguro | Rechazo autorizado; no se corrige ni redondea la deuda histórica | Ningún efecto confirmado, incluida reconciliación/revisión |

El fixture principal incluye banco de 1.000.000 COP, tarjeta Visa con compra de 90.000,
tres compras antiguas por clasificar de 120.000/120.001/120.002, estados posted/pending/
cancelled y tres planes con una de tres cuotas ya pagada. La nueva tarjeta Ghost tiene
deuda cero antes de asociación y 240.001 después. Asociar no crea un segundo gasto;
incorpora la deuda antes no clasificada y puede reducir el patrimonio, como antes.
Las cuotas conservan progreso, vencimientos y referencias de identidad. La compra
cancelada se asocia según el predicado previo y continúa excluida de deuda/extracto.

## Implementación

`creditCardManagementScope.ts` crea repositorios sobre el participante del runner
existente. La creación/edición y el cierre directo adquieren ese ámbito; la asociación
y reconciliación reutilizan `withCreditCardPaymentScope`. Una llamada participante no
abre otra transacción ni adquiere nuevamente la cola. Mezclar conexiones en los flujos
multirrepositorio se rechaza antes de BEGIN. Los dobles de dominio sin metadatos SQLite
conservan sus pruebas, sin atribuirles garantías de persistencia.

`creditCardManagementCommands.ts` ofrece `saveCreditCardWithAssociations` y
`closeCreditCardWithReconciliation`, consumidos por las pantallas. Captura la intención
antes de esperar; vuelve a leer la cuenta dentro del ámbito y rechaza una edición
obsoleta, incluso si updatedAt coincide en el mismo milisegundo. La pantalla conserva
la cuenta/tasa vistas al abrir el formulario; el comando comprueba el perfil cuando
recibe la tasa esperada. El cierre comprueba también su cuenta esperada antes de
reconciliar. Una creación no sobrescribe un ID ya existente.

La misma solicitud compuesta independiente conserva su promesa/resultado/rechazo en
un WeakMap del runtime; los resultados participantes no se guardan como recibos. La UI
añade guardas síncronas contra doble envío y mantiene bloqueado el formulario tras
unknown durante esa instancia. Cierre del modal, selección/refresco y toast ocurren
después del commit. Un fallo de presentación informa que la tarjeta ya quedó guardada.
No se añade idempotencia durable entre reinicios ni se reconstruyen solicitudes inciertas.

`readUnclassifiedCreditTransactions.ts` consulta todas las filas por clasificar con
medio credit, conserva el orden del lector anterior y usa el mapeador existente. La
decisión final de coincidencia permanece en el dominio. No agrega filtro de fecha,
estado o límite de filas. Evita materializar movimientos ajenos en la asociación; las
pantallas delegan estos comandos sin leer historial para asociar. El hook/consulta de
overview conserva sus lecturas previas, fuera de esta optimización. La reconciliación
mantiene la consulta especializada de fase 3A.1,
el índice/orden, los predicados, las sumas JS, los redondeos y las escrituras financieras.

No se modifican runner, coordinación de conexión, driver/parche, esquema, migraciones,
dependencias, Kotlin, respaldo, borrado financiero, lógica de IA, suscripciones,
compartidos/condonaciones, dashboard ni historial paginado. Los llamadores existentes
de IA/manuales prestan su participante; esta fase no amplía sus comandos ni su alcance.

## Regla monetaria autorizada

`registerCreditCardPayment` rechaza entradas no finitas/no positivas como antes.
Además rechaza un positivo que redondea a cero antes de cualquier escritura. Después
de reconciliar/releer deuda, valida que `min(Math.round(amount), previousDebt)` sea
un entero seguro positivo, al menos $1 COP. No sube artificialmente el pago ni modifica
deudas históricas. Un rechazo dentro del ámbito revierte también la reconciliación inicial.

| Entrada o límite efectivo, COP | Resultado |
|---|---|
| 0,01 / 0,40 / 0,49 | Rechaza: «El importe del pago debe ser de al menos $1 COP» |
| 0,50 / 1 | Pago de 1, si deuda/fondos lo permiten |
| 100.000, deuda 90.000 | Pago de 90.000 |
| 100.000, deuda 250.000 | Pago de 100.000; regresión fase 3A |
| 100.000,6 | Mantiene pago de 100.001; regresión fase 3A |
| Deuda limita el efectivo a 0,40 / 0,50 / 1,40 / 90.000,50 | Rechaza el efectivo fraccionario, sin redondear deuda |
| Cero, negativo, NaN, Infinity, -Infinity | Rechaza, sin escritura |
| Fondos insuficientes | Rechaza, rollback de la reconciliación previa |

La UI usa el formato/parseo COP existente únicamente en el formulario de pago y permite
coma decimal: «0,40» deja de interpretarse como cuarenta pesos. Los formularios de cupo
no cambian. No se modifican redondeos del 4×1000, cuotas o suscripciones. La expectativa
histórica `[0.4, 0]` de fase 3A se retira expresamente y se sustituye por regresiones de
rechazo; no se reducen sus 52 posiciones de rollback.

## Verificación Node

[Matriz íntegra y muestras](atomicidad-fase3b/node-fault-matrix.json).
Cada fixture usa SQLite real en memoria, FK habilitadas, reloj JS/SQL fijo y todas las
tablas/migraciones vigentes. Las comparaciones incluyen columnas completas, tablas vacías,
auditoría, revisión financiera, vínculos, saldos, deudas, disponible, patrimonio e
ingreso/gasto/ahorro; foreign_key_check vacío e integrity_check correcto.

| Flujo | Escrituras descubiertas | Fallos antes/después |
|---|---:|---:|
| Crear cuenta/perfil | 3 | 6 |
| Editar cuenta/perfil | 3 | 6 |
| Asociar compras antiguas/cuotas/reconciliación | 13 | 26 |
| Crear + asociar + resolver alerta | 17 | 34 |
| Editar + asociar + resolver alerta | 17 | 34 |
| Validar/cerrar directamente | 1 | 2 |
| Reconciliar + validar/cerrar | 4 | 8 |
| Reconciliar independientemente | 3 | 6 |
| **Total** | **61** | **122** |

Todos los puntos exigen alcanzar la posición inyectada, error original, un recibo de
ROLLBACK confirmado, ausencia de COMMIT y snapshot inicial exactamente igual. Triggers
se ejecutan realmente; no se inventan puntos JS dentro de ellos. En éxito se comparan
ambas versiones con igualdad estricta; solo se normalizan IDs generados de los fixtures
con sus referencias. No se usan tolerancias monetarias nuevas.

También se verifican cuotas parcialmente pagadas, estados y fechas antiguas, varias
tarjetas, cuenta cerrada/inactiva/ausente, identidad repetida, cuenta/tasa obsoletas,
concurrencia de ediciones, compra que precede a un cierre en cola, exclusión de lectores,
mezcla de conexiones y participación exterior/revocación. Las pérdidas de recibos antes/
después de COMMIT/ROLLBACK mantienen unknown y no repiten la solicitud. Se preserva
la distinción entre reapertura utilizable y confirmación del comando anterior.
Tres controles adicionales cubren la resolución de una alerta explícita sin compras
coincidentes: éxito y fallo antes/después del UPDATE de alerta, con rollback íntegro.
La creación/asociación en pantalla también se conserva confirmada si falla su toast;
un segundo envío del mismo botón no vuelve a escribir. Las pruebas de componentes usan
el react-test-renderer ya instalado, sin añadir RNTL ni dependencias.

Jest final: **542 pruebas aprobadas, tres benchmarks preexistentes omitidos,
46 suites aprobadas y ocho snapshots aprobados**. Incluye transferencias/pagos,
suscripciones, gastos compartidos, condonaciones, IA, dashboard e historial paginado.
TypeScript estricto, ESLint y git diff --check pasan.
[Jest](atomicidad-fase3b/jest-full-final.log),
[TypeScript](atomicidad-fase3b/typescript-final.log),
[ESLint](atomicidad-fase3b/eslint-final.log),
[diff](atomicidad-fase3b/diff-check.log),
[52 puntos de fase 3A](atomicidad-fase3b/phase3a-regression.json).


Muestras Node con historial ajeno adicional (además de cuatro compras y tres planes),
sin tiempo de fixture/snapshot incluido. El lector se encola inmediatamente después del
comando; su duración incluye su SELECT final. No son percentiles.

| Filas adicionales | Operación | Operación (ms) | Lector (ms) |
|---:|---|---:|---:|
| 1000 | Crear + asociar | 2.51 | 2.48 |
| 1000 | Reconciliar + cerrar | 0.97 | 0.96 |
| 1000 | Reconciliar | 0.89 | 0.88 |
| 10000 | Crear + asociar | 5.21 | 5.17 |
| 10000 | Reconciliar + cerrar | 2.62 | 2.59 |
| 10000 | Reconciliar | 2.34 | 2.32 |
| 100000 | Crear + asociar | 36.97 | 36.94 |
| 100000 | Reconciliar + cerrar | 21.09 | 21.05 |
| 100000 | Reconciliar | 20.89 | 20.86 |

## Android y rendimiento

Ambas API aprobaron **157 casos de fase 3B**, incluidos los 122 puntos de rollback
y la equivalencia exitosa de los ocho flujos. La matriz descubre las mismas 61
escrituras que Node.

| Campaña | API 24, emulador Android 7 | API 35, HONOR CRT-NX3 |
|---|---:|---:|
| Fase 3B | 157 aprobados / 122 puntos de fallo | 157 aprobados / 122 puntos de fallo |
| Pagos fase 3A | 72 aprobados / 52 puntos de fallo | 72 aprobados / 52 puntos de fallo |
| Manual fase 2 | 274 aprobados / 268 puntos de fallo | 274 aprobados / 268 puntos de fallo |
| Recuperación core de fase 1.1 | 14 aprobados | 14 aprobados |
| begin-after / commit-before / rollback-before | 3 aprobados | 3 aprobados |

Se completaron **catorce de catorce campañas**, sin campañas pendientes: 520 casos por
API, incluidos 442 puntos de fallo de las matrices de fases 3B/3A/2 por entorno.
Las siete campañas API 24 y las de fase 3B/3A de API 35 se recogieron el 17 de octubre.
El 18 de octubre se repitió desde fixtures nuevos la campaña manual interrumpida de API
35 y se ejecutaron sus cuatro campañas de recuperación: **291 casos adicionales aprobados**.
No se utilizó como aprobación el resultado desconocido de la ejecución desconectada.

La comprobación previa confirmó el mismo hash del APK y la igualdad de los 289 archivos
de producción, el harness y el driver. No hubo recompilación ni cambios de producción;
los controles Node/TypeScript/ESLint del 17 de octubre siguen correspondiendo a esas
mismas fuentes. La comprobación de diff se repitió al actualizar esta evidencia.
Los metadatos de la aplicación financiera no cambiaron durante ninguna de las catorce
campañas recogidas. La interrupción y sus archivos se conservan como historial.

[Resumen completo de campañas](atomicidad-fase3b/validation-summary.json),
[interrupción API 35 y resolución](atomicidad-fase3b/android-api35-interruption.json),
[verificación previa al retomar](atomicidad-fase3b/resume-20261018-preflight.json),
[cierre de las cinco campañas retomadas](atomicidad-fase3b/resume-20261018-completion.json),
[fuentes/driver verificados](atomicidad-fase3b/current-source-verification.json),
[hash del APK](atomicidad-fase3b/apk-hash.json),
[auditoría de archivos protegidos](atomicidad-fase3b/scope-audit.json).
Los **289 archivos de src** coinciden con el checkout del APK final; el driver incluido
coincide con el instalado. El ejecutable y los fingerprints del harness están en
`C:/sfatomicity-phase3b-20261017`. No se abrieron bases financieras reales.

| API | Filas ajenas adicionales | Operación | Operación (ms) | BEGIN/COMMIT (ms) | Lector (ms) |
|---:|---:|---|---:|---:|---:|
| 24 | 1000 | Crear + asociar | 41.22 | 38.47 | 41.19 |
| 24 | 1000 | Reconciliar + cerrar | 21.13 | 18.13 | 21.09 |
| 24 | 1000 | Reconciliar | 13.82 | 11.69 | 13.79 |
| 24 | 10000 | Crear + asociar | 56.84 | 54.31 | 56.81 |
| 24 | 10000 | Reconciliar + cerrar | 24.39 | 21.23 | 24.37 |
| 24 | 10000 | Reconciliar | 19.80 | 16.79 | 19.78 |
| 24 | 100000 | Crear + asociar | 125.50 | 122.94 | 125.47 |
| 24 | 100000 | Reconciliar + cerrar | 53.87 | 51.56 | 53.84 |
| 24 | 100000 | Reconciliar | 45.40 | 43.14 | 45.37 |
| 35 | 1000 | Crear + asociar | 142.69 | 134.29 | 142.49 |
| 35 | 1000 | Reconciliar + cerrar | 70.61 | 60.76 | 70.44 |
| 35 | 1000 | Reconciliar | 51.84 | 38.95 | 51.64 |
| 35 | 10000 | Crear + asociar | 197.57 | 190.15 | 197.38 |
| 35 | 10000 | Reconciliar + cerrar | 168.36 | 158.89 | 168.20 |
| 35 | 10000 | Reconciliar | 66.06 | 58.21 | 65.91 |
| 35 | 100000 | Crear + asociar | 770.83 | 762.01 | 770.66 |
| 35 | 100000 | Reconciliar + cerrar | 7950.50 | 7936.95 | 7950.40 |
| 35 | 100000 | Reconciliar | 250.69 | 242.02 | 250.37 |

Son muestras independientes por volumen/flujo, sin calentamiento repetido ni percentiles.
El ámbito incluye la petición de BEGIN y el recibo de COMMIT; el lector incluye su SELECT
final. Los fixtures y snapshots quedan fuera de los tiempos. Las consultas de movimientos
devuelven seis filas en crear/asociar, cero en reconciliar/cerrar y una en reconciliar,
aunque haya 100.000 filas ajenas. El plan conserva un recorrido del índice de fecha,
por lo que pocas filas transferidas no implican coste SQL constante.

La muestra API 35 de reconciliar/cerrar sobre 100.000 filas tardó **7.950,50 ms** y
registró un intervalo atribuido al lector de **7.950,40 ms** (véase la aclaración de
instrumentación posterior), frente a 250,69 ms de la reconciliación independiente
en otro fixture de ese volumen. Es una latencia material observada, no un deadlock: ambas
operaciones completaron y pasaron sus controles. Sin mediciones emparejadas/repetidas de
esos comandos antes/después no se atribuye causalmente a esta fase, al puente o al motor,
ni se presenta como una mejora universal de rendimiento. La consulta optimizada y las
sumas de fase 3A.1 permanecen; no se sacan escrituras del commit para reducir la espera.

El APK release/Hermes usa el paquete sintético `com.smartfin.atomicityphase1.tests`,
JDK 17 y las ABI arm64-v8a/x86_64. No abre datos financieros reales.
[Preparación y reproducción](../scripts/androidAtomicityPhase3B/README.md).

**Aclaración posterior de instrumentación (18 de octubre):** la verificación
[post-3B](verificacion-rendimiento-post3b.md) detectó que el contador del lector de
esta campaña se calculaba después de esperar al escritor, aunque el lector podía
haber terminado antes. Los valores de esa columna se conservan como intervalos
históricos, pero no acreditan por sí solos espera efectiva del lector. No invalida
los tiempos independientes de operación/BEGIN-COMMIT ni las campañas funcionales.
La verificación posterior captura la finalización real y la cola del lector.

## Discrepancias y límites

El diseño original conserva su encabezado de propuesta y los informes anteriores
describen deliberadamente los límites de sus fases. La skill conservaba un mapa de
11 de octubre anterior a la atomicidad manual/pagos y a los flujos compartidos actuales.
Se añadió una sección vigente de fase 3B y se corrigió su advertencia transaccional;
no se usa la discrepancia histórica para cambiar la contabilidad. Las suites actuales
de compartidos y condonaciones acreditan los escenarios que ejercitan; no se atribuye
una exploración de interfaz Android de esos módulos a las campañas de tarjetas.

Las garantías requieren la conexión administrada y el mismo runtime JS. No cubren
escritores Kotlin independientes, otros procesos ni coordinación de respaldo/borrado.
Un COMMIT con recibo perdido permanece unknown aunque la reapertura revele el resultado;
no hay compensación, reparación de datos reales ni recibo durable universal.

Los fallos inyectados alrededor de SQL/recibos no equivalen a apagado físico, disco
lleno ni a todos los fallos del puente. Las medidas son muestras sintéticas por volumen,
sin percentiles, prueba de FPS ni extrapolación a todos los dispositivos. No se modifican
índices, representación monetaria, pragmas ni datos heredados. Los metadatos de tasa/cuota
de manejo siguen sin generar cargos financieros automáticos.

Los benchmarks añaden historial ajeno a un conjunto pequeño de compras relevantes.
No miden 100.000 compras que deban reasignarse o planes simultáneos: materializar y
guardar muchas coincidencias conserva un coste proporcional al conjunto afectado.
El método heredado de actualización de referencias usa una lista IN; sus límites de
parámetros siguen dependiendo del SQLite instalado. No se cambian esos lotes o sus
límites en esta fase; un error dentro del comando ahora revierte toda la unidad.

La aplicación de pruebas API 24 quedó detenida y su emulador se cerró el 17 de octubre.
Tras las verificaciones retomadas del 18 de octubre, la aplicación sintética del celular
API 35 también quedó detenida. No se instaló ni se abrió la aplicación financiera real.
