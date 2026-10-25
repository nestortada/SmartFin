# SmartFin 5E.4 — recuperación concurrente (5E3-001) y optimización segura de respaldos manuales

25 de octubre de 2026, America/Bogota. **Veredicto: cambios de 5E.4 ACEPTADOS** en el alcance probado.
No avanza a fase 6. `BACKUP_PUBLICATION_UI_ENABLED` sigue en `false`. Respaldos automáticos fuera de alcance.
Sin cambios de esquema, migraciones, dependencias, driver, cálculos financieros, orden del dashboard,
modelo monetario ni contrato del lector semanal v2. Solo datos sintéticos y paquete aislado.

Evidencias: [`optimizacion-fase5e4/`](optimizacion-fase5e4) — línea base y cierre de calidad, Android
(`android/api24`, `android/api35`, [resumen de respaldos](optimizacion-fase5e4/android/backup-summary.json)),
UI (`ui/api35`). Procedimiento: [`scripts/phase5e4/`](../scripts/phase5e4).

## Línea base y datos representativos

- Antes de modificar producción: tsc, ESLint y diff-check en 0; Jest 895 aprobadas / 12 omitidas
  ([baseline](optimizacion-fase5e4/baseline)). Estado Git conservado; no hubo reset ni borrado de trabajos.
- Distribuciones predeterminadas permanentes ([representativeHistory.ts](../__tests__/helpers/representativeHistory.ts),
  [prueba](../__tests__/representativeHistory.test.ts), regla en [AGENTS.md](../AGENTS.md)):
  - **100.000** movimientos en **exactamente 50 años calendario** (1977–2026, hasta el día de referencia 2026-10-25);
  - **10.000** en **5 años calendario** (2022–2026);
  - **1.000** en **6 meses** (2026-04-26 – 2026-10-25).

  Usan semilla fija, fechas civiles con hora local Bogotá coherentes con el instante UTC, 6 cuentas,
  8 categorías y 4 tipos (gasto, gasto con crédito, salario los días 1/15, transferencia y pago de tarjeta),
  con estados posted, pending y cancelled. Ningún día supera 60 movimientos.
- Corregida la descripción inconsistente de 5E.3: su fixture de 50 años transcurridos (1976-10-26 – 2026-10-25)
  tocaba **51 años calendario** y por eso generaba 51 CSV. El nuevo estándar produce **50 CSV anuales**
  (63 archivos: base, 11 CSV fijos, 50 anuales y manifiesto).
- Los casos patológicos de estrés (cargas concentradas) no se usan para el presupuesto y no se ejecutaron a 100k.

## 1. Causa y corrección de 5E3-001

**Causa reproducida.** `SmartFinFinancialDeletion.recover()` hace `tryLock` y, si otro dueño tiene el mutex,
lanza `CleanupAlreadyRunningException` **antes de leer o modificar cualquier estado**. El puente nativo lo
rechazaba como error y la UI lo mostraba en Ajustes.

Dueños concurrentes demostrados:
1. `App.tsx` (mantenimiento de suscripciones) y `AppNavigator` llaman a la vez al abrir o volver a `active`.
2. En HONOR, el receptor por `BOOT_COMPLETED`, que el sistema entrega al iniciar la app, y el Worker que encola.

**Corrección mínima:**
- **Puente nativo** ([SmartFinDatabaseLifecycleModule.kt](../android/app/src/main/java/com/smartfin/SmartFinDatabaseLifecycleModule.kt)):
  solo `CleanupAlreadyRunningException` se resuelve como `{"status":"running"}`; cualquier otra excepción
  sigue rechazando. La exclusión nativa no cambia: ningún permiso ajeno se libera y no se repite el borrado.
- **JS** ([financialDeletionLifecycle.ts](../src/modules/settings/services/financialDeletionLifecycle.ts)):
  - nuevo estado `running`;
  - *single-flight*: llamadas JS simultáneas comparten una sola recuperación nativa;
  - `awaitFinancialDeletionRecovery` espera de forma acotada (750 ms, máximo 30 s), deja de consultar si el
    llamador ya no es vigente y devuelve el estado final (`completed`, `cleanupPending`, `unknown`); los
    errores inesperados siguen rechazando.
