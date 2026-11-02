// Phase 0 · 4.4 First installation and categories. Synthetic in-memory SQLite only.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { realSQLite } from '../helpers/realSQLite';
import { FINANCIAL_TEST_DATE } from '../helpers/financialIntegrityFixture';
import { SQLITE_SCHEMA_STATEMENTS } from '../../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../../src/database/migrations';
import { SHARED_LOSS_SCHEMA } from '../../src/modules/transactions/database/sharedLossSchema';
import { SHARED_EXPENSE_INDEXES, SHARED_EXPENSE_SCHEMA, SHARED_EXPENSE_TRIGGERS } from '../../src/modules/transactions/database/sharedExpenseSchema';
import { createSqliteCategoryRepository } from '../../src/modules/categories/repositories/sqliteCategoryRepository';
import { createCategory, deleteCategory, FALLBACK_CATEGORY_ID } from '../../src/modules/categories/useCases/manageCategories';
import { mockCategoryRepository } from '../../src/modules/categories';
import { createSqliteFinancialDataRepository } from '../../src/modules/settings/repositories/sqliteFinancialDataRepository';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { saveManualTransaction } from '../../src/modules/transactions/useCases/saveManualTransaction';
import { UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID } from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { phase0Evidence } from './phase0Evidence';

const evidence = phase0Evidence('firstInstallCategories');
beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] }); jest.setSystemTime(FINANCIAL_TEST_DATE); });
afterEach(() => jest.useRealTimers());

/**
 * A brand-new database exactly as openSmartFinDatabase/applySchema builds it (sqliteDatabase.ts): the same
 * statement filter, then the versioned migrations. Nothing else runs on first launch (seedSmartFinDatabase is
 * exported but never called by the app).
 */
async function freshInstall() {
  const sql = realSQLite({ fixedSqlDate: FINANCIAL_TEST_DATE });
  const skipped = [...SHARED_LOSS_SCHEMA, ...SHARED_EXPENSE_SCHEMA, ...SHARED_EXPENSE_INDEXES, ...SHARED_EXPENSE_TRIGGERS];
  for (const statement of SQLITE_SCHEMA_STATEMENTS) if (!skipped.includes(statement)) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  const categories = createSqliteCategoryRepository(sql.database);
  const integrity = () => ({
    integrity: sql.query('PRAGMA integrity_check;').rows.item(0),
    foreignKeys: sql.query('PRAGMA foreign_key_check;').rows.raw(),
  });
  const ids = (table: string) => sql.query(`SELECT id FROM ${table} ORDER BY id;`).rows.raw().map(row => row.id);
  return { ...sql, categories, integrity, ids };
}
type Fresh = Awaited<ReturnType<typeof freshInstall>>;

async function rejection(promise: Promise<unknown>) {
  try { await promise; return undefined; } catch (error) { return (error as Error).message; }
}

async function createAndDelete(f: Fresh) {
  const custom = await createCategory(f.categories, { name: 'Mascotas', type: 'expense', color: '#123456' });
  f.native.prepare(`INSERT INTO transactions (id,account_id,category_id,amount,currency,direction,type,status,date,description,created_at,updated_at)
    VALUES ('tx-pet','bank',?,1000,'COP','outflow','expense','posted','2026-10-11','Concentrado','2026-10-11','2026-10-11');`).run(custom.id);
  const deletion = await rejection(deleteCategory(f.categories, custom.id));
  return { custom, deletion, transactionCategory: f.query("SELECT category_id FROM transactions WHERE id='tx-pet';").rows.item(0)?.category_id };
}

