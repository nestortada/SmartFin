# Instalación manual y activación

## Estado de la entrega

La skill está creada y validada en [smartfin-sqlite-architecture/SKILL.md](smartfin-sqlite-architecture/SKILL.md). **No está instalada** en las rutas descubiertas automáticamente. El usuario pidió expresamente staging si las rutas estaban protegidas: `.codex/hooks/dangerous-command-guard.cjs::sensitive` protege todo `.agents` y `.codex`, y el guard Claude también considera esas rutas configuración protegida. No se intentó escribir allí, cambiar políticas ni crear enlaces para evadir el guard.

La carpeta `tmp/smartfin-sqlite-architecture-delivery` es staging autorizado para esta entrega. Contiene el paquete, esta guía y [el informe de validación](VALIDACION.md). Conserva el paquete antes de limpiar temporales.

## Descubrimiento comprobado

| Agente local | Evidencia y ubicación elegida |
|---|---|
| Codex CLI 0.166.0 | `codex --version`; catálogo de esta sesión ya muestra skills de `.agents/skills`. La documentación oficial indica exploración de esa ruta desde CWD hasta raíz y soporte de carpetas enlazadas |
| Claude Code 2.1.316 | `claude --version`; el repositorio ya tiene `.claude/skills`. La documentación oficial indica esa ubicación de proyecto y soporte de enlace de carpeta individual |

Se usó también la skill OpenAI Docs para comprobar instrucciones de descubrimiento. Fuentes oficiales consultadas el 1 de noviembre de 2026: [Codex: Build skills](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) y [Claude Code: Skills](https://code.claude.com/docs/en/skills#choose-where-skills-load). El mismo frontmatter `name`/`description` sirve para selección automática en ambos; no se desactivó ni se concedieron herramientas/permisos desde la skill.

Se verificaron formato y convenciones documentadas para las versiones instaladas. **La detección real de esta nueva skill en los dos hosts queda pendiente de la instalación manual**; no se lanzaron sesiones adicionales ni llamadas a modelos externos para simularla.

## Fuente de verdad compartida recomendada

Tras revisar el paquete, el propietario puede instalarlo desde su terminal PowerShell en la raíz del repositorio. Estas instrucciones son para ejecución manual; el agente no debe ejecutarlas contra rutas protegidas.

1. Comprueba que no exista una skill con el mismo nombre. Si existe, compara contenido y no sobrescribas trabajo previo. Revisa también nombres duplicados en skills de usuario, proyecto y plugins.
2. Copia la carpeta completa a `.agents/skills/smartfin-sqlite-architecture`. Será la fuente canónica persistente para Codex.
3. Si Windows permite crear un enlace simbólico con los permisos ya disponibles, enlaza **la carpeta individual** `.claude/skills/smartfin-sqlite-architecture` a esa fuente. No enlaces toda la carpeta `skills`, ni crees una copia adicional bajo `.codex/skills`.

Comandos manuales, desde `C:\Users\nesto\Proyectos\SmartFin`, solo si ambos destinos están ausentes:

```powershell
Test-Path -LiteralPath '.agents/skills/smartfin-sqlite-architecture'
Test-Path -LiteralPath '.claude/skills/smartfin-sqlite-architecture'
```

Ambos deben devolver `False`. Después:

```powershell
Copy-Item -LiteralPath 'tmp/smartfin-sqlite-architecture-delivery/smartfin-sqlite-architecture' -Destination '.agents/skills/smartfin-sqlite-architecture' -Recurse
New-Item -ItemType SymbolicLink -Path '.claude/skills/smartfin-sqlite-architecture' -Target 'C:\Users\nesto\Proyectos\SmartFin\.agents\skills\smartfin-sqlite-architecture'
```

No cambies políticas del sistema, hooks ni permisos para hacer funcionar el enlace. Si el sistema no lo permite, deja la copia canónica y usa manualmente esta alternativa con el destino Claude aún ausente:

```powershell
Copy-Item -LiteralPath '.agents/skills/smartfin-sqlite-architecture' -Destination '.claude/skills/smartfin-sqlite-architecture' -Recurse
```

Esta alternativa usa dos copias físicas: mantén `.agents` como fuente de verdad y vuelve a sincronizar **todos los archivos** tras cada cambio, comparando hashes SHA-256 por ruta relativa en ambos árboles; comparar solo SKILL.md no detecta referencias desactualizadas. No hay sincronizador ni hook automático instalado. Una junction podría funcionar en Windows, pero no se certificó su descubrimiento; no se propone como sustituto probado del enlace simbólico.

El enlace absoluto debe recrearse manualmente si el checkout cambia de ubicación. Para portabilidad entre máquinas, cada propietario puede recrear su enlace local o mantener copias verificadas. No se cambiaron configuraciones Git ni se hizo commit.

## Verificar y usar después de instalar

- Confirma que ambos destinos resuelvan `SKILL.md` y la carpeta `references` completa. Comprueba igualdad de hashes entre staging/canónica/Claude antes de confiar en ellos.
- En Codex, abre el proyecto y comprueba `/skills` o el selector; si no aparece, reinicia la sesión/aplicación. Invoca `$smartfin-sqlite-architecture`.
- En Claude Code, abre el mismo repositorio, comprueba `/skills` o el menú `/` e invoca `/smartfin-sqlite-architecture`. Si no aparece, comprueba ruta, YAML, permisos de lectura y duplicados antes de reiniciar.
- Prueba: «Audita el límite de commit de una transferencia con 4×1000 usando datos sintéticos, sin modificar producción». Debe cargar la referencia transaccional y la skill financiera pertinente, reconocer propietario/participantes y no reintentar unknown.
- Prueba: «Evalúa una consulta mensual y una nueva columna opcional de transactions; solo propone y verifica en memoria». Debe separar planes/equivalencia de migración/compatibilidad, sin añadir SQL a UI ni aplicar cambios a una base real.

No es necesario editar `AGENTS.md`, `CLAUDE.md` o hooks para que estas ubicaciones se descubran. La lista de skills de un chat ya iniciado puede estar desactualizada; no declares instalación fallida solo por ese catálogo inicial.
