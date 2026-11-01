# Cierre del hueco Gradle/Node del guard — 6B.3.1

Estado: **propuesta, no instalada.** Fecha: 1 de noviembre de 2026.
El guard impide al agente escribir en `.claude/hooks/` (`DG-FILE`), así que el cambio lo aplica el propietario.

## Hueco encontrado

Las pruebas sintéticas del guard instalado (`../guard-stage-a/installed-guard-before-refresh.log`) muestran
8 variaciones admitidas por las **reglas existentes**, no por la extensión de la etapa A:
- `refresh-harness.cjs extra`;
- `refresh … && echo x`;
- `gradlew … installRelease`, en dos variantes;
- `gradlew` sin `--offline`;
- `gradlew … clean`;
- `node scripts/phase6b3/prepare-android.cjs`;
- `node scripts/phase6b3/make-runner.cjs`.

El core trata `node <script>` y `gradlew` como límites de ejecución y no inspecciona lo que hacen. Las
consecuencias más graves:
- `installRelease` instalaría un APK con el adb propio de Gradle, sin pasar por las reglas ADB.
- Un script del repositorio puede escribir fuera de SmartFin (`prepare-android.cjs`) o llamar a adb
  (`capture-ui.cjs`).

## Regla propuesta

[`build-script-boundary.cjs`](build-script-boundary.cjs), SHA-256 `5d75cd8fac8db534877beec333b266854b2f0db4bc6a608b4ada12186a0bd2cb`.
Solo **deniega**: nunca concede un permiso. Se ejecuta después de los pines exactos (`phase6b2-runner`,
`phase6b3-stage-a`), así que las dos órdenes literales de la etapa A siguen decidiéndose por su extensión.

| Caso | Decisión |
|---|---|
| Cualquier ejecutable `gradlew`/`gradle` (`.bat`/`.cmd`/`.exe`), en cualquier ruta o encadenado | deny |
| `node` con un script bajo `<repo>/scripts/` o fuera del repositorio, en cualquier forma de ruta y con opciones previas | deny |
| Gradle o Node a través de `pwsh`/`powershell`/`cmd`/`Start-Process`/`Invoke-Expression`/`Invoke-Command` | deny |
| Orden opaca o no analizable que nombra Gradle o Node | deny |
| Solo lectores (`Get-FileHash gradlew.bat`, `Get-Content gradle.properties`, `Test-Path …`) | sin efecto (`null`) |
| `npx tsc`, `npx jest`, `npm test`, `node --version`, `node docs/…test.cjs` | sin efecto (`null`) |

No cambia `settings.json`, el core `.codex`, `phase6b2-runner`, `readonly-adb`, `synthetic-emulator` ni
la extensión de la etapa A.

**Efecto colateral conocido:** cualquier script futuro de `scripts/` necesitará su propio pin exacto, como ya
ocurre con los runners `.ps1`. Esto es intencionado.

## Cambio exacto que aplicaría el propietario

1. Copiar `build-script-boundary.cjs` a `.claude/hooks/build-script-boundary.cjs` y verificar el hash anterior.
2. En `.claude/hooks/dangerous-command-guard.cjs` (actual `40cb3555…790c`):

```diff
 const {checkStageA}=require('./phase6b3-stage-a.cjs');
+const {checkBoundary}=require('./build-script-boundary.cjs');
@@
       const stageA=checkStageA(input.command,event.tool_name,event.cwd);
       if(stageA)return stageA;
+      // Gradle and repository scripts only through an exact audited pin (6B.3.1 gap).
+      const boundary=checkBoundary(input.command,event.tool_name,event.cwd,core,bashToPowerShell);
+      if(boundary)return boundary;
       const adb=checkReadOnlyAdb(input.command,event.tool_name,bashToPowerShell);
```

Esta regla es permanente: conviene mantenerla aunque se revoque la etapa A. Retirarla devuelve el hueco.

## Pruebas (sin ejecutar ninguna orden real)

```powershell
node docs/validacion-fase6b3-1/authorization/guard-boundary/build-script-boundary.test.cjs
node docs/validacion-fase6b3-1/authorization/guard-stage-a/installed-guard.test.cjs before-refresh simulate-boundary
```

- Primera: `build-script-boundary: all checks passed`. Cubre:
  - las 8 variaciones;
  - 14 rutas alternativas (rutas absolutas, `../`, opciones previas, `pwsh -Command`, `cmd /c`,
    `Start-Process`, Bash);
  - 9 lecturas y comandos legítimos que no deben verse afectados.
- Segunda: simula el adaptador propuesto sobre el guard instalado y termina con `failures: []`
  ([log](simulated-before-refresh.log), `50303724…6490`).

Una vez instalada, se verifica sin simulación:

```powershell
node docs/validacion-fase6b3-1/authorization/guard-stage-a/installed-guard.test.cjs before-refresh
```
