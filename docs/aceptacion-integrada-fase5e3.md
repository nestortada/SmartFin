# SmartFin 5E.3 — cierre de aceptación integrada, recuperación Android y preparación para producción

24–25 de octubre de 2026, America/Bogota. Fase de validación: **no se modificó código de producción,
esquema, migraciones, dependencias, driver ni cálculos financieros**. `BACKUP_PUBLICATION_UI_ENABLED`
sigue en `false`. Solo datos sintéticos; no se abrió ninguna base ni respaldo real. No se avanza a fase 6.

**Veredicto: fase 5E CONDICIONADA** (sección 12). Activación de respaldos: **BLOQUEADA**.

Evidencias: [`aceptacion-fase5e3/`](aceptacion-fase5e3) — Node (`node/`), Android (`android/api24`,
`android/api35`, [resumen](aceptacion-fase5e3/android/summary.md)), UI (`ui/api35`), lector (`reader/`),
calidad (`baseline/`, `closure/`). Procedimiento: [`scripts/phase5e3/`](../scripts/phase5e3).

## Línea base y fuentes

- Fuentes revisadas: AGENTS, ARQUITECTURA, BASE_DE_DATOS, informes 5C–5E.2, defectos 5E-001/5E-002/5E2-001,
  contrato de época/borrado 5C, lector v2 de 5E y las dos skills.
- Checkout: los cambios no confirmados de 5D–5E.2 siguen presentes y sin commit. Las **327 huellas
  originales** del APK 5E.2 coinciden byte a byte con el checkout: la validación 5E.3 usa las fuentes de 5E.2.
- Antes de pruebas nuevas: tsc, ESLint y `git diff --check` en 0; Jest 762 aprobadas / 8 omitidas / 62 suites
  ([baseline](aceptacion-fase5e3/baseline)). `__tests__/zzTieBreakProbe.test.ts` es una sonda temporal de 5E.2
  que dice «deleted after use» y no se borró; no se tocó (decisión 7).
- Nueva regla del propietario durante la fase ([AGENTS.md](../AGENTS.md) «Performance Volumes»): **100.000
  movimientos son ~50 años de uso**; la aceptación de volumen se mide con historiales repartidos en décadas y no se
  ejecutan cargas de 100k concentradas. La campaña de 100k en un solo día se **canceló** en curso en ambos
  dispositivos y no cuenta como resultado.

## 1. Matriz final de garantías

| Garantía | Estado | Evidencia |
|---|---|---|
| Historial sin omisiones ni duplicados (5E2-001) | **Aceptada** | Node + API 24 (SQLite 3.9.2) + HONOR (3.44.5), oráculo independiente, `created_at` variable |
| Historial: invalidación de cursores ante mutaciones | **Aceptada** | 5 mutaciones × 2 órdenes × 6 distribuciones (Node) y 4 (Android) |
| Rendimiento historial 50 años, API 24 | **Cumple** | 1ª pág. 172–426 ms; posteriores ≤175 ms; búsqueda vacía 2,1–2,8 s |
| Rendimiento historial 50 años, HONOR | **Cumple parcialmente** | 1ª pág. civil 523–557 ms (>500); resto cumple |
| Dashboard 50 años | **Cumple** | 11–22 ms API 24; 31–85 ms HONOR |
| Determinismo decimal del dashboard | **Pendiente de decisión** | Orden no contractual; formato COP depende de la versión Android |
| Integridad financiera (28 regresiones + ciclo integrado) | **Aceptada** | 28/28 API 24; 28/28 HONOR (un reintento documentado) |
| Rechazo de $0,40 COP / no repetir `unknown` | **Aceptada** | `phase5e-integrated`, `phase5c-*` |
| Recuperación al abrir la app | **Funciona, con defecto UX** | Mensajes correctos; 5E3-001 en HONOR |
| Recuperación al volver al primer plano | **No acreditada** | Termina en 5E3-001; finalización no verificada |
| Recuperación automática Android | **Parcial** | Sí tras actualización en API 24; no observada en HONOR ni tras reboot API 24 (3 min) |
| Respaldo manual: integridad v2 | **Aceptada** | 64 archivos, 51 CSV anuales (51 años calendario del fixture 5E.3), 100.000 filas, SHA-256 |
| Respaldo manual: presupuestos de tiempo | **No cumple en HONOR** | Captura 8,5–13,2 s (≤6 s); publicación 30–37,5 s (≤20 s) |
| Lector semanal v2 | **Contrato listo, no adoptado** | 13 escenarios sintéticos |

