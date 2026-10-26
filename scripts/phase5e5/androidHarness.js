/* global performance */
// Phase 5E.5 synthetic APK campaigns: recoverability evidence for the isolated verifier,
// backup failure matrix on the production discovery/publication path, and internal
// financial epochs. Only the isolated test package, its synthetic database and the
// synthetic document provider. No production database, folder or Google Drive.
import {integratedFixture, buildIntegratedScenario} from './scripts/phase5e/integration';
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {captureLocalDatabaseSnapshot} from './src/modules/settings/services/localDatabaseSnapshot';
import {createSubscriptionReminderService} from './src/modules/subscriptions/services/androidSubscriptionReminderService';
import {deleteFinancialData} from './src/modules/settings/useCases/deleteFinancialData';
import {createSqliteFinancialDataRepository} from './src/modules/settings/repositories/sqliteFinancialDataRepository';
import {recoverFinancialDeletion} from './src/modules/settings/services/financialDeletionLifecycle';
import {representativeSeedStatements} from './representativeHistory';
import {canonicalTables, recoverabilityFigures} from './phase5e5Recoverability';

const check=(value,message)=>{if(!value)throw Error(message);};
const parse=JSON.parse;
const rowsOf=r=>Array.from({length:r.rows.length},(_,i)=>r.rows.item(i));
async function reject(operation){let error;try{await operation();}catch(e){error=String(e?.message??e);}check(error,'Failure was accepted');return error;}

function sinkFor(control,prefix,keepFiles){
  return {
    begin:table=>control.evidenceBegin(prefix+':'+table,keepFiles?`${prefix}/tables/${table}.jsonl`:null),
    append:(table,text)=>control.evidenceAppend(prefix+':'+table,text),
    finish:async table=>parse(await control.evidenceFinish(prefix+':'+table)),
  };
}
/**
 * Due reminders are delivered asynchronously by Android and acknowledged in SQLite
 * (delivery_status, revision). Wait until those legitimate background writes settle
 * so the original snapshot is the state the capture will see.
 */
async function settle(){
  const database=await openSmartFinDatabase();
  const state=async()=>JSON.stringify(rowsOf((await database.executeSql(`SELECT (SELECT revision FROM financial_data_revision WHERE id=1) AS revision,
    (SELECT count(*) FROM subscription_reminders WHERE desired='scheduled' AND fire_at<=? AND delivery_status NOT IN ('delivered','failed','blocked','cancelled')) AS due`,[new Date().toISOString()]))[0]));
  const start=performance.now();
  let previous=await state(),stableSince=performance.now();
  while(performance.now()-start<90000){
    await new Promise(resolve=>setTimeout(resolve,1000));
    const current=await state();
    if(current!==previous){previous=current;stableSince=performance.now();continue;}
    if(JSON.parse(current)[0].due===0&&performance.now()-stableSince>=5000)return {settledMs:performance.now()-start,state:JSON.parse(current)[0]};
  }
  return {settledMs:performance.now()-start,state:JSON.parse(previous)[0],timedOut:true};
}
/** Original snapshot computed by the app's own read paths on the live database. */
async function original(control,label,keepFiles){
  const settled=await settle();
  const database=await openSmartFinDatabase();
  const start=performance.now();
  const figures=await recoverabilityFigures(database);
  const figuresMs=performance.now()-start;
  const tables=await canonicalTables(database,sinkFor(control,label,keepFiles));
  const integrity=rowsOf((await database.executeSql('PRAGMA integrity_check'))[0]);
  const fk=rowsOf((await database.executeSql('PRAGMA foreign_key_check'))[0]);
  check(integrity[0]?.integrity_check==='ok'&&!fk.length,'Live database integrity');
  const schema=rowsOf((await database.executeSql("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"))[0]);
  const value={label,figures,tables,schema,figuresMs,totalMs:performance.now()-start};
  await control.evidenceWrite(`${label}/original.json`,JSON.stringify(value));
  return {settled,tables:tables.map(t=>[t.table,t.rows]),digests:tables.map(t=>t.sha256),figuresMs,months:figures.months,current:figures.current};
}
const service=()=>createSubscriptionReminderService();
async function scenario(owned,size){
  const f=await integratedFixture(await openSmartFinDatabase(),service());
  await buildIntegratedScenario(f);
  await owned(async db=>{for(const s of representativeSeedStatements(size))await db.executeSql(s);});
  return f;
}
async function publish(backup,owned){
  const job=parse(await backup.preparePublication());
  const captured=await captureLocalDatabaseSnapshot(job.id);
  const start=performance.now();
  const published=parse(await backup.publishSnapshot(job.id,captured.snapshot.id));
  check(published.state==='verified'&&published.generationId===job.id,'Publication not verified');
  return {job,captured,published,publicationMs:performance.now()-start};
}
const documents=async control=>parse(await control.documents());
async function preserve(control,previous){
  const current=await documents(control);
  for(const [name,entry] of Object.entries(previous))check(JSON.stringify(current[name])===JSON.stringify(entry),'External document changed: '+name);
}

