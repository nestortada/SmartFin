import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { openSmartFinDatabase, type SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { captureLocalDatabaseSnapshot, LocalSnapshotFailure } from './localDatabaseSnapshot';

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
  generationId?: string;
  validation?: 'verified' | 'legacyUnverified' | 'unverified';
  pendingJobs?: BackupJob[];
  datasetCurrency?: 'current' | 'historical' | 'unknown';
};

export type DriveBackupResult = {
  generationId: string;
  state: 'verified';
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
  preparePublication: () => Promise<string>;
  publishSnapshot: (id: string, snapshotId: string | null) => Promise<string>;
  publishSnapshotWithProgress?: (id: string, snapshotId: string | null, attemptId: string) => Promise<string>;
  getPublicationJobs: () => Promise<string>;
  failCapture: (id: string) => Promise<void>;
  retainFailedJob: (id: string) => Promise<void>;
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
    ['preparePublication', 'publishSnapshot', 'getPublicationJobs', 'failCapture'].some(key => typeof candidate[key] !== 'function') ||
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
    generationId: optionalString(value.generationId),
    validation: value.validation === 'verified' || value.validation === 'legacyUnverified' ? value.validation : 'unverified',
    datasetCurrency: value.datasetCurrency === 'current' || value.datasetCurrency === 'historical' ? value.datasetCurrency : 'unknown',
    pendingJobs: (await getDriveBackupJobs()).filter(job => !job.revoked && !['verified', 'failed'].includes(job.state)),
  };
}

export type BackupJobState = 'prepared' | 'snapshotValidated' | 'publicationPending' | 'verified' | 'failed' | 'uncertain';
export type BackupJob = { id: string; state: BackupJobState; completedFiles: number; totalFiles: number; revoked?: boolean };
export type BackupProgress = { state: BackupJobState | 'capturing' | 'recovering' | 'inspectingSnapshot' |
  'validatingComponents' | 'continuingPublication'; jobId?: string; completedFiles?: number; totalFiles?: number };
const identity = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
let active = false;
export function isDriveBackupInProgress(): boolean { return active; }
let attemptSequence = 0;

function report(callback: ((progress: BackupProgress) => void) | undefined, progress: BackupProgress) {
  try { callback?.(progress); } catch { /* Presentation cannot turn verified SAF work into a failure. */ }
}

async function publishOriginal(id: string, snapshotId: string | null, onProgress?: (progress: BackupProgress) => void) {
  const native = getNativeModule();
  const attemptId = `${Date.now()}-${++attemptSequence}`;
  let reporting = true, sequence = 0, polling = false;
  const listener = DeviceEventEmitter.addListener('SmartFinBackupProgress', (event: unknown) => {
    const value = asRecord(event);
    if (!reporting || value?.jobId !== id || value.attemptId !== attemptId ||
        typeof value.sequence !== 'number' || value.sequence <= sequence ||
        !['recovering', 'inspectingSnapshot', 'validatingComponents', 'continuingPublication',
          'snapshotValidated', 'publicationPending', 'verified', 'failed', 'uncertain'].includes(String(value.state))) return;
    sequence = value.sequence;
    report(onProgress, { jobId: id, state: value.state as BackupProgress['state'],
      completedFiles: optionalNumber(value.completedFiles), totalFiles: optionalNumber(value.totalFiles) });
  });
  // Compatibility for an older installed bridge; detailed phases come from native events.
  const timer = native.publishSnapshotWithProgress ? undefined : setInterval(() => {
    if (polling) return;
    polling = true;
    void getDriveBackupJobs().then(jobs => {
      const current = jobs.find(job => job.id === id);
      if (reporting && current) report(onProgress, current);
    }).catch(() => {}).finally(() => { polling = false; });
  }, 750);
  try {
    const published = result(await (native.publishSnapshotWithProgress
      ? native.publishSnapshotWithProgress(id, snapshotId, attemptId) : native.publishSnapshot(id, snapshotId)));
    reporting = false;
    report(onProgress, { state: 'verified' });
    return published;
  } catch (error) {
    reporting = false;
    report(onProgress, { state: 'uncertain', jobId: id });
    throw error;
  } finally {
    reporting = false;
    listener.remove();
    if (timer) clearInterval(timer);
  }
}

