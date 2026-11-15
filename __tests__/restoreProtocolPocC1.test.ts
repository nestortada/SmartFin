// PRUEBA DE CONCEPTO DESCARTABLE — Etapa C1 (diseño de restauración segura).
// No es la implementación final, no toca src/ ni android/ y NO valida ningún mecanismo Android:
// el sistema de archivos es el de Node (en Windows, rename no tiene las garantías POSIX), los
// "cierres inesperados" son excepciones inyectadas y no existe coordinación de conexiones real.
// Lo que sí comprueba: que el protocolo de generaciones + puntero + diario, con recuperación al
// arrancar, deja SIEMPRE activa una base íntegra igual a la anterior o a la candidata (nunca una
// mezcla ni una base vacía), sin modificar el archivo elegido por el usuario ni la base anterior.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { manageSQLiteDatabase } from '../src/database/managedSQLite';
import { SHARED_LOSS_SCHEMA } from '../src/modules/transactions/database/sharedLossSchema';
import { INSTALLMENT_HISTORY_SCHEMA } from '../src/modules/creditCards/database/installmentHistorySchema';
import {
  SHARED_EXPENSE_INDEXES,
  SHARED_EXPENSE_SCHEMA,
  SHARED_EXPENSE_TRIGGERS,
} from '../src/modules/transactions/database/sharedExpenseSchema';
import { createSqliteAccountRepository } from '../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { registerExtraordinaryInstallmentPayment } from '../src/modules/creditCards/useCases/extraordinaryInstallmentPayment';

type Row = Record<string, unknown>;
type Db = {
  exec: (sql: string) => void;
  prepare: (sql: string) => { all: (...values: unknown[]) => Row[]; run: (...values: unknown[]) => unknown };
  close: () => void;
};
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => Db };
const fs = require('node:fs') as {
  mkdtempSync: (prefix: string) => string; mkdirSync: (dir: string, options: { recursive: boolean }) => void;
  rmSync: (target: string, options: { recursive: boolean; force: boolean }) => void; readFileSync: (file: string) => Uint8Array;
  writeFileSync: (file: string, data: string | Uint8Array) => void; copyFileSync: (from: string, to: string) => void;
  existsSync: (file: string) => boolean; renameSync: (from: string, to: string) => void; readdirSync: (dir: string) => string[];
  statSync: (file: string) => { size: number }; unlinkSync: (file: string) => void;
};
const path = require('node:path') as { join: (...parts: string[]) => string };
const os = require('node:os') as { tmpdir: () => string };
const crypto = require('node:crypto') as {
  createHash: (algorithm: string) => { update: (data: Uint8Array | string) => { digest: (encoding: 'hex') => string } };
};
const util = require('node:util') as {
  TextDecoder: new () => { decode: (bytes: Uint8Array) => string };
  TextEncoder: new () => { encode: (text: string) => Uint8Array };
};
const decoder = new util.TextDecoder();

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartfin-poc-c1-'));
afterAll(() => { try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* Windows file locks */ } });
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const KNOWN_MAX_VERSION = 5;
const MAX_CANDIDATE_BYTES = 512 * 1024 * 1024;
const SQLITE_HEADER = 'SQLite format 3\u0000';

/** Same order and skip-lists as src/database/sqliteDatabase.ts applySchema() (only for reference/migration copies). */
async function appOpenSchema(file: string) {
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

const normalize = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
/** Structure: tables/columns by name (ALTER ADD COLUMN changes order and stored text), indexes and triggers. */
function structure(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const master = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    const tables: Record<string, string[]> = {};
    for (const entry of master.filter(row => row.type === 'table')) {
      tables[String(entry.name)] = db.prepare(`PRAGMA table_info("${String(entry.name)}")`).all()
        .map(column => `${String(column.name)}:${normalize(column.type)}:${String(column.notnull)}:${normalize(column.dflt_value)}:${String(column.pk)}`)
        .sort();
    }
    const indexes = master.filter(row => row.type === 'index').map(row => `${String(row.name)}|${normalize(row.sql)}`).sort();
    const triggers = master.filter(row => row.type === 'trigger').map(row => `${String(row.name)}|${normalize(row.sql)}`).sort();
    return { tables, indexes, triggers };
  } finally { db.close(); }
}
let reference: ReturnType<typeof structure> | undefined;
async function referenceStructure() {
  if (!reference) {
    const file = path.join(workdir, 'reference.db');
    await appOpenSchema(file);
    reference = structure(file);
  }
  return reference;
}