## 2. Verificación definitiva de 5E2-001

Las pruebas que lo detectaron se repitieron con cinco formas de `created_at`: agrupado, **inverso**,
**permutado**, constante y formatos mezclados. Todas las páginas se recorren hasta agotar el historial y se
comparan objetos y orden exactos contra el oráculo de 5E.2: todas las filas, orden clave/`created_at`/rowid
en JS y semántica congelada del hook.

| Ámbito | Cobertura | Resultado |
|---|---|---|
| Node 1.000 | 13 distribuciones × 5 `created_at` × 12 filtros × 2 órdenes + empates fecha/`created_at` en fronteras de página y lote | 129/129 |
| Node 10k / 100k | 65 casos a 10k + 6 a 100k (repartidos) + 3 formas de 50 años | todos exactos |
| API 24 y HONOR | 7 distribuciones × 5 `created_at` a 1k; 7 × 2 a 10k; 5 repartidas a 100k; 3 formas de 50 años a 100k; 8 consultas (newest, oldest, ASCII, Unicode, Unicode oldest, sin coincidencias, mes+cuenta, combinado) | todas exactas, sin duplicados ni omisiones |

Incluye fechas canónicas y heredadas, con y sin `civil_date`, offsets, fechas inválidas, búsquedas ASCII,
Unicode, positivas y negativas, filtros combinados y mutaciones concurrentes: inserción, cambio de
`created_at`, cambio de fecha, borrado y fecha inválida. En cada caso el cursor previo se invalida, la
escritura entre sentencias de una página no publica una revisión mezclada y un recorrido nuevo coincide con
el oráculo.

**5E2-001: CERRADO.** Se excluyen como intentos del harness: el límite de 999 variables de SQLite 3.9.2, la
base no reiniciada antes de `fifty-*` y una campaña de 100k a 3 años en HONOR no reintentada; el formato civil
a 100k quedó cubierto por la campaña de 50 años.

## 3. Rendimiento del historial y del dashboard

Criterio de aceptación: **100.000 movimientos en 50 años transcurridos** (18.262 días, 1976-10-26 a 2026-10-25,
unos 5–6 por día). Corrección 5E.4: ese intervalo de 50 años transcurridos toca **51 años calendario**
(1976–2026), por eso generó 51 CSV anuales. Desde 5E.4 la distribución predeterminada es de exactamente
50 años calendario (1977–2026, 50 CSV anuales); ver [optimizacion-fase5e4.md](optimizacion-fase5e4.md).
Formas: civil (formato actual), legacy `YYYY-MM-DD` y migrated (40 años legacy + 10 civiles).
Mediana de 3 muestras en frío por consulta; una sola sesión por dispositivo, sin percentiles poblacionales.

| 100k / 50 años | API 24 civil / legacy / migrated | HONOR civil / legacy / migrated | Objetivo |
|---|---|---|---|
| Primera página newest | 301 / 176 / 411 ms | **534** / 180 / 317 ms | ≤500 ms |
| Primera página oldest | 296 / 172 / 426 ms | **542** / 129 / 316 ms | ≤500 ms |
| Páginas posteriores (máx. de todo el recorrido) | ≤175 ms | ≤394 ms | ≤500 ms |
| Búsqueda sin coincidencias, historial completo | 2,8 / 2,1 / 2,5 s | 3,9 (una muestra 9,4) / 4,2 / 4,2 s | ≤10 s + progreso |
| Mes + cuenta | 641 / 539 / 564 ms | 1.315 / 1.512 / 1.503 ms | sin objetivo |
| Dashboard completo | 11–22 ms | 31–85 ms | — |

