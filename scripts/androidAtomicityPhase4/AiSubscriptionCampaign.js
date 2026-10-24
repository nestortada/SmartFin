import { executeAiCommandPlan } from './src/modules/transactions/useCases/executeAiCommandPlan';
import { executeAiCommandPlan as previousExecute } from './baseline/phase4ExecuteAiCommandPlan';
import { createSqliteAiDraftRepository, saveAiDraftForReview } from './src/modules/transactions/repositories/sqliteAiDraftRepository';
import { createSqliteSubscriptionRepository } from './src/modules/subscriptions/repositories/sqliteSubscriptionRepository';
import { createSubscriptionApi } from './src/modules/subscriptions/useCases/createSubscriptionApi';
import { getSubscriptionApi, runSubscriptionMaintenance } from './src/modules/subscriptions/services/subscriptionRuntime';
import { setSyntheticRuntimeDatabase } from './src/database/phase4RuntimeDatabase';
import { getFinancialDataRevision } from './src/database/sqliteDatabase';
import { getDashboardSummaryFromDb } from './src/modules/dashboard/useCases/getDashboardSummary';
import { createSqliteAccountRepository } from './src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from './src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from './src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { saveManualTransaction } from './src/modules/transactions/useCases/saveManualTransaction';
import { SQLiteCommandFailure } from './src/database/atomicSQLite';
import { manageSQLiteDatabase } from './src/database/managedSQLite';
import { fixedClock, restoreClock, wallClockNow } from './SqlProfile';