function insertBank(f: Fresh) {
  f.native.exec(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,created_at,updated_at)
    VALUES ('bank','Banco','bankAccount','active','COP',1000000,'2026-01-01','2026-01-01');`);
}

test('characterization: a fresh installation has no categories at all, so «Otros» does not exist', async () => {
  const f = await freshInstall();
  try {
    expect(f.ids('categories')).toEqual([]);
    expect(f.ids('accounts')).toEqual([]);
    expect(f.integrity()).toEqual({ integrity: { integrity_check: 'ok' }, foreignKeys: [] });
    evidence.freshInstall = { status: 'confirmed', observed: { categories: [], accounts: [] },
      expected: `${FALLBACK_CATEGORY_ID} («Otros») exists from the first launch` };
  } finally { f.native.close(); }
});

test('card references are created on demand: an unmatched credit purchase creates «Tarjeta por clasificar»', async () => {
  const f = await freshInstall();
  try {
    insertBank(f);
    const accountRepository = createSqliteAccountRepository(f.database);
    await saveManualTransaction({
      accountRepository, transactionRepository: createSqliteTransactionRepository(f.database),
      creditCardRepository: createSqliteCreditCardRepository(f.database), accounts: await accountRepository.getAccounts(),
      amount: 50000, merchantName: 'Compra con tarjeta', operationType: 'Crédito', transactionType: 'expense',
      hasInterestFreeInstallments: false, installmentCountInput: '1', interestFreeInstallmentCountInput: '',
      currentDate: FINANCIAL_TEST_DATE,
    });
    expect(f.ids('accounts')).toEqual(['account-credit-card-unclassified', 'bank']);
    expect(f.query('SELECT account_id FROM transactions;').rows.item(0)).toEqual({ account_id: UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID });
    expect(f.integrity().foreignKeys).toEqual([]);
    evidence.cardReferences = { status: 'discarded', observed: 'created lazily with valid references; no essential card row is missing on first launch' };
  } finally { f.native.close(); }
});

test('characterization: on a fresh installation a custom category can be created but never deleted', async () => {
  const f = await freshInstall();
  try {
    insertBank(f);
    const result = await createAndDelete(f);
    expect(result.deletion).toBe('No existe la categoria Otros para reasignar movimientos.');
    expect(result.transactionCategory).toBe(result.custom.id);
    expect(f.integrity()).toEqual({ integrity: { integrity_check: 'ok' }, foreignKeys: [] });
    evidence.customCategoryDeletion = { status: 'confirmed', observed: { deletion: result.deletion, referencesIntact: true } };
  } finally { f.native.close(); }
});

test('with «Otros» present, deletion reassigns references and keeps referential integrity', async () => {
  const f = await freshInstall();
  try {
    insertBank(f);
    await f.categories.saveCategories(mockCategoryRepository.getCategories());
    const result = await createAndDelete(f);
    expect(result).toMatchObject({ deletion: undefined, transactionCategory: FALLBACK_CATEGORY_ID });
    expect(f.ids('categories')).not.toContain(result.custom.id);
    expect(f.integrity()).toEqual({ integrity: { integrity_check: 'ok' }, foreignKeys: [] });
    evidence.deletionWithFallback = { status: 'discarded', observed: 'reassigned to category-other; foreign_key_check empty' };
  } finally { f.native.close(); }
});

test('characterization: the financial deletion removes «Otros» too, and category deletion breaks again', async () => {
  const f = await freshInstall();
  try {
    insertBank(f);
    await f.categories.saveCategories(mockCategoryRepository.getCategories());
    const result = await createSqliteFinancialDataRepository(f.database)
      .deleteFinancialData('22222222-2222-4222-8222-222222222222', { workIds: [], backupJobIds: [], snapshotIds: [] });
    expect(result.status).toBe('confirmed');
    expect(f.ids('categories')).toEqual([]);
    insertBank(f);
    const after = await createAndDelete(f);
    expect(after.deletion).toBe('No existe la categoria Otros para reasignar movimientos.');
    expect(f.integrity()).toEqual({ integrity: { integrity_check: 'ok' }, foreignKeys: [] });
    evidence.afterFinancialDeletion = { status: 'confirmed', observed: { categoriesAfterDeletion: [], deletion: after.deletion } };
  } finally { f.native.close(); }
});

test.failing('acceptance: «Otros» exists on a fresh installation', async () => {
  const f = await freshInstall();
  try { expect(f.ids('categories')).toContain(FALLBACK_CATEGORY_ID); } finally { f.native.close(); }
});

test.failing('acceptance: a custom category can be deleted on a fresh installation, reassigning to «Otros»', async () => {
  const f = await freshInstall();
  try {
    insertBank(f);
    expect(await createAndDelete(f)).toMatchObject({ deletion: undefined, transactionCategory: FALLBACK_CATEGORY_ID });
  } finally { f.native.close(); }
});

test.failing('acceptance: «Otros» survives (or is recreated by) the financial deletion', async () => {
  const f = await freshInstall();
  try {
    await f.categories.saveCategories(mockCategoryRepository.getCategories());
    await createSqliteFinancialDataRepository(f.database)
      .deleteFinancialData('33333333-3333-4333-8333-333333333333', { workIds: [], backupJobIds: [], snapshotIds: [] });
    expect(f.ids('categories')).toContain(FALLBACK_CATEGORY_ID);
  } finally { f.native.close(); }
});