function jsonRecord(json: unknown): Record<string, unknown> {
  const value = typeof json === 'string' ? asRecord(JSON.parse(json)) : undefined;
  if (!value) throw new Error('Metadatos de respaldo inválidos.');
  return value;
}
export async function getDriveBackupJobs(): Promise<BackupJob[]> {
  const parsed: unknown = JSON.parse(await getNativeModule().getPublicationJobs());
  if (!Array.isArray(parsed)) throw new Error('Registro de respaldos inválido.');
  return parsed.map((item: unknown) => {
    const job = asRecord(item);
    if (!job || typeof job.id !== 'string' || !identity.test(job.id) ||
        !['prepared', 'snapshotValidated', 'publicationPending', 'verified', 'failed', 'uncertain'].includes(String(job.state)))
      throw new Error('Registro de respaldos inválido.');
    return { id: job.id, state: job.state as BackupJobState,
      ...(typeof job.revokedByDeletion === 'string' && job.revokedByDeletion ? { revoked: true } : {}),
      completedFiles: optionalNumber(job.completedFiles) ?? 0, totalFiles: optionalNumber(job.totalFiles) ?? 0 };
  });
}
function result(json: string): DriveBackupResult {
  const value = jsonRecord(json);
  const { generationId, fileCount, lastBackupAt, locationName, permissionPersistent, revision, state } = value;
  if (typeof generationId !== 'string' || !identity.test(generationId) || state !== 'verified' ||
      typeof fileCount !== 'number' || !Number.isSafeInteger(fileCount) || fileCount < 2 ||
      typeof lastBackupAt !== 'string' || !Number.isFinite(Date.parse(lastBackupAt)) ||
      typeof locationName !== 'string' || typeof permissionPersistent !== 'boolean' ||
      typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
    throw new Error('Android no pudo verificar la generación publicada.');
  return { generationId, state, fileCount, lastBackupAt, locationName, permissionPersistent, revision };
}
export async function exportDriveBackup(options: {
  onDatabase: (database: SmartFinSQLiteDatabase | undefined) => void;
  onProgress?: (progress: BackupProgress) => void;
}): Promise<DriveBackupResult> {
  if (active) throw new Error('Ya hay un respaldo en curso.');
  active = true;
  let jobId: string | undefined;
  try {
    const job = jsonRecord(await getNativeModule().preparePublication());
    if (typeof job.id !== 'string' || !identity.test(job.id)) throw new Error('Identidad de respaldo inválida.');
    jobId = job.id;
    report(options.onProgress, { state: 'prepared', jobId });
    options.onDatabase(undefined);
    report(options.onProgress, { state: 'capturing', jobId });
    let captured: Awaited<ReturnType<typeof captureLocalDatabaseSnapshot>>;
    try { captured = await captureLocalDatabaseSnapshot(jobId); }
    catch (error) {
      if (error instanceof LocalSnapshotFailure) options.onDatabase(error.database);
      else {
        // Pre-close rejection can leave the original singleton healthy. Managed
        // opening revalidates its owner and refuses any quarantined connection.
        try { options.onDatabase(await openSmartFinDatabase()); } catch { /* Remain unavailable. */ }
      }
      // Keep the original capture/recovery error; recording failure cannot certify recovery.
      try { await getNativeModule().failCapture(jobId); } catch { /* Durable prepared state remains. */ }
      report(options.onProgress, { state: 'failed', jobId });
      throw error;
    }
    options.onDatabase(captured.database);
    report(options.onProgress, { state: 'snapshotValidated', jobId });
    // Capture has returned only after singleton recovery AND release of both permits.
    return await publishOriginal(jobId, captured.snapshot.id, options.onProgress);
  } finally {
    active = false;
  }
}
/** Explicit verification/resume of the original job; never captures current financial data. */
export async function verifyDriveBackupJob(id: string, onProgress?: (progress: BackupProgress) => void): Promise<DriveBackupResult> {
  if (active) throw new Error('Ya hay un respaldo en curso.');
  if (!identity.test(id)) throw new Error('Identidad de respaldo inválida.');
  active = true;
  try {
    report(onProgress, { state: 'recovering', jobId: id });
    await openSmartFinDatabase();
    return await publishOriginal(id, null, onProgress);
  }
  finally { active = false; }
}

/** User decision: preserve all evidence, stop selecting this job for resumption. */
export async function retainFailedDriveBackupJob(id: string): Promise<void> {
  if (active) throw new Error('Ya hay un respaldo en curso.');
  if (!identity.test(id)) throw new Error('Identidad de respaldo inválida.');
  await getNativeModule().retainFailedJob(id);
}
