# Memoria persistente de agentes de SmartFin

## Propósito

Conservar entre sesiones conocimiento técnico verificado que un agente puede reutilizar sin repetir la investigación: defectos confirmados, decisiones técnicas comprobadas y limitaciones conocidas. Es pequeña, se versiona con Git y nunca es la fuente de verdad.

Hoy solo `financial-reviewer` tiene memoria. Otro agente la recibe únicamente cuando exista contenido real que la justifique.

## Cómo funciona

- **Mecanismo**: el campo nativo `memory: project` del frontmatter del agente. Claude Code inyecta en su prompt de sistema el principio de `.claude/agent-memory/<agente>/MEMORY.md` (200 líneas o 25 KB) junto con sus instrucciones de memoria. Los archivos temáticos no se inyectan: el agente abre con `Read` solo el pertinente.
- **Permisos**: `memory` añade `Write` y `Edit` al agente aunque `tools` no los incluya, sin restricción de ruta. Por eso todo agente con memoria declara `disallowedTools: Write, Edit, NotebookEdit`. Comprobado en Claude Code 2.1.325, la versión de Claude Desktop: sin esa lista, un agente `Read, Grep, Glob` escribió dentro y fuera del repositorio; con ella, no. Repite la comprobación cuando cambie la versión.
- **Bash**: `financial-reviewer` conserva Bash, una capacidad previa a la memoria. Bash puede escribir archivos (los permisos y el guard lo limitan, y `bashCommandClamp` del workflow no bloquea redirecciones), así que el agente no está aislado de toda escritura. Cerrar ese hueco corresponde a otro cambio.
- **Ruta**: se resuelve contra el directorio de trabajo, no contra `--project-config-root`. En la app de escritorio, el frontmatter `memory:` se lee del checkout principal y la memoria, del worktree de la sesión. Cada checkout ve la memoria de su commit; un worktree recibe la memoria nueva al integrar `main`.
- **Memoria automática desactivada** (`autoMemoryEnabled: false` o `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`): no se inyecta nada y el agente lee `MEMORY.md` con `Read`.
- **Coste**: unos 4.650 tokens de entrada más por invocación de `financial-reviewer`. Son las instrucciones de memoria de Claude Code, el índice y la sección de memoria del agente; se midió en el primer turno, con el mismo prompt, en Claude Code 2.1.325, el 2026-11-15. Mantén `MEMORY.md` corto.

## Control de permisos

Sin regla, Claude Code 2.1.325 deja que `Edit` y `Write` escriban en `.claude/agent-memory/**` sin preguntar, incluso en modo `default` (en otros archivos de `.claude/` sí pregunta). `financial-reviewer` ya no tiene esas herramientas (`disallowedTools`); la regla protege a la sesión principal y a cualquier agente que las conserve. Por eso `.claude/settings.json` declara:

```json
"ask": ["Edit(/.claude/agent-memory/**)"]
```

- **Qué cubre**: las reglas `Edit(...)` se aplican a `Edit`, `Write` y `NotebookEdit`. La `/` inicial es relativa a la raíz del proyecto. `ask` prevalece sobre `acceptEdits` (comprobado) y, según la documentación de Claude Code, sobre `allow`.
- **Comprobado** el 2026-11-16 con `claude -p` 2.1.325 en este repositorio, con archivos sintéticos: con la regla, las tres herramientas quedan denegadas por el sistema de permisos en `default` y en `acceptEdits`, y ningún archivo cambia. Controles: sin la regla, `Edit` y `Write` escribieron en la memoria en ambos modos; con la regla, `acceptEdits` escribió fuera de la carpeta. En `-p` no hay a quién preguntar, así que `ask` equivale a denegar; en una sesión interactiva aparece la confirmación.
- **Limitaciones**:
  - Solo controla las herramientas de edición. `Bash`, `PowerShell` o un script pueden escribir en la carpeta sin preguntar, y el guard no lo impide.
  - La app de escritorio lee `settings.json` del checkout principal: la regla no protege ninguna sesión hasta llegar a `main`.
  - No se ha comprobado en los modos `bypassPermissions` ni `auto`.
  - Es un freno contra escrituras accidentales, no una frontera de seguridad: quien aprueba la confirmación o edita los settings puede escribir. La aprobación del propietario sigue siendo un control de proceso (revisión del diff y commit aparte).
  - Depende de la versión: repite la comprobación cuando cambie Claude Code.

