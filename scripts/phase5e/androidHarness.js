/* global performance */
import { integratedFixture, buildIntegratedScenario, inspectIntegrated, check, DATE } from './scripts/phase5e/integration';
import { openSmartFinDatabase } from './src/database/sqliteDatabase';
import { captureLocalDatabaseSnapshot } from './src/modules/settings/services/localDatabaseSnapshot';
import { createSubscriptionReminderService } from './src/modules/subscriptions/services/androidSubscriptionReminderService';
import { deleteFinancialData } from './src/modules/settings/useCases/deleteFinancialData';
import { createSqliteFinancialDataRepository } from './src/modules/settings/repositories/sqliteFinancialDataRepository';
import { recoverFinancialDeletion, financialDeletionLifecycle } from './src/modules/settings/services/financialDeletionLifecycle';
import { subscriptionHeadlessTask } from './src/modules/subscriptions/services/subscriptionRuntime';
import { getDashboardSummaryFromDb } from './src/modules/dashboard/useCases/getDashboardSummary';

const parse = JSON.parse;
async function reject(operation) { let error; try { await operation(); } catch (e) { error = String(e); } check(error, 'Expected rejection'); return error; }
export async function runIntegrated(campaign, { record, control, backup, owned }) {
  await control.recoveryEnabled(false);
  await record('isolation', () => control.isolation());
  const service = () => createSubscriptionReminderService();
  const access = async () => integratedFixture(await openSmartFinDatabase(), service(), false);
  const snapshot = async () => inspectIntegrated(await openSmartFinDatabase());
  const wipe = async () => {
    const lifecycle = financialDeletionLifecycle();
    for (const key of ['begin', 'recover', 'inventory', 'rollback']) {
      const original = lifecycle[key];
      lifecycle[key] = async (...args) => {
        console.log('DELETE_LIFECYCLE_START:' + key);
        const value = await original(...args);
        console.log('DELETE_LIFECYCLE_END:' + key);
        return value;
      };
    }
    return deleteFinancialData(createSqliteFinancialDataRepository(await openSmartFinDatabase()), lifecycle);
  };
  const documents = async () => parse(await control.documents());
  const preserve = async previous => {
    const current = await documents();
    for (const [name, bytes] of Object.entries(previous)) check(JSON.stringify(bytes) === JSON.stringify(current[name]), 'Historical bytes changed: ' + name);
  };
  const capture = async () => {
    const job = parse(await backup.preparePublication());
    const captured = await captureLocalDatabaseSnapshot(job.id);
    return { job, captured };
  };
  if (campaign === 'phase5e-restart') {
    const saved = parse(await control.readRestart());
    await record('restart-recovers-only-cleanup-and-retains-historical-generation', async () => {
      const before = await snapshot();
      const recovered = await recoverFinancialDeletion();
      check(recovered.status === 'completed', 'Cleanup did not complete');
      const after = await snapshot();
      for (const table of Object.keys(before.tables)) if (table !== 'app_settings') check(JSON.stringify(before.tables[table]) === JSON.stringify(after.tables[table]), 'Recovery wrote finances: ' + table);
      check(!after.tables.accounts.length && !after.tables.transactions.length, 'Recovery recreated finances');
      await preserve(saved.external);
      for (const job of saved.oldJobs) await reject(() => backup.publishSnapshot(job.id, null));
      check((await backup.getBackupStatus(0)).datasetCurrency === 'historical', 'History presented current');
      return { recovered, after };
    });
    await record('real-new-subscription-same-ids-survives-old-cleanup-and-headless', async () => {
      const f = await integratedFixture(await openSmartFinDatabase(), service());
      const created = await f.subscriptions.createSubscription({ name: 'New epoch', amount: 1200, accountId: 'bank', recurrence: { periodicity: 'monthly' }, anchorDate: '2026-10-25', reminders: { enabled: true, offsets: [0], hour: 15, minute: 0 } });
      const [row] = await f.database.executeSql("SELECT setting_value FROM app_settings WHERE setting_key='__smartfin_financial_lifecycle_v1'");
      const epoch = parse(row.rows.item(0).setting_value).epoch;
      const reminders = await f.subscriptionRepository.getReminders();
      check(reminders.length > 0, 'New reminders missing');
      check(await control.alarmExists(reminders[0].id, epoch), 'New epoch alarm missing');
      const before = await snapshot();
      await recoverFinancialDeletion();
      const obsoleteError = await reject(() => subscriptionHeadlessTask({ runId: 'obsolete-5e', datasetEpoch: 'legacy' }));
      check(obsoleteError.includes('época anterior'), 'Unexpected obsolete Headless error');
      check(await control.alarmExists(reminders[0].id, epoch), 'Old cleanup removed new resource');
      check(JSON.stringify(before) === JSON.stringify(await snapshot()), 'Old work changed new finances');
      return { created, epoch, obsoleteError, reminderId: reminders[0].id, oldReminderIds: saved.reminderIds, after: before };
    });
    return;
  }
  await openSmartFinDatabase();
  await control.configureSaf();
  await record('legacy-fixture-is-explicitly-unverified', async () => {
    const status = await backup.getBackupStatus(0);
    check(status.validation === 'legacyUnverified', 'Legacy fixture presented verified');
    return status;
  });
  const f = await integratedFixture(await openSmartFinDatabase(), service());
  await record('combined-real-financial-commands', async () => buildIntegratedScenario(f));
  if (campaign === 'phase5e-performance') {
    for (const count of [1000, 10000, 100000]) {
      // Synthetic historical load. No UI list is used as a reconciliation input.
      await owned(async db => {
        await db.executeSql("DELETE FROM transactions WHERE id LIKE 'load-%'");
        const [r] = await db.executeSql('SELECT count(*) AS n FROM transactions');
        const additional = count - r.rows.item(0).n;
        await db.executeSql(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${additional}) INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at) SELECT 'load-'||n,1,'COP','Synthetic historical load','2026-10-24','bank','expense','outflow','posted','2026-10-24','2026-10-24' FROM seq`);
        await db.executeSql("UPDATE accounts SET balance_amount=balance_amount-? WHERE id='bank'", [additional]);
      });
      await record('integrated-performance-' + count, async () => {
        const times = {};
        const measure = async (name, op) => { const start = performance.now(); const result = await op(); times[name] = performance.now() - start; return result; };
        const fresh = await access();
        await measure('dashboardMs', () => getDashboardSummaryFromDb(fresh.database, DATE));
        const [rows] = await fresh.database.executeSql('SELECT * FROM transactions LIMIT 0');
        check(rows.rows.length === 0, 'Read error');
        // The public history query contract is supplied by the prepared wrapper.
        let historyOutcome;
        const historyStart = performance.now();
        try {
          await measure('historyPageMs', () => fresh.transactionRepository.getTransactionPage({ month: 'all', accountId: 'all', categoryId: 'all', search: '', sort: 'newest' }));
          historyOutcome = { status: 'passed' };
        } catch (error) {
          const message = String(error?.message || error);
          check(message.includes('no query solution'), 'Unexpected history failure: ' + message);
          times.historyFailedAttemptMs = performance.now() - historyStart;
          historyOutcome = { status: 'failed', defect: '5E-001', message };
        }
        await measure('paymentAndReconciliationMs', () => fresh.payment(1));
        await measure('subscriptionMaintenanceMs', () => fresh.subscriptions.syncSubscriptions());
        const job = parse(await backup.preparePublication());
        const start = performance.now();
        const capturing = captureLocalDatabaseSnapshot(job.id);
        const financial = openSmartFinDatabase().then(async db => {
          times.concurrentAdmissionWaitMs = performance.now() - start;
          return (await integratedFixture(db, service(), false)).save({ amount: 1 });
        }).then(() => performance.now() - start);
        const captured = await capturing;
        times.captureMs = performance.now() - start;
        times.concurrentFinancialWaitMs = await financial;
        const publication = await measure('publicationMs', async () => parse(await backup.publishSnapshot(job.id, captured.snapshot.id)));
        const csv = parse(await control.csvEvidence(job.id));
        const after = parse(await control.liveEvidence());
        const deletionStart = performance.now(), deletion = await wipe();
        times.deletionAndCleanupMs = performance.now() - deletionStart;
        check(deletion.status === 'confirmed' && deletion.cleanup === 'completed', 'Performance deletion incomplete');
        const afterDeletion = parse(await control.liveEvidence());
        return { count, times, historyOutcome, captured: { snapshot: captured.snapshot, timings: captured.timings }, publication, csv, after, deletion, afterDeletion };
      });
      if (count !== 100000) {
        const next = await integratedFixture(await openSmartFinDatabase(), service());
        await buildIntegratedScenario(next);
      }
    }
    return;
  }
  await record('api24-expression-index-history-compatibility-probe', async () => parse(await control.historyCompatibility()));
  let good;
  let initial;
  await record('snapshot-and-concurrent-write-publish-previous-financial-history', async () => {
    initial = await snapshot();
    const job = parse(await backup.preparePublication());
    const capturing = captureLocalDatabaseSnapshot(job.id);
    const writer = openSmartFinDatabase().then(async db => (await integratedFixture(db, service(), false)).save({ amount: 500 }));
    const captured = await capturing; await writer;
    good = { job, captured };
    const beforePublication = await snapshot();
    const published = parse(await backup.publishSnapshot(job.id, captured.snapshot.id));
    const csv = parse(await control.csvEvidence(job.id));
    const bank = initial.tables.accounts.find(a => a.id === 'bank').balance_amount;
    check(csv.balance === bank && csv.receipts === 1 && csv.cardCount === 1, 'Snapshot not original combined history');
    check(JSON.stringify(beforePublication) === JSON.stringify(await snapshot()), 'Publication changed live database');
    return { published, captured: { snapshot: captured.snapshot, timings: captured.timings }, csv, before: initial, after: beforePublication };
  });
  const external = await documents();
  await record('publication-failure-resumes-original-capture-without-rewrite', async () => {
    const bound = await capture();
    await control.fault('create:categorias.csv');
    const error = await reject(() => backup.publishSnapshot(bound.job.id, bound.captured.snapshot.id));
    await control.fault('');
    check((await backup.getBackupStatus(0)).generationId === good.job.id, 'Incomplete generation selected');
    const fresh = await access(); await fresh.save({ amount: 700 });
    await control.written();
    const resumed = parse(await backup.publishSnapshot(bound.job.id, null));
    const written = parse(await control.written());
    check(!written.some(n => n.endsWith('--smartfin-backup.db') || n.endsWith('--cuentas.csv')), 'Original components rewritten');
    await preserve(external);
    return { error, resumed, written, csv: parse(await control.csvEvidence(bound.job.id)) };
  });
  await record('partial-manifest-keeps-last-complete-generation', async () => {
    const previous = await backup.getBackupStatus(0), bound = await capture();
    await control.fault('partial:manifest.json');
    const error = await reject(() => backup.publishSnapshot(bound.job.id, bound.captured.snapshot.id));
    await control.fault('');
    check((await backup.getBackupStatus(0)).generationId === previous.generationId, 'Partial manifest selected');
    await backup.retainFailedJob(bound.job.id);
    return { error, selected: previous.generationId };
  });
  const beforeDeleteDocs = await documents();
  const oldJobs = parse(await backup.getPublicationJobs());
  await record('publication-lease-rejects-delete-before-financial-lock', async () => {
    const bound = await capture();
    await control.fault('pause:open:smartfin-backup.db');
    const publishing = backup.publishSnapshot(bound.job.id, bound.captured.snapshot.id);
    await control.waitSaf();
    const before = await snapshot(), start = performance.now();
    const result = await wipe(), rejectionMs = performance.now() - start;
    check(result.status === 'rejected', 'Active SAF did not reject deletion');
    check(JSON.stringify(before) === JSON.stringify(await snapshot()), 'Rejected deletion changed finances');
    await control.resumeSaf(); await publishing;
    return { result, rejectionMs };
  });
  await record('mixed-history-delete-confirmed-cleanup-pending-old-jobs-revoked', async () => {
    const before = await snapshot();
    const reminderIds = before.tables.subscription_reminders.map(r => r.id);
    check(reminderIds.length > 0, 'Reminder inventory empty');
    await control.arm('cleanup.before:reminderIds', true);
    const result = await wipe();
    check(result.status === 'confirmed' && result.cleanup === 'pending', 'Cleanup failure not separate from commit');
    const after = await snapshot();
    check(!after.tables.accounts.length && !after.tables.transactions.length && !after.tables.ai_command_drafts.length, 'Mixed wipe incomplete');
    for (const job of oldJobs) await reject(() => backup.publishSnapshot(job.id, null));
    await preserve(beforeDeleteDocs);
    const saved = { result, oldJobs, external: beforeDeleteDocs, reminderIds };
    await control.saveRestart(JSON.stringify(saved));
    return { result, before, after, nativeEvents: parse(await control.events()) };
  });
}
