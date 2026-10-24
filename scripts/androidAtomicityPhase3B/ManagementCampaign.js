import { createSqliteAccountRepository } from './src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from './src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from './src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteCreditCardAlertRepository } from './src/modules/creditCards/repositories/sqliteCreditCardAlertRepository';
import { saveCreditCardFromForm, deleteCreditCard } from './src/modules/creditCards/useCases/manageCreditCards';
import { saveCreditCardWithAssociations, closeCreditCardWithReconciliation } from './src/modules/creditCards/useCases/creditCardManagementCommands';
import { associatePendingTransactionsForCreditCard, reconcileCreditCardTransactions, registerCreditCardPayment } from './src/modules/creditCards/useCases/creditCardTransactionRelations';
import * as oldManagement from './baseline/phase3BManageCreditCards';
import * as oldRelations from './baseline/phase3BCreditCardRelations';
import { getDashboardSummaryFromDb } from './src/modules/dashboard/useCases/getDashboardSummary';
import { SQLiteCommandFailure } from './src/database/atomicSQLite';
import { fixedClock, restoreClock, startProfile, stopProfile, wallClockNow } from './SqlProfile';

const now = new Date('2026-10-11T12:00:00.000Z');
const performance = global.performance;
const input = { accountId: 'new-card', name: 'Ghost', creditLimit: 3000000, annualEffectiveInterestRate: 0.25,
  closingDay: 20, paymentDay: 25, lastFourDigits: '1234', managementFee: 1000 };
const writePattern = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;
const dependencies = database => ({ accountRepository: createSqliteAccountRepository(database),
  creditCardRepository: createSqliteCreditCardRepository(database), transactionRepository: createSqliteTransactionRepository(database) });

