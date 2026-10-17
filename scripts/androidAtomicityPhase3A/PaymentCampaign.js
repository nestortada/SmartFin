import { createSqliteAccountRepository } from './src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from './src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from './src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { saveManualTransaction } from './src/modules/transactions/useCases/saveManualTransaction';
import { registerCreditCardPayment } from './src/modules/creditCards/useCases/creditCardTransactionRelations';
import { getDashboardSummaryFromDb } from './src/modules/dashboard/useCases/getDashboardSummary';
import { SQLiteCommandFailure } from './src/database/atomicSQLite';
import { sqliteConnectionState } from './src/database/managedSQLite';

const now = new Date('2026-10-11T12:00:00.000Z');
const writePattern = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;
export async function paymentCampaign({ fixture, reopen, config, check }) {
  const cases = []; const matrix = [];
  const test = async (name, operation) => {
    const start = Date.now(); let timer;
    try {
      const evidence = await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('CASE_TIMEOUT: possible deadlock')), 60000);
      })]);
      cases.push({ name, passed: true, durationMs: Date.now() - start, evidence });
    } catch (error) {
      cases.push({ name, passed: false, error: String(error) });
      if (String(error).includes('CASE_TIMEOUT')) throw new Error(JSON.stringify({ cases, campaign: 'phase3a', passed: false }));
    } finally { clearTimeout(timer); }
  };
  const dependencies = database => ({ accountRepository: createSqliteAccountRepository(database), transactionRepository: createSqliteTransactionRepository(database), creditCardRepository: createSqliteCreditCardRepository(database) });
  const request = (f, changes) => ({ ...dependencies(f.database), accountId: 'card', sourceAccountId: 'bank', amount: 100000, currentDate: now, ...changes });
  const setup = async (cards = 1) => {
    const f = await fixture();
    await f.database.executeSql("INSERT INTO accounts(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES ('card','Visa','creditCard','active','COP',0,0,'2026-01-01','2026-01-01')");
    const save = changes => saveManualTransaction({ ...dependencies(f.database), accounts: [], accountId: 'card', amount: 250000, merchantName: 'Synthetic', operationType: 'Crédito', transactionType: 'expense', hasInterestFreeInstallments: false, installmentCountInput: '1', interestFreeInstallmentCountInput: '', currentDate: now, ...changes });
    await save();
    if (cards === 2) {
      await f.database.executeSql("INSERT INTO accounts(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES ('card2','Mastercard','creditCard','active','COP',0,0,'2026-01-01','2026-01-01')");
      await save({ accountId: 'card2', amount: 120000, installmentCountInput: '3' });
    }
    return f;
  };
  const inspect = async (f, connection = f.database) => {
    const [fk] = await connection.executeSql('PRAGMA foreign_key_check');
    const [mode] = await connection.executeSql('PRAGMA foreign_keys');
    const [integrity] = await connection.executeSql('PRAGMA integrity_check');
    check(mode.rows.item(0).foreign_keys === 1 && !fk.rows.length && integrity.rows.item(0).integrity_check === 'ok', 'integrity');
    return { tables: await f.snapshot(connection), accounts: await dependencies(connection).accountRepository.getAccounts(), summary: await getDashboardSummaryFromDb(connection, now) };
  };
  const mandatory = state => {
    const tables = JSON.parse(state.tables);
    check(state.accounts.find(a => a.id === 'bank').balance.amount === 900000, 'bank 900000');
    check(state.accounts.find(a => a.id === 'card').debtBalance.amount === 150000, 'debt 150000');
    check(tables.credit_card_statements.find(s => s.account_id === 'card').total_amount === 150000, 'statement 150000');
    check(state.summary.netWorth === 750000 && state.summary.monthlyExpenses === 250000, 'wealth and expense');
    check(tables.transactions.filter(t => t.type === 'creditCardPayment').length === 1, 'one payment');
    check(tables.transactions.find(t => t.type === 'creditCardPayment').target_account_id === 'card', 'payment target');
  };
  const probeFixture = await setup(); const [probe] = await probeFixture.database.executeSql('SELECT sqlite_version() AS version'); await probeFixture.database.close();
  for (const cards of [1, 2]) {
    const discovery = await setup(cards); discovery.trace.length = 0;
    const start = Date.now(); await registerCreditCardPayment(request(discovery)); const operationMs = Date.now() - start;
    const writes = discovery.trace.filter(sql => writePattern.test(sql));
    check(writes.length === (cards === 1 ? 10 : 16), 'all payment writes discovered');
    check(discovery.trace.filter(sql => /^BEGIN/.test(sql)).length === 1 && discovery.trace.filter(sql => /^COMMIT/.test(sql)).length === 1, 'single commit');
    const success = await inspect(discovery); if (cards === 1) mandatory(success);
    await discovery.database.close(); matrix.push({ cards, writes: writes.length, points: writes.length * 2, operationMs, success });
    for (let position = 0; position < writes.length; position++) for (const phase of ['before', 'after']) {
      await test(`${cards} cards: write ${position + 1} ${phase}`, async () => {
        const f = await setup(cards);
        try {
          const before = await inspect(f); f.trace.length = 0;
          const sql = writes[position]; const occurrence = writes.slice(0, position + 1).filter(value => value === sql).length;
          f.inject(sql, phase, occurrence); let failure;
          try { await registerCreditCardPayment(request(f)); } catch (error) { failure = error; }
          check(failure && !(failure instanceof SQLiteCommandFailure), 'ordinary error, confirmed rollback');
          check(f.trace.filter(value => /^ROLLBACK/.test(value)).length === 1 && !f.trace.some(value => /^COMMIT/.test(value)), 'one rollback without commit');
          check(JSON.stringify(before) === JSON.stringify(await inspect(f)), 'complete snapshot restored including audit/revision/references');
          return { sql, phase, occurrence, rollback: 'confirmed' };
        } finally { await f.database.close(); }
      });
    }
  }
  for (const amount of [Infinity, -Infinity, NaN, 0, -1]) await test(`invalid amount ${String(amount)}`, async () => {
    const f = await setup();
    try {
      const before = await inspect(f); f.trace.length = 0; let failure;
      try { await registerCreditCardPayment(request(f, { amount })); } catch (error) { failure = error; }
      check(failure && !f.trace.some(sql => writePattern.test(sql)), 'invalid amount before writes');
      check(JSON.stringify(before) === JSON.stringify(await inspect(f)), 'unchanged');
    } finally { await f.database.close(); }
  });
  for (const kind of ['closed card', 'closed source', 'source type', 'missing source', 'funds', 'no debt']) await test(`incompatible: ${kind}`, async () => {
    const f = await setup(2);
    try {
      if (kind === 'closed card') await f.database.executeSql("UPDATE accounts SET status='closed' WHERE id='card'");
      if (kind === 'closed source') await f.database.executeSql("UPDATE accounts SET status='closed' WHERE id='bank'");
      if (kind === 'source type') await f.database.executeSql("UPDATE accounts SET type='investment' WHERE id='bank'");
      if (kind === 'funds') await f.database.executeSql("UPDATE accounts SET balance_amount=1 WHERE id='bank'");
      if (kind === 'no debt') await f.database.executeSql("UPDATE transactions SET status='cancelled'");
      await f.database.executeSql("UPDATE accounts SET debt_balance_amount=999 WHERE type='creditCard'");
      await f.database.executeSql('UPDATE credit_card_statements SET total_amount=999');
      const before = await inspect(f); let failure;
      try { await registerCreditCardPayment(request(f, { sourceAccountId: kind === 'missing source' ? 'missing' : 'bank' })); } catch (error) { failure = error; }
      check(failure && JSON.stringify(before) === JSON.stringify(await inspect(f)), 'including initial reconciliation rolled back');
    } finally { await f.database.close(); }
  });
  await test('same intention, partial payment, round/cap and same millisecond identities', async () => {
    const f = await setup();
    try {
      const command = request(f, { amount: 100000.6 });
      const [first, second] = await Promise.all([registerCreditCardPayment(command), registerCreditCardPayment(command)]);
      check(first === second && first.paidAmount === 100001, 'one intention and round');
      check(await registerCreditCardPayment(command) === first, 'confirmed repetition');
      const last = await registerCreditCardPayment(request(f, { amount: 900000 }));
      check(last.paidAmount === 149999 && last.transaction.id !== first.transaction.id, 'debt cap and unique identity');
      const state = await inspect(f);
      check(state.accounts.find(a => a.id === 'bank').balance.amount === 750000 && state.summary.totalDebt === 0 && state.summary.monthlyExpenses === 250000, 'correct totals');
    } finally { await f.database.close(); }
  });
  for (const kind of ['debt', 'funds']) await test(`concurrent payments and reader: ${kind}`, async () => {
    const f = await setup();
    try {
      if (kind === 'funds') await f.database.executeSql("UPDATE accounts SET balance_amount=100000 WHERE id='bank'");
      const b = f.pause('INSERT INTO transactions');
      const first = registerCreditCardPayment(request(f, { amount: kind === 'debt' ? 200000 : 100000 })); await b.arrived;
      let observed = false; const readerStart = Date.now();
      const second = registerCreditCardPayment(request(f, { amount: 200000 })).catch(error => error);
      const reader = dependencies(f.database).accountRepository.getAccounts().then(value => { observed = true; return value; });
      await Promise.resolve(); check(!observed, 'reader waits'); b.release(); await first;
      const result = await second; const accounts = await reader;
      check(kind === 'debt' ? result.paidAmount === 50000 && result.previousDebt === 50000 : result instanceof Error, 'current debt/funds');
      const bank = accounts.find(a => a.id === 'bank').balance.amount;
      check(bank === (kind === 'debt' ? 750000 : 0), 'reader sees confirmed state');
      return { readerWaitMs: Date.now() - readerStart, bank };
    } finally { await f.database.close(); }
  });
  for (const control of ['COMMIT', 'ROLLBACK']) for (const phase of ['before', 'after']) await test(`payment unknown ${control} ${phase}, recover without retry`, async () => {
    const f = await setup(); const before = await inspect(f); const command = request(f, control === 'ROLLBACK' ? { sourceAccountId: 'missing' } : {});
    f.inject(control, phase); let failure;
    try { await registerCreditCardPayment(command); } catch (error) { failure = error; }
    check(failure instanceof SQLiteCommandFailure && failure.result.status === 'unknown', 'unknown');
    const count = f.trace.length;
    try { await registerCreditCardPayment(command); } catch (error) { check(error === failure, 'same rejection'); }
    check(f.trace.length === count && sqliteConnectionState(f.database).status === 'closed', 'no retry, quarantined connection');
    const clean = await reopen(f.name);
    try {
      const state = await inspect(f, clean);
      if (control === 'COMMIT' && phase === 'after') mandatory(state);
      else check(JSON.stringify(before) === JSON.stringify(state), 'initial complete snapshot after recovery');
      return { status: 'unknown', control, phase, bank: state.accounts.find(a => a.id === 'bank').balance.amount };
    } finally { await clean.close(); }
  });
  for (const rows of [0, 100000]) await test(`payment/reconciliation operation and queued reader timing: ${rows} additional rows`, async () => {
    const f = await setup();
    try {
      if (rows) await f.database.executeSql(`WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<100000)
        INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at)
        SELECT 'large-'||n,1,'COP','Synthetic','2026-01-10T12:00:00.000Z','bank','expense','outflow','posted','2026-01-10','2026-01-10' FROM sequence`);
      f.trace.length = 0; const start = Date.now();
      const payment = registerCreditCardPayment(request(f));
      const readerStart = Date.now(); const reader = dependencies(f.database).accountRepository.getAccounts();
      await payment; const operationMs = Date.now() - start; const accounts = await reader; const readerMs = Date.now() - readerStart;
      check(accounts.find(a => a.id === 'bank').balance.amount === 900000 && accounts.find(a => a.id === 'card').debtBalance.amount === 150000, 'financial results');
      check(f.trace.filter(sql => /^COMMIT/.test(sql)).length === 1, 'single commit');
      const summary = await getDashboardSummaryFromDb(f.database, now);
      check(summary.netWorth === 750000 && summary.monthlyExpenses === 250000, 'unchanged wealth/expenses');
      return { additionalRows: rows, operationMs, readerMs, completeHistoryReads: f.trace.filter(sql => /FROM transactions\s+ORDER BY/.test(sql)).length };
    } finally { await f.database.close(); }
  });
  return { config, campaign: 'phase3a', driver: probe.rows.item(0).version, matrix, cases, passed: cases.every(value => value.passed) };
}
