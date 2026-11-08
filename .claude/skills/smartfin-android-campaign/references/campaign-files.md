# Archivos de una campaña: qué cambia en cada fase

Ejemplo de referencia: `scripts/phase1a4b/` y `docs/validacion-fase1a4b/` (README §5–§8 y `r5/README.md`). Las rutas parten de la raíz del repositorio.

| Archivo | Se escribe a mano | Se deriva mecánicamente | Qué fija o comprueba |
|---|---|---|---|
| `scripts/phase<id>/probes.ts` | Sí: escenarios nuevos de la fase | — | Importa los casos de uso reales por ruta; reloj JS fijo; solo datos sintéticos |
| `scripts/phase<id>/phase<prev>Probes.ts` | — | Con `derive-probes.cjs` desde la versión aprobada | Hash de la fuente base y del inventario de la ronda aprobada |
| `scripts/phase<id>/androidHarness.js` | Sí: lista de campañas y comparación | — | Igualdad campo a campo con `phase<id>NodeExpected.json`, sin tolerancia |
| `__tests__/phase<id>AndroidEquivalence.test.ts` | Sí | — | Ejecuta las mismas sondas en `node:sqlite` y genera la referencia |
| `docs/validacion-fase<id>/node/results.json` | — | Generado por la prueba Node solo con `SMARTFIN_WRITE_EVIDENCE=1`, sin sobrescribir | Referencia de todas las partes (fase nueva y regresiones) |
| `scripts/phase<id>/authorization-inventory.cjs` | Copia ajustando rutas | — | `capture`: `authorization/inputs.sha256.json`; `verify`: cambios y archivos protegidos |
| `scripts/phase<id>/prepare-android.cjs` | Copia ajustando base y workspace | — | Atestación y APK de la base aprobada; hashes del inventario; nombre de base sintético en `src/database/sqliteSchema.ts`; nueva `source-fingerprints.json` también en `android/app/src/main/assets/phase5b2-source-fingerprints.json` |
| `scripts/phase<id>/make-runner.cjs` | Copia ajustando anclas | Genera `run-android.ps1` desde el runner aprobado | Hash del runner base; cada ancla sustituida exactamente una vez |
| `scripts/phase<id>/run-android.ps1` | — | Sí | Workspace exacto, serial, API, identidad del AVD/modelo, ruta de salida exacta, evidencia no existente, paquete sintético limpio salvo `PreserveData` |
| `scripts/phase<id>/run-all.ps1` | Sí: orden de campañas | — | Solo los dos destinos autorizados; `PreserveData` solo en campañas `*-restart` |
| `scripts/phase<id>/apk-identity.cjs` | Copia añadiendo la atestación anterior a la lista de rechazadas | — | Escribe `authorization/apk-identity.json` una sola vez |
| `scripts/phase<id>/rN/check-coverage-rN.cjs` | Sí, en cada ronda | — | Recuentos exactos por campaña, puntos de fallo, 0 diferencias, `com.smartfin` sin cambios |

Workspaces existentes: `C:/sf-<id>-<fecha>` (por ejemplo, `C:/sf-1a4b-20261102`). Cada fase crea uno nuevo desde el aprobado de la fase anterior; no reutilices uno en el que ya se compiló otro APK.
