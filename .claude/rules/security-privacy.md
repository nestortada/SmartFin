---
paths:
  - "src/services/**/*.ts"
  - "src/modules/security/**/*.{ts,tsx}"
  - "src/modules/settings/services/*{Backup,backup,Snapshot,Deletion}*.ts"
  - "src/modules/settings/types/financialDeletion.ts"
  - "src/modules/settings/ui/components/{DriveBackupSection,SecuritySection}.tsx"
  - "android/app/src/main/AndroidManifest.xml"
  - "android/app/src/main/java/com/smartfin/SmartFin{Backup,Security,FinancialDeletion,LocalSnapshot,DriveBackup}*.kt"
---

# Seguridad y privacidad: qué datos salen

Al cambiar estos archivos:

- Identifica qué datos financieros salen del proceso o del dispositivo (red, archivos SAF, CSV, logs, IA) y hacia quién.
- Una llamada de red, un permiso o un servicio externo nuevo requiere aprobación explícita del usuario.
- No registres importes, credenciales ni contenido de respaldos en logs, mensajes de error o respuestas a JS.
- Ante cambios de respaldo, exportación, restauración, autenticación, permisos o IA, consulta la skill `smartfin-security-privacy`.
