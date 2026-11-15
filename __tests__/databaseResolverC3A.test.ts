// C3A: resolvedor único y vinculación de conexiones a generaciones.
// (A) Especificación ejecutable de SmartFinDatabaseLocation.kt (port de prueba, no Android).
// (B) Integración real del código JS de producción (openSmartFinDatabase, managedSQLite, databaseLocation)
//     con SQLite real en archivos temporales y un sustituto Node del módulo nativo que delega en (A).
// Solo datos sintéticos y reloj fijo. Nada de esto es evidencia de Android.
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import { realSQLite } from './helpers/realSQLite';
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { contentFingerprint } from './helpers/c2/contentFingerprint';
// Same module registry as financialIntegrityFixture (the integration tests reset modules to simulate restarts).
import { registerExtraordinaryInstallmentPayment as fixturePay } from '../src/modules/creditCards/useCases/extraordinaryInstallmentPayment';
import { deleteManualTransactionSafely as fixtureDelete } from '../src/modules/transactions/useCases/saveManualTransaction';
import { resolveActiveDatabase as c2Resolve, type ResolverInput } from './helpers/c2/databaseResolverModel';
import {
  confirmFreshInstall as modelConfirm,
  resolve as modelResolve,
  Unavailable,
  withDatabaseFile,
  workerResult,
  type DeviceState,
} from './helpers/c3a/locationModel';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
type Fs = {
  mkdtempSync: (prefix: string) => string; rmSync: (target: string, options: { recursive: boolean; force: boolean }) => void;
  existsSync: (file: string) => boolean; readFileSync: (file: string) => Uint8Array; unlinkSync: (file: string) => void;
};
const fs = require('node:fs') as Fs;
const { join } = require('node:path') as { join: (...parts: string[]) => string };
const { tmpdir } = require('node:os') as { tmpdir: () => string };
const crypto = require('node:crypto') as { createHash: (a: string) => { update: (d: Uint8Array) => { digest: (e: 'hex') => string } } };
const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const NOW = FINANCIAL_TEST_DATE.toISOString();

const device = (changes: Partial<DeviceState> = {}): DeviceState =>
  ({ metadata: null, journal: false, files: new Map(), metadataWrites: 0, ...changes });
const refusal = (operation: () => unknown) => { try { operation(); } catch (error) { return error as Unavailable; } throw new Error('expected refusal'); };

