// Etapa C2: validador de respaldos, huella canónica y contrato del resolvedor (prototipos aislados).
// Solo datos sintéticos y reloj fijo. No toca src/ ni android/ y no valida nada de Android.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { realSQLite } from './helpers/realSQLite';
import { manageSQLiteDatabase } from '../src/database/managedSQLite';
import { createSqliteAccountRepository } from '../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteInstallmentHistoryRepository } from '../src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository';
import { registerExtraordinaryInstallmentPayment } from '../src/modules/creditCards/useCases/extraordinaryInstallmentPayment';
import { saveManualTransaction } from '../src/modules/transactions/useCases/saveManualTransaction';
import { serializeCreditCardVisualMetadata } from '../src/modules/creditCards/useCases/manageCreditCards';
import { applyAppOpenSchema, validateRestoreCandidate, type ValidationResult } from './helpers/c2/restoreCandidateValidator';
import { contentFingerprint, encodeValue, FINGERPRINT_FORMAT } from './helpers/c2/contentFingerprint';
import {
  connectionStillCurrent,
  resolveActiveDatabase,
  type ResolverInput,
} from './helpers/c2/databaseResolverModel';

type Row = Record<string, unknown>;
type Db = { exec: (sql: string) => void; prepare: (sql: string) => { all: (...v: unknown[]) => Row[]; run: (...v: unknown[]) => unknown }; close: () => void };
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => Db };
const fs = require('node:fs') as {
  mkdtempSync: (prefix: string) => string; rmSync: (target: string, options: { recursive: boolean; force: boolean }) => void;
  readFileSync: (file: string) => Uint8Array; writeFileSync: (file: string, data: string | Uint8Array) => void;
  copyFileSync: (from: string, to: string) => void; existsSync: (file: string) => boolean; readdirSync: (dir: string) => string[];
};
const path = require('node:path') as { join: (...parts: string[]) => string };
const os = require('node:os') as { tmpdir: () => string };
const crypto = require('node:crypto') as { createHash: (a: string) => { update: (d: Uint8Array | string) => { digest: (e: 'hex') => string } } };
const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartfin-c2-'));
afterAll(() => { try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* Windows locks */ } });
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

const NOW = FINANCIAL_TEST_DATE.toISOString();
const LATER = new Date(FINANCIAL_TEST_DATE.getTime() + 3_600_000);
let counter = 0;
const validate = (file: string) => validateRestoreCandidate(file, path.join(workdir, 'staging', `s${++counter}`), workdir);
const codes = (result: ValidationResult) => result.diagnostics.map(diagnostic => diagnostic.code);

/** Rich synthetic history: active and reversed allocations, confirmed statement, first cycle, billing rule. */
async function buildBackup(file: string) {
  const f = await financialIntegrityFixture({ managed: true, syntheticPath: file });
  f.native.prepare("UPDATE accounts SET description = ? WHERE id = 'card'").run(serializeCreditCardVisualMetadata({ closingDay: 20 }));
  const deps = { accountRepository: f.accountRepository, creditCardRepository: f.creditCardRepository, transactionRepository: f.transactionRepository };
  const history = createSqliteInstallmentHistoryRepository(f.database);
  await history.saveBillingRules({ accountId: 'card', closingDayPurchasePolicy: 'nextCycle', createdAt: NOW, updatedAt: NOW });
  const saved = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '6', amount: 600000, merchantName: 'Compra C2' });
  const purchaseId = `installment-${saved.transaction.id}`;
  const pay = (commandId: string, paymentAmount: number) => registerExtraordinaryInstallmentPayment({ ...deps, cardAccountId: 'card',
    installmentPurchaseId: purchaseId, sourceAccountId: 'bank', paymentAmount, allocatedAmount: paymentAmount, mode: 'unspecified',
    commandId, currentDate: FINANCIAL_TEST_DATE });
  await pay('cmd-activo', 100000);
  const reversed = await pay('cmd-revertido', 50000);
  await history.saveFirstCycle({ installmentPurchaseId: purchaseId, cycleEnd: '2026-10-20', source: 'user', createdAt: NOW, updatedAt: NOW });
  const payment = (await f.transactionRepository.getTransactions()).find(row => row.id === (reversed as { payment: { id: string } }).payment.id)!;
  await saveManualTransaction({ ...deps, accounts: await f.accountRepository.getAccounts(), accountId: payment.accountId, amount: 40000,
    merchantName: payment.merchantName ?? payment.description, notes: 'Pago', operationType: 'Débito', transactionType: 'creditCardPayment',
    targetAccountId: payment.targetAccountId, editingTransaction: payment, hasInterestFreeInstallments: false, installmentCountInput: '1',
    interestFreeInstallmentCountInput: '', currentDate: LATER, now: LATER });
  await f.creditCardRepository.saveStatements([{ id: 'stmt-c2', accountId: 'card', statementStartDate: '2026-09-21', statementEndDate: '2026-10-20',
    paymentDueDate: '2026-11-05', totalAmount: 600000, minimumPaymentAmount: 60000, currency: 'COP', status: 'open', createdAt: NOW, updatedAt: NOW }]);
  f.native.close();
  return purchaseId;
}

