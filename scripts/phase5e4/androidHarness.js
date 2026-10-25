/* global performance */
// Phase 5E.4 synthetic APK campaigns: 50-calendar-year manual backup profile with a
// byte comparison against the frozen 5E.3 CSV exporter, and recovery contention
// (defect 5E3-001). Only the isolated test package and its synthetic database.
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {captureLocalDatabaseSnapshot} from './src/modules/settings/services/localDatabaseSnapshot';
import {deleteFinancialData} from './src/modules/settings/useCases/deleteFinancialData';
import {createSqliteFinancialDataRepository} from './src/modules/settings/repositories/sqliteFinancialDataRepository';
import {awaitFinancialDeletionRecovery, recoverFinancialDeletion} from './src/modules/settings/services/financialDeletionLifecycle';
import {createSubscriptionReminderService} from './src/modules/subscriptions/services/androidSubscriptionReminderService';
import {getSubscriptionApi, runSubscriptionMaintenance} from './src/modules/subscriptions/services/subscriptionRuntime';
import {representativeSeedStatements} from './representativeHistory';

const check=(value,message)=>{if(!value)throw Error(message);};
const rowsOf=r=>Array.from({length:r.rows.length},(_,i)=>r.rows.item(i));
const KEY='__smartfin_financial_lifecycle_v1';
const reminder={id:'subscription-reminder:r',revision:1,fireAt:'2099-10-18T15:00:00.000Z'};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function backupProfile(campaign,{owned,record,control,backup}){
  const size=Number(/^phase5e4-backup-(\d+)$/.exec(campaign)?.[1]);
  check([1000,10000,100000].includes(size),'Unexpected size');
  const expectedYears={1000:1,10000:5,100000:50}[size];
  const database=await openSmartFinDatabase();
  await record('seed-representative',async()=>{
    const start=performance.now();
    await owned(async db=>{
      for(const s of representativeSeedStatements(size))await db.executeSql(s);
      // csvEvidence (5B.2 control) reads the synthetic 'bank' account balance.
      await db.executeSql("INSERT OR IGNORE INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('bank','Synthetic','bankAccount','active','COP',0,'2026-10-25','2026-10-25')");
    });
    const [r]=await database.executeSql(`SELECT count(*) AS n, count(DISTINCT substr(civil_date,1,4)) AS years,
      min(civil_date) AS first, max(civil_date) AS last, sqlite_version() AS v FROM transactions`);
    const row=r.rows.item(0);
    check(row.n===size&&row.years===expectedYears,'Representative seed');
    return {...row,seedMs:performance.now()-start};
  });
  await control.configureSaf();
  for(let round=1;round<=3;round++){
    await record(`backup-${size}-round-${round}`,async()=>{
      const job=JSON.parse(await backup.preparePublication());
      const start=performance.now();
      const capturing=captureLocalDatabaseSnapshot(job.id);
      // A financial write requested during capture waits for admission.
      const writer=owned(db=>db.executeSql("UPDATE accounts SET updated_at=updated_at WHERE id='rep-bank'")).then(()=>performance.now()-start);
      const captured=await capturing;
      const captureMs=performance.now()-start;
      const financialAdmissionWaitMs=await writer;
      const p=performance.now();
      const published=JSON.parse(await backup.publishSnapshot(job.id,captured.snapshot.id));
      const publicationMs=performance.now()-p;
      const status=await backup.getBackupStatus(0);
      check(published.state==='verified'&&status.generationId===job.id&&status.validation==='verified','Publication not verified');
      const csv=JSON.parse(await control.csvEvidence(job.id));
      check(csv.transactionRows===size,'Annual CSV rows');
      const annual=csv.csv.filter(f=>f.name.startsWith('movimientos-'));
      check(annual.length===expectedYears&&published.fileCount===annual.length+13,'Component inventory');
      // Byte identity against the frozen 5E.3 exporter on the same published snapshot.
      const legacy=JSON.parse(await control.legacyCsvDigests(job.id));
      const differing=csv.csv.filter(f=>legacy.digests[f.name]!==f.sha256).map(f=>f.name);
      check(Object.keys(legacy.digests).length===csv.csv.length&&differing.length===0,'CSV differs from 5E.3 exporter: '+differing.join(','));
      return {job:job.id,times:{captureMs,financialAdmissionWaitMs,publicationMs},fileCount:published.fileCount,annualCsv:annual.length,
        csvTransactionRows:csv.transactionRows,captureTimings:captured.timings,
        nativeCapture:{sourceValidationMs:captured.snapshot.sourceValidationMs,copyMs:captured.snapshot.copyMs,
          validationAndHashMs:captured.snapshot.validationAndHashMs,nativeTotalMs:captured.snapshot.nativeTotalMs,
          sourceDescribe:captured.snapshot.sourceDescribe,snapshotDescribe:captured.snapshot.snapshotDescribe,bytes:captured.snapshot.bytes},
        publishedTimings:published.timings,legacyExportMs:legacy.legacyExportMs,csvIdenticalToFrozen5E3:true,
        status:{validation:status.validation,datasetCurrency:status.datasetCurrency,cloudSync:'unconfirmed'}};
    });
  }
  await record('all-table-integrity-after-backup',async()=>JSON.parse(await control.liveEvidence()));
}