// ─── (A) Especificación de la tabla de decisión Kotlin ───────────────────────
describe('C3A (A) — tabla de decisión de SmartFinDatabaseLocation (especificación ejecutable)', () => {
  test('instalación nueva legítima: solo el dueño JS inicializa; queda "initializing" hasta confirmar', () => {
    const state = device();
    const fresh = modelResolve(state, 'RECOVERY_OWNER');
    expect(fresh).toMatchObject({ fileName: 'smartfin.db', freshInstall: true, fileIdentity: null, locationEpoch: 1 });
    expect(JSON.parse(state.metadata!).activeGeneration.status).toBe('initializing');
    state.files.set('smartfin.db', '64769:9001'); // el driver crea el archivo
    modelConfirm(state, fresh.generationId);
    modelConfirm(state, fresh.generationId); // idempotente
    expect(state.metadataWrites).toBe(2);
    expect(modelResolve(state, 'RECOVERY_OWNER')).toEqual({ ...fresh, freshInstall: false, fileIdentity: '64769:9001' });
  });

  test('Worker o receptor antes que JS en una instalación nueva: no inicializa ni escribe metadatos', () => {
    const state = device();
    expect(refusal(() => modelResolve(state, 'NO_RECOVERY'))).toMatchObject({ code: 'NOT_INITIALIZED', retryable: false, recoveryRequired: false });
    expect(withDatabaseFile(state)).toBeNull(); // mismo resultado que hoy: "todavía no hay base"
    expect(state.metadata).toBeNull();
  });

  test('adopción heredada: registra smartfin.db existente sin tocarlo; repetirla no vuelve a escribir', () => {
    const state = device({ files: new Map([['smartfin.db', '64769:1001']]) });
    const adopted = modelResolve(state, 'RECOVERY_OWNER');
    expect(adopted).toMatchObject({ fileName: 'smartfin.db', fileIdentity: '64769:1001', freshInstall: false, locationEpoch: 1 });
    expect(JSON.parse(state.metadata!).activeGeneration).toMatchObject({ status: 'active', origin: 'legacyAdoption' });
    expect(modelResolve(state, 'RECOVERY_OWNER')).toEqual(adopted);
    expect(modelResolve(state, 'NO_RECOVERY')).toEqual(adopted);
    expect(state.metadataWrites).toBe(1);
    expect(state.files).toEqual(new Map([['smartfin.db', '64769:1001']]));
  });

  test('el Worker puede adoptar una base existente (escritura atómica de metadatos, base intacta)', () => {
    const state = device({ files: new Map([['smartfin.db', '64769:1001']]) });
    expect(withDatabaseFile(state)).toBe('smartfin.db');
    expect(modelResolve(state, 'RECOVERY_OWNER').generationId).toBe(JSON.parse(state.metadata!).activeGeneration.generationId);
  });

  test('adopción interrumpida: los metadatos siguen ausentes (AtomicFile) y el siguiente arranque la reanuda', () => {
    const state = device({ files: new Map([['smartfin.db', '64769:1001']]), failNextMetadataWrite: true });
    expect(() => modelResolve(state, 'RECOVERY_OWNER')).toThrow('Injected AtomicFile write failure');
    expect(state.metadata).toBeNull();
    expect(modelResolve(state, 'RECOVERY_OWNER')).toMatchObject({ fileName: 'smartfin.db', freshInstall: false });
    expect(state.files.get('smartfin.db')).toBe('64769:1001');
  });

  test('inicialización interrumpida antes de confirmar: el dueño JS la reanuda con la misma generación', () => {
    const state = device();
    const first = modelResolve(state, 'RECOVERY_OWNER');
    expect(refusal(() => modelResolve(state, 'NO_RECOVERY')).code).toBe('NOT_INITIALIZED');
    expect(modelResolve(state, 'RECOVERY_OWNER')).toEqual(first);
    expect(() => modelConfirm(state, first.generationId)).toThrow('Initialized database file missing');
    expect(() => modelConfirm(state, '00000000-0000-4000-8000-ffffffffffff')).toThrow('Generation changed');
  });

  const active = (fileName: string, identity: string) => JSON.stringify({ formatVersion: 1,
    installationId: '00000000-0000-4000-8000-0000000000a1', datasetId: '00000000-0000-4000-8000-0000000000a2', locationEpoch: 1,
    activeGeneration: { generationId: '00000000-0000-4000-8000-0000000000a3', fileName, status: 'active', origin: 'legacyAdoption', fileIdentity: identity } });
  test.each([
    ['puntero corrupto', { metadata: '{"formatVersion":1,"activeGen' }, 'METADATA_CORRUPT', false],
    ['formato futuro', { metadata: active('smartfin.db', '1:1').replace('"formatVersion":1', '"formatVersion":2') }, 'METADATA_UNSUPPORTED', false],
    ['metadatos incompletos', { metadata: JSON.stringify({ formatVersion: 1, activeGeneration: { fileName: 'smartfin.db' } }) }, 'METADATA_INVALID', false],
    ['generación no reconocida', { metadata: active('otra.db', '1:1'), files: new Map([['otra.db', '1:1']]) }, 'GENERATION_UNRECOGNIZED', false],
    ['nombre con ruta', { metadata: active('../smartfin.db', '1:1') }, 'GENERATION_UNRECOGNIZED', false],
    ['base registrada ausente (R6)', { metadata: active('smartfin.db', '1:1') }, 'DATABASE_LOST', false],
    ['archivo sustituido (otra identidad)', { metadata: active('smartfin.db', '1:1'), files: new Map([['smartfin.db', '1:2']]) }, 'FILE_IDENTITY_MISMATCH', false],
    ['generación sin metadatos', { files: new Map([['smartfin.db', '1:1'], ['smartfin-0f0e0d0c-0b0a-4908-8706-050403020100.db', '1:3']]) }, 'POINTER_LOST', false],
    ['diario de restauración pendiente', { journal: true, files: new Map([['smartfin.db', '1:1']]) }, 'RESTORE_PENDING', true],
  ])('%s ⇒ rechazo controlado, sin crear ni elegir otra base', (_label, changes, code, retryable) => {
    for (const policy of ['RECOVERY_OWNER', 'NO_RECOVERY'] as const) {
      const state = device(changes as Partial<DeviceState>);
      const before = { metadata: state.metadata, files: new Map(state.files) };
      const error = refusal(() => modelResolve(state, policy));
      expect(error).toMatchObject({ code, retryable, recoveryRequired: true });
      expect(state.metadata).toBe(before.metadata);
      expect(state.files).toEqual(before.files);
      expect(workerResult(error)).toBe(retryable ? 'retry' : 'failure'); // sin bucles para errores permanentes
    }
  });

  test('los 13 escenarios de C2 frente a C3A (divergencia explícita: en C3A ningún diario se recupera)', () => {
    const gen = 'smartfin-0f0e0d0c-0b0a-4908-8706-050403020100.db';
    const scenarios: [string, Partial<ResolverInput>, () => DeviceState, string][] = [
      ['nueva', {}, () => device(), 'create'],
      ['nueva/receptor', { caller: 'independent' }, () => device(), 'NOT_INITIALIZED'],
      ['heredada', { files: ['smartfin.db'] }, () => device({ files: new Map([['smartfin.db', '1:1']]) }), 'open'],
      ['adoptada', { files: ['smartfin.db'], installMarker: true }, () => device({ metadata: active('smartfin.db', '1:1'), files: new Map([['smartfin.db', '1:1']]) }), 'open'],
      ['perdida', { installMarker: true }, () => device({ metadata: active('smartfin.db', '1:1') }), 'DATABASE_LOST'],
      ['generación sin puntero', { files: ['smartfin.db', gen] }, () => device({ files: new Map([['smartfin.db', '1:1'], [gen, '1:2']]) }), 'POINTER_LOST'],
      ['puntero válido', { pointer: { kind: 'valid', active: gen, generationId: 'g', previous: 'smartfin.db' }, files: [gen] },
        () => device({ metadata: active(gen, '1:2'), files: new Map([[gen, '1:2']]) }), 'open'],
      ['generación inexistente', { pointer: { kind: 'valid', active: gen, generationId: 'g' }, files: ['smartfin.db'] },
        () => device({ metadata: active(gen, '1:2'), files: new Map([['smartfin.db', '1:1']]) }), 'DATABASE_LOST'],
      ['ruta no permitida', { pointer: { kind: 'valid', active: '../x.db', generationId: 'g' } }, () => device({ metadata: active('../x.db', '1:1') }), 'GENERATION_UNRECOGNIZED'],
      ['puntero corrupto', { pointer: { kind: 'corrupt' }, files: ['smartfin.db'] }, () => device({ metadata: '{', files: new Map([['smartfin.db', '1:1']]) }), 'METADATA_CORRUPT'],
      ['diario/dueño', { journal: { kind: 'pending', phase: 'switching' }, files: ['smartfin.db'] }, () => device({ journal: true, files: new Map([['smartfin.db', '1:1']]) }), 'RESTORE_PENDING'],
      ['diario/independiente', { journal: { kind: 'pending', phase: 'switching' }, files: ['smartfin.db'], caller: 'independent' },
        () => device({ journal: true, files: new Map([['smartfin.db', '1:1']]) }), 'RESTORE_PENDING'],
      ['diario corrupto', { journal: { kind: 'corrupt' }, files: ['smartfin.db'] }, () => device({ journal: true, files: new Map([['smartfin.db', '1:1']]) }), 'RESTORE_PENDING'],
    ];
    const base: ResolverInput = { pointer: { kind: 'absent' }, journal: { kind: 'absent' }, installMarker: false, files: [], caller: 'exclusive' };
    for (const [label, c2, c3a, expected] of scenarios) {
      const policy = c2.caller === 'independent' ? 'NO_RECOVERY' : 'RECOVERY_OWNER';
      let outcome: string;
      try { const result = modelResolve(c3a(), policy); outcome = result.freshInstall ? 'create' : 'open'; }
      catch (error) { outcome = (error as Unavailable).code; }
      expect(`${label}:${outcome}`).toBe(`${label}:${expected}`);
      const c2Action = c2Resolve({ ...base, ...c2 }).action;
      // Igual que C2 salvo el diario pendiente con dueño (C2: recoverFirst; C3A: rechazo, no hay recuperación todavía).
      expect(c2Action === 'refuse' || outcome === 'open' || outcome === 'create' || c2Action === 'recoverFirst').toBe(true);
    }
  });
});