- **Historial:** cumple los objetivos en API 24. En HONOR la primera página del formato civil supera 500 ms por
  ~25–55 ms; las demás formas y todas las páginas posteriores cumplen.
- **Progreso visible:** la búsqueda exhaustiva muestra «Cargando movimientos...». Es un indicador sin progreso
  cuantitativo: el objetivo «progreso visible» se cumple solo como indicador indeterminado.
- **Filtros combinados en HONOR:** mes+cuenta tarda 1,3–1,5 s. No hay objetivo definido; se registra como riesgo.
- Node (misma regla, referencia): primera página 20–141 ms, búsqueda vacía 0,41–0,59 s, dashboard 1–2 ms.

**Dashboard:** con datos repartidos el dashboard es trivial. La selectividad medida en 5E.3 (HONOR, 100k
totales) confirma que el coste de `monthlyAmounts` proviene **solo de las filas seleccionadas del mes**:

| Filas del mes | 0 | 1.000 | 10.000 | 50.000 | 90.000 |
|---|---|---|---|---|---|
| `monthlyAmounts` | 10 ms | 57 ms | 277 ms | 1.246 ms | 5.624 ms |

En todos los casos, cuentas, posición compartida y pérdidas suman unos 5–20 ms. Las cargas de 50k–90k en un
mes son estrés, no un escenario SmartFin, y no justifican un mecanismo de agregación. La propuesta de agregados
incrementales queda **descartada** salvo que cambie el criterio de volumen.

**Respaldos (50 años, 100k):** el contenido es íntegro en ambos dispositivos (64 archivos, 51 CSV anuales por los 51 años calendario del fixture,
100.000 filas, `verified`, `cloudSync=unconfirmed`).

| | Captura / admisión financiera | Publicación | Presupuesto provisional |
|---|---|---|---|
| API 24 | 3,8–4,5 s | 11,9–15,3 s | ≤6 s con aviso / ≤20 s con progreso |
| HONOR | **8,5–13,2 s** | **30,4–37,5 s** | **excedidos** |

Los presupuestos provisionales y sus advertencias de UX se mantienen. Con un historial realista de 50 años,
HONOR los excede; ver bloqueos.

## 4. Precisión decimal del dashboard y decisión pendiente

Matriz ejecutada en Node, API 24 y HONOR
([test](../__tests__/dashboardPhase5E3Precision.test.ts), [Node](aceptacion-fase5e3/node/dashboard-precision.json)).
Las **sumas binarias son idénticas en los tres motores**.

| Caso | Actual (rowid ASC) | Histórico congelado (rowid DESC) | Explícito `id ASC` | Decimal exacto | COP mostrado |
|---|---|---|---|---|---|
| 1.000 empates, 1,1/1 (5E.2) | 258,2999999999997 | 258,29999999999967 | igual que actual en ingresos | 258,30 | $ 258 en todos |
| 1.000 empates, enteros | exacto | exacto | exacto | igual | igual |
| 10.000 empates, centavos | 11.997.999,999999998 | 11.998.000,000000002 | otro ULP | 11.998.000,00 | igual |
| Centavos con total ,50 y empates | 0,5 / 2,4999999999999996 | 0,49999999999999994 / 2,5 | = actual | 0,50 / 2,50 | **Node/HONOR: $1/$2 vs $0/$3; API 24: $1/$3 en ambos** |
| Mismos centavos sin empates | 0,49999999999999994 / 2,5 | igual | igual | 0,50 / 2,50 | **Node/HONOR $0/$3; API 24 $1/$3** |

Conclusiones:

1. El orden efectivo actual es un artefacto del plan SQL (`ORDER BY date DESC, created_at DESC` sin desempate,
   que hoy entrega rowid ASC en los tres motores), no un contrato.
2. En los casos medidos las diferencias son **binarias** y no contables: ingresos, gastos y ahorro coinciden en
   decimal exacto hasta el último centavo.
3. Hay una diferencia **visible de $1 COP** cuando el total exacto termina en ,50 y la suma binaria cae en
   x,4999…. Depende del orden y, además, del **formateador `Intl` de cada versión de Android**: API 24 redondea
   el decimal exacto; HONOR y V8 redondean el binario.