/** Canonical content digest: every table, every column, deterministic order (no file bytes). */
function contentDigest(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const hash = crypto.createHash('sha256');
    let text = '';
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
      const columns = db.prepare(`PRAGMA table_info("${String(name)}")`).all().map(column => `"${String(column.name)}"`).sort();
      const rows = db.prepare(`SELECT ${columns.join(',')} FROM "${String(name)}" ORDER BY ${columns.join(',')}`).all();
      text += `${String(name)}\n${JSON.stringify(rows)}\n`;
    }
    return hash.update(text).digest('hex');
  } finally { db.close(); }
}

/** Defense in depth: relations without FK, checked on the read-only staged copy. */
function financialInvariantViolations(db: Db): string[] {
  const failures: string[] = [];
  const count = (sql: string) => Number(db.prepare(sql).all()[0]!.n);
  if (count('SELECT COUNT(*) AS n FROM financial_data_revision WHERE id = 1') !== 1) failures.push('financial_data_revision ausente');
  if (count(`SELECT COUNT(*) AS n FROM installment_allocations a
      WHERE NOT EXISTS (SELECT 1 FROM installment_purchases p WHERE p.id = a.installment_purchase_id)
      AND NOT EXISTS (SELECT 1 FROM installment_plan_revisions r WHERE r.installment_purchase_id = a.installment_purchase_id)`))
    failures.push('imputación sin compra ni historial');
  if (count(`SELECT COUNT(*) AS n FROM installment_allocations a WHERE a.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = a.payment_transaction_id AND t.type = 'creditCardPayment')`))
    failures.push('imputación activa sin pago de tarjeta');
  if (count(`SELECT COUNT(*) AS n FROM installment_allocations a WHERE a.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM installment_plan_revisions r WHERE r.installment_purchase_id = a.installment_purchase_id
        AND r.source = 'allocation' AND r.allocation_id = a.id)`))
    failures.push('imputación activa sin revisión allocation');
  if (count(`SELECT COUNT(*) AS n FROM (SELECT installment_purchase_id, COUNT(*) c, MAX(revision_number) m, MIN(revision_number) z
      FROM installment_plan_revisions GROUP BY installment_purchase_id) WHERE z <> 0 OR m <> c - 1`))
    failures.push('numeración de revisiones no contigua');
  if (count('SELECT COUNT(*) AS n FROM (SELECT command_id FROM installment_allocations GROUP BY command_id, payment_transaction_id HAVING COUNT(*) > 1)'))
    failures.push('command_id duplicado para el mismo pago');
  return failures;
}

type Validation = { ok: true; staged: string; digest: string; sha: string; migratedFrom?: number } | { ok: false; reasons: string[] };

