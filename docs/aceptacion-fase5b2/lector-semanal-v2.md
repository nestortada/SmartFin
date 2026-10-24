# Contrato de lectura externa SmartFin v2

Especificación para incorporar al analista semanal. No modifica ni acredita acceso
a una automatización o conversación externa. El repositorio no contiene su código.
La bandera de publicación permanece desactivada.

## Capacidades y resultados

El lector necesita enumerar documentos, leer bytes completos, obtener tamaños
reales y calcular SHA-256. Ver el nombre o el tamaño declarado por Drive no basta.
Si solo puede leer texto o buscar archivos, debe devolver `verificationUnavailable`
y solicitar una capacidad de lectura binaria/hash; nunca anunciar verificación.

Estados de salida independientes:

| Campo | Valores / significado |
|---|---|
| `selectionStatus` | `verifiedV2`, `noVerifiedGeneration`, `verificationUnavailable` |
| `fileIntegrity` | `verified` solo tras comprobar todos los componentes; de otro modo `unverified` |
| `cloudSync` | `unconfirmed` por defecto; evidencia remota independiente, con origen/instante, si existe |
| `legacyStatus` | `legacyUnverified` para v1, sin promoverlo a generación actual |
| `freshness` | `freshForRequestedCutoff`, `olderThanRequestedCutoff`, `clockAnomaly` o `unknown` |
| `datasetCurrency` | `unknown` sin contexto independiente de borrados/linaje; integridad no implica datos actuales |

Un fallo de un candidato no destruye otro candidato válido. Si la enumeración o
los permisos no permiten conocer el conjunto, no afirmar haber encontrado la copia
más reciente de toda la carpeta: indicar el alcance observado y el error.

## 1. Enumeración y estructura

1. Enumerar todos los documentos de la carpeta autorizada, incluida paginación.
   Buscar exclusivamente `smartfin-generation-<UUID>.json` como candidatos v2.
   No elegir por orden de listado, `modifiedTime`, un contador de revisión o el
   último archivo CSV encontrado. Dos documentos con el mismo nombre son ambiguos.
2. Leer cada candidato completo, decodificar JSON y validar tipos sin coerción.
   Rechazar claves JSON duplicadas si el parser puede detectarlas; si no puede,
   registrar esa limitación y no aceptar un JSON ambiguo advertido por la herramienta.
3. Exigir `formatVersion` entero exactamente 2, `generationId` como string UUID
   canónico hexadecimal minúsculo `8-4-4-4-12` y coincidencia con el nombre del manifiesto. No inferir identidad por
   `revision`. Exigir `state: "complete"`, `validation: "provider-readback-sha256"`,
   `encrypted: false`, `cloudSync: "unconfirmed"` en el formato producido hoy.
   Otra versión o método requiere un contrato nuevo, sin degradación silenciosa.
4. `revision` y `financialRevision` deben ser enteros seguros no negativos, iguales.
   Son revisión financiera capturada, no checksum ni identidad del respaldo.
5. `generatedAt` debe ser un instante UTC canónico `YYYY-MM-DDTHH:mm:ss.SSSZ`, con
   fecha real: parsear y volver a serializar debe producir exactamente el original.
   La comprobación externa es más estricta que la expresión regular del descubridor
   nativo para manifiestos sin registro privado. No reescribir el archivo al normalizar.

## 2. Inventario íntegro

`components` es un array no vacío de objetos con `name`, `logicalName`, `bytes`,
`sha256`. Los nombres físicos y lógicos deben ser únicos. `bytes` es un entero
seguro positivo; `sha256`, 64 caracteres hexadecimales minúsculos.

Cada `name` debe ser exactamente `smartfin-<generationId>--<logicalName>`. Rechazar
rutas, URLs, separadores, referencias a otra generación o documentos ambiguos.
Los nombres lógicos del contrato actual son:

- `smartfin-backup.db` (exactamente uno).
- `cuentas.csv`, `categorias.csv`, `subcategorias.csv`, `tarjetas-credito.csv`,
  `compras-cuotas.csv`, `personas.csv`, `gastos-compartidos.csv`, `participaciones.csv`,
  `reembolsos.csv`, `abonos-compartidos.csv`, `devoluciones-anticipos.csv`.
- Cero o más `movimientos-AAAA.csv`, según los años del snapshot y la consulta
  histórica del exportador. No exigir el año actual si no contiene movimientos.

`database` debe referenciar el componente SQLite. `files` debe contener exactamente
los nombres de `components`, sin repetidos. `csvFiles` debe ser exactamente el
conjunto anterior menos SQLite. No hay CSV dedicado de Suscripciones o comprobantes
IA: esos datos se conservan en la base completa.

## 3. Verificación de bytes y coherencia

Para **cada** componente, abrir el documento exacto, leer hasta EOF, contar los
bytes reales y calcular SHA-256. Comparar ambos con el manifiesto. Un rechazo de
lectura, cierre fallido, documento ausente, truncado o hash diferente invalida ese
candidato. No completar datos con archivos de otra generación ni con nombres fijos.
La declaración `validation` es una afirmación del productor, no sustituye esta pasada.
Calcular sobre bytes originales: no retirar BOM, normalizar saltos de línea ni
recomponer JSON/CSV desde texto antes del hash. Si la herramienta transforma el
contenido y no ofrece el original binario, no acredita esta verificación.

