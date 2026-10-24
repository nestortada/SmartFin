import { NativeModules } from 'react-native';
import { createSqliteAccountRepository as accounts } from './src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository as transactions } from './src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository as cards } from './src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteCreditCardAlertRepository as alerts } from './src/modules/creditCards/repositories/sqliteCreditCardAlertRepository';
import { manageSQLiteDatabase as manage } from './src/database/managedSQLite';
import { runSharedSQLiteTransaction as shared } from './src/database/atomicSQLite';
import { closeCreditCardWithReconciliation as close } from './src/modules/creditCards/useCases/creditCardManagementCommands';
import { reconcileCreditCardTransactions as reconcile, associatePendingTransactionsForCreditCard as associate } from './src/modules/creditCards/useCases/creditCardTransactionRelations';
import { createSqliteAccountRepository as oldAccounts } from './referenceSrc/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository as oldTransactions } from './referenceSrc/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository as oldCards, setSyntheticLiteralOracle } from './referenceSrc/modules/creditCards/repositories/sqliteCreditCardRepository';
import { manageSQLiteDatabase as oldManage } from './referenceSrc/database/managedSQLite';
import { runSharedSQLiteTransaction as oldShared } from './referenceSrc/database/atomicSQLite';
import { closeCreditCardWithReconciliation as oldClose } from './referenceSrc/modules/creditCards/useCases/creditCardManagementCommands';
import { reconcileCreditCardTransactions as oldReconcile, associatePendingTransactionsForCreditCard as oldAssociate } from './referenceSrc/modules/creditCards/useCases/creditCardTransactionRelations';
import { fixtureSql } from './PostFixture';
import { beginProfile, endProfile, startMemory, stopMemory, jsMemory, errorText } from './PostProfile';
import { fixedClock, restoreClock, wallClockNow } from './SqlProfile';

