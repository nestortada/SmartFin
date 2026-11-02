# Instalar la actualización documental de respaldos Drive

La evaluación pura de escritura sobre `.agents/skills/smartfin-security-privacy/SKILL.md` fue denegada por el guard existente: `DG-FILE: Secret, database or guard configuration is protected`. No se intentó escribir por otra vía. Este paquete es staging; las skills instaladas todavía conservan sus recomendaciones anteriores.

Se incluyen una copia canónica preparada bajo `.agents/skills/smartfin-security-privacy/` y una copia física idéntica bajo `.claude/skills/smartfin-security-privacy/`, ambas completas. `UPDATE.patch` actualiza únicamente ocho documentos en cada instalación existente. No crea una copia en `.codex/skills/` ni modifica producción, migraciones, dependencias, hooks o políticas. La entrega anterior se conserva.

Revisa la [decisión y prioridades](.agents/skills/smartfin-security-privacy/references/backups-and-recovery.md), el [resultado de validación](VALIDATION.md) y `UPDATE.patch`. Para evitar reemplazar trabajo posterior, el propietario puede ejecutar manualmente este bloque desde PowerShell; comprueba las huellas de todos los archivos antes de aplicar el parche:

```powershell
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath 'C:\Users\nesto\Proyectos\SmartFin').Path
$deliveryRoot = Join-Path $projectRoot 'tmp\smartfin-security-privacy-drive-policy-20261101'
$patchFile = Join-Path $deliveryRoot 'UPDATE.patch'
$changes = Get-Content -LiteralPath (Join-Path $deliveryRoot 'CHANGES.json') -Raw | ConvertFrom-Json
foreach ($change in $changes) {
    $targetFile = Join-Path $projectRoot $change.path
    if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) { throw "Falta el documento: $targetFile" }
    $currentHash = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($currentHash -ne $change.before) { throw "El documento cambió; revisa manualmente: $targetFile" }
}
git -C $projectRoot apply --check -- $patchFile
if ($LASTEXITCODE -ne 0) { throw 'El parche no aplica limpiamente; conserva los cambios actuales.' }
git -C $projectRoot apply -- $patchFile
if ($LASTEXITCODE -ne 0) { throw 'La aplicación falló; revisa el estado sin restaurar ni borrar automáticamente.' }
foreach ($change in $changes) {
    $targetFile = Join-Path $projectRoot $change.path
    $currentHash = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($currentHash -ne $change.after) { throw "Verifica el documento instalado: $targetFile" }
}
```

No se ha ejecutado la aplicación del parche: solo `git apply --check`. No desactives hooks ni cambies permisos si una herramienta impide instalarlo. Una instalación posterior debe comprobar ambos destinos y usar una sesión nueva para cargar la versión revisada. La copia de staging y `CHANGES.json` permiten comparar las versiones sin sobrescribir ediciones ajenas.