async function recoverability(campaign,{owned,record,control,backup}){
  const size=Number(/^phase5e5-recoverability-(\d+)$/.exec(campaign)?.[1]);
  check([1000,10000,100000].includes(size),'Unexpected size');
  const keepFiles=size<=10000;
  await control.evidenceClear();
  await openSmartFinDatabase();
  await control.configureSaf();
  await record('integrated-scenario-and-representative-history',async()=>{
    await scenario(owned,size);
    const [r]=await owned(db=>db.executeSql(`SELECT count(*) AS n, count(DISTINCT substr(civil_date,1,4)) AS years,
      min(civil_date) AS first, max(civil_date) AS last, sqlite_version() AS v FROM transactions WHERE id LIKE 'rep-%'`));
    const row=r.rows.item(0);
    check(row.n===size&&row.years==={1000:1,10000:5,100000:50}[size],'Representative seed');
    return row;
  });
  let first,g1Original;
  await record('original-snapshot-g1',async()=>{g1Original=await original(control,'g1',keepFiles);const {digests:_d,...shown}=g1Original;return shown;});
  await record('publish-g1-protocol-v2',async()=>{
    first=await publish(backup,owned);
    const status=await backup.getBackupStatus(0);
    check(status.generationId===first.job.id&&status.validation==='verified'&&status.datasetCurrency==='current','G1 status');
    return {id:first.job.id,fileCount:first.published.fileCount,revision:first.published.revision,publicationMs:first.publicationMs,
      snapshot:{bytes:first.captured.snapshot.bytes,sha256:first.captured.snapshot.sha256,revision:first.captured.snapshot.revision},status};
  });
  await record('live-database-unchanged-by-capture-and-publication-g1',async()=>{
    const again=await canonicalTables(await openSmartFinDatabase(),sinkFor(control,'g1-after',keepFiles));
    const changed=again.filter((t,i)=>t.sha256!==g1Original.digests[i]).map(t=>({table:t.table,rows:t.rows,before:g1Original.tables.find(([n])=>n===t.table)?.[1]}));
    check(again.length===g1Original.digests.length&&!changed.length,'Live data changed after capture/publication: '+JSON.stringify(changed));
    return {tables:again.length};
  });
  await record('export-g1',async()=>parse(await control.exportGeneration(first.job.id,'generations')));
  // A later financial change and a second generation: the verifier must pick the newest
  // integral one and never accept components mixed between generations.
  let second;
  await record('financial-change-then-g2',async()=>{
    const f=await integratedFixture(await openSmartFinDatabase(),service(),false);
    await f.save({amount:12345.5,merchantName:'Synthetic G2'});
    await f.payment(1000);
    // CSV fidelity probes through the real manual command: 7 significant digits,
    // centavos and exact 6-digit rounding ties.
    await f.save({amount:1234567,transactionType:'income',merchantName:'Probe 7 digits'});
    for(const amount of [2345678.9,123456.5,1234565])await f.save({accountId:'rep-savings',amount,merchantName:'Probe '+amount});
    const snapshot=await original(control,'g2',keepFiles);
    second=await publish(backup,owned);
    check(second.published.revision>first.published.revision,'G2 revision');
    const status=await backup.getBackupStatus(0);
    check(status.generationId===second.job.id&&status.datasetCurrency==='current','G2 status');
    return {id:second.job.id,revision:second.published.revision,publicationMs:second.publicationMs,snapshot};
  });
  await record('export-g2',async()=>parse(await control.exportGeneration(second.job.id,'generations')));
  if(size===1000)await record('annual-csv-order-probe',async()=>{
    const probe=await control.csvOrderProbe(second.job.id,'2026');
    await control.evidenceWrite('csv-order-probe.json',probe);
    const value=parse(probe);
    return {sqlite:value.sqlite,plans:Object.fromEntries(['pre5E4','current','forcedSort'].map(k=>[k,value[k].plan])),
      sameOrderPre5E4AndCurrent:JSON.stringify(value.pre5E4.ids)===JSON.stringify(value.current.ids)};
  });
  await record('all-table-integrity-after-recoverability',async()=>parse(await control.liveEvidence()));
  await control.evidenceWrite('summary.json',JSON.stringify({campaign,size,g1:first.job.id,g2:second.job.id,api:control.getConstants().api}));
}