Conservar evidencia mínima: ID de generación, manifiesto leído, inventario, tamaños
y hashes observados, momento de verificación y origen de lectura. No copiar filas
financieras a logs. Si un documento cambia durante el proceso, descartar la lectura
y realizar una nueva verificación explícita; no mezclar observaciones de dos lecturas.

Al usar SQLite, abrir una copia de trabajo privada READONLY; no migrarla ni ejecutar
comandos de la aplicación, pagos, mantenimiento o restauración. Comprobar integridad,
FK, revisión (`financial_data_revision`, fila 1) y correspondencia con
`financialRevision`. Comprobar que los CSV anuales declarados corresponden a los años
exportables de esa copia, usando la consulta vigente de `SmartFinBackupCsv.queryYears`.
Para una conciliación exhaustiva, reproducir las consultas exportadoras y comparar
celdas; los hashes por sí solos no autentican un manifiesto alterado junto a sus datos.
La aplicación tiene además el plan privado para sus propios trabajos; el analista
externo no debe presumir acceso a ese registro.

Usar una sola fuente primaria para calcular cada resultado: SQLite o los CSV de
esta generación. Los CSV pueden servir de contraste, pero no se suman a SQLite como
si fueran movimientos adicionales. Tarjetas usa `creditCard`; cuotas, extractos,
compromisos de Suscripciones y proyecciones no son gastos adicionales. El historial
completo del snapshot no se sustituye por páginas visibles. No recrear comprobantes IA.

## 4. Selección y tiempo en Bogotá

Solo después de validar todos los componentes, ordenar los candidatos válidos por
el instante `generatedAt` descendente. En empate exacto, UUID descendente, como el
desempate determinista nativo; el UUID no demuestra un orden temporal real.
Elegir uno y usar todas sus referencias. Un candidato más nuevo inválido debe
aparecer como rechazado; se puede usar el anterior íntegro explicando la antigüedad.

Conservar el instante UTC y presentar también su conversión con la zona IANA
`America/Bogota`, incluyendo fecha, hora y desplazamiento. Usar conversión de zona,
no restar horas a una fecha civil. Ejemplo verificable: `2026-10-24T02:30:00.000Z`
corresponde a **2026-10-23 21:30:00 -05:00** en Bogotá.

El periodo semanal y su corte deben ser explícitos en Bogotá, con intervalo
`[inicio, fin)`. Comparar el instante convertido con el corte solicitado. Si la copia
es anterior, informar que el periodo puede estar incompleto; una copia válida no
se convierte en actual por tener un hash correcto. Si aparece una fecha futura
respecto al reloj de verificación, tratarla como anomalía y pedir verificación de
reloj antes de seleccionarla; no usarla para desplazar silenciosamente una copia válida.

En el productor actual, `generatedAt` nace al preparar el trabajo, antes de capturar
y publicar. No es hora de sincronización, ni prueba de cobertura de todos los hechos
del periodo. La fecha de cada movimiento conserva sus reglas civiles/históricas;
convertir el timestamp del manifiesto no cambia las fechas financieras del snapshot.

## 5. SAF, sincronización y v1

«Verificado mediante SAF» significa que Android pudo releer los bytes esperados.
No prueba que el servidor de Google Drive los haya recibido. El analista que lea
bytes desde el servicio remoto y calcule los hashes puede afirmar «integridad
verificada desde [origen remoto] a [instante]» para esos documentos, conservando esa
evidencia; no deducir sincronización definitiva de una promesa de escritura o del
campo `cloudSync`. No editar el manifiesto para cambiar ese campo.

`smartfin-manifest.json` v1, `smartfin-backup.db` y los CSV fijos/anuales históricos
son una raíz congelada y permanecen legibles. Etiquetarlos `legacyUnverified`.
No seleccionarlos como copia actual cuando exista un v2 íntegro. Si solo hay v1 o
no pueden verificarse hashes, explicar la limitación y solicitar decisión explícita
antes de elaborar un análisis histórico; no llamar «verificada» a esa fuente.

Sin un contexto externo de linaje/borrado no se puede saber si una copia íntegra
pertenece a datos ya eliminados. Ese contrato será requisito de 5C; el formato v2
actual no resuelve por sí solo esa distinción.

## Pruebas de aceptación del lector externo

Probar únicamente documentos sintéticos: última válida; nueva parcial con anterior
íntegra; manifiesto ausente; ID/nombres cruzados; inventario incompleto/duplicado;
SQLite/CSV truncados o corruptos; permisos/lectura/hash no disponibles; revisión
discrepante; UTC que cambia de día al convertir a Bogotá; empate de timestamp; fecha
inválida/futura; solo v1; fuente local SAF sin confirmación remota. Registrar rechazos.
La incorporación efectiva al analista externo y esas pruebas en su herramienta
siguen pendientes: esta especificación no acredita una automatización modificada.
