import {
  nativeDatabaseToken,
  withExclusiveDatabase,
} from '../../../database/databaseCoordination';
import { borrowSQLiteDatabase, sqliteConnectionState } from '../../../database/managedSQLite';
import { nativeDatabaseLifecycle } from '../../../database/nativeDatabaseLifecycle';
import {
  closeSmartFinDatabase,
  openSmartFinDatabase,
  type SmartFinSQLiteDatabase,
} from '../../../database/sqliteDatabase';
import { resultSetToRows } from '../../../database/sqliteRows';

const monotonic = (globalThis as unknown as { performance: { now: () => number } }).performance;

export type LocalDatabaseSnapshot = {
  id: string;
  path: string;
  bytes: number;
  revision: number;
  sha256: string;
  journal: string;
  journalBeforeClose: string;
  sourceValidationMs: number;
  copyMs: number;
  validationAndHashMs: number;
  nativeTotalMs: number;
};

export class LocalSnapshotFailure extends Error {
  constructor(
    readonly captureError: unknown,
    readonly recoveryError: unknown,
    readonly database?: SmartFinSQLiteDatabase,
  ) {
    super(recoveryError
      ? 'No se pudo recuperar la conexión SQLite. Reinicia y verifica su estado.'
      : 'No se pudo certificar la captura local.');
  }
}

function safeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Metadatos SQLite inválidos.');
  return value;
}

/** Also used to validate the managed checkpoint response, including busy without exception. */
export function assertCompleteCheckpoint(rows: Record<string, unknown>[]): void {
  const row = rows[0];
  if (rows.length !== 1 || !row || row.busy !== 0 ||
      safeInteger(row.log) !== 0 || safeInteger(row.checkpointed) !== 0)
    throw new Error('Checkpoint SQLite incompleto.');
}

type DescribeTimings = { foreignKeyCheckMs: number; integrityCheckMs: number; metadataMs: number };

async function describe(database: SmartFinSQLiteDatabase, journal: string, timings: DescribeTimings) {
  const query = async (sql: string) => {
    const [result] = await database.executeSql(sql);
    return resultSetToRows(result);
  };
  if (sqliteConnectionState(database)?.owned)
    throw new Error('No se puede capturar una transacción activa.');
  // Integrity and foreign-key checks run once, natively, on the byte-identical private
  // copy (SHA-256) before it is accepted; the live source only supplies the metadata.
  const fk = await query('PRAGMA foreign_keys;');
  const stage = monotonic.now();
  timings.foreignKeyCheckMs = 0;
  timings.integrityCheckMs = 0;
  if (fk.length !== 1 || fk[0]?.foreign_keys !== 1)
    throw new Error('La base de datos no supera la validación de integridad.');
  const schema = await query('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name');
  const tables: [string, number][] = [];
  for (const row of schema) {
    if (row.type !== 'table' || typeof row.name !== 'string') continue;
    const name = row.name;
    const count = await query(`SELECT count(*) AS total FROM "${name.replace(/"/g, '""')}"`);
    tables.push([name, safeInteger(count[0]?.total)]);
  }
  const revision = await query('SELECT revision FROM financial_data_revision WHERE id=1;');
  if (revision.length !== 1) throw new Error('Revisión SQLite ausente.');
  const described = {
    schema: schema.map(row => [row.type, row.name, row.tbl_name, row.sql]),
    tables,
    revision: safeInteger(revision[0]?.revision),
    userVersion: safeInteger((await query('PRAGMA user_version;'))[0]?.user_version),
    schemaVersion: safeInteger((await query('PRAGMA schema_version;'))[0]?.schema_version),
    journal,
  };
  timings.metadataMs = monotonic.now() - stage;
  return described;
}

