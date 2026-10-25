# Instrucciones finales para el analista financiero semanal externo (lector v2)

Estado: **especificación final propuesta; no adoptada.** No se modificó, ejecutó ni probó
ninguna automatización externa (ChatGPT u otra). Su integración y prueba siguen pendientes.
Referencia ejecutable sobre fixtures sintéticos: [reader-contract.cjs](../../scripts/phase5e3/reader-contract.cjs),
resultados en [reader/contract-results.json](reader/contract-results.json) (13 escenarios).

## 1. Qué leer

1. Enumerar en la carpeta de respaldo solo `smartfin-generation-<uuid>.json` (UUID v4 en minúsculas).
   Ignorar cualquier otro archivo como fuente de verdad.
2. Para cada manifiesto exigir: `formatVersion = 2`, `state = "complete"`,
   `validation = "provider-readback-sha256"`, `encrypted = false`, `cloudSync = "unconfirmed"`,
   `revision = financialRevision` (entero seguro ≥ 0), `generatedAt` con forma exacta
   `YYYY-MM-DDTHH:mm:ss.SSSZ` y nombre de archivo igual a su `generationId`.
3. Cada componente: nombre `smartfin-<id>--<logicalName>`, sin duplicados, `bytes > 0`,
   `sha256` hexadecimal de 64 caracteres. Leer los bytes completos y comprobar **tamaño y SHA-256**.
   Deben estar `smartfin-backup.db` y los 11 CSV fijos; `movimientos-AAAA.csv` debe coincidir con los
   años distintos de `COALESCE(civil_date, date)` en la base del componente.
4. `database`, `files` y `csvFiles` deben referenciar exactamente ese inventario.
5. Abrir `smartfin-backup.db` en solo lectura: `PRAGMA integrity_check = ok`, `foreign_key_check` vacío y
   `financial_data_revision.revision = manifest.revision`.
6. Un manifiesto que falle cualquier comprobación se **descarta** (no se repara ni se usa parcialmente).
7. Seleccionar el manifiesto válido con mayor `generatedAt` (desempate por `generationId`),
   igual que la aplicación. Una generación más nueva dañada o incompleta no bloquea seleccionar la
   anterior íntegra, pero debe informarse como rechazada.
8. `smartfin-manifest.json` (v1) se informa como `legacyUnverified`. Nunca se usa para análisis,
   aunque sea reciente o tenga una revisión mayor.

## 2. Cómo clasificar la generación seleccionada

| Dimensión | Regla | Valores |
|---|---|---|
| Integridad | Pasos 2–5 aprobados | `verified` / descartada |
| Antigüedad | `edad = ahora − generatedAt`; inclusiva hasta 168 h | `withinSevenDays`, `olderThanSevenDays`, `clockAnomaly` (edad negativa) |
| Fecha civil | Convertir `generatedAt` a `America/Bogota` para asignar día/semana | p. ej. `2026-10-25T02:30:00.000Z` → 24-oct 21:30 |
| Sincronización | Siempre `unconfirmed`; un manifiesto que afirme otra cosa se descarta | `unconfirmed` |
| Vigencia del conjunto | Solo con contexto autorizado de época (sección 3) | `current`, `historical`, `unknown` |

`generatedAt` es el instante de **preparación** del trabajo de respaldo, no el de publicación ni el de
sincronización con la nube.

## 3. Vigencia después de un borrado (época financiera)

El manifiesto v2 **no contiene la época** del conjunto de datos. La aplicación decide `current` o
`historical` con registros privados del dispositivo (trabajo de publicación con `datasetEpoch` y
`revokedByDeletion`). Por tanto, para el lector externo:

- Integridad verificada, antigüedad ≤ 7 días y revisión alta **no prueban** que la generación sea
  vigente: una generación íntegra anterior a un borrado sigue en la carpeta (las copias externas no
  se revocan) y puede ser la más reciente y la de mayor revisión.
- Sin contexto autorizado, `datasetCurrency = unknown` y la generación **no es apta** para el
  análisis semanal como estado actual. Puede describirse como "copia íntegra de fecha X, vigencia
  no confirmada".
- Contexto autorizado mínimo: una declaración emitida por la aplicación o el propietario con
  `{currentGenerationId, issuedAt}` (o `currentGenerationId = null` si no existe generación del
  conjunto vigente), con `issuedAt` dentro de las mismas 168 h. Si nombra otra generación, la
  seleccionada es `historical`. Un contexto más antiguo se ignora (`unknown`).
- El canal por el que llega ese contexto **no existe todavía** en la aplicación; definirlo es una
  decisión pendiente (no implementado en 5E.3).

## 4. Resultado que debe producir el analista

Para cada lectura: generación seleccionada (o ninguna), `generatedAt` UTC y Bogotá, edad en horas,
`fileIntegrity`, `freshness`, `cloudSync = unconfirmed`, `datasetCurrency`, lista de manifiestos
rechazados con motivo, y `usableForWeeklyAnalysis = (freshness = withinSevenDays) ∧ (datasetCurrency = current)`.
Si no es utilizable, el informe semanal debe decirlo explícitamente y no presentar cifras como actuales.

## 5. Límites conocidos

- `JSON.parse` no detecta claves duplicadas en el manifiesto.
- Fixtures mínimos de lector, no copias restaurables de la aplicación.
- Sin evidencia de sincronización remota, `fsync` ni durabilidad ante corte eléctrico.
- Adopción real del analista: **pendiente**; no se afirma que esté actualizado.