async function failures({owned,record,control,backup}){
  await control.evidenceClear();
  await openSmartFinDatabase();
  await control.configureSaf();
  await scenario(owned,1000);
  let g1,g2;
  await record('two-integral-generations',async()=>{
    g1=await publish(backup,owned);
    const f=await integratedFixture(await openSmartFinDatabase(),service(),false);
    await f.save({amount:777,merchantName:'Synthetic between generations'});
    g2=await publish(backup,owned);
    const status=await backup.getBackupStatus(0);
    check(status.generationId===g2.job.id,'Newest integral generation not selected');
    return {g1:g1.job.id,g2:g2.job.id};
  });
  const protectedDocs=await documents(control);
  const g1Docs=Object.fromEntries(Object.entries(protectedDocs).filter(([n])=>n.includes(g1.job.id)));
  const damages=[
    ['incomplete-generation-annual-csv-deleted','movimientos-2026.csv','delete'],
    ['corrupt-sqlite-byte-flip','smartfin-backup.db','flip'],
    ['truncated-sqlite','smartfin-backup.db','truncate'],
    ['missing-component-sqlite','smartfin-backup.db','delete'],
    ['missing-fixed-csv','cuentas.csv','delete'],
    ['wrong-hash-in-manifest','manifest','hash'],
    ['invalid-manifest-json','manifest','malformed'],
    ['invalid-manifest-version','manifest','version'],
    ['missing-manifest','manifest','delete'],
    ['mixed-generations-sqlite-from-g1','smartfin-backup.db','from'],
    ['mixed-generations-csv-from-g1','cuentas.csv','from'],
  ];
  for(const [name,target,mode] of damages){
    await record('g2-'+name+'-falls-back-to-g1',async()=>{
      const applied=parse(await control.damage(g2.job.id,target,mode==='from'?'from:'+g1.job.id:mode));
      const status=await backup.getBackupStatus(0);
      check(status.generationId===g1.job.id&&status.validation==='verified','Damaged G2 selected or G1 lost: '+JSON.stringify(status));
      check(status.datasetCurrency==='current','G1 currency');
      const g1Now=Object.fromEntries(Object.entries(await documents(control)).filter(([n])=>n.includes(g1.job.id)));
      check(JSON.stringify(g1Now)===JSON.stringify(g1Docs),'Protected G1 bytes changed');
      const restored=parse(await control.restoreDamage());
      const healed=await backup.getBackupStatus(0);
      check(healed.generationId===g2.job.id,'G2 not selected after restore');
      return {applied,status:{generationId:status.generationId,validation:status.validation},restored};
    });
  }
  await record('revoked-permission-status-and-publication',async()=>{
    await control.fault('revoked');
    let status;try{status=await backup.getBackupStatus(0);}catch(e){status={error:String(e)};}
    check(status.accessNeedsRenewal===true&&status.validation!=='verified'&&!status.generationId,'Revoked provider reported a generation: '+JSON.stringify(status));
    const job=parse(await backup.preparePublication()).id;
    const captured=await captureLocalDatabaseSnapshot(job);
    const error=await reject(()=>backup.publishSnapshot(job,captured.snapshot.id));
    await control.fault('');
    check((await backup.getPublicationJobs().then(parse)).find(j=>j.id===job)?.state==='uncertain','Revoked publication not uncertain');
    await preserve(control,protectedDocs);
    // New financial data after the interrupted job: recovery must publish the original capture.
    // The capture closed and reopened the managed connection: open the current one.
    const live=await openSmartFinDatabase();
    const f=await integratedFixture(live,service(),false);
    await f.save({amount:3333,merchantName:'Synthetic after revoke'});
    const [r]=await live.executeSql('SELECT revision FROM financial_data_revision WHERE id=1');
    const currentRevision=r.rows.item(0).revision;
    const recovered=parse(await backup.publishSnapshot(job,null));
    check(recovered.state==='verified'&&recovered.revision===captured.snapshot.revision&&recovered.revision<currentRevision,'Old job rebuilt with new data');
    const inventory=parse(await control.exportGeneration(job,'revoked-recovered'));
    const db=inventory[`smartfin-${job}--smartfin-backup.db`];
    check(db.sha256===captured.snapshot.sha256,'Recovered generation is not the original capture');
    await preserve(control,protectedDocs);
    return {status,error,recovered:{revision:recovered.revision,currentRevision},snapshotSha256:captured.snapshot.sha256};
  });
  const afterRevoke=await documents(control);
  await record('interrupted-before-component-then-original-job-recovery',async()=>{
    const job=parse(await backup.preparePublication()).id;
    const captured=await captureLocalDatabaseSnapshot(job);
    await control.fault('create:movimientos-2026.csv');
    const error=await reject(()=>backup.publishSnapshot(job,captured.snapshot.id));
    await control.fault('');
    const status=await backup.getBackupStatus(0);
    check(status.generationId!==job&&status.validation==='verified','Interrupted generation selected');
    await preserve(control,afterRevoke);
    await control.written();
    const recovered=parse(await backup.publishSnapshot(job,null));
    const written=parse(await control.written());
    check(recovered.state==='verified'&&!written.some(n=>n.endsWith('--smartfin-backup.db')||n.endsWith('--cuentas.csv')),'Verified components rewritten');
    check(parse(await control.exportGeneration(job,'interrupted-recovered'))[`smartfin-${job}--smartfin-backup.db`].sha256===captured.snapshot.sha256,'Recovered bytes differ from capture');
    return {error,written,selectedDuringFailure:status.generationId};
  });
  // A component cut mid-write stays in the provider: publication never truncates or
  // overwrites, so this job cannot finish. It must be abandoned explicitly.
  await record('interrupted-mid-component-is-not-resumable-and-is-abandoned',async()=>{
    const before=await backup.getBackupStatus(0);
    const job=parse(await backup.preparePublication()).id;
    const captured=await captureLocalDatabaseSnapshot(job);
    await control.fault('partial:movimientos-2026.csv');
    const error=await reject(()=>backup.publishSnapshot(job,captured.snapshot.id));
    await control.fault('');
    const docsAfterCut=await documents(control);
    await control.written();
    const resumeError=await reject(()=>backup.publishSnapshot(job,null));
    const written=parse(await control.written());
    check(!written.length,'Resume wrote documents over a partial component');
    await preserve(control,docsAfterCut);
    const status=await backup.getBackupStatus(0);
    check(status.generationId===before.generationId,'Partial generation selected or previous lost');
    const blocked=await reject(()=>backup.preparePublication());
    await backup.retainFailedJob(job);
    const next=await publish(backup,owned);
    const after=await backup.getBackupStatus(0);
    check(after.generationId===next.job.id,'New generation after abandon not selected');
    const orphan=Object.keys(await documents(control)).filter(n=>n.startsWith(`smartfin-${job}--`));
    check(orphan.length>0,'Partial evidence removed');
    return {error,resumeError,blocked,abandoned:job,next:next.job.id,orphanDocuments:orphan.length};
  });
  await record('lost-response-after-publication-is-idempotent',async()=>{
    const {job,captured}=await (async()=>{const j=parse(await backup.preparePublication());return {job:j,captured:await captureLocalDatabaseSnapshot(j.id)};})();
    // The caller never receives this result (lost response): it asks again.
    await backup.publishSnapshot(job.id,captured.snapshot.id);
    const before=await documents(control);
    await control.written();
    const again=parse(await backup.publishSnapshot(job.id,null));
    const written=parse(await control.written());
    check(again.generationId===job.id&&again.state==='verified'&&!written.length,'Lost response caused rewrite or new identity');
    await preserve(control,before);
    return {again:{generationId:again.generationId,revision:again.revision},written};
  });
  await record('all-table-integrity-after-failures',async()=>parse(await control.liveEvidence()));
}