- **UI** ([AppNavigator.tsx](../src/navigation/AppNavigator.tsx)):
  - muestra «Recuperación en curso...» como estado de trabajo, nunca como error;
  - la apertura no se bloquea: si hay otro dueño, la app abre y una tarea posterior actualiza el mensaje al
    terminar;
  - en primer plano, la espera se cancela al desmontar o cambiar el listener; el *runner* existente ignora
    callbacks tardíos.
- **Mantenimiento** ([subscriptionRuntime.ts](../src/modules/subscriptions/services/subscriptionRuntime.ts)):
  espera al dueño activo antes de decidir; si sigue en curso tras el límite, aplaza sin tocar recursos.
- La intención durable y las épocas no cambian. Pruebas Node:
  [financialDeletionRecoveryPhase5E4.test.ts](../__tests__/financialDeletionRecoveryPhase5E4.test.ts) (7) y
  las suites existentes de 5C, mantenimiento e interfaz de suscripciones (51).

**Android, con un dueño real de `recover()` retenido tras adquirir el mutex de producción:**

| Comprobación | API 24 | HONOR |
|---|---|---|
| Dos llamadas JS simultáneas → `running`, no error | ✓ | ✓ |
| Espera y sigue al dueño hasta `completed` (misma identidad) | ✓ | ✓ |
| Alarma de época anterior cancelada; tablas financieras idénticas | ✓ | ✓ |
| Mantenimiento espera al dueño y termina | ✓ | ✓ |
| Recordatorio de época nueva sobrevive a una recuperación posterior | ✓ | ✓ |
| Error real durante la recuperación se informa; la intención se conserva y la siguiente recuperación completa | ✓ | ✓ |

Dos intentos del harness quedan excluidos, ninguno por defecto del producto:
1. `record()` del harness base no devuelve valores.
2. Carrera con un Worker real antes de retener el mutex; se corrigió drenando los Workers.

La campaña de error se aprobó con el APK previo a esa corrección del harness: el código de producción
es idéntico entre ambos APK.

## 2. Recorrido de apertura y primer plano (HONOR, App completa)

| Paso | 5E.3 | 5E.4 |
|---|---|---|
| Apertura normal (HONOR entrega `BOOT_COMPLETED` al iniciar) | «Cleanup already running» en rojo | Sin error |
| Tres regresos al primer plano | «Cleanup already running» | Sin error ni mensaje residual |
| Apertura con limpieza pendiente | Mensaje confirmado | «Último borrado confirmado. Limpieza Android completada.» |
| Primer plano con limpieza preparada en segundo plano (recuperación simultánea) | «Cleanup already running» | «Último borrado confirmado. Limpieza Android completada.» |

Capturas en [`ui/api35`](optimizacion-fase5e4/ui/api35). La lectura final tras volver de Inicio a Ajustes no se
capturó (volcado de `uiautomator` sin salida). No se recorrió la UI en API 24; allí se acredita con las campañas.

## 3. Perfil del respaldo con 50 años (antes)

APK base = producción + temporizadores de solo observación + corrección 5E3-001, sin optimizaciones.
Tres rondas por volumen. Mediciones por etapa (ms), 100k / 50 años calendario:

| Etapa | API 24 | HONOR |
|---|---:|---:|
| Espera de permisos / checkpoint / cierre | ≤1 / 0 / 2–5 | ≤2 / 0 / 4–5 |
| JS: verificación del origen (FK + integridad + metadatos) | 767–1.030 (integridad 653–880) | 2.136–2.256 (integridad 1.817–1.929) |
| Nativo: verificación del origen (integridad) | 630–836 (586–716) | 1.991–2.108 (1.850–1.955) |
| Nativo: copia privada + fsync | 320–376 | 341–357 |
| Nativo: integridad del snapshot | 690–810 | 1.801–3.834 |
| Nativo: SHA-256 de verificación | ~150–250 | ~120–150 |
| Reapertura SQLite (incluye `integrity_check` de apertura) | 823–1.007 | 2.172–2.750 |
| **Captura y espera financiera** | **3.526–4.294** | **8.869–11.578** |
| Revalidación del snapshot (hash + integridad) | 816–873 | 1.936–2.077 |
| **CSV anuales (50 consultas con recorrido completo)** | 9.445–11.149 | **22.635–30.073** |
| CSV fijos / SHA-256 de componentes | 6–8 / 183–236 | 6–7 / 94–114 |
| SAF escritura / relectura / validación final | 415–1.323 / 501–663 / 288–422 | 545–730 / 215–232 / 193–246 |
| Persistencia de estados del trabajo (64 escrituras) | 399–529 | 117–181 |
| **Publicación** | **12.114–15.387** | **26.138–33.410** |