/** C2 model: copy the selected file into a private staging copy; never write the source. */
async function validateCandidate(source: string, label: string): Promise<Validation> {
  const reasons: string[] = [];
  if (!fs.existsSync(source)) return { ok: false, reasons: ['archivo inexistente'] };
  const size = fs.statSync(source).size;
  if (size < 512 || size > MAX_CANDIDATE_BYTES) return { ok: false, reasons: [`tamaño fuera de límites: ${size}`] };
  const staging = path.join(workdir, `staging-${label}.db`);
  fs.copyFileSync(source, staging); // Android: streaming copy from the SAF URI + SHA-256 while reading
  const bytes = fs.readFileSync(staging);
  if (decoder.decode(bytes.subarray(0, 16)) !== SQLITE_HEADER) return { ok: false, reasons: ['cabecera SQLite inválida'] };
  if (bytes[18] === 2 || bytes[19] === 2) {
    // WAL header: normalize only on the private work copy (needs a writable connection).
    const work = new DatabaseSync(staging);
    try { work.exec('PRAGMA journal_mode = DELETE;'); } finally { work.close(); }
  }
  let db: Db;
  try { db = new DatabaseSync(staging, { readOnly: true }); } catch (error) { return { ok: false, reasons: [`no abre: ${(error as Error).message}`] }; }
  let versions: number[] = [];
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    const integrity = db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]);
    if (integrity.join() !== 'ok') reasons.push(`integrity_check: ${integrity.slice(0, 3).join('; ')}`);
    if (db.prepare('PRAGMA foreign_key_check').all().length) reasons.push('foreign_key_check con violaciones');
    if (Number(db.prepare('PRAGMA user_version').all()[0]!.user_version) !== 0) reasons.push('user_version desconocido');
    const hasMigrations = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_migrations'").all()[0]!.n;
    versions = hasMigrations ? db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => Number(row.version)) : [];
    if (!versions.length) reasons.push('sin schema_migrations: versión no verificable');
    if (versions.some(version => version > KNOWN_MAX_VERSION)) reasons.push(`esquema futuro: versión ${Math.max(...versions)}`);
    if (versions.some((version, index) => version !== index + 1)) reasons.push('versiones de migración no contiguas');
  } catch (error) {
    reasons.push(`lectura fallida: ${(error as Error).message}`);
  } finally { db.close(); }
  if (reasons.length) return { ok: false, reasons };

  // Old but known schema: migrate ONLY the private work copy, then validate it again from scratch.
  let migratedFrom: number | undefined;
  if (Math.max(...versions) < KNOWN_MAX_VERSION) {
    migratedFrom = Math.max(...versions);
    await appOpenSchema(staging);
  }
  const expected = await referenceStructure();
  const actual = structure(staging);
  for (const [table, columns] of Object.entries(expected.tables)) {
    if (!actual.tables[table]) { reasons.push(`tabla ausente: ${table}`); continue; }
    const missing = columns.filter(column => !actual.tables[table]!.includes(column));
    if (missing.length) reasons.push(`columnas distintas en ${table}: ${missing.join(', ')}`);
  }
  for (const table of Object.keys(actual.tables)) if (!expected.tables[table]) reasons.push(`tabla desconocida: ${table}`);
  for (const index of expected.indexes) if (!actual.indexes.includes(index)) reasons.push(`índice ausente o distinto: ${index.split('|')[0]}`);
  for (const trigger of expected.triggers) if (!actual.triggers.includes(trigger)) reasons.push(`trigger ausente o distinto: ${trigger.split('|')[0]}`);
  if (reasons.length) return { ok: false, reasons };
  const ro = new DatabaseSync(staging, { readOnly: true });
  try { reasons.push(...financialInvariantViolations(ro)); } finally { ro.close(); }
  if (reasons.length) return { ok: false, reasons };
  return { ok: true, staged: staging, digest: contentDigest(staging), sha: sha256(staging), migratedFrom };
}

// ---------------------------------------------------------------------------------------------
// Protocol model: generations + atomic pointer + durable journal + recovery before any open.
// ---------------------------------------------------------------------------------------------
class Crash extends Error {}
type Env = { dir: string; crashAt?: number; steps: number; busy: boolean; verifyFails?: boolean };
type Journal = { id: string; phase: 'staging' | 'switching' | 'verifying' | 'completed' | 'failed'; candidate: string; previous: string; digest: string };
const LEGACY = 'smartfin.db';
const pointerFile = (env: Env) => path.join(env.dir, 'smartfin-active.json');
const journalFile = (env: Env) => path.join(env.dir, 'smartfin-restore-journal.json');

