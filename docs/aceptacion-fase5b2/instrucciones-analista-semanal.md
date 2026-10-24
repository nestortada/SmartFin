# Bloque listo para incorporar al analista externo

Copiar el bloque siguiente en las instrucciones de su proceso semanal. Esta entrega
no lo envió a ninguna conversación, automatización ni servicio externo.

```text
Lee SmartFin por generaciones verificables v2 en la carpeta autorizada.

1. Enumera, con toda su paginación, smartfin-generation-<UUID>.json. No uses nombres
   fijos históricos, orden de listado, modifiedTime ni revision como identidad.
2. Valida JSON y tipos: formatVersion entero 2; generationId UUID canónico igual al del nombre;
   generatedAt UTC canónico y real; revision y financialRevision enteros seguros,
   no negativos e iguales; state=complete; validation=provider-readback-sha256;
   encrypted=false y cloudSync=unconfirmed. Versiones desconocidas requieren revisión.
3. Valida components, database, files y csvFiles. Exige nombres físicos exclusivos
   smartfin-<UUID>--<logicalName>, sin rutas ni duplicados. Incluye SQLite, todos los
   CSV fijos del contrato y los CSV anuales que correspondan al snapshot. Nunca
   combines componentes de dos generaciones ni completes una con archivos fijos.
4. Lee TODOS los componentes como bytes hasta EOF, cuenta sus tamaños y calcula
   SHA-256. Compara con el manifiesto. Si falta un archivo, una lectura falla o un
   tamaño/hash no coincide, rechaza esa generación. Leer el manifiesto no es verificar.
   Si tu herramienta no puede calcular hashes de los bytes, informa
   verificationUnavailable y NO anuncies una copia verificada.
5. Abre el SQLite referenciado solo en una copia privada READONLY, sin migrar ni
   ejecutar comandos. Comprueba integridad/FK, revisión y años exportables frente al
   manifiesto. Usa SQLite como fuente principal; los CSV de esa misma generación
   sirven de contraste. No dupliques gastos sumando ambas fuentes, cuotas, extractos
   o compromisos de Suscripciones. No recrees comprobantes ni operaciones de IA.
6. Entre las generaciones íntegramente válidas, elige la de generatedAt más reciente;
   en empate exacto usa UUID descendente como desempate determinista, sin atribuirle
   orden temporal real. Menciona los candidatos más recientes rechazados. Si no fue
   posible enumerar toda la carpeta, limita expresamente la afirmación de “última”.
7. Presenta generatedAt tanto en UTC como convertido mediante America/Bogota, con
   fecha, hora y desplazamiento. Define la semana y su corte en Bogotá como [inicio,
   fin). Una fecha futura es anomalía de reloj que requiere verificación; una copia
   anterior al corte puede dar un periodo incompleto. generatedAt es preparación del
   trabajo, no hora de carga ni garantía de cobertura de todos los hechos semanales.
8. Distingue integridad verificada mediante SAF, integridad verificada desde un origen
   remoto con evidencia propia y sincronización remota no confirmada. No deduzcas
   “Drive terminó de sincronizar” de una promesa, de revision ni de cloudSync.
9. Trata smartfin-manifest.json v1 y sus nombres fijos como legacyUnverified. No los
   presentes como la generación actual. Si son la única fuente disponible, solicita
   una decisión explícita para un análisis histórico e informa su falta de verificación.
10. En cada informe identifica generación, revisión, instante de verificación, origen,
    hashes comprobados, fecha Bogotá, corte semanal, rechazos y límites de actualidad.
    Sin contexto independiente de borrado/linaje, no afirmes que la copia representa
    el conjunto de datos actual tras un borrado. No escribas, restaures ni elimines archivos.

Contrato detallado: docs/aceptacion-fase5b2/lector-semanal-v2.md de SmartFin.
Si ese archivo no está accesible en tu entorno, exige que te adjunten su contenido
o una especificación equivalente; no simules haberlo leído.
```