export async function managementCampaign({ fixture, reopen, config, check }) {
  const cases = []; const matrix = []; const timings = [];
  fixedClock();
  const test = async (name, operation) => {
    const start = wallClockNow(); let timer;
    try {
      const evidence = await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('CASE_TIMEOUT: possible deadlock')), 120000);
      })]);
      cases.push({ name, passed: true, durationMs: wallClockNow() - start, evidence });
    } catch (error) {
      cases.push({ name, passed: false, error: String(error) });
      if (String(error).includes('CASE_TIMEOUT')) throw new Error(JSON.stringify({ cases, campaign: 'phase3b', passed: false }));
    } finally { clearTimeout(timer); }
  };
  const setup = async (flow = '') => {
    const f = await fixture(); const d = dependencies(f.database);
    for (const [id, name, type] of [['card', 'Visa', 'creditCard'], ['account-credit-card-unclassified', 'Unclassified', 'bankAccount']]) {
      await f.database.executeSql('INSERT INTO accounts(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES (?,?,?,\'active\',\'COP\',0,0,\'2026-01-01\',\'2026-01-01\')', [id, name, type]);
    }
    const purchases = ['posted', 'pending', 'cancelled'].map((status, index) => ({ id: `pending-${index}`, accountId: 'account-credit-card-unclassified',
      amount: 120000 + index, currency: 'COP', date: `2024-01-0${index + 1}`, description: 'Ghost', direction: 'outflow', type: 'expense',
      paymentMethod: 'credit', creditCardHint: 'Ghost', status, createdAt: now.toISOString(), updatedAt: now.toISOString() }));
    await d.transactionRepository.saveTransactions([...purchases, { ...purchases[0], id: 'card-purchase', accountId: 'card', amount: 90000, date: now.toISOString(), creditCardHint: 'Visa' }]);
    await d.creditCardRepository.saveInstallmentPurchases(purchases.map(tx => ({ id: `installment-${tx.id}`, transactionId: tx.id,
      accountId: tx.accountId, totalAmount: tx.amount, currency: 'COP', installmentCount: 3, paidInstallments: 1, monthlyAmount: Math.round(tx.amount / 3),
      firstDueDate: '2024-02-01', status: 'active', createdAt: tx.createdAt, updatedAt: tx.updatedAt })));
    await reconcileCreditCardTransactions({ ...d, currentDate: now });
    await createSqliteCreditCardAlertRepository(f.database).saveMissingCreditCardAlert({ creditCardHint: 'Ghost' });
    if (['edit', 'associate', 'edit-and-associate'].includes(flow)) await saveCreditCardFromForm(d.creditCardRepository, input);
    if (flow.includes('close')) {
      await f.database.executeSql("UPDATE transactions SET status='cancelled' WHERE account_id='card'");
      await f.database.executeSql("UPDATE accounts SET debt_balance_amount=0 WHERE id='card'");
      await f.database.executeSql("UPDATE credit_card_statements SET total_amount=0,status='paid' WHERE account_id='card'");
    }
    return f;
  };
  const inspect = async (f, connection = f.database) => {
    const [fk] = await connection.executeSql('PRAGMA foreign_key_check'); const [integrity] = await connection.executeSql('PRAGMA integrity_check');
    const [mode] = await connection.executeSql('PRAGMA foreign_keys');
    check(!fk.rows.length && integrity.rows.item(0).integrity_check === 'ok' && mode.rows.item(0).foreign_keys === 1, 'FK/integrity');
    return { tables: await f.snapshot(connection), summary: await getDashboardSummaryFromDb(connection, now) };
  };
  const execute = async (f, flow, historical = false) => {
    const d = dependencies(f.database); const repository = d.creditCardRepository;
    const management = historical ? oldManagement : { saveCreditCardFromForm, deleteCreditCard };
    const relations = historical ? oldRelations : { associatePendingTransactionsForCreditCard, reconcileCreditCardTransactions };
    const account = (await d.accountRepository.getAccounts()).find(card => card.id === 'new-card');
    if (flow === 'create' || flow === 'edit') return management.saveCreditCardFromForm(repository, input, account);
    if (flow === 'associate') return relations.associatePendingTransactionsForCreditCard({ ...d, account });
    if (flow.endsWith('and-associate')) {
      if (!historical) return saveCreditCardWithAssociations({ repository, input, existingAccount: account });
      const saved = await management.saveCreditCardFromForm(repository, input, account);
      const count = await relations.associatePendingTransactionsForCreditCard({ ...d, account: saved });
      if (count) await createSqliteCreditCardAlertRepository(f.database).resolveMissingCreditCardAlert(saved.name);
      return { account: saved, associatedCount: count };
    }
    if (flow === 'close') return management.deleteCreditCard(repository, 'card');
    if (flow === 'reconcile-and-close') {
      if (!historical) return closeCreditCardWithReconciliation({ repository, accountId: 'card' });
      await relations.reconcileCreditCardTransactions({ ...d, currentDate: now });
      return management.deleteCreditCard(repository, 'card');
    }
    return relations.reconcileCreditCardTransactions({ ...d, currentDate: now });
  };
  try {
    const probe = await fixture(); const [version] = await probe.database.executeSql('SELECT sqlite_version() AS version'); await probe.database.close();
    for (const flow of ['create', 'edit', 'associate', 'create-and-associate', 'edit-and-associate', 'close', 'reconcile-and-close', 'reconcile']) {
      const discovery = await setup(flow); discovery.trace.length = 0;
      await execute(discovery, flow); const writes = discovery.trace.filter(sql => writePattern.test(sql));
      check(writes.length > 0 && discovery.trace.filter(sql => /^BEGIN/.test(sql)).length === 1 && discovery.trace.filter(sql => /^COMMIT/.test(sql)).length === 1, 'one commit');
      const success = await inspect(discovery); await discovery.database.close();
      const previous = await setup(flow); await execute(previous, flow, true);
      check(JSON.stringify(success) === JSON.stringify(await inspect(previous)), 'all-table exact historical success equivalence');
      await previous.database.close();
      matrix.push({ flow, writes: writes.length, points: writes.length * 2, historicalExact: true });
      for (let position = 0; position < writes.length; position++) for (const phase of ['before', 'after']) await test(`${flow} write ${position + 1} ${phase}`, async () => {
        const f = await setup(flow);
        try {
          const before = await inspect(f); f.trace.length = 0;
          const sql = writes[position]; const occurrence = writes.slice(0, position + 1).filter(value => value === sql).length;
          f.inject(sql, phase, occurrence); let failure;
          try { await execute(f, flow); } catch (error) { failure = error; }
          check(failure && !(failure instanceof SQLiteCommandFailure), 'ordinary error, confirmed rollback');
          check(f.trace.filter(value => /^ROLLBACK/.test(value)).length === 1 && !f.trace.some(value => /^COMMIT/.test(value)), 'one rollback');
          check(JSON.stringify(before) === JSON.stringify(await inspect(f)), 'complete original snapshot including audit/revision/references');
          return { sql, phase, occurrence, rollback: 'confirmed' };
        } finally { await f.database.close(); }
      });
    }
    for (const amount of [0.01, 0.4, 0.49, -1, 0, NaN, Infinity, -Infinity]) await test(`invalid payment ${String(amount)}`, async () => {
      const f = await setup();
      try {
        const before = await inspect(f); f.trace.length = 0; let failure;
        try { await registerCreditCardPayment({ ...dependencies(f.database), accountId: 'card', sourceAccountId: 'bank', amount }); } catch (error) { failure = error; }
        check(failure && !f.trace.some(sql => writePattern.test(sql)), 'invalid before writes');
        check(JSON.stringify(before) === JSON.stringify(await inspect(f)), 'unchanged');
      } finally { await f.database.close(); }
    });
    for (const [amount, expected] of [[0.5, 1], [1, 1], [100000, 90000], [1000.6, 1001]]) await test(`valid payment ${amount}`, async () => {
      const f = await setup();
      try {
        const before = await getDashboardSummaryFromDb(f.database, now);
        const result = await registerCreditCardPayment({ ...dependencies(f.database), accountId: 'card', sourceAccountId: 'bank', amount });
        check(result.paidAmount === expected, 'valid round/cap');
        const after = await getDashboardSummaryFromDb(f.database, now);
        check(after.netWorth === before.netWorth && after.monthlyExpenses === before.monthlyExpenses, 'wealth and expense');
      } finally { await f.database.close(); }
    });
    for (const debt of [0.01, 0.4, 0.49, 0.5, 1.4, 90000.5]) await test(`invalid debt cap ${debt}`, async () => {
      const f = await setup();
      try {
        await f.database.executeSql("UPDATE transactions SET amount=? WHERE id='card-purchase'", [debt]);
        const before = await inspect(f); let failure;
        try { await registerCreditCardPayment({ ...dependencies(f.database), accountId: 'card', sourceAccountId: 'bank', amount: 100000 }); } catch (error) { failure = error; }
        check(failure && JSON.stringify(before) === JSON.stringify(await inspect(f)), 'invalid effective payment rolled back');
      } finally { await f.database.close(); }
    });
    await test('insufficient funds rolls back reconciliations', async () => {
      const f = await setup();
      try {
        await f.database.executeSql("UPDATE accounts SET balance_amount=0 WHERE id='bank'");
        const before = await inspect(f); let failure;
        try { await registerCreditCardPayment({ ...dependencies(f.database), accountId: 'card', sourceAccountId: 'bank', amount: 1 }); } catch (error) { failure = error; }
        check(failure && JSON.stringify(before) === JSON.stringify(await inspect(f)), 'all tables unchanged');
      } finally { await f.database.close(); }
    });
    for (const status of ['closed', 'inactive']) await test(`association and edit reject ${status}`, async () => {
      const f = await setup('associate');
      try {
        const d = dependencies(f.database); const account = (await d.accountRepository.getAccounts()).find(a => a.id === 'new-card');
        await f.database.executeSql("UPDATE accounts SET status=? WHERE id='new-card'", [status]);
        const before = await inspect(f); let rejected = 0;
        try { await associatePendingTransactionsForCreditCard({ ...d, account }); } catch { rejected++; }
        try { await saveCreditCardFromForm(d.creditCardRepository, input, account); } catch { rejected++; }
        check(rejected === 2 && JSON.stringify(before) === JSON.stringify(await inspect(f)), 'closed account, unchanged');
      } finally { await f.database.close(); }
    });
    await test('concurrent edits, same intent once and queued reader', async () => {
      const f = await setup('edit');
      try {
        const d = dependencies(f.database); const existingAccount = (await d.accountRepository.getAccounts()).find(a => a.id === 'new-card');
        const command = { repository: d.creditCardRepository, input: { ...input, creditLimit: 5000000 }, existingAccount };
        const barrier = f.pause('UPDATE accounts'); const first = saveCreditCardWithAssociations(command); await barrier.arrived;
        const repeat = saveCreditCardWithAssociations(command);
        const conflict = saveCreditCardWithAssociations({ repository: d.creditCardRepository, input, existingAccount }).catch(error => error);
        let read = false; const reader = d.accountRepository.getAccounts().then(value => { read = true; return value; });
        await Promise.resolve(); check(!read, 'reader excluded'); barrier.release();
        const result = await first; check(await repeat === result && await conflict instanceof Error, 'one intention, obsolete edit rejected');
        check((await reader).find(a => a.id === 'new-card').creditLimit.amount === 5000000, 'current value');
      } finally { await f.database.close(); }
    });
    for (const control of ['COMMIT', 'ROLLBACK']) for (const phase of ['before', 'after']) await test(`management unknown ${control} ${phase}`, async () => {
      const f = await setup(); const before = await inspect(f);
      const command = { repository: dependencies(f.database).creditCardRepository, input, accountId: 'card' };
      const operation = () => control === 'COMMIT' ? saveCreditCardWithAssociations(command) : closeCreditCardWithReconciliation(command);
      f.inject(control, phase); let failure;
      try { await operation(); } catch (error) { failure = error; }
      check(failure instanceof SQLiteCommandFailure && failure.result.status === 'unknown', 'unknown');
      const count = f.trace.length;
      try { await operation(); } catch (error) { check(error === failure, 'same rejection'); }
      check(f.trace.length === count, 'no retry');
      const clean = await reopen(f.name);
      try {
        const state = await inspect(f, clean);
        if (control === 'COMMIT' && phase === 'after') check(JSON.parse(state.tables).accounts.some(a => a.id === 'new-card'), 'whole command committed');
        else check(JSON.stringify(before) === JSON.stringify(state), 'whole original state recovered');
        return { status: 'unknown', control, phase };
      } finally { await clean.close(); }
    });
    for (const rows of [1000, 10000, 100000]) for (const flow of ['create-and-associate', 'reconcile-and-close', 'reconcile']) await test(`timing ${flow} ${rows}`, async () => {
      const f = await setup(flow);
      try {
        await f.database.executeSql(`WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<${rows})
          INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at)
          SELECT 'noise-'||n,1,'COP','Synthetic','2020-01-01','bank','expense','outflow','posted','2020-01-01','2020-01-01' FROM sequence`);
        const samples = [];
        // Independent fixture per operation: creation/closure are intentionally not replayed for warmup.
        f.trace.length = 0; startProfile(); const start = performance.now(); const operation = execute(f, flow);
        const readerStart = performance.now(); const reader = dependencies(f.database).accountRepository.getAccounts();
        await operation; const operationMs = performance.now() - start;
        const accounts = await reader; const readerMs = performance.now() - readerStart; const profile = stopProfile();
        check(accounts.find(a => a.id === 'bank').balance.amount === 1000000, 'bank unchanged');
        const begin = profile.sql.find(s => /^BEGIN/.test(s.sql)); const commit = profile.sql.find(s => /^COMMIT/.test(s.sql));
        check(begin && commit, 'transaction spans');
        const sample = { rows, flow, operationMs, readerMs, transactionMs: commit.endMs - begin.startMs,
          transactionRowsReturned: profile.sql.filter(s => /FROM transactions/.test(s.sql)).reduce((sum, s) => sum + s.rows, 0) };
        samples.push(sample); timings.push(sample); return { samples };
      } finally { stopProfile(); await f.database.close(); }
    });
    return { campaign: 'phase3b', passed: cases.every(c => c.passed), config, sqlite: version.rows.item(0).version, cases, matrix, timings };
  } finally { restoreClock(); }
}
