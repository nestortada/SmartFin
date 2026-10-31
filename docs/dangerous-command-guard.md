# dangerous-command-guard (v1)

Hook local de SmartFin para evitar errores destructivos en llamadas compatibles de
Codex. No modifica dominio financiero, dependencias, esquema ni migraciones. No es
un sandbox, antivirus ni un mecanismo de autorización humana. No hay red, telemetría
ni logs propios con comandos, secretos o datos financieros.

## Entorno y contrato comprobados

- Codex Desktop / CLI `0.166.0-alpha.5.1`, Windows, Node `24.16.0` y PowerShell `7.6.5`.
- `codex features list` informa `hooks stable true`.
- Configuración exclusiva en `.codex/hooks.json`; no se añade `config.toml` local ni
  se deja modificado el global. Los hooks de plugins existentes permanecen intactos.
- Handler `command` síncrono, `PreToolUse`, matcher `*`, `commandWindows`, timeout 5 s.
- Lee un único evento JSON de stdin. Permite con salida vacía y código 0. Deniega
  con `hookSpecificOutput.hookEventName = PreToolUse`,
  `permissionDecision = deny` y motivo sin contenido sensible.
- No usa decisiones `ask`, reescrituras, bypass de confianza ni ejecución asíncrona.

Contrato oficial consultado: [Hooks](https://learn.chatgpt.com/docs/hooks),
[PreToolUse](https://learn.chatgpt.com/docs/hooks#pretooluse),
[cobertura](https://learn.chatgpt.com/docs/hooks#tool-coverage) y
[App Server](https://learn.chatgpt.com/docs/app-server#api-overview).

## Archivos

| Archivo | Responsabilidad |
| --- | --- |
| `.codex/hooks.json` | Registro local de Codex |
| `.codex/hooks/dangerous-command-guard.cjs` | Contrato, validación, reglas y límites |
| `.codex/hooks/parse-powershell.ps1` | Solo AST; nunca invoca el texto recibido |
| `.codex/hooks/dangerous-command-policy.json` | Destinos generados e identidades sintéticas exactas |
| `.codex/hooks/__tests__/dangerous-command-guard.test.cjs` | Comandos simulados y protocolo real del proceso |
| `.codex/hooks/__tests__/codex-integration.cjs` | Integración real opt-in, reproducible y efímera |
| `docs/dangerous-command-guard.md` | Operación, evidencia y límites |

El comando Windows usa la ruta absoluta de este checkout para funcionar también
desde subdirectorios. Si se mueve el repositorio hay que revisar esa ruta y las
rutas del parser en la política, repetir pruebas y revisar la confianza en Codex.
El comando alternativo de POSIX solo localiza el archivo; el analizador de esta
versión está validado para Windows. No se declara soporte Linux/macOS.

## Reglas implementadas

### Git

Permite consultas, staging, commits ordinarios, fetch, merge y cambios de rama
mediante `switch` sin opciones destructivas. No ejecuta Git para evaluar decisiones.
Deniega `reset`, `restore`, checkout ambiguo o forzado, clean sin dry-run, borrado de
stash/ramas forzado y operaciones sobre historial de recuperación. Deniega aliases
Git desconocidos y overrides `-c`/`--git-dir`/`--work-tree`.

`git clean -nd`, `-n -d` y `--dry-run -fdx` están permitidos. Se revisan todas las
partes de una cadena, incluso las ramas que podrían no ejecutarse. Para evitar
carreras y consultas adicionales, los comandos destructivos se bloquean también
cuando el árbol pudiera estar limpio. No existe un bypass mediante comentarios,
palabras `safe`/`test`, variables de entorno o texto de autorización en el comando.

### SQLite y respaldos

Protege extensiones `.db`, `.sqlite`, `.sqlite3` y sus WAL/SHM/journal, snapshots,
manifiestos y nombres de CSV financieros conocidos. Nunca abre una base SQLite.
Las consultas directas a archivos reales o desconocidos requieren `-readonly` y
SQL reconocido de consulta. Las escrituras directas, incluso con WHERE, se bloquean.

Las escrituras en `:memory:` se permiten: esa identidad la define SQLite, no un
nombre elegido por quien llama. Se bloquean ATTACH/DETACH, extensiones, funciones
de archivos, dot commands y VACUUM INTO incluso para esa base, para evitar salidas
del ámbito de memoria. No es un parser SQL general.

Los fixtures en disco no se declaran desechables por estar bajo `docs` o llamarse
`test`. Se permite el generador concreto `scripts/phase5e3/reader-contract.cjs` sin
argumentos solo si coincide su SHA-256 auditado. El guard calcula el hash del script,
no de bases financieras. Esa identidad permite su invocación normal, no certifica
sus dependencias, su entorno ni la procedencia de cualquier base copiada allí.
Otros scripts y tests conservan su ejecución normal con los límites descritos abajo.

### Android

Deniega `pm clear` y uninstall de `com.smartfin` y paquetes desconocidos; también
operaciones shell de archivos no reconocidas, restore y wipe del emulador.
Para reiniciar/desinstalar fixtures requiere serial literal y uno de estos IDs
auditados exactos: `com.smartfin.snapshot5b2.tests`,
`com.smartfin.sharedcommands.bench`, `com.smartfin.dashboardphase2.bench`.
Un paquete meramente llamado `test` no obtiene permiso.

Las rutas de SQLite sintético Android se restringen adicionalmente a las bases
registradas en la política. Las cadenas shell con expansión o encadenamiento se
deniegan; esta versión no implementa un shell POSIX Android general. Se permiten
consultas como dumpsys/getprop y operaciones de desarrollo reconocidas. No se
conecta a dispositivos para decidir ni limpia ningún paquete durante las pruebas.

### Sistema de archivos y analizador

- Borrados limitados a `coverage`, `android/build`, `android/app/build`, `ios/build`;
  una ruta literal puede referirse a un descendiente. Se bloquean recursos sensibles
  dentro de esos árboles y se inspeccionan como máximo 10.000 entradas, sin seguir enlaces.
- Deniega rutas externas, comodines, expansiones, UNC, streams alternativos y enlaces
  o junctions en ancestros existentes. Deniega archivos existentes con múltiples
  enlaces físicos. Existe una carrera inevitable entre comprobación y ejecución.
- Protege `.git`, `.codex`, `.agents`, AGENTS.md, `.env*` y claves de firma. Para
  fuentes sensibles permite patches revisables, pero bloquea borrados, vaciados y
  algunos controles SQL destructivos identificables. No revisa semántica financiera.
- Analiza PowerShell por AST; los argumentos dinámicos de una operación reconocida
  no se suponen seguros. Inspecciona subexpresiones y redirecciones. Un cambio de
  directorio en la misma entrada invalida las decisiones de escritura relativas.
- CMD admite argv literal con comillas dobles y cadenas `&`, `&&`, `||`, pipes;
  expansión, escapes, agrupación y redirección CMD se deniegan. Para redirección
  legítima puede usarse PowerShell con destino literal.
- Procesos PowerShell/CMD anidados se vuelven a analizar hasta seis niveles. El
  parser se limita a 2,5 s por proceso y el análisis dispone de un presupuesto de
  4 s, dentro del timeout de Codex de 5 s.
- Código inline de intérpretes, shells codificados, IEX, Start-Process y llamadas
  de miembros .NET se deniegan conservadoramente. Scripts en archivo son una frontera
  explícita de cobertura; no se finge analizar su comportamiento transitivo.

## Ejecutar las pruebas

Desde la raíz del repositorio:

```powershell
node --test .codex/hooks/__tests__/dangerous-command-guard.test.cjs
```

Los comandos destructivos aparecen exclusivamente como datos: no se ejecutan.
No se crean ni abren bases reales, no se invoca adb y no se ejecutan migraciones.
Los procesos reales de la suite son el parser y el guard, con stdin simulado.
Los tests cubren errores, enlaces simulados, rutas, Git, SQL, Android, cadenas,
procesos anidados, patches, protocolo y latencia. No se requiere ejecutar la suite
financiera para esta infraestructura aislada.

## Carga, confianza e integración

Codex descubrió el hook mediante `hooks/list` como `source: project`, matcher `*`,
modo síncrono, timeout 5 s, sin warnings ni errores. Inicialmente aparece
`trustStatus: untrusted`: estar instalado no significa que esté ejecutándose.

La versión instalada del CLI incluida con Desktop no inicia su daemon como paquete
standalone. Mostró el diagnóstico "this CLI has no complete local package" y pidió
usar `--no-daemon`. El modo local `codex --no-daemon --no-alt-screen` sí abrió el
revisor de hooks. No se cambió el sandbox ni se instaló otro CLI.

Para revisar y activar: abrir ese CLI desde SmartFin, entrar en `/hooks`, seleccionar
PreToolUse, revisar la ruta y el comando del único hook del proyecto y confiarlo.
No confiar todos los hooks indiscriminadamente. La confianza se asocia a la
definición exacta; no debe asumirse que verifica los bytes transitivos del script.

**Incompatibilidad para la activación persistente:** esta versión guarda la
confianza de `/hooks` en `~/.codex/config.toml`, bajo `hooks.state`. Además, abrir
el TUI puede guardar preferencias `tui`. Al comprobarlo, se retiraron exclusivamente
esas entradas nuevas y se verificó que el contenido normalizado del archivo coincide
con el auditado antes de la intervención. No queda una modificación global ni se
deja el hook confiado permanentemente. La restricción de no modificar configuración
global impide completar esa activación mediante el revisor normal.

La integración usa el mismo estado nativo de confianza **solo en el proceso de
prueba**, mediante `-c hooks.state=...`, con el hash de la definición revisada fijado
en el harness. App Server lo valida con `--strict-config` y `hooks/list`; no se usa
`--dangerously-bypass-hook-trust`, ni se desactivan verificaciones. Si la definición
no coincide, la integración falla antes de iniciar el turno. Este override nativo
se comprobó con la versión instalada; no se presupone que sea portable a futuras
versiones. El harness verifica además SHA-256 de la configuración global antes y
después. No se propone confiar automáticamente cualquier hash descubierto.

Se añadió el séptimo archivo `codex-integration.cjs` porque hace reproducible esa
validación sin TUI, sin preferencias persistidas y sin comandos destructivos.
No forma parte de la suite automática de comandos simulados; se ejecuta aparte:

```powershell
node .codex/hooks/__tests__/codex-integration.cjs
```

La integración utiliza solo `Write-Output 'DG_INTEGRATION_ALLOWED'` y
`Remove-Item -WhatIf -LiteralPath .codex/hooks.json`. El segundo es inocuo por
`-WhatIf`, pero debe ser denegado por el guard antes de ejecutarse. No quitar
`-WhatIf` al reproducir la comprobación.

La integración real final completó el comando permitido con exit code 0 y
`DG_INTEGRATION_ALLOWED`; el hook denegó el segundo con `DG-FILE`, antes de crear
su proceso. Los eventos nativos registraron 1153 ms y 972 ms de duración del hook.
La configuración global conservó su SHA-256 durante esa integración. El estado
persistente fuera del proceso de prueba continúa siendo **untrusted**; esta entrega
no debe presentarse como protección permanente ya activada.

### Evidencia final (30 de octubre de 2026, America/Bogota)

- Suite completa: **140 pruebas aprobadas, 0 fallos, 0 omitidas**, 80.170 ms totales.
- Sintaxis Node verificada para guard, suite y harness; siete archivos sin errores
  de whitespace ni falta de salto final.
- Latencia del proceso completo guard + parser, cinco muestras:
  **606, 559, 559, 927, 568 ms**. Son muestras locales, no un SLA.
- `hooks/list` sin override: SmartFin tiene un hook de proyecto enabled/untrusted,
  sin warnings ni errores. Un directorio externo consultado no tiene hooks de proyecto.
- `hooks/list` en integración: enabled/trusted, source project, matcher `*`, sync,
  timeout 5 s, hash nativo de definición
  `sha256:f817c22dd8e721c81bc016f46c2a6a4e50960716a2576223cd982a1efbf65da2`.
- Configuración global al finalizar, y sin cambios durante la integración:
  `863b8af0c2ad2e4e444f78f3ec0273e712766e35f4abe86ad6fe9541d07b3e89` (SHA-256).
- No se ejecutaron comandos destructivos reales, adb, migraciones ni consultas
  sobre bases financieras. No se instalaron dependencias ni se hicieron commits/push.

Salida del harness final:

```json
{"allowed":true,"blocked":true,"blockedCommandWasNotExecuted":true,"hookLatencyMs":[1153,972],"ephemeral":true}
{"globalConfigUnchanged":true}
```

## Limitaciones y riesgos pendientes

- Solo se interpretan los eventos de shell (`Bash`, alias `exec_command`) y
  `apply_patch`. Otras herramientas recibidas por matcher `*` no se inspeccionan.
- Herramientas alojadas o especializadas pueden no pasar por hooks. `write_stdin`
  no vuelve a ejecutar PreToolUse para una sesión ya abierta. No dejar sesiones
  interactivas abiertas para operaciones que deberían volver a comprobarse.
- Scripts existentes, npm/npx, ejecutables externos, perfiles, aliases ya definidos,
  hooks de Git y dependencias pueden ejecutar efectos no visibles en argv. El guard
  no es una frontera contra código hostil ni contra el usuario del equipo.
- Se protege la integridad de archivos reconocidos, no la confidencialidad: no se
  bloquean lecturas de secretos ni se certifican operaciones remotas o exfiltración.
- Las identidades Android evitan confundirlas con producción; no prueban que nadie
  haya importado datos reales dentro de un paquete designado para pruebas.
- Si Node no arranca, falta el script, hay un fallo fatal o expira el timeout externo,
  Codex puede continuar sin una denegación. Los errores atrapados dentro del guard
  producen deny explícito; no se promete fail-closed ante fallos del host.
- Las rutas del runtime/checkout pueden caducar tras actualizaciones. Repetir carga,
  confianza, prueba inocua de denegación y latencia después de moverlas o actualizar Codex.
- Hay bloqueos conservadores (checkout, borrados fuera de directorios generados,
  código inline). Para ampliar cobertura debe añadirse un caso, su regla y pruebas;
  no conviene relajar reglas generales para una excepción.

## Desactivar o mantener con seguridad

Sin modificar configuración global: detener los agentes, cerrar sus sesiones y,
desde un editor local, renombrar `.codex/hooks.json` a `.codex/hooks.disabled.json`.
Codex deja de descubrir ese origen al abrir una sesión nueva; se conservan sus
bytes y los hooks de plugins. Para recuperarlo, restaurar el nombre y repetir
pruebas, revisión de confianza e integración. No se realizó ese renombrado durante
esta entrega.

Si se autoriza usar el estado persistente nativo de Codex:

1. Detener el trabajo del agente y cerrar terminales persistentes.
2. Desde un CLI local en SmartFin, abrir `/hooks`, seleccionar únicamente este
   PreToolUse del proyecto y desactivarlo. No usar `features.hooks=false` global,
   ni `--dangerously-bypass-hook-trust` ni desactivar hooks de plugins.
   Este mecanismo también persiste estado en la configuración global; usarlo solo
   cuando ese cambio específico esté autorizado. En el estado entregado no hay
   confianza persistente que retirar. En una sesión de prueba basta cerrar su
   App Server para que desaparezca el override temporal.
3. Confirmar en el listado que quedó inactivo y asumir que ya no protege operaciones.
4. Para mantenimiento, editar solo sus archivos desde el editor local, ejecutar la
   suite y revisar los cambios. Reactivar y revisar confianza mediante `/hooks`.
5. Repetir las dos operaciones inocuas de integración antes de reanudar trabajo.

No es necesario borrar archivos, restaurar Git ni alterar las bases para desactivarlo.
