---
name: smartfin-android-campaign
description: Prepara, ejecuta (con autorización) y evalúa campañas de validación Node–Android de SmartFin: referencia Node, workspace sintético C:/sf-*, atestación, inventario de autorización, APK sintético com.smartfin.snapshot5b2.tests, runner derivado, run-all en API 24 y API 35, rondas rN y cobertura. Úsala siempre que una fase necesite equivalencia en dispositivo o emulador, cuando el usuario mencione scripts/phase*, validacion-fase*, una ronda r2/r3/…, el AVD SmartFin_Guard_Synthetic_API24 o el teléfono AXCC6R3919012932, o pida preparar o repetir una validación Android.
---

# Campañas de validación Node–Android

Una campaña demuestra que los casos de uso **reales** de producción producen exactamente el mismo resultado sobre el driver SQLite de Android que sobre `node:sqlite`, campo a campo y sin tolerancia. Se ejecuta sobre un APK sintético aislado para que ningún dato real ni la app de producción puedan verse afectados. Cada fase la prepara derivándola de la última campaña aprobada; hoy esa base es `scripts/phase1a4b/` (r5 aprobada: 32 campañas, 568 casos y 356 puntos de fallo por dispositivo).

Complementa a `smartfin-testing-qa` (estrategia general) y a `smartfin-phase-delivery` (la campaña es su paso 9).

## Límites que no se negocian

- Solo el paquete sintético `com.smartfin.snapshot5b2.tests` y la base `phase5b2_synthetic.db`. `com.smartfin` debe quedar sin cambios en todos los dispositivos; si una campaña lo tocara, es un fallo.
- Solo dos destinos: `emulator-5554` (AVD `SmartFin_Guard_Synthetic_API24`, API 24, SQLite 3.9.2) y `AXCC6R3919012932` (teléfono, API 35). El runner comprueba serial, API e identidad del AVD o modelo.
- Compilar el APK, instalarlo o lanzar `run-all` requiere autorización explícita del propietario **para esa ronda**. Preparar (escribir scripts, sondas, referencia Node e inventario) no la requiere. Sin autorización, la campaña se entrega como «preparada, no ejecutada».
- Nunca se sobrescribe evidencia: cada runner y script de identidad se niega si el destino existe. Una repetición es una ronda nueva (`rN`) o un intento nuevo (`attempt-N`).
- Ante cualquier fallo en dispositivo: detenerse, conservar la evidencia y diagnosticar en Node antes de tocar nada.

## Piezas de una campaña

Carpeta `scripts/phase<id>/` (consulta la tabla detallada en [archivos de campaña](references/campaign-files.md)):