function step(env: Env, _name: string) { env.steps += 1; if (env.crashAt === env.steps) throw new Crash(_name); }
/** AtomicFile-like: whole new file then one rename (a crash leaves at most an ignored *.tmp). */
function writeJson(env: Env, file: string, value: unknown, label: string) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
  step(env, `${label}:tmp-written`);
  fs.renameSync(`${file}.tmp`, file);
  step(env, `${label}:renamed`);
}
const readJson = <T>(file: string): T | undefined => (fs.existsSync(file) ? JSON.parse(decoder.decode(fs.readFileSync(file))) as T : undefined);
const activeName = (env: Env) => readJson<{ active: string }>(pointerFile(env))?.active ?? LEGACY;
const removeIfExists = (file: string) => { if (fs.existsSync(file)) fs.unlinkSync(file); };

function verifyGeneration(env: Env, name: string, digest: string) {
  if (env.verifyFails) return false;
  const file = path.join(env.dir, name);
  if (!fs.existsSync(file)) return false;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]).join() !== 'ok') return false;
    db.exec('PRAGMA foreign_keys = ON;');
    if (db.prepare('PRAGMA foreign_key_check').all().length) return false;
  } finally { db.close(); }
  return contentDigest(file) === digest; // corresponde a la copia elegida, no a una mezcla
}

let sequence = 0;
function restore(env: Env, candidate: Extract<Validation, { ok: true }>) {
  if (env.busy) throw new Error('restauración en curso');
  const pending = readJson<Journal>(journalFile(env));
  if (pending) throw new Error('hay una restauración pendiente: ejecutar recuperación primero');
  const previous = activeName(env);
  if (contentDigest(path.join(env.dir, previous)) === candidate.digest) return 'alreadyActive';
  env.busy = true;
  try {
    const id = `r${++sequence}`;
    const journal: Journal = { id, phase: 'staging', candidate: `smartfin-${id}.db`, previous, digest: candidate.digest };
    writeJson(env, journalFile(env), journal, 'journal-staging');
    const part = path.join(env.dir, `${journal.candidate}.part`);
    fs.copyFileSync(candidate.staged, part);              // Android: FileOutputStream + fd.sync()
    step(env, 'candidate-copied');
    if (sha256(part) !== candidate.sha) throw new Error('copia de la candidata alterada');
    fs.renameSync(part, path.join(env.dir, journal.candidate));
    step(env, 'candidate-installed');
    writeJson(env, journalFile(env), { ...journal, phase: 'switching' }, 'journal-switching');
    writeJson(env, pointerFile(env), { active: journal.candidate, previous }, 'pointer');
    writeJson(env, journalFile(env), { ...journal, phase: 'verifying' }, 'journal-verifying');
    if (!verifyGeneration(env, journal.candidate, journal.digest)) {
      writeJson(env, pointerFile(env), { active: previous }, 'pointer-rollback');
      writeJson(env, journalFile(env), { ...journal, phase: 'failed' }, 'journal-failed');
      return 'failedRolledBack';
    }
    writeJson(env, journalFile(env), { ...journal, phase: 'completed' }, 'journal-completed');
    removeIfExists(journalFile(env));
    step(env, 'journal-cleared');
    return 'completed';
  } finally { env.busy = false; }
}

/** Runs at start-up BEFORE any SQLite open. The previous generation is never written or deleted here. */
function recover(env: Env): string {
  for (const name of fs.readdirSync(env.dir)) if (name.endsWith('.tmp')) fs.unlinkSync(path.join(env.dir, name));
  const journal = readJson<Journal>(journalFile(env));
  if (!journal) return 'clean';
  const env2: Env = { ...env, crashAt: undefined };
  const rollback = (outcome: string) => {
    if (activeName(env2) !== journal.previous) writeJson(env2, pointerFile(env2), { active: journal.previous }, 'recover-pointer');
    removeIfExists(path.join(env.dir, `${journal.candidate}.part`));
    if (outcome === 'rolledBack') removeIfExists(path.join(env.dir, journal.candidate));
    removeIfExists(journalFile(env));
    return outcome;
  };
  const pointerOnCandidate = activeName(env2) === journal.candidate;
  if (journal.phase === 'failed') return rollback('failedRolledBack');
  if (journal.phase === 'staging' || (!pointerOnCandidate && journal.phase !== 'completed')) return rollback('rolledBack');
  if (verifyGeneration(env2, journal.candidate, journal.digest)) {
    if (!pointerOnCandidate) writeJson(env2, pointerFile(env2), { active: journal.candidate, previous: journal.previous }, 'recover-pointer');
    removeIfExists(journalFile(env));
    return 'completed';
  }
  return rollback('failedRolledBack'); // candidate kept for diagnosis
}