// ─── (B) Integración del código JS de producción ─────────────────────────────
let directory: string;
let state: DeviceState;
let driverOpens: string[];
let connections: ReturnType<typeof realSQLite>[];
let inode: number;
let failIntegrity: boolean;
let jsBinding: string | null;
let native: Record<string, jest.Mock>;
let lifecycle: typeof import('../src/database/sqliteDatabase');
let location: typeof import('../src/database/databaseLocation');
let managedApi: typeof import('../src/database/managedSQLite');

function startProcess(options: { withoutResolver?: boolean; answer?: unknown } = {}) {
  jest.resetModules();
  const { NativeModules, Platform } = require('react-native') as typeof import('react-native');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  native = {
    acquire: jest.fn(async () => 'owner-token'),
    checkOwner: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
    quarantine: jest.fn(async () => undefined),
    capture: jest.fn(async () => { throw new Error('not used'); }),
    discard: jest.fn(async () => undefined),
    // Node stand-in for SmartFinDatabaseLifecycle.resolveDatabase → SmartFinDatabaseLocation.resolveForJs.
    resolveDatabase: jest.fn(async () => {
      if (options.answer !== undefined) return options.answer;
      try {
        const active = modelResolve(state, 'RECOVERY_OWNER');
        jsBinding = active.generationId;
        return JSON.stringify({ status: active.freshInstall ? 'create' : 'open', ...active, freshInstall: undefined });
      } catch (error) {
        if (!(error instanceof Unavailable)) throw error;
        return JSON.stringify({ status: 'refused', code: error.code, retryable: error.retryable, recoveryRequired: error.recoveryRequired });
      }
    }),
    confirmFreshInstall: jest.fn(async (_token: string, generationId: string) => { modelConfirm(state, generationId); }),
    releaseDatabaseBinding: jest.fn(async (_token: string, generationId: string) => { if (jsBinding === generationId) jsBinding = null; }),
  };
  if (options.withoutResolver) { delete native.resolveDatabase; delete native.confirmFreshInstall; delete native.releaseDatabaseBinding; }
  NativeModules.SmartFinDatabaseLifecycle = native;
  const driver = require('react-native-sqlite-storage') as { openDatabase: jest.Mock };
  driver.openDatabase.mockImplementation((params: { name: string }, success: (db: SmartFinSQLiteDatabase) => void) => {
    driverOpens.push(params.name);
    const file = join(directory, params.name);
    const existed = fs.existsSync(file);
    const f = realSQLite({ fixedSqlDate: FINANCIAL_TEST_DATE, syntheticPath: file }); connections.push(f);
    if (!existed) state.files.set(params.name, `1:${++inode}`); // CREATE_IF_NECESSARY of the real driver
    const raw = {
      ...f.database,
      executeSql: async (sql: string, values?: unknown[]) => {
        if (failIntegrity && /PRAGMA integrity_check/.test(sql)) throw new Error('Injected integrity failure');
        return f.database.executeSql(sql, values as never);
      },
    } as unknown as SmartFinSQLiteDatabase;
    success(raw); return Promise.resolve(raw);
  });
  lifecycle = require('../src/database/sqliteDatabase');
  location = require('../src/database/databaseLocation');
  managedApi = require('../src/database/managedSQLite');
}

