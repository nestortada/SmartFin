import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState } from './helpers/financialState';
import * as previous from './helpers/phase3ACreditCardRelations';
import * as current from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { readCreditCardReconciliationTransactions } from '../src/modules/creditCards/repositories/readCreditCardReconciliationTransactions';
const { seedReconciliation } = require('../scripts/androidAtomicityPhase3A1/ReconciliationFixture') as { seedReconciliation:(rows:number,shape?:string)=>string[] };
const { performance: monotonic } = require('node:perf_hooks') as { performance:{now:()=>number} };
const evidence: unknown[]=[];
jest.mock('react-native-sqlite-storage',()=>({enablePromise:jest.fn()}));
beforeEach(()=>{jest.useFakeTimers({doNotFake:['nextTick','queueMicrotask','setImmediate','setTimeout']});jest.setSystemTime(FINANCIAL_TEST_DATE);});
afterEach(()=>jest.useRealTimers());
afterAll(()=>{
 const fs=require('node:fs') as {writeFileSync:(p:string,v:string)=>void};
 fs.writeFileSync('docs/atomicidad-fase3a1/node-equivalence.json',JSON.stringify(evidence,null,2));
});
async function setup(rows:number,shape:string){
 const f=await financialIntegrityFixture({managed:true});
 for(const sql of seedReconciliation(rows,shape))f.native.exec(sql);
 return f;
}
function compareAllTables(left:Awaited<ReturnType<typeof financialIntegrityFixture>>,right:Awaited<ReturnType<typeof financialIntegrityFixture>>,leftId?:string,rightId?:string){
 const names=(f:typeof left)=>f.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").rows.raw().map(row=>String(row.name));
 expect(names(left)).toEqual(names(right));
 const counts:Record<string,number>={};
 for(const table of names(left)){
  const quoted='"'+table.replace(/"/g,'""')+'"';
  const a=left.native.prepare(`SELECT rowid AS __oracle_rowid,* FROM ${quoted} WHERE rowid > ? ORDER BY rowid LIMIT 1000`);
  const b=right.native.prepare(`SELECT rowid AS __oracle_rowid,* FROM ${quoted} WHERE rowid > ? ORDER BY rowid LIMIT 1000`);
  let count=0;let leftCursor=Number.MIN_SAFE_INTEGER;let rightCursor=Number.MIN_SAFE_INTEGER;
  for(;;){
   const before=a.all(leftCursor);const after=b.all(rightCursor);
   if(before.length!==after.length)throw new Error(`Different row count: ${table}`);
   for(let index=0;index<before.length;index++){
    const original=before[index]!;const currentRow=after[index]!;
    const keys=Object.keys(original);
    if(keys.length!==Object.keys(currentRow).length)throw new Error(`Different columns: ${table}`);
    for(const key of keys){
     const expected=leftId!==undefined&&original[key]===leftId?'$payment':original[key];
     const actual=rightId!==undefined&&currentRow[key]===rightId?'$payment':currentRow[key];
     if(!Object.is(expected,actual))throw new Error(`Financial mismatch: ${table}, row ${count+index}, ${key}`);
    }
   }
   count+=before.length;if(before.length<1000)break;
   leftCursor=Number(before[before.length-1]!.__oracle_rowid);rightCursor=Number(after[after.length-1]!.__oracle_rowid);
  }
  counts[table]=count;
 }
 return counts;
}
test.each([1000,10000,100000])('%s rows: exact complete payment/reconciliation equivalence and ordered candidates',async rows=>{
 for(const shape of ['noise','mixed','dense']){
  const f=await setup(rows,shape); const reference=await setup(rows,shape);
  try{
   const active=['card','card2'];
   const all=await reference.transactionRepository.getTransactions();
   const expected=all.filter(t=>t.status!=='cancelled'&&((t.type==='expense'&&t.direction==='outflow'&&active.includes(t.accountId))||(t.type==='creditCardPayment'&&(active.includes(t.accountId)||active.includes(t.targetAccountId??'')))));
   const candidates=await readCreditCardReconciliationTransactions(f.transactionRepository,active);
   expect(candidates.map(t=>[t.id,t.amount,t.date,t.civilDate])).toEqual(expected.map(t=>[t.id,t.amount,t.date,t.civilDate]));
   // Deliberately stale debt is reconciled before the cap/funds validation.
   compareAllTables(reference,f);
   expect(await f.snapshot()).toEqual(await reference.snapshot());
   const oldStart=monotonic.now();const oldPayment=await previous.registerCreditCardPayment({...reference,accountId:'card',sourceAccountId:'bank',amount:100000,currentDate:FINANCIAL_TEST_DATE});const oldMs=monotonic.now()-oldStart;
   const start=monotonic.now();const payment=await current.registerCreditCardPayment({...f,accountId:'card',sourceAccountId:'bank',amount:100000,currentDate:FINANCIAL_TEST_DATE});const optimizedMs=monotonic.now()-start;
   expect(await f.snapshot()).toEqual(await reference.snapshot());
   const comparedRows=compareAllTables(reference,f,oldPayment.transaction.id,payment.transaction.id);
   expect({...payment,transaction:{...payment.transaction,id:'$payment'}}).toEqual({...oldPayment,transaction:{...oldPayment.transaction,id:'$payment'}});
   for(const date of ['2026-09-30T23:59:59.000Z','2026-10-16T05:00:00.000Z','2026-11-01T05:00:00.000Z']){
    jest.setSystemTime(FINANCIAL_TEST_DATE);
    await previous.reconcileCreditCardTransactions({...reference,currentDate:new Date(date)});
    await current.reconcileCreditCardTransactions({...f,currentDate:new Date(date)});
    compareAllTables(reference,f,oldPayment.transaction.id,payment.transaction.id);
    expect(f.query('PRAGMA integrity_check').rows.raw()).toEqual([{integrity_check:'ok'}]);
    expect(f.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
   }
   evidence.push({rows,shape,candidates:candidates.length,fullRows:all.length,oldMs,optimizedMs,exactTables:true,comparedRows,cycles:4});
  }finally{f.native.close();reference.native.close();}
 }
},120000);
test('more than 300 active cards respects API 24 parameter limits and every candidate',async()=>{
 const f=await setup(1000,'mixed');
 try{
  const ids=['card','card2',...Array.from({length:400},(_,n)=>`extra-${n}`)];
  const candidates=await readCreditCardReconciliationTransactions(f.transactionRepository,ids);
  const all=await f.transactionRepository.getTransactions();
  const relevant=(t:typeof candidates[number])=>t.status!=='cancelled'&&((t.type==='expense'&&t.direction==='outflow'&&ids.includes(t.accountId))||(t.type==='creditCardPayment'&&(ids.includes(t.accountId)||ids.includes(t.targetAccountId??''))));
  expect(candidates.filter(relevant).map(t=>t.id)).toEqual(all.filter(relevant).map(t=>t.id));
 }finally{f.native.close();}
});
test('legacy empty civil dates, zero/negative amounts and floating-point cancellation preserve exact sums',async()=>{
 const f=await setup(0,'noise');const reference=await setup(0,'noise');
 try{
  for(const fixture of [f,reference]){
   fixture.native.exec("DELETE FROM transactions WHERE id LIKE 'seed-%'");
   const insert=fixture.native.prepare("INSERT INTO transactions(id,amount,currency,description,date,civil_date,account_id,type,direction,status,created_at,updated_at) VALUES(?,?,'COP','Legacy','2026-10-10','','card','expense','outflow','pending','tie','tie')");
   [1e16,0.1,-1e16,0.2,0,-0.3,250000.25].forEach((amount,index)=>insert.run(`edge-${index}`,amount));
  }
  await previous.reconcileCreditCardTransactions({...reference,currentDate:FINANCIAL_TEST_DATE});
  await current.reconcileCreditCardTransactions({...f,currentDate:FINANCIAL_TEST_DATE});
  const expected=await financialState(reference);const actual=await financialState(f);
  expect(actual).toEqual(expected);
 }finally{f.native.close();reference.native.close();}
});
