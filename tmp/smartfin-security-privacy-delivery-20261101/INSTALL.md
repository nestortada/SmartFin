# Entrega e instalación por el propietario

Esta entrega está preparada en staging porque la evaluación del `dangerous-command-guard` Codex denegó escribir la ruta canónica con `DG-FILE: Secret, database or guard configuration is protected`. No se intentó eludirlo. No es una denegación de un servicio remoto ni una solicitud de desactivar protecciones.

El paquete contiene una fuente canónica preparada en `.agents/skills/smartfin-security-privacy/` y una **copia física idéntica** en `.claude/skills/smartfin-security-privacy/`. Ninguna está instalada en las rutas de descubrimiento del proyecto. No se creó copia nueva en `.codex/skills/`.

Versiones comprobadas localmente: Codex CLI 0.166.0, Claude Code 2.1.316. Las rutas y frontmatter se contrastaron con [OpenAI Build skills](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) y [Claude Code Skills](https://code.claude.com/docs/en/skills). Se comprobó compatibilidad estructural, no selección automática en una sesión nueva. Cada agente debe descubrir una sola copia de esta skill.

## Revisar antes de instalar

Lee `VALIDATION.md` y la auditoría en `.agents/skills/smartfin-security-privacy/references/security-baseline.md`. Ejecuta desde el proyecto, sin instalar paquetes:

```powershell
python .\tmp\smartfin-security-privacy-delivery-20261101\validate_delivery.py
```

Usa Python con PyYAML ya disponible. Si falta en otro equipo, no instales dependencias implícitamente: valida el YAML con un parser local disponible o informa que falta esa comprobación.

## Copia manual en PowerShell del propietario

El siguiente bloque es para que el propietario lo revise y ejecute manualmente. No cambia hooks/permisos ni sobrescribe una instalación previa. Si alguno de los destinos ya existe, se detiene: compara y resuelve las diferencias manualmente, sin borrar ni usar `-Force`.

```powershell
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath 'C:\Users\nesto\Proyectos\SmartFin').Path
$deliveryRoot = Join-Path $repoRoot 'tmp\smartfin-security-privacy-delivery-20261101'
$skillName = 'smartfin-security-privacy'
$relativeTargets = @('.agents\skills', '.claude\skills')
python (Join-Path $deliveryRoot 'validate_delivery.py')
if ($LASTEXITCODE -ne 0) { throw 'La validación del paquete falló.' }
foreach ($relativeTarget in $relativeTargets) {
    $skillParent = Join-Path $repoRoot $relativeTarget
    $skillTarget = Join-Path $skillParent $skillName
    $skillSource = Join-Path (Join-Path $deliveryRoot $relativeTarget) $skillName
    if (-not (Test-Path -LiteralPath $skillSource -PathType Container)) { throw 'Falta una copia de staging.' }
    if (-not (Test-Path -LiteralPath $skillParent -PathType Container)) { throw 'Falta la carpeta de skills esperada.' }
    if (Test-Path -LiteralPath $skillTarget) { throw "El destino ya existe: $skillTarget" }
}
foreach ($relativeTarget in $relativeTargets) {
    $skillSource = Join-Path (Join-Path $deliveryRoot $relativeTarget) $skillName
    $skillTarget = Join-Path (Join-Path $repoRoot $relativeTarget) $skillName
    Copy-Item -LiteralPath $skillSource -Destination $skillTarget -Recurse -ErrorAction Stop
}
```

Después compara inventario y SHA-256 por archivo entre ambas carpetas instaladas y staging, o usa `python .\tmp\smartfin-security-privacy-delivery-20261101\validate_delivery.py --installed`. La validación de instalación es solo lectura. Si una copia falló a mitad, informa cuál quedó instalada; no sobrescribas ni limpies automáticamente. Inicia una sesión nueva desde la raíz y comprueba el catálogo; invoca `$smartfin-security-privacy` en Codex o `/smartfin-security-privacy` en Claude para una revisión documental sintética. No se requieren cambios en `CLAUDE.md` para descubrir una carpeta de skill.

La instalación activa orientación del agente; no corrige riesgos del producto. Actualizaciones futuras deben partir de la fuente canónica y redistribuir una copia física revisada, sin asumir sincronización automática ni cambiar protecciones.
