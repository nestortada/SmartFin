---
paths:
  - ".claude/hooks/**"
  - ".claude/agents/**"
  - ".claude/agent-memory/**"
  - ".claude/workflows/**"
  - ".claude/rules/**"
  - ".claude/settings.json"
  - ".codex/**"
  - "CLAUDE.md"
  - "AGENTS.md"
---

# Configuración de agentes: hooks, agentes, workflow y settings

Al cambiar estos archivos:

- **Dónde se activa**: la app de escritorio carga agentes, workflows, hooks y `settings.json` desde el checkout principal (`--project-config-root`), no desde el worktree. Un cambio hecho en un worktree no afecta a ninguna sesión hasta llegar a `main`. Para probarlo antes, usa `claude -p` con el directorio de trabajo en ese worktree.
- **Hooks**: cada hook de `.claude/hooks/` tiene su prueba en `.claude/hooks/__tests__/`. Un hook nuevo añade su archivo de prueba al job `guard-hooks` de `.github/workflows/ci.yml` (corre en Windows) y al paso 4 de `/verificar`. Los recordatorios fallan abiertos y nunca bloquean dos veces seguidas (`stop_hook_active`); solo el guard bloquea si falla (`onFailure: block`).
- **Revisores replicados**: `REVIEWERS` e `IGNORED` de `reviewer-reminder.cjs` están copiados en `REVIEWER_RULES` de `.claude/workflows/smartfin-development.js`. Cambia los dos a la vez: una prueba los compara sobre todos los archivos del repositorio.
- **Dos guards independientes**: `.claude/hooks/dangerous-command-guard.cjs` (Claude Code, v2) y `.codex/hooks/` (Codex, v1) no comparten código ni política. Un cambio en uno no protege al otro; sus contratos están en `docs/dangerous-command-guard-claude.md` y `docs/dangerous-command-guard.md`.
- **Agentes**: las restricciones efectivas son `tools` y `disallowedTools`; comprueba su combinación en el runtime real (`claude -p`), no solo en el frontmatter. Un patrón como `Bash(git status *)` en `tools` no limita Bash, y los `hooks` del frontmatter solo se aplican si la carpeta es de confianza. Los revisores no tienen `Write` ni `Edit`; los que tienen Bash conservan esa capacidad, que sí puede escribir, así que no están aislados de toda escritura. Una `description` que contiene «: » va entre comillas: si no, el YAML es inválido y Claude Code descarta el agente sin avisar.
- **Memoria de agentes**: `memory: project` carga `.claude/agent-memory/<agente>/MEMORY.md` y añade `Write` y `Edit` aunque `tools` no los incluya (comprobado en 2.1.325). Un agente con memoria y función de solo lectura deniega explícitamente `Write, Edit, NotebookEdit` en `disallowedTools`. La memoria no autoriza modificaciones de producción: se actualiza solo con aprobación del propietario y nunca durante el workflow. Sin regla, Claude Code no pide permiso para editar `.claude/agent-memory/**`; por eso `settings.json` declara `permissions.ask` con `Edit(/.claude/agent-memory/**)`, que hace preguntar a `Edit`, `Write` y `NotebookEdit` también en `acceptEdits` (en `claude -p` equivale a denegar). No cubre escrituras por Bash o PowerShell ni rige hasta llegar a `main`, así que la aprobación se sigue controlando con la revisión del diff. Reglas y limitaciones: `.claude/agent-memory/README.md`.
- **Workflow**: es determinista, sin reloj ni aleatoriedad, para que una reanudación repita las mismas llamadas. Actualiza `WORKFLOW_REVISION` al cambiarlo.
- **CLAUDE.md y AGENTS.md**: `AGENTS.md` lo leen Claude Code y Codex; `CLAUDE.md` solo Claude Code. Las reglas comunes del proyecto van en `AGENTS.md`.
- **Permisos**: en `permissions.allow` solo entran comandos de lectura o de verificación local. No relajes `permissions.deny`, que bloquea la lectura de `.env`, claves y bases SQLite, ni retires la regla `permissions.ask` de la memoria de agentes.

Verifica con las pruebas de hooks (`node --test .claude/hooks/__tests__/...`) y, si tocaste skills, con `npm run skills:check`.
