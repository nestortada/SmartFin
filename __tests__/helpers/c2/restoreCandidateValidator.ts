// Etapa C2 — prototipo aislado del validador de respaldos (no es código de producción ni se usa en la app).
// Garantías: el archivo elegido sólo se LEE como bytes (nunca se abre con SQLite); toda inspección SQLite se hace
// sobre una copia privada abierta en solo lectura; la normalización WAL y la migración de versiones antiguas se
// hacen sobre una copia de trabajo distinta, que después se valida otra vez desde cero.
import { FINANCIAL_TEST_DATE } from '../financialIntegrityFixture';
import { realSQLite } from '../realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../../../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../../../src/database/migrations';
import { SHARED_LOSS_SCHEMA } from '../../../src/modules/transactions/database/sharedLossSchema';
import { INSTALLMENT_HISTORY_SCHEMA } from '../../../src/modules/creditCards/database/installmentHistorySchema';
import {
  SHARED_EXPENSE_INDEXES,
  SHARED_EXPENSE_SCHEMA,
  SHARED_EXPENSE_TRIGGERS,
} from '../../../src/modules/transactions/database/sharedExpenseSchema';
import { INSTALLMENT_PLAN_PENDING_REASONS } from '../../../src/modules/creditCards/types/InstallmentHistory';
import { contentFingerprint, type ContentFingerprint } from './contentFingerprint';

type Row = Record<string, unknown>;
type Db = {
  exec: (sql: string) => void;
  prepare: (sql: string) => { all: (...values: unknown[]) => Row[] };
  close: () => void;
};
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => Db };
const fs = require('node:fs') as {
  mkdirSync: (dir: string, options: { recursive: boolean }) => void; readFileSync: (file: string) => Uint8Array;
  writeFileSync: (file: string, data: Uint8Array) => void; existsSync: (file: string) => boolean;
  statSync: (file: string) => { size: number }; copyFileSync: (from: string, to: string) => void;
};
const path = require('node:path') as { join: (...parts: string[]) => string };
const crypto = require('node:crypto') as {
  createHash: (algorithm: string) => { update: (data: Uint8Array) => { digest: (encoding: 'hex') => string } };
};

export const KNOWN_SCHEMA_VERSION = 5;
export const MAX_CANDIDATE_BYTES = 512 * 1024 * 1024;
const HEADER = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];

export type DiagnosticCode =
  | 'FILE_MISSING' | 'FILE_SIZE' | 'NOT_SQLITE' | 'TRUNCATED' | 'OPEN_FAILED' | 'INTEGRITY' | 'FOREIGN_KEY'
  | 'USER_VERSION' | 'NO_MIGRATIONS' | 'FUTURE_VERSION' | 'NON_CONTIGUOUS_VERSIONS' | 'MIGRATION_FAILED'
  | 'MISSING_TABLE' | 'UNKNOWN_TABLE' | 'COLUMN_MISMATCH' | 'MISSING_INDEX' | 'ALTERED_INDEX' | 'MISSING_TRIGGER'
  | 'ALTERED_TRIGGER' | 'FIN_REVISION_COUNTER' | 'FIN_ALLOCATION_PURCHASE' | 'FIN_ALLOCATION_PAYMENT'
  | 'FIN_ALLOCATION_CARD' | 'FIN_ALLOCATION_AMOUNT' | 'FIN_ALLOCATION_CARDINALITY' | 'FIN_ALLOCATION_REVISION'
  | 'FIN_REVERSAL_REVISION' | 'FIN_REVISION_SEQUENCE' | 'FIN_REMOVED_PURCHASE_HISTORY' | 'FIN_PENDING_REASON'
  | 'FIN_FIRST_CYCLE' | 'FIN_BILLING_RULE' | 'FIN_PURCHASE_CARD' | 'FIN_COMMAND_EVIDENCE' | 'DELETION_PENDING';
export type Diagnostic = { code: DiagnosticCode; detail: string };
export type CandidateSummary = {
  schemaVersion: number; financialRevision: number; accounts: number; transactions: number; purchases: number;
  activeAllocations: number; reversedAllocations: number; revisions: number; pendingRevisions: number; statements: number;
};
export type ValidationResult = {
  status: 'accepted' | 'acceptedAfterMigration' | 'rejected';
  diagnostics: Diagnostic[];
  sourceSha256?: string;
  stagedSha256?: string;
  validatedFile?: string;
  migratedFrom?: number;
  fingerprint?: ContentFingerprint;
  summary?: CandidateSummary;
  integrityPassed?: boolean;
};