beforeEach(() => {
  directory = fs.mkdtempSync(join(tmpdir(), 'smartfin-c3a-'));
  state = device(); driverOpens = []; connections = []; inode = 100; failIntegrity = false; jsBinding = null;
});
afterEach(() => {
  for (const f of connections) { try { f.native.close(); } catch { /* closed by production code */ } }
  try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* Windows locks */ }
  const { Platform } = require('react-native') as typeof import('react-native');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
});

/** Synthetic 1a.4B history on smartfin.db: active and reversed allocations, command ids, statements. */
async function legacyFinancialBase() {
  const file = join(directory, 'smartfin.db');
  const f = await financialIntegrityFixture({ managed: true, syntheticPath: file });
  const registerExtraordinaryInstallmentPayment = fixturePay;
  const deleteManualTransactionSafely = fixtureDelete;
  const deps = { accountRepository: f.accountRepository, creditCardRepository: f.creditCardRepository, transactionRepository: f.transactionRepository };
  const saved = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '6', amount: 600000, merchantName: 'Compra C3A' });
  const purchaseId = `installment-${saved.transaction.id}`;
  const pay = (commandId: string, amount: number) => registerExtraordinaryInstallmentPayment({ ...deps, cardAccountId: 'card',
    installmentPurchaseId: purchaseId, sourceAccountId: 'bank', paymentAmount: amount, allocatedAmount: amount, mode: 'unspecified',
    commandId, currentDate: FINANCIAL_TEST_DATE });
  await pay('cmd-activo', 100000);
  const toDelete = await pay('cmd-borrado', 50000) as { payment: { id: string } };
  const transaction = (await f.transactionRepository.getTransactions()).find(row => row.id === toDelete.payment.id)!;
  await deleteManualTransactionSafely({ ...deps, accounts: await f.accountRepository.getAccounts(), transaction }); // D6
  f.native.close();
  state.files.set('smartfin.db', `1:${++inode}`);
  return { file, purchaseId };
}
const revisionCounter = (file: string) => {
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (f: string, o: { readOnly: boolean }) => { prepare: (s: string) => { all: () => Record<string, unknown>[] }; close: () => void } };
  const db = new DatabaseSync(file, { readOnly: true });
  try { return Number(db.prepare('SELECT revision FROM financial_data_revision WHERE id = 1').all()[0]!.revision); } finally { db.close(); }
};

