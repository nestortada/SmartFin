---
paths:
  - ".claude/skills/**"
  - ".agents/skills/**"
---

# Skills: una fuente y dos copias

Al crear o cambiar una skill:

- Edita solo `.claude/skills/`, que es la fuente. `.agents/skills/` es la copia para Codex y no se edita a mano.
- Después de editar, ejecuta `npm run skills:sync` y comprueba con `npm run skills:check`. La CI falla si las copias difieren, y el hook `Stop` lo recuerda.
- Si actualizas una skill de terceros listada en `skills-lock.json`, el cambio debe quedar primero en `.claude/skills/`; si no, la sincronización lo revierte.
- Una skill describe el código vigente: contrasta cada afirmación con el código y las pruebas y fecha las observaciones históricas. No conserves notas de auditorías antiguas que ya no son ciertas.
- Mantén `SKILL.md` breve y lleva el detalle a `references/`, enlazado desde la tabla o la sección que lo necesita.
- Las rutas de proyecto citadas se escriben relativas a la raíz y deben existir.