4. Fijar un desempate no corrige el caso sin empates.

Campos afectados: `monthlyIncome`, `monthlyExpenses` y, por derivación, `monthlySavings`. Disponible, deuda,
patrimonio y conteo reciente no dependen del orden. Se registró además que el conteo reciente actual (día civil
Bogotá) difiere en 1 de la referencia congelada pre-civil (día UTC) para un movimiento a las 21:25. Es correcto
según el contrato civil y no es defecto.

**Propuesta (sin aplicar):**
- **(a) Política de desempate** `date DESC, created_at DESC, rowid ASC`: reproduce exactamente el resultado
  actual en todo lo medido. Es un cambio del SQL de un cálculo financiero sin cambio observable medido;
  **requiere autorización**.
- **(b) Suma exacta en centavos enteros** y formato desde el decimal exacto: elimina las dos causas, pero es un
  cambio observable y de modelo monetario. **Decisión pendiente; no se introduce en 5E.3.**

## 5. Recuperación Android diferenciada

Protocolo corregido. En 5E el runner hacía `am force-stop` antes de abrir la verificación, y eso **cancela las
alarmas del paquete**: el `automaticAlarm=false` de API 24 en 5E no era evidencia válida. En 5E.3 se observa
con `dumpsys`/logcat **sin abrir la app ni forzarla**, y la inspección lee el estado **antes** de cualquier
recuperación del harness. Ganchos de solo observación en receptor y Worker
([Phase5E3Observe.kt](../scripts/phase5e3/Phase5E3Observe.kt)).

| Ruta | API 24 | HONOR | Fiabilidad observada |
|---|---|---|---|
| **Automática**, actualización (`MY_PACKAGE_REPLACED`) | Receptor → `recover:completed` → Worker `Success` → **alarma reprogramada** sin abrir la app | No entregado en 3 min; alarma y limpieza siguen pendientes | Fiable en AOSP; no en HONOR |
| **Automática**, reboot | Sin `BOOT_COMPLETED` al receptor en 3,4 min; WorkManager relanzó un Worker pendiente que no terminó en la ventana | No probado (reboot físico no autorizado) | No acreditada |
| **Automática**, `BOOT_COMPLETED` sin reboot | — | HONOR entrega `BOOT_COMPLETED` al **iniciar** la app tras detenerla | Causa de la carrera 5E3-001 |
| Cierre del proceso | Inspección expiró (relanzamiento `singleTask`); no concluyente | — | Esperado: no repara |
| **Al abrir SmartFin** | — | «Último borrado confirmado. Limpieza Android completada.»; con recibo perdido: «Resultado del borrado desconocido. No repitas la eliminación…» | Correcta, con 5E3-001 en apertura normal |
| **Al volver al primer plano** | — | Ejecuta, pero Ajustes muestra «Cleanup already running» | No acreditada |
| **Explícita del harness** | `completed` en todos los casos | `completed` en todos los casos | No cuenta como automática |

Ninguna ruta repitió comandos financieros ni alteró tablas, FK o integridad. Las épocas antiguas no se
resucitaron: `oldEpochAlarm=false`. En HONOR el fallback real es la apertura de la app, que funciona pero
expone 5E3-001.

**Defecto nuevo 5E3-001 (severidad media-baja, UX, no financiero).**
- **Síntoma:** al abrir o volver al primer plano, Ajustes muestra un banner rojo «Cleanup already running» en
  inglés y sin contexto ([captura](aceptacion-fase5e3/ui/api35/12-open-recovery-settings.png)).
- **Causa reproducida:** `recoverFinancialDeletion` rechaza con `CleanupAlreadyRunningException` cuando otro
  dueño tiene el mutex. Hay dos fuentes:
  1. al pasar a `active`, `App.tsx` (`runSubscriptionMaintenance`) y `AppNavigator` llaman a la vez a la
     recuperación;
  2. en HONOR, el receptor por `BOOT_COMPLETED` al iniciar y el Worker que encola.