const performance = global.performance;
const reporter = NativeModules.AtomicityReport;
const variants = [
  { name: 'before', accounts: oldAccounts, transactions: oldTransactions, cards: oldCards, manage: oldManage, shared: oldShared, close: oldClose, reconcile: oldReconcile, associate: oldAssociate },
  { name: 'after', accounts, transactions, cards, manage, shared, close, reconcile, associate },
];
const now = new Date('2026-10-11T12:00:00.000Z');
function dependencies(f, variant) {
  const database = variant.manage(f.raw);
  return { database, accountRepository: variant.accounts(database), creditCardRepository: variant.cards(database), transactionRepository: variant.transactions(database) };
}
export async function postCampaign({ fixture, config, check, campaign }) {
  const cases = []; const samples = []; const probes = [];
  fixedClock();
  const progress = async stage => reporter.progress(JSON.stringify({ campaign, stage, completedCases: cases.length, measuredSamples: samples.length, time: wallClockNow() }));
  const test = async (name, body) => {
    await progress(name); const started = performance.now(); let timer;
    try {
      const evidence = await Promise.race([body(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CASE_TIMEOUT')), 300000); })]);
      cases.push({ name, passed: true, durationMs: performance.now() - started, evidence });
    } catch (error) {
      cases.push({ name, passed: false, error: errorText(error) });
      if (errorText(error).includes('CASE_TIMEOUT')) throw new Error(JSON.stringify({ campaign, passed: false, cases, samples, probes }));
    } finally { clearTimeout(timer); }
  };
  const setup = async spec => {
    const f = await fixture();
    for (const sql of fixtureSql(spec)) await f.database.executeSql(sql);
    return f;
  };
  // Reproduce ManagementCampaign's original close fixture, including its paid
  // statement and cancelled card purchase, without its initial reader timing bug.
  const originalCloseFixture = async () => {
    const f = await fixture(); const d = dependencies(f, variants[1]);
    for (const [id, name, type] of [['card', 'Visa', 'creditCard'], ['account-credit-card-unclassified', 'Unclassified', 'bankAccount']]) {
      await f.database.executeSql("INSERT INTO accounts(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES (?,?,?,'active','COP',0,0,'2026-01-01','2026-01-01')", [id, name, type]);
    }
    const purchases = ['posted', 'pending', 'cancelled'].map((status, index) => ({ id: `pending-${index}`, accountId: 'account-credit-card-unclassified',
      amount: 120000 + index, currency: 'COP', date: `2024-01-0${index + 1}`, description: 'Ghost', direction: 'outflow', type: 'expense',
      paymentMethod: 'credit', creditCardHint: 'Ghost', status, createdAt: now.toISOString(), updatedAt: now.toISOString() }));
    await d.transactionRepository.saveTransactions([...purchases, { ...purchases[0], id: 'card-purchase', accountId: 'card', amount: 90000, date: now.toISOString(), creditCardHint: 'Visa' }]);
    await d.creditCardRepository.saveInstallmentPurchases(purchases.map(tx => ({ id: `installment-${tx.id}`, transactionId: tx.id,
      accountId: tx.accountId, totalAmount: tx.amount, currency: 'COP', installmentCount: 3, paidInstallments: 1, monthlyAmount: Math.round(tx.amount / 3),
      firstDueDate: '2024-02-01', status: 'active', createdAt: tx.createdAt, updatedAt: tx.updatedAt })));
    await variants[1].reconcile({ ...d, currentDate: now });
    await alerts(d.database).saveMissingCreditCardAlert({ creditCardHint: 'Ghost' });
    await f.database.executeSql("UPDATE transactions SET status='cancelled' WHERE account_id='card'");
    await f.database.executeSql("UPDATE accounts SET debt_balance_amount=0 WHERE id='card'");
    await f.database.executeSql("UPDATE credit_card_statements SET total_amount=0,status='paid' WHERE account_id='card'");
    await f.database.executeSql(fixtureSql({ noise: 100000 }).find(sql => sql.includes("'noise-'||n")));
    return f;
  };
  const integrity = async f => {
    const [fk] = await f.database.executeSql('PRAGMA foreign_key_check');
    const [checkResult] = await f.database.executeSql('PRAGMA integrity_check');
    const [mode] = await f.database.executeSql('PRAGMA foreign_keys');
    check(!fk.rows.length && checkResult.rows.item(0).integrity_check === 'ok' && mode.rows.item(0).foreign_keys === 1, 'FK and integrity');
  };
  const compare = async (left, right) => {
    await integrity(left); await integrity(right);
    const result = await reporter.compareSyntheticDatabases(left.name, right.name, [], []);
    check(result.equal, 'exact all-table equivalence including audit/revision'); return result;
  };
  const measure = async (f, variant, operation, spec, warmup, literalOracle = false) => {
    const d = dependencies(f, variant);
    const expected = spec.expected ? (await d.accountRepository.getAccounts()).find(a => a.id === 'card') : undefined;
    const account = operation === 'associate' ? (await d.accountRepository.getAccounts()).find(a => a.id === 'card') : undefined;
    const light = spec.light === true;
    const beforeMemory = jsMemory(); if (!light) await startMemory(); beginProfile(light); const started = performance.now();
    let value; let failure;
    const execute = async () => {
      if (operation === 'close') return variant.close({ repository: d.creditCardRepository, accountId: 'card', expectedAccount: expected });
      if (operation === 'reconcile') return variant.reconcile({ ...d, currentDate: now });
      return variant.associate({ ...d, account });
    };
    if (literalOracle) setSyntheticLiteralOracle(true);
    try {
      const promise = execute().then(result => { value = result; }, error => { failure = error; });
      let readerMs;
      const readerStart = performance.now(); const reader = d.accountRepository.getAccounts().then(() => { readerMs = performance.now() - readerStart; });
      await promise; const operationMs = performance.now() - started;
      await reader;
      const profile = endProfile(); const memory = light ? undefined : await stopMemory();
      const result = { variant: variant.name, operation, spec, warmup, literalOracle,
        mode: light ? 'light-reader-control' : 'detailed', readerTiming: 'completion-captured',
        operationMs, readerMs, transactionMs: profile.finish - profile.begin,
        connectionWaitMs: profile.queue[0], queueWaitsMs: profile.queue,
        stages: profile.stages, sql: profile.sql, memory, jsMemoryBefore: beforeMemory, jsMemoryAfter: jsMemory(),
        queries: profile.queries, value: typeof value === 'number' ? value : undefined,
        error: failure ? errorText(failure) : undefined };
      if (!literalOracle) samples.push(result);
      return result;
    } finally { setSyntheticLiteralOracle(false); endProfile(); if (!light) await stopMemory(); }
  };
  try {
    const initial = await fixture();
    const [sqlite] = await initial.database.executeSql('SELECT sqlite_version() AS version');
    const [compileOptions] = await initial.database.executeSql('PRAGMA compile_options');
    const [journal] = await initial.database.executeSql('PRAGMA journal_mode');
    const environment = { compileOptions: compileOptions.rows.raw(), journalMode: journal.rows.raw() };
    await initial.database.close();
    if (campaign === 'post-reader-control') {
      const specs = [
        { operation: 'reconcile', spec: { originalCloseFixture: true, noise: 100000, light: true }, rounds: 6 },
        { operation: 'close', spec: { originalCloseFixture: true, noise: 100000, light: true }, rounds: 6 },
        { operation: 'associate', spec: { relevant: 1000, light: true }, rounds: 4 },
        { operation: 'associate', spec: { relevant: 10000, light: true }, rounds: 4 },
      ];
      for (const { operation, spec, rounds } of specs) for (let round = 0; round < rounds; round++) await test(`reader control ${operation} ${JSON.stringify(spec)} round ${round}`, async () => {
        const f = spec.originalCloseFixture ? await originalCloseFixture() : await setup(spec);
        try {
          const result = await measure(f, variants[1], operation, spec, round === 0);
          check(!result.error, 'reader control success: ' + result.error);
          check(result.queueWaitsMs.length === 2, 'writer owner and queued external reader');
          check(result.queueWaitsMs[1] >= result.transactionMs * 0.9, 'reader really waits for transaction ownership');
          if (operation === 'associate') {
            check(result.value === spec.relevant, 'every matching purchase associated');
            const [rows] = await f.database.executeSql("SELECT COUNT(*) AS n FROM installment_purchases WHERE account_id='card' AND paid_installments=1 AND first_due_date='2026-11-25'");
            check(rows.rows.item(0).n === spec.relevant, 'all installment progress and due dates preserved');
          } else if (operation === 'close') {
            const [rows] = await f.database.executeSql("SELECT status,debt_balance_amount FROM accounts WHERE id='card'");
            check(rows.rows.item(0).status === 'closed' && rows.rows.item(0).debt_balance_amount === 0, 'original fixture closes without debt');
          }
          await integrity(f);
          return { operationMs: result.operationMs, readerMs: result.readerMs, actualReaderQueueMs: result.queueWaitsMs[1], transactionMs: result.transactionMs };
        } finally { await f.database.close(); }
      });
    }
    if (campaign === 'post-probe') {
      for (const variant of variants) for (const ids of [997, 998, 1000, 10000]) await test(`${variant.name}: binding envelope ${ids} IDs`, async () => {
        const f = await setup({}); const d = dependencies(f, variant);
        try {
          const before = await f.snapshot(); beginProfile();
          const result = await variant.shared(d.database, async participant => variant.cards(participant).updateInstallmentPurchasesAccount(Array.from({ length: ids }, (_, i) => 'purchase-' + i), 'card'));
          const profile = endProfile();
          check(result.status !== 'unknown', 'binding probe must finalize');
          check(before === await f.snapshot(), 'zero matching rows leave all tables unchanged');
          const evidence = { variant: variant.name, ids, accepted: result.status === 'confirmed', status: result.status, error: result.error ? errorText(result.error) : undefined, sql: profile.sql };
          probes.push(evidence); return evidence;
        } finally { endProfile(); await f.database.close(); }
      });
    }
    if (campaign === 'post-close') {
      for (const spec of [{ noise: 1000 }, { noise: 100000 }, { noise: 100000, expected: true }, { noise: 80000, relevant: 10000, shape: 'paid' }]) {
        const rounds = spec.noise === 100000 && !spec.expected ? 6 : 4;
        for (const operation of ['reconcile', 'close']) for (let round = 0; round < rounds; round++) await test(`${operation} ${JSON.stringify(spec)} round ${round}`, async () => {
          const pair = [await setup(spec), await setup(spec)]; const results = [];
          try {
            for (const index of round % 2 ? [1, 0] : [0, 1]) {
              const result = await measure(pair[index], variants[index], operation, spec, round === 0);
              check(!result.error, 'successful close/reconcile: ' + result.error); results[index] = result;
            }
            const equivalence = await compare(pair[0], pair[1]);
            if (round === 1 && operation === 'close') {
              const probe = await setup(spec);
              try {
                for (const q of results[1].queries.filter(query => query.values.every(v => typeof v === 'string'))) {
                  probes.push({ spec, operation, sql: q.sql, query: await reporter.syntheticQueryTiming(probe.name, q.sql, q.values) });
                }
              } finally { await probe.database.close(); }
            }
            return { equivalence, samples: results.map(result => ({ operationMs: result.operationMs, transactionMs: result.transactionMs })) };
          } finally { for (const f of pair) await f.database.close(); }
        });
      }
    }
    if (campaign === 'post-fragments') {
      for (const phase of ['before', 'after']) for (const occurrence of [1, 2, 3]) await test(`fragment ${occurrence} ${phase}: entire association rollback`, async () => {
        const spec = { relevant: 2100 }; const f = await setup(spec); const initialState = await setup(spec);
        try {
          const d = { accountRepository: accounts(f.database), creditCardRepository: cards(f.database), transactionRepository: transactions(f.database) };
          const account = (await d.accountRepository.getAccounts()).find(a => a.id === 'card');
          f.trace.length = 0; f.inject('UPDATE installment_purchases', phase, occurrence); let failure;
          try { await associate({ ...d, account }); } catch (error) { failure = error; }
          check(failure && /Injected/.test(errorText(failure)), 'all fragment fault positions reached');
          check(f.trace.filter(sql => /^ROLLBACK/.test(sql)).length === 1 && !f.trace.some(sql => /^COMMIT/.test(sql)), 'one rollback without commit');
          return await compare(f, initialState);
        } finally { await f.database.close(); await initialState.database.close(); }
      });
      await test('standalone fragments share one driver transaction and match the old single UPDATE', async () => {
        const spec = { relevant: 2100 }; const f = await setup(spec); const reference = await setup(spec);
        try {
          const ids = Array.from({ length: 2100 }, (_, i) => 'purchase-' + (i + 1));
          await cards(f.database).updateInstallmentPurchasesAccount([...ids, ...ids.slice(0, 950)], 'card');
          setSyntheticLiteralOracle(true);
          try { await oldCards(oldManage(reference.raw)).updateInstallmentPurchasesAccount(ids, 'card'); }
          finally { setSyntheticLiteralOracle(false); }
          return await compare(f, reference);
        } finally { await f.database.close(); await reference.database.close(); }
      });
      await test('a real SQLite failure in the second standalone fragment rolls back the first', async () => {
        const spec = { relevant: 2100 }; const f = await setup(spec); const reference = await setup(spec);
        try {
          const trigger = "CREATE TRIGGER synthetic_fragment_failure BEFORE UPDATE OF account_id ON installment_purchases WHEN OLD.transaction_id='purchase-1000' BEGIN SELECT RAISE(ABORT,'synthetic fragment failure'); END";
          await f.database.executeSql(trigger); await reference.database.executeSql(trigger);
          let failure;
          try { await cards(f.database).updateInstallmentPurchasesAccount(Array.from({ length: 2100 }, (_, i) => 'purchase-' + (i + 1)), 'card'); }
          catch (error) { failure = error; }
          check(failure && /synthetic fragment failure/.test(errorText(failure)), 'native callback transaction rejected');
          return await compare(f, reference);
        } finally { await f.database.close(); await reference.database.close(); }
      });
    }
    if (campaign === 'post-associate') {
      for (const relevant of [100, 997, 998, 1000, 10000]) for (let round = 0; round < 4; round++) await test(`associate ${relevant} real matches round ${round}`, async () => {
        const spec = { relevant }; const pair = [await setup(spec), await setup(spec)]; const results = [];
        try {
          for (const index of round % 2 ? [1, 0] : [0, 1]) results[index] = await measure(pair[index], variants[index], 'associate', spec, round === 0);
          // The frozen baseline may fail at its real binding limit; compare that rollback to a fresh identical base.
          if (results[0].error) {
            check(/too many SQL variables|bind|parameter/i.test(results[0].error), 'only the reproduced baseline binding failure is expected: ' + results[0].error);
            const clean = await setup(spec);
            try { await compare(pair[0], clean); } finally { await clean.database.close(); }
            const oracle = await measure(pair[0], variants[0], 'associate', spec, true, true);
            check(!oracle.error && oracle.value === relevant, 'synthetic SQL-equivalent literal oracle');
          }
          check(!results[1].error && results[1].value === relevant, 'candidate associates every matching row: ' + results[1].error);
          const equivalence = await compare(pair[0], pair[1]);
          return { matches: relevant, baselineFailedAtBindingLimit: !!results[0].error, exactFinancialEquivalence: equivalence };
        } finally { for (const f of pair) await f.database.close(); }
      });
    }
    await progress('complete');
    return { campaign, config, environment, sqlite: sqlite.rows.item(0).version, passed: cases.every(c => c.passed), cases, samples, probes,
      protocol: { fixedAuditClock: true, warmup: 1, measuredSamples: '3; 5 for the original 100k noise close/reconcile comparison', alternatingOrder: true,
        profiling: 'test-only copied sources; driver timings include SQLite/bridge; native READONLY SELECT probes are separate samples; native memory sampled at 100ms', financialComparison: 'all tables, types, Double bits, audit and revision; no generated IDs or tolerances' } };
  } finally { endProfile(); await stopMemory(); restoreClock(); }
}
