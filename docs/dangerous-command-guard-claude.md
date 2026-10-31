# dangerous-command-guard en Claude Code

Configuración local de SmartFin para Claude Code 2.1.218 en Windows, sin dependencias
nuevas ni modificaciones de configuración global o del hook de Codex.

## Implementación

- `.claude/settings.json`: registra un handler síncrono PreToolUse de 6 segundos.
- `.claude/hooks/dangerous-command-guard.cjs`: adapta eventos de Bash, PowerShell,
  Write, Edit y MultiEdit al evaluador existente en `.codex/hooks/`.
- `.claude/hooks/__tests__/dangerous-command-guard.test.cjs`: pruebas simuladas y
  del proceso Node real; no ejecutan los comandos que contienen.

El adaptador importa el guard de Codex: las reglas Git, SQLite, Android, destinos
generados y excepciones sintéticas tienen una única fuente de verdad. La protección
de `.claude/` y `CLAUDE.md` se añade traduciendo esos destinos al ámbito protegido
equivalente para la evaluación. Ninguna traducción altera el comando real.

Write/Edit se validan como patches sintéticos. Bash se tokeniza como un subconjunto
literal, se convierte a argv citado de PowerShell y se evalúa sin ejecutarlo. No se
interpreta Bash como si fuera PowerShell. Se permiten comandos ordinarios como
`git status`, `git diff`, `npm test`, cadenas literales y texto citado.

Se deniegan expansiones, globbing, redirecciones Bash, escapes ambiguos, agrupación,
asignaciones y wrappers como env/eval/xargs/find; requieren revisión separada. Hay
falsos positivos conservadores. Se conserva la limitación del núcleo respecto a
efectos internos de scripts en archivo y ejecutables externos. Herramientas que no
coincidan con el matcher, NotebookEdit, agentes remotos y operaciones externas no
están cubiertos. No es un sandbox ni una protección completa contra código hostil.

Éxito: exit 0 sin stdout. Bloqueo: JSON `hookSpecificOutput` con
`hookEventName: PreToolUse`, `permissionDecision: deny` y motivo. Las entradas
malformadas o demasiado grandes se deniegan. Un fallo fatal del host puede dejar
pasar la herramienta; no se configura `onFailure`, que requiere una versión posterior
a la instalada. El guard no lee bases financieras ni guarda logs propios.

## Validación y activación

```powershell
node --test .claude/hooks/__tests__/dangerous-command-guard.test.cjs
```

En la entrega inicial, `claude auth status` indicó `loggedIn: false`, por lo que
entonces solo pudo validarse el adaptador. Posteriormente el usuario inició sesión;
la integración autenticada está acreditada en la sección de la excepción Android.
No se han cambiado credenciales ni desactivado verificaciones.

Resultado de esta entrega: **24 pruebas aprobadas, 0 fallos, 0 omitidas** (10,53 s),
incluidas entradas Bash, PowerShell anidado, Write/Edit y protocolo del proceso.
`node --check` pasó y `claude doctor` no encontró problemas de instalación.
La invocación real de integración terminó con `Not logged in · Please run /login`,
sin ejecutar las sondas (0 tokens y 0 coste reportados). No se declara que el hook
ya haya bloqueado una herramienta dentro de Claude. Los SHA-256 de la configuración,
guard y política de Codex se conservaron.

Tras iniciar sesión en Claude Code y abrir SmartFin, aceptar la confianza del
proyecto si se solicita y revisar `/hooks`. Debe aparecer PreToolUse con el comando
Node de este adaptador. Abrir una sesión nueva si Claude ya estaba abierto al crear
la configuración; las sesiones pueden conservar su snapshot de hooks.

Prueba inocua recomendada, con dos llamadas separadas a la herramienta Bash:

1. `echo DG_CLAUDE_ALLOWED` debe ejecutarse.
2. `powershell.exe -NoProfile -Command "Remove-Item -WhatIf -LiteralPath .claude/settings.json"`
   debe ser bloqueada. Conservar siempre `-WhatIf`.