**Etapas que explican la diferencia con campañas previas:**
- **Publicación:** CSV anual = 90 % (HONOR). Cada año ejecutaba `WHERE substr(COALESCE(civil_date, date),1,4)=?`,
  que recorre los 100.000 movimientos: 50 recorridos completos.
- **Captura:** la misma integridad completa se verificaba **3 veces** bajo el permiso exclusivo (JS en vivo,
  nativo en vivo, copia), más una en la reapertura. Cada una cuesta ~1,8–1,9 s en HONOR.
- No influyen de forma relevante: SAF, SHA-256, copia ni persistencia de estados.

## 4. Optimizaciones y resultados antes/después

Implementadas solo las dos mejoras demostradas:

1. **CSV anual** ([SmartFinBackupCsv.kt](../android/app/src/main/java/com/smartfin/SmartFinBackupCsv.kt)):
   - se añade un rango `[año, año+1)` sobre la expresión ya indexada `COALESCE(civil_date, substr(date,1,10))`
     (`idx_transactions_civil_day`);
   - se conserva el predicado original (pertenencia idéntica) y el `ORDER BY`;
   - el año 9999 usa una variante sin cota superior (Android no enlaza `null`).

   Node, 50 años: 4.216 → 487 ms con filas y orden idénticos
   ([prueba](../__tests__/backupCsvYearQueryPhase5E4.test.ts): representativos 1k/10k/100k, fechas heredadas,
   offsets, inválidas, años 0001/9999 y empates completos).
2. **Integridad una vez, sobre la copia**
   ([SmartFinLocalSnapshot.kt](../android/app/src/main/java/com/smartfin/SmartFinLocalSnapshot.kt),
   [localDatabaseSnapshot.ts](../src/modules/settings/services/localDatabaseSnapshot.ts)):
   - la base viva aporta metadatos (esquema, conteos, revisión, versiones, modo journal) y conserva la
     comprobación de `foreign_keys`;
   - `foreign_key_check` + `integrity_check` se ejecutan una vez, en nativo, sobre la copia privada, que es
     **idéntica byte a byte** (SHA-256) bajo el mismo permiso exclusivo, antes de aceptarla.

   La reapertura y la revalidación previa a publicar no cambian. Diferencia de comportamiento: una base viva
   corrupta ya no falla en la verificación JS, sino en la copia; la captura falla igual y la reapertura,
   que conserva su `integrity_check`, también la rechaza.

| 100k / 50 años calendario | API 24 antes | API 24 después | HONOR antes | HONOR después |
|---|---:|---:|---:|---:|
| Captura y espera financiera | 3,5–4,3 s | **2,3–2,9 s** | 8,9–11,6 s | **4,9–5,2 s** |
| Publicación | 12,1–15,4 s | **5,4–7,0 s** | 26,1–33,4 s | **6,2–6,4 s** |
| CSV anuales | 9,4–11,1 s | 2,0–2,3 s | 22,6–30,1 s | 2,6 s |

| 10k / 5 años · 1k / 6 meses | API 24 después | HONOR después |
|---|---|---|
| Captura | 0,48–0,59 s · 0,47–0,53 s | 0,53–1,38 s · 0,28–0,30 s |
| Publicación | 0,64–0,68 s · 0,33–0,38 s | 0,59–0,64 s · 0,19–0,20 s |

En 10k y 1k la diferencia antes/después está dentro de la variación entre rondas.

## 5. Integridad y hashes

En **cada ronda** (18 por dispositivo entre antes y después), los CSV publicados se comparan **byte a byte**
(SHA-256 de cada archivo) con el **exportador congelado de 5E.3 tomado de `git HEAD`**, ejecutado sobre la
misma base publicada: **todos idénticos**. En HONOR el exportador congelado tarda 22,9–23,3 s frente a 2,6 s.

