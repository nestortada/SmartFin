---
paths:
  - "docs/*fase*.md"
  - "docs/pendientes-*.md"
  - "docs/validacion-*.md"
  - "docs/INDICE.md"
---

# Documentos de fase: evidencia, no relato

Al escribir o cambiar un documento de fase:

- Sigue la skill `smartfin-phase-delivery` y su plantilla; no omitas «Estado inicial», «Resultados de verificación» ni «Riesgos y decisiones pendientes».
- Copia las cifras reales de los comandos ejecutados (suites, pruebas, omitidas, fallidas, campañas). Si una cifra viene de una suite aislada o de una ejecución anterior, dilo.
- Separa lo validado en Node, lo validado en Android (API 24 y API 35) y lo preparado pero no ejecutado. Un APK compilado o una campaña preparada no es una validación.
- Escribe el veredicto con el estado real y sin adelantar la fase siguiente.
- Añade o actualiza la fila del documento en `docs/INDICE.md`, con el mismo estado que declara el documento.
- Un documento de fase es evidencia histórica: no lo reescribas para que coincida con el código posterior; registra la corrección en el documento nuevo.
