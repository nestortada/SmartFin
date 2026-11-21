# dangerous-command-guard en Claude Code (v2)

Hook `PreToolUse` local de SmartFin para Claude Code. Su objetivo es evitar pérdidas
irreversibles de datos financieros, de trabajo Git sin confirmar y de los datos de la app de
producción en un dispositivo, y (desde el 16 de noviembre de 2026, PR 3) pedir la aprobación del
propietario antes de cambiar el **plano de control** de los agentes: su memoria, sus definiciones,
reglas, hooks, workflows, skills, settings e instrucciones. No sustituye a los permisos de Claude
Code: se ejecuta antes que ellos y solo endurece la decisión.

Vigente desde el 1 de noviembre de 2026 (commit `09c7ac8`, «Mejorar el hook»). La versión
anterior (adaptador v1, con excepciones fijadas por hash para cada fase) está archivada en
[historico/guard-claude-v1/](historico/guard-claude-v1/dangerous-command-guard-claude-v1.md).

## Archivos

| Archivo | Función |
|---|---|
| `.claude/settings.json` | Registra el hook para `Bash`, `PowerShell`, `Write`, `Edit`, `MultiEdit` y `NotebookEdit` con `node "$CLAUDE_PROJECT_DIR/.claude/hooks/dangerous-command-guard.cjs"` (shell bash), tiempo máximo de 10 s y `"onFailure": "block"`. |
| `.claude/hooks/dangerous-command-guard.cjs` | El guard. Es autocontenido: solo usa `node:crypto`, `node:fs`, `node:os` y `node:path`. Exporta `evaluate`, `lex`, `controlPath`, `CONTROL_DIRS`, `CONTROL_FILES` y `HOOK_SUITES` para las pruebas. |
| `.claude/hooks/__tests__/dangerous-command-guard.test.cjs` | Suite `node:test`: 308 casos con rutas y archivos sintéticos (los 109 originales, casos de `timeout` y `cp -T`, la matriz del plano de control, scripts dentro de él, programas no modelados con argumentos dinámicos o comodines, palabras reservadas de Bash, `ForEach-Object` con métodos, `rg --pre` y `node --test`). Evalúa los comandos y no los ejecuta. |
| `.claude/hooks/__tests__/agent-config-policy.test.cjs` | Invariantes de configuración: fallan si desaparece una protección de PR 2 o de PR 3 (ver «CI»). |

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
- **Fallo cerrado si el hook no arranca** (desde el 7 de noviembre de 2026): con
  `"onFailure": "block"`, si Node no encuentra el guard, el proceso supera los 10 s o devuelve una
  salida inválida, Claude Code bloquea la llamada en vez de dejarla pasar. Antes de activarlo se
  comprobó que `$CLAUDE_PROJECT_DIR` se expande en hooks reales: el hook `Stop` de recordatorio,
  registrado con el mismo patrón, dejó su estado en dos sesiones distintas.
- **Recuperación:** si el guard se rompe, quedan bloqueados `Bash`, `PowerShell`, `Write`, `Edit` y
  `MultiEdit` en Claude Code. Corrige o restaura `.claude/hooks/dangerous-command-guard.cjs` con tu
  editor (o `git checkout -- .claude/hooks/dangerous-command-guard.cjs` en tu terminal), o quita
  temporalmente `"onFailure": "block"` de `.claude/settings.json`, y abre una sesión nueva.
- **Fallo transitorio al arrancar** (observado el 12 de noviembre de 2026): durante varios minutos el
  hook terminó con `its program could not be started (ENOENT)` y después con `failed` sin stderr, y
  bloqueó todas las llamadas a `Bash`, `PowerShell`, `Write` y `Edit`. El guard no había cambiado y
  se recuperó solo; la causa no se determinó (el proceso `bash` que lanza el hook no llegó a
  arrancar). Si ocurre: `Read`, `Grep` y `Glob` siguen funcionando porque no pasan por el hook;
  reintenta con un comando trivial (`pwd`) pasado un momento; si persiste, comprueba en tu terminal
  que `bash` y `node` responden (`bash -c "node --version"`) y aplica la recuperación anterior. No
  quites `onFailure` de forma permanente por un fallo transitorio.