| Pieza | Papel |
|---|---|
| `probes.ts` | Escenarios sintéticos que llaman a los casos de uso reales por ruta, con reloj fijo. Los mismos se ejecutan en Node desde `__tests__/phase<id>AndroidEquivalence.test.ts`. |
| `androidHarness.js` | Arnés del APK: ejecuta cada campaña y compara con la referencia Node campo a campo. |
| `derive-probes.cjs` | Derivación mecánica de sondas anteriores cuando el cambio altera a propósito un resultado heredado. |
| `authorization-inventory.cjs` | `capture` (antes) y `verify` (después): hashes de todas las entradas revisadas; falla si cambia un archivo protegido (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`). |
| `prepare-android.cjs` | Crea el workspace `C:/sf-<id>-<fecha>` desde el de la base aprobada: copia solo código, refresca `src/` desde el checkout, aplica el nombre de base sintético y escribe la atestación. Nunca copia `build/`. |
| `make-runner.cjs` → `run-android.ps1` | Runner derivado del aprobado sustituyendo anclas exactas; solo cambian workspace, rutas de evidencia, campañas permitidas y `PreserveData`. |
| `run-all.ps1` | Orden completo: campañas nuevas y después todas las regresiones heredadas con sus oráculos. |
| `apk-identity.cjs` | Tras el build autorizado: registra hash del APK y de la atestación; rechaza APK y atestaciones de fases anteriores. |
| `rN/check-coverage-rN.cjs` | Tras la ejecución: comprueba recuentos exactos por campaña, puntos de fallo y diferencias, leyendo solo evidencia. |

Evidencia en `docs/validacion-fase<id>/`: `node/results.json` (referencia), `authorization/` (inventario, identidad del APK, integridad), `android/api24|api35/<campaña>/` y un `README.md` con el procedimiento y el resultado.

## Preparar una campaña nueva

1. **Referencia Node primero.** Escribe las sondas de la fase y la prueba de equivalencia Node (`__tests__/phase<id>AndroidEquivalence.test.ts`). La prueba compara con `docs/validacion-fase<id>/node/results.json`; generarlo es una operación explícita (`SMARTFIN_WRITE_EVIDENCE=1`) que se niega a sobrescribir un archivo existente. Las referencias de fases anteriores solo se leen. Si Node no es estable y determinista, Android no aportará nada.
2. **Copia la estructura de la última campaña aprobada**, no de una cualquiera: cada script empieza con un comentario «derivado de …» y fija con SHA-256 el archivo base del que deriva. Las derivaciones son mecánicas y revisables: sustituciones de anclas que deben aparecer exactamente una vez, con error si no.
3. **Sondas reales, sin neutralizar.** El APK ejecuta la lógica de producción tal cual; está prohibido simular o desactivar el caso de uso para que pase. Si un resultado heredado cambia a propósito, decláralo en `derive-probes.cjs` con su motivo.
4. **Cuenta escrituras y puntos de fallo** de cada operación (fallo antes y después de cada escritura) y fija los recuentos esperados por campaña. Toma los recuentos de una ejecución real, no de una estimación: en 1a.4B un total mal contado en el documento (502 frente a 568) obligó a corregir la cobertura.
5. **Ordena `run-all.ps1`**: campañas nuevas, después las regresiones de fases anteriores. Las campañas `*-restart` usan `PreserveData` y conservan los datos de la campaña anterior; ninguna otra.
6. **Inventario**: `node scripts/phase<id>/authorization-inventory.cjs capture`.
7. **Workspace**: `node scripts/phase<id>/prepare-android.cjs`. Comprueba 0 diferencias entre workspace, checkout y atestación.
8. **README de validación** con: qué ejecuta el APK, escrituras y puntos de fallo, campañas por dispositivo, oráculo, scripts, workspace y atestación, procedimiento y criterios de aceptación. Estado: «preparada, no ejecutada».

## Ejecutar (solo con autorización)

Desde la raíz del repositorio, un comando por llamada y en este orden:

```bash
node scripts/phase<id>/authorization-inventory.cjs verify
```

```bash
cd C:/sf-<id>-<fecha>/android && ./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'
```

```bash
node scripts/phase<id>/apk-identity.cjs
```

```powershell
./scripts/phase<id>/run-all.ps1 -Serial emulator-5554 -Api 24
./scripts/phase<id>/run-all.ps1 -Serial AXCC6R3919012932 -Api 35
```

```bash
node scripts/phase<id>/authorization-inventory.cjs verify
```

Ejecuta API 35 solo si `adb devices` muestra el teléfono. El guard de Claude Code no lee el contenido de los scripts: la protección real son las comprobaciones del runner y la autorización del propietario.

## Aceptar o abrir una ronda nueva

Por dispositivo, la campaña se acepta con: todos los casos aprobados con los recuentos exactos, todos los puntos de fallo con rollback confirmado y estado restaurado (un `unknown` nunca cuenta como rollback), 0 diferencias frente a Node y frente a los oráculos heredados, `com.smartfin` sin cambios y `verify` sin cambios protegidos.

Si algo falla, abre `scripts/phase<id>/rN/` y `docs/validacion-fase<id>/rN/` con un README que siga: estado inicial, causa raíz, reproducción en Node antes de corregir, cambio, pruebas positivas y negativas, oráculo, validación Node, workspace, cobertura, comandos y riesgos. Las rondas anteriores y su evidencia no se editan. Diferencias ya vistas entre plataformas que conviene anticipar:

- El driver formatea los errores de forma distinta en API 24 y API 35 (por ejemplo, «no such table»): clasifica por el dato estable (el nombre de la tabla) y acepta solo las variantes observadas.
- `adb` puede caerse en el emulador a mitad de campaña: eso es un intento fallido de infraestructura (`attempt-N`), no un fallo del código.

## Deuda conocida

Cada fase copia casi el mismo andamiaje y acumula variantes `-r2`, `-r3`… Extraer el código común a `scripts/androidCampaign/` reduciría la superficie revisada en cada ronda, pero es un cambio de código que requiere su propia fase y autorización; no lo hagas de paso.
