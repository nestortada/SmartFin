import { NativeModules, Platform } from 'react-native';

export type DriveBackupStatus = {
  accessNeedsRenewal: boolean;
  available: boolean;
  configured: boolean;
  localRevision: number;
  outdated: boolean;
  permissionPersistent: boolean;
  lastBackupAt?: string;
  locationName?: string;
  remoteRevision?: number;
};

export type DriveBackupResult = {
  fileCount: number;
  lastBackupAt: string;
  locationName: string;
  permissionPersistent: boolean;
  revision: number;
};

export type DriveDirectorySelection = {
  locationName: string;
  permissionPersistent: boolean;
};

type NativeDriveBackupModule = {
  chooseBackupDirectory: () => Promise<unknown>;
  exportBackup: (currentRevision: number) => Promise<unknown>;
  getBackupStatus: (currentRevision: number) => Promise<unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function getNativeModule(): NativeDriveBackupModule {
  const candidate = asRecord(NativeModules.SmartFinDriveBackup);
  if (
    !candidate ||
    typeof candidate.chooseBackupDirectory !== 'function' ||
    typeof candidate.exportBackup !== 'function' ||
    typeof candidate.getBackupStatus !== 'function'
  ) {
    throw new Error('El respaldo en Google Drive no está disponible en este dispositivo.');
  }

  return candidate as unknown as NativeDriveBackupModule;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function isDriveBackupAvailable(): boolean {
  return Platform.OS === 'android';
}

export async function chooseDriveBackupDirectory(): Promise<DriveDirectorySelection> {
  const value = asRecord(await getNativeModule().chooseBackupDirectory());
  const locationName = value ? optionalString(value.locationName) : undefined;
  if (!locationName || typeof value?.permissionPersistent !== 'boolean') {
    throw new Error('Android no pudo confirmar el acceso a la carpeta.');
  }

  return { locationName, permissionPersistent: value.permissionPersistent };
}

export async function getDriveBackupStatus(
  currentRevision: number,
): Promise<DriveBackupStatus> {
  if (!isDriveBackupAvailable()) {
    return {
      accessNeedsRenewal: false,
      available: false,
      configured: false,
      localRevision: currentRevision,
      outdated: false,
      permissionPersistent: false,
    };
  }

  const value = asRecord(await getNativeModule().getBackupStatus(currentRevision));
  if (!value || typeof value.configured !== 'boolean' || typeof value.outdated !== 'boolean') {
    throw new Error('Android devolvió un estado de respaldo inválido.');
  }

  return {
    accessNeedsRenewal: value.accessNeedsRenewal === true,
    available: true,
    configured: value.configured,
    localRevision: currentRevision,
    outdated: value.outdated,
    permissionPersistent: value.permissionPersistent === true,
    lastBackupAt: optionalString(value.lastBackupAt),
    locationName: optionalString(value.locationName),
    remoteRevision: optionalNumber(value.remoteRevision),
  };
}

export async function exportDriveBackup(
  currentRevision: number,
): Promise<DriveBackupResult> {
  const value = asRecord(await getNativeModule().exportBackup(currentRevision));
  const fileCount = value ? optionalNumber(value.fileCount) : undefined;
  const lastBackupAt = value ? optionalString(value.lastBackupAt) : undefined;
  const locationName = value ? optionalString(value.locationName) : undefined;
  const revision = value ? optionalNumber(value.revision) : undefined;
  const permissionPersistent = value?.permissionPersistent;

  if (
    fileCount === undefined ||
    !lastBackupAt ||
    !locationName ||
    revision === undefined ||
    typeof permissionPersistent !== 'boolean'
  ) {
    throw new Error('Android no pudo confirmar los archivos exportados.');
  }

  return { fileCount, lastBackupAt, locationName, permissionPersistent, revision };
}
