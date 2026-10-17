# Auditoría de gastos compartidos y fechas editables

## Dictamen

**El dominio tiene una base funcional comprobada, pero todavía no está listo para integrar su interfaz como una funcionalidad completa.** Antes conviene resolver la carga del dashboard y la restauración de respaldos. La condonación de cuentas por cobrar no está implementada; requiere decidir su tratamiento y añadir un caso de uso explícito si se quiere ofrecer esa acción.

Esta auditoría no cambió código de producción, no implementó interfaz ni hizo refactorizaciones. Añadió un ensayo sintético y evidencia. Los cambios de funcionalidad existentes en el checkout y las modificaciones previas del usuario se conservaron.

## Seguridad y alcance

Todas las escrituras, borrados, migraciones, copias y fallos inyectados usaron bases sintéticas. No se abrió, exportó, modificó ni eliminó la base de datos de `com.smartfin` instalada en el teléfono. Solo se consultaron metadatos del paquete; sus versiones y fechas de instalación quedaron iguales antes y después.

En dispositivo se instaló exclusivamente `com.smartfin.sharedaudit.bench`, con directorio de datos separado, compilación release y Hermes. Se detuvo y reinició ese paquete, se probó una copia interna sintética y se desinstaló al terminar. No se instaló un APK sobre SmartFin. El arnés no registra servicios, receptores ni tareas financieras de producción.

## Resultados por requisito

| Requisito | Node / SQLite | Android físico | Resultado y límite |
|---|---|---|---|
| Migración 3 sobre base existente | Migración repetida, conservación de ISO antiguo, rollback de tablas/columnas ante fallo | Base creada con esquema y migraciones anteriores hasta v2; v3 ejecutada dos veces; todas las columnas originales del movimiento comparadas | Pasó con el conjunto sintético probado; no se inspeccionó una base real |
| Fecha editable y hora opcional | Fecha civil, hora explícita, quitar hora, límites de mes/año, IA, transferencias y paginación | Alta a las 23:00 del día 5, UTC del día 6, quitar hora, edición posterior de compra y reapertura después de detener el proceso | Pasó en casos de uso y persistencia; formulario táctil completo pendiente |
| Movimientos, saldos, patrimonio y dashboard | Compra bancaria completa, participación propia, receivables, anticipos, crédito y pagos de tarjeta | Compra de 30.000, propia 15.000, cobro parcial de 5.000 en otra cuenta y otro mes; dashboard y pendiente comprobados | Pasó en los escenarios ejecutados |
| Respaldo y restauración | Copia física de 38 tablas, dos reaperturas, filas idénticas, integridad y FK | Cierre real del driver, copia de archivo sintético, reinicio del proceso, apertura de copia y comparación de tablas | Archivo consistente; **no existe flujo de restauración en la aplicación**; proveedor SAF/Drive no probado |
| Rendimiento | Comparación con versión optimizada anterior y ensayo de volumen compartido | No se midieron latencia, memoria, FPS ni apertura visual a gran escala | Problema de escalabilidad comprobado en Node; aprobación de rendimiento Android pendiente |
| Parciales, anticipos y otra cuenta | Todos cubiertos, incluidas varias personas y varios abonos | Parcial de otro mes/cuenta; anticipo con fecha anterior y aplicación a compra existente | Pasó; anticipo creado antes de la compra se ejecutó en Node, no en dispositivo |
| Eliminación y modificación | Guardas de edición, cancelación, borrados, devoluciones y rollback | Cancelación con abono bloqueada; borrar cobro reabre pendiente; repetir borrado no vuelve a debitar; editar fecha conserva patrimonio | Pasó para esos caminos; no implica prueba física de cada fallo inyectado |
| Condonación | Inspección de API, estado y esquema | No hay operación que ejecutar | **Falta implementar** |

## Pruebas y compilaciones ejecutadas

### Node y SQLite real

- Node `v24.16.0`, SQLite `3.53.0` mediante `node:sqlite`.
- Suite completa: **37 suites aprobadas, 380 pruebas aprobadas, 8 snapshots aprobados**. Las 3 suites de rendimiento optativas quedaron omitidas por su configuración.
- Auditoría adicional: **3 pruebas aprobadas**: copia física/reapertura, comparación con dashboard anterior y volumen de gastos compartidos.
- `npx tsc --noEmit`: aprobado. ESLint del nuevo ensayo: aprobado.
- Las pruebas existentes de gastos compartidos cubrieron crédito, pagos, idempotencia, porcentajes/centavos, excedentes, varios contactos, desvinculación, cancelación, edición coordinada, eliminación, devolución e inyección de fallos dentro del ámbito SQLite. Las de fecha verificaron conservación histórica, metadatos, IA, transferencias, ciclos y cursores.

La comparación anterior usa el dashboard y repositorio de movimientos de HEAD `6c98f98be9812e9b7345f01268984e1e3f961306`, no el baseline antiguo sin optimizaciones. El ensayo carga ese código Git local compilado únicamente dentro de Jest. Su comando optativo es:

```powershell
npm test -- --runInBand --testMatch '**/__tests__/**/*.test.js' __tests__/integrationAudit.test.js
```

El archivo `.test.js` no entra en el `testMatch` habitual de pruebas TypeScript. Es deliberadamente una campaña optativa de auditoría y medición; ejecutarlo vuelve a generar `docs/audit/integration-node.json`. Si HEAD cambia, debe fijarse nuevamente el comparador antes de atribuir los resultados a la versión anterior.

### Compilación Android

- Checkout de producción: `:app:compileDebugKotlin` aprobado, tareas en caché; no se instaló ese resultado.
- Arnés aislado: `:app:assembleRelease -PreactNativeArchitectures=arm64-v8a` aprobado. La primera compilación ejecutó 253 tareas; recompilaciones posteriores incorporaron ajustes del arnés.
- Las advertencias de Gradle por APIs obsoletas no impidieron compilar.
- Compilar Kotlin no prueba una exportación SAF; el arnés no invocó el módulo nativo de respaldo de producción.

### Ejecución real en dispositivo

Honor `CRT-NX3`, Android **15**, `arm64-v8a`, zona `America/Bogota`, SQLite **3.44.5**, Hermes, release. Tres fases emitieron `audit-success`: preparación/migración, reinicio/copia y operaciones financieras. Se usaron los casos de uso y repositorios copiados del checkout actual. Las envolturas de temporización del arnés previo se quitaron de esos archivos antes de compilar.

Las verificaciones son automatizadas dentro de la aplicación aislada, no una exploración manual de las pantallas de SmartFin. En la primera ejecución, el comparador del arnés confundió distinto orden de claves JSON con un cambio histórico; se corrigió a comparación canónica y se repitió con una base sintética nueva. No fue un fallo de migración. Dos errores de inserción del generador de volumen Node también se corrigieron antes de obtener el resultado final aprobado.

## Hallazgos y correcciones necesarias

### 1. Dashboard: resolver la escalabilidad antes de la interfaz

`getDashboardSummaryFromDb` agrega `getState()` a sus consultas. `loadSharedExpenseState` lee seis conjuntos completos, incluidos registros históricos, y `getSharedFinancialPosition` repite búsquedas de gastos, participaciones, recibos y aplicaciones mediante filtros y `some` por persona/participación.

Sin gastos compartidos, los resultados financieros fueron iguales al comparador anterior. Las consultas pasaron de **3 a 9**. Medianas de siete muestras después de tres calentamientos:

| Movimientos | Anterior optimizado, ms | Integración actual, ms |
|---:|---:|---:|
| 1.000 | 0,253 | 0,419 |
| 10.000 | 0,662 | 0,525 |
| 100.000 | 2,615 | 1,206 |

No hay una ralentización universal: las consultas civiles nuevas mejoraron este historial grande sin reparto. Sí aumentó el número de viajes al driver y apareció un coste significativo al crecer las relaciones compartidas:

| Gastos compartidos | Personas | Movimientos bancarios | Filas compartidas transportadas | Mediana actual, ms |
|---:|---:|---:|---:|---:|
| 100 | 50 | 100.000 | 550 | 4,148 |
| 1.000 | 50 | 100.000 | 5.050 | 40,270 |
| 5.000 | 50 | 100.000 | 25.050 | 569,443 |

El ensayo de volumen utiliza relaciones sintéticas insertadas para carga, con FK válidas; no es el oráculo de saldos financieros. Tres mediciones después de un calentamiento. Son tiempos Node, sin puente Android ni renderizado. No deben trasladarse al teléfono como cifras de FPS o latencia.

Corrección propuesta: una consulta de posición financiera estrecha, respaldada por índices, que evite transportar todo el estado al dashboard, o una proyección incremental transaccional. Si se agrega en SQL, debe conservar la validación y precisión de centavos del dominio; no basta con reemplazar sumas sin comprobar límites. Comparar después resultados, consultas, memoria y tiempo en release sobre dispositivo, incluyendo volumen compartido. No se implementó esta optimización durante la auditoría.

Fuentes: `src/modules/dashboard/useCases/getDashboardSummary.ts:238`, `src/modules/transactions/repositories/sqliteSharedExpenseRepository.ts:59`, `src/modules/transactions/useCases/sharedExpenseDomain.ts:189`.

### 2. Restauración: capacidad pendiente, no una prueba aprobada

El servicio Android expone selección de carpeta, exportación y estado; no expone restauración. El respaldo de producción toma un ámbito exclusivo, hace checkpoint, cierra SQLite y exporta el archivo completo. El código CSV incluye contactos, gastos, participaciones, cobros, aplicaciones y devoluciones; el archivo SQLite incluye además comandos idempotentes, índices, triggers y versiones.

La copia/reapertura sintética conserva esos datos. **No prueba restaurar mediante la interfaz de SmartFin ni reutilizar una carpeta SAF sin duplicar documentos**. `writeDocument` busca archivos por nombre para reemplazarlos, pero esa conducta depende del proveedor y falta ejercitarla en dispositivo.