let backup: string;
let activeDb: string;
let purchaseId: string;
beforeAll(async () => {
  backup = path.join(workdir, 'respaldo.db');
  activeDb = path.join(workdir, 'activa.db');
  purchaseId = await buildBackup(backup);
  const f = await financialIntegrityFixture({ managed: true, syntheticPath: activeDb });
  await f.save({ amount: 12345, merchantName: 'Base activa' });
  f.native.close();
});

/** Copy of the good backup with raw SQL changes (simulates damaged or foreign candidates). */
function variant(name: string, mutate: (db: Db) => void) {
  const file = path.join(workdir, `variante-${name}.db`);
  fs.copyFileSync(backup, file);
  const db = new DatabaseSync(file);
  try { mutate(db); } finally { db.close(); }
  return file;
}
/** Bypasses one trigger to write an inconsistency, then restores the exact trigger text (structure stays valid). */
function withoutTrigger(db: Db, trigger: string, write: () => void) {
  const sql = String(db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').all(trigger)[0]!.sql);
  db.exec(`DROP TRIGGER ${trigger}`);
  write();
  db.exec(sql);
}

describe('C2 — validación satisfactoria y garantías de solo lectura', () => {
  test('respaldo actual válido: aceptado, con resumen; el archivo elegido, la copia privada y la base activa no cambian', async () => {
    const before = { source: sha256(backup), active: sha256(activeDb) };
    const result = await validate(backup);
    expect(result).toMatchObject({ status: 'accepted', diagnostics: [], integrityPassed: true });
    // 3 movimientos (compra y dos pagos, uno editado); 2 extractos (conciliación del ciclo + el guardado explícitamente).
    expect(result.summary).toEqual({ schemaVersion: 5, financialRevision: expect.any(Number), accounts: 3, transactions: 3, purchases: 1,
      activeAllocations: 1, reversedAllocations: 1, revisions: 4, pendingRevisions: 3, statements: 2 });
    expect(sha256(backup)).toBe(before.source);
    expect(sha256(activeDb)).toBe(before.active);
    expect(result.sourceSha256).toBe(before.source);
    expect(sha256(result.validatedFile!)).toBe(result.stagedSha256); // la inspección RO no escribió en la copia
    expect(result.fingerprint).toEqual(contentFingerprint(backup));
  });

  test('candidata con cabecera WAL: se normaliza solo en una copia de trabajo; el original queda intacto', async () => {
    const file = variant('wal', db => db.exec('PRAGMA journal_mode = WAL;'));
    expect(fs.readFileSync(file)[18]).toBe(2);
    const before = sha256(file);
    const result = await validate(file);
    expect(result.status).toBe('accepted');
    expect(result.validatedFile).toMatch(/work\.db$/);
    expect(sha256(file)).toBe(before);
    expect(result.fingerprint!.digest).toBe(contentFingerprint(backup).digest);
  });
});

describe('C2 — compatibilidad de esquemas (rechazo, migración sobre copia, aceptación)', () => {
  test('versión antigua conocida (v4 reconstruida): migración solo en copia de trabajo y revalidación completa', async () => {
    const file = variant('v4', db => {
      for (const row of db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND (sql LIKE '%installment_allocations%'
          OR sql LIKE '%installment_plan_revisions%' OR sql LIKE '%credit_card_billing_rules%' OR sql LIKE '%installment_first_cycles%')`).all())
        db.exec(`DROP TRIGGER "${String(row.name)}"`);
      for (const table of ['installment_first_cycles', 'credit_card_billing_rules', 'installment_plan_revisions', 'installment_allocations'])
        db.exec(`DROP TABLE ${table}`);
      db.exec('DELETE FROM schema_migrations WHERE version = 5');
    });
    const before = sha256(file);
    const result = await validate(file);
    expect(result).toMatchObject({ status: 'acceptedAfterMigration', migratedFrom: 4, diagnostics: [] });
    expect(result.validatedFile).toMatch(/migrated\.db$/);
    expect(sha256(file)).toBe(before);
    expect(result.summary).toMatchObject({ purchases: 1, revisions: 1, activeAllocations: 0, pendingRevisions: 1 });
  });

  test.each([
    ['migración 5 incompleta (versión 5 registrada, tabla ausente)', (db: Db) => db.exec('DROP TABLE installment_first_cycles'), 'MISSING_TABLE'],
    ['sin schema_migrations', (db: Db) => db.exec('DROP TABLE schema_migrations'), 'NO_MIGRATIONS'],
    ['versión futura', (db: Db) => db.exec("INSERT INTO schema_migrations VALUES (6, '2027-01-01T00:00:00.000Z')"), 'FUTURE_VERSION'],
    ['versiones no contiguas', (db: Db) => db.exec('DELETE FROM schema_migrations WHERE version = 3'), 'NON_CONTIGUOUS_VERSIONS'],
    ['tabla obligatoria ausente', (db: Db) => db.exec('DROP TABLE subscription_reminders'), 'MISSING_TABLE'],
    ['tabla desconocida', (db: Db) => db.exec('CREATE TABLE ajena (id TEXT)'), 'UNKNOWN_TABLE'],
    ['columna obligatoria ausente', (db: Db) => db.exec('ALTER TABLE transactions DROP COLUMN credit_card_hint'), 'COLUMN_MISMATCH'],
    ['índice ausente', (db: Db) => db.exec('DROP INDEX idx_installment_allocations_payment'), 'MISSING_INDEX'],
    ['trigger obligatorio ausente', (db: Db) => db.exec('DROP TRIGGER installment_allocations_guard_payment_delete'), 'MISSING_TRIGGER'],
    ['trigger alterado', (db: Db) => {
      db.exec('DROP TRIGGER installment_plan_revisions_no_update');
      db.exec('CREATE TRIGGER installment_plan_revisions_no_update BEFORE UPDATE ON installment_plan_revisions BEGIN SELECT 1; END');
    }, 'ALTERED_TRIGGER'],
    ['user_version desconocido', (db: Db) => db.exec('PRAGMA user_version = 7'), 'USER_VERSION'],
    ['referencia huérfana con FK', (db: Db) => {
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`INSERT INTO credit_card_billing_rules VALUES ('cuenta-fantasma', NULL, '${NOW}', '${NOW}')`);
    }, 'FOREIGN_KEY'],
  ])('%s ⇒ rechazo', async (_label, mutate, code) => {
    const file = variant(`schema-${++counter}`, mutate);
    const before = sha256(file);
    const result = await validate(file);
    expect(result.status).toBe('rejected');
    expect(codes(result)).toContain(code);
    expect(sha256(file)).toBe(before);
  });

  test('versión futura: nunca se crea una copia migrada ni se ejecuta DDL sobre ella', async () => {
    const file = variant('futura', db => db.exec("INSERT INTO schema_migrations VALUES (6, '2027-01-01T00:00:00.000Z')"));
    const staging = path.join(workdir, 'staging', 'futura');
    const result = await validateRestoreCandidate(file, staging, workdir);
    expect(codes(result)).toEqual(['FUTURE_VERSION']);
    expect(fs.readdirSync(staging)).toEqual(['candidate.db']);
    expect(sha256(path.join(staging, 'candidate.db'))).toBe(sha256(file));
  });
});

describe('C2 — relaciones financieras: integrity_check aprueba pero la candidata se rechaza', () => {
  test.each([
    ['imputación hacia una compra inexistente', (db: Db) => withoutTrigger(db, 'installment_allocations_validate_insert', () => db.exec(
      `INSERT INTO installment_allocations VALUES ('x','tx-x','compra-x',100,'unspecified','active','cmd-x','${NOW}',NULL)`)),
    ['FIN_ALLOCATION_PURCHASE', 'FIN_ALLOCATION_PAYMENT']],
    ['pago con importe menor que su imputación activa', (db: Db) => withoutTrigger(db, 'installment_allocations_guard_payment_update', () => db.exec(
      "UPDATE transactions SET amount = 1 WHERE id = 'tx-credit-card-payment-card-command-cmd-activo'")),
    ['FIN_ALLOCATION_AMOUNT']],
    ['pago imputado redirigido a otra tarjeta', (db: Db) => withoutTrigger(db, 'installment_allocations_guard_payment_update', () => db.exec(
      "UPDATE transactions SET target_account_id = 'target' WHERE id = 'tx-credit-card-payment-card-command-cmd-activo'")),
    ['FIN_ALLOCATION_CARD']],
    ['reversión sin su revisión allocationReversal', (db: Db) => db.exec(
      "DELETE FROM installment_plan_revisions WHERE source = 'allocationReversal'"), ['FIN_REVERSAL_REVISION']],
    ['revisión intermedia eliminada (historial con huecos)', (db: Db) => db.exec(
      "DELETE FROM installment_plan_revisions WHERE revision_number = 0"), ['FIN_REVISION_SEQUENCE']],
    ['motivo de verificación desconocido', (db: Db) => withoutTrigger(db, 'installment_plan_revisions_no_update', () => db.exec(
      "UPDATE installment_plan_revisions SET pending_reasons = 'motivoFuturo' WHERE revision_number = 1")), ['FIN_PENDING_REASON']],
    ['regla de facturación en una cuenta que no es tarjeta', (db: Db) => db.exec(
      `INSERT INTO credit_card_billing_rules VALUES ('bank', 'closingCycle', '${NOW}', '${NOW}')`), ['FIN_BILLING_RULE']],
    ['command_id ligado a dos pagos distintos', (db: Db) => withoutTrigger(db, 'installment_allocations_validate_insert', () => db.exec(
      `INSERT INTO installment_allocations SELECT 'dup', id, 'otra-compra', 100, 'unspecified', 'reversed', 'cmd-activo', '${NOW}', '${NOW}'
       FROM transactions WHERE type = 'expense' LIMIT 1`)), ['FIN_COMMAND_EVIDENCE']],
    ['copia tomada durante un borrado financiero', (db: Db) => db.exec(`INSERT INTO app_settings VALUES ('__smartfin_financial_lifecycle_v1',
      '{"version":1,"phase":"cleanupPending"}', '${NOW}')`), ['DELETION_PENDING']],
  ])('%s', async (_label, mutate, expected) => {
    const file = variant(`fin-${++counter}`, mutate);
    const result = await validate(file);
    expect(result.status).toBe('rejected');
    expect(result.integrityPassed).toBe(true);
    expect(codes(result)).toEqual(expect.arrayContaining(expected));
  });
});

describe('C2 — archivos corruptos, truncados o ajenos', () => {
  const write = (name: string, bytes: Uint8Array) => { const file = path.join(workdir, name); fs.writeFileSync(file, bytes); return file; };
  test('truncado a la mitad (alineado a página): TRUNCATED por la cabecera, antes de abrir SQLite', async () => {
    const bytes = fs.readFileSync(backup);
    const result = await validate(write('truncado.db', bytes.subarray(0, bytes.length / 2)));
    expect(codes(result)).toEqual(['TRUNCATED']);
  });
  test('página dañada: rechazo por integridad o apertura', async () => {
    const bytes = new Uint8Array(fs.readFileSync(backup));
    const pageSize = bytes[16]! * 256 + bytes[17]!;
    bytes[pageSize * 2] = 0x07; // tipo de página b-tree inválido
    const result = await validate(write('corrupto.db', bytes));
    expect(result.status).toBe('rejected');
    expect(['INTEGRITY', 'OPEN_FAILED']).toContain(codes(result)[0]);
  });
  test.each([
    ['no SQLite', new Uint8Array(4096).fill(0x41), 'NOT_SQLITE'],
    ['vacío', new Uint8Array(0), 'FILE_SIZE'],
  ])('%s', async (name, bytes, code) => {
    expect(codes(await validate(write(`${name}.db`, bytes)))).toEqual([code]);
  });
  test('archivo inexistente', async () => {
    expect(codes(await validate(path.join(workdir, 'no-existe.db')))).toEqual(['FILE_MISSING']);
  });
});

describe('C2 — huella canónica del contenido (formato v1)', () => {
  test('vectores de codificación exactos (referencia para la implementación Kotlin)', () => {
    expect(encodeValue('null', null)).toBe('n');
    expect(encodeValue('integer', '9007199254740993')).toBe('i16:9007199254740993'); // > 2^53, exacto como texto SQLite
    expect(encodeValue('integer', '-5')).toBe('i2:-5');
    expect(encodeValue('real', 0.1)).toBe('r:3fb999999999999a');
    expect(encodeValue('real', 710000.01)).toBe('r:4125aae0051eb852'); // verificado con Float64Array independiente
    expect(encodeValue('text', 'C3B1')).toBe('t2:c3b1'); // «ñ» en UTF-8, hex calculado por SQLite
    expect(encodeValue('blob', '00FF')).toBe('b2:00ff');
  });

  test('determinista e independiente de los bytes del archivo (VACUUM cambia el SHA-256, no la huella)', () => {
    const vacuumed = path.join(workdir, 'vacuum.db');
    const db = new DatabaseSync(backup, { readOnly: true });
    try { db.exec(`VACUUM INTO '${vacuumed.replace(/\\/g, '/').replace(/'/g, "''")}'`); } finally { db.close(); }
    expect(sha256(vacuumed)).not.toBe(sha256(backup));
    const first = contentFingerprint(backup);
    expect(contentFingerprint(backup)).toEqual(first);
    expect(contentFingerprint(vacuumed)).toEqual(first);
    expect(first.format).toBe(FINGERPRINT_FORMAT);
    expect(Object.keys(first.tables)).toEqual(expect.arrayContaining(['installment_allocations', 'installment_plan_revisions',
      'installment_first_cycles', 'credit_card_billing_rules', 'financial_data_revision', 'schema_migrations']));
  });

  test('independiente del orden de inserción y del rowid', () => {
    const make = (name: string, order: number[]) => {
      const file = path.join(workdir, name);
      const db = new DatabaseSync(file);
      db.exec('CREATE TABLE t (a INTEGER, b TEXT, c REAL)');
      const rows: [number, string, number][] = [[1, 'uno', 0.5], [2, 'dos', 1.25], [3, 'tres', 2]];
      for (const index of order) db.prepare('INSERT INTO t VALUES (?, ?, ?)').run(...rows[index]!);
      db.close();
      return contentFingerprint(file).digest;
    };
    expect(make('orden-a.db', [0, 1, 2])).toBe(make('orden-b.db', [2, 0, 1]));
  });

  test('sensible a un centavo, a la representación REAL exacta, al tipo y a NULL frente a vacío', () => {
    const tiny = (name: string, value: string) => {
      const file = path.join(workdir, `tiny-${name}.db`);
      const db = new DatabaseSync(file);
      db.exec(`CREATE TABLE t (v); INSERT INTO t VALUES (${value});`);
      db.close();
      return contentFingerprint(file).digest;
    };
    const digests = [tiny('a', '710000'), tiny('b', '710000.01'), tiny('c', '0.1 + 0.2'), tiny('d', '0.3'), tiny('e', "'100'"),
      tiny('f', '100'), tiny('g', 'NULL'), tiny('h', "''"), tiny('i', '710000.0')];
    expect(new Set(digests).size).toBe(digests.length); // 710000 (INTEGER) ≠ 710000.0 (REAL)
    const base = contentFingerprint(backup).digest;
    expect(contentFingerprint(variant('centavo', db => db.exec("UPDATE accounts SET balance_amount = balance_amount + 0.01 WHERE id = 'bank'"))).digest).not.toBe(base);
  });

  test('las claves reservadas de app_settings no alteran la huella; las demás sí', () => {
    const base = contentFingerprint(backup).digest;
    expect(contentFingerprint(variant('reservada', db => db.exec(`INSERT INTO app_settings VALUES ('__smartfin_dataset_id', 'x', '${NOW}')`))).digest).toBe(base);
    expect(contentFingerprint(variant('ajuste', db => db.exec(`INSERT INTO app_settings VALUES ('theme', 'dark', '${NOW}')`))).digest).not.toBe(base);
  });

  test('financial_data_revision no basta: mismo contador, contenido distinto, huellas distintas', () => {
    const a = variant('rev-a', db => db.exec("UPDATE accounts SET name = 'Banco A' WHERE id = 'bank'"));
    const b = variant('rev-b', db => db.exec("UPDATE accounts SET name = 'Banco B' WHERE id = 'bank'"));
    const revision = (file: string) => { const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare('SELECT revision FROM financial_data_revision').all()[0]!.revision; } finally { db.close(); } };
    expect(revision(a)).toBe(revision(b));
    expect(contentFingerprint(a).digest).not.toBe(contentFingerprint(b).digest);
  });
});

describe('C2 — idempotencia e historial íntegros sobre la candidata validada (copia aislada)', () => {
  test('abrir con el orden de la app y repetir un comando no escribe ni cambia la huella; una operación nueva sí, una vez', async () => {
    const result = await validate(backup);
    const copy = path.join(workdir, 'candidata-abierta.db');
    fs.copyFileSync(result.validatedFile!, copy);
    await applyAppOpenSchema(copy);
    expect(contentFingerprint(copy).digest).toBe(result.fingerprint!.digest);
    const sql = realSQLite({ fixedSqlDate: FINANCIAL_TEST_DATE, syntheticPath: copy });
    try {
      sql.native.exec('PRAGMA foreign_keys = ON;');
      const database = manageSQLiteDatabase(sql.database);
      const params = { accountRepository: createSqliteAccountRepository(database), creditCardRepository: createSqliteCreditCardRepository(database),
        transactionRepository: createSqliteTransactionRepository(database), cardAccountId: 'card', installmentPurchaseId: purchaseId,
        sourceAccountId: 'bank', paymentAmount: 100000, allocatedAmount: 100000, mode: 'unspecified' as const, commandId: 'cmd-activo',
        currentDate: FINANCIAL_TEST_DATE };
      sql.resetTrace();
      expect((await registerExtraordinaryInstallmentPayment(params)).status).toBe('replayed');
      expect((await registerExtraordinaryInstallmentPayment({ ...params, commandId: 'cmd-revertido', paymentAmount: 50000, allocatedAmount: 50000 })))
        .toMatchObject({ status: 'replayed', allocation: { status: 'reversed' } });
      expect(sql.trace.filter(entry => entry.write !== undefined)).toEqual([]);
    } finally { sql.native.close(); }
    expect(contentFingerprint(copy).digest).toBe(result.fingerprint!.digest);
  });
});

describe('C2 — contrato del resolvedor único (modelo puro de la tabla de decisión)', () => {
  const gen = 'smartfin-0f0e0d0c-0b0a-4908-8706-050403020100.db';
  const base: ResolverInput = { pointer: { kind: 'absent' }, journal: { kind: 'absent' }, installMarker: false, files: [], caller: 'exclusive' };
  test.each([
    ['instalación nueva (sin base, sin marcador)', {}, { action: 'createFreshInstall', name: 'smartfin.db', generationId: 'legacy' }],
    ['instalación nueva vista por un receptor nativo', { caller: 'independent' as const }, { action: 'refuse', code: 'NOT_INITIALIZED' }],
    ['instalación actual con smartfin.db (adopción sin copiar)', { files: ['smartfin.db'] }, { action: 'open', name: 'smartfin.db', generationId: 'legacy', adoptLegacy: true }],
    ['smartfin.db ya adoptada', { files: ['smartfin.db'], installMarker: true }, { action: 'open', name: 'smartfin.db', generationId: 'legacy', adoptLegacy: false }],
    ['base perdida tras haber existido (R6)', { installMarker: true }, { action: 'refuse', code: 'DATABASE_LOST' }],
    ['generación sin puntero', { files: ['smartfin.db', gen] }, { action: 'refuse', code: 'POINTER_LOST' }],
    ['puntero válido', { pointer: { kind: 'valid' as const, active: gen, generationId: 'g1', previous: 'smartfin.db' }, files: ['smartfin.db', gen] },
      { action: 'open', name: gen, generationId: 'g1', adoptLegacy: false }],
    ['puntero a generación inexistente', { pointer: { kind: 'valid' as const, active: gen, generationId: 'g1' }, files: ['smartfin.db'] },
      { action: 'refuse', code: 'ACTIVE_GENERATION_MISSING' }],
    ['puntero con ruta no permitida', { pointer: { kind: 'valid' as const, active: '../otra.db', generationId: 'g1' }, files: ['../otra.db'] },
      { action: 'refuse', code: 'POINTER_INVALID' }],
    ['puntero corrupto', { pointer: { kind: 'corrupt' as const }, files: ['smartfin.db'] }, { action: 'refuse', code: 'POINTER_CORRUPT' }],
    ['diario pendiente, dueño exclusivo', { journal: { kind: 'pending' as const, phase: 'switching' }, files: ['smartfin.db'] }, { action: 'recoverFirst' }],
    ['diario pendiente, participante independiente', { journal: { kind: 'pending' as const, phase: 'switching' }, files: ['smartfin.db'], caller: 'independent' as const },
      { action: 'refuse', code: 'RESTORE_PENDING' }],
    ['diario corrupto', { journal: { kind: 'corrupt' as const }, files: ['smartfin.db'] }, { action: 'refuse', code: 'JOURNAL_CORRUPT' }],
  ])('%s', (_label, changes, expected) => {
    expect(resolveActiveDatabase({ ...base, ...changes })).toEqual(expected);
  });

  test('una conexión residual de la generación anterior deja de ser válida tras cambiar el puntero', () => {
    const before = resolveActiveDatabase({ ...base, files: ['smartfin.db'], installMarker: true });
    const after = resolveActiveDatabase({ ...base, installMarker: true, files: ['smartfin.db', gen],
      pointer: { kind: 'valid', active: gen, generationId: 'g1', previous: 'smartfin.db' } });
    expect(connectionStillCurrent('legacy', before)).toBe(true);
    expect(connectionStillCurrent('legacy', after)).toBe(false);
    expect(connectionStillCurrent('g1', after)).toBe(true);
  });
});
