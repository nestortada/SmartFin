import { createSqliteAccountRepository } from './src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from './src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from './src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { saveManualTransaction, deleteManualTransactionSafely } from './src/modules/transactions/useCases/saveManualTransaction';
import { updateTransactionQuickly } from './src/modules/transactions/useCases/updateTransactionQuickly';
import { registerCreditCardPayment } from './src/modules/creditCards/useCases/creditCardTransactionRelations';
import { getDashboardSummaryFromDb } from './src/modules/dashboard/useCases/getDashboardSummary';
import { SQLiteCommandFailure } from './src/database/atomicSQLite';
import { sqliteLifecycleReceipt } from './src/database/sqliteLifecycle';
import { sqliteConnectionState } from './src/database/managedSQLite';
import { applyVersionedMigrations } from './src/database/migrations';
import { SQLITE_SCHEMA_STATEMENTS } from './src/database/sqliteSchema';
import { createSqliteSubscriptionRepository } from './src/modules/subscriptions/repositories/sqliteSubscriptionRepository';
import { createSubscriptionApi } from './src/modules/subscriptions/useCases/createSubscriptionApi';

const now = new Date('2026-10-11T12:00:00.000Z');
export async function manualCampaign({ fixture, reopen, config, check }) {
  const cases = [];
  const test = async (name, operation) => {
    const start = Date.now(); let timer;
    try {
      const evidence = await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('CASE_TIMEOUT: possible deadlock')), 60000);
      })]);
      cases.push({ name, passed: true, durationMs: Date.now() - start, evidence });
    } catch (error) {
      cases.push({ name, passed: false, error: String(error) });
      // A stuck owner invalidates subsequent cases; fail the campaign immediately.
      if (String(error).includes('CASE_TIMEOUT')) throw new Error(JSON.stringify({ cases, campaign: 'phase2', passed: false }));
    } finally { clearTimeout(timer); }
  };
  const setup = async () => {
    const f = await fixture();
    await f.database.executeSql("INSERT INTO accounts(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES ('target','Destination','bankAccount','active','COP',0,NULL,'2026-01-01','2026-01-01'),('card','Visa','creditCard','active','COP',0,0,'2026-01-01','2026-01-01')");
    const dependencies = {
      accountRepository: createSqliteAccountRepository(f.database),
      transactionRepository: createSqliteTransactionRepository(f.database),
      creditCardRepository: createSqliteCreditCardRepository(f.database),
    };
    const request = changes => ({ ...dependencies, accounts: [], accountId: 'bank', amount: 250000,
      merchantName: 'Visa', operationType: 'Débito', transactionType: 'expense',
      hasInterestFreeInstallments: false, installmentCountInput: '1', interestFreeInstallmentCountInput: '',
      currentDate: now, ...changes });
    return { ...f, ...dependencies, request, save: changes => saveManualTransaction(request(changes)) };
  };
  const inspect = async f => {
    const [fk] = await f.database.executeSql('PRAGMA foreign_key_check');
    const [mode] = await f.database.executeSql('PRAGMA foreign_keys');
    const [integrity] = await f.database.executeSql('PRAGMA integrity_check');
    check(mode.rows.item(0).foreign_keys === 1 && !fk.rows.length && integrity.rows.item(0).integrity_check === 'ok', 'integrity');
    const accounts = await f.accountRepository.getAccounts();
    const summary = await getDashboardSummaryFromDb(f.database, now);
    return { tables: await f.snapshot(), accounts, summary };
  };
  const payment = async f => {
    await f.save({ accountId: 'card', operationType: 'Crédito' });
    return registerCreditCardPayment({ ...f, accountId: 'card', sourceAccountId: 'bank', amount: 100000, currentDate: now });
  };
  const remove = (f, transaction) => deleteManualTransactionSafely({ ...f, accounts: [], transaction });
  const linked = async f => {
    const tx = await f.save({ transactionDate: '2026-01-10T12:00:00.000Z' });
    let id = 0;
    const api = createSubscriptionApi({ repository: createSqliteSubscriptionRepository(f.database),
      clock: { now: () => now }, createId: () => `synthetic-${++id}`, reminderService: {
        getStatus: async () => ({ available: false, permission: 'unsupported' }),
        requestPermission: async () => ({ available: false, permission: 'unsupported' }),
        schedule: async () => {}, cancel: async () => {}, cancelAll: async () => {}, ensureMaintenance: async () => {},
      } });
    const sub = await api.createSubscription({ name: 'Synthetic', amount: 250000, anchorDate: '2026-01-10', recurrence: { periodicity: 'monthly' }, accountId: 'bank' });
    const history = await api.getSubscriptionHistory(sub.value.id, { limit: 500 });
    await api.confirmSubscriptionPayment({ occurrenceId: history.find(value => value.expectedDate === '2026-01-10').id, transactionId: tx.transaction.id });
    return tx.transaction;
  };
  const scenarios = [
    { name: 'taxed transfer', prepare: async f => () => f.save({ transactionType: 'internalTransfer', targetAccountId: 'target', amount: 100000, transferTaxCharged: true }) },
    { name: 'existing payment edit', prepare: async f => {
      const tx = await payment(f); return () => f.save({ editingTransaction: tx.transaction, transactionType: 'creditCardPayment', amount: 50000, targetAccountId: 'card' });
    } },
    { name: 'debit deletion', prepare: async f => { const tx = await f.save(); return () => remove(f, tx.transaction); } },
    { name: 'existing payment deletion', prepare: async f => { const tx = await payment(f); return () => remove(f, tx.transaction); } },
    { name: 'credit installments', prepare: async f => () => f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3' }) },
    { name: 'quick debit credit', prepare: async f => { const tx = await f.save(); return () => updateTransactionQuickly(f, tx.transaction.id, { kind: 'paymentMethod', operationType: 'Crédito' }); } },
    { name: 'quick credit debit', prepare: async f => {
      const tx = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3' });
      return () => updateTransactionQuickly(f, tx.transaction.id, { kind: 'paymentMethod', operationType: 'Débito' });
    } },
    { name: 'quick unchanged installments', prepare: async f => {
      const tx = await f.save({ accountId: 'card', operationType: 'Crédito', installmentCountInput: '3' });
      await f.database.executeSql('UPDATE installment_purchases SET paid_installments=1 WHERE transaction_id=?', [tx.transaction.id]);
      return () => updateTransactionQuickly(f, tx.transaction.id, { kind: 'installments', installmentCount: 3, interestFreeCount: 1 });
    } },
    { name: 'historical subscription edit', prepare: async f => { const tx = await linked(f); return () => f.save({ editingTransaction: tx, amount: 240000 }); } },
    { name: 'historical subscription deletion', prepare: async f => { const tx = await linked(f); return () => remove(f, tx); } },
  ];
  const probeFixture = await setup();
  const [probe] = await probeFixture.database.executeSql('SELECT sqlite_version() AS version');
  await probeFixture.database.close();
  const matrix = [];
  for (const scenario of scenarios) {
    console.info(`Phase 2: ${scenario.name}`);
    const discovery = await setup(); const operation = await scenario.prepare(discovery);
    discovery.trace.length = 0; await operation();
    const writes = discovery.trace.filter(sql => /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql));
    check(discovery.trace.filter(sql => /^BEGIN/.test(sql)).length === 1 && discovery.trace.filter(sql => /^COMMIT/.test(sql)).length === 1, 'one financial commit');
    const success = await inspect(discovery);
    await discovery.database.close();
    matrix.push({ name: scenario.name, writes: writes.length, points: writes.length * 2, success });
    for (let position = 0; position < writes.length; position++) {
      for (const phase of ['before', 'after']) {
        await test(`${scenario.name}: write ${position + 1} ${phase}`, async () => {
          const f = await setup();
          try {
            const op = await scenario.prepare(f); const before = await inspect(f);
            f.trace.length = 0;
            // Select a repeated SQL occurrence by wrapping the raw promise adapter.
            // fixture's one-shot SQL fault is armed only when this position is reached.
            const sql = writes[position];
            let count = 0;
            const targetOccurrence = writes.slice(0, position + 1).filter(value => value === sql).length;
            // fixture injector gains an optional occurrence argument in the prepared copy.
            f.inject(sql, phase, targetOccurrence);
            let rejected;
            try { await op(); } catch (error) { rejected = error; }
            check(rejected && !(rejected instanceof SQLiteCommandFailure), 'ordinary failure with confirmed rollback');
            count = f.trace.filter(value => /^ROLLBACK/.test(value)).length;
            check(count === 1 && !f.trace.some(value => /^COMMIT/.test(value)), 'one rollback, no commit');
            const after = await inspect(f);
            check(JSON.stringify(before) === JSON.stringify(after), 'all tables, balances, debt, statements, subscriptions, revision and metrics restored');
            return { sql, phase, occurrence: targetOccurrence, rollback: 'confirmed' };
          } finally { await f.database.close(); }
        });
      }
    }
    console.info(`Phase 2 completed: ${scenario.name}, ${writes.length * 2} fault points`);
  }
  await test('concurrent edit delete reader and duplicate quick changes', async () => {
    const f = await setup();
    try {
      const tx = await f.save(); const b = f.pause('UPDATE accounts');
      const edit = f.save({ editingTransaction: tx.transaction, amount: 200000 }); await b.arrived;
      let observed = false;
      const reader = f.accountRepository.getAccounts().then(value => { observed = true; return value; });
      const deletion = remove(f, tx.transaction).catch(error => error);
      await Promise.resolve(); check(!observed, 'reader waits'); b.release();
      const changed = await edit; check((await deletion) instanceof Error, 'stale delete rejected');
      check((await reader).find(account => account.id === 'bank').balance.amount === 800000, 'reader sees confirmed state');
      await remove(f, changed.transaction); await remove(f, changed.transaction);
      const expense = await f.save();
      for (const operationType of ['Crédito', 'Crédito', 'Débito']) await updateTransactionQuickly(f, expense.transaction.id, { kind: 'paymentMethod', operationType });
      const balances = accounts => accounts.map(account => [account.id, account.balance.amount, account.debtBalance?.amount]);
      const beforeRepeat = balances(await f.accountRepository.getAccounts());
      await updateTransactionQuickly(f, expense.transaction.id, { kind: 'paymentMethod', operationType: 'Débito' });
      const afterRepeat = balances(await f.accountRepository.getAccounts());
      check(JSON.stringify(beforeRepeat) === JSON.stringify(afterRepeat), 'no repeated impact on any account');
      const summary = await getDashboardSummaryFromDb(f.database, now);
      check(summary.availableBalance === 750000 && summary.totalDebt === 0, 'financial totals');
      return { readerWaited: true, staleDeleteRejected: true, balances: afterRepeat };
    } finally { await f.database.close(); }
  });
  await test('real SQLite FK and dedupe constraints roll back balances', async () => {
    const f = await setup();
    try {
      await f.save({ dedupeKey: 'existing' }); const before = await inspect(f);
      for (const changes of [{ categoryId: 'missing' }, { dedupeKey: 'existing' }]) {
        let rejected; try { await f.save(changes); } catch (error) { rejected = error; }
        check(rejected && JSON.stringify(before) === JSON.stringify(await inspect(f)), 'constraint full rollback');
      }
    } finally { await f.database.close(); }
  });
  for (const phase of ['before', 'after']) await test(`manual unknown COMMIT ${phase} and recovery`, async () => {
    const f = await setup(); const command = f.request({ amount: 100000 });
    f.inject('COMMIT', phase);
    let failure; try { await saveManualTransaction(command); } catch (error) { failure = error; }
    check(failure instanceof SQLiteCommandFailure && failure.result.status === 'unknown', 'unknown');
    const count = f.trace.length;
    try { await saveManualTransaction(command); } catch (error) { check(error === failure, 'same rejected command'); }
    check(f.trace.length === count && sqliteConnectionState(f.database).status === 'closed', 'no retry');
    const clean = await reopen(f.name);
    const [bank] = await clean.executeSql("SELECT balance_amount FROM accounts WHERE id='bank'");
    check(bank.rows.item(0).balance_amount === (phase === 'after' ? 900000 : 1000000), 'recovered persisted result');
    await clean.close();
    return { status: 'unknown', phase, bank: bank.rows.item(0).balance_amount };
  });
  await test('manual rollback lost receipt recovers without retry', async () => {
    const f = await setup();
    const b = f.pause('UPDATE accounts');
    const operation = f.save({ categoryId: 'missing' }); await b.arrived;
    f.inject('ROLLBACK', 'before'); b.release();
    let failure; try { await operation; } catch (error) { failure = error; }
    check(failure instanceof SQLiteCommandFailure && failure.result.status === 'unknown', 'unknown rollback');
    const clean = await reopen(f.name); const [bank] = await clean.executeSql("SELECT balance_amount FROM accounts WHERE id='bank'");
    check(bank.rows.item(0).balance_amount === 1000000, 'abandoned transaction recovered'); await clean.close();
    return { status: 'unknown', bank: 1000000 };
  });
  await test('large synthetic database initialization verification and queued reader timing', async () => {
    const f = await setup();
    await f.database.executeSql(`WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<100000)
      INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at)
      SELECT 'large-'||n,1,'COP','Synthetic','2026-01-10T12:00:00.000Z','bank','expense','outflow','posted','2026-01-10','2026-01-10' FROM sequence`);
    await f.database.close(); const start = Date.now();
    const clean = await sqliteLifecycleReceipt((async () => {
      const database = await reopen(f.name);
      for (const sql of SQLITE_SCHEMA_STATEMENTS) await database.executeSql(sql);
      await applyVersionedMigrations(database); return database;
    })(), 'state verification');
    const verificationMs = Date.now() - start;
    const dependencies = { accountRepository: createSqliteAccountRepository(clean), transactionRepository: createSqliteTransactionRepository(clean), creditCardRepository: createSqliteCreditCardRepository(clean) };
    const [txs] = await clean.executeSql("SELECT count(*) AS count FROM transactions");
    check(txs.rows.item(0).count === 100000, 'large database preserved');
    // Natural read wait while a complete-history quick edit owns the connection.
    const operationStart = Date.now();
    const edit = updateTransactionQuickly(dependencies, 'large-50000', { kind: 'paymentMethod', operationType: 'Crédito' });
    const readerStart = Date.now();
    const reader = dependencies.accountRepository.getAccounts();
    await edit; const operationMs = Date.now() - operationStart; await reader;
    const readerMs = Date.now() - readerStart;
    await clean.close(); return { rows: 100000, verificationMs, operationMs, readerMs, timeoutMs: 10000 };
  });
  return { config, campaign: 'phase2', driver: probe.rows.item(0).version, matrix, cases, passed: cases.every(value => value.passed) };
}