- **Raíz del proyecto:** `SMARTFIN_ROOT` o el primer directorio ascendente que contenga
  `AGENTS.md` y `package.json`. Si esa raíz es un `.claude/worktrees/<nombre>`, el checkout principal
  también se reconoce. Son checkouts propios, cada uno con su plano de control: el principal, las
  copias hermanas `C:\sf*` (por ejemplo `C:\sf-6b3-20261101`) y todo `.claude/worktrees/<nombre>`
  dentro de cualquiera de ellos.

## Cómo analiza

Un lexer propio divide el texto de Bash, PowerShell o CMD en comandos simples. No emula los
shells. Tuberías, `;`, `&&`, paréntesis y llaves separan comandos. Las sustituciones `$(…)`,
las comillas invertidas y `<(…)` se evalúan como comandos anidados. Toda palabra construida con
una variable desconocida se marca como dinámica.

Recorre `sudo`, `env` (también `env -C` y `env -S`), `npx` (también `npx -c`), `timeout`,
asignaciones y otros envoltorios. También sigue `bash -c`, `cmd /c`, `powershell -Command`,
`eval`/`iex` y `Start-Process`, hasta 6 niveles. Sigue el directorio de trabajo a través de `cd`,
`pushd`/`popd`, `Set-Location`, `git -C` y `env -C`; un `cd` dentro de un subshell `( … )` no
afecta a lo que viene después. `cd -` o un destino dinámico dejan el directorio como desconocido
y toda ruta relativa posterior pide aprobación. La expansión de llaves de Bash (`CLAUDE{,}.md`)
se trata como nombre dinámico. Las palabras reservadas de Bash (`do`, `then`, `else`, `if`,
`while`, `!`…) no ocultan el comando que las sigue (`for f in a; do git reset --hard; done` es
`deny`); la lista de `for` y la palabra de `case` son valores, no comandos.

