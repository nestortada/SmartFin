// Phase 5E.6 synthetic APK campaigns: CSV precision and annual order through the production
// exporter (SmartFinBackupCsv) on private copies, and re-export of earlier generations'
// databases pushed by adb. Only the isolated test package and synthetic data.
import {integratedFixture, buildIntegratedScenario} from './scripts/phase5e/integration';
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {captureLocalDatabaseSnapshot} from './src/modules/settings/services/localDatabaseSnapshot';
import {createSubscriptionReminderService} from './src/modules/subscriptions/services/androidSubscriptionReminderService';
import {representativeSeedStatements} from './representativeHistory';
import {PRECISION_VALUES, ORDER_ROWS, bitsOf, randomDoubles} from './phase5e6Probes';

const check=(value,message)=>{if(!value)throw Error(message);};
const parse=JSON.parse;

async function probe({owned,record,control,backup}){
  await control.evidenceClear();
  await openSmartFinDatabase();
  await control.configureSaf();
  let generation;
  await record('stable-integrated-scenario-1000-and-g1',async()=>{
    const f=await integratedFixture(await openSmartFinDatabase(),createSubscriptionReminderService());
    await buildIntegratedScenario(f,{reminders:'stable'});
    await owned(async db=>{for(const s of representativeSeedStatements(1000))await db.executeSql(s);});
    const job=parse(await backup.preparePublication());
    const captured=await captureLocalDatabaseSnapshot(job.id);
    const published=parse(await backup.publishSnapshot(job.id,captured.snapshot.id));
    check(published.state==='verified','G1 not verified');
    generation=job.id;
    return {id:job.id,revision:published.revision,snapshot:captured.snapshot.sha256};
  });
  await record('export-g1',async()=>parse(await control.exportGeneration(generation,'probe-generation')));
  await record('precision-and-order-through-production-exporter',async()=>{
    const result=await control.phase5e6Probe(generation,JSON.stringify({values:PRECISION_VALUES.map(v=>bitsOf(v.value)),orderRows:ORDER_ROWS,random:randomDoubles(5000).map(bitsOf)}));
    await control.evidenceWrite('phase5e6-probe/result.json',result);
    const value=parse(result);
    return {sqlite:value.sqlite,stored:value.stored.length,files:Object.keys(value.csv).length,previousOrder:value.previousOrder,fixedOrder:value.fixedOrder};
  });
  await control.evidenceWrite('probe-summary.json',JSON.stringify({campaign:'phase5e6-probe',g1:generation,api:control.getConstants().api}));
}

async function reexport({record,control}){
  await control.evidenceClear();
  for(const label of ['api24','api35'])
    await record('reexport-'+label,async()=>{
      const result=await control.phase5e6Reexport(label);
      await control.evidenceWrite(`reexport/${label}/result.json`,result);
      return Object.fromEntries(Object.entries(parse(result)).map(([k,v])=>[k,{sha256:v.sha256,current:v.current.ms,previous:v.previous.ms}]));
    });
}

export async function runPhase5E6(campaign,deps){
  const baseRecord=deps.record;
  const record=(name,operation)=>baseRecord(name,async()=>{
    try{return await operation();}catch(e){throw e instanceof Error?e:Error('Driver error: '+JSON.stringify(e));}
  });
  deps={...deps,record};
  await deps.control.recoveryEnabled(false);
  await record('isolation',()=>deps.control.isolation());
  if(campaign==='phase5e6-probe')return probe(deps);
  if(campaign==='phase5e6-reexport')return reexport(deps);
  throw Error('Unknown 5E.6 campaign');
}
