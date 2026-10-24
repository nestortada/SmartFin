import type { BackupProgress } from './androidDriveBackupService';

export function backupProgressMessage(progress: BackupProgress): string {
  const messages: Record<BackupProgress['state'], string> = {
    prepared: 'Preparando generación...',
    capturing: 'Capturando SQLite. Las operaciones financieras esperan; con bases grandes la pausa puede superar 6 segundos.',
    snapshotValidated: 'Captura recuperada. Preparando archivos...',
    recovering: 'Verificando el trabajo anterior...',
    inspectingSnapshot: 'Inspeccionando el snapshot original...',
    validatingComponents: 'Validando componentes externos mediante SAF...',
    continuingPublication: 'Continuando la publicación del trabajo original...',
    publicationPending: 'Publicando y verificando archivos...',
    verified: 'Generación verificada mediante SAF. Sincronización remota sin confirmar.',
    failed: 'Publicación fallida. Se conserva su evidencia.',
    uncertain: 'Publicación incierta. Requiere verificación del trabajo original.',
  };
  return messages[progress.state] + (progress.totalFiles ? ` ${progress.completedFiles ?? 0}/${progress.totalFiles}` : '');
}