Las rutas se normalizan antes de comparar: relativas o absolutas, `..`, formas de Git Bash
(`/c/…`, `/cygdrive/c/…`, `/tmp`), `~`, prefijos `\\?\` y `FileSystem::` de PowerShell, nombres
con puntos o espacios finales y flujos alternativos (`CLAUDE.md::$DATA`), que en Windows son el
mismo archivo. Los enlaces simbólicos y las *junctions* se resuelven con `realpath` sobre el tramo
existente de la ruta: una escritura a través de un enlace que apunta al plano de control pide
aprobación. Una ruta UNC (`\\servidor\…`) pide aprobación porque no se puede comprobar adónde lleva.

**Scripts.** Un script ejecutado por archivo ya no es una caja negra:

- Scripts de shell (`bash x.sh`, `./x.sh`, `source x.sh`, `powershell -File x.ps1`, `& .\x.ps1`):
  se leen y se analizan como un comando. Lo que el guard denegaría dentro de un script pasa a
  `ask`, porque es código del propietario.
- Scripts de Node, Python, Ruby, Perl y CMD: se lee solo el archivo de entrada. Si nombra el plano
  de control (`.claude`, `agent-memory`, `CLAUDE.md`, `AGENTS.md`, `.codex`, `.agents`,
  `settings.json`…) y contiene código que escribe, borra o lanza procesos, pide aprobación. Los
  `require`/`import` no se siguen.
- Un script escrito en el mismo comando (`printf … > x.js && node x.js`), de ruta dinámica o con
  comodines (`bash escri*.sh`), ilegible por tamaño o no analizable: `ask`. Uno que no existe: `allow` (no se ejecuta nada).
- Un script dentro del plano de control se analiza como cualquier otro: estar ahí no lo hace
  seguro. Ejecutar a mano un hook de `.claude/hooks/` que nombra el plano de control y escribe pide
  aprobación (Claude Code ejecuta los hooks sin pasar por el guard).
- Excepciones con argumentos o archivos exactos: `node scripts/syncAgentSkills.js --check`
  (`npm run skills:check`; sin `--check` sincroniza `.agents/skills` y pide aprobación) y
  `node --test` de las cuatro suites de hooks que ejecutan la CI y `/verificar`
  (`.claude/hooks/__tests__/{dangerous-command-guard,reviewer-reminder,session-context,agent-config-policy}.test.cjs`),
  solo con la forma exacta `node --test <suite> [<suite>…]`, sin ningún otro argumento antes ni
  después. El nombre no basta: el contenido debe coincidir con el revisado, fijado en `HOOK_SUITES` del guard
  como SHA-256 del archivo con finales LF. En otro checkout, además, los hooks que carga la suite
  (`dangerous-command-guard.cjs`, `reviewer-reminder.cjs`, `session-context.cjs`) deben ser idénticos
  a los del checkout cuyo guard se está ejecutando. Una suite con otro contenido o con otros hooks, a
  la que se llega por un enlace o escrita en el mismo comando se analiza como cualquier script.
  Cambiar una suite obliga a actualizar su hash en el guard; `agent-config-policy.test.cjs` falla si
  no coinciden.
- Cualquier otra forma de `node --test` pide aprobación: sin archivos (descubre pruebas), con una
  carpeta o un patrón (node los expande, también entre comillas), con otros archivos o con cualquier
  opción de node antes o después de los archivos (`--require`, `--import`, `--test-reporter`,
  `--test-isolation`, `--test-timeout`, `--watch`…). El guard no modela esas opciones: solo reconoce
  la invocación verificada. Fuera de `node --test`, `--test-reporter` (salvo `spec`, `tap`, `dot`,
  `junit` y `lcov`) y `--test-global-setup` se analizan como script si son un archivo y piden
  aprobación si son un paquete; `--experimental-config-file`, `--experimental-default-config-file`,
  `--env-file` y `--env-file-if-exists` pueden añadir código (`NODE_OPTIONS`, `--require`): `ask`.
- `npm run <script>`, `npm test`, `npm start` y `npm install`/`ci` se analizan leyendo el texto del
  script en `package.json` (con `pre`/`post` y los argumentos añadidos). `python -m` pide aprobación.
- Los binarios (`.exe`, ejecutables sin texto) y los paquetes que lanza `npx <paquete>` no se
  analizan, salvo las opciones de escritura conocidas de Jest, ESLint, Prettier y `tsc`.

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
| Crear, sobrescribir, anexar, mover, borrar, enlazar o cambiar atributos en el plano de control (ver «Plano de control») o en `.git/` | ask |
| Destino dinámico, comodín en una escritura, o ruta relativa tras un `cd` a un destino desconocido | ask |

`node_modules`, `build`, `coverage`, `.gradle` y las demás carpetas generadas no se inspeccionan
en busca de archivos sensibles.

**Plano de control de los agentes.** Rutas protegidas en cada checkout (`CONTROL_DIRS` y
`CONTROL_FILES` del guard):

- `.claude/agent-memory/**`, `.claude/agent-memory-local/**`, `.claude/agents/**`, `.claude/rules/**`,
  `.claude/workflows/**`, `.claude/hooks/**`, `.claude/skills/**`, `.claude/commands/**`, `.codex/**`,
  `.agents/**`;
- `.claude/settings.json`, `.claude/settings.local.json`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json`;
- la misma configuración a nivel de usuario: `~/.claude.json` (servidores MCP y herramientas por
  proyecto), `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.claude/CLAUDE.md` y
  `~/.claude/{agent-memory,agents,rules,hooks,skills,commands,plugins,workflows}/**`. La memoria
  automática de `~/.claude/projects/**` no se protege: Claude Code la escribe como parte del trabajo
  normal.
- Aparte del plano de control, `.git/**` sigue protegido (y sus archivos no se ejecutan como
  scripts de confianza: `git config` y `git commit` escriben en ellos).

Toda escritura reconocida pide aprobación (`ask`), nunca `deny`, para que el propietario pueda
aprobar un cambio legítimo. Se protegen también las carpetas que las contienen (la raíz del
checkout, `.claude`, `.claude/worktrees`, `~/.claude`) cuando la operación las reemplaza, mueve o
borra enteras, o copia o extrae varios archivos dentro de ellas (`cp plantilla/* .`,
`tar -xf x.tgz`).

Operaciones reconocidas:

- Bash: `>`, `>>`, `2>`, `&>`, here-documents con redirección, `tee`/`tee -a`, `cat > archivo`,
  `cp`, `mv`, `rm`, `touch`, `mkdir`, `ln`, `install`, `chmod`/`chown`, `sed -i`, `perl -i`,
  `awk -i inplace` (y programas awk que escriben), `sort -o`, `truncate`, `dd of=`, `find -delete`,
  `find -exec`/`-execdir` (cada ruta encontrada es un argumento dinámico), `find -fprint`, `xargs`,
  `curl -o`/`-O`, `wget`, `tar -x`, `unzip`, `7z x`, `rsync`, `patch`, subshells, sustituciones y
  shells anidados.
- PowerShell: `Set-Content`, `Add-Content`, `Out-File`, `Tee-Object`, `New-Item` (también enlaces
  simbólicos y *junctions*, cuyo destino se comprueba), `Copy-Item`, `Move-Item`, `Rename-Item`,
  `Remove-Item`, `Clear-Content`, `Export-Csv`, `Export-Clixml`, `Expand-Archive`,
  `Invoke-WebRequest -OutFile`, `Set-ItemProperty`, `>` y `>>`, parámetros abreviados (`-Pa`) o con
  dos puntos (`-Path:x`), y llamadas .NET que escriben (`[IO.File]::WriteAllText`,
  `AppendAllText`, `Delete`, `Move`, `Copy`, `Create*`, `StreamWriter`, `.Delete()`, `.MoveTo()`…;
  estas piden aprobación sea cual sea la ruta). CMD: `copy`, `move`, `del`, `ren`, `xcopy`,
  `robocopy`, `mklink`.
- Código en línea (`node -e`/`-p`, `python -c`, `ruby -e`, `perl -e`, `php -r`, `tsx -e`,
  here-documents) que usa una API conocida de escritura o de procesos, o que nombra el plano de
  control con cualquier API: `ask`. El código en línea que solo lee y no nombra el plano de control
  sigue permitido. Un shell o intérprete que recibe el programa por una tubería
  (`… | bash`, `… | node`, `powershell -Command -`): `ask`.
- `sed` con los comandos `w`/`W` o los flags `/w` y `/e` (escriben o ejecutan) y `sed -f`: `ask`.
  `perl`/`ruby -i` en cualquier posición o agrupado (`-0pi`).
- Node: `--require`/`--import` (también con `=`) se analizan como scripts; `--import data:…`
  pide aprobación; las opciones que escriben (`--test-reporter-destination`, `--redirect-warnings`,
  `--cpu-prof-dir`…) se comprueban como escrituras; `NODE_OPTIONS` con precarga: `ask`.
- Programas que el guard no modela (`gzip`, `openssl`, `vim`, `certutil`, `npx shx`,
  `Start-Transcript`…): si un argumento literal (también `--opción=valor` o `-oVALOR`) nombra el
  plano de control, o un comodín puede nombrarlo (`gzip .claude/agents/*`), `ask`. Un argumento
  dinámico que no se puede resolver (`$F`, `$(…)`, `"$D/x"`) puede ser cualquier ruta: `ask`,
  salvo en programas que no reciben archivos (`sleep`, `kill`, `exit`…) y constantes de PowerShell
  (`$true`, `$null`, `$LASTEXITCODE`). Los lectores conocidos (`cat`, `grep`, `diff`, `wc`,
  `Get-Content`, `Get-FileHash`…) siguen permitidos con cualquier argumento, salvo las opciones que
  ejecutan otro programa: `rg --pre`, `ag --pager` y `RIPGREP_CONFIG_PATH=…` piden aprobación, igual
  que `git grep -O<programa>` (`--open-files-in-pager`). Las abreviaturas de `ag` (`--pag`) no se
  reconocen.
- `ForEach-Object -MemberName X`, `% X` y `foreach X` invocan el método X sobre los objetos de la
  tubería: con un método que modifica (`Delete`, `MoveTo`, `CopyTo`, `Replace`, `Open`, `OpenWrite`,
  `AppendText`, `Create*`, `Encrypt`, `Extract*`, `Terminate`, `set_*`…) o un miembro dinámico,
  `ask`; con una propiedad o un método de lectura (`Name`, `FullName`, `ToString`, `OpenText`),
  `allow`, y sus argumentos se revisan como los de cualquier programa. `-MemberName` se reconoce en
  cualquier posición, y los valores de `-ArgumentList`, `-ErrorAction`, `-OutVariable` y los demás
  parámetros comunes no se confunden con el miembro. La misma lista de nombres se aplica a cualquier
  llamada a un método de instancia en PowerShell (`$_.Delete()`, `$_.'Delete'()`,
  `$_.set_IsReadOnly($true)`, `$_.Kill()`, `$_.Terminate.Invoke()`), y piden aprobación los nombres
  que no se pueden leer: `$_.$m()`, `$_.('x')()`, `….Methods['x'].Invoke()`, `% ( … )` y
  `.ForEach( … )` con algo distinto de un bloque o un literal simple. La lista de métodos se basa en
  prefijos: un método que modifica con otro nombre, en un tipo .NET poco común, puede no
  reconocerse, y algunos métodos que no escriben archivos (`$s.Remove(…)`, `$sw.Stop()`) piden
  aprobación.
- Variables reasignadas en el mismo comando (`HOME=…`, `export TMPDIR=…`, `$env:USERPROFILE=…`):
  desde ahí su valor, y `~`, se tratan como dinámicos.
- PowerShell: listas (`-Path a,b`), `-PSPath`, nombres de comando o método calculados
  (`&('Set'+'-Content')`, `]::"WriteAllText"(`), asignación de atributos (`.IsReadOnly=`), alias
  (`Set-Alias`), `iex`/`Invoke-Expression` sin código literal (tubería o `( … )`) y
  `Move-Item`/`Rename-Item`/`Set-ItemProperty` con el origen por tubería: `ask`. `Start-Process
  -ArgumentList 'a','b'` conserva cada elemento, también los que empiezan por `-`.
- Bash: `>&archivo` (equivale a `>archivo 2>&1`) es una escritura; `2>&1`, `>&2` y `2>&-` no.
  `source` sin archivo, `source <(…)` y los scripts `/dev/stdin`, `/dev/fd/N`: como programa por
  tubería (`ask`). Un argumento literal del plano de control pasado a un script de Node o Python:
  `ask`.
- Variables que Git ejecuta (`GIT_PAGER`, `EDITOR`…): su valor se analiza como comando del propio
  agente (un `deny` sigue siendo `deny`). `GIT_CONFIG_*`, `GIT_EXEC_PATH`, `git --exec-path` y
  `git config --file` hacia el plano de control: `ask`; `git -c` usa la misma lista de claves
  sensibles que `git config` (incluidas `pager.*`, `filter.*`, `include.*`, `gpg.*`).
- Git: ver la tabla siguiente.
- `Write`, `Edit`, `MultiEdit` y `NotebookEdit`.

Herramientas que reescriben archivos que el comando no nombra: `jest -u`/`--updateSnapshot`,
`eslint --fix`, `prettier --write`: `ask`. Sus opciones de salida con ruta (`--outputFile`,
`-o`, `--outDir`…) se comprueban como escrituras. `alias` de ruta que ocultan el destino real de
una escritura posterior (`subst`, `New-PSDrive`, `mount`, `fsutil`): `ask`.

**Prevención, detección y limitaciones.**

- **Prevención** (antes de ejecutar): el guard responde `ask` a las operaciones anteriores y a
  todo lo que no puede analizar; Claude Code muestra la confirmación y, si el propietario no la
  aprueba, la operación no se ejecuta. En `claude -p` no hay a quién preguntar y `ask` equivale a
  denegar. `permissions.ask` añade `Edit(/.claude/agent-memory/**)` y las variantes de escritura
  de Jest, ESLint y `git diff/log/show --output`.
- **Detección** (después de ejecutar): el hook `Stop` (`reviewer-reminder.cjs`) recuerda, una vez
  por versión de contenido, que el propietario revise el diff de los archivos del plano de control
  que cambiaron y pide `security-privacy-reviewer` para memoria, agentes, reglas, hooks, settings y
  workflows. El workflow `/smartfin-development` compara inventarios Git antes y después y exige la
  decisión `agent_config` si su diff toca esas rutas. Son controles de proceso: ninguno autoriza
  un cambio por sí mismo.
- **Limitaciones** (lo que no se intercepta): el guard solo ve las herramientas que Claude Code le
  envía. No ve herramientas MCP, automatización del navegador o del escritorio, editores, otras
  aplicaciones ni procesos iniciados fuera de la sesión (o lanzados en segundo plano por un
  programa que sí se permitió). No sigue los `require`/`import` de un script ni analiza binarios o
  paquetes de `npx` más allá de sus argumentos literales. Un programa permitido que ejecuta código
  de un archivo (Jest con una prueba o un *setup*, ESLint con una configuración o un plugin, `node
  x.js` cuyo archivo no nombra el plano de control de forma literal) puede escribir sin que el guard
  lo vea; solo pregunta cuando el archivo se escribió en el mismo comando. En `acceptEdits`, un
  `Write` de esa prueba seguido de `npm test` en otra llamada escribiría sin confirmación: lo detecta
  después el recordatorio `Stop`. Código ofuscado más allá de lo anterior (`getattr(p,'write_'+…)`
  sin nombrar el plano de control) escapa al análisis. Operaciones Git que reemplazan el árbol
  entero (`checkout <rama>`, `switch`, `merge`, `pull`, `cherry-pick`, `stash pop`, `worktree add`)
  no se analizan por ruta, ni las operaciones solo de índice (`restore --staged`,
  `update-index --cacheinfo`). Riesgos pendientes de otra revisión (este cambio no los cubre):
  en otro checkout, las suites fijadas también ejecutan fragmentos del workflow de ese checkout y
  usan su configuración de Git; fuera del plano de control protegido quedan `CLAUDE.local.md`, `.claude/CLAUDE.md`,
  `CLAUDE.md`/`AGENTS.md` en subcarpetas, `.claude/output-styles/`, `.claude/statusline.sh`,
  `.claude/launch.json` y `.github/workflows/ci.yml` (este último sí exige `agent_config` en el
  workflow); el workflow no exige `agent_config` para `.claude/skills/`, `.claude/commands/` ni
  `.agents/` (el guard sí pide confirmación), y no ve los cambios de archivos ignorados por Git
  (`.claude/settings.local.json`): ahí solo protege el guard. Solo se reconocen como checkouts el principal, `C:\sf*` y los
  `.claude/worktrees/<nombre>`; un clon en otra carpeta no tiene plano de control protegido. No se
  ha validado en los modos `auto` ni `bypassPermissions`. Quien aprueba la confirmación puede
  escribir: es un freno contra escrituras accidentales o no autorizadas, no un aislamiento.

**Git.**

| Operación | Decisión |
|---|---|
| `reset --hard/--merge/--keep`, `clean` sin `-n`, `checkout` con rutas o forzado, `switch -f`, `restore` sobre el árbol de trabajo, `stash drop/clear`, `push --force`/`--delete`/`--mirror`, `reflog expire/delete`, `filter-branch`/`filter-repo` | deny |
| `push` normal, `rebase`, `branch -D`, `checkout -B`, `switch -C`, `tag -d/-f`, `gc --prune`, `prune`, `update-ref`, `worktree remove --force`, cambios de remotos, configuración global o sensible (`alias.`, `core.hooksPath`, `credential.`, `url.`) | ask |
| `rm`/`mv` sobre el plano de control, `apply`/`am` de un parche que lo toca (con cualquier `-pN`) o que no se puede leer, `diff/log/show --output` hacia él, `clone`/`submodule add` dentro de él, `checkout-index -f/-a/--prefix`, `read-tree -u/--reset`, `update-index --assume-unchanged/--skip-worktree` (oculta cambios a `git status`), `sparse-checkout`, ejecutar un archivo de `.git/` | ask |

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

**Write / Edit / MultiEdit / NotebookEdit.**

- Sobrescribir un archivo sensible existente: deny.
- Crear o editar un archivo del plano de control (directamente o a través de un enlace): ask.
- En el código de persistencia y seguridad (`src/database/`, `src/modules/security/` y los
  módulos nativos de seguridad, captura, publicación y borrado financiero) también es ask:
  - vaciar el contenido sin reemplazo;
  - introducir `DROP TABLE`/`DROP TRIGGER` o cambiar `PRAGMA foreign_keys`/`writable_schema`.

## Límites conocidos

- Analiza los scripts de shell y escanea el archivo de entrada de los demás (ver «Scripts»), pero
  no sigue sus dependencias ni las llamadas ADB o Gradle que hacen los programas que lanzan. Los
  scripts de campaña (`scripts/phase*/`) que nombran `.claude` y escriben archivos ahora piden
  aprobación; siguen requiriendo revisión humana antes de lanzarlos.
- El lexer reconoce un subconjunto de cada shell. Ante una construcción que no entiende, pide
  aprobación (`ask`); no intenta adivinar.
- Solo cubre las herramientas registradas. Las herramientas MCP y la automatización del
  navegador o del escritorio no pasan por este hook.
- `Read`, `Grep` y `Glob` tampoco pasan por el guard. La lectura de bases SQLite, `.env`, keystores
  y exportaciones CSV de usuario la impiden las reglas `permissions.deny` de `.claude/settings.json`.
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

## CI

Las suites no forman parte de `npm test`. El job `guard-hooks` de `.github/workflows/ci.yml` las
ejecuta sobre `windows-latest`, porque usan rutas, *junctions* y worktrees de Windows; solo
necesitan Node, sin dependencias:

```bash
node --test .claude/hooks/__tests__/dangerous-command-guard.test.cjs .claude/hooks/__tests__/reviewer-reminder.test.cjs .claude/hooks/__tests__/session-context.test.cjs .claude/hooks/__tests__/agent-config-policy.test.cjs
```

`agent-config-policy.test.cjs` falla si alguien retira, por accidente o no: la regla
`Edit(/.claude/agent-memory/**)`; `memory: project` o los `disallowedTools` de
`financial-reviewer`; una de las siete definiciones de agentes; un bloqueo de `permissions.deny`;
un comando de `permissions.allow` que no sea de lectura o verificación; las reglas `ask` de Jest,
ESLint y `--output`; uno de los cuatro hooks; `onFailure: block`; una ruta protegida; la decisión
`agent_config` del workflow para memoria, agentes y reglas; o la paridad de revisores entre el
hook `Stop` y el workflow. Ninguno de los casos depende de dónde esté clonado el repositorio. El
procedimiento `/verificar` ejecuta la misma línea en su paso 4.

## Volver a validar al actualizar Claude Code

Las suites comprueban la lógica del guard, no el comportamiento de Claude Code. Al cambiar de
versión (la validación del PR 3 se hizo con 2.1.325), en una copia sintética del repositorio y
nunca sobre la memoria real:

1. Comprueba que el hook sigue recibiendo `NotebookEdit` y que `$CLAUDE_PROJECT_DIR` se expande
   (`claude -p` con `--output-format json`: la denegación aparece en `permission_denials` con el
   motivo `DG2:`).
2. Con `claude -p`, pide una escritura directa a `MEMORY.md`, una redirección Bash, un
   `Set-Content` de PowerShell, un `mv`/`rm` y un `node -e` que escriba: las cinco deben quedar
   denegadas y los hashes de los archivos sintéticos, intactos; un control sobre `docs/` debe
   ejecutarse.
3. Comprueba que `permissions.ask` sigue haciendo preguntar a `npx jest -u` y `npx eslint --fix`
   mientras `npx jest <ruta>` queda permitido.
4. En una sesión interactiva, provoca una escritura protegida y comprueba que aparece la
   confirmación con el motivo `DG2:`; rechazarla no debe cambiar el archivo.
5. Comprueba que los siete agentes cargan y que `financial-reviewer` recibe su memoria.

## Cambiar o desactivar

Editar el plano de control (incluidos `.claude/hooks/` y `.claude/settings.json`) requiere
aprobación (`ask`) por diseño. Después de cambiar el guard, ejecuta las suites y abre una sesión
nueva de Claude Code; la app de escritorio usa los hooks del checkout principal, así que el cambio
rige cuando llega a `main`. Para desactivarlo solo en Claude, quita la entrada `PreToolUse` de
`.claude/settings.json` (la prueba de invariantes de la CI fallará). El guard de Codex no se ve
afectado.
