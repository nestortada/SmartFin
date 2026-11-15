import { NativeModules, Platform } from 'react-native';
import { nativeDatabaseToken, type DatabasePermit } from './databaseCoordination';

/**
 * C3A: JavaScript side of the single database resolver. The decision table lives only in Kotlin
 * (SmartFinDatabaseLocation); this module validates the native answer as `unknown`, never derives a
 * file name by itself on Android, and keeps the generation binding of the JS connection.
 */
export const LEGACY_DATABASE_FILE = 'smartfin.db';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATABASE_FILE = /^(smartfin\.db|smartfin-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.db)$/;

export type DatabaseBinding = Readonly<{
  /** false only on platforms without the Android resolver (Node tests, iOS): no generation guarantees. */
  managed: boolean;
  generationId: string;
  fileName: string;
  /** device:inode recorded by Kotlin; null while a fresh installation is being initialized. */
  fileIdentity: string | null;
  /** Logical version of the resolution; a future activation (C3B) increments it. */
  locationEpoch: number;
  installationId: string | null;
  datasetId: string | null;
}>;
export type DatabaseResolution = Readonly<{ binding: DatabaseBinding; freshInstall: boolean }>;

export class DatabaseResolutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly recoveryRequired: boolean) {
    super(recoveryRequired
      ? `La base de datos local requiere recuperación (${code}).`
      : `La base de datos local no está disponible (${code}).`);
    this.name = 'DatabaseResolutionError';
  }
}

const UNMANAGED_BINDING: DatabaseBinding = Object.freeze({
  managed: false, generationId: 'unmanaged-platform', fileName: LEGACY_DATABASE_FILE, fileIdentity: null,
  locationEpoch: 0, installationId: null, datasetId: null,
});

type NativeDatabaseLocation = {
  resolveDatabase: (token: string) => Promise<unknown>;
  confirmFreshInstall: (token: string, generationId: string) => Promise<void>;
  releaseDatabaseBinding: (token: string, generationId: string) => Promise<void>;
};

function nativeLocation(): NativeDatabaseLocation {
  const value: unknown = NativeModules.SmartFinDatabaseLifecycle;
  if (!value || typeof value !== 'object' ||
      ['resolveDatabase', 'confirmFreshInstall', 'releaseDatabaseBinding'].some(key => typeof Reflect.get(value, key) !== 'function'))
    // A JS bundle newer than its native module must not fall back to a fixed file name.
    throw new DatabaseResolutionError('RESOLVER_UNAVAILABLE', false, true);
  return value as NativeDatabaseLocation;
}

function ownerToken(permit: DatabasePermit): string {
  const token = nativeDatabaseToken(permit);
  if (!token) throw new DatabaseResolutionError('OWNER_UNAVAILABLE', true, false);
  return token;
}

const invalid = () => new DatabaseResolutionError('RESOLUTION_INVALID', false, true);

/** Strict validation of the native answer. A refusal is rethrown as a typed error, never a default file. */
export function parseNativeResolution(answer: unknown): DatabaseResolution {
  let value: unknown;
  try { value = typeof answer === 'string' ? JSON.parse(answer) : undefined; } catch { value = undefined; }
  if (!value || typeof value !== 'object') throw invalid();
  const row = value as Record<string, unknown>;
  if (row.status === 'refused') {
    if (typeof row.code !== 'string' || !/^[A-Z_]{3,64}$/.test(row.code) ||
        typeof row.retryable !== 'boolean' || typeof row.recoveryRequired !== 'boolean') throw invalid();
    throw new DatabaseResolutionError(row.code, row.retryable, row.recoveryRequired);
  }
  const { status, fileName, generationId, installationId, datasetId, locationEpoch, fileIdentity } = row;
  if ((status !== 'open' && status !== 'create') ||
      typeof fileName !== 'string' || !DATABASE_FILE.test(fileName) ||
      typeof generationId !== 'string' || !UUID.test(generationId) ||
      typeof installationId !== 'string' || !UUID.test(installationId) ||
      typeof datasetId !== 'string' || !UUID.test(datasetId) ||
      typeof locationEpoch !== 'number' || !Number.isSafeInteger(locationEpoch) || locationEpoch < 1 ||
      (status === 'open' ? typeof fileIdentity !== 'string' || !/^-?\d+:-?\d+$/.test(fileIdentity) : fileIdentity !== null))
    throw invalid();
  return Object.freeze({
    freshInstall: status === 'create',
    binding: Object.freeze({ managed: true, generationId, fileName, fileIdentity: fileIdentity as string | null,
      locationEpoch, installationId, datasetId }),
  });
}

/** Must be called with the exclusive owner, before the driver opens anything. */
export async function resolveSmartFinDatabase(permit: DatabasePermit): Promise<DatabaseResolution> {
  if (Platform.OS !== 'android') return Object.freeze({ freshInstall: false, binding: UNMANAGED_BINDING });
  const token = ownerToken(permit);
  return parseNativeResolution(await nativeLocation().resolveDatabase(token));
}

export async function confirmFreshDatabase(permit: DatabasePermit, binding: DatabaseBinding): Promise<void> {
  if (binding.managed) await nativeLocation().confirmFreshInstall(ownerToken(permit), binding.generationId);
}

export async function releaseDatabaseBinding(permit: DatabasePermit, binding: DatabaseBinding): Promise<void> {
  if (binding.managed) await nativeLocation().releaseDatabaseBinding(ownerToken(permit), binding.generationId);
}

// ─── Generation binding of JS connections ───────────────────────────────────
let current: DatabaseBinding | undefined;
const invalidated = new Set<string>();

/** Records the binding of the verified JS connection. An invalidated generation can never become current again. */
export function activateDatabaseBinding(binding: DatabaseBinding): void {
  if (invalidated.has(binding.generationId)) throw new DatabaseResolutionError('GENERATION_INVALIDATED', false, true);
  current = binding;
}

/** Checked right after resolution, before the driver is called: an invalidated generation is never reopened. */
export function assertResolutionUsable(binding: DatabaseBinding): void {
  if (invalidated.has(binding.generationId)) throw new DatabaseResolutionError('GENERATION_INVALIDATED', false, true);
}

export function currentDatabaseBinding(): DatabaseBinding | undefined {
  return current;
}

/**
 * Internal (C3B activation and tests): every handle bound to this generation stops being usable at its
 * next access. Native openers are per call and re-resolve, so they never keep an obsolete file open.
 */
export function invalidateDatabaseGeneration(generationId: string): void {
  invalidated.add(generationId);
  if (current?.generationId === generationId) current = undefined;
}

export function isDatabaseBindingCurrent(binding: DatabaseBinding): boolean {
  if (invalidated.has(binding.generationId)) return false;
  // Before activation (initialization uses a borrowed handle) only an invalidated generation is refused.
  return current === undefined || (current.generationId === binding.generationId &&
    current.locationEpoch === binding.locationEpoch && current.fileName === binding.fileName);
}