// ---------------------------------------------------------------------------------------------
async function syntheticBase(file: string, amount: number) {
  const f = await financialIntegrityFixture({ managed: true, syntheticPath: file });
  const saved = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '6', amount, merchantName: `Compra ${amount}` });
  await registerExtraordinaryInstallmentPayment({
    accountRepository: f.accountRepository, creditCardRepository: f.creditCardRepository, transactionRepository: f.transactionRepository,
    cardAccountId: 'card', installmentPurchaseId: `installment-${saved.transaction.id}`, sourceAccountId: 'bank',
    paymentAmount: 100000, allocatedAmount: 100000, mode: 'unspecified', commandId: `cmd-${amount}`, currentDate: FINANCIAL_TEST_DATE,
  });
  f.native.close();
  return `installment-${saved.transaction.id}`;
}
async function newEnv(label: string) {
  const dir = path.join(workdir, `env-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  await syntheticBase(path.join(dir, LEGACY), 600000); // base activa anterior (legado: sin puntero)
  return { dir, steps: 0, busy: false } as Env;
}
let backupFile: string;
beforeAll(async () => {
  backupFile = path.join(workdir, 'respaldo-elegido.db');
  await syntheticBase(backupFile, 900000);
});

describe('C1 PoC — validación de candidatas (modelo de C2, solo lectura del archivo elegido)', () => {
  test('acepta un respaldo actual y no modifica el archivo elegido', async () => {
    const before = sha256(backupFile);
    const result = await validateCandidate(backupFile, 'actual');
    expect(result).toMatchObject({ ok: true });
    expect(sha256(backupFile)).toBe(before);
  });

  test.each([
    ['truncado', (bytes: Uint8Array) => bytes.subarray(0, Math.floor(bytes.length / 2)), /integrity_check|no abre|lectura fallida/],
    ['cabecera alterada', (bytes: Uint8Array) => { const copy = new Uint8Array(bytes); copy[0] = 0; return copy; }, /cabecera/],
    ['no SQLite', () => new util.TextEncoder().encode('x'.repeat(4096)), /cabecera/],
    ['vacío', () => new Uint8Array(0), /tamaño/],
  ])('rechaza archivo %s con diagnóstico', async (label, mutate, reason) => {
    const file = path.join(workdir, `cand-${label}.db`);
    fs.writeFileSync(file, mutate(fs.readFileSync(backupFile)));
    const result = await validateCandidate(file, label);
    expect(result.ok).toBe(false);
    expect((result as { reasons: string[] }).reasons.join(' | ')).toMatch(reason);
  });

  test('rechaza un esquema futuro sin migrarlo ni abrirlo como base activa', async () => {
    const file = path.join(workdir, 'cand-v6.db');
    fs.copyFileSync(backupFile, file);
    const db = new DatabaseSync(file); db.exec("INSERT INTO schema_migrations VALUES (6, '2027-01-01T00:00:00.000Z')"); db.close();
    const result = await validateCandidate(file, 'v6');
    expect(result).toEqual({ ok: false, reasons: ['esquema futuro: versión 6'] });
  });

  test('rechaza un esquema incompleto (tabla de la migración 5 ausente) con diagnóstico', async () => {
    const file = path.join(workdir, 'cand-incompleto.db');
    fs.copyFileSync(backupFile, file);
    const db = new DatabaseSync(file); db.exec('DROP TABLE installment_first_cycles'); db.close();
    const result = await validateCandidate(file, 'incompleto');
    expect((result as { reasons: string[] }).reasons).toContain('tabla ausente: installment_first_cycles');
  });

  test('rechaza una relación financiera manipulada aunque estructura y FK sean correctas', async () => {
    const file = path.join(workdir, 'cand-manipulado.db');
    fs.copyFileSync(backupFile, file);
    const db = new DatabaseSync(file);
    const trigger = String(db.prepare("SELECT sql FROM sqlite_master WHERE name='installment_allocations_validate_insert'").all()[0]!.sql);
    db.exec('DROP TRIGGER installment_allocations_validate_insert');
    db.exec("INSERT INTO installment_allocations VALUES ('x','tx-inexistente','compra-inexistente',100,'unspecified','active','cmd-x','2026-10-11T12:00:00.000Z',NULL)");
    db.exec(trigger);
    db.close();
    const result = await validateCandidate(file, 'manipulado');
    expect((result as { reasons: string[] }).reasons).toEqual(expect.arrayContaining(['imputación sin compra ni historial', 'imputación activa sin pago de tarjeta']));
  });

  test('esquema antiguo (v4 reconstruido): migra solo la copia privada y la revalida; el original queda intacto', async () => {
    const file = path.join(workdir, 'cand-v4.db');
    fs.copyFileSync(backupFile, file);
    const db = new DatabaseSync(file);
    for (const row of db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND (sql LIKE '%installment_allocations%'
        OR sql LIKE '%installment_plan_revisions%' OR sql LIKE '%credit_card_billing_rules%' OR sql LIKE '%installment_first_cycles%')`).all())
      db.exec(`DROP TRIGGER "${String(row.name)}"`);
    for (const table of ['installment_first_cycles', 'credit_card_billing_rules', 'installment_plan_revisions', 'installment_allocations'])
      db.exec(`DROP TABLE ${table}`);
    db.exec('DELETE FROM schema_migrations WHERE version = 5');
    db.close();
    const before = sha256(file);
    const result = await validateCandidate(file, 'v4');
    expect(result).toMatchObject({ ok: true, migratedFrom: 4 });
    expect(sha256(file)).toBe(before);
  });
});