async function epochs({owned,record,control,backup}){
  await control.evidenceClear();
  await openSmartFinDatabase();
  await control.configureSaf();
  await scenario(owned,1000);
  let g1,pending,uncertain;
  await record('generation-and-unfinished-jobs-before-deletion',async()=>{
    g1=await publish(backup,owned);
    const status=await backup.getBackupStatus(0);
    check(status.generationId===g1.job.id&&status.datasetCurrency==='current','G1 current');
    uncertain=parse(await backup.preparePublication()).id;
    const captured=await captureLocalDatabaseSnapshot(uncertain);
    await control.fault('create:cuentas.csv');
    await reject(()=>backup.publishSnapshot(uncertain,captured.snapshot.id));
    await control.fault('');
    await backup.retainFailedJob(uncertain);
    pending=parse(await backup.preparePublication()).id;
    pending={id:pending,snapshot:(await captureLocalDatabaseSnapshot(pending)).snapshot};
    return {g1:g1.job.id,uncertain,pending:pending.id,status};
  });
  const external=await documents(control);
  let deletion;
  await record('confirmed-deletion-revokes-old-jobs',async()=>{
    deletion=await deleteFinancialData(createSqliteFinancialDataRepository(await openSmartFinDatabase()));
    check(deletion.status==='confirmed','Deletion not confirmed: '+JSON.stringify(deletion));
    if(deletion.cleanup!=='completed'){const recovered=await recoverFinancialDeletion();check(recovered.status==='completed','Cleanup');}
    const jobs=parse(await backup.getPublicationJobs());
    for(const id of [g1.job.id,uncertain,pending.id])check(jobs.find(j=>j.id===id)?.revokedByDeletion,'Job not revoked: '+id);
    return {deletion,jobs};
  });
  await record('old-generation-recognized-historical-with-local-metadata',async()=>{
    const status=await backup.getBackupStatus(0);
    check(status.generationId===g1.job.id&&status.validation==='verified'&&status.datasetCurrency==='historical','Old generation not historical: '+JSON.stringify(status));
    await preserve(control,external);
    return status;
  });
  await record('old-publication-recovery-cannot-reactivate-deleted-data',async()=>{
    await control.written();
    const errors={};
    errors.g1=await reject(()=>backup.publishSnapshot(g1.job.id,null));
    errors.pending=await reject(()=>backup.publishSnapshot(pending.id,pending.snapshot.id));
    errors.pendingRecovery=await reject(()=>backup.publishSnapshot(pending.id,null));
    const written=parse(await control.written());
    check(!written.length,'Revoked job wrote documents');
    const db=await openSmartFinDatabase();
    const counts={};
    for(const table of ['accounts','transactions','installment_purchases','subscription_occurrences','shared_expenses','ai_command_drafts'])
      counts[table]=rowsOf((await db.executeSql(`SELECT count(*) AS n FROM ${table}`))[0])[0].n;
    check(!counts.accounts&&!counts.transactions&&!counts.installment_purchases&&!counts.shared_expenses,'Deleted data reactivated: '+JSON.stringify(counts));
    await preserve(control,external);
    return {errors,written,counts};
  });
  let g2;
  await record('new-epoch-generation-current-old-stays-historical',async()=>{
    const f=await integratedFixture(await openSmartFinDatabase(),service());
    await f.save({amount:5000,merchantName:'New epoch'});
    g2=await publish(backup,owned);
    const status=await backup.getBackupStatus(0);
    check(status.generationId===g2.job.id&&status.datasetCurrency==='current','New generation not current');
    // Without the newest manifest, discovery falls back to G1: never presented as current.
    await control.damage(g2.job.id,'manifest','delete');
    const fallback=await backup.getBackupStatus(0);
    await control.restoreDamage();
    check(fallback.generationId===g1.job.id&&fallback.datasetCurrency==='historical','Obsolete generation presented current: '+JSON.stringify(fallback));
    await preserve(control,external);
    return {status,fallback};
  });
  await record('missing-local-metadata-is-unknown-not-current',async()=>{
    await control.damage(g2.job.id,'manifest','delete');
    await control.damage(g1.job.id,'job','delete');
    const status=await backup.getBackupStatus(0);
    await control.restoreDamage();
    check(status.generationId===g1.job.id&&status.datasetCurrency==='unknown','Generation without local metadata not unknown: '+JSON.stringify(status));
    return status;
  });
  await record('all-table-integrity-after-epochs',async()=>parse(await control.liveEvidence()));
}

export async function runPhase5E5(campaign,deps){
  const baseRecord=deps.record;
  const record=(name,operation)=>baseRecord(name,async()=>{
    try{return await operation();}catch(e){throw e instanceof Error?e:Error('Driver error: '+JSON.stringify(e));}
  });
  deps={...deps,record};
  await deps.control.recoveryEnabled(false);
  await record('isolation',()=>deps.control.isolation());
  if(campaign.startsWith('phase5e5-recoverability-'))return recoverability(campaign,deps);
  if(campaign==='phase5e5-failures')return failures(deps);
  if(campaign==='phase5e5-epochs')return epochs(deps);
  throw Error('Unknown 5E.5 campaign');
}
