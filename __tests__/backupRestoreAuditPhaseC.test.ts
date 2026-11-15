// Auditoría de respaldo y recuperación (Etapa C, sobre la fase 1a.4B).
// Solo datos sintéticos, base SQLite en archivo temporal propio y reloj fijo.
//
// Límite explícito: el respaldo real (SmartFinLocalSnapshot / SmartFinBackupPublisher) es Kotlin
// ejecutado en Android y no se puede ejecutar en Node. Estado B replica en Node los pasos de
// archivo de SmartFinLocalSnapshot.capture (checkpoint, cierre, copia de bytes, SHA-256 y
// relectura). No existe en la aplicación ningún mecanismo de restauración: Estado D sustituye el
// archivo activo por la copia (lo único que un usuario podría hacer) y reabre con el mismo orden
// de arranque que src/database/sqliteDatabase.ts.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState } from './helpers/financialState';
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
import { createSqliteInstallmentHistoryRepository } from '../src/modules/creditCards/repositories/sqliteInstallmentHistoryRepository';
import { serializeCreditCardVisualMetadata } from '../src/modules/creditCards/useCases/manageCreditCards';
import { getDashboardSummaryFromDb } from '../src/modules/dashboard/useCases/getDashboardSummary';
import * as initialRevisionModule from '../src/modules/creditCards/useCases/initialInstallmentRevision';
import {
  registerExtraordinaryInstallmentPayment,
  type InstallmentAllocationOutcome,
} from '../src/modules/creditCards/useCases/extraordinaryInstallmentPayment';
import {
  deleteManualTransactionSafely,
  saveManualTransaction,
  type SaveManualTransactionParams,
} from '../src/modules/transactions/useCases/saveManualTransaction';
import type { SQLitePrimitive } from '../src/database/sqliteRows';

type Fixture = Awaited<ReturnType<typeof financialIntegrityFixture>>;
type Rows = Record<string, SQLitePrimitive>[];
type NodeSqlite = {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => { all: (...v: unknown[]) => Record<string, unknown>[]; run: (...v: unknown[]) => unknown };
    close: () => void;
  };
};
type FsModule = {
  mkdtempSync: (prefix: string) => string;
  mkdirSync: (dir: string, options: { recursive: boolean }) => void;
  rmSync: (target: string, options: { recursive: boolean; force: boolean }) => void;
  readFileSync: (file: string) => Uint8Array;
  writeFileSync: (file: string, data: string | Uint8Array) => void;
  copyFileSync: (from: string, to: string) => void;
  existsSync: (file: string) => boolean;
  statSync: (file: string) => { size: number };
};
const fs = require('node:fs') as FsModule;
const path = require('node:path') as { join: (...parts: string[]) => string; dirname: (file: string) => string };
const os = require('node:os') as { tmpdir: () => string };
const crypto = require('node:crypto') as {
  createHash: (algorithm: string) => { update: (data: Uint8Array) => { digest: (encoding: 'hex') => string } };
};
const { DatabaseSync } = require('node:sqlite') as NodeSqlite;

const NOW = FINANCIAL_TEST_DATE.toISOString();
const LATER = new Date(FINANCIAL_TEST_DATE.getTime() + 3_600_000);
const CARD_CLOSING_DAY = 20;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartfin-auditoria-c-'));
afterAll(() => {
  // Windows keeps locked files of a connection left open by a failed step; the temporary folder is not evidence.
  try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* reported by the OS temp cleaner */ }
});

/** Same order and skip-lists as src/database/sqliteDatabase.ts applySchema(). */
async function appOpenSchema(sql: ReturnType<typeof realSQLite>) {
  for (const statement of SQLITE_SCHEMA_STATEMENTS) {
    if (SHARED_LOSS_SCHEMA.includes(statement)) continue;
    if (INSTALLMENT_HISTORY_SCHEMA.includes(statement)) continue;
    if ([...SHARED_EXPENSE_SCHEMA, ...SHARED_EXPENSE_INDEXES, ...SHARED_EXPENSE_TRIGGERS].includes(statement)) continue;
    sql.native.exec(statement);
  }
  await applyVersionedMigrations(sql.database);
}