No usar bypass de permisos ni modo bare/safe-mode para verificar el hook, porque
pueden desactivar personalizaciones. La ruta Windows está fijada a este checkout;
si se mueve hay que ajustarla y repetir pruebas. No borrar `.codex/hooks/`: el
adaptador depende de ese núcleo compartido.

Para desactivarlo solo en Claude, cerrar las sesiones y retirar únicamente esta
entrada PreToolUse desde el editor local. Preservar otros hooks que se añadan en
el futuro. No hace falta cambiar la configuración global ni las bases.

Referencia oficial: [Hooks de Claude Code](https://code.claude.com/docs/en/hooks) (ubicación de settings,
contrato PreToolUse, revisión de confianza y compatibilidad de Windows).

## Excepción sintética de Android (30 de octubre de 2026)

Se conservan íntegros el núcleo `.codex/hooks/`, ambos registros de hooks y las
reglas generales. El adaptador importa `synthetic-emulator.cjs` antes de delegar
al núcleo. Las denegaciones originales eran DG-OPAQUE (Start-Process general en
el núcleo) y DG-CLAUDE (expansión $ANDROID_HOME en el adaptador Bash).

### Aislamiento acreditado antes de autorizar la forma del comando

El AVD `SmartFin_Atomicity_API24` sigue excluido por procedencia desconocida.
Se creó `SmartFin_Guard_Synthetic_API24` en una ruta antes inexistente, usando
avdmanager ya instalado, sin --force, a partir de `system-images;android-24;google_apis;x86_64`
revisión 27 y perfil pixel_2. No se copiaron imágenes desde otro AVD, no se
instalaron APK, no se ejecutó adb ni se inició el emulador.

El directorio nuevo solo contiene config.ini y userdata.img. El SHA-256 de
userdata.img coincide con la plantilla inicial del SDK:
`0a7e2895dd1077cb45b89794f182e0e35284f2fae5611bada0e25416b6cadea9`.
El verificador rechaza symlinks, junctions, enlaces físicos, archivos adicionales
de ejecución y raíces Android redirigidas mediante variables de entorno.
Comprueba los hashes fijados del ejecutable, registro del AVD, configuración y
datos iniciales. No lee filas SQLite ni abre los discos del AVD anterior.

**Alcance deliberado: primer arranque del AVD fresco.** Si aparece estado de
ejecución, cambian imágenes/configuración, o se actualiza el ejecutable, la
excepción deja de autorizarlo. No hay recertificación automática después de
importaciones o arranques. Para posteriores campañas se necesita revisar y
acreditar de nuevo su procedencia; el nombre por sí solo nunca concede permiso.
Esto acredita la creación desde la plantilla instalada, no una auditoría forense
ni una defensa frente a manipulación del SDK por el usuario del equipo.

### Formas literales reconocidas (no ejecutadas durante esta entrega)

Bash:

```bash
"C:/Users/nesto/AppData/Local/Android/Sdk/emulator/emulator.exe" -avd SmartFin_Guard_Synthetic_API24 -no-boot-anim -no-snapshot
```

PowerShell:

```powershell
Start-Process -FilePath 'C:/Users/nesto/AppData/Local/Android/Sdk/emulator/emulator.exe' -ArgumentList '-avd SmartFin_Guard_Synthetic_API24 -no-boot-anim -no-snapshot' -WindowStyle Hidden
```

Solo se aceptan esas formas exactas en su herramienta correspondiente, tras
verificar aislamiento. No se permite Start-Process globalmente. Se deniegan
variables, sustituciones, redirecciones, cadenas, otros AVD o ejecutables y
cualquier argumento adicional, incluidos -wipe-data, -snapshot, -no-snapshot-save,
-data, -datadir, -initdata, -snapstorage y -qemu. `-no-snapshot` evita cargar y
guardar Quick Boot; no es una excepción para borrar snapshots financieros.
La detección de menciones de emulator/-avd es conservadora y puede rechazar
consultas o textos que los incluyan. No pretende ser un parser general del launcher.

