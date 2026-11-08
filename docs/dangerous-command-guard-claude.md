# dangerous-command-guard en Claude Code (v2)

Hook `PreToolUse` local de SmartFin para Claude Code. Su objetivo es evitar pérdidas
irreversibles de datos financieros, de trabajo Git sin confirmar y de los datos de la app de
producción en un dispositivo. No sustituye a los permisos de Claude Code: se ejecuta antes que
ellos y solo endurece la decisión.

Vigente desde el 1 de noviembre de 2026 (commit `09c7ac8`, «Mejorar el hook»). La versión
anterior (adaptador v1, con excepciones fijadas por hash para cada fase) está archivada en
[historico/guard-claude-v1/](historico/guard-claude-v1/dangerous-command-guard-claude-v1.md).

## Archivos

| Archivo | Función |
|---|---|
| `.claude/settings.json` | Registra el hook para `Bash`, `PowerShell`, `Write`, `Edit` y `MultiEdit`, con un tiempo máximo de 6 s. |
| `.claude/hooks/dangerous-command-guard.cjs` | El guard. Es autocontenido: solo usa `node:fs`, `node:os` y `node:path`. |
| `.claude/hooks/__tests__/dangerous-command-guard.test.cjs` | Suite `node:test`: 109 casos. Evalúa los comandos y no los ejecuta. |

El guard **no** importa `.codex/hooks/`. Codex conserva su propio guard v1
([dangerous-command-guard.md](dangerous-command-guard.md)), registrado en `.codex/hooks.json`.
Los dos evolucionan por separado.

## Contrato

- **Entrada:** el evento JSON de Claude Code por stdin, con un máximo de 2 MiB. Los comandos de
  más de 128 KiB no se analizan.
- **Salida:**
  - `allow`: termina en silencio y siguen aplicando los permisos propios de Claude Code.
  - `ask`: Claude Code pide aprobación al propietario para esa llamada concreta.
  - `deny`: bloquea la llamada.
- **Motivos:** llevan el prefijo `DG2:`.
- **Fallo cerrado hacia `ask`:** un evento mal formado, un comando que no se puede analizar
  (comillas sin cerrar, heredoc sin cierre) o una excepción interna terminan en `ask`, nunca en
  `allow`.
- **Raíz del proyecto:** `SMARTFIN_ROOT` o el primer directorio ascendente que contenga
  `AGENTS.md` y `package.json`. Las copias hermanas `C:\sf*` (por ejemplo `C:\sf-6b3-20261101`)
  se tratan como worktrees de SmartFin.

## Cómo analiza

Un lexer propio divide el texto de Bash, PowerShell o CMD en comandos simples. No emula los
shells. Tuberías, `;`, `&&`, paréntesis y llaves separan comandos. Las sustituciones `$(…)`,
las comillas invertidas y `<(…)` se evalúan como comandos anidados. Toda palabra construida con
una variable desconocida se marca como dinámica.

Recorre `sudo`, `env`, `npx`, `timeout`, asignaciones y otros envoltorios. También sigue
`bash -c`, `cmd /c`, `powershell -Command`, `eval`/`iex` y `Start-Process`, hasta 6 niveles.
Un script ejecutado por archivo (`node script.js`, `bash script.sh`, `powershell -File`) es su
propio límite: el guard no lee su contenido.

## Reglas

**Archivos sensibles.** Son sensibles las bases `.db`/`.sqlite` y sus `-wal`/`-shm`/`-journal`,
los `.env*`, las claves (`.keystore`, `.jks`, `.pem`, …), los archivos `smartfin-backup*`,
`smartfin-manifest*` y `smartfin-generation-*`, las carpetas `smartfin-local-snapshots` y
`smartfin-backup-jobs`, y los CSV de exportación (`movimientos-AAAA.csv`, `cuentas.csv`, …).
Lo que está bajo el directorio temporal del sistema se considera material de prueba desechable.

| Operación | Decisión |
|---|---|
| Borrar, mover o sobrescribir un archivo sensible existente | deny |
| Crear un archivo sensible nuevo | allow |
| Borrar la raíz del repositorio, `src`, `__tests__`, `android`, `ios`, `.git`, `.claude`, `.codex`, `.agents`, `HOME` o carpetas del sistema | deny |
| Borrado recursivo con comodín de todo el contenido de una carpeta crítica | deny |
| Borrar un worktree completo, borrar fuera de SmartFin y de `%TEMP%`, o borrar recursivamente una carpeta que contiene archivos sensibles | ask |
| Escribir en `AGENTS.md`, `CLAUDE.md`, `.claude/hooks/`, `.claude/settings*.json`, `.codex/`, `.agents/` o `.git/` | ask |
| Destino dinámico, comodín en una escritura, o ruta relativa tras un `cd` a un destino desconocido | ask |

