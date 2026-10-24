# Protocolo posterior a fase 3B

18 de octubre de 2026. No inicia fase 4. Bases nuevas exclusivamente en el paquete
`com.smartfin.atomicityphase1.tests`; no se abre la base de producción.

## Línea base y reglas

La línea base conserva las modificaciones de fase 3B presentes al empezar. Sus 542
pruebas y ocho snapshots pasan, igual que TypeScript y ESLint. Se guardan hashes de
todos los archivos de producción y copias de los cinco archivos centrales. Los nuevos
tests del límite SQL se ejecutan primero como caracterización/objetivos rojos, aparte
de esa línea base aprobada; un límite simulado Node no acredita el límite Android.

No cambian el importe, moneda, fecha, estado o identidad de las compras, ni la regla
de pago efectivo entero positivo de fase 3B. Reconciliar conserva compras completas
no canceladas, pagos no cancelados, orden JS y cuotas solo en el extracto. Asociar
conserva el predicado de pistas, incluyendo pendientes/cancelados y compras antiguas.
La validación de cierre conserva sus condiciones y su único commit con reconciliación.

## Mediciones

- APK release/Hermes, driver instalado y ABI/API originales. Ambas versiones están
  en el mismo APK, sobre dos bases con entradas idénticas por pareja.
- Reloj de auditoría JS/SQL fijo solo en estos fixtures. Tiempo monotónico para medir.
- Calentamiento de una pareja por grupo, descartado; tres parejas medidas y cinco
  en la comparación original de 100.000 filas ajenas. Alternar versión inicial.
- Reconciliación independiente y cierre completo sobre el mismo estado de deuda cero;
  no comparar como causales las muestras previas de fixtures diferentes.
- Historial ajeno 1.000/100.000; variante del cierre con cuenta esperada de formulario;
  historial denso pagado: 10.000 compras + 10.000 pagos + 80.000 movimientos ajenos.
- Asociación real: 100/997/998/1.000/10.000 compras coincidentes, cada una con un plan
  parcialmente pagado. Se procesa el conjunto entero, sin paginar ni recortar.
- Separar espera de conexión, ámbito BEGIN/COMMIT o ROLLBACK, operación y lector.
  Spans síncronos para mapeo, filtro de asociación, cálculo y validación de cierre.
- Tras detectar el contador legado que esperaba al escritor antes de calcular el
  intervalo del lector, añadir `post-reader-control`: capturar finalización en el
  `.then` del lector y leer la cuenta de asociación antes de iniciar el reloj.
  Control con detalle SQL/PSS desactivado, salvo controles transaccionales y cola.
  Calentar una vez y medir cinco cierres/reconciliaciones del fixture original de
  cierre 3B con 100.000 ajenos; tres asociaciones de 1.000/10.000 compras reales.
  Las duraciones originales de operación/commit se conservan; el contador legado
  del lector no prueba una espera efectiva.
- Contar consultas, filas devueltas y parámetros; medir por etapa y tabla cada llamada
  al driver. Esos tiempos incluyen SQLite, cola nativa, conversión y puente. Los cuatro
  SELECT de cierre parten de Promise.all, por lo que sus duraciones pueden solaparse:
  no sumarlas como una descomposición exclusiva del tiempo total.
- Sonda nativa READONLY separada de SELECT: cursor/SQLite con calentamiento y tres
  muestras. No incluye serialización por el puente y no se resta de otra ronda para
  inventar un coste puro del puente. Guardar también errores de EXPLAIN si existen.
- Muestrear PSS, heap Java y asignación nativa del proceso a intervalos de 100 ms.
  Registrar contadores Hermes solo si el release realmente los expone. Son picos
  muestreados del proceso, no máximos exactos ni prueba de ausencia de fugas.

## Equivalencia y fallos

Comparación nativa de todas las tablas, columnas y tipos; Double por bits, revisión y
auditoría incluidas. No normalizar cantidades ni introducir tolerancias. FK habilitadas,
foreign_key_check vacío e integrity_check correcto. La prueba Node de 10.000 compras
compara también métricas financieras completas contra el código previo.

Si el original falla por su límite de enlaces SQL, comprobar primero su rollback contra
una base inicial idéntica. Para verificar el resultado esperado de éxito puede usarse
un oráculo sintético explícito: el mismo dominio/repositorio previo, sustituyendo solo
los IDs enlazados del IN por literales escapados en la copia de pruebas. Ese oráculo no
representa rendimiento de producción ni se incluye entre sus muestras antes/después.
No se copia a producción. Así se contrasta el conjunto financiero completo aun cuando
el adaptador previo no pudiera ejecutar su sentencia parametrizada sobre esa API.

Una eventual corrección debe ser local al defecto reproducido. No se autoriza cambiar
esquema, driver, dependencias, cálculos o límites de commit. Conservar las matrices de
fases 3B/3A/2 y recuperación 1.1, el rechazo de pagos inválidos y la política unknown.