const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');
const normalize = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Same order and skip-lists as src/database/sqliteDatabase.ts applySchema(). */
export async function applyAppOpenSchema(file: string) {
  const sql = realSQLite({ fixedSqlDate: FINANCIAL_TEST_DATE, syntheticPath: file });
  try {
    sql.native.exec('PRAGMA foreign_keys = ON;');
    for (const statement of SQLITE_SCHEMA_STATEMENTS) {
      if (SHARED_LOSS_SCHEMA.includes(statement) || INSTALLMENT_HISTORY_SCHEMA.includes(statement)) continue;
      if ([...SHARED_EXPENSE_SCHEMA, ...SHARED_EXPENSE_INDEXES, ...SHARED_EXPENSE_TRIGGERS].includes(statement)) continue;
      sql.native.exec(statement);
    }
    await applyVersionedMigrations(sql.database);
  } finally { sql.native.close(); }
}

export type SchemaShape = { tables: Record<string, string[]>; indexes: Record<string, string>; triggers: Record<string, string> };
export function schemaShape(db: Db): SchemaShape {
  const master = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all();
  const shape: SchemaShape = { tables: {}, indexes: {}, triggers: {} };
  for (const entry of master) {
    const name = String(entry.name);
    if (entry.type === 'table') {
      // By name: ALTER TABLE ADD COLUMN changes column order and the stored CREATE text.
      shape.tables[name] = db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all()
        .map(column => `${String(column.name)}|${normalize(column.type).toUpperCase()}|${String(column.notnull)}|${normalize(column.dflt_value)}|${String(column.pk)}`)
        .sort();
    } else if (entry.type === 'index' && entry.sql) shape.indexes[name] = normalize(entry.sql);
    else if (entry.type === 'trigger') shape.triggers[name] = normalize(entry.sql);
  }
  return shape;
}

const referenceCache = new Map<string, SchemaShape>();
/** Expected v5 structure, generated from the current DDL and migrations on an empty synthetic file. */
export async function referenceShape(workdir: string): Promise<SchemaShape> {
  const cached = referenceCache.get(workdir);
  if (cached) return cached;
  const file = path.join(workdir, 'reference-v5.db');
  await applyAppOpenSchema(file);
  const db = new DatabaseSync(file, { readOnly: true });
  try { const shape = schemaShape(db); referenceCache.set(workdir, shape); return shape; } finally { db.close(); }
}

function compareShape(expected: SchemaShape, actual: SchemaShape): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [table, columns] of Object.entries(expected.tables)) {
    const found = actual.tables[table];
    if (!found) { out.push({ code: 'MISSING_TABLE', detail: table }); continue; }
    const missing = columns.filter(column => !found.includes(column));
    const extra = found.filter(column => !columns.includes(column));
    if (missing.length || extra.length) out.push({ code: 'COLUMN_MISMATCH', detail: `${table}: falta [${missing.join(', ')}] sobra [${extra.join(', ')}]` });
  }
  for (const table of Object.keys(actual.tables)) if (!expected.tables[table]) out.push({ code: 'UNKNOWN_TABLE', detail: table });
  for (const [name, sql] of Object.entries(expected.indexes)) {
    if (actual.indexes[name] === undefined) out.push({ code: 'MISSING_INDEX', detail: name });
    else if (actual.indexes[name] !== sql) out.push({ code: 'ALTERED_INDEX', detail: name });
  }
  for (const [name, sql] of Object.entries(expected.triggers)) {
    if (actual.triggers[name] === undefined) out.push({ code: 'MISSING_TRIGGER', detail: name });
    else if (actual.triggers[name] !== sql) out.push({ code: 'ALTERED_TRIGGER', detail: name });
  }
  return out;
}

