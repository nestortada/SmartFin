# Extensión del guard para la etapa A — 6B.3.1 r2

Estado: **propuesta, no instalada.** Fecha: 1 de noviembre de 2026.
El propietario autorizó preparar la etapa A, pero no modificar `.claude/hooks/`. Por eso el agente no ha
instalado la extensión ni ejecutado los comandos que admite.

## Qué admite

Solo estas dos órdenes literales, con la herramienta PowerShell, cada una en su directorio exacto:

| Orden | Directorio | Condición |
|---|---|---|
| `node scripts/phase6b3/refresh-harness.cjs` | `C:/Users/nesto/Proyectos/SmartFin` | La atestación del workspace sigue siendo `ff4932a2…` (estado anterior al refresco), así que se admite **una sola vez**. |
| `./gradlew.bat --offline --no-daemon --max-workers=2 assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'` | `C:/sf-6b3-20261101/android` | La atestación ya está refrescada: contiene `probes.ts` `2d43bb02…` y el harness `b9dbdee7…`, la copia embebida en `assets` coincide, y todas las fuentes atestadas coinciden byte a byte. **Sin el arreglo del reloj, se rechaza.** |

Para ambas órdenes, la extensión exige además:
- Los hashes de `refresh-harness.cjs` y de las fuentes que copia (`androidHarness.js`, `probes.ts`).
- Las ocho fuentes de producción de la sección 2 de la propuesta.
- `node.exe` pinado y resuelto en PATH sin shims.
- Que no exista ningún perfil de PowerShell y que `NODE_OPTIONS` esté vacío.

Para Gradle exige también:
- El wrapper (`gradlew.bat`, `gradle-wrapper.jar`, `gradle-wrapper.properties`) y `gradle.properties`,
  `build.gradle`, `settings.gradle` y `app/build.gradle` pinados.
- Que no haya scripts init de usuario, `~/.gradle/gradle.properties`, `GRADLE_OPTS`, `JAVA_TOOL_OPTIONS`,
  `_JAVA_OPTIONS`, `JDK_JAVA_OPTIONS`, `GRADLE_USER_HOME` ni variables `ORG_GRADLE_*`.

Cualquier variación devuelve `null` y la decide el resto del guard, sin excepción: un argumento extra,
encadenamiento, `installRelease`, quitar `--offline`, otros scripts, `run-all.ps1` o adb.
La extensión no amplía `phase6b2-runner.cjs` ni la política general.

## Escrituras que implican estas órdenes (no visibles para el hook)

- **Refresco:** exactamente `C:/sf-6b3-20261101/phase6b3Harness.js`, `phase6b3Probes.ts`,
  `source-fingerprints.json` y `android/app/src/main/assets/phase5b2-source-fingerprints.json`.
- **Gradle:**
  - Directorios de compilación del workspace (`android/**/build`, `android/.gradle`, `android/app/.cxx`).
  - Caché de Gradle del usuario (`~/.gradle/caches`, en modo offline).
  - Carpetas `build` de los módulos Android de las bibliotecas RN dentro de `node_modules`. `node_modules`
    del workspace es una junction al `node_modules` del repositorio. Ya ocurría en los intentos 01 y 02 y
    no cambia ninguna dependencia.

No hay acceso a dispositivos, instalación de APK ni lectura de bases financieras.

## Cambio exacto que tendría que aplicar el propietario

1. Copiar `phase6b3-stage-a.cjs` (SHA-256 `4325a65ea124b41619a0e2246eaa5b670b9552c2bfcd217cbd3fd3e1f2865cfd`) a
   `.claude/hooks/phase6b3-stage-a.cjs` y, si se desea, la prueba a `.claude/hooks/__tests__/`.
2. En `.claude/hooks/dangerous-command-guard.cjs` (actual `991cca1a…5475`):

```diff
 const {checkRunner}=require('./phase6b2-runner.cjs');
+const {checkStageA}=require('./phase6b3-stage-a.cjs');
@@
       const runner=checkRunner(input.command,event.tool_name,event.cwd,core,bashToPowerShell);
       if(runner)return runner;
+      // 6B.3.1 r2 stage A only: exact refresh and offline build; withdraw with ENABLED=false.
+      const stageA=checkStageA(input.command,event.tool_name,event.cwd);
+      if(stageA)return stageA;
       const adb=checkReadOnlyAdb(input.command,event.tool_name,bashToPowerShell);
```

`.claude/settings.json` (`28c13c1d…84a3`) no cambia.

**Revocación:** `ENABLED=false` en el módulo, o retirar las tres líneas del adaptador.

## Prueba sin instalar

```powershell
node docs/validacion-fase6b3-1/authorization/guard-stage-a/phase6b3-stage-a.test.cjs
```

Resultado actual: `{"refreshFailures":[],"buildFailures":["attestation refreshed"]}`, todas las aserciones correctas.

## Después de la etapa A (dentro del repositorio, sin la extensión)

- Archivar `authorization/apk-identity.json` como `apk-identity-attempt-02.json` (sin borrar).
- Mover `android/api{24,35}/phase6b3-probes` a `android/api{24,35}/attempt-02/phase6b3-probes`.
- Calcular con `Get-FileHash` el APK, la atestación y las entradas, y escribir el nuevo `apk-identity.json`.
- Verificar paquete, release, Hermes, arquitecturas y atestación embebida en el APK. Si alguna lectura del
  APK (aapt o listado zip) queda bloqueada, se presentará por separado.