### Validación

```powershell
node --test .claude/hooks/__tests__/dangerous-command-guard.test.cjs .claude/hooks/__tests__/synthetic-emulator.test.cjs
```

Todos los lanzamientos se entregan como cadenas al evaluador. Los tests nunca
ejecutan el Emulator. Se comprueban aceptación sintética, variantes peligrosas,
fallos del verificador y conservación de las reglas Git/SQLite/Android.
Resultado: 50 pruebas del adaptador aprobadas, sin fallos ni omisiones.
La suite del núcleo de Codex pasó 140 pruebas sin cambios. En integración inocua,
Codex permitió un marcador y bloqueó Remove-Item -WhatIf sobre su configuración.
Claude permitió `echo DG_CLAUDE_FIX_ALLOWED` y bloqueó el intento equivalente sobre
`.claude/settings.json` con DG-FILE, con origen de denegación hook. La sesión de
Claude utilizada informó versión 2.1.316. No se concedieron permisos globales ni
se desactivaron hooks. Las configuraciones y archivos del núcleo mantienen sus hashes.

El primer arranque real se autorizó y completó posteriormente; las campañas,
instalaciones y escrituras siguen pendientes de verificación y autorización.

## Consultas ADB de solo lectura tras el primer arranque

El primer arranque fue autorizado y completado posteriormente. Esta corrección
no reinicia el AVD ni amplía sus permisos de escritura.

### Diagnóstico previo, realizado sin editar archivos

`checkLaunch` usaba `\bemulator(?:\.exe)?\b`, que también coincidía con el prefijo
del serial `emulator-5554`. El adaptador devolvía DG-CLAUDE-EMULATOR antes de que
ADB llegara al núcleo. El núcleo compartido ya admitía get-state y getprop; ese
bloqueo concreto no era suyo. Además, el núcleo tiene permisos ADB más amplios que
las consultas aquí acordadas: no sería seguro omitir el clasificador y delegar
cualquier comando por contener un serial reconocido.

### Corrección y alcance

`readonly-adb.cjs` clasifica llamadas ADB reales mediante el AST antes de comprobar
lanzamientos. La expresión de lanzamientos distingue ahora tokens emulator de
seriales emulator-N. No cambia el núcleo compartido ni los registros de hooks.

En Claude solo se permiten llamadas directas, únicas, literales, sin expansión,
redirecciones, cadenas ni contexto dinámico:

```text
adb devices -l
adb -s emulator-5554 get-state
adb -s emulator-5554 shell getprop
adb -s emulator-5554 shell getprop <una-propiedad-literal>
```

La propiedad no admite valores adicionales ni metacaracteres. Se comprueba el
ejecutable SDK fijado, su SHA-256 y ausencia de enlaces; para nombres bare se
comprueba la resolución PATH y se rechazan shims encontrados antes de adb.exe.
Las rutas desconocidas se deniegan. Esto no certifica perfiles o aliases externos
del shell ni constituye una frontera contra manipulación del host.

El serial es un destino de consulta, no prueba permanente de identidad ni permiso
de escritura. Un serial desconocido no obtiene la excepción. Cadenas que llamen
a ADB, intérpretes anidados y runners que reciban el serial explícito no obtienen
permisos por la eliminación del falso positivo. Imprimir el serial como texto
literal sí se permite. No se permite Start-Process ni un shell de forma general.

### Runners: escrituras pendientes

Se inspeccionó `scripts/phase6b2/run-android.ps1` y su apoyo UI. Además de getprop y
consultas de estado, el runner necesita instalación, limpieza del paquete de
pruebas, permisos/appops, force-stop, arranque de campañas, input, extracción de
resultados y logs. `uiautomator dump` también escribe un archivo en el dispositivo.
No se autorizó ninguna de esas operaciones mediante esta corrección.