/** Relations the schema cannot enforce with FK (by-value references) or that only use cases maintain. */
export function financialDiagnostics(db: Db): Diagnostic[] {
  const out: Diagnostic[] = [];
  const ids = (sql: string) => db.prepare(sql).all().map(row => String(Object.values(row)[0]));
  const check = (code: DiagnosticCode, sql: string) => { const found = ids(sql); if (found.length) out.push({ code, detail: found.slice(0, 5).join(', ') }); };
  const counter = db.prepare('SELECT id, revision, typeof(revision) AS t FROM financial_data_revision').all();
  if (counter.length !== 1 || counter[0]!.id !== 1 || counter[0]!.t !== 'integer' || Number(counter[0]!.revision) < 0)
    out.push({ code: 'FIN_REVISION_COUNTER', detail: JSON.stringify(counter) });
  check('FIN_ALLOCATION_PURCHASE', `SELECT a.id FROM installment_allocations a WHERE
    (a.status = 'active' AND NOT EXISTS (SELECT 1 FROM installment_purchases p WHERE p.id = a.installment_purchase_id))
    OR NOT EXISTS (SELECT 1 FROM installment_plan_revisions r WHERE r.installment_purchase_id = a.installment_purchase_id)`);
  check('FIN_ALLOCATION_PAYMENT', `SELECT a.id FROM installment_allocations a WHERE a.status = 'active' AND NOT EXISTS
    (SELECT 1 FROM transactions t WHERE t.id = a.payment_transaction_id AND t.type = 'creditCardPayment')`);
  check('FIN_ALLOCATION_CARD', `SELECT a.id FROM installment_allocations a JOIN transactions t ON t.id = a.payment_transaction_id
    JOIN installment_purchases p ON p.id = a.installment_purchase_id WHERE a.status = 'active' AND t.target_account_id IS NOT p.account_id`);
  check('FIN_ALLOCATION_AMOUNT', `SELECT a.payment_transaction_id FROM installment_allocations a JOIN transactions t ON t.id = a.payment_transaction_id
    WHERE a.status = 'active' GROUP BY a.payment_transaction_id HAVING SUM(a.amount_cents) > CAST(round(MAX(t.amount) * 100) AS INTEGER)`);
  check('FIN_ALLOCATION_CARDINALITY', `SELECT payment_transaction_id FROM installment_allocations WHERE status = 'active'
    GROUP BY payment_transaction_id HAVING COUNT(*) > 1`);
  check('FIN_ALLOCATION_REVISION', `SELECT a.id FROM installment_allocations a WHERE NOT EXISTS (SELECT 1 FROM installment_plan_revisions r
    WHERE r.allocation_id = a.id AND r.installment_purchase_id = a.installment_purchase_id AND r.source = 'allocation')`);
  check('FIN_REVERSAL_REVISION', `SELECT a.id FROM installment_allocations a WHERE a.status = 'reversed' AND NOT EXISTS
    (SELECT 1 FROM installment_plan_revisions r WHERE r.allocation_id = a.id AND r.source = 'allocationReversal')`);
  check('FIN_REVERSAL_REVISION', `SELECT r.id FROM installment_plan_revisions r JOIN installment_allocations a ON a.id = r.allocation_id
    WHERE r.source = 'allocationReversal' AND a.status <> 'reversed'`);
  check('FIN_REVISION_SEQUENCE', `SELECT installment_purchase_id FROM installment_plan_revisions GROUP BY installment_purchase_id
    HAVING MIN(revision_number) <> 0 OR MAX(revision_number) <> COUNT(*) - 1`);
  check('FIN_REMOVED_PURCHASE_HISTORY', `SELECT r.installment_purchase_id FROM installment_plan_revisions r
    WHERE NOT EXISTS (SELECT 1 FROM installment_purchases p WHERE p.id = r.installment_purchase_id)
    AND r.revision_number = (SELECT MAX(x.revision_number) FROM installment_plan_revisions x WHERE x.installment_purchase_id = r.installment_purchase_id)
    AND r.source <> 'purchaseRemoval'`);
  const reasons = new Set<string>(INSTALLMENT_PLAN_PENDING_REASONS);
  const unknown = db.prepare("SELECT id, pending_reasons FROM installment_plan_revisions WHERE pending_reasons IS NOT NULL").all()
    .filter(row => String(row.pending_reasons).split(',').some(reason => !reasons.has(reason)));
  if (unknown.length) out.push({ code: 'FIN_PENDING_REASON', detail: unknown.slice(0, 5).map(row => `${String(row.id)}=${String(row.pending_reasons)}`).join(', ') });
  check('FIN_FIRST_CYCLE', `SELECT f.installment_purchase_id FROM installment_first_cycles f JOIN installment_purchases p
    ON p.id = f.installment_purchase_id JOIN accounts c ON c.id = p.account_id WHERE c.type <> 'creditCard'`);
  check('FIN_BILLING_RULE', `SELECT b.account_id FROM credit_card_billing_rules b JOIN accounts c ON c.id = b.account_id WHERE c.type <> 'creditCard'`);
  check('FIN_PURCHASE_CARD', `SELECT p.id FROM installment_purchases p LEFT JOIN accounts c ON c.id = p.account_id
    WHERE c.id IS NULL OR c.type <> 'creditCard' OR p.installment_count < 1`);
  check('FIN_COMMAND_EVIDENCE', `SELECT command_id FROM installment_allocations GROUP BY command_id HAVING COUNT(DISTINCT payment_transaction_id) > 1`);
  const lifecycle = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = '__smartfin_financial_lifecycle_v1'").all();
  if (lifecycle.length && /"phase"\s*:\s*"cleanupPending"/.test(String(lifecycle[0]!.setting_value)))
    out.push({ code: 'DELETION_PENDING', detail: 'copia tomada durante un borrado financiero' });
  return out;
}