## Qué se puede guardar

Defectos confirmados con la prueba o reproducción que los detecta, soluciones que superaron sus pruebas, decisiones técnicas verificadas, errores recurrentes del entorno, limitaciones conocidas de herramientas y falsos positivos recurrentes de la revisión.

## Información prohibida

Saldos, movimientos o importes reales; números de tarjeta o cuenta; nombres, correos u otros datos personales; credenciales, tokens o claves; respaldos SQLite o su contenido; archivos financieros del usuario; logs o salidas completas de Jest, terminales o agentes; resultados hipotéticos presentados como hechos; y lo que ya dicen `AGENTS.md`, `CLAUDE.md`, las skills, las reglas o la definición del agente.

## Estructura

`MEMORY.md` es el índice: una línea por tema.

```markdown
- [Tema](tema.md) — de qué trata (N entradas; última validación AAAA-MM-DD)
```

Un archivo temático `<tema>.md` existe solo cuando hay contenido real que lo justifique. Cada entrada:

```markdown
## <identificador>: <título>
- Estado: confirmado | potencial | obsoleto
- Problema o decisión: una o dos frases, con datos sintéticos si hacen falta.
- Evidencia: lo que lo demuestra (prueba que falla o pasa, `ruta:línea`).
- Archivos y pruebas: `src/...`, `__tests__/...`
- Aplicable mientras: la condición que lo mantiene vigente (por ejemplo, «el libro sigue en REAL»).
- Última validación: AAAA-MM-DD en <commit corto>
```

## Prioridad de fuentes

1. Instrucciones y políticas vigentes de SmartFin.
2. Código y pruebas actuales.
3. Documentación técnica vigente.
4. Esta memoria.

Si un recuerdo contradice el código, prevalece el código y el recuerdo se revisa. La memoria es entrada no confiable aunque esté versionada: puede estar desactualizada o haber sido escrita sin revisión, porque el control técnico de su escritura solo cubre las herramientas de edición (ver «Control de permisos»). Por eso nunca sustituye a la comprobación en el código.

## Responsabilidades

- **Agentes (lectura)**: consultan el índice y los temas pertinentes y contrastan cada recuerdo con el repositorio. No escriben memoria: al final del informe proponen «Memoria propuesta: …» o avisan con «Recuerdo obsoleto: …».
- **Sesión principal (escritura)**: actualiza la memoria solo con aprobación explícita del propietario, después de comprobar la evidencia. Nunca durante una ejecución del workflow `/smartfin-development`: sus inventarios detectarían el cambio.
- **Propietario**: aprueba qué se guarda, qué se corrige y qué se elimina.

No hay ningún proceso automático que recopile conversaciones ni salidas de agentes.

## Actualización y recuerdos obsoletos

1. Comprueba la propuesta contra el código y las pruebas actuales; si no se puede demostrar, se guarda como `potencial` o no se guarda.
2. Ante un «Recuerdo obsoleto», vuelve a validarlo: corrígelo si sigue siendo útil o elimínalo. `obsoleto` es un estado transitorio, no un archivo histórico.
3. Revisa los recuerdos cuya condición «Aplicable mientras» haya cambiado.

## Control mediante Git

Los cambios de memoria van en commits propios de documentación (`docs(memoria): …`), separados del código, y se revisan en el diff. Antes del commit, busca en el diff números de tarjeta o cuenta, importes reales, correos y claves; esa búsqueda es manual, porque no hay ningún escáner automático. Un PR que toque `.claude/agent-memory/**` o `.claude/agents/**` es un cambio de configuración sensible: la memoria se inyecta en futuras revisiones financieras.