describe('C1 PoC — protocolo de sustitución recuperable (sin garantías Android)', () => {
  let candidate: Extract<Validation, { ok: true }>;
  beforeAll(async () => {
    const result = await validateCandidate(backupFile, 'protocolo');
    if (!result.ok) throw new Error(result.reasons.join(', '));
    candidate = result;
  });

  test('sin fallos: activa la candidata, verifica su contenido y conserva intacta la generación anterior', async () => {
    const env = await newEnv('ok');
    const oldSha = sha256(path.join(env.dir, LEGACY));
    expect(restore(env, candidate)).toBe('completed');
    expect(contentDigest(path.join(env.dir, activeName(env)))).toBe(candidate.digest);
    expect(sha256(path.join(env.dir, LEGACY))).toBe(oldSha);
    expect(restore(env, candidate)).toBe('alreadyActive'); // repetir no crea otra generación
  });

  test('cierre inesperado en CADA punto: tras recuperar, la base activa es exactamente la anterior o la candidata', async () => {
    const probe = await newEnv('count');
    restore(probe, candidate);
    const totalSteps = probe.steps;
    expect(totalSteps).toBeGreaterThan(8);
    const outcomes: string[] = [];
    for (let crashAt = 1; crashAt <= totalSteps; crashAt++) {
      const env = await newEnv(`crash-${crashAt}`);
      const oldDigest = contentDigest(path.join(env.dir, LEGACY));
      const oldSha = sha256(path.join(env.dir, LEGACY));
      env.crashAt = crashAt;
      expect(() => restore(env, candidate)).toThrow(Crash);
      env.busy = false; // un proceso nuevo no hereda el cerrojo en memoria
      const outcome = recover(env);
      const active = path.join(env.dir, activeName(env));
      const digest = contentDigest(active);
      expect([oldDigest, candidate.digest]).toContain(digest);
      expect(sha256(path.join(env.dir, LEGACY))).toBe(oldSha);
      expect(fs.readdirSync(env.dir).filter(name => name.endsWith('.tmp') || name.endsWith('.part'))).toEqual([]);
      expect(fs.existsSync(journalFile(env))).toBe(false);
      // 'clean' = no había diario: o el cierre fue antes de escribirlo o después de completar.
      if (outcome === 'completed') expect(digest).toBe(candidate.digest);
      if (outcome === 'rolledBack' || outcome === 'failedRolledBack') expect(digest).toBe(oldDigest);
      outcomes.push(`${crashAt}:${outcome}`);
      expect(recover(env)).toBe('clean'); // la recuperación es idempotente
    }
    const target = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.SMARTFIN_POC_C1_EVIDENCE;
    if (target) fs.writeFileSync(target, JSON.stringify({ totalSteps, outcomes }, null, 1));
    expect(outcomes.some(entry => entry.endsWith(':rolledBack'))).toBe(true);
    expect(outcomes.some(entry => entry.endsWith(':completed'))).toBe(true);
  });

  test('verificación posterior fallida: vuelve a la generación anterior y conserva la candidata para diagnóstico', async () => {
    const env = await newEnv('verify-fails');
    const oldDigest = contentDigest(path.join(env.dir, LEGACY));
    env.verifyFails = true;
    expect(restore(env, candidate)).toBe('failedRolledBack');
    env.verifyFails = false;
    expect(recover(env)).toBe('failedRolledBack');
    expect(contentDigest(path.join(env.dir, activeName(env)))).toBe(oldDigest);
    expect(fs.readdirSync(env.dir).some(name => /^smartfin-r\d+\.db$/.test(name))).toBe(true);
  });

  test('doble ejecución: la segunda restauración se rechaza mientras hay una en curso o pendiente', async () => {
    const env = await newEnv('double');
    env.busy = true;
    expect(() => restore(env, candidate)).toThrow('restauración en curso');
    env.busy = false;
    env.crashAt = 5;
    expect(() => restore(env, candidate)).toThrow(Crash);
    env.crashAt = undefined;
    expect(() => restore(env, candidate)).toThrow('restauración pendiente');
    recover(env);
  });

  test('después de restaurar: apertura con el orden de la app sin escrituras de esquema, idempotencia y operación nueva única', async () => {
    const env = await newEnv('after');
    restore(env, candidate);
    const active = path.join(env.dir, activeName(env));
    const shaBeforeOpen = sha256(active);
    await appOpenSchema(active);
    expect(sha256(active)).toBe(shaBeforeOpen); // una candidata actual no recibe escrituras al abrir
    const sql = realSQLite({ fixedSqlDate: FINANCIAL_TEST_DATE, syntheticPath: active });
    try {
      sql.native.exec('PRAGMA foreign_keys = ON;');
      const database = manageSQLiteDatabase(sql.database);
      const repos = { accountRepository: createSqliteAccountRepository(database), creditCardRepository: createSqliteCreditCardRepository(database),
        transactionRepository: createSqliteTransactionRepository(database) };
      const purchaseId = String(sql.native.prepare('SELECT id FROM installment_purchases').all()[0]!.id);
      const params = { ...repos, cardAccountId: 'card', installmentPurchaseId: purchaseId, sourceAccountId: 'bank', paymentAmount: 100000,
        allocatedAmount: 100000, mode: 'unspecified' as const, commandId: 'cmd-900000', currentDate: FINANCIAL_TEST_DATE };
      sql.resetTrace();
      expect((await registerExtraordinaryInstallmentPayment(params)).status).toBe('replayed');
      expect(sql.trace.filter(entry => entry.write !== undefined)).toEqual([]);
      expect((await registerExtraordinaryInstallmentPayment({ ...params, commandId: 'post-restore', paymentAmount: 50000, allocatedAmount: 50000 })).status).toBe('registered');
      expect(Number(sql.native.prepare("SELECT COUNT(*) AS n FROM installment_allocations WHERE command_id = 'post-restore'").all()[0]!.n)).toBe(1);
    } finally { sql.native.close(); }
  });
});