function summary(db: Db, schemaVersion: number): CandidateSummary {
  const n = (sql: string) => Number(db.prepare(sql).all()[0]!.n);
  return {
    schemaVersion,
    financialRevision: n('SELECT revision AS n FROM financial_data_revision WHERE id = 1'),
    accounts: n('SELECT COUNT(*) AS n FROM accounts'),
    transactions: n('SELECT COUNT(*) AS n FROM transactions'),
    purchases: n('SELECT COUNT(*) AS n FROM installment_purchases'),
    activeAllocations: n("SELECT COUNT(*) AS n FROM installment_allocations WHERE status = 'active'"),
    reversedAllocations: n("SELECT COUNT(*) AS n FROM installment_allocations WHERE status = 'reversed'"),
    revisions: n('SELECT COUNT(*) AS n FROM installment_plan_revisions'),
    pendingRevisions: n("SELECT COUNT(*) AS n FROM installment_plan_revisions WHERE verification = 'pendingVerification'"),
    statements: n('SELECT COUNT(*) AS n FROM credit_card_statements'),
  };
}

type Inspection = { diagnostics: Diagnostic[]; versions: number[]; integrityPassed: boolean };
/** Read-only inspection. Opens only the private copy, never writes. */
function inspect(file: string, expected: SchemaShape | undefined): Inspection {
  const diagnostics: Diagnostic[] = [];
  let db: Db;
  try { db = new DatabaseSync(file, { readOnly: true }); }
  catch (error) { return { diagnostics: [{ code: 'OPEN_FAILED', detail: (error as Error).message }], versions: [], integrityPassed: false }; }
  let versions: number[] = [];
  let integrityPassed = false;
  try {
    db.exec('PRAGMA foreign_keys = ON;'); // connection-local; Android RO connections skip the configuration flag
    const integrity = db.prepare('PRAGMA integrity_check').all().map(row => String(Object.values(row)[0]));
    integrityPassed = integrity.join() === 'ok';
    if (!integrityPassed) return { diagnostics: [{ code: 'INTEGRITY', detail: integrity.slice(0, 3).join('; ') }], versions, integrityPassed };
    const fk = db.prepare('PRAGMA foreign_key_check').all();
    if (fk.length) diagnostics.push({ code: 'FOREIGN_KEY', detail: fk.slice(0, 3).map(row => `${String(row.table)}→${String(row.parent)}`).join(', ') });
    const userVersion = Number(db.prepare('PRAGMA user_version').all()[0]!.user_version);
    if (userVersion !== 0) diagnostics.push({ code: 'USER_VERSION', detail: String(userVersion) });
    const hasMigrations = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_migrations'").all()[0]!.n;
    if (!hasMigrations) { diagnostics.push({ code: 'NO_MIGRATIONS', detail: 'versión no verificable' }); return { diagnostics, versions, integrityPassed }; }
    versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => Number(row.version));
    if (!versions.length) diagnostics.push({ code: 'NO_MIGRATIONS', detail: 'registro vacío' });
    if (versions.some(version => version > KNOWN_SCHEMA_VERSION)) diagnostics.push({ code: 'FUTURE_VERSION', detail: String(Math.max(...versions)) });
    if (versions.some((version, index) => version !== index + 1)) diagnostics.push({ code: 'NON_CONTIGUOUS_VERSIONS', detail: versions.join(',') });
    if (diagnostics.length || !expected) return { diagnostics, versions, integrityPassed };
    diagnostics.push(...compareShape(expected, schemaShape(db)));
    if (!diagnostics.length) diagnostics.push(...financialDiagnostics(db));
    return { diagnostics, versions, integrityPassed };
  } catch (error) {
    diagnostics.push({ code: 'OPEN_FAILED', detail: (error as Error).message });
    return { diagnostics, versions, integrityPassed };
  } finally { db.close(); }
}