El runner declara `com.smartfin.snapshot5b2.tests`, comprueba hashes de fuentes/APK,
UID diferente del de producción y ruta de base
`/data/(user/0|data)/com.smartfin.snapshot5b2.tests/databases/phase5b2_synthetic.db`.
Eso describe sus controles existentes, no acredita una instalación actual ni
aprueba ejecutarlo. Antes de habilitar escrituras hacen falta identidad vigente
del AVD, APK/UID/base aislados y revisión de la versión exacta del runner y sus
dependencias. No se instaló APK ni se ejecutó campaña para verificarlo.

El hook no intercepta automáticamente llamadas internas de scripts ya lanzados.
Se conserva ese límite del guard original; no hay una nueva excepción para
scripts ni para runners. Las escrituras ADB directas están denegadas incluso
con el serial correcto y un nombre de paquete sintético.

### Pruebas y evidencia

```powershell
node --test .claude/hooks/__tests__/dangerous-command-guard.test.cjs .claude/hooks/__tests__/synthetic-emulator.test.cjs .claude/hooks/__tests__/readonly-adb.test.cjs
```

Se conservan las pruebas anteriores, sin omitir casos. Las pruebas de primer
arranque modelan ahora el estado fresco de forma simulada y comprueban que el AVD
real ya arrancado no vuelve a ser elegible; el verificador de producción no se
desactiva ni se sustituye. Los comandos peligrosos son solo cadenas de prueba.

En integración real con Claude se ejecutaron cinco consultas separadas, sin
denegaciones: devices -l, get-state, nombre de AVD, API y boot_completed. Resultados:
`device`, `SmartFin_Guard_Synthetic_API24`, `24`, `1`. Las mismas consultas funcionaron
desde Codex. Las sondas Remove-Item -WhatIf sobre las respectivas configuraciones
continuaron bloqueadas con DG-FILE. No se consultaron bases ni se modificó el AVD.
El núcleo, su política y los registros de ambos hooks conservan sus hashes.

Resultado final de esta corrección: **97 pruebas del adaptador y 140 del núcleo
aprobadas**, sin fallos ni omisiones. No se instalaron APK, ejecutaron campañas,
reiniciaron dispositivos ni habilitaron escrituras de runners.

## Excepción del runner 6B.2 en API 24 (30 de octubre de 2026)

Autoriza exclusivamente, en la herramienta PowerShell y con cwd en este checkout:

```powershell
./scripts/phase6b2/run-all.ps1 -Serial emulator-5554 -Api 24
```

Módulo: `.claude/hooks/phase6b2-runner.cjs`, invocado por el adaptador antes de las
consultas ADB. El núcleo `.codex/hooks/` no cambia. **Estado: preparado y probado
en `build/claude-hooks/`; su instalación en `.claude/hooks/` la hace el usuario**,
porque el propio guard protege con DG-FILE sus archivos frente a escrituras del agente.

### Auditoría del runner

- `run-all.ps1` comprueba solo la API, fija el paquete `com.smartfin.snapshot5b2.tests`
  y por cada caso llama a `run-android.ps1` y, en los casos UI, a `ui.cjs`. Escribe en
  `docs/correccion-fase6b2/android/api24/<caso>`; omite casos aprobados y renombra
  intentos previos a `-attempt-HHmmss` (no borra). Al terminar hace force-stop del paquete de pruebas.
- `run-android.ps1`: mutex por serial; verifica `originalHashes` (checkout) y `hashes`
  (harness) de la atestación; badging del APK con aapt (paquete sintético, no depurable);
  atestación embebida idéntica; instala `-r` solo si el MD5 instalado difiere; UID de
  pruebas distinto del de `com.smartfin`; `pm clear`, appops, force-stop, `rm -f` del
  resultado, `am start`, logcat, `pull`, siempre sobre el paquete de pruebas y con `-s`.
  Lee `com.smartfin` solo con `dumpsys` y falla si sus metadatos cambian. Al final exige
  UID y base `/data/(user/0|data)/com.smartfin.snapshot5b2.tests/databases/phase5b2_synthetic.db`.
