import React, { useEffect, useState } from 'react';
import { Linking, NativeModules, Text, View } from 'react-native';
import { openSmartFinDatabase, closeSmartFinDatabase } from './src/database/sqliteDatabase';
import { borrowSQLiteDatabase } from './src/database/managedSQLite';
import { withDatabaseMaintenance } from './src/database/databaseCoordination';
import { runSharedSQLiteTransaction } from './src/database/atomicSQLite';
import { captureLocalDatabaseSnapshot, discardLocalDatabaseSnapshot } from './src/modules/settings/services/localDatabaseSnapshot';
import { createSubscriptionReminderService } from './src/modules/subscriptions/services/androidSubscriptionReminderService';
import { confirmAiCommandReceipt } from './src/modules/transactions/repositories/aiCommandReceipt';

const control = NativeModules.Phase5B1Control;
const config = control.getConstants();
if (config.packageId !== 'com.smartfin.snapshot5b1.tests' || __DEV__ || !global.HermesInternal || !config.database.endsWith('/phase5b1_synthetic.db')) throw Error('Synthetic release guard failed');
const check = (value, message) => { if (!value) throw Error(message); };
const cases = [], samples = [];
const inspect = async snapshot => JSON.parse(await control.inspect(snapshot.id));
const events = async () => JSON.parse(await control.events());
async function record(name, operation) {
  try { const evidence = await operation(); cases.push({ name, passed: true, evidence }); }
  catch (error) { cases.push({ name, passed: false, error: String(error), captureError: String(error.captureError), recoveryError: String(error.recoveryError), checkpointRows: global.__checkpointRows, native: error.captureError, stack: error.stack }); throw error; }
}
async function owned(operation) {
  return withDatabaseMaintenance(async permit => operation(borrowSQLiteDatabase(await openSmartFinDatabase(permit), permit), permit));
}
async function seed() {
  await owned(async db => {
    await db.executeSql(`INSERT OR IGNORE INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('bank','Synthetic','bankAccount','active','COP',1000000,'2026-10-18','2026-10-18')`);
    await db.executeSql(`INSERT OR IGNORE INTO recurring_subscriptions(id,name,amount,currency,account_id,periodicity,status,created_at,updated_at) VALUES ('s','Synthetic',44900,'COP','bank','monthly','active','2026-10-18','2026-10-18')`);
    await db.executeSql("UPDATE recurring_subscriptions SET anchor_date='2099-10-19' WHERE id='s'");
    await db.executeSql(`INSERT OR IGNORE INTO subscription_occurrences(id,subscription_id,expected_date,expected_amount,currency,account_id,status,created_at,updated_at) VALUES ('o','s','2099-10-19',44900,'COP','bank','pending','2026-10-18','2026-10-18')`);
    await db.executeSql(`INSERT OR IGNORE INTO subscription_reminders(id,occurrence_id,offset_days,revision,fire_at,title,message,desired,delivery_status,updated_at) VALUES ('subscription-reminder:r','o',1,1,'2099-10-18T15:00:00.000Z','Synthetic','Synthetic','scheduled','pending','2026-10-18')`);
    // Handcrafted synthetic referential fixture, never a production command path.
    await db.executeSql("INSERT OR IGNORE INTO accounts(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES ('card','Synthetic card','creditCard','active','COP',0,3000,'2026-10-18','2026-10-18')");
    await db.executeSql("INSERT OR IGNORE INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,payment_method,created_at,updated_at) VALUES ('installment-base',3000,'COP','Synthetic credit purchase','2026-10-18','card','expense','outflow','posted','credit','2026-10-18','2026-10-18')");
    await db.executeSql("INSERT OR IGNORE INTO credit_card_profiles(account_id,monthly_interest_rate,created_at,updated_at) VALUES ('card',1.9,'2026-10-18','2026-10-18')");
    await db.executeSql("INSERT OR IGNORE INTO credit_card_statements(id,account_id,statement_start_date,statement_end_date,payment_due_date,total_amount,currency,status,created_at,updated_at) VALUES ('statement','card','2026-10-01','2026-10-31','2026-11-15',1000,'COP','open','2026-10-18','2026-10-18')");
    await db.executeSql("INSERT OR IGNORE INTO installment_purchases(id,transaction_id,account_id,total_amount,currency,installment_count,paid_installments,monthly_amount,status,created_at,updated_at) VALUES ('installment','installment-base','card',3000,'COP',3,1,1000,'active','2026-10-18','2026-10-18')");
    await db.executeSql("INSERT OR IGNORE INTO shared_contacts VALUES ('contact','Synthetic contact','2026-10-18','2026-10-18')");
    await db.executeSql("INSERT OR IGNORE INTO shared_expenses(id,transaction_id,total_minor,date,description,status,created_at,updated_at) VALUES ('shared','installment-base',300000,'2026-10-18','Synthetic shared purchase','active','2026-10-18','2026-10-18')");
    await db.executeSql("INSERT OR IGNORE INTO transaction_splits(id,transaction_id,split_type,shared_expense_id,contact_id,amount_minor,amount,currency,created_at,updated_at) VALUES ('participation','installment-base','person','shared','contact',150000,1500,'COP','2026-10-18','2026-10-18')");
    await db.executeSql("INSERT OR IGNORE INTO shared_loss_events(id,kind,expense_id,participation_key,contact_id,amount_minor,date,created_at) VALUES ('loss','forgiveness','shared','participation','contact',10000,'2026-10-18','2026-10-18')");
    await db.executeSql("INSERT OR IGNORE INTO shared_commands VALUES ('shared-receipt','{}','{}','2026-10-18')");
    await db.executeSql("INSERT OR IGNORE INTO account_balance_history(id,account_id,balance_amount,currency,recorded_at,created_at) VALUES ('audit','bank',1000000,'COP','2026-10-18','2026-10-18')");
    await db.executeSql("INSERT OR IGNORE INTO app_settings VALUES ('snapshot-fixture','synthetic','2026-10-18')");
  });
}
async function run(campaign) {
  if (campaign === 'restart-verify') {
    const saved = JSON.parse(await control.readRestart());
    await record('process-restart-retains-private-file-without-republishing', async () => {
      const before = await inspect(saved.snapshot);
      check(before.receipts === 1, 'Receipt missing after restart');
      const db = await openSmartFinDatabase();
      const [rows] = await db.executeSql("SELECT count(*) AS total FROM ai_command_drafts WHERE phase='confirmed'");
      check(rows.rows.item(0).total === 1, 'Live receipt changed');
      await discardLocalDatabaseSnapshot(saved.snapshot.id);
      return { before, previousProcessUid: saved.uid, currentUid: config.uid };
    });
    await closeSmartFinDatabase(); return;
  }
  await seed();
  if (campaign === 'host-real') {
    await control.arm('snapshot.duringCopy', false);
    void captureLocalDatabaseSnapshot().catch(() => {});
    await control.waitReached();
    // Native verifier owns reporting after actual ReactHost destruction.
    await control.destroyReactHost();
    return;
  }
  if (campaign === 'close-lost' || campaign === 'open-lost') {
    await record(campaign + '-preserves-quarantine', async () => {
      if (campaign === 'close-lost') global.__snapshotCloseLost = true;
      else await control.arm('snapshot.afterCopy', false);
      const capture = captureLocalDatabaseSnapshot().catch(error => error);
      if (campaign === 'open-lost') {
        await control.waitReached(); global.__snapshotOpenLost = true; await control.resume();
      }
      const failure = await capture;
      check(failure instanceof Error && failure.recoveryError, 'Uncertain lifecycle did not quarantine recovery');
      if (campaign === 'open-lost') check(global.__snapshotOpenSucceeded, 'Native opening did not actually succeed before response loss');
      let rejected = false; try { await openSmartFinDatabase(); } catch { rejected = true; }
      check(rejected, 'Lost lifecycle receipt allowed another owner');
      return { error: String(failure), recovery: String(failure.recoveryError), events: await events() };
    });
    return;
  }
  if (campaign === 'host-destroyed') {
    await record('host-destruction-keeps-quarantine-during-copy', async () => {
      await control.arm('snapshot.duringCopy', false);
      const capture = captureLocalDatabaseSnapshot().catch(error => error);
      await control.waitReached();
      await control.invalidateHost();
      await control.resume();
      const result = await capture;
      check(result instanceof Error, 'Invalidated host returned snapshot');
      let rejected = false;
      try { await openSmartFinDatabase(); } catch { rejected = true; }
      check(rejected, 'Host destruction allowed a new owner');
      return { error: String(result), events: await events(), recovery: 'process restart required' };
    });
    return;
  }
  await record('js-connection-settings', async () => owned(async db => {
    const result = {};
    for (const [name, sql] of [['sqlite', 'SELECT sqlite_version() AS version'], ['journal', 'PRAGMA journal_mode'], ['foreignKeys', 'PRAGMA foreign_keys'], ['files', 'PRAGMA database_list']]) {
      const [rows] = await db.executeSql(sql); result[name] = rows.rows.raw();
    }
    return result;
  }));
  await record('native-reminder-schedule-cancel-and-maintenance-with-borrowed-owner', async () => owned(async (_db, permit) => {
    const reminders = createSubscriptionReminderService(permit);
    await reminders.schedule({ id: 'subscription-reminder:r', revision: 1, fireAt: '2099-10-18T15:00:00.000Z' });
    await reminders.cancel('nonexistent-synthetic');
    await reminders.ensureMaintenance();
    return events();
  }));
  await record('js-active-transaction-excludes-independent-kotlin-access', async () => {
    let reached, release;
    const arrived = new Promise(resolve => { reached = resolve; });
    const finish = new Promise(resolve => { release = resolve; });
    const db = await openSmartFinDatabase();
    const transaction = runSharedSQLiteTransaction(db, async scope => {
      await scope.executeSql("UPDATE accounts SET balance_amount=900000 WHERE id='bank'");
      reached(); await finish;
    });
    await arrived;
    const independent = control.holdIndependent(0);
    await control.acquisitionTimeout(); // Active JS owner remains protected.
    const during = await events();
    check(!during.some(e => e.event === 'participant.independent'), 'Kotlin entered active JS transaction');
    release();
    check((await transaction).status === 'confirmed', 'JS commit failed');
    await independent;
    return { during, after: await events() };
  });
  await record('actual-WorkManager-and-Headless-complete-without-native-lock-inversion', async () => {
    const state = await control.runWorker(); check(state === 'SUCCEEDED', 'Worker failed');
    return { state, events: await events() };
  });
  await record('receiver-active-drains-before-capture', async () => {
    await control.arm('receiver.active', false);
    await control.receiver(); await control.waitReached();
    let completed = false;
    const capture = captureLocalDatabaseSnapshot().then(value => { completed = true; return value; });
    await control.acquisitionTimeout();
    check(!completed, 'Snapshot entered active receiver');
    await control.resume();
    const value = await capture;
    const state = await inspect(value.snapshot);
    await discardLocalDatabaseSnapshot(value.snapshot.id);
    return { state, events: await events() };
  });
  await record('snapshot-before-and-after-confirmed-ai-receipt', async () => {
    const previous = await captureLocalDatabaseSnapshot();
    const old = await inspect(previous.snapshot); check(old.receipts === 0, 'Old copy already contains receipt');
    await owned(async (db, permit) => {
      const result = await runSharedSQLiteTransaction(db, async scope => {
        await scope.executeSql("UPDATE accounts SET balance_amount=850000 WHERE id='bank'");
        await confirmAiCommandReceipt(scope, 'confirmed-synthetic', { summary: 'Synthetic receipt', actions: [] }, ['confirmed']);
      }, permit);
      check(result.status === 'confirmed', 'Receipt commit failed');
    });
    const current = await captureLocalDatabaseSnapshot();
    const now = await inspect(current.snapshot);
    const oldAgain = await inspect(previous.snapshot);
    check(now.receipts === 1 && now.balance === 850000 && oldAgain.receipts === 0 && oldAgain.balance === old.balance, 'Copies are not independent committed states');
    await discardLocalDatabaseSnapshot(previous.snapshot.id);
    await discardLocalDatabaseSnapshot(current.snapshot.id);
    return { old, now, oldAgain };
  });
  for (const stage of ['snapshot.beforeSource', 'snapshot.beforeCopy', 'snapshot.duringCopy', 'snapshot.afterCopy']) {
    await record('failure-' + stage + '-recovers-connection', async () => {
      await control.arm(stage, true);
      let failure;
      try { await captureLocalDatabaseSnapshot(); } catch (e) { failure = e; }
      check(failure?.database, 'Failed capture did not return recovered database');
      const [rows] = await failure.database.executeSql("SELECT balance_amount FROM accounts WHERE id='bank'");
      check(rows.rows.item(0).balance_amount === 850000, 'Failure changed balance');
      return { error: String(failure), events: await events() };
    });
  }
  await record('acquisition-timeout-does-not-release-active-native-task', async () => {
    await control.arm('independent.active', false);
    const independent = control.holdIndependent(0);
    await control.waitReached(); await control.acquisitionTimeout();
    let done = false;
    const capture = captureLocalDatabaseSnapshot().then(value => { done = true; return value; });
    await control.acquisitionTimeout(); check(!done, 'Timeout released active native resource');
    await control.resume(); await independent;
    const value = await capture;
    await discardLocalDatabaseSnapshot(value.snapshot.id);
    return events();
  });
  await record('native-access-and-js-readers-wait-through-entire-copy', async () => {
    await control.arm('snapshot.duringCopy', false);
    const capture = captureLocalDatabaseSnapshot();
    await control.waitReached();
    let nativeDone = false, readerDone = false;
    const native = control.holdIndependent(0).then(() => { nativeDone = true; });
    const started = global.performance.now();
    const reader = openSmartFinDatabase().then(db => db.executeSql("SELECT balance_amount FROM accounts WHERE id='bank'")).then(() => { readerDone = true; return global.performance.now() - started; });
    await control.acquisitionTimeout();
    check(!nativeDone && !readerDone, 'Barrier released before local copy finished');
    await control.resume();
    const value = await capture; await native;
    const readerWaitMs = await reader;
    await discardLocalDatabaseSnapshot(value.snapshot.id);
    return { readerWaitMs, events: await events() };
  });
  for (const journal of ['delete', 'truncate', 'persist', 'wal']) {
    await record('journal-' + journal, async () => {
      await owned(db => db.executeSql('PRAGMA journal_mode=' + journal));
      await owned(db => db.executeSql("UPDATE accounts SET balance_amount=balance_amount WHERE id='bank'"));
      const value = await captureLocalDatabaseSnapshot();
      const state = await inspect(value.snapshot);
      check(state.receipts === 1, 'Journal capture lost receipt');
      await discardLocalDatabaseSnapshot(value.snapshot.id);
      return { snapshot: value.snapshot, timings: value.timings, state };
    });
  }
  await record('checkpoint-exception-before-close-and-copy', async () => {
    await owned(db => db.executeSql('PRAGMA journal_mode=wal'));
    await owned(db => db.executeSql("UPDATE accounts SET balance_amount=balance_amount WHERE id='bank'"));
    global.__snapshotCheckpointFault = true;
    let failure; try { await captureLocalDatabaseSnapshot(); } catch (e) { failure = e; }
    global.__snapshotCheckpointFault = false;
    check(failure, 'Checkpoint failure accepted');
    return { error: String(failure), events: await events() };
  });
  await record('real-wal-writer-causes-incomplete-checkpoint', async () => {
    await owned(db => db.executeSql('PRAGMA journal_mode=wal'));
    await owned(db => db.executeSql("UPDATE accounts SET balance_amount=balance_amount WHERE id='bank'"));
    const reader = control.startWalBlocker(); await control.waitWalBlocker();
    let failure; try { await captureLocalDatabaseSnapshot(); } catch (e) { failure = e; }
    await control.finishWalBlocker(); await reader;
    check(failure, 'Busy checkpoint accepted');
    const recovered = await captureLocalDatabaseSnapshot();
    await discardLocalDatabaseSnapshot(recovered.snapshot.id);
    return { error: String(failure), events: await events() };
  });
  await record('snapshot-does-not-convert-lost-commit-response-to-rollback', async () => {
    const db = await openSmartFinDatabase();
    global.__snapshotCommitLost = true;
    const result = await runSharedSQLiteTransaction(db, scope => scope.executeSql("UPDATE accounts SET balance_amount=830000 WHERE id='bank'"));
    global.__snapshotCommitLost = false;
    check(result.status === 'unknown', 'Lost commit response did not remain unknown');
    const value = await captureLocalDatabaseSnapshot();
    const state = await inspect(value.snapshot);
    check(state.balance === 830000 && result.status === 'unknown', 'Snapshot reinterpreted unknown or lost commit');
    await discardLocalDatabaseSnapshot(value.snapshot.id);
    return { status: result.status, state, events: await events() };
  });
  for (const count of [1000, 10000, 100000]) {
    await owned(async db => {
      await db.executeSql("DELETE FROM transactions WHERE id LIKE 't-%'");
      await db.executeSql(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${count - 1}) INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at) SELECT 't-'||n,1000,'COP','Synthetic','2026-10-18','bank','expense','outflow','posted','2026-10-18','2026-10-18' FROM seq`);
    });
    await record('performance-' + count, async () => {
      const requested = global.performance.now();
      const capture = captureLocalDatabaseSnapshot();
      const reader = openSmartFinDatabase().then(db => db.executeSql('SELECT count(*) AS total FROM transactions')).then(([rows]) => ({ count: rows.rows.item(0).total, waitMs: global.performance.now() - requested }));
      const financial = openSmartFinDatabase().then(db => runSharedSQLiteTransaction(db, scope => scope.executeSql("UPDATE accounts SET balance_amount=balance_amount WHERE id='bank'")))
        .then(result => ({ status: result.status, waitMs: global.performance.now() - requested }));
      const value = await capture;
      const waited = await reader;
      const financialWait = await financial;
      check(financialWait.status === 'confirmed', 'Queued financial operation did not finish');
      check(waited.count === count, 'Reader saw partial rows');
      const state = await inspect(value.snapshot);
      for (const table of ['installment_purchases','shared_expenses','shared_loss_events','shared_commands','account_balance_history','credit_card_statements','subscription_occurrences','app_settings'])
        check(state.tables.find(([name]) => name === table)?.[1] > 0, 'Populated table omitted: ' + table);
      const sample = { count, snapshot: value.snapshot, timings: value.timings, reader: waited, financial: financialWait };
      samples.push(sample); await discardLocalDatabaseSnapshot(value.snapshot.id);
      return { ...sample, state };
    });
  }
  await record('native-cancelAll-keeps-sql-and-completes-platform-effects', async () => owned(async (_db, permit) => {
    await createSubscriptionReminderService(permit).cancelAll(); return events();
  }));
  await record('stage-private-snapshot-for-process-restart', async () => {
    const value = await captureLocalDatabaseSnapshot();
    await control.saveRestart(JSON.stringify({ snapshot: value.snapshot, uid: config.uid }));
    await closeSmartFinDatabase();
    return value.snapshot;
  });
}
export default function Harness() {
  const [status, setStatus] = useState('Running isolated snapshots');
  useEffect(() => {
    (async () => {
      const url = await Linking.getInitialURL();
      const campaign = url?.split('/').pop() || 'core';
      let failure;
      try { await run(campaign); } catch (error) { failure = String(error); }
      if (campaign === 'host-real') return;
      const report = { config, campaign, passed: !failure && cases.every(c => c.passed), failure, cases, samples, events: await events() };
      await control.report(JSON.stringify(report)); setStatus(report.passed ? 'Passed' : 'FAILED: ' + failure);
    })();
  }, []);
  return <View><Text>{status}</Text></View>;
}