`node_modules`, `build`, `coverage`, `.gradle` y las demás carpetas generadas no se inspeccionan
en busca de archivos sensibles.

**Git.**

| Operación | Decisión |
|---|---|
| `reset --hard/--merge/--keep`, `clean` sin `-n`, `checkout` con rutas o forzado, `switch -f`, `restore` sobre el árbol de trabajo, `stash drop/clear`, `push --force`/`--delete`/`--mirror`, `reflog expire/delete`, `filter-branch`/`filter-repo` | deny |
| `push` normal, `rebase`, `branch -D`, `checkout -B`, `switch -C`, `tag -d/-f`, `gc --prune`, `prune`, `update-ref`, `worktree remove --force`, cambios de remotos, configuración global o sensible (`alias.`, `core.hooksPath`, `credential.`, `url.`) | ask |

**SQLite (`sqlite3`).** Solo lectura, `:memory:`, bases bajo `%TEMP%` y bases nuevas: allow.
SQL de escritura (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `PRAGMA x=`, `.import`, `.restore`, …)
sobre una base existente: ask. También piden aprobación la base o el SQL dinámicos, `-init` y el
modo interactivo sobre un archivo.

**Android (`adb`, Gradle).**

| Operación | Decisión |
|---|---|
| `uninstall com.smartfin`, `pm clear/uninstall com.smartfin`, `push` o redirección hacia `/data/.../com.smartfin/`, `run-as com.smartfin` con `rm`/`mv`/`cp`/`sh`/…, SQL de escritura sobre la base de `com.smartfin` | deny |
| `install -d`, `uninstall` o `pm clear` de un paquete no sintético, `reboot`, `root`, `remount`, `sideload`, `restore`, `emu`, `rm -r` fuera de `/data/local/tmp` y `/sdcard`, `content insert/update/delete`, tareas Gradle `uninstall*` | ask |
| Paquetes sintéticos `com.smartfin.<algo>` (por ejemplo `com.smartfin.snapshot5b2.tests`), lecturas, `install` normal, otras tareas Gradle | allow |

**Sistema.** `format`, `diskpart`, `mkfs`, `Format-Volume`, `shutdown` y `Stop-Computer`: deny.
`Set-ExecutionPolicy`, `reg`, `bcdedit`, `netsh`, `icacls`, `schtasks`, `setx`, `wsl`, cambios en
el registro de Windows, `Start-Process -Verb RunAs` y `powershell -EncodedCommand`: ask.

**Código en línea.** `node -e`, `python -c` o un script por stdin que contenga una operación
destructiva (`git reset --hard`, `pm clear com.smartfin`, …), o que combine una ruta sensible con
una escritura o un borrado: ask. Las llamadas .NET de PowerShell que modifican archivos
(`[IO.File]::Delete`, `.MoveTo(`, …): ask.

**Write / Edit / MultiEdit.**

- Sobrescribir un archivo sensible existente: deny.
- Editar la configuración del guard o las instrucciones del proyecto: ask.
- En el código de persistencia y seguridad (`src/database/`, `src/modules/security/` y los
  módulos nativos de seguridad, captura, publicación y borrado financiero) también es ask:
  - vaciar el contenido sin reemplazo;
  - introducir `DROP TABLE`/`DROP TRIGGER` o cambiar `PRAGMA foreign_keys`/`writable_schema`.

## Límites conocidos

- No lee el contenido de scripts ejecutados por archivo, ni las llamadas ADB o Gradle que hacen
  los scripts del repositorio (`scripts/phase*/`). Esas campañas requieren revisión humana del
  script antes de lanzarlo.
- El lexer reconoce un subconjunto de cada shell. Ante una construcción que no entiende, pide
  aprobación (`ask`); no intenta adivinar.
- Solo cubre las herramientas registradas. Las herramientas MCP y la automatización del
  navegador o del escritorio no pasan por este hook.
- Las reglas de `adb` se basan en el nombre del paquete. Un APK sintético que se instale con el
  id `com.smartfin` recibe el trato de producción.

## Verificar

```bash
node --test .claude/hooks/__tests__/dangerous-command-guard.test.cjs
```

Prueba manual del proceso real (no produce salida porque la decisión es `allow`):

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git status"},"cwd":"."}' | node .claude/hooks/dangerous-command-guard.cjs
```

La suite no forma parte de `npm test` ni de la CI.

## Cambiar o desactivar

Editar `.claude/hooks/` o `.claude/settings.json` requiere aprobación (`ask`) por diseño. Después
de cambiar el guard, ejecutar la suite y abrir una sesión nueva de Claude Code. Para desactivarlo
solo en Claude, quitar la entrada `PreToolUse` de `.claude/settings.json`. El guard de Codex no
se ve afectado.
