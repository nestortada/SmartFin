import { NativeModules } from 'react-native';
import { createSqliteAccountRepository } from './src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from './src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from './src/modules/creditCards/repositories/sqliteCreditCardRepository';
import * as reference from './baseline/phase3ACreditCardRelations';
import * as optimized from './src/modules/creditCards/useCases/creditCardTransactionRelations';
import { fixedClock, restoreClock, startProfile, stopProfile } from './SqlProfile';
import { seedReconciliation } from './ReconciliationFixture';
const now = new Date('2026-10-11T12:00:00.000Z');
const performance = global.performance;
const stats = values => { const sorted = [...values].sort((a,b)=>a-b); const mean=values.reduce((a,b)=>a+b,0)/values.length; return { median:sorted[Math.floor(sorted.length/2)],min:sorted[0],max:sorted[sorted.length-1],stddev:Math.sqrt(values.reduce((n,v)=>n+(v-mean)**2,0)/values.length) }; };
const bounded = async (operation,ms=60000) => { let timer; try { return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('CASE_TIMEOUT')),ms);})]); } finally {clearTimeout(timer);} };
export async function reconciliationCampaign({fixture,config,check}) {
 fixedClock(); const cases=[]; let stage='start';
 const dependencies = database => ({ accountRepository:createSqliteAccountRepository(database),transactionRepository:createSqliteTransactionRepository(database),creditCardRepository:createSqliteCreditCardRepository(database) });
 const setup = async (rows,shape) => {
  stage=`fixture ${rows} ${shape}`;
  const f=await fixture(true);
  stage='insert card';
  await f.database.executeSql("INSERT INTO accounts(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES('card','Visa','creditCard','active','COP',0,999,'2026-01-01','2026-01-01')");
  let seed=0;for(const sql of seedReconciliation(rows,shape)){stage=`seed ${++seed}: ${sql}`;await f.database.executeSql(sql);}
  return {...f,...dependencies(f.database),ids:[]};
 };
 const measure = async (f,implementation) => bounded(async()=>{
  startProfile(); const start=performance.now();
  const payment=implementation.registerCreditCardPayment({...dependencies(f.database),accountId:'card',sourceAccountId:'bank',amount:1000,currentDate:now});
  const readerStart=performance.now();const reader=f.accountRepository.getAccounts();
  const result=await payment;const operationMs=performance.now()-start;await reader;const readerMs=performance.now()-readerStart;
  const profile=stopProfile();f.ids.push(result.transaction.id);
  const reads=profile.sql.filter(q=>/FROM transactions(?:\s+INDEXED BY idx_transactions_date)?\s+(?:WHERE[\s\S]*?)?ORDER BY date DESC, created_at DESC/.test(q.sql));
  const begin=profile.sql.find(q=>/^BEGIN/.test(q.sql));const commit=profile.sql.find(q=>/^COMMIT/.test(q.sql));
  check(begin&&commit&&profile.sql.filter(q=>/^BEGIN|^COMMIT/.test(q.sql)).length===2,'one transaction');
  check(reads.length===2,'two consistent reconciliation reads');
  return {operationMs,readerMs,scopeMs:commit.endMs-begin.startMs,sqliteBridgeReadMs:reads.reduce((n,q)=>n+q.ms,0),transferredRows:reads.reduce((n,q)=>n+q.rows,0),mappingMs:profile.spans.filter(s=>/Mapping$/.test(s.name)).reduce((n,s)=>n+s.ms,0),calculationMs:profile.spans.filter(s=>s.name==='financialCalculation').reduce((n,s)=>n+s.ms,0),writeMs:profile.sql.filter(q=>/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/.test(q.sql)).reduce((n,q)=>n+q.ms,0),writes:profile.sql.filter(q=>/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/.test(q.sql)).length,lastRead:reads[reads.length-1]};
 });
 try {
  for(const rows of [1000,10000,100000]) for(const shape of ['noise','mixed']) {
   console.info(`Reconciliation benchmark ${rows} ${shape}`);
   const left=await setup(rows,shape);const right=await setup(rows,shape);
   try {
    const samples={reference:[],optimized:[]};
    for(let round=0;round<4;round++){
     const order=round%2===0?['reference','optimized']:['optimized','reference'];
     for(const version of order){stage=`measure ${rows} ${shape} ${version} round ${round}`;const sample=await measure(version==='reference'?left:right,version==='reference'?reference:optimized);if(round>0)samples[version].push(sample);}
    }
    stage=`compare ${rows} ${shape}`;
    const comparison=await bounded(()=>NativeModules.AtomicityReport.compareSyntheticDatabases(left.name,right.name,left.ids,right.ids),120000);
    check(comparison.equal,'every table, reference, audit and revision matches');
    const diagnostic={};
    for(const version of ['reference','optimized']){
     const f=version==='reference'?left:right;const last=samples[version][2].lastRead;
     stage=`diagnostic ${rows} ${shape} ${version}`;
     const nativeSQLite=await NativeModules.AtomicityReport.syntheticQueryTiming(f.name,last.sql,last.values);
     diagnostic[version]={plan:nativeSQLite.plan,nativeSQLite};
    }
    const cycles=[];
    for(const date of ['2026-09-30T23:59:59.000Z','2026-10-16T05:00:00.000Z','2026-11-01T05:00:00.000Z']){
     stage=`cycle ${rows} ${shape} ${date}`;
     await reference.reconcileCreditCardTransactions({...dependencies(left.database),currentDate:new Date(date)});
     await optimized.reconcileCreditCardTransactions({...dependencies(right.database),currentDate:new Date(date)});
     const same=await bounded(()=>NativeModules.AtomicityReport.compareSyntheticDatabases(left.name,right.name,left.ids,right.ids),120000);check(same.equal,'cycle exact equivalence');cycles.push({date,equal:true});
    }
    for(const f of [left,right]){const [fk]=await f.database.executeSql('PRAGMA foreign_key_check');const [integrity]=await f.database.executeSql('PRAGMA integrity_check');check(!fk.rows.length&&integrity.rows.item(0).integrity_check==='ok','integrity');}
    const distributions={};for(const version of ['reference','optimized']){distributions[version]={};for(const metric of ['operationMs','readerMs','scopeMs','sqliteBridgeReadMs','transferredRows','mappingMs','calculationMs','writeMs'])distributions[version][metric]=stats(samples[version].map(s=>s[metric]));}
    cases.push({name:`${rows} ${shape}`,passed:true,rows,shape,warmups:1,measuredSamples:3,samples,distributions,diagnostic,comparison,cycles});
   }finally{await left.database.close();await right.database.close();}
  }
  return {config,campaign:'phase3a1',cases,passed:cases.every(c=>c.passed),method:'paired alternating versions; 1 warm-up + 3 measured samples; fixed JS/SQL audit clocks; exact native streaming comparison'};
 }catch(error){throw new Error(JSON.stringify({campaign:'phase3a1',passed:false,cases,stage,error: error instanceof Error ? {message:error.message,stack:error.stack} : error}));}
 finally{stopProfile();restoreClock();}
}