describe('C3A (B) — integración JS con el resolvedor', () => {
  test('instalación existente: abre exactamente smartfin.db, la adopta sin alterar un byte ni el historial financiero', async () => {
    const { file, purchaseId } = await legacyFinancialBase();
    const before = { sha: sha256(file), fingerprint: contentFingerprint(file).digest, counter: revisionCounter(file) };
    startProcess();
    const database = await lifecycle.openSmartFinDatabase();
    expect(driverOpens).toEqual(['smartfin.db']);
    const metadata = JSON.parse(state.metadata!);
    expect(metadata.activeGeneration).toMatchObject({ fileName: 'smartfin.db', status: 'active', origin: 'legacyAdoption' });
    expect(managedApi.sqliteConnectionState(database)?.binding).toMatchObject({ managed: true, generationId: metadata.activeGeneration.generationId });
    // Repetir un comando procesado tras resolver: replayed, sin escrituras.
    const { createSqliteAccountRepository } = require('../src/modules/accounts/repositories/sqliteAccountRepository');
    const { createSqliteTransactionRepository } = require('../src/modules/transactions/repositories/sqliteTransactionRepository');
    const { createSqliteCreditCardRepository } = require('../src/modules/creditCards/repositories/sqliteCreditCardRepository');
    const { registerExtraordinaryInstallmentPayment } = require('../src/modules/creditCards/useCases/extraordinaryInstallmentPayment');
    const replay = await registerExtraordinaryInstallmentPayment({ accountRepository: createSqliteAccountRepository(database),
      creditCardRepository: createSqliteCreditCardRepository(database), transactionRepository: createSqliteTransactionRepository(database),
      cardAccountId: 'card', installmentPurchaseId: purchaseId, sourceAccountId: 'bank', paymentAmount: 100000, allocatedAmount: 100000,
      mode: 'unspecified', commandId: 'cmd-activo', currentDate: FINANCIAL_TEST_DATE });
    expect(replay.status).toBe('replayed');
    await lifecycle.closeSmartFinDatabase();
    expect(native.releaseDatabaseBinding).toHaveBeenCalledWith('owner-token', metadata.activeGeneration.generationId);
    expect(sha256(file)).toBe(before.sha);
    expect(contentFingerprint(file).digest).toBe(before.fingerprint);
    expect(revisionCounter(file)).toBe(before.counter);
    // Reinicio del proceso: misma generación, sin reescribir metadatos.
    startProcess();
    await lifecycle.openSmartFinDatabase();
    expect(state.metadataWrites).toBe(1);
    expect(JSON.parse(state.metadata!).activeGeneration.generationId).toBe(metadata.activeGeneration.generationId);
    expect(sha256(file)).toBe(before.sha);
  });

  test('instalación nueva: el driver crea la base y la generación solo se confirma tras esquema y verificación', async () => {
    startProcess();
    await lifecycle.openSmartFinDatabase();
    expect(driverOpens).toEqual(['smartfin.db']);
    expect(native.confirmFreshInstall).toHaveBeenCalledTimes(1);
    expect(JSON.parse(state.metadata!).activeGeneration).toMatchObject({ status: 'active', fileIdentity: '1:101' });
  });

  test('inicialización interrumpida: sin confirmación; el siguiente arranque la reanuda sobre la misma generación', async () => {
    startProcess();
    failIntegrity = true;
    await expect(lifecycle.openSmartFinDatabase()).rejects.toThrow('Injected integrity failure');
    expect(native.confirmFreshInstall).not.toHaveBeenCalled();
    const pending = JSON.parse(state.metadata!).activeGeneration;
    expect(pending.status).toBe('initializing');
    failIntegrity = false;
    startProcess();
    await lifecycle.openSmartFinDatabase();
    expect(JSON.parse(state.metadata!).activeGeneration).toMatchObject({ generationId: pending.generationId, status: 'active' });
  });

  test.each([
    ['diario de restauración pendiente', () => { state.journal = true; state.files.set('smartfin.db', '1:1'); }, 'RESTORE_PENDING', true],
    ['base registrada perdida', () => { state.metadata = JSON.stringify({ formatVersion: 1, installationId: '00000000-0000-4000-8000-0000000000a1',
      datasetId: '00000000-0000-4000-8000-0000000000a2', locationEpoch: 1, activeGeneration: { generationId: '00000000-0000-4000-8000-0000000000a3',
        fileName: 'smartfin.db', status: 'active', fileIdentity: '1:1' } }); }, 'DATABASE_LOST', false],
    ['metadatos corruptos', () => { state.metadata = 'xx'; state.files.set('smartfin.db', '1:1'); }, 'METADATA_CORRUPT', false],
  ])('%s: error tipado con recuperación requerida; el driver no se invoca y no se crea ninguna base', async (_label, arrange, code, retryable) => {
    arrange();
    startProcess();
    const error = await lifecycle.openSmartFinDatabase().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(location.DatabaseResolutionError);
    expect(error).toMatchObject({ code, retryable, recoveryRequired: true });
    expect(driverOpens).toEqual([]);
    expect(fs.existsSync(join(directory, 'smartfin.db'))).toBe(false);
  });

  test('nativo sin resolvedor (bundle JS más nuevo que el nativo): rechazo, nunca nombre fijo por defecto', async () => {
    startProcess({ withoutResolver: true });
    await expect(lifecycle.openSmartFinDatabase()).rejects.toMatchObject({ code: 'RESOLVER_UNAVAILABLE' });
    expect(driverOpens).toEqual([]);
  });

  test.each([
    ['no JSON', 'not-json'],
    ['ruta en el nombre', JSON.stringify({ status: 'open', fileName: '../smartfin.db', generationId: '00000000-0000-4000-8000-000000000001',
      installationId: '00000000-0000-4000-8000-000000000002', datasetId: '00000000-0000-4000-8000-000000000003', locationEpoch: 1, fileIdentity: '1:1' })],
    ['abierta sin identidad', JSON.stringify({ status: 'open', fileName: 'smartfin.db', generationId: '00000000-0000-4000-8000-000000000001',
      installationId: '00000000-0000-4000-8000-000000000002', datasetId: '00000000-0000-4000-8000-000000000003', locationEpoch: 1, fileIdentity: null })],
    ['época inválida', JSON.stringify({ status: 'open', fileName: 'smartfin.db', generationId: '00000000-0000-4000-8000-000000000001',
      installationId: '00000000-0000-4000-8000-000000000002', datasetId: '00000000-0000-4000-8000-000000000003', locationEpoch: 0, fileIdentity: '1:1' })],
    ['rechazo mal formado', JSON.stringify({ status: 'refused', code: 'x' })],
  ])('respuesta nativa inválida (%s): RESOLUTION_INVALID sin abrir', async (_label, answer) => {
    startProcess({ answer });
    await expect(lifecycle.openSmartFinDatabase()).rejects.toMatchObject({ code: 'RESOLUTION_INVALID' });
    expect(driverOpens).toEqual([]);
  });

  test('dos aperturas simultáneas: una resolución, una conexión, el mismo handle', async () => {
    state.files.set('smartfin.db', '1:1');
    await legacyFinancialBase();
    startProcess();
    const [a, b] = await Promise.all([lifecycle.openSmartFinDatabase(), lifecycle.openSmartFinDatabase()]);
    expect(a).toBe(b);
    expect(native.resolveDatabase).toHaveBeenCalledTimes(1);
    expect(driverOpens).toEqual(['smartfin.db']);
  });

  test('conexión residual: tras invalidar su generación no puede leer ni escribir; reabrir nunca la reutiliza', async () => {
    await legacyFinancialBase();
    startProcess();
    const old = await lifecycle.openSmartFinDatabase();
    const generationId = managedApi.sqliteConnectionState(old)!.binding!.generationId;
    location.invalidateDatabaseGeneration(generationId);
    await expect((async () => old.executeSql('SELECT 1'))()).rejects.toThrow('obsolete database generation');
    await expect((async () => old.executeSql(`UPDATE accounts SET name = 'x' WHERE id = 'bank'`))()).rejects.toThrow('obsolete database generation');
    // El nativo sigue señalando la misma generación (no hay activación en C3A): se rechaza en vez de reutilizarla.
    await expect(lifecycle.openSmartFinDatabase()).rejects.toMatchObject({ code: 'GENERATION_INVALIDATED' });
    expect(native.releaseDatabaseBinding).toHaveBeenCalledWith('owner-token', generationId);
    expect(managedApi.sqliteConnectionState(old)?.status).toBe('closed');
    expect(driverOpens).toEqual(['smartfin.db']); // el driver no vuelve a abrir una generación invalidada
    await expect((async () => old.executeSql('SELECT 1'))()).rejects.toThrow();
  });

  test('una generación nueva (simulada) recibe conexión propia y la anterior sigue bloqueada', async () => {
    await legacyFinancialBase();
    startProcess();
    const old = await lifecycle.openSmartFinDatabase();
    const oldGeneration = managedApi.sqliteConnectionState(old)!.binding!.generationId;
    location.invalidateDatabaseGeneration(oldGeneration);
    // Solo para la prueba: los metadatos señalan otra generación existente (C3B hará esto de forma protegida).
    const gen = 'smartfin-0f0e0d0c-0b0a-4908-8706-050403020100.db';
    const { copyFileSync } = require('node:fs') as { copyFileSync: (a: string, b: string) => void };
    copyFileSync(join(directory, 'smartfin.db'), join(directory, gen));
    state.files.set(gen, '1:999');
    const meta = JSON.parse(state.metadata!);
    meta.locationEpoch = 2;
    meta.activeGeneration = { ...meta.activeGeneration, generationId: '00000000-0000-4000-8000-0000000000b1', fileName: gen, fileIdentity: '1:999' };
    state.metadata = JSON.stringify(meta);
    const fresh = await lifecycle.openSmartFinDatabase();
    expect(managedApi.sqliteConnectionState(fresh)?.binding).toMatchObject({ fileName: gen, locationEpoch: 2 });
    await expect(fresh.executeSql('SELECT COUNT(*) AS n FROM accounts')).resolves.toBeDefined();
    await expect((async () => old.executeSql('SELECT 1'))()).rejects.toThrow();
    expect(driverOpens).toEqual(['smartfin.db', gen]);
  });

  test('el contador de respaldo y la huella no cambian por resolver, adoptar, abrir y cerrar repetidamente', async () => {
    const { file } = await legacyFinancialBase();
    const before = { fingerprint: contentFingerprint(file).digest, counter: revisionCounter(file) };
    for (let i = 0; i < 3; i++) {
      startProcess();
      await lifecycle.openSmartFinDatabase();
      await lifecycle.closeSmartFinDatabase();
    }
    expect(contentFingerprint(file).digest).toBe(before.fingerprint);
    expect(revisionCounter(file)).toBe(before.counter);
    expect(state.metadataWrites).toBe(1);
    expect(NOW).toBe('2026-10-11T12:00:00.000Z');
  });
});
