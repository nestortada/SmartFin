// Etapa C2 — modelo puro del contrato del resolvedor único (no es código de producción, no hace E/S).
// En C3 la misma tabla de decisión vivirá en Kotlin (SmartFinDatabaseLocation) y JS la obtendrá por el puente.

export const LEGACY_DATABASE = 'smartfin.db';
const GENERATION = /^smartfin-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.db$/;

export type PointerState =
  | { kind: 'absent' }
  | { kind: 'corrupt' }
  | { kind: 'valid'; active: string; generationId: string; previous?: string; contentDigest?: string };
export type JournalState = { kind: 'absent' } | { kind: 'corrupt' } | { kind: 'pending'; phase: string };
export type ResolverInput = {
  pointer: PointerState;
  journal: JournalState;
  /** Durable marker written after the first successful open (C3); absent on every current installation. */
  installMarker: boolean;
  /** Main database files present in the databases directory (no -journal/-wal/-shm). */
  files: string[];
  /** 'exclusive' = owner of SmartFinDatabaseCoordinator.acquire; 'independent' = participate(null). */
  caller: 'exclusive' | 'independent';
};
export type RefusalCode =
  | 'JOURNAL_CORRUPT' | 'RESTORE_PENDING' | 'POINTER_CORRUPT' | 'POINTER_INVALID' | 'ACTIVE_GENERATION_MISSING'
  | 'POINTER_LOST' | 'DATABASE_LOST' | 'NOT_INITIALIZED';
export type Resolution =
  | { action: 'open'; name: string; generationId: string; adoptLegacy: boolean }
  | { action: 'createFreshInstall'; name: typeof LEGACY_DATABASE; generationId: 'legacy' }
  | { action: 'recoverFirst' }
  | { action: 'refuse'; code: RefusalCode };

export function isValidGenerationName(name: string): boolean {
  return name === LEGACY_DATABASE || GENERATION.test(name);
}

/** Decision table. Never selects a database by guessing and never creates one except a genuine first install. */
export function resolveActiveDatabase(input: ResolverInput): Resolution {
  if (input.journal.kind === 'corrupt') return { action: 'refuse', code: 'JOURNAL_CORRUPT' };
  if (input.journal.kind === 'pending')
    return input.caller === 'exclusive' ? { action: 'recoverFirst' } : { action: 'refuse', code: 'RESTORE_PENDING' };
  if (input.pointer.kind === 'corrupt') return { action: 'refuse', code: 'POINTER_CORRUPT' };
  if (input.pointer.kind === 'valid') {
    const { active, generationId, previous } = input.pointer;
    if (!isValidGenerationName(active) || (previous !== undefined && !isValidGenerationName(previous)) || !generationId)
      return { action: 'refuse', code: 'POINTER_INVALID' };
    if (!input.files.includes(active)) return { action: 'refuse', code: 'ACTIVE_GENERATION_MISSING' };
    return { action: 'open', name: active, generationId, adoptLegacy: false };
  }
  // No pointer: every installation before C3. A generation file without pointer means the pointer was lost.
  if (input.files.some(name => GENERATION.test(name))) return { action: 'refuse', code: 'POINTER_LOST' };
  if (input.files.includes(LEGACY_DATABASE))
    return { action: 'open', name: LEGACY_DATABASE, generationId: 'legacy', adoptLegacy: !input.installMarker };
  if (input.installMarker) return { action: 'refuse', code: 'DATABASE_LOST' };
  return input.caller === 'exclusive'
    ? { action: 'createFreshInstall', name: LEGACY_DATABASE, generationId: 'legacy' }
    : { action: 'refuse', code: 'NOT_INITIALIZED' };
}

/** A connection is bound to the generation it was opened for; any access after a switch must be refused. */
export function connectionStillCurrent(connectionGenerationId: string, current: Resolution): boolean {
  return current.action === 'open' && current.generationId === connectionGenerationId;
}