Se verifican también:
- 63 componentes (50 anuales), 100.000 filas en los CSV anuales, sin omisiones ni duplicados;
- SHA-256 de la base igual al de la captura;
- manifiesto v2 `verified`, `cloudSync=unconfirmed`, `datasetCurrency=current`;
- integridad y FK de todas las tablas vivas al terminar.

## 6. Resultados Android

| | API 24 (SQLite 3.9.2) | HONOR API 35 (SQLite 3.44.5) |
|---|---|---|
| Perfiles antes (3 volúmenes × 3 rondas) | aprobados | aprobados |
| Perfiles después | aprobados | aprobados |
| Contención y error real (5E3-001) | aprobados | aprobados |
| 28 regresiones (APK optimizado) | **28/28** | **28/28** |

Las 28 regresiones cubren:
- notificaciones, permiso denegado, Worker/Headless y tres muertes de proceso con reinicio;
- épocas;
- matriz de borrado de 78 casos, fallos de limpieza, recibo perdido y `unknown` sin repetición;
- captura y publicación v2 con fallo a mitad, manifiesto parcial y pérdida de respuesta del proveedor,
  conservando la generación anterior;
- reinicio de proceso con recuperación;
- ciclo integrado 5E con rechazo de $0,40 COP.

No se reinició físicamente el HONOR ni se usaron bases o carpetas personales; el paquete real `com.smartfin`
no cambió.

## 7. Presupuestos

| 100k / 50 años | Objetivo | API 24 | HONOR |
|---|---|---|---|
| Captura y espera financiera | ≤ 6 s | **Cumple** (máx. 2,9 s) | **Cumple** (máx. 5,2 s; margen ~0,8 s) |
| Publicación | ≤ 20 s con progreso | **Cumple** (máx. 7,0 s) | **Cumple** (máx. 6,4 s) |

No se aumentó ningún presupuesto. El progreso visible ya existe (fases y archivos completados), pero la UI de
publicación sigue desactivada en producción.

## 8. Regresiones financieras

Node: Jest final **915 aprobadas, 13 omitidas, 68 suites, 8 snapshots**; tsc, ESLint y diff-check en 0
([closure](optimizacion-fase5e4/closure)). Los 4 artefactos de fases previas que Jest reescribe se
restauraron. Incluye movimientos y transferencias, tarjetas/cuotas/pagos, planes IA y comprobantes,
suscripciones, compartidos y condonaciones, borrado recuperable, notificaciones, historial paginado, dashboard
y rechazo de $0,40 COP. Android: 28/28 en ambos dispositivos.

El orden de acumulación del dashboard y el modelo monetario no cambiaron; la decisión pendiente se documenta
aparte en [decision-precision-decimal.md](optimizacion-fase5e4/decision-precision-decimal.md).

## 9. Riesgos pendientes de sincronización y restauración

| Riesgo | Severidad |
|---|---|
| Margen de captura en HONOR (~0,8 s): otros OEM o dispositivos más lentos pueden superar 6 s | Media |
| La reapertura repite `integrity_check` sobre bytes ya verificados (2,3–2,6 s en HONOR); quitarla cambiaría el contrato de apertura | Baja (propuesta separada) |
| `cloudSync=unconfirmed`: no hay evidencia de subida a Drive real, `fsync` del proveedor ni durabilidad ante corte eléctrico | Alta para depender del respaldo |
| **Restauración no implementada ni probada**: un respaldo íntegro aún no garantiza recuperabilidad | Alta |
| Lector externo v2 sin canal de época autorizado ni adopción (sin cambios en 5E.4) | Alta para uso semanal externo |
| Recuperación automática no observada en HONOR (fallback por apertura ya sin error visible) | Media |
| Versiones SQLite intermedias y otros OEM no probados | Media |

## 10. Veredicto

**Cambios de 5E.4: ACEPTADOS** en el alcance probado.
- 5E3-001 queda corregido sin debilitar la exclusión ni la intención durable.
- Con 100.000 movimientos en 50 años calendario, captura y publicación cumplen sus presupuestos provisionales
  en API 24 y HONOR, con CSV idénticos byte a byte a 5E.3 y las regresiones intactas.

Siguen fuera: activar la publicación en producción, respaldos automáticos, restauración y fase 6. Eso requiere
autorización explícita, junto con:
- la decisión decimal;
- el canal de época del lector externo;
- una prueba de restauración.
