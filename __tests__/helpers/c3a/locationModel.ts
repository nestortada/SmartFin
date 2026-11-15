// C3A — especificación ejecutable de SmartFinDatabaseLocation.kt (solo pruebas, NO es un segundo resolvedor
// de producción). Port línea a línea de la tabla de decisión Kotlin sobre un sistema de archivos simulado,
// para poder probarla en Node. La conformidad del Kotlin real con estos casos se verifica en Android (C4).

export type Policy = 'RECOVERY_OWNER' | 'NO_RECOVERY';
export const LEGACY_FILE = 'smartfin.db';
const GENERATION_FILE = /^smartfin-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.db$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Simulated device state. `files` maps database file name → device:inode identity. Database bytes are never modelled
 *  because the resolver never reads or writes them. */
export type DeviceState = {
  metadata: string | null;
  journal: boolean;
  files: Map<string, string>;
  /** AtomicFile semantics: a failed write leaves the previous content (here: throws before replacing). */
  failNextMetadataWrite?: boolean;
  metadataWrites: number;
};

export class Unavailable extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly recoveryRequired: boolean) { super(code); }
}
export type Active = { fileName: string; installationId: string; datasetId: string; generationId: string;
  locationEpoch: number; fileIdentity: string | null; freshInstall: boolean };

let uuidSequence = 0;
const newUuid = () => `00000000-0000-4000-8000-${(++uuidSequence).toString(16).padStart(12, '0')}`;

function writeMetadata(state: DeviceState, value: Record<string, unknown>) {
  if (state.failNextMetadataWrite) { state.failNextMetadataWrite = false; throw new Error('Injected AtomicFile write failure'); }
  state.metadata = JSON.stringify(value);
  state.metadataWrites += 1;
}

type Meta = { installationId: string; datasetId: string; generationId: string; fileName: string; status: string;
  fileIdentity: string | null; locationEpoch: number };

function parse(value: Record<string, unknown>): Meta {
  if (value.formatVersion !== 1) throw new Unavailable('METADATA_UNSUPPORTED', false, true);
  const active = value.activeGeneration as Record<string, unknown> | undefined;
  if (!active || typeof active.fileName !== 'string') throw new Unavailable('METADATA_INVALID', false, true);
  const fileName = active.fileName;
  if (fileName !== LEGACY_FILE && !GENERATION_FILE.test(fileName)) throw new Unavailable('GENERATION_UNRECOGNIZED', false, true);
  const { status, fileIdentity, generationId } = active;
  const { installationId, datasetId, locationEpoch } = value;
  const identity = fileIdentity === null || fileIdentity === undefined ? null : fileIdentity;
  if ((status !== 'initializing' && status !== 'active') || (status === 'active') !== (identity !== null) ||
      typeof locationEpoch !== 'number' || locationEpoch < 1 ||
      typeof installationId !== 'string' || !UUID.test(installationId) || typeof datasetId !== 'string' || !UUID.test(datasetId) ||
      typeof generationId !== 'string' || !UUID.test(generationId) || (identity !== null && typeof identity !== 'string'))
    throw new Unavailable('METADATA_INVALID', false, true);
  return { installationId, datasetId, generationId, fileName, status, fileIdentity: identity as string | null, locationEpoch };
}

function readMetadata(state: DeviceState): Record<string, unknown> | null {
  if (state.metadata === null) return null;
  try { const value: unknown = JSON.parse(state.metadata); if (value && typeof value === 'object') return value as Record<string, unknown>; }
  catch { /* corrupt */ }
  throw new Unavailable('METADATA_CORRUPT', false, true);
}

function newMetadata(status: string, origin: string) {
  return { formatVersion: 1, installationId: newUuid(), datasetId: newUuid(), locationEpoch: 1,
    activeGeneration: { generationId: newUuid(), fileName: LEGACY_FILE, status, origin, fileIdentity: null, recordedAt: '2026-10-11T12:00:00.000Z' } };
}
const toActive = (meta: Meta, freshInstall: boolean): Active => ({ fileName: meta.fileName, installationId: meta.installationId,
  datasetId: meta.datasetId, generationId: meta.generationId, locationEpoch: meta.locationEpoch, fileIdentity: meta.fileIdentity, freshInstall });

/** Port of SmartFinDatabaseLocation.resolve (same order of checks). */
export function resolve(state: DeviceState, policy: Policy): Active {
  if (state.journal) throw new Unavailable('RESTORE_PENDING', true, true);
  const recorded = readMetadata(state);
  if (recorded !== null) {
    const meta = parse(recorded);
    if (meta.status === 'initializing') {
      if (policy !== 'RECOVERY_OWNER') throw new Unavailable('NOT_INITIALIZED', false, false);
      return toActive(meta, true);
    }
    const identity = state.files.get(meta.fileName);
    if (identity === undefined) throw new Unavailable('DATABASE_LOST', false, true);
    if (identity !== meta.fileIdentity) throw new Unavailable('FILE_IDENTITY_MISMATCH', false, true);
    return toActive(meta, false);
  }
  if ([...state.files.keys()].some(name => GENERATION_FILE.test(name))) throw new Unavailable('POINTER_LOST', false, true);
  const legacy = state.files.get(LEGACY_FILE);
  if (legacy !== undefined) {
    const adopted = newMetadata('active', 'legacyAdoption');
    adopted.activeGeneration.fileIdentity = legacy as unknown as null;
    writeMetadata(state, adopted);
    return toActive(parse(adopted), false);
  }
  if (policy !== 'RECOVERY_OWNER') throw new Unavailable('NOT_INITIALIZED', false, false);
  const fresh = newMetadata('initializing', 'freshInstall');
  writeMetadata(state, fresh);
  return toActive(parse(fresh), true);
}

/** Port of SmartFinDatabaseLocation.confirmFreshInstall (idempotent). */
export function confirmFreshInstall(state: DeviceState, generationId: string) {
  if (state.journal) throw new Unavailable('RESTORE_PENDING', true, true);
  const recorded = readMetadata(state);
  if (recorded === null) throw new Unavailable('METADATA_MISSING', false, true);
  const meta = parse(recorded);
  if (meta.generationId !== generationId) throw new Error('Generation changed during initialization');
  if (meta.status === 'active') return;
  const identity = state.files.get(meta.fileName);
  if (identity === undefined) throw new Error('Initialized database file missing');
  const active = recorded.activeGeneration as Record<string, unknown>;
  writeMetadata(state, { ...recorded, activeGeneration: { ...active, status: 'active', fileIdentity: identity } });
}

/** Port of SmartFinSubscriptionWorker's classification of Unavailable. */
export function workerResult(error: Unavailable): 'retry' | 'failure' {
  return error.retryable ? 'retry' : 'failure';
}

/** Port of SmartFinSubscriptionRemindersModule.withDatabase resolution step. */
export function withDatabaseFile(state: DeviceState): string | null {
  try { return resolve(state, 'NO_RECOVERY').fileName; }
  catch (error) { if (error instanceof Unavailable && error.code === 'NOT_INITIALIZED') return null; throw error; }
}
