# Guard v2 para Claude Code

Reemplaza el adaptador `.claude/hooks/dangerous-command-guard.cjs` por una versión que **permite por defecto** y solo bloquea lo irreversible. El guard de Codex (`.codex/hooks/`) no cambia.

## Qué cambia

| Antes (v1) | Ahora (v2) |
|---|---|
| Lo que no podía analizar → `deny` | → `ask`: apruebas esa llamada en el aviso de permisos, sin editar el hook |
| Bash limitado a una gramática mínima (sin `$`, `\`, `>`, `*`, `()`...) | Bash, PowerShell y CMD completos; las sustituciones `$(…)`, `eval`, `bash -c`, `pwsh -Command` y los heredocs se inspeccionan por dentro |
| Pines SHA-256 por fase (`phase6b2-runner`, `phase6b3-stage-a`, `build-script-boundary`) | Sin pines: los scripts de `scripts/` y las tareas Gradle se permiten; `uninstall*` → `ask` |
| Escribir fuera de SmartFin → `deny` | Se permiten los worktrees `C:\sf-*` y el directorio temporal |
| Git en lista blanca | Git en lista negra: solo lo que descarta trabajo |
| Un proceso PowerShell por comando (presupuesto de 4 s) | Sin procesos hijos: ~0,01 ms por comando |

## Lo que sigue en `deny`

- Borrar, mover o sobrescribir archivos **existentes** `.db/.sqlite*` (incluidos `-wal/-shm/-journal`), respaldos `smartfin-*`, CSV exportados, keystores y `.env`, fuera del directorio temporal.
- Borrar la raíz del repositorio, `src`, `__tests__`, `android`, `ios`, `.git`, `.claude`, `.codex` (también dentro de los worktrees), tu carpeta de usuario o carpetas del sistema. También `rm -rf *` sobre esas carpetas.
- `git reset --hard/--merge/--keep`, `git clean` sin `-n`, `git checkout -- <ruta>` / `git checkout <ruta existente>`, `git restore` del árbol de trabajo, `git switch -f`, `git stash drop/clear`, `git push --force` / `+rama` / `--delete`, `git reflog expire`, `filter-branch`.
- Sobre el paquete de producción `com.smartfin` (los sintéticos `com.smartfin.*` sí se permiten): `adb uninstall`, `pm clear`, `pm uninstall`, `run-as` con `rm/mv/cp/sh...`, SQL de escritura sobre su base y `adb push` a su almacenamiento privado.
- `Format-Volume`, `diskpart`, `shutdown`, `dd` sobre un dispositivo.

## Lo que pasa a `ask`

`git push`, `git rebase`, `git branch -D`, editar el propio guard, `settings.json`, `CLAUDE.md` o `AGENTS.md`, borrar un worktree completo, borrar fuera de SmartFin, borrados con destino dinámico (`rm -rf "$X"`), SQL de escritura sobre una base existente, `gradlew uninstall*`, `adb install -d`, `adb reboot`, `powershell -EncodedCommand`, borrar código de `src/database` o `src/modules/security` sin reemplazo, e introducir `DROP TABLE` o `PRAGMA foreign_keys` en ese código.

## Instalación (PowerShell, desde la raíz del repo)

El guard v1 bloquea estos comandos si los intenta Claude, así que ejecútalos tú en una terminal.

1. Respalda la versión actual:

```powershell
Copy-Item .claude\hooks\dangerous-command-guard.cjs .claude\hooks\dangerous-command-guard.v1.cjs.bak
```

2. Instala el guard y su prueba:

```powershell
Copy-Item docs\financial-integrity-guard\propuesta-v2\dangerous-command-guard.cjs .claude\hooks\dangerous-command-guard.cjs -Force
```

```powershell
Copy-Item docs\financial-integrity-guard\propuesta-v2\dangerous-command-guard.test.cjs .claude\hooks\__tests__\dangerous-command-guard.test.cjs -Force
```

3. Verifica:

```powershell
node --test .claude\hooks\__tests__\dangerous-command-guard.test.cjs
```

No hace falta tocar `.claude/settings.json`: el hook conserva el nombre, el matcher y el timeout.

Los módulos `phase6b2-runner.cjs`, `phase6b3-stage-a.cjs`, `build-script-boundary.cjs`, `readonly-adb.cjs` y `synthetic-emulator.cjs` dejan de cargarse. Puedes conservarlos como historial o moverlos a `docs/`. Los respaldos sueltos (`.bak`, `.backup`, `.backup-20261101-134045`) ya no hacen falta.

## Volver atrás

```powershell
Copy-Item .claude\hooks\dangerous-command-guard.v1.cjs.bak .claude\hooks\dangerous-command-guard.cjs -Force
```

## Ajustes futuros sin reescribir nada

Todo está en listas al principio de cada sección de `dangerous-command-guard.cjs`:

- `SENSITIVE_NAME` / `SENSITIVE_DIR`: archivos financieros protegidos.
- `CRITICAL`: carpetas que nunca se borran.
- `GENERATED`: carpetas de compilación que se borran sin revisar su contenido.
- `SYNTHETIC`: patrón de los paquetes Android de prueba.
- `SYSTEM_DENY` / `SYSTEM_ASK`: comandos del sistema.
- `gitRule`: una línea por subcomando de Git.