- `ui.cjs`: serial y API en lista cerrada; `uiautomator dump` en el almacenamiento del
  paquete de pruebas, `cat`, `screencap`; escribe en `api24/ui/`.
- Dependencias: `adb` y `node` resueltos por PATH, `aapt.exe` de build-tools 36.0.0 vía
  `ANDROID_HOME`, harness `C:/sf-6b2r-20261030` (fuera del repo, con junction
  `node_modules` al checkout) y su APK release.
- En el AVD no están instalados ni `com.smartfin` ni el paquete de pruebas. No había
  campañas, runners ni `ui.cjs` en ejecución; el HONOR `AXCC6R3919012932` está conectado
  pero sin campañas, y el runner nunca lo usa sin `-s`.
- **Hueco previo cerrado**: el guard permitía `./scripts/phase6b2/run-all.ps1` sin
  argumentos (cuyos valores por defecto son `emulator-5554`/API 24), `run-android.ps1`,
  otros runners `.ps1`, `pwsh -File …` y `node scripts/phase6b2/ui.cjs`. Ahora toda
  mención de un `.ps1` o de `ui.cjs` se deniega salvo el comando exacto o lectores
  (git, Get-Content, cat, Select-String, rg, Get-FileHash…), que siguen delegando al núcleo.

### Condiciones verificadas en cada invocación (fallo cerrado)

| Comprobación | Valor fijado |
|---|---|
| `run-all.ps1` | `f83b4099ad5e47d5de1e9874a8c87d28f6ca7e5fa4ad4bd11ca6dfe9a7a3e23c` |
| `run-android.ps1` (con el fix de primera instalación; antes `0c382bb1…828b`) | `3004dd0d94bb7e706ffbefac901e854f16173ac2901f8ecadc31c88ba2fc40a0` |
| `ui.cjs` | `fd0e918fa1ea15727a6744f469b7c39d76fc776a33b942dbabeb0eef914e6423` |
| `source-fingerprints.json` (355 originales, 359 preparados, paquete y workspace) | `df3e620bc751c36bb8f0c8fa51dd6061ddd87fd4c5555752f7cf8a62a5ae3388` |
| `app-release.apk` (33 026 004 B; embebe exactamente la atestación; mismo APK de la evidencia API 35) | `85af989be11c7a79c81e3b38c06905b4064f52648d5170f6a6ab1022ad0e42f6` |
| `adb.exe` | `b4a6b455702684652cccf7b46258b29e653538904359a58fd4931cf3ef286b3f` |
| `node.exe` | `b3094d0b49f9ad602262a9921551737bb97637c05dd357a06ae98188d7290aa3` |
| `aapt.exe` | `c528418af0c5152650d9532485f371e8eed98e1436d1ab1a197580b97917b561` |
| AVD `.ini` / `config.ini` | `ee3d8cbc…d278` / `998d8ef4…12af` (recibo del primer arranque) |

Además: Windows, cwd igual al checkout, sin enlaces en las rutas fijadas; todas las
fuentes atestadas coinciden en checkout y harness; `ANDROID_HOME` es el SDK fijado y no
existen `ADB_SERVER_SOCKET`, `ANDROID_ADB_SERVER_*`, `ANDROID_SERIAL`, raíces AVD
redirigidas ni `NODE_OPTIONS`; `adb` y `node` resuelven por PATH a los ejecutables
fijados sin shims `.ps1/.cmd/.bat/.com` previos; no hay `adb.exe` en el checkout, la
carpeta de Node ni `C:/Windows(/System32)`; no existen perfiles de PowerShell en las
rutas estándar; la salida `api24` no existe o solo contiene evidencia de casos del
runner, `ui` y `compare.json`, sin enlaces.