/** Opens a synthetic file exactly as the app does on start (schema, then migrations). */
async function openFile(file: string): Promise<Fixture> {
  const sql = realSQLite({ fixedSqlDate: FINANCIAL_TEST_DATE, syntheticPath: file });
  sql.native.exec('PRAGMA foreign_keys = ON;');
  await appOpenSchema(sql);
  const database = manageSQLiteDatabase(sql.database);
  const accountRepository = createSqliteAccountRepository(database);
  const transactionRepository = createSqliteTransactionRepository(database);
  const creditCardRepository = createSqliteCreditCardRepository(database);
  const save = async (changes: Partial<SaveManualTransactionParams> = {}) =>
    saveManualTransaction({
      accountRepository, transactionRepository, creditCardRepository,
      accounts: await accountRepository.getAccounts(), accountId: 'bank', amount: 250000, merchantName: 'Visa',
      operationType: 'Débito', transactionType: 'expense', hasInterestFreeInstallments: false, installmentCountInput: '1',
      interestFreeInstallmentCountInput: '', currentDate: FINANCIAL_TEST_DATE, ...changes,
    });
  const snapshot = async () => {
    const accounts = await accountRepository.getAccounts();
    const summary = await getDashboardSummaryFromDb(database, FINANCIAL_TEST_DATE);
    return {
      balances: Object.fromEntries(accounts.map(account => [account.id, account.balance.amount])),
      debt: accounts.find(account => account.id === 'card')?.debtBalance?.amount,
      available: summary.availableBalance, wealth: summary.netWorth,
      income: summary.monthlyIncome, expense: summary.monthlyExpenses, savings: summary.monthlySavings,
    };
  };
  return { ...sql, database, accountRepository, transactionRepository, creditCardRepository, save, snapshot } as unknown as Fixture;
}

const rows = (f: Fixture, sql: string, values: SQLitePrimitive[] = []): Rows => f.query(sql, values).rows.raw();
const scalarOf = (f: Fixture, sql: string): SQLitePrimitive => Object.values(rows(f, sql)[0] ?? {})[0] as SQLitePrimitive;
const counter = (f: Fixture) => Number(scalarOf(f, 'SELECT revision FROM financial_data_revision WHERE id = 1'));
const shape = (row: Record<string, SQLitePrimitive>) => [row.revision_number, row.source, row.verification, row.pending_reasons,
  row.remaining_principal_cents, row.remaining_installments, row.installment_amount_cents, row.effective_cycle_end];
const revisionShapes = (f: Fixture, purchaseId: string) =>
  rows(f, 'SELECT * FROM installment_plan_revisions WHERE installment_purchase_id = ? ORDER BY revision_number', [purchaseId]).map(shape);
const allocationStates = (f: Fixture) =>
  rows(f, 'SELECT command_id, status, amount_cents, payment_transaction_id FROM installment_allocations ORDER BY created_at, id');

/** Byte-level file checks mirroring SmartFinLocalSnapshot.describe(): integrity, FK and metadata. */
function describeFile(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    const integrity = db.prepare('PRAGMA integrity_check;').all().map(row => Object.values(row)[0]);
    const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check;').all();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;").all();
    const counts = Object.fromEntries(tables.map(({ name }) => [name, Number(db.prepare(`SELECT COUNT(*) AS n FROM "${String(name)}"`).all()[0]!.n)]));
    const journal = String(db.prepare('PRAGMA journal_mode;').all()[0]!.journal_mode);
    return { integrity, foreignKeyViolations, counts, journal };
  } finally { db.close(); }
}
const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function registered(promise: Promise<unknown>) {
  const result = (await promise) as InstallmentAllocationOutcome;
  if (result.status !== 'registered') throw new Error(`expected registered, got ${result.status}`);
  return result;
}
const deps = (f: Fixture) => ({ accountRepository: f.accountRepository, creditCardRepository: f.creditCardRepository, transactionRepository: f.transactionRepository });
function pay(f: Fixture, purchaseId: string, changes: Record<string, unknown> = {}) {
  return registerExtraordinaryInstallmentPayment({
    ...deps(f), cardAccountId: 'card', installmentPurchaseId: purchaseId, sourceAccountId: 'bank',
    paymentAmount: 100000, allocatedAmount: 100000, mode: 'unspecified', commandId: 'cmd', currentDate: FINANCIAL_TEST_DATE,
    ...changes,
  } as Parameters<typeof registerExtraordinaryInstallmentPayment>[0]);
}
async function purchase(f: Fixture, accountId: string, amount: number, installments: number, merchantName: string) {
  const saved = await f.save({ accountId, operationType: 'Crédito', installmentCountInput: String(installments), amount, merchantName });
  return `installment-${saved.transaction.id}`;
}
async function paymentOf(f: Fixture, commandId: string) {
  return rows(f, 'SELECT payment_transaction_id FROM installment_allocations WHERE command_id = ?', [commandId])[0]?.payment_transaction_id as string | undefined;
}
async function editPayment(f: Fixture, paymentId: string, changes: Partial<SaveManualTransactionParams>) {
  const payment = (await f.transactionRepository.getTransactions()).find(row => row.id === paymentId);
  if (!payment) throw new Error(`missing payment ${paymentId}`);
  return saveManualTransaction({
    ...deps(f), accounts: await f.accountRepository.getAccounts(), accountId: payment.accountId, amount: payment.amount,
    merchantName: payment.merchantName ?? payment.description, notes: 'Pago de tarjeta', operationType: 'Débito',
    transactionType: 'creditCardPayment', targetAccountId: payment.targetAccountId, editingTransaction: payment,
    hasInterestFreeInstallments: false, installmentCountInput: '1', interestFreeInstallmentCountInput: '', currentDate: LATER, now: LATER,
    ...changes,
  });
}
async function deletePayment(f: Fixture, paymentId: string) {
  const transaction = (await f.transactionRepository.getTransactions()).find(row => row.id === paymentId);
  if (!transaction) throw new Error(`missing payment ${paymentId}`);
  return deleteManualTransactionSafely({ ...deps(f), accounts: await f.accountRepository.getAccounts(), transaction });
}
/** Test-only: there is no production path that confirms a statement revision. */
function confirmStatement(f: Fixture, purchaseId: string, principalCents: number, installments: number, cycleEnd: string) {
  return createSqliteInstallmentHistoryRepository(f.database).appendPlanRevision({
    installmentPurchaseId: purchaseId, source: 'statement', remainingPrincipalCents: principalCents,
    remainingInstallments: installments, installmentAmountCents: Math.floor(principalCents / installments),
    effectiveCycleEnd: cycleEnd, verification: 'confirmed', pendingReasons: [], createdAt: LATER.toISOString(),
  });
}
const statementRow = (id: string, accountId: string) => ({
  id, accountId, statementStartDate: '2026-09-21', statementEndDate: '2026-10-20', paymentDueDate: '2026-11-05',
  totalAmount: 600000, minimumPaymentAmount: 60000, currency: 'COP' as const, status: 'open' as const, createdAt: NOW, updatedAt: NOW,
});

