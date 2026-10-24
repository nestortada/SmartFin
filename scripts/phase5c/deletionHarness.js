/* global performance */
import {deleteFinancialData} from './src/modules/settings/useCases/deleteFinancialData';
import {createSqliteFinancialDataRepository} from './src/modules/settings/repositories/sqliteFinancialDataRepository';
import {financialDeletionLifecycle, recoverFinancialDeletion} from './src/modules/settings/services/financialDeletionLifecycle';
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {runSharedSQLiteTransaction} from './src/database/atomicSQLite';
import {captureLocalDatabaseSnapshot} from './src/modules/settings/services/localDatabaseSnapshot';
import {createSubscriptionReminderService} from './src/modules/subscriptions/services/androidSubscriptionReminderService';
import {runSubscriptionMaintenance, subscriptionHeadlessTask} from './src/modules/subscriptions/services/subscriptionRuntime';
const KEY = '__smartfin_financial_lifecycle_v1';
const reminder = {id:'subscription-reminder:r',revision:1,fireAt:'2099-10-18T15:00:00.000Z'};
export async function runDeletion(campaign, {owned, seed, record, control, backup, check}) {
  const started = performance.now();
  const epoch = () => owned(async db => {
    const [result] = await db.executeSql('SELECT setting_value FROM app_settings WHERE setting_key=?',[KEY]);
    return result.rows.length ? JSON.parse(result.rows.item(0).setting_value).epoch : 'legacy';
  });
  const intent = () => owned(async db => {
    const [result] = await db.executeSql('SELECT setting_value FROM app_settings WHERE setting_key=?',[KEY]);
    return result.rows.length ? JSON.parse(result.rows.item(0).setting_value) : null;
  });
  const snapshot = () => owned(async db => {
    const [names] = await db.executeSql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const tables = {};
    for(let i=0;i<names.rows.length;i++) {
      const name=names.rows.item(i).name.replace(/"/g,'""');
      const [columns]=await db.executeSql(`PRAGMA table_info("${name}")`);
      const order=Array.from({length:columns.rows.length},(_,n)=>'"'+columns.rows.item(n).name.replace(/"/g,'""')+'"').join(',');
      const [rows]=await db.executeSql(`SELECT * FROM "${name}" ORDER BY ${order}`);
      tables[name]=Array.from({length:rows.rows.length},(_,n)=>rows.rows.item(n));
    }
    const [fk]=await db.executeSql('PRAGMA foreign_key_check'); const [integrity]=await db.executeSql('PRAGMA integrity_check');
    check(!fk.rows.length && integrity.rows.item(0).integrity_check==='ok','Integrity failed');
    return tables;
  });
  const schedule = () => owned(async(db,permit)=>{
    // Maintenance may legitimately cancel this handcrafted reminder; restore the synthetic precondition.
    await db.executeSql("UPDATE subscription_reminders SET desired='scheduled',revision=1,delivery_status='pending' WHERE id=?",[reminder.id]);
    return createSubscriptionReminderService(permit).schedule(reminder);
  });
  const wipe = async lifecycle => deleteFinancialData(createSqliteFinancialDataRepository(await openSmartFinDatabase()),lifecycle);
  const resources = async () => ({epoch:await epoch(),alarm:await control.alarmExists(reminder.id,await epoch()),intent:await intent()});
  await record('isolated-package-cannot-read-production-database',()=>control.isolation());
  if(campaign==='phase5c-restart') {
    await openSmartFinDatabase();
    await record('restart-recovers-confirmed-intent-only-without-delete',async()=>{
      const before=await snapshot();
      const recovered=await recoverFinancialDeletion();
      check(recovered.status==='completed','Restart did not complete cleanup');
      const after=await snapshot();
      for(const name of Object.keys(before)) if(name!=='app_settings') check(JSON.stringify(before[name])===JSON.stringify(after[name]),'Recovery changed '+name);
      check(!await control.alarmExists(reminder.id,(await intent()).previousEpoch),'Old alarm remains');
      const privateResources=JSON.parse(await control.privateResources());check(!privateResources.snapshots.length && !privateResources.staging.length,'Private financial resources retained');
      const saved=JSON.parse(await control.readRestart());
      if(saved.oldDocs){const current=JSON.parse(await control.documents());for(const [name,entry] of Object.entries(saved.oldDocs))check(JSON.stringify(current[name])===JSON.stringify(entry),'External backup modified');}
      return {recovered,resources:await resources(),privateResources};
    }); return;
  }
  if(campaign==='phase5c-unknown-restart') {
    await openSmartFinDatabase();
    await record('restart-absence-of-commit-receipt-remains-unknown-without-financial-retry',async()=>{
      const before=await snapshot(), recovered=await recoverFinancialDeletion();
      check(recovered.status==='unknown','Receipt absence inferred rollback');
      const result=await wipe(); check(result.status==='unknown','Second wipe admitted');
      check(JSON.stringify(before)===JSON.stringify(await snapshot()),'Unknown retried SQL');
      return {recovered,result,resources:await resources()};
    }); return;
  }
  await seed(); await control.configureSaf(); await schedule();
  if(campaign.startsWith('phase5c-lost-')) {
    const before=campaign.endsWith('before');
    await record('lost-commit-response-no-cancellation-or-financial-retry',async()=>{
      global.__deletionCommitBefore=before; global.__snapshotCommitLost=!before;
      const result=await wipe();
      check(result.status==='unknown','Lost commit was not unknown');
      check(await control.alarmExists(reminder.id,'legacy'),'Unknown canceled alarm');
      await control.saveRestart(JSON.stringify(result)); return result;
    }); return;
  }
  if(campaign==='phase5c-matrix') {
    await record('native-old-order-cancel-before-sql-rollback-reproduction',async()=>{
      const before=await snapshot();
      await owned(async(db,permit)=>{
        await createSubscriptionReminderService(permit).cancelAll();
        const result=await runSharedSQLiteTransaction(db,async participant=>{
          await participant.executeSql('DELETE FROM subscription_reminders'); throw Error('Synthetic rollback');
        },permit); check(result.status==='rolledBack','Missing rollback');
      });
      check(JSON.stringify(before)===JSON.stringify(await snapshot()),'Baseline SQL changed');
      check(!await control.alarmExists(reminder.id,'legacy'),'Baseline alarm unexpectedly preserved');
      await schedule(); return {financialRollback:true,alarmCanceled:true};
    });
    for(let write=1;write<=38;write++) for(const phase of ['before','after']) {
      await record(`integral-rollback-${write}-${phase}-original-android-alarm-intact`,async()=>{
        const before=await snapshot(); global.__deletionFault={write,phase,count:0};
        const result=await wipe(); global.__deletionFault=undefined;
        check(result.status==='rolledBack','Fault was not rolledBack: '+JSON.stringify(result));
        check(JSON.stringify(before)===JSON.stringify(await snapshot()),'Partial SQL state');
        check(await control.alarmExists(reminder.id,'legacy'),'Rollback canceled Android alarm');
        return {write,phase,status:result.status};
      });
    }
    return;
  }
  if(campaign==='phase5c-main') {
    await record('phase5b1-independent-native-participant-drains-before-shared-delete-rollback',async()=>{
      await control.arm('independent.active',false);
      const reader=control.holdIndependent(100);await control.waitReached();
      global.__deletionFault={write:1,phase:'after',count:0};
      let done=false;const requested=performance.now();
      const result=wipe().then(value=>{done=true;return value;});
      await new Promise(resolve=>setTimeout(resolve,100));check(!done,'Deletion passed active independent participant');
      await control.resume();await reader;
      const outcome=await result;global.__deletionFault=undefined;
      check(outcome.status==='rolledBack' && await control.alarmExists(reminder.id,'legacy'),'Barrier/rollback failed');
      return {outcome,waitMs:performance.now()-requested};
    });
    // All durable publication states are revoked by epoch, preserving complete external generations.
    const verified=JSON.parse(await backup.preparePublication());
    const captured=await captureLocalDatabaseSnapshot(verified.id);
    await backup.publishSnapshot(verified.id,captured.snapshot.id);
    const oldDocs=JSON.parse(await control.documents());
    const pending=JSON.parse(await backup.preparePublication());
    const pendingCapture=await captureLocalDatabaseSnapshot(pending.id);
    await control.fault('pause:open:smartfin-backup.db');
    const publishing=backup.publishSnapshot(pending.id,pendingCapture.snapshot.id);
    await control.waitSaf();
    await record('active-saf-publication-rejects-deletion-without-sqlite-permit-wait',async()=>{
      const before=await snapshot(), requested=performance.now();
      const result=await wipe();
      check(result.status==='rejected','Active publication allowed deletion');
      check(JSON.stringify(before)===JSON.stringify(await snapshot()),'Rejected deletion wrote SQL');
      await control.resumeSaf(); await publishing;
      return {result,rejectionMs:performance.now()-requested};
    });
    const failed=JSON.parse(await backup.preparePublication()); await backup.failCapture(failed.id);
    const uncertain=JSON.parse(await backup.preparePublication());
    const uncertainCapture=await captureLocalDatabaseSnapshot(uncertain.id);
    await control.fault('create:manifest.json');
    try {await backup.publishSnapshot(uncertain.id,uncertainCapture.snapshot.id);}catch{}
    await control.fault(''); await backup.retainFailedJob(uncertain.id);
    const stateFixtures=[];
    for(const state of ['prepared','snapshotValidated','publicationPending','verified','failed','uncertain']) {
      const job=JSON.parse(await backup.preparePublication());await captureLocalDatabaseSnapshot(job.id);
      stateFixtures.push({id:job.id,state});await control.stagePublication(job.id,'failed');
    }
    const prepared=JSON.parse(await backup.preparePublication());
    for(const job of stateFixtures)await control.stagePublication(job.id,job.state);
    await owned((_db,permit)=>createSubscriptionReminderService(permit).ensureMaintenance());
    await control.runWorker(); await control.waitWorkersIdle(); await schedule();
    await record('commit-cleanup-fault-persists-intent-and-blocks-conflicting-resources',async()=>{
      await control.arm('cleanup.before:reminderIds',true);
      const result=await wipe();
      check(result.status==='confirmed' && result.cleanup==='pending','Cleanup failure lost financial confirmation');
      const state=await snapshot(); check(state.accounts.length===0 && state.transactions.length===0,'Incomplete wipe');
      check(await control.alarmExists(reminder.id,'legacy'),'Fault canceled original alarm');
      let blocked=false;try{await schedule();}catch{blocked=true;}check(blocked,'Pending cleanup allowed scheduling');
      for(const job of [verified,pending,failed,uncertain,prepared,...stateFixtures]){
        let rejected=false;try{await backup.publishSnapshot(job.id,null);}catch{rejected=true;}check(rejected,'Obsolete job published');
      }
      await control.saveRestart(JSON.stringify({result,oldDocs}));
      return {result,intent:await intent(),stateFixtures,elapsedMs:performance.now()-started};
    }); return;
  }
  if(campaign==='phase5c-cleanup-matrix') {
    for(const stage of ['cleanup.before:workIds','cleanup.after:workIds','cleanup.before:reminderIds','cleanup.after:reminderIds',
      'cleanup.before:backupJobIds','cleanup.after:backupJobIds','cleanup.before:snapshotIds','cleanup.after:snapshotIds',
      'cleanup.beforeCompleted','cleanup.response']) {
      await seed(); await schedule();
      const job=JSON.parse(await backup.preparePublication()); await captureLocalDatabaseSnapshot(job.id);
      await owned((_db,permit)=>createSubscriptionReminderService(permit).ensureMaintenance());
      await control.runWorker(); await control.waitWorkersIdle();
      await record(stage+'-keeps-commit-and-only-repeats-idempotent-cleanup',async()=>{
        const lifecycle=financialDeletionLifecycle(), collect=lifecycle.inventory;
        lifecycle.inventory=async(...args)=>{const result=await collect(...args);await control.arm(stage,true);return result;};
        const requested=performance.now(); const result=await wipe(lifecycle);
        check(result.status==='confirmed' && result.cleanup==='pending','Fault did not remain financially confirmed: '+JSON.stringify(result));
        const tables=await snapshot(); check(!tables.accounts.length && !tables.transactions.length,'Partial wipe');
        const nativeEvents=JSON.parse(await control.events());check(nativeEvents.some(e=>e.event===stage),'Native fault not reached');
        const recovered=await recoverFinancialDeletion(); check(recovered.status==='completed','Cleanup not recoverable');
        check((await intent()).epoch===result.id,'Recovery changed epoch');
        return {result,recovered,elapsedMs:performance.now()-requested,nativeEvents};
      });
    } return;
  }
  if(campaign==='phase5c-new-identities') {
    // This campaign follows restart on an already empty, completed generation.
    await record('new-identical-reminder-id-survives-old-cleanup-and-old-headless',async()=>{
      const current=await epoch(); await schedule();
      check(await control.alarmExists(reminder.id,current),'New epoch alarm absent');
      await recoverFinancialDeletion();
      await subscriptionHeadlessTask({runId:'obsolete-synthetic',datasetEpoch:'legacy'}).catch(()=>{});
      await control.receiver();
      check(await control.alarmExists(reminder.id,current),'Old cleanup canceled new alarm');
      const old=JSON.parse(await backup.getPublicationJobs());
      for(const job of old){let error;try{await backup.publishSnapshot(job.id,null);}catch(e){error=String(e);}check(error?.includes('anterior') || error?.includes('revocada'),'Old job did not reject by epoch: '+error);}
      const after=JSON.parse(await backup.getPublicationJobs());check(JSON.stringify(old)===JSON.stringify(after),'Revoked attempt changed historical job state');
      const status=await backup.getBackupStatus(0);check(status.datasetCurrency==='historical','Old backup presented as current');
      await runSubscriptionMaintenance();
      await control.runWorker();
      return {current,status,resources:await resources()};
    }); return;
  }
  throw Error('Unknown deletion campaign '+campaign);
}