/** Validates `source` without ever opening it with SQLite. `stagingDir` must be private and new. */
export async function validateRestoreCandidate(source: string, stagingDir: string, referenceDir: string): Promise<ValidationResult> {
  if (!fs.existsSync(source)) return { status: 'rejected', diagnostics: [{ code: 'FILE_MISSING', detail: source }] };
  const size = fs.statSync(source).size;
  if (size < 512 || size > MAX_CANDIDATE_BYTES) return { status: 'rejected', diagnostics: [{ code: 'FILE_SIZE', detail: String(size) }] };
  fs.mkdirSync(stagingDir, { recursive: true });
  // Android: streaming copy from ContentResolver.openInputStream(uri) with the digest computed while reading.
  const bytes = fs.readFileSync(source);
  const sourceSha256 = sha256(bytes);
  const staged = path.join(stagingDir, 'candidate.db');
  fs.writeFileSync(staged, bytes);
  const stagedSha256 = sha256(fs.readFileSync(staged));
  const base = { sourceSha256, stagedSha256 };
  if (stagedSha256 !== sourceSha256) return { ...base, status: 'rejected', diagnostics: [{ code: 'FILE_SIZE', detail: 'copia privada distinta' }] };
  if (HEADER.some((value, index) => bytes[index] !== value)) return { ...base, status: 'rejected', diagnostics: [{ code: 'NOT_SQLITE', detail: 'cabecera' }] };
  const rawPageSize = bytes[16]! * 256 + bytes[17]!;
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  const pages = ((bytes[28]! * 256 + bytes[29]!) * 256 + bytes[30]!) * 256 + bytes[31]!;
  const headerSizeValid = bytes.slice(24, 28).every((value, index) => value === bytes[92 + index]);
  if (pageSize < 512 || !Number.isInteger(Math.log2(pageSize)) || size % pageSize !== 0 || (headerSizeValid && pages * pageSize !== size))
    return { ...base, status: 'rejected', diagnostics: [{ code: 'TRUNCATED', detail: `tamaño ${size}, página ${pageSize}, páginas en cabecera ${pages}` }] };

  let validated = staged;
  if (bytes[18] === 2 || bytes[19] === 2) {
    // WAL header: normalize only a separate work copy (a writable connection is required).
    validated = path.join(stagingDir, 'work.db');
    fs.copyFileSync(staged, validated);
    const work = new DatabaseSync(validated);
    try { work.exec('PRAGMA journal_mode = DELETE;'); } finally { work.close(); }
  }
  const expected = await referenceShape(referenceDir);
  const first = inspect(validated, undefined);
  if (first.diagnostics.length) return { ...base, status: 'rejected', diagnostics: first.diagnostics, integrityPassed: first.integrityPassed };
  let migratedFrom: number | undefined;
  if (Math.max(...first.versions) < KNOWN_SCHEMA_VERSION) {
    migratedFrom = Math.max(...first.versions);
    const work = path.join(stagingDir, 'migrated.db');
    fs.copyFileSync(validated, work);
    try { await applyAppOpenSchema(work); }
    catch (error) { return { ...base, status: 'rejected', diagnostics: [{ code: 'MIGRATION_FAILED', detail: (error as Error).message }], migratedFrom }; }
    validated = work;
  }
  const full = inspect(validated, expected); // always from scratch, also after migration
  if (full.diagnostics.length) return { ...base, status: 'rejected', diagnostics: full.diagnostics, migratedFrom, integrityPassed: full.integrityPassed };
  const db = new DatabaseSync(validated, { readOnly: true });
  let candidateSummary: CandidateSummary;
  try { candidateSummary = summary(db, KNOWN_SCHEMA_VERSION); } finally { db.close(); }
  return {
    ...base, status: migratedFrom === undefined ? 'accepted' : 'acceptedAfterMigration', diagnostics: [], validatedFile: validated,
    migratedFrom, fingerprint: contentFingerprint(validated), summary: candidateSummary, integrityPassed: true,
  };
}