/** Operations after the backup (state C). `variant` changes only the amounts. */
async function postBackupOperations(f: Fixture, variant: 'C' | 'Dalt') {
  const amount = variant === 'C' ? 60000 : 70000;
  const p5 = await purchase(f, 'card', 300000, 3, `Post ${variant}`);
  await pay(f, p5, { paymentAmount: amount, allocatedAmount: amount, commandId: `post-${variant}`, currentDate: LATER });
  await deletePayment(f, (await paymentOf(f, 'cmd-excedente-1'))!);
  await f.creditCardRepository.saveStatements([statementRow(`stmt-post-${variant}`, 'card')]);
}

// ---------------------------------------------------------------------------------------------
// Estados A–D: fixture sintético, copia de respaldo, modificación posterior y restauración.
// ---------------------------------------------------------------------------------------------
describe('Estados A–D: respaldo y restauración de un historial sintético de cuotas', () => {
  const live = path.join(workdir, 'live.db');
  const backup = path.join(workdir, 'backup', 'smartfin-backup.db');
  const stateA: { value?: Awaited<ReturnType<typeof financialState>> } = {};
  const evidence: Record<string, unknown> = {};
  let restored: Fixture;
  let restoredState: Awaited<ReturnType<typeof financialState>>;
  let P1: string, P2: string, P3: string, P4: string;

  beforeAll(async () => {
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    // Estado A ------------------------------------------------------------------------------
    const f = await financialIntegrityFixture({ managed: true, syntheticPath: live });
    f.native.exec(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at)
      VALUES ('card2','Master','creditCard','active','COP',0,0,'2026-01-01','2026-01-01')`);
    f.native.prepare("UPDATE accounts SET description = ? WHERE id = 'card'").run(
      serializeCreditCardVisualMetadata({ closingDay: CARD_CLOSING_DAY }));
    const plans = createSqliteInstallmentHistoryRepository(f.database);
    await plans.saveBillingRules({ accountId: 'card', closingDayPurchasePolicy: 'closingCycle', createdAt: NOW, updatedAt: NOW }); // 14
    P1 = await purchase(f, 'card', 600000, 6, 'Compra A');                                  // 4, 15: rev. 0 original
    await registered(pay(f, P1, { commandId: 'cmd-abono-1', paymentAmount: 100000, allocatedAmount: 100000 }));  // 3 abono imputado
    await registered(pay(f, P1, { commandId: 'cmd-excedente-1', paymentAmount: 150000, allocatedAmount: 100000 })); // 6 excedente
    await plans.saveFirstCycle({ installmentPurchaseId: P1, cycleEnd: '2026-10-20', source: 'user', createdAt: NOW, updatedAt: NOW }); // 15
    await confirmStatement(f, P1, 40000000, 4, '2026-11-20');                                 // 11 confirmada posterior
    const abono = (await paymentOf(f, 'cmd-abono-1'))!;
    await editPayment(f, abono, { amount: 90000 });                                           // 8/9 D6 con confirmada => statementAdjustmentRequired
    P2 = await purchase(f, 'card2', 300000, 3, 'Compra sin cierre');                          // 10 pendingVerification
    // 13 Inicialización perezosa: compra creada con la versión intermedia (sin revisión 0), luego abono.
    const spy = jest.spyOn(initialRevisionModule, 'recordInitialInstallmentRevision').mockResolvedValue(undefined);
    try { P3 = await purchase(f, 'card', 240000, 4, 'Compra intermedia'); } finally { spy.mockRestore(); }
    await registered(pay(f, P3, { commandId: 'cmd-lazy-1', paymentAmount: 50000, allocatedAmount: 50000 }));
    // 7–8 Compra con cuotas ya conocida y pago eliminado (evidencia de command_id tras borrado).
    P4 = await purchase(f, 'card', 200000, 2, 'Compra borrada');
    await registered(pay(f, P4, { commandId: 'cmd-del-1', paymentAmount: 50000, allocatedAmount: 50000 }));
    await deletePayment(f, (await paymentOf(f, 'cmd-del-1'))!);
    await f.creditCardRepository.saveStatements([statementRow('stmt-card-1', 'card')]);      // 17 extracto
    // Idempotencia: el mismo comando ya procesado no escribe.
    f.resetTrace();
    const replay = await pay(f, P1, { commandId: 'cmd-excedente-1', paymentAmount: 150000, allocatedAmount: 100000 });
    evidence.replayStatus = replay.status;
    evidence.replayWrites = f.trace.filter(entry => entry.write !== undefined).length;

    stateA.value = await financialState(f);
    evidence.counterA = counter(f);
    evidence.revisionsP1 = revisionShapes(f, P1);
    evidence.revisionsP2 = revisionShapes(f, P2);
    evidence.revisionsP3 = revisionShapes(f, P3);
    evidence.allocationsA = allocationStates(f);
    evidence.billingRulesA = rows(f, 'SELECT * FROM credit_card_billing_rules');
    evidence.firstCyclesA = rows(f, 'SELECT * FROM installment_first_cycles');
    evidence.metricsA = stateA.value.metrics;
    f.native.close();

    // Estado B: réplica de SmartFinLocalSnapshot.capture (sin Android) ----------------------
    const before = describeFile(live);
    expect(before.integrity).toEqual(['ok']);
    expect(before.foreignKeyViolations).toEqual([]);
    expect(before.journal).toBe('delete'); // El código no activa WAL; Android usa journal de rollback.
    fs.copyFileSync(live, backup);
    const sourceHash = sha256(live);
    expect(sha256(backup)).toBe(sourceHash);
    const copy = describeFile(backup);
    expect(copy.integrity).toEqual(['ok']);
    expect(copy.foreignKeyViolations).toEqual([]);
    expect(copy.counts).toEqual(before.counts);
    evidence.backupBytes = fs.statSync(backup).size;
    evidence.backupSha256 = sourceHash;
    evidence.backupCounts = copy.counts;

    // Estado C: operaciones posteriores sobre el archivo activo -----------------------------
    const c = await openFile(live);
    await postBackupOperations(c, 'C');
    evidence.counterC = counter(c);
    evidence.stateCDiffers = JSON.stringify(await financialState(c)) !== JSON.stringify(stateA.value);
    c.native.close();
    // Un archivo de respaldo no se modifica durante la prueba.
    expect(sha256(backup)).toBe(sourceHash);

    // Estado D: restauración manual (sustitución del archivo activo) y reapertura -----------
    fs.copyFileSync(backup, live);
    restored = await openFile(live);
    restoredState = await financialState(restored);
  });
  afterAll(() => { restored?.native.close(); });

  test('estado C difiere del respaldo (la prueba distingue el estado respaldado del actual)', () => {
    expect(evidence.stateCDiffers).toBe(true);
    expect(evidence.counterC).toBeGreaterThan(evidence.counterA as number);
  });

  test('el archivo de respaldo tiene integridad, FK y conteos iguales al origen', () => {
    expect(evidence.backupCounts).toBeDefined();
    expect(sha256(backup)).toBe(evidence.backupSha256);
  });

  test('restauración: estado completo idéntico al Estado A (tablas, métricas, integridad)', () => {
    expect(restoredState).toEqual(stateA.value);
  });

  test('integridad SQLite y referencial tras restaurar', () => {
    expect(restoredState.integrity.integrityCheck).toEqual([{ integrity_check: 'ok' }]);
    expect(restoredState.integrity.foreignKeyViolations).toEqual([]);
    expect(restoredState.integrity.foreignKeys).toEqual([{ foreign_keys: 1 }]);
  });

  test('tablas críticas: imputaciones, revisiones, primeros ciclos y reglas se recuperan con sus filas', () => {
    const t = restoredState.tables;
    for (const name of ['installment_allocations', 'installment_plan_revisions', 'installment_first_cycles', 'credit_card_billing_rules']) {
      expect(t[name]!.length).toBeGreaterThan(0);
    }
    expect(revisionShapes(restored, P1)).toEqual(evidence.revisionsP1);
    expect(revisionShapes(restored, P2)).toEqual(evidence.revisionsP2);
    expect(revisionShapes(restored, P3)).toEqual(evidence.revisionsP3);
    expect(allocationStates(restored)).toEqual(evidence.allocationsA);
    expect(rows(restored, 'SELECT * FROM credit_card_billing_rules')).toEqual(evidence.billingRulesA);
    expect(rows(restored, 'SELECT * FROM installment_first_cycles')).toEqual(evidence.firstCyclesA);
  });

  test('contador financiero restaurado al valor respaldado', () => {
    expect(counter(restored)).toBe(evidence.counterA);
  });

  test('ausencia de filas huérfanas por valor (sin FK en payment_transaction_id): solo imputaciones revertidas de pagos borrados', () => {
    const orphans = rows(restored, `SELECT a.status, a.command_id FROM installment_allocations a
      WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = a.payment_transaction_id)`);
    expect(orphans).toEqual([{ status: 'reversed', command_id: 'cmd-del-1' }]);
    expect(rows(restored, `SELECT r.id FROM installment_plan_revisions r
      WHERE NOT EXISTS (SELECT 1 FROM installment_purchases p WHERE p.id = r.installment_purchase_id)`)).toEqual([]);
  });

  test('restricciones tras restaurar: compra con imputaciones y revisión posterior confirmada no admite nuevas imputaciones', async () => {
    const before = await financialState(restored);
    restored.resetTrace();
    await expect(pay(restored, P1, { commandId: 'after-restore-blocked' })).rejects.toThrow();
    expect(restored.trace.filter(entry => entry.write !== undefined)).toEqual([]);
    expect(await financialState(restored)).toEqual(before);
  });

  test('ningún dinero adicional: métricas idénticas a A tras el intento bloqueado', async () => {
    expect((await restored.snapshot())).toEqual(evidence.metricsA);
  });

  test('idempotencia tras restaurar: repetir un comando ya procesado no escribe', async () => {
    const before = await financialState(restored);
    restored.resetTrace();
    const replay = await pay(restored, P1, { commandId: 'cmd-excedente-1', paymentAmount: 150000, allocatedAmount: 100000 });
    expect(replay.status).toBe('replayed');
    expect(restored.trace.filter(entry => entry.write !== undefined)).toEqual([]);
    expect(await financialState(restored)).toEqual(before);
  });

  test('la imputación revertida no se reactiva con el comando original tras restaurar', async () => {
    expect(rows(restored, "SELECT status FROM installment_allocations WHERE command_id = 'cmd-abono-1'")).toEqual([{ status: 'reversed' }]);
    const before = await financialState(restored);
    restored.resetTrace();
    // Mismo comando con sus importes originales: se informa como revertido y no escribe nada.
    const replay = await pay(restored, P1, { commandId: 'cmd-abono-1', paymentAmount: 100000, allocatedAmount: 100000 });
    expect(replay).toMatchObject({ status: 'replayed', allocation: { status: 'reversed' } });
    // El pago fue editado (no borrado) en la preparación: se informa tal como existe y no se recrea ni reimputa.
    expect((replay as { payment?: { amount: number } }).payment?.amount).toBe(90000);
    expect(restored.trace.filter(entry => entry.write !== undefined)).toEqual([]);
    expect(await financialState(restored)).toEqual(before);
  });

  test('una transacción nueva válida se confirma una sola vez tras restaurar', async () => {
    const countBefore = rows(restored, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'creditCardPayment'")[0]!.n;
    const result = await registered(pay(restored, P3, { commandId: 'post-restore-1', paymentAmount: 30000, allocatedAmount: 30000 }));
    expect(result.status).toBe('registered');
    const countAfter = rows(restored, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'creditCardPayment'")[0]!.n;
    expect(Number(countAfter) - Number(countBefore)).toBe(1);
    const replay = await pay(restored, P3, { commandId: 'post-restore-1', paymentAmount: 30000, allocatedAmount: 30000 });
    expect(replay.status).toBe('replayed');
    expect(rows(restored, "SELECT COUNT(*) AS n FROM installment_allocations WHERE command_id = 'post-restore-1'")).toEqual([{ n: 1 }]);
  });

  test('la restauración no fusiona datos del estado C: ninguna fila creada después del respaldo sobrevive', () => {
    expect(rows(restored, "SELECT COUNT(*) AS n FROM credit_card_statements WHERE id = 'stmt-post-C'")).toEqual([{ n: 0 }]);
    expect(rows(restored, "SELECT COUNT(*) AS n FROM installment_allocations WHERE command_id = 'post-C'")).toEqual([{ n: 0 }]);
    expect(rows(restored, "SELECT COUNT(*) AS n FROM installment_purchases WHERE transaction_id IN (SELECT id FROM transactions WHERE merchant_name = 'Post C')")).toEqual([{ n: 0 }]);
    // El pago eliminado en C (excedente) vuelve a existir con su imputación original activa.
    expect(allocationStates(restored).filter(row => row.command_id === 'cmd-excedente-1')).toEqual([expect.objectContaining({ status: 'active' })]);
  });

  test('límite documentado: el contador de revisión se restaura con el archivo, igual que el resto', () => {
    expect(evidence.counterA).toBeLessThan(evidence.counterC as number);
  });

  test('volcado opcional de evidencia (SMARTFIN_AUDIT_C_EVIDENCE=<archivo.json>), sin datos personales', () => {
    const target = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.SMARTFIN_AUDIT_C_EVIDENCE;
    if (!target) return;
    fs.writeFileSync(target, JSON.stringify({ ...evidence, stateACounts: Object.fromEntries(
      Object.entries(stateA.value?.tables ?? {}).map(([name, value]) => [name, value.length])) }, null, 2));
  });
});

// ---------------------------------------------------------------------------------------------
// Estado 8 — fallos del archivo de respaldo y de la sustitución de la base activa.
// ---------------------------------------------------------------------------------------------
describe('pruebas de fallo sobre el archivo de respaldo (sintético)', () => {
  async function makeBase(name: string) {
    const file = path.join(workdir, `${name}.db`);
    const f = await financialIntegrityFixture({ managed: true, syntheticPath: file });
    await purchase(f, 'card', 600000, 6, 'Compra fallo');
    f.native.close();
    return file;
  }
  function detectable(file: string, expectedSha: string) {
    let openError: string | undefined;
    let report: ReturnType<typeof describeFile> | undefined;
    try { report = describeFile(file); } catch (error) { openError = (error as Error).message; }
    const shaMismatch = sha256(file) !== expectedSha;
    return { openError, shaMismatch, integrityBad: report ? report.integrity.join() !== 'ok' || report.foreignKeyViolations.length > 0 : true };
  }

  test('archivo truncado: se detecta por apertura, integridad o SHA-256 del manifiesto', async () => {
    const source = await makeBase('truncado-origen');
    const expected = sha256(source);
    const copy = path.join(workdir, 'truncado.db');
    const bytes = fs.readFileSync(source);
    fs.writeFileSync(copy, bytes.subarray(0, Math.floor(bytes.length / 2)));
    const result = detectable(copy, expected);
    expect(result.shaMismatch || result.integrityBad || result.openError !== undefined).toBe(true);
    expect(result.shaMismatch).toBe(true); // La validación por manifiesto es la única que siempre captura una copia incompleta.
  });

  test('archivo corrupto (byte alterado en el interior): se detecta por SHA-256 aunque SQLite lo abra', async () => {
    const source = await makeBase('corrupto-origen');
    const expected = sha256(source);
    const copy = path.join(workdir, 'corrupto.db');
    const bytes = new Uint8Array(fs.readFileSync(source));
    const index = Math.min(bytes.length - 1, 4096 * 2 + 100);
    bytes[index] = (bytes[index]! + 1) % 256; // un byte alterado dentro de una página de datos
    fs.writeFileSync(copy, bytes);
    const result = detectable(copy, expected);
    expect(result.shaMismatch).toBe(true);
  });

  test('archivo que no es SQLite: apertura explícitamente fallida', () => {
    const copy = path.join(workdir, 'texto.db');
    fs.writeFileSync(copy, 'esto no es una base de datos\n'.repeat(100));
    expect(() => describeFile(copy)).toThrow(/not a database|malformed/i);
  });

  test('ruta inexistente: SQLite crea una base vacía sin ninguna señal de que existía una instalación previa', async () => {
    const missing = path.join(workdir, 'no-existe.db');
    const f = await openFile(missing);
    try {
      expect(fs.existsSync(missing)).toBe(true);
      expect(rows(f, 'SELECT COUNT(*) AS n FROM accounts')).toEqual([{ n: 0 }]);
      expect(rows(f, 'SELECT COUNT(*) AS n FROM transactions')).toEqual([{ n: 0 }]);
    } finally { f.native.close(); }
  });

  test('restauración interrumpida sobre la base activa: sin copia previa la base queda ilegible', async () => {
    const source = await makeBase('activa-origen');
    const active = path.join(workdir, 'activa.db');
    const bytes = fs.readFileSync(source);
    fs.writeFileSync(active, bytes.subarray(0, 3000)); // escritura cortada a mitad
    expect(() => describeFile(active)).toThrow();
    expect(fs.existsSync(`${active}.bak`)).toBe(false); // La aplicación no conserva ninguna copia previa.
  });

  function probeCopy(name: string, openWriter: boolean) {
    const file = path.join(workdir, `${name}.db`);
    const setup = new DatabaseSync(file);
    setup.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, payload TEXT);');
    setup.exec('BEGIN;');
    const seed = setup.prepare('INSERT INTO probe (payload) VALUES (?)');
    for (let i = 0; i < 1000; i++) seed.run('c'.repeat(200));
    setup.exec('COMMIT;');
    const committed = Number(setup.prepare("SELECT COUNT(*) AS n FROM probe").all()[0]!.n);
    if (openWriter) {
      setup.exec('PRAGMA cache_size = 4;');
      setup.exec('BEGIN IMMEDIATE;');
      setup.prepare("UPDATE probe SET payload = ? WHERE id <= 1000").run('U'.repeat(200)); // páginas comprometidas modificadas
    }
    const copy = path.join(workdir, `${name}-copia.db`);
    fs.copyFileSync(file, copy);
    if (openWriter) setup.exec('ROLLBACK;');
    setup.close();
    const probe = new DatabaseSync(copy, { readOnly: true });
    try {
      return {
        committed,
        integrity: probe.prepare('PRAGMA integrity_check;').all().map(row => Object.values(row)[0]),
        uncommitted: Number(probe.prepare("SELECT COUNT(*) AS n FROM probe WHERE payload LIKE 'U%'").all()[0]!.n),
      };
    } finally { probe.close(); }
  }
  test('copia sin escritor abierto: integridad correcta y solo filas comprometidas', () => {
    const result = probeCopy('sin-escritor', false);
    expect(result).toEqual({ committed: 1000, integrity: ['ok'], uncommitted: 0 });
  });
  test('evidencia: una copia de archivo tomada con transacción abierta contiene filas no confirmadas aunque integrity_check sea ok', () => {
    // Por eso la captura de SmartFin exige exclusión del coordinador y cierre de la conexión administrada antes de copiar.
    const result = probeCopy('con-escritor', true);
    expect(result.integrity).toEqual(['ok']);
    expect(result.uncommitted).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Estado 9 — compatibilidad de esquemas y versiones.
// ---------------------------------------------------------------------------------------------
describe('compatibilidad de versiones y esquemas', () => {
  test('PRAGMA user_version nunca lo escribe la aplicación: queda en 0', async () => {
    const file = path.join(workdir, 'user-version.db');
    const f = await financialIntegrityFixture({ managed: false, syntheticPath: file });
    expect(scalarOf(f, 'PRAGMA user_version')).toBe(0);
    f.native.close();
  });

  test('base de una versión anterior (esquema v4 reconstruido, migración 5 ausente) se migra al abrir', async () => {
    const file = path.join(workdir, 'v4.db');
    // 1) Instalación con compra y pago; luego se retiran los artefactos de la migración 5 para obtener un esquema v4.
    const current = await openFile(file);
    current.native.exec(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at)
      VALUES ('card','Visa','creditCard','active','COP',0,0,'2026-01-01','2026-01-01')`);
    const p = await purchase(current, 'card', 600000, 6, 'Compra v4');
    const totalBefore = rows(current, 'SELECT COUNT(*) AS n FROM transactions')[0]!.n;
    const artifacts = rows(current, `SELECT name, type FROM sqlite_master WHERE sql LIKE '%installment_allocations%'
      OR sql LIKE '%installment_plan_revisions%' OR sql LIKE '%credit_card_billing_rules%' OR sql LIKE '%installment_first_cycles%'`);
    for (const artifact of artifacts.filter(row => row.type === 'trigger'))
      current.native.exec(`DROP TRIGGER IF EXISTS "${String(artifact.name)}";`);
    for (const table of ['installment_first_cycles', 'credit_card_billing_rules', 'installment_plan_revisions', 'installment_allocations'])
      current.native.exec(`DROP TABLE IF EXISTS ${table};`);
    current.native.exec('DELETE FROM schema_migrations WHERE version = 5;');
    expect(p).toMatch(/^installment-/);
    current.native.close();

    // 2) Apertura con el código actual: migración 5 sobre una base v4 con compra existente.
    const migrated = await openFile(file);
    try {
      expect(rows(migrated, 'SELECT version FROM schema_migrations ORDER BY version').map(row => row.version)).toEqual([1, 2, 3, 4, 5]);
      expect(rows(migrated, 'SELECT COUNT(*) AS n FROM transactions')).toEqual([{ n: totalBefore }]);
      // Revisión 0 creada por la migración: original, pendiente y sin inventar confirmación.
      expect(revisionShapes(migrated, p)).toEqual([[0, 'original', 'pendingVerification', 'firstCycleUnconfirmed', 60000000, 6, 10000000, null]]);
      expect(rows(migrated, 'SELECT COUNT(*) AS n FROM installment_allocations')).toEqual([{ n: 0 }]);
      expect(rows(migrated, 'PRAGMA integrity_check').map(row => Object.values(row)[0])).toEqual(['ok']);
    } finally { migrated.native.close(); }
  });

  test('base con un esquema más nuevo (migración 6 desconocida): la aplicación la abre sin validar la versión máxima', async () => {
    const file = path.join(workdir, 'v6.db');
    const f = await financialIntegrityFixture({ managed: false, syntheticPath: file });
    f.native.exec("INSERT INTO schema_migrations VALUES (6, '2026-11-07T00:00:00.000Z');");
    f.native.close();
    const reopened = await openFile(file);
    try {
      expect(rows(reopened, 'SELECT version FROM schema_migrations WHERE version = 6')).toEqual([{ version: 6 }]);
      expect(rows(reopened, 'PRAGMA integrity_check').map(row => Object.values(row)[0])).toEqual(['ok']);
    } finally { reopened.native.close(); }
  });

  test('tabla de la migración 5 ausente en la copia: la apertura no la repara, no falla y el error aparece al consultarla', async () => {
    const file = path.join(workdir, 'sin-primeros-ciclos.db');
    const f = await financialIntegrityFixture({ managed: false, syntheticPath: file });
    const p = await purchase(f, 'card', 600000, 6, 'Compra sin ciclo');
    await createSqliteInstallmentHistoryRepository(f.database).saveFirstCycle({ installmentPurchaseId: p, cycleEnd: '2026-10-20', source: 'user', createdAt: NOW, updatedAt: NOW });
    f.native.exec('DROP TABLE installment_first_cycles;');
    f.native.close();
    // Hallazgo: applySchema omite INSTALLMENT_HISTORY_SCHEMA y la migración 5 ya consta en schema_migrations.
    const reopened = await openFile(file);
    try {
      expect(rows(reopened, 'SELECT version FROM schema_migrations ORDER BY version').map(row => row.version)).toContain(5);
      expect(() => reopened.native.prepare('SELECT COUNT(*) FROM installment_first_cycles').all()).toThrow(/no such table/);
      expect(rows(reopened, 'PRAGMA integrity_check').map(row => Object.values(row)[0])).toEqual(['ok']);
    } finally { reopened.native.close(); }
  });

  test('el contador financiero puede coincidir entre historias distintas: la comparación de respaldo no basta', async () => {
    const live = path.join(workdir, 'contador-live.db');
    const f = await financialIntegrityFixture({ managed: true, syntheticPath: live });
    await purchase(f, 'card', 100000, 1, 'Base contador');
    const base = counter(f);
    f.native.close();
    const copy = path.join(workdir, 'contador-copia.db');
    fs.copyFileSync(live, copy);
    const a = await openFile(live);
    await a.save({ amount: 1000, merchantName: 'Variante A' });
    const counterA = counter(a);
    const stateA = await financialState(a);
    a.native.close();
    const b = await openFile(copy);
    await b.save({ amount: 2000, merchantName: 'Variante B' });
    const counterB = counter(b);
    const stateB = await financialState(b);
    b.native.close();
    expect(base).toBeGreaterThan(0);
    expect(counterA).toBe(counterB);
    expect(stateB).not.toEqual(stateA);
  });
});