async function recovery(campaign,{owned,seed,record,control}){
  await openSmartFinDatabase();
  const rows=async sql=>rowsOf((await owned(db=>db.executeSql(sql)))[0]);
  const intent=async()=>{const [r]=await rows(`SELECT setting_value FROM app_settings WHERE setting_key='${KEY}'`);return r?JSON.parse(r.setting_value):null;};
  const financial=async()=>JSON.stringify({t:await rows('SELECT * FROM transactions ORDER BY id'),a:await rows('SELECT * FROM accounts ORDER BY id'),
    s:await rows('SELECT * FROM shared_expenses ORDER BY id')});
  const stagePending=async()=>{
    await seed();
    await owned(async(db,permit)=>{
      await db.executeSql("UPDATE subscription_reminders SET desired='scheduled',revision=1,delivery_status='pending' WHERE id=?",[reminder.id]);
      await createSubscriptionReminderService(permit).schedule(reminder);
    });
    await control.arm('cleanup.before:reminderIds',true);
    const result=await deleteFinancialData(createSqliteFinancialDataRepository(await openSmartFinDatabase()));
    check(result.status==='confirmed'&&result.cleanup==='pending','Cleanup not pending: '+JSON.stringify(result));
    check(await control.alarmExists(reminder.id,'legacy'),'Old alarm missing before recovery');
    return result;
  };
  if(campaign==='phase5e4-recovery-contention'){
    // The base harness record() does not return the operation value.
    let staged;
    await record('stage-confirmed-deletion-pending-cleanup',async()=>{staged=await stagePending();return staged;});
    const before=await financial();
    await record('concurrent-owner-is-running-not-error',async()=>{
      await control.recoveryEnabled(true);
      await control.holdCleanup();
      // Two JS callers at once (App maintenance and AppNavigator) while the native owner holds the mutex.
      const [a,b]=await Promise.all([recoverFinancialDeletion(),recoverFinancialDeletion()]);
      check(a.status==='running'&&b.status==='running','Contention not reported as running: '+JSON.stringify([a,b]));
      check(await control.alarmExists(reminder.id,'legacy'),'Contender touched resources');
      let observedRunning=0;
      const waiting=awaitFinancialDeletionRecovery({intervalMs:200,onRunning:()=>{observedRunning++;}});
      await pause(1000);
      const owner=JSON.parse(await control.releaseCleanup());
      const final=await waiting;
      check(owner.status==='completed'&&final.status==='completed'&&final.id===staged.id,'Final state not followed: '+JSON.stringify({owner,final}));
      check(!await control.alarmExists(reminder.id,'legacy'),'Old alarm survived completed cleanup');
      check(before===await financial(),'Recovery changed financial tables');
      return {first:[a,b],observedRunning,owner,final};
    });
    await record('maintenance-waits-for-running-owner',async()=>{
      await control.holdCleanup();
      const maintenance=runSubscriptionMaintenance().then(()=>'done',e=>'error:'+String(e));
      await pause(800);
      const settledEarly=await Promise.race([maintenance,pause(50).then(()=>'pending')]);
      check(settledEarly==='pending','Maintenance did not wait for the running owner: '+settledEarly);
      const owner=JSON.parse(await control.releaseCleanup());
      const outcome=await maintenance;
      check(outcome==='done','Maintenance failed after owner finished: '+outcome);
      return {owner,outcome};
    });
    await record('new-epoch-reminder-survives-later-recovery',async()=>{
      const epoch=(await intent()).epoch;
      const api=await getSubscriptionApi(),date=new Date();date.setDate(date.getDate()+2);
      const anchor=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
      await api.createSubscription({name:'Epoch synthetic',amount:1000,anchorDate:anchor,recurrence:{periodicity:'monthly'},reminders:{enabled:true,offsets:[0],hour:9,minute:0}});
      const [r]=await rows("SELECT * FROM subscription_reminders WHERE desired='scheduled' LIMIT 1");
      check(r&&await control.alarmExists(r.id,epoch),'New epoch alarm absent');
      // Scheduling may enqueue a real Worker that briefly owns cleanup: close the test
      // barrier and drain Workers so the held owner is the only contender.
      await control.recoveryEnabled(false);
      await control.waitWorkersIdle();
      await control.holdCleanup();
      check((await recoverFinancialDeletion()).status==='running','Expected running');
      await control.releaseCleanup();
      const again=await awaitFinancialDeletionRecovery({intervalMs:100});
      check(again.status==='completed'&&await control.alarmExists(r.id,epoch),'Later recovery canceled a new-epoch reminder');
      return {epoch,again,reminder:r.id};
    });
    await record('all-table-integrity-after-recovery',async()=>JSON.parse(await control.liveEvidence()));
    return;
  }
  if(campaign==='phase5e4-recovery-error'){
    // The base harness record() does not return the operation value.
    let staged;
    await record('stage-confirmed-deletion-pending-cleanup',async()=>{staged=await stagePending();return staged;});
    const before=await financial();
    await record('real-error-is-reported-and-intent-kept',async()=>{
      await control.recoveryEnabled(true);
      await control.arm('cleanup.acquired',true);
      let error;try{await recoverFinancialDeletion();}catch(e){error=String(e?.message??e);}
      check(error&&!/running/i.test(error),'Unexpected failure was hidden: '+error);
      // The durable intent is native-private: it is proven kept by the same id completing below.
      check(await control.alarmExists(reminder.id,'legacy'),'Resource changed by failed recovery');
      const next=await awaitFinancialDeletionRecovery({intervalMs:100});
      check(next.status==='completed'&&next.id===staged.id,'Recovery did not resume after error');
      check(before===await financial(),'Recovery changed financial tables');
      return {error,next};
    });
    await record('all-table-integrity-after-recovery',async()=>JSON.parse(await control.liveEvidence()));
    return;
  }
  throw Error('Unknown recovery campaign');
}

export async function runPhase5E4(campaign,deps){
  const original=deps.record;
  const record=(name,operation)=>original(name,async()=>{
    try{return await operation();}catch(e){throw e instanceof Error?e:Error('Driver error: '+JSON.stringify(e));}
  });
  deps={...deps,record};
  await deps.control.recoveryEnabled(false);
  await record('isolation',()=>deps.control.isolation());
  if(campaign.startsWith('phase5e4-backup-'))return backupProfile(campaign,deps);
  if(campaign.startsWith('phase5e4-recovery-'))return recovery(campaign,deps);
  throw Error('Unknown 5E.4 campaign');
}