function parseSnapshot(json: string): LocalDatabaseSnapshot {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object') throw new Error('Captura nativa inválida.');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !/^[0-9a-f-]{36}$/.test(row.id) ||
      typeof row.path !== 'string' || !row.path.startsWith('/') ||
      typeof row.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sha256) ||
      typeof row.journal !== 'string' || typeof row.journalBeforeClose !== 'string' || safeInteger(row.bytes) === 0)
    throw new Error('Captura nativa inválida.');
  safeInteger(row.revision);
  for (const key of ['sourceValidationMs', 'copyMs', 'validationAndHashMs', 'nativeTotalMs'])
    if (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0)
      throw new Error('Duración de captura inválida.');
  return value as LocalDatabaseSnapshot;
}

/** Internal local-only entry point for the next backup component. No SAF publication. */
export async function captureLocalDatabaseSnapshot(backupJobId?: string) {
  if (backupJobId !== undefined && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(backupJobId))
    throw new Error('Identidad de respaldo inválida.');
  const requested = monotonic.now();
  const result = await withExclusiveDatabase(async permit => {
    const acquired = monotonic.now();
    const native = nativeDatabaseLifecycle();
    const token = nativeDatabaseToken(permit);
    if (!native || !token) throw new Error('La captura local requiere coordinación Android.');
    const database = await openSmartFinDatabase(permit);
    const owned = borrowSQLiteDatabase(database, permit);
    const [mode] = await owned.executeSql('PRAGMA journal_mode;');
    const journal: unknown = mode.rows.item(0)?.journal_mode;
    if (typeof journal !== 'string' || !['wal', 'delete', 'truncate', 'persist'].includes(journal))
      throw new Error('Modo journal no apto para captura física.');
    const checkpointStart = monotonic.now();
    if (journal === 'wal') {
      const [checkpoint] = await owned.executeSql('PRAGMA wal_checkpoint(TRUNCATE);');
      assertCompleteCheckpoint(resultSetToRows(checkpoint));
    }
    const checkpointMs = monotonic.now() - checkpointStart;
    const verificationStart = monotonic.now();
    const sourceDescribe: DescribeTimings = { foreignKeyCheckMs: 0, integrityCheckMs: 0, metadataMs: 0 };
    const expected = await describe(owned, journal, sourceDescribe);
    const sourceVerificationMs = monotonic.now() - verificationStart;
    const closeStart = monotonic.now();
    let closeMs = 0;
    let reopenMs = 0;
    let snapshot: LocalDatabaseSnapshot | undefined;
    let captureError: unknown;
    let recoveryError: unknown;
    let recovered: SmartFinSQLiteDatabase | undefined;
    try {
      await closeSmartFinDatabase(permit);
      closeMs = monotonic.now() - closeStart;
      snapshot = parseSnapshot(await native.capture(token, JSON.stringify({ ...expected, backupJobId })));
      if (snapshot.revision !== expected.revision) throw new Error('Revisión de captura incompatible.');
    } catch (error) {
      captureError = error;
    } finally {
      const reopenStart = monotonic.now();
      try { recovered = await openSmartFinDatabase(permit); }
      catch (error) { recoveryError = error; }
      reopenMs = monotonic.now() - reopenStart;
    }
    if (captureError || recoveryError || !snapshot || !recovered)
      throw new LocalSnapshotFailure(captureError, recoveryError, recovered);
    return {
      snapshot,
      database: recovered,
      timings: {
        permissionWaitMs: acquired - requested,
        checkpointMs,
        sourceVerificationMs,
        sourceDescribe,
        closeMs,
        reopenMs,
        totalMs: monotonic.now() - requested,
      },
    };
  });
  result.timings.totalMs = monotonic.now() - requested;
  return result;
}

export async function discardLocalDatabaseSnapshot(id: string): Promise<void> {
  await withExclusiveDatabase(async permit => {
    const native = nativeDatabaseLifecycle();
    const token = nativeDatabaseToken(permit);
    if (!native || !token) throw new Error('Coordinación Android no disponible.');
    await native.discard(token, id);
  });
}
