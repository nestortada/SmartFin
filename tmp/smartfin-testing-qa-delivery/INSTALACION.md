# Instalación manual y fuente canónica

La entrega está en staging porque la política de `.codex/hooks/dangerous-command-guard.cjs` protege escrituras en `.agents/`. Su evaluación en seco devolvió `DG-FILE`. No se intentó instalar por otra herramienta ni se modificaron hooks/configuración/permisos. Las restricciones de la skill SQLite también indican entregar staging cuando el guard bloquee instalación. Este documento es para ejecución manual consciente por el propietario, fuera del agente; no es una instrucción para eludir una denegación desde otra herramienta.

## Destinos previstos

- Fuente de verdad editable: `.agents/skills/smartfin-testing-qa/`.
- Copia física de distribución para Claude: `.claude/skills/smartfin-testing-qa/`.
- No crear una tercera copia en `.codex/skills/` ni cambiar `AGENTS.md`, `CLAUDE.md`, settings o hooks para forzar descubrimiento.

El payload contiene `SKILL.md` y `references/` (7 archivos). `manifest.sha256.json`, fuera del payload, registra sus bytes. El ZIP contiene solo la carpeta de la skill; no contiene la auditoría ni la instantánea de validación. No requiere instalación de paquetes, privilegios, enlaces/junctions ni reinicios de sistema.

## Primera instalación (no ejecutada por el agente)

Revisa el contenido y el manifiesto antes. Los comandos siguientes usan rutas concretas de esta entrega y rehúsan sobrescribir destinos existentes. Si ya existe un destino o un enlace/junction en sus ancestros, detente y revisa manualmente; no borres ni fusiones automáticamente.

```powershell
$qaRepoRoot = 'C:\Users\nesto\Proyectos\SmartFin'
$qaDelivery = Join-Path $qaRepoRoot 'tmp\smartfin-testing-qa-delivery'
$qaPayload = Join-Path $qaDelivery 'smartfin-testing-qa'
$qaCanonical = Join-Path $qaRepoRoot '.agents\skills\smartfin-testing-qa'
$qaClaude = Join-Path $qaRepoRoot '.claude\skills\smartfin-testing-qa'
$qaManifest = Get-Content -LiteralPath (Join-Path $qaDelivery 'manifest.sha256.json') -Raw | ConvertFrom-Json

function Test-QaSkillBytes([string]$qaFolder) {
    $qaFiles = @(Get-ChildItem -LiteralPath $qaFolder -File -Recurse)
    if ($qaFiles.Count -ne @($qaManifest.files).Count) { throw 'Conjunto de archivos distinto' }
    foreach ($qaEntry in $qaManifest.files) {
        $qaFile = Join-Path $qaFolder $qaEntry.path
        if (-not (Test-Path -LiteralPath $qaFile -PathType Leaf)) { throw "Falta: $qaFile" }
        $qaDigest = (Get-FileHash -LiteralPath $qaFile -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($qaDigest -cne $qaEntry.sha256) { throw "Hash distinto: $qaFile" }
    }
}

Test-QaSkillBytes $qaPayload
if ((Test-Path -LiteralPath $qaCanonical) -or (Test-Path -LiteralPath $qaClaude)) {
    throw 'Destino existente: revisar manualmente sin sobrescribir'
}
Copy-Item -LiteralPath $qaPayload -Destination $qaCanonical -Recurse
Test-QaSkillBytes $qaCanonical
Copy-Item -LiteralPath $qaCanonical -Destination $qaClaude -Recurse
Test-QaSkillBytes $qaClaude
```

La manifestación de igualdad acredita bytes, no activación del agente. Si una copia falla, conserva lo creado para revisión; no limpies ni vuelvas a copiar con `-Force` automáticamente. Revisa el diff y valida de nuevo antes de usar.

## Descubrimiento y prueba manual después de instalar

Según la documentación oficial de [Codex](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills), el descubrimiento de repositorio recorre `.agents/skills` desde el directorio de trabajo hacia la raíz. La documentación de [Claude Code](https://code.claude.com/docs/en/skills#choose-where-skills-load) establece `.claude/skills/` como ruta de proyecto. Las versiones locales observadas fueron Codex CLI 0.166.0 y Claude Code 2.1.316; no se abrió una sesión nueva ni se alteró configuración para comprobar carga.

Desde la raíz, abre una sesión nueva de cada cliente si la actual no muestra la skill. Comprueba que aparezca una sola versión pertinente. En Codex invoca `$smartfin-testing-qa`; en Claude `/smartfin-testing-qa`. Prueba sin ejecutar dispositivos:

> Usa smartfin-testing-qa para diseñar la validación de un pago de tarjeta con respuesta de COMMIT perdida. Solo diseña el plan; no modifiques código ni ejecutes Android.

Debe elegir dominio + SQLite, identificar snapshot completo/unknown/no reenvío y marcar evidencia nativa pendiente, sin ejecutar la campaña. Prueba también una solicitud natural de reproducir un defecto y una solicitud ajena (editar texto): la selección implícita se espera para QA, no para edición documental general. Registrar lo que realmente cargó; leer el archivo por ruta explícita no demuestra descubrimiento automático.

Si no aparece, verifica ubicación exacta, frontmatter, nombre, contenido y conflictos de mismo nombre en ubicaciones del usuario/proyecto; no cambies políticas/settings para forzar carga. Informa la limitación.

## Actualizaciones posteriores

Edita únicamente la fuente canónica en `.agents/skills/` dentro del alcance permitido. Antes de sincronizar Claude, compara conjuntos de archivos y SHA-256; si la copia tiene cambios propios, detente y resuelve la divergencia con diff, sin descartarla. Prepara una nueva entrega/manifiesto, valida y reemplaza manualmente solo los archivos revisados. No uses sincronización con borrado, `git clean`, enlaces ni cambios de permisos para mantener las copias.

La copia de Claude es un artefacto generado: igualdad de todos los hashes y rutas respecto de la canónica es el criterio de sincronía. Mantén el manifiesto de cada entrega fuera del payload para evitar autorreferencia.