- **Efecto:** la limpieza la completa el otro dueño. También hizo fallar una vez la regresión
  `phase5c-restart` en HONOR ([race-diagnostic](aceptacion-fase5e3/android/api35/race-diagnostic)).
- **Modificación mínima propuesta (tarea separada, cambia comportamiento):** traducir la contención a un estado
  «recuperación en curso» sin error y reconsultar al terminar, o centralizar la recuperación de primer plano en
  un solo dueño JS.

## 6. Recorrido de UI probado (HONOR, APK aislado)

Se monta la `App` completa de producción (mantenimiento, navegador y sus rutas de apertura/primer plano) en el
paquete sintético. La publicación de respaldos está habilitada **solo en esa copia**; producción sigue en
`false`.

| Paso | Resultado |
|---|---|
| Apertura y dashboard | Carga con cifras del fixture (ingresos $49.617, gastos $100.044, 401 recientes) |
| Historial paginado | Primera página y carga de la siguiente al desplazar (74 movimientos distintos observados > 50) |
| Búsqueda | «merchant 49» devuelve solo coincidencias; «noexiste» → «No se encontraron movimientos» |
| Filtros | Banco/cuenta `savings` aplica solo esa cuenta |
| Ajustes ida y vuelta | Dashboard idéntico al volver: no se reaplica estado financiero |
| Recuperación al abrir | Mensaje confirmado correcto (con limpieza pendiente) |
| Resultado desconocido | Mensaje correcto, sin repetir el borrado |
| Primer plano | Termina en 5E3-001; finalización no verificada |
| Aviso de respaldo desactualizado | Aparece en la copia de prueba (bandera habilitada solo allí) |

No repetido en 5E.3: progreso de respaldo con gates y resultados verificado/pendiente/incierto. Su código no
cambió desde 5B.3, que lo validó en API 24 y HONOR. Limitaciones:
- `adb input` no escribe Unicode: la búsqueda Unicode se acreditó en Node y en las campañas Android, no tecleada
  en la UI.
- `uiautomator` del HONOR falló de forma intermitente durante desplazamientos rápidos.
- No se recorrió la UI en API 24.

## 7. Lector semanal v2 y adopción real

Contrato ejecutable y 13 escenarios sintéticos aprobados
([reader-contract.cjs](../scripts/phase5e3/reader-contract.cjs), [resultados](aceptacion-fase5e3/reader/contract-results.json)):
- selección de la última generación íntegra (más nueva dañada con el mismo tamaño y otra sin componente → rechazadas);
- 168 h inclusivas, +1 ms vencida, fecha futura como anomalía;
- conversión a Bogotá (`2026-10-25T02:30Z` → 24-oct 21:30);
- v1 como `legacyUnverified`;
- rechazo de `cloudSync` distinto de `unconfirmed`;
- **generación íntegra, reciente y de mayor revisión anterior al borrado → `unknown` sin contexto, `historical`
  con contexto**.

El manifiesto **no contiene la época**: la vigencia exige un contexto autorizado `{currentGenerationId, issuedAt}`
emitido por la app o el propietario, que hoy **no existe**.

Instrucciones finales para el analista: [lector-semanal-v2.md](aceptacion-fase5e3/lector-semanal-v2.md).
**Adopción real: pendiente. No se modificó ni probó ninguna automatización externa.**

## 8. Regresiones financieras

APK 5E.3 (fuentes 5E.2 + ganchos de observación): **28/28 campañas en API 24 y 28/28 en HONOR**:
- notificaciones, permiso denegado, Worker/Headless y tres muertes de proceso con reinicio;
- épocas antiguas y nuevas, matriz de borrado de 78 casos, fallos de limpieza, recibo perdido antes/después y
  `unknown` sin reintento;
- captura y publicación v2 con reinicios, cierre/apertura perdidos;
- ciclo integrado 5E (movimientos, transferencias con 4×1000, tarjetas y pagos, comprobante IA, suscripciones,
  compartidos/condonaciones, borrado, rechazo de **$0,40 COP**) con reinicio y recuperación 5E.1.

Cada campaña verifica todas las tablas, FK, integridad, auditoría y revisión, además de los metadatos del paquete
real sin cambios.