const now = new Date('2026-10-11T12:00:00.000Z');
const writePattern = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;
const fields = { name: 'Netflix', amount: 44900, accountId: 'bank', anchorDate: '2026-10-15', periodicity: 'monthly', remindersEnabled: false };
const input = { name: 'Netflix', amount: 44900, accountId: 'bank', anchorDate: '2026-10-15', recurrence: { periodicity: 'monthly' }, reminders: { enabled: true } };
const mixed = () => ({ version: 1, answeredFields: [], summary: 'Mixed synthetic plan', actions: [
  { id: 'expense', entity: 'transaction', operation: 'create', fields: { accountId: 'bank', amount: 44900, description: 'Netflix pagado', transactionType: 'expense', date: '2026-10-11' } },
  { id: 'transfer', entity: 'transaction', operation: 'create', fields: { accountId: 'bank', targetAccountId: 'target', amount: 100000, description: 'Ahorro', transactionType: 'internalTransfer', transferTaxCharged: true, date: '2026-10-11' } },
  { id: 'netflix', entity: 'subscription', operation: 'create', fields },
] });
const draft = (plan = mixed(), id = 'intent') => ({ id, plan, phase: 'review', rawInput: plan.summary, messages: [], clarificationHistory: [], createdAt: now.toISOString(), updatedAt: now.toISOString() });
function reminders(fail = false) {
  const calls = [];
  return { calls, getStatus: async () => ({ available: true, permission: 'granted' }), requestPermission: async () => ({ available: true, permission: 'granted' }),
    ensureMaintenance: async () => { calls.push('maintenance'); }, schedule: async value => { calls.push(value.id); if (fail) throw new Error('Synthetic platform failure'); },
    cancel: async id => { calls.push('cancel:' + id); }, cancelAll: async () => {} };
}
export async function aiSubscriptionCampaign({ fixture, reopen, config, check }) {
  const cases = []; const matrix = []; const timings = [];
  fixedClock();
  const test = async (name, operation) => {
    if (cases.length % 10 === 0) console.info('PHASE4_PROGRESS', cases.length, name);
    let timer; const start = wallClockNow();
    try {
      const evidence = await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CASE_TIMEOUT')), 120000); })]);
      cases.push({ name, passed: true, durationMs: wallClockNow() - start, evidence });
    } catch (error) {
      cases.push({ name, passed: false, error: String(error) });
      if (String(error).includes('CASE_TIMEOUT')) throw new Error(JSON.stringify({ campaign: 'phase4', passed: false, cases }));
    } finally { clearTimeout(timer); }
  };
  const setup = async () => {
    const f = await fixture();
    await f.database.executeSql("INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('target','Destino','bankAccount','active','COP',0,'2026-01-01','2026-01-01')");
    const service = reminders(); const drafts = createSqliteAiDraftRepository(f.database);
    const api = createSubscriptionApi({ repository: createSqliteSubscriptionRepository(f.database), reminderService: service, createId: () => 'contract' });
    setSyntheticRuntimeDatabase(f.database);
    return { ...f, service, drafts, api };
  };
  const inspect = async (f, database = f.database) => {
    const [fk] = await database.executeSql('PRAGMA foreign_key_check'); const [integrity] = await database.executeSql('PRAGMA integrity_check');
    check(!fk.rows.length && integrity.rows.item(0).integrity_check === 'ok', 'FK/integrity');
    return { tables: JSON.parse(await f.snapshot(database)), metrics: await getDashboardSummaryFromDb(database, now) };
  };
  const normalize = state => {
    const copy = JSON.parse(JSON.stringify(state)); copy.tables.ai_command_drafts = [];
    let json = JSON.stringify(copy);
    for (const tx of copy.tables.transactions.filter(t => t.dedupe_key)) json = json.split(tx.id).join(tx.dedupe_key);
    const normalized = JSON.parse(json);
    for (const rows of Object.values(normalized.tables)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return JSON.stringify(normalized);
  };
  try {
    console.info('PHASE4_DISCOVERY starting');
    const discovery = await setup(); await discovery.drafts.saveActiveDraft(draft()); discovery.trace.length = 0;
    const planStarted = global.performance.now(); await executeAiCommandPlan(discovery.database, 'intent', mixed(), discovery.service);
    const writes = discovery.trace.filter(sql => writePattern.test(sql));
    console.info('PHASE4_DISCOVERY writes', writes.length);
    const success = await inspect(discovery);
    timings.push({ flow: 'mixed plan', operationMs: global.performance.now() - planStarted, writes: writes.length });
    await test('A success, financial deltas and historical exact equivalence', async () => {
      check(success.metrics.availableBalance === 954700 && success.metrics.netWorth === 954700 && success.metrics.monthlyExpenses === 45300, 'exact metrics');
      check(success.tables.accounts.find(a => a.id === 'bank').balance_amount === 854700 && success.tables.accounts.find(a => a.id === 'target').balance_amount === 100000, 'each balance');
      check(success.tables.transactions.length === 4 && success.tables.subscription_occurrences.every(o => o.status === 'pending'), 'no automatic linked expense');
      const old = await setup();
      try { await previousExecute(old.database, 'intent', mixed(), old.service); check(normalize(success) === normalize(await inspect(old)), 'all-table historical equivalence'); }
      finally { await old.database.close(); }
    });
    await discovery.database.close();
    await test('historical contract preserves former final bounded batch before plan COMMIT', async () => {
      const current = await setup(); const previous = await setup();
      const plan = { version: 1, summary: 'Histórica', answeredFields: [], actions: [{ id: 'old', entity: 'subscription', operation: 'create', fields: { ...fields, anchorDate: '1500-01-15', periodicity: 'yearly' } }] };
      try {
        await executeAiCommandPlan(current.database, 'historical', plan, current.service);
        await previousExecute(previous.database, 'historical', plan, previous.service);
        const state = await inspect(current);
        check(state.tables.subscription_occurrences.length > 500 && normalize(state) === normalize(await inspect(previous)), 'exact historical final batch equivalence');
      } finally { await current.database.close(); await previous.database.close(); }
    });
    const occurrences = new Map();
    for (const sql of writes) {
      const occurrence = (occurrences.get(sql) || 0) + 1; occurrences.set(sql, occurrence);
      for (const phase of ['before', 'after']) await test(`B plan write ${matrix.length + 1} ${phase}`, async () => {
        const f = await setup();
        try {
          await f.drafts.saveActiveDraft(draft()); const before = await inspect(f); f.trace.length = 0;
          f.inject(sql, phase, occurrence); let error;
          try { await executeAiCommandPlan(f.database, 'intent', mixed(), f.service); } catch (value) { error = value; }
          check(error && f.trace.includes('ROLLBACK;'), 'confirmed rollback');
          check(JSON.stringify(before) === JSON.stringify(await inspect(f)), 'all tables, audit, revision, references and metrics restored');
          check(!f.service.calls.length, 'no OS effects');
          matrix.push({ flow: 'plan', sql, occurrence, phase });
        } finally { await f.database.close(); }
      });
    }
    await test('C repeated and simultaneous intent; immutable ID survives restart and draft clear', async () => {
      const f = await setup();
      await Promise.all([executeAiCommandPlan(f.database, 'same', mixed(), f.service), executeAiCommandPlan(f.database, 'same', mixed(), f.service)]);
      const before = await inspect(f); await f.drafts.clearActiveDraft(); await f.database.close();
      const clean = await reopen(f.name);
      try {
        await executeAiCommandPlan(clean, 'same', mixed(), f.service);
        check(JSON.stringify(before) === JSON.stringify(await inspect(f, clean)), 'receipt replay unchanged');
        const changed = mixed(); changed.actions[0].fields.amount = 1; let conflict;
        try { await executeAiCommandPlan(clean, 'same', changed, f.service); } catch (error) { conflict = error; }
        check(conflict && String(conflict).includes('otro contenido'), 'same ID different content rejected');
      } finally { await clean.close(); }
    });
    for (const phase of ['before', 'after']) await test(`D commit ${phase} unknown; reopen receipt evidence`, async () => {
      const f = await setup(); await f.drafts.saveActiveDraft(draft()); const before = await inspect(f); f.trace.length = 0;
      f.inject('COMMIT', phase); let error;
      try { await executeAiCommandPlan(f.database, 'intent', mixed(), f.service); } catch (value) { error = value; }
      check(error instanceof SQLiteCommandFailure && error.result.status === 'unknown', 'unknown never rollback');
      const count = f.trace.length;
      try { await executeAiCommandPlan(f.database, 'intent', mixed(), f.service); } catch {}
      check(count === f.trace.length, 'no retry on closed generation');
      const clean = await reopen(f.name);
      try {
        const after = await inspect(f, clean);
        if (phase === 'before') check(JSON.stringify(before) === JSON.stringify(after), 'initial snapshot after abandoned commit');
        else {
          check(after.tables.ai_command_drafts[0].phase === 'confirmed', 'durable receipt');
          await executeAiCommandPlan(clean, 'intent', mixed(), f.service);
          check(JSON.stringify(after) === JSON.stringify(await inspect(f, clean)), 'verified replay no second impact');
        }
        return { status: 'unknown', receiptPresent: phase === 'after' };
      } finally { await clean.close(); }
    });
    await test('stale catalog and invalid references reject without financial writes', async () => {
      const f = await setup();
      try {
        const revision = await getFinancialDataRevision(f.database);
        await f.database.executeSql("UPDATE accounts SET name='Changed' WHERE id='bank'");
        await saveAiDraftForReview(f.database, draft(), revision); const before = await inspect(f);
        let conflict; try { await executeAiCommandPlan(f.database, 'intent', mixed(), f.service); } catch (value) { conflict = value; }
        check(String(conflict).includes('datos cambiaron') && JSON.stringify(before) === JSON.stringify(await inspect(f)), 'catalog conflict');
        const plan = mixed(); plan.actions[1].fields.targetAccountRef = 'future';
        let error; try { await executeAiCommandPlan(f.database, 'ref', plan, f.service); } catch (value) { error = value; }
        check(error && JSON.stringify(before) === JSON.stringify(await inspect(f)), 'revoked refs and first action rolled back');
      } finally { await f.database.close(); }
    });
    for (const operation of ['update', 'delete']) await test(`E linked historical expense ${operation}`, async () => {
      const f = await setup();
      try {
        const contract = (await f.api.createSubscription({ ...input, anchorDate: '2026-09-15' })).value;
        const charge = (await f.api.getSubscriptionHistory(contract.id)).find(o => o.expectedDate === '2026-09-15');
        const d = { accountRepository: createSqliteAccountRepository(f.database), transactionRepository: createSqliteTransactionRepository(f.database), creditCardRepository: createSqliteCreditCardRepository(f.database) };
        const expense = await saveManualTransaction({ ...d, accounts: await d.accountRepository.getAccounts(), accountId: 'bank', amount: 44900, merchantName: 'Netflix', operationType: 'Débito', transactionType: 'expense', hasInterestFreeInstallments: false, installmentCountInput: '1', interestFreeInstallmentCountInput: '', occurrence: { kind: 'date', date: '2026-09-15' }, currentDate: now });
        await f.api.confirmSubscriptionPayment({ occurrenceId: charge.id, transactionId: expense.transaction.id });
        const plan = { version: 1, summary: operation, answeredFields: [], actions: [{ id: 'edit', entity: 'transaction', operation, targetId: expense.transaction.id, fields: operation === 'update' ? { amount: 45900 } : {} }] };
        const before = await inspect(f); f.inject('UPDATE subscription_occurrences', 'after'); let error;
        try { await executeAiCommandPlan(f.database, 'edit', plan, f.service); } catch (value) { error = value; }
        check(error && JSON.stringify(before) === JSON.stringify(await inspect(f)), 'whole linked operation rollback');
        await executeAiCommandPlan(f.database, 'edit', plan, f.service);
        const after = await inspect(f); const linked = after.tables.subscription_occurrences.find(o => o.id === charge.id);
        check(linked.expected_amount === 44900 && (operation === 'update' ? linked.actual_amount === 45900 && linked.status === 'paid' : linked.actual_amount === null && linked.transaction_id === null && linked.status === 'overdue'), 'expected/actual and status');
        check(after.tables.accounts.find(a => a.id === 'bank').balance_amount === (operation === 'update' ? 954100 : 1000000), 'balance');
      } finally { await f.database.close(); }
    });
    for (const flow of ['create', 'update', 'pause', 'resume', 'cancel', 'amount', 'confirm', 'skip', 'category', 'subcategory']) {
      const prepare = async () => {
        const f = await setup(); let id, occurrenceId, transactionId;
        if (!['create', 'category', 'subcategory'].includes(flow)) {
          id = (await f.api.createSubscription(input)).value.id;
          occurrenceId = (await f.api.getSubscriptionHistory(id)).find(o => o.expectedDate === input.anchorDate).id;
          if (flow === 'resume') await f.api.pauseSubscription(id);
          if (flow === 'confirm') {
            const result = await executeAiCommandPlan(f.database, 'expense', { ...mixed(), actions: [mixed().actions[0]] }, f.service);
            check(result.completed.length, 'expense exists');
            transactionId = (await createSqliteTransactionRepository(f.database).getTransactions())[0].id;
          }
        } else if (flow !== 'create') {
          await f.api.createSubscription(input);
          await f.database.executeSql("DELETE FROM cash_flow_events WHERE source_entity_type='subscription_occurrence'");
          await f.database.executeSql("INSERT INTO categories VALUES ('expense','Servicios','expense','other','#000')");
        }
        const runtime = ['category', 'subcategory'].includes(flow) ? await getSubscriptionApi() : f.api;
        const execute = () => ({ create: () => runtime.createSubscription(input), update: () => runtime.updateSubscription(id, { amount: 46000 }), pause: () => runtime.pauseSubscription(id), resume: () => runtime.resumeSubscription(id), cancel: () => runtime.cancelSubscription(id), amount: () => runtime.updateSubscriptionOccurrenceAmount(occurrenceId, 47000), confirm: () => runtime.confirmSubscriptionPayment({ occurrenceId, transactionId }), skip: () => runtime.skipSubscriptionOccurrence(occurrenceId), category: () => runtime.createSubscriptionCategory('Streaming'), subcategory: () => runtime.createSubscriptionSubcategory('expense', 'Video') })[flow]();
        return { ...f, execute };
      };
      const probe = await prepare(); probe.trace.length = 0; probe.service.calls.length = 0;
      await probe.execute();
      // Local callback transactions are also instrumented in the test-only adapter.
      const localWrites = probe.trace.filter(sql => writePattern.test(sql) && !sql.startsWith('UPDATE subscription_reminders SET applied_revision'));
      await probe.database.close(); const seen = new Map();
      for (const sql of localWrites) {
        const occurrence = (seen.get(sql) || 0) + 1; seen.set(sql, occurrence);
        for (const phase of ['before', 'after']) await test(`${flow} write ${matrix.length + 1} ${phase}`, async () => {
          const f = await prepare();
          try {
            const before = await inspect(f); f.service.calls.length = 0; f.inject(sql, phase, occurrence); let error;
            try { await f.execute(); } catch (value) { error = value; }
            check(error && JSON.stringify(before) === JSON.stringify(await inspect(f)), 'local/composed full rollback');
            check(!f.service.calls.length, 'no platform effects before commit');
            matrix.push({ flow, sql, occurrence, phase });
          } finally { await f.database.close(); }
        });
      }
    }
    await test('F concurrent maintenance and reader between bounded batches', async () => {
      const f = await setup();
      try {
        await f.api.createSubscription({ ...input, recurrence: { periodicity: 'custom', interval: 1, unit: 'days' }, anchorDate: '2022-01-01', reminders: { enabled: false } });
        const api = await getSubscriptionApi(); f.trace.length = 0;
        const started = global.performance.now();
        const first = runSubscriptionMaintenance(); const second = runSubscriptionMaintenance(); const screen = api.syncSubscriptions();
        let readerMs;
        const reader = createSqliteAccountRepository(f.database).getAccounts().then(value => { readerMs = global.performance.now() - started; return value; });
        check(await first && await second, 'both complete'); await screen; await reader;
        const after = await inspect(f); const unique = new Set(after.tables.subscription_occurrences.map(o => o.subscription_id + ':' + o.expected_date));
        check(unique.size === after.tables.subscription_occurrences.length && after.tables.accounts.find(a => a.id === 'bank').balance_amount === 1000000, 'no duplicate obligations or money impact');
        timings.push({ flow: 'maintenance backlog since 2022', operationMs: global.performance.now() - started, readerMs, occurrences: unique.size });
      } finally { await f.database.close(); }
    });
    await test('G platform error after COMMIT, persisted retry never repeats financial impact', async () => {
      const f = await setup();
      try {
        const plan = mixed(); plan.actions[2].fields = { ...fields, remindersEnabled: true, reminderOffsets: '3,1,0', reminderHour: 9, reminderMinute: 0 };
        const result = await executeAiCommandPlan(f.database, 'notify', plan, reminders(true));
        check(result.completed.join(' ').includes('recordatorios pendientes'), 'confirmed with reminder warning');
        const before = await inspect(f); check(before.tables.subscription_reminders.some(r => r.delivery_status === 'failed'), 'failed sync persisted');
        await executeAiCommandPlan(f.database, 'notify', plan, f.service);
        check(JSON.stringify(before) === JSON.stringify(await inspect(f)), 'receipt replay never repeats finance/OS');
        await f.api.syncSubscriptionReminders(); const after = await inspect(f);
        check(after.tables.transactions.length === 4 && after.tables.accounts.find(a => a.id === 'bank').balance_amount === 854700 && !after.tables.subscription_reminders.some(r => r.delivery_status === 'failed'), 'explicit platform recovery');
      } finally { await f.database.close(); }
    });
    await test('F writer between final batch and platform sync invalidates equivalence', async () => {
      const f = await setup(); let controlled;
      try {
        const contract = (await f.api.createSubscription({ ...input, status: 'paused' })).value;
        check((await inspect(f)).tables.subscription_occurrences.length === 0, 'paused fixture');
        let reached, release;
        const arrived = new Promise(resolve => { reached = resolve; }); const gate = new Promise(resolve => { release = resolve; });
        let transactions = 0;
        controlled = manageSQLiteDatabase(new Proxy(f.raw, { get(target, key) {
          if (key === 'transaction') return async callback => {
            const result = await target.transaction(callback); transactions += 1;
            if (transactions === 1) { reached(); await gate; } return result;
          };
          if (key === 'then') return undefined;
          const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
        } }));
        setSyntheticRuntimeDatabase(controlled);
        const first = runSubscriptionMaintenance(); await arrived;
        const writer = controlled.executeSql("UPDATE recurring_subscriptions SET status='active' WHERE id=?", [contract.id]);
        const duplicate = runSubscriptionMaintenance(); release();
        await writer; check(await first && await duplicate, 'both requests complete after fresh batch');
        check(transactions === 2 && (await inspect(f, controlled)).tables.subscription_occurrences.length > 0, 'new obligations not omitted');
      } finally { await (controlled || f.database).close(); }
    });
    return { campaign: 'phase4', passed: cases.every(c => c.passed), config, cases, matrix, timings, nativeReminders: 'mocked service; production Kotlin not loaded', runtime: 'test-only synthetic opener injection' };
  } finally { restoreClock(); }
}

/** Two separate app launches. No in-memory registry is shared across the process stop. */
export async function receiptRestartCampaign({ fixture, reopen, config, check, campaign, launch }) {
  fixedClock();
  let database;
  try {
    let name;
    if (campaign.endsWith('create')) {
      const f = await fixture(); database = f.database; name = f.name;
      await database.executeSql("INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('target','Destino','bankAccount','active','COP',0,'2026-01-01','2026-01-01')");
      await executeAiCommandPlan(database, 'restart-intent', mixed(), reminders());
    } else {
      name = decodeURIComponent(/[?&]database=([^&]+)/.exec(launch)?.[1] || '');
      check(/^atomicity_phase1_\d+_\d+\.db$/.test(name), 'explicit synthetic database name');
      const sentinel = await fixture(); await sentinel.database.close();
      database = await reopen(name);
      await executeAiCommandPlan(database, 'restart-intent', mixed(), reminders());
    }
    const [accounts] = await database.executeSql("SELECT balance_amount FROM accounts WHERE id='bank'");
    const [transactions] = await database.executeSql('SELECT * FROM transactions');
    const [receipt] = await database.executeSql("SELECT phase FROM ai_command_drafts WHERE id='restart-intent'");
    check(accounts.rows.item(0).balance_amount === 854700 && transactions.rows.length === 4 && receipt.rows.item(0).phase === 'confirmed', 'durable whole intention and no second impact');
    return { campaign, passed: true, config, databaseName: name, cases: [{ name: 'receipt across process restart', passed: true }] };
  } finally { if (database) await database.close(); restoreClock(); }
}