Corrección necesaria: implementar una restauración validada sobre archivo temporal, con comprobación de versión, integridad y FK, reemplazo coordinado con cierre/reapertura y conservación del diario idempotente. Probar una segunda restauración y reintentar comandos restaurados sin duplicar saldo; simular interrupciones. Probar la exportación repetida en una carpeta **sintética**, sin usar respaldos reales. Los CSV son exportaciones; no constituyen un importador relacional completo.

Fuentes: `src/modules/settings/services/androidDriveBackupService.ts`, `src/navigation/AppNavigator.tsx:299`, `android/app/src/main/java/com/smartfin/SmartFinDriveBackupModule.kt:426`.

### 3. Condonación: falta un caso de uso explícito

No existen tipo, tabla, estado ni comando para condonar una cuenta por cobrar. Cancelar la división restaura la compra como gasto completo y exige resolver abonos; no permite perdonar solo el pendiente de una persona conservando el reparto y sus cobros.

Antes de ofrecerlo debe definirse si la pérdida se reconoce en la fecha de condonación o en el periodo original, y su categoría. El nuevo comando tendría que reducir pendiente y patrimonio, preservar el importe bancario de la compra, los pagos aplicados y las demás personas, conservar historia e idempotencia y revertirse de manera explícita. Debe impedir condonar más del pendiente y probar repetición/rollback. No se eligió una política ni se implementó fuera del encargo.

### 4. Cobertura Android pendiente

Falta validar físicamente formulario de fechas, transferencias con impuesto, crédito/cuotas, devolución de anticipos, fallos del driver y exportación SAF. Su cobertura actual proviene de Node, pruebas de componentes e inspección, no de acciones táctiles ni de una campaña completa Android. También falta medir apertura visual y rendimiento release con el nuevo volumen.

La skill financiera conserva un párrafo anterior que dice que no existe flujo de gastos compartidos. El código actual y las pruebas lo contradicen; debe actualizarse ese mapa cuando se consolide la implementación. Esa descripción antigua no se usó como prueba de ausencia del dominio nuevo.

## Ejemplos financieros comprobados

Con saldo inicial de 1.000.000 y compra de 30.000, propia 15.000:

| Escenario | Disponible | Por cobrar | Anticipos | Patrimonio | Gasto propio | Ingreso propio |
|---|---:|---:|---:|---:|---:|---:|
| Compra sin reembolso | 970.000 | 15.000 | 0 | 985.000 | 15.000 | 0 |
| Reembolso posterior completo | 985.000 | 0 | 0 | 985.000 | 15.000 | 0 |
| Anticipo antes de compra, aún sin aplicar | 1.015.000 | 0 | 15.000 | 1.000.000 | 0 | 0 |
| Compra y anticipo aplicado | 985.000 | 0 | 0 | 985.000 | 15.000 | 0 |
| Reembolso parcial de 5.000 | 975.000 | 10.000 | 0 | 985.000 | 15.000 | 0 |
| Cobro completo en otra cuenta | 985.000 | 0 | 0 | 985.000 | 15.000 | 0 |

Varias personas/abonos y reembolsos entre meses también pasaron en Node. El cobro posterior no reubica el gasto propio en su mes. En Android se añadió un movimiento histórico de 5.000 a la base; por eso su aserción de gasto mensual es 20.000, manteniendo 15.000 de la compra nueva. Estos resultados y los del ensayo de volumen tienen fixtures diferentes y no deben mezclarse.

## Evidencia y entrega

- `__tests__/integrationAudit.test.js`: ensayo adicional; no cambia repositorios de producción.
- `docs/audit/integration-node.json`: muestras, SQL, número de filas y versión comparada.
- `docs/audit/android-{prepare,restart,operations}.jsonl`: resultados emitidos por el teléfono.
- `docs/audit/production-package-{before,after}.txt`: metadatos iguales del paquete SmartFin.
- `docs/audit/android-apk-sha256.txt`: huella del último APK aislado.
- `docs/audit/AndroidAuditApp.jsx.txt`, `configureAndroidAudit.js.txt`, `AndroidAuditPackage.kt.txt`: fuentes del arnés guardadas como evidencia. La preparación reutilizó `scripts/androidDashboardPhase2/prepare.js` en `C:/sf-audit-20261012`; se cambió el identificador de paquete antes de instalar.

La migración 3 agrega cuatro columnas nullable de fecha a `transactions`, cuatro columnas a `transaction_splits` y seis tablas `shared_*`, con sus relaciones, restricciones, índices y triggers de revisión. Esta auditoría **no agregó otra migración ni cambió el esquema**.

Se puede continuar trabajando sobre el dominio, pero recomiendo posponer la interfaz hasta cerrar el rendimiento y la recuperación de respaldos, definir el alcance de condonación y completar las verificaciones Android indicadas. No se encontraron saldos inconsistentes en los escenarios financieros ejecutados; esa conclusión no equivale a garantizar todos los estados posibles o todas las bases instaladas.