Solo si todo lo anterior pasa, el hook hace tres consultas de solo lectura con el adb
fijado (2 s de timeout cada una): `devices -l` (exactamente un `emulator-5554` en estado
`device`, producto `sdk_google_phone_x86_64`), `shell getprop` (`ro.kernel.qemu=1`,
`avd_name`, API 24, producto y `ro.build.fingerprint`
`Android/sdk_google_phone_x86_64/generic_x86_64:7.0/NYC/6696031:userdebug/dev-keys`) y
`emu avd name`, que responde desde el proceso del emulador y no desde la imagen invitada:
`SmartFin_Guard_Synthetic_API24`. El serial por sí solo no concede nada.

Diagnóstico de solo lectura (no lanza el runner): `node .claude/hooks/phase6b2-runner.cjs`.
Resultado el 30/10/2026: `authorized: true`, sin fallos; decisión del adaptador en 0,9 s.

### Pruebas (en `build/claude-hooks/`, sin ejecutar runner, adb ni Android)

`phase6b2-runner.test.cjs` usa un harness temporal con hashes propios y un dispositivo
simulado: runner exacto autorizado; cada script del runner, fuentes atestadas, harness,
atestación, APK, aapt/adb/node, AVD, shims de PATH, perfiles, adb en sombra y entorno
ADB redirigido rechazados; serial, AVD, API, imagen o consola incorrectos rechazados;
atestación de `com.smartfin` rechazada; argumentos adicionales, Bash, `&`, dot-source,
cadenas, `pwsh -File`, Start-Process, otros runners y `ui.cjs` denegados; lectores
permitidos; escrituras ADB arbitrarias (también sobre el paquete de pruebas y el HONOR)
y protecciones financieras del núcleo bloqueadas; autorización retirada denegada.
Resultado: **73 nuevas, 97 previas del adaptador y 140 del núcleo aprobadas**, sin
fallos ni omisiones. El núcleo y su política conservan sus hashes.

**Instalada por el usuario el 30/10/2026.** Los hashes en `.claude/hooks/` coinciden con
los probados. Sobre los archivos instalados: 170 pruebas del adaptador (97 + 73) y 140 del
núcleo aprobadas; diagnóstico `authorized: true`. En integración real, la sonda inocua
`pwsh -NoProfile -File scripts/phase6b2/guard-probe-does-not-exist.ps1` fue denegada con
DG-CLAUDE-RUNNER. El runner no se ha ejecutado.

### Primer intento API 24 y fix de primera instalación (30–31/10/2026)

Con autorización del usuario se lanzó el comando exacto. Los 39 casos fallaron en ~17 s
(02:42:51Z–02:43:08Z) en `run-android.ps1:63`: `pm path` del paquete de pruebas, ausente
en el AVD nuevo, sale con código 1 sin salida e `Invoke-SyntheticAdb` lo convierte en
excepción. Desde 5D todos los runners asumían el paquete ya instalado. No llegó a
instalarse el APK ni a ejecutarse `pm clear`, appops, `am start` ni acceso a bases; solo
lecturas `dumpsys` de `com.smartfin` (no instalado en el AVD) y `am force-stop` sin efecto
en los casos UI. Quedaron 78 archivos (`apk-badging.txt` y `runner-error.txt` por caso)
bajo `api24/`, sin cambios fuera de esa carpeta; no se ejecutó el comparador (sin datos).