Jest final: **895 aprobadas, 12 omitidas, 65 suites, 8 snapshots**; tsc, ESLint y diff-check en 0
([closure](aceptacion-fase5e3/closure)). Los 4 artefactos de fases previas que Jest reescribe se restauraron con
`git restore`.

## 9. Riesgos pendientes

| Riesgo | Severidad |
|---|---|
| Tiempos de respaldo en HONOR con 50 años (captura 8,5–13,2 s, publicación 30–37,5 s) | **Alta** para activar respaldos |
| 5E3-001: error visible por contención de recuperación | Media-baja (UX) |
| Recuperación automática no observada en HONOR ni tras reboot API 24 | Media (fallback por apertura sí funciona) |
| $1 COP visible en totales exactos ,50 según orden y versión de Android | Baja–media (precisión de presentación) |
| Primera página civil en HONOR 523–557 ms; filtros mes+cuenta 1,3–1,5 s | Baja |
| Búsqueda exhaustiva sin progreso cuantitativo | Baja |
| Versiones SQLite intermedias (API 26–34) y otros OEM no probados | Media |
| Lector externo sin canal de época ni adopción | Alta para el uso semanal externo |

## 10. Bloqueos reales para activar respaldos

1. Captura y publicación en HONOR exceden los presupuestos (6 s / 20 s) con un historial de 50 años:
   optimizarlas o aceptar presupuestos nuevos con UX acorde.
2. Lector externo v2 sin canal autorizado de época: una copia anterior al borrado puede parecer vigente.
3. 5E3-001 visible en Ajustes justo donde se presenta el estado de recuperación/respaldo.
4. Verificación de la UI de respaldo con la bandera en producción (hoy solo en copia de pruebas) y percepción
   real del aviso/progreso.

## 11. Decisiones que requieren tu autorización

1. **Desempate del dashboard**: (a) `rowid ASC` explícito sin cambio medido, o (b) suma exacta en centavos (cambio
   observable de modelo monetario), o mantener el estado actual.
2. **Corregir 5E3-001** (contención como «en curso» / un solo dueño de recuperación en primer plano).
3. **Respaldos**: tarea de optimización de captura/CSV/publicación, o nuevos presupuestos con su UX.
4. **Primera página civil en HONOR** (>500 ms): aceptar o encargar optimización.
5. **Canal de contexto de época** para el analista externo y su integración/prueba reales.
6. Reinicio físico del HONOR para observar `BOOT_COMPLETED` (opcional).
7. Borrar la sonda temporal `__tests__/zzTieBreakProbe.test.ts` de 5E.2.
8. Commit/PR de los cambios de 5D–5E.3 (nada está confirmado).

## 12. Veredicto

**Fase 5E: CONDICIONADA.**

- **Aprobado:** integridad financiera y atomicidad (28/28 en ambos dispositivos); historial exacto y 5E2-001
  cerrado; rendimiento de historial y dashboard con el criterio de 50 años en API 24 y casi totalmente en HONOR;
  recuperación al abrir con mensajes correctos; contrato del lector definido.
- **Condiciones para aprobarla sin reservas:** decidir 5E3-001 y el desempate decimal (decisiones 1–2) y aceptar
  o atender la primera página civil en HONOR.
- **Respaldos y distribución con respaldos: BLOQUEADOS** (sección 10).

## 13. Criterios mínimos para comenzar fase 6

1. Decisiones 1–3 tomadas; 5E3-001 corregido y validado en apertura y primer plano en HONOR y API 24.
2. Respaldos dentro de presupuesto aceptado con historial de 50 años en HONOR, o respaldos explícitamente fuera
   del alcance de fase 6.
3. Recuperación automática: observada en el OEM objetivo, o fallback por apertura aceptado por escrito.
4. Jest, tsc, ESLint, diff-check en 0 y regresiones Android 28/28 con las huellas finales.
5. Cambios de 5D–5E.3 confirmados en control de versiones.
6. Autorización explícita del propietario para iniciar la fase 6. **No se inicia automáticamente.**
