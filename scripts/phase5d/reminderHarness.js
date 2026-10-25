/* global performance */
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {createSubscriptionReminderService} from './src/modules/subscriptions/services/androidSubscriptionReminderService';
import {getSubscriptionApi, subscriptionHeadlessTask} from './src/modules/subscriptions/services/subscriptionRuntime';
import {deleteFinancialData} from './src/modules/settings/useCases/deleteFinancialData';
import {createSqliteFinancialDataRepository} from './src/modules/settings/repositories/sqliteFinancialDataRepository';
import {recoverFinancialDeletion, financialDeletionLifecycle} from './src/modules/settings/services/financialDeletionLifecycle';

const id='subscription-reminder:r', KEY='__smartfin_financial_lifecycle_v1';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function runReminders(campaign,{owned,seed,record,control,check}) {
  await control.recoveryEnabled(false);
  const rows=sql=>owned(async db=>{const [r]=await db.executeSql(sql);return Array.from({length:r.rows.length},(_,i)=>r.rows.item(i));});
  const state=async()=>({reminder:(await rows("SELECT * FROM subscription_reminders WHERE id='subscription-reminder:r'"))[0],native:JSON.parse(await control.deliveryEvidence())});
  const snapshot=()=>owned(async db=>{
    const [names]=await db.executeSql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const tables={};for(let i=0;i<names.rows.length;i++) {
      const name=names.rows.item(i).name;if(name==='subscription_reminders')continue;
      const [cols]=await db.executeSql(`PRAGMA table_info("${name}")`);
      const order=Array.from({length:cols.rows.length},(_,n)=>'"'+cols.rows.item(n).name+'"').join(',');
      const [r]=await db.executeSql(`SELECT * FROM "${name}" ORDER BY ${order}`);
      tables[name]=Array.from({length:r.rows.length},(_,n)=>r.rows.item(n));
    }
    const [fk]=await db.executeSql('PRAGMA foreign_key_check'),[integrity]=await db.executeSql('PRAGMA integrity_check');
    check(!fk.rows.length&&integrity.rows.item(0).integrity_check==='ok','FK/integrity failure');return tables;
  });
  const epoch=async()=>{const r=await rows(`SELECT setting_value FROM app_settings WHERE setting_key='${KEY}'`);return r.length?JSON.parse(r[0].setting_value).epoch:'legacy';};
  const reset=async()=>{
    await control.deliveryReset();await owned(async db=>{
      await db.executeSql('DROP TRIGGER IF EXISTS phase5d_fail_ack');
      await db.executeSql("UPDATE recurring_subscriptions SET status='active' WHERE id='s'");
      await db.executeSql("UPDATE subscription_occurrences SET status='pending',expected_date='2099-10-19' WHERE id='o'");
      await db.executeSql("UPDATE subscription_reminders SET revision=1,desired='scheduled',delivery_status='scheduled',applied_revision=1,error=NULL,fire_at=? WHERE id=?",[new Date(Date.now()-60000).toISOString(),id]);
    });
  };
  const deliver=async(stage='',mode='',baseline=false,revision=1,eventEpoch)=>{
    const start=performance.now();const native=JSON.parse(await control.delivery(stage,mode,baseline,revision,eventEpoch??await epoch()));
    return {native,ms:performance.now()-start,reminder:(await state()).reminder};
  };
  const revisionChecks=[];
  const unchanged=async (before,expectedDelta=1)=>{
    const after=await snapshot(),oldRevision=before.financial_data_revision[0].revision,newRevision=after.financial_data_revision[0].revision;
    check(newRevision===oldRevision+expectedDelta,`Unexpected reminder revision delta ${oldRevision} -> ${newRevision}, expected ${expectedDelta}`);
    const a={...before},b={...after};delete a.financial_data_revision;delete b.financial_data_revision;
    check(JSON.stringify(a)===JSON.stringify(b),'Delivery changed financial tables');
    const evidence={oldRevision,newRevision,expectedDelta,tablesCompared:Object.keys(a).length};revisionChecks.push(evidence);return evidence;
  };
  const assertCalls=(value,n)=>check(value.native.notifyCalls===n,`Expected ${n} notify calls: ${JSON.stringify(value)}`);
  await record('synthetic-UID-and-database-isolation',()=>control.isolation());

  if(campaign==='phase5d-reboot-verify') {
    await openSmartFinDatabase();const saved=JSON.parse(await control.readRestart());
    await record('actual-device-reboot-repairs-real-alarm-without-financial-replay',async()=>{
      const automaticAlarm=await control.alarmExists(saved.rebootReminder.id,saved.epoch);
      await control.recoveryEnabled(true);const started=performance.now();await control.runWorker();
      const recoveryMs=performance.now()-started;
      check(await control.alarmExists(saved.rebootReminder.id,saved.epoch),'Post-boot alarm not repaired');
      check(JSON.stringify(saved.transactions)===JSON.stringify(await rows('SELECT * FROM transactions ORDER BY id')),'Boot replayed financial commands');
      const [occurrence]=await rows(`SELECT * FROM subscription_occurrences WHERE id='${saved.rebootReminder.occurrence_id}'`);
      check(occurrence.expected_date===saved.expectedDate,'Boot moved civil obligation date');
      return {automaticAlarm,recoveryMs,reminder:saved.rebootReminder,epoch:saved.epoch,financial:await snapshot()};
    });return;
  }

  if(campaign==='phase5d-restart') {
    await openSmartFinDatabase();const saved=JSON.parse(await control.readRestart());
    await record('fresh-process-recognizes-SQL-and-retries-only-uncertain-effect',async()=>{
      const before=await snapshot(), prior=await state();
      const result=await deliver();assertCalls(result,saved.expectedCalls);
      check(result.reminder.delivery_status==='delivered','Not acknowledged after restart');
      const financial=await unchanged(before,prior.reminder.delivery_status==='delivered'?0:1);return {saved,prior,result,financial};
    });return;
  }
  await seed();
  if(campaign==='phase5d-reboot-stage') {
    await record('stage-real-future-alarm-for-device-reboot',async()=>{
      const api=await getSubscriptionApi(),date=new Date();date.setDate(date.getDate()+2);
      const anchor=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
      await api.createSubscription({name:'Reboot synthetic',amount:1000,anchorDate:anchor,recurrence:{periodicity:'monthly'},reminders:{enabled:true,offsets:[0],hour:9,minute:0}});
      const [r]=await rows("SELECT * FROM subscription_reminders WHERE id!='subscription-reminder:r' AND desired='scheduled' LIMIT 1");
      check(r,'No reboot fixture');const current=await epoch();check(await control.alarmExists(r.id,current),'No real alarm before reboot');
      const saved={rebootReminder:r,epoch:current,expectedDate:anchor,transactions:await rows('SELECT * FROM transactions ORDER BY id')};
      await control.saveRestart(JSON.stringify(saved));await control.recoveryEnabled(true);return saved;
    });return;
  }
  if(campaign==='phase5d-permission') {
    await reset();await record('notification-permission-denied-retains-blocked-intention',async()=>{
      const before=await snapshot(),result=await deliver();assertCalls(result,0);
      check(result.reminder.delivery_status==='blocked','Denied notification was acknowledged as delivered');
      const financial=await unchanged(before);return {result,financial};
    });return;
  }
  if(campaign.startsWith('phase5d-kill-')) {
    await reset();const stage=campaign.slice('phase5d-kill-'.length);
    await control.saveRestart(JSON.stringify({stage,expectedCalls:stage==='beforeNotify'?1:stage==='afterAck'?1:2}));
    // Actual process death from native hook; result is written by the runner on restart.
    void control.delivery(stage,'kill',false,1,await epoch()).catch(()=>{});await pause(30000);throw Error('Kill did not occur');
  }
  if(campaign==='phase5d-stage-restart') {
    await reset();const result=await deliver();assertCalls(result,1);
    await control.saveRestart(JSON.stringify({stage:'normal',expectedCalls:1}));
    await record('successful-publication-before-normal-process-restart',async()=>result);return;
  }
  if(campaign==='phase5d-recovery') {
    await record('real-AlarmManager-PendingIntent-and-reboot-repair-without-financial-command',async()=>{
      const api=await getSubscriptionApi();
      const date=new Date();date.setDate(date.getDate()+2);
      const anchor=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
      await api.createSubscription({name:'Native recovery synthetic',amount:1000,anchorDate:anchor,recurrence:{periodicity:'monthly'},reminders:{enabled:true,offsets:[0],hour:9,minute:0}});
      const [r]=await rows("SELECT * FROM subscription_reminders WHERE id!='subscription-reminder:r' AND desired='scheduled' LIMIT 1");
      check(r,'No generated reminder');const current=await epoch();
      check(await control.alarmExists(r.id,current),'Real alarm not scheduled');
      await owned(async(_db,permit)=>createSubscriptionReminderService(permit).cancel(r.id));
      // cancel() correctly refuses desired=scheduled; remove just the OS resource in the probe instead.
      await control.removeAlarm(r.id,current);check(!await control.alarmExists(r.id,current),'Alarm not removed');
      const before=await rows('SELECT * FROM transactions ORDER BY id');
      await api.syncSubscriptionReminders();check(await control.alarmExists(r.id,current),'Scheduled alarm not repaired');
      await control.recoveryEnabled(true);
      const recoveryStart=performance.now(),worker=await control.runWorker(),recoveryMs=performance.now()-recoveryStart;
      for(const action of ['android.intent.action.BOOT_COMPLETED','android.intent.action.TIME_SET','android.intent.action.TIMEZONE_CHANGED','android.intent.action.MY_PACKAGE_REPLACED']) {
        await control.recoveryBroadcast(action);await pause(300);await control.runWorker();
      }
      await control.recoveryEnabled(false);
      check(JSON.stringify(before)===JSON.stringify(await rows('SELECT * FROM transactions ORDER BY id')),'Recovery created movements');
      check(await control.alarmExists(r.id,current),'Recovery lost scheduled alarm');
      return {worker,recoveryMs,reminder:r,epoch:current,financial:await snapshot()};
    });return;
  }
  if(campaign==='phase5d-epoch') {
    await reset();
    await record('confirmed-deletion-rejects-old-alarm-and-reused-ID-keeps-new-epoch',async()=>{
      const oldEpoch=await epoch();
      await owned(async(_db,permit)=>createSubscriptionReminderService(permit).schedule({id,revision:1,fireAt:new Date(Date.now()+3600000).toISOString()}));
      const wiped=await deleteFinancialData(createSqliteFinancialDataRepository(await openSmartFinDatabase()));
      check(wiped.status==='confirmed','Deletion did not commit');
      check(!await control.alarmExists(id,oldEpoch),'Old alarm survived cleanup');
      const current=await epoch();check(current!==oldEpoch,'Epoch unchanged');await seed();await reset();
      const before=await snapshot(), stale=await deliver('','',false,1,oldEpoch);assertCalls(stale,0);
      const newOne=await deliver();assertCalls(newOne,1);
      await recoverFinancialDeletion();await subscriptionHeadlessTask({runId:'old-epoch-test',datasetEpoch:oldEpoch}).catch(()=>{});
      const after=await state();check(after.native.active.some(n=>n.tag===`${current}:${id}`),'Old cleanup canceled new notification');
      await unchanged(before);return {wiped,oldEpoch,current,stale,newOne,after};
    });return;
  }
  if(campaign!=='phase5d-matrix')throw Error('Unknown campaign '+campaign);
  await record('actual-AlarmManager-reaches-native-receiver',async()=>{
    await reset();const before=await snapshot();
    await owned(async(_db,permit)=>createSubscriptionReminderService(permit).schedule({id,revision:1,fireAt:new Date(Date.now()+1000).toISOString()}));
    const deadline=Date.now()+30000;let result;
    do {await pause(250);result=await state();} while(result.reminder.delivery_status!=='delivered'&&Date.now()<deadline);
    assertCalls(result,1);check(result.reminder.delivery_status==='delivered','Alarm did not deliver');await unchanged(before);return result;
  });
  await record('receiver-excludes-managed-writer-without-waiting-for-JS',async()=>{
    await reset();await control.arm('receiver.active',false);
    const effect=control.delivery('','',false,1,await epoch());await control.waitReached();
    let completed=false;const writer=owned(db=>db.executeSql("SELECT revision FROM subscription_reminders WHERE id='subscription-reminder:r'")).then(()=>{completed=true;});
    await pause(100);check(!completed,'Managed operation entered during protected delivery');
    await control.resume();const result=JSON.parse(await effect);await writer;check(completed,'Gate was not released');return result;
  });
  for(const baseline of [true,false]) {
    for(const stage of ['beforeNotify','afterNotify','beforeAck','afterAck',...(baseline?['afterCommit']:[])]) {
      await record(`${baseline?'before':'after'}-failure-${stage}`,async()=>{
        await reset();const before=await snapshot(),first=await deliver(stage,'fail',baseline);
        const alreadyAck=stage==='afterCommit'||(!baseline&&stage==='afterAck');
        assertCalls(first,stage==='beforeNotify'?0:1);
        check(first.reminder.delivery_status===(alreadyAck?'delivered':'scheduled'),'Unexpected durable outcome');
        const retry=await deliver('','',baseline);assertCalls(retry,stage==='beforeNotify'||alreadyAck?1:2);
        check(retry.native.active.length===1,'Stable identity did not replace active notification');
        check(retry.reminder.delivery_status==='delivered','Retry did not acknowledge');
        if(!baseline)check(Math.floor(retry.native.active[0].flags/8)%2===1,'FLAG_ONLY_ALERT_ONCE absent');
        await unchanged(before);return {first,retry};
      });
    }
  }
  await record('actual-SQL-UPDATE-abort-after-notify-is-retryable',async()=>{
    await reset();await owned(db=>db.executeSql("CREATE TRIGGER phase5d_fail_ack BEFORE UPDATE ON subscription_reminders WHEN NEW.delivery_status='delivered' BEGIN SELECT RAISE(ABORT,'phase5d SQL failure'); END"));
    const before=await snapshot(),first=await deliver();assertCalls(first,1);check(first.reminder.delivery_status==='scheduled','Failed UPDATE acknowledged');
    await owned(db=>db.executeSql('DROP TRIGGER phase5d_fail_ack'));const retry=await deliver();assertCalls(retry,2);await unchanged(before);return {first,retry};
  });
  for(const invalid of ['cancelled','paid','skipped','overdue','paused','contractCancelled','expired','future','revision','delivered','deleted']) {
    await record('reject-'+invalid,async()=>{
      await reset();await owned(async db=>{
        if(invalid==='cancelled')await db.executeSql("UPDATE subscription_reminders SET desired='cancelled'");
        if(['paid','skipped','overdue'].includes(invalid))await db.executeSql('UPDATE subscription_occurrences SET status=?',[invalid]);
        if(['paused','contractCancelled'].includes(invalid))await db.executeSql('UPDATE recurring_subscriptions SET status=?',[invalid==='paused'?'paused':'cancelled']);
        if(invalid==='expired')await db.executeSql("UPDATE subscription_occurrences SET expected_date='2000-01-01'");
        if(invalid==='future')await db.executeSql("UPDATE subscription_reminders SET fire_at='2099-10-18T15:00:00.000Z'");
        if(invalid==='delivered')await db.executeSql("UPDATE subscription_reminders SET delivery_status='delivered'");
        if(invalid==='deleted')await db.executeSql('DELETE FROM subscription_reminders');
      });
      const before=await snapshot(),result=await deliver('','',false,invalid==='revision'?0:1);assertCalls(result,0);await unchanged(before,0);
      if(invalid==='deleted')await seed();return result;
    });
  }
  await record('dismissed-active-notification-is-not-proof-of-nondelivery',async()=>{
    await reset();const first=await deliver('afterNotify','fail');assertCalls(first,1);
    await control.dismissReminder(await epoch());await pause(150);const absent=await state();check(!absent.native.active.length,'Dismissal not applied');
    const retry=await deliver();assertCalls(retry,2);check(retry.reminder.delivery_status==='delivered','Uncertainty lost');return {first,absent,retry};
  });
  await record('durable-deletion-admission-rejects-publication-before-SQL',async()=>{
    await reset();const lifecycle=financialDeletionLifecycle(),admission=await lifecycle.begin();
    check(admission.status==='admitted','Test admission rejected');
    try {
      const before=await snapshot(),result=await deliver();assertCalls(result,0);await unchanged(before,0);return result;
    } finally { await owned((_db,permit)=>lifecycle.rollback(admission.id,permit)); }
  });
  await record('financial-tables-and-exact-trigger-revision-deltas',async()=>revisionChecks);
}
