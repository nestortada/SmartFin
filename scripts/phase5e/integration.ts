import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteSharedExpenseRepository } from '../../src/modules/transactions/repositories/sqliteSharedExpenseRepository';
import { createSharedExpenseApi } from '../../src/modules/transactions/useCases/createSharedExpenseApi';
import { saveManualTransaction, type SaveManualTransactionParams } from '../../src/modules/transactions/useCases/saveManualTransaction';
import { registerCreditCardPayment } from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { createSqliteSubscriptionRepository } from '../../src/modules/subscriptions/repositories/sqliteSubscriptionRepository';
import { createSubscriptionApi } from '../../src/modules/subscriptions/useCases/createSubscriptionApi';
import type { SubscriptionReminderService } from '../../src/modules/subscriptions/services/SubscriptionReminderService';
import { executeAiCommandPlan } from '../../src/modules/transactions/useCases/executeAiCommandPlan';
import { createSqliteAiDraftRepository, saveAiDraftForReview } from '../../src/modules/transactions/repositories/sqliteAiDraftRepository';
import type { AiCommandPlan } from '../../src/modules/transactions/types';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import { resultSetToRows } from '../../src/database/sqliteRows';

export const DATE = new Date('2026-10-24T12:00:00.000Z');
export function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function inspectIntegrated(database: SmartFinSQLiteDatabase) {
  const rows = async (sql: string) => resultSetToRows((await database.executeSql(sql))[0]);
  const tables: Record<string, Awaited<ReturnType<typeof rows>>> = {};
  const columns: Record<string, Awaited<ReturnType<typeof rows>>> = {};
  for (const row of await rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) {
    check(typeof row.name === 'string', 'Invalid table');
    const name = row.name.replace(/"/g, '""');
    columns[row.name] = await rows(`PRAGMA table_info("${name}")`);
    const order = columns[row.name]!.map(column => '"' + String(column.name).replace(/"/g, '""') + '"').join(',');
    tables[row.name] = await rows(`SELECT * FROM "${name}" ORDER BY ${order}`);
  }
  const fk = await rows('PRAGMA foreign_key_check');
  const integrity = await rows('PRAGMA integrity_check');
  const enabled = await rows('PRAGMA foreign_keys');
  check(!fk.length && integrity[0]?.integrity_check === 'ok' && enabled[0]?.foreign_keys === 1, 'SQLite integrity');
  const summary = await getDashboardSummaryFromDb(database, DATE);
  return { tables, columns, fk, integrity, enabled, metrics: {
    available: summary.availableBalance, wealth: summary.netWorth,
    debt: summary.totalDebt, income: summary.monthlyIncome, expense: summary.monthlyExpenses,
  } };
}

/** Synthetic acceptance only. Caller must provide an empty isolated test database. */
export async function integratedFixture(database: SmartFinSQLiteDatabase, reminders: SubscriptionReminderService, seed = true) {
  if (seed) {
  const [existing] = await database.executeSql('SELECT count(*) AS n FROM accounts');
  check(existing.rows.item(0).n === 0, 'Fixture requires empty synthetic database');
  await database.executeSql(`INSERT INTO accounts(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES
    ('bank','Synthetic bank','bankAccount','active','COP',1000000,NULL,'2026-10-24','2026-10-24'),
    ('cash','Synthetic cash','cash','active','COP',50000,NULL,'2026-10-24','2026-10-24'),
    ('target','Synthetic savings','savingsAccount','active','COP',0,NULL,'2026-10-24','2026-10-24'),
    ('card','Synthetic Visa','creditCard','active','COP',0,0,'2026-10-24','2026-10-24')`);
  await database.executeSql("INSERT INTO categories(id,name,type,macro_category,color) VALUES('food','Synthetic food','expense','food','#ffffff')");
  // Opening audit is a synthetic fixture row; manual commands do not promise to append this table.
  await database.executeSql("INSERT INTO account_balance_history(id,account_id,balance_amount,currency,recorded_at,created_at) VALUES('opening-audit','bank',1000000,'COP','2026-10-24','2026-10-24')");
  }
  const accountRepository = createSqliteAccountRepository(database);
  const transactionRepository = createSqliteTransactionRepository(database);
  const creditCardRepository = createSqliteCreditCardRepository(database);
  const dependencies = { accountRepository, transactionRepository, creditCardRepository };
  const shared = createSharedExpenseApi(createSqliteSharedExpenseRepository(database));
  const subscriptionRepository = createSqliteSubscriptionRepository(database);
  let subscriptionId = 0;
  const subscriptions = createSubscriptionApi({ repository: subscriptionRepository, reminderService: reminders,
    clock: { now: () => DATE }, createId: () => 'integrated-sub-' + ++subscriptionId });
  const save = async (changes: Partial<SaveManualTransactionParams> = {}) => saveManualTransaction({
    ...dependencies, accounts: await accountRepository.getAccounts(), accountId: 'bank', amount: 44900,
    merchantName: 'Synthetic', transactionType: 'expense', operationType: 'Débito',
    hasInterestFreeInstallments: false, installmentCountInput: '1', interestFreeInstallmentCountInput: '',
    currentDate: DATE, occurrence: { kind: 'date', date: '2026-10-24' }, ...changes,
  });
  const payment = (amount = 30000) => registerCreditCardPayment({ ...dependencies, accountId: 'card', sourceAccountId: 'bank', amount, currentDate: DATE });
  return { database, ...dependencies, shared, subscriptions, subscriptionRepository, save, payment };
}
export type IntegratedFixture = Awaited<ReturnType<typeof integratedFixture>>;

export async function buildIntegratedScenario(f: IntegratedFixture) {
  const evidence: { name: string; state: Awaited<ReturnType<typeof inspectIntegrated>> }[] = [];
  const expected = { available: 1050000, wealth: 1050000, debt: 0, income: 0, expense: 0 };
  const verify = async (name: string) => {
    const state = await inspectIntegrated(f.database);
    check(JSON.stringify(state.metrics) === JSON.stringify(expected), name + ': ' + JSON.stringify({ actual: state.metrics, expected }));
    evidence.push({ name, state }); return state;
  };
  await verify('initial');
  await f.save({ amount: 200000, transactionType: 'income' });
  expected.available += 200000; expected.wealth += 200000; expected.income += 200000;
  await verify('income');
  await f.save(); expected.available -= 44900; expected.wealth -= 44900; expected.expense += 44900;
  const expense = (await f.transactionRepository.getTransactions()).find(t => t.type === 'expense')!;
  await verify('expense');
  await f.save({ amount: 100000, transactionType: 'internalTransfer', targetAccountId: 'target', transferTaxCharged: true });
  expected.available -= 400; expected.wealth -= 400; expected.expense += 400;
  let state = await verify('transfer-and-tax');
  check(state.tables.transactions!.filter(t => t.type === 'internalTransfer').length === 2, 'Transfer legs');
  await f.save({ accountId: 'card', operationType: 'Crédito', amount: 90000, installmentCountInput: '3' });
  expected.debt += 90000; expected.wealth -= 90000; expected.expense += 90000;
  state = await verify('credit-installments');
  check(state.tables.installment_purchases!.length === 1 && state.tables.credit_card_statements!.length > 0, 'Card references');
  const beforePayment = state;
  await f.payment(); expected.available -= 30000; expected.debt -= 30000;
  state = await verify('card-payment-no-second-expense');
  check(state.tables.transactions!.length === beforePayment.tables.transactions!.length + 1, 'Payment count');
  let rejected = false;
  try { await f.payment(0.40); } catch { rejected = true; }
  check(rejected && JSON.stringify(state) === JSON.stringify(await inspectIntegrated(f.database)), 'Zero-rounded positive payment changed data');
  const input = { name: 'Synthetic paid subscription', amount: 44900, accountId: 'bank',
    recurrence: { periodicity: 'monthly' as const }, anchorDate: '2026-10-24',
    reminders: { enabled: true, offsets: [0], hour: 15, minute: 0 } };
  const paid = await f.subscriptions.createSubscription(input);
  await verify('subscription-commitment-no-expense');
  const occurrences = await f.subscriptions.getSubscriptionHistory(paid.value.id, { limit: 50, offset: 0 });
  const occurrence = occurrences.find(o => o.expectedDate === '2026-10-24')!;
  check(occurrence, 'Missing obligation');
  await f.subscriptions.confirmSubscriptionPayment({ occurrenceId: occurrence.id, transactionId: expense.id });
  state = await verify('subscription-paid-existing-expense');
  const count = state.tables.transactions!.length;
  await f.subscriptions.confirmSubscriptionPayment({ occurrenceId: occurrence.id, transactionId: expense.id });
  state = await verify('subscription-repeat-no-expense');
  check(state.tables.transactions!.length === count, 'Duplicate subscription expense');
  await f.subscriptions.createSubscription({ ...input, name: 'Synthetic pending subscription', anchorDate: '2026-10-25' });
  await verify('pending-obligation-and-reminders');
  const person = (await f.shared.saveContact('integrated-person', 'Synthetic friend')).entityId;
  const purchase = await f.shared.createPurchase('integrated-purchase', {
    purchase: { accountId: 'bank', amount: 30000, categoryId: 'food', merchantName: 'Synthetic shared', operationType: 'Débito', occurrence: { kind: 'date', date: '2026-10-24' } },
    distribution: { mode: 'amounts', personalAmount: 15000, participants: [{ contactId: person, amount: 15000 }] },
  });
  expected.available -= 30000; expected.wealth -= 15000; expected.expense += 15000;
  await verify('shared-purchase');
  const participationId = (await f.shared.getExpense(purchase.entityId)).participants[0]!.participationId;
  await f.shared.recordReceipt('integrated-receipt', { contactId: person, accountId: 'cash', amount: 5000,
    occurrence: { kind: 'date', date: '2026-10-24' }, applications: [{ participationId, amount: 5000 }] });
  expected.available += 5000;
  await verify('shared-reimbursement-no-income-or-expense');
  await f.shared.forgiveParticipation('integrated-forgive', { participationId, amount: 10000, date: '2026-10-24', reason: 'Synthetic acceptance' });
  expected.wealth -= 10000;
  await verify('forgiven-receivable');
  const plan: AiCommandPlan = { version: 1, summary: 'Synthetic AI expense', answeredFields: [], actions: [
    { id: 'expense', entity: 'transaction', operation: 'create', fields: { accountId: 'bank', amount: 1000, description: 'Synthetic AI', transactionType: 'expense', date: '2026-10-24' } },
  ] };
  const drafts = createSqliteAiDraftRepository(f.database);
  await saveAiDraftForReview(f.database, { id: 'integrated-ai', plan, phase: 'review', rawInput: 'Synthetic', messages: [], clarificationHistory: [], createdAt: DATE.toISOString(), updatedAt: DATE.toISOString() });
  await executeAiCommandPlan(f.database, 'integrated-ai', plan, undefined);
  expected.available -= 1000; expected.wealth -= 1000; expected.expense += 1000;
  state = await verify('ai-confirmed');
  await executeAiCommandPlan(f.database, 'integrated-ai', plan, undefined);
  const repeated = await inspectIntegrated(f.database);
  // Diagnostic only (5E.5): name what changed, e.g. asynchronous reminder delivery acknowledgements.
  const changed = Object.keys(repeated.tables).filter(t => JSON.stringify(state.tables[t]) !== JSON.stringify(repeated.tables[t]));
  check(JSON.stringify(state) === JSON.stringify(repeated), 'AI repeated confirmed impacts: ' + JSON.stringify({ changed,
    reminders: changed.includes('subscription_reminders') ? repeated.tables.subscription_reminders!.map(r => r.delivery_status) : undefined }));
  check(await drafts.loadActiveDraft() === undefined, 'Receipt still active');
  check(state.tables.ai_command_drafts!.some(r => r.phase === 'confirmed'), 'Missing AI receipt');
  check(state.tables.account_balance_history!.length > 0 && state.tables.financial_data_revision!.length === 1, 'Missing audit/revision');
  check(state.tables.subscription_occurrences!.some(r => r.status === 'paid') && state.tables.subscription_occurrences!.some(r => r.status === 'pending'), 'Obligation coverage');
  return evidence;
}