Fix aprobado por el usuario, solo en esa línea: `pm path` se llama directamente; código
distinto de cero **sin salida** significa «no instalado» y conduce a instalar el APK
atestado; cualquier error con mensaje (dispositivo offline, no autorizado) sigue
deteniendo el runner. Sin escrituras nuevas en el dispositivo ni cambios en las
comprobaciones de paquete, UID, base o producción. El script no forma parte de la
atestación del APK: no hace falta recompilar. El pin del módulo se actualizó en
`build/claude-hooks/phase6b2-runner.cjs`; hasta copiarlo a `.claude/hooks/`, el módulo
instalado deniega el runner modificado (comprobado: `failures: ["runner scripts/phase6b2/run-android.ps1"]`).
Las 39 carpetas fallidas se conservarán renombradas a `-attempt-HHmmss` en el siguiente intento.
SHA-256 del módulo actualizado: `51a111cf5101cd3f9a00b777d40ce18bfbcd56d568be1b9a4c7c635123df19cd`
(adaptador y pruebas sin cambios).

### Segundo intento API 24 (31/10/2026, ~02:48–03:02Z)

Instalado el módulo `51a111cf…` por el usuario, el hook permitió el comando exacto. Con el
fix el APK atestado se instaló y el runner ejecutó los 39 casos: **38 aprobados** y
`phase6a-precision` fallido por la diferencia intencional documentada en
`docs/correccion-fase6b2.md` (sección 8). `compare.cjs 24`: 37 resultados, 0 diferencias
(mismas claves que API 35). Todos los casos: UID de pruebas 10078, base
`phase5b2_synthetic.db`, APK `85af989b…`, `com.smartfin` ausente y metadatos sin cambios.
Las evidencias del intento fallido quedaron byte a byte en las carpetas `-attempt-`.
La vigilancia de integridad no detectó cambios en los archivos auditados durante la campaña.

### Limitaciones

- El hook no ve las llamadas internas del runner; se admiten por los bytes fijados. Se
  verifica al lanzar: `run-android.ps1` y `ui.cjs` se leen de nuevo en cada caso y una
  edición durante la campaña no se detectaría. No editar scripts, harness ni APK mientras corre.
- La identidad del AVD se comprueba al lanzar; durante la campaña el runner solo confirma
  la API. Si el emulador se cerrara y otro ocupara `emulator-5554`, no se detectaría.
- El entorno del hook se asume igual al del proceso PowerShell de la herramienta. No se
  analizan módulos autocargados ni perfiles fuera de las rutas estándar.
- `ui.cjs` sobrescribe `api24/ui/<sonda>.*` al repetir un caso UI no aprobado.
- Cualquier cambio en `src/` atestado, scripts, harness, APK, herramientas o AVD retira
  la autorización hasta repetir auditoría y fijar nuevos hashes; no hay recertificación automática.
- No es un sandbox ni una defensa contra manipulación del equipo por su usuario.

### Instalación (manual, por el usuario)

Copiar desde `build/claude-hooks/` a `.claude/hooks/`: `phase6b2-runner.cjs`,
`dangerous-command-guard.cjs` (solo añade el import y la llamada a `checkRunner`) y
`__tests__/phase6b2-runner.test.cjs`. SHA-256 de lo probado: módulo
`a0db9fc16c835fd044dc4217124a1fb90e7c533388a4307b62d0a7454285d833`, adaptador
`991cca1ae0b3eb2d79afab0ab1748f511437b55f78c6b9544d27aca2483f5475`, pruebas
`dff67e7df695fbfdb9240ab653abbb04f0f1133875d2909bdeb7a50f6a4c13f2`. Abrir una sesión
nueva de Claude y ejecutar:

```powershell
node --test .claude/hooks/__tests__/dangerous-command-guard.test.cjs .claude/hooks/__tests__/synthetic-emulator.test.cjs .claude/hooks/__tests__/readonly-adb.test.cjs .claude/hooks/__tests__/phase6b2-runner.test.cjs
```

### Retirar la autorización

Cambiar `const ENABLED=true;` a `false` en `.claude/hooks/phase6b2-runner.cjs` y abrir
una sesión nueva: el comando exacto se deniega con «authorization is withdrawn» y el
bloqueo de los demás runners se mantiene. Quitar el módulo del adaptador también retira
la excepción, pero reabre el hueco previo de runners sin argumentos; no se recomienda.
