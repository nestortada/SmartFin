# Fuentes, versiones y trazabilidad

Consulta de referencia: **2026-11-01 (America/Bogota)**. Se seleccionan versiones identificadas, no se afirma que sean siempre las últimas. Documentación web sin release se identifica como edición viva consultada ese día; antes de una auditoría nueva verifica versión, enlaces y contenido. No subas información privada al consultar estas fuentes.

## Estándares principales

| Fuente oficial / versión usada | Uso en SmartFin |
|---|---|
| [OWASP MASVS 2.1.0](https://github.com/OWASP/masvs/releases/tag/v2.1.0), [grupos de controles](https://mas.owasp.org/MASVS/) | Marco de almacenamiento, criptografía, acceso, red, plataforma, código, resiliencia y privacidad. Seleccionar controles por amenaza; no declarar conformidad completa |
| [OWASP MASTG 2.0.0, anuncio oficial](https://mas.owasp.org/news/2026/07/04/mastg-v200-release/), [guía viva](https://mas.owasp.org/MASTG/) | Elegir prueba concreta y plataforma; su publicación no autoriza instrumentación/ataques reales |
| [OWASP MASWE 1.0.0, anuncio oficial](https://mas.owasp.org/news/2026/08/17/maswe-v100-release/), [catálogo vivo](https://mas.owasp.org/MASWE/) | Clasificar debilidad y enlazar control/prueba verificados. Revalidar ID/título/estado; no tratar borradores históricos como controles completos |

La cadena de evidencia será `amenaza → control MASVS seleccionado → debilidad MASWE verificada → prueba MASTG aplicable → archivo/configuración → resultado/limitación`. Esta entrega ofrece procedimientos; no ejecuta una evaluación completa de esos catálogos.

| Área SmartFin | Grupo MASVS que consultar | Evidencia local mínima |
|---|---|---|
| SQLite, auxiliares, copia y logs | STORAGE / PRIVACY | Apertura, captura, destinos y pruebas de exposición |
| PIN y Keystore | AUTH / CRYPTO | Derivación/cifrado, parámetros de clave y ciclo de acceso |
| Gemini/voz/SAF | NETWORK / PRIVACY | Datos salientes, autorización, proveedor y errores |
| Manifest, permisos, intents, capturas | PLATFORM | Variante, API y componentes alcanzables |
| Parser IA y dependencias | CODE | Validación local y rutas/versiones afectadas |
| Firma/dispositivo comprometido | RESILIENCE / CODE | Artefacto y amenaza concreta; no exigir antirroot como solución universal |

## Guías técnicas oficiales

- [Android Keystore](https://developer.android.com/privacy-and-security/keystore), edición web viva: custodia/uso de claves; no atribuir hardware o autenticación de uso sin comprobarlos.
- [Android Auto Backup](https://developer.android.com/identity/data/autobackup), edición viva: contrastar reglas por API y cloud/D2D/OEM.
- [Android application manifest](https://developer.android.com/guide/topics/manifest/application-element), edición viva: revisar atributos efectivos de variante y nivel API.
- [Android actividades sensibles](https://developer.android.com/security/fraud-prevention/activities), edición viva: evaluar `FLAG_SECURE` y límites, sin prometer protección absoluta.
- [React Native Security 0.85](https://reactnative.dev/docs/0.85/security): versión alineada con RN 0.85.3 del proyecto; las variables de compilación no son secretos del servidor. Revalidar recomendaciones Android de librerías antes de adoptarlas.
- [SQLite Security](https://sqlite.org/security.html), edición viva sin versión de motor fijada: base para revisar entradas no confiables; las APIs/restricciones propuestas deben existir en SQLite/driver Android objetivo.
- [npm audit v8](https://docs.npmjs.com/cli/v8/commands/npm-audit/), referencia de semántica de envío/instalación: verificar la versión npm instalada antes de ejecutar comandos; esta entrega no ejecutó audit ni audit fix.

## Normativa colombiana y limitación de consulta

- [Ley 1581 de 2012, Gestor Normativo oficial](https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981): localización confirmada por búsqueda oficial; la descarga íntegra falló (502).
- [Decreto 1074 de 2015, Gestor Normativo](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=76608): fuente prevista para verificar el régimen compilado; recuperación íntegra falló por timeout/502.

No se verificó texto consolidado completo, modificaciones ni aplicabilidad jurídica a un tratamiento específico. Estas fuentes son el punto de partida de una revisión posterior, no evidencia suficiente de vigencia integral ni cumplimiento. Antes de concluir, consultar fuentes oficiales actualizadas (Gestor Normativo/SUIN/SIC) y documentar roles, destinatarios y alcance.

## Descubrimiento de skills

[OpenAI, Build skills](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) indica `.agents/skills/` para repositorios; se consultó la sección mediante la herramienta oficial de documentación. [Claude Code, Skills](https://code.claude.com/docs/en/skills) describe `.claude/skills/` y `SKILL.md`. Documentación viva contrastada con CLI local `codex-cli 0.166.0` y Claude Code `2.1.316`; no se lanzó una sesión nueva para probar selección automática.

Esta skill usa únicamente `name` y `description` en frontmatter YAML, sin permisos de herramienta, hooks ni sintaxis exclusiva de un agente. La copia de distribución debe ser física e idéntica. No crear otra en `.codex/skills/`: el proyecto ya muestra nombres duplicados de otras skills en el catálogo, lo que no justifica duplicar ésta.
