import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState } from './helpers/financialState';
import * as previous from './helpers/phase3ACreditCardRelations';
import * as current from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { readCreditCardReconciliationTransactions } from '../src/modules/creditCards/repositories/readCreditCardReconciliationTransactions';
import { transactionDateKey } from '../src/shared/utils/transactionDate';
const { seedReconciliation } = require('../scripts/androidAtomicityPhase3A1/ReconciliationFixture') as { seedReconciliation:(rows:number,shape?:string)=>string[] };
const { performance: monotonic } = require('node:perf_hooks') as { performance:{now:()=>number} };
const evidence: unknown[]=[];
// 6B.1 changed only the arithmetic of the derived card debt and statement figures (exact cents for
// two-decimal amounts). Those cells are checked against an independent BigInt oracle below; every
// other cell still has to equal the frozen 3A.1 oracle bit for bit.
const DERIVED_6B1:Record<string,string[]>={accounts:['debt_balance_amount'],credit_card_statements:['total_amount','minimum_payment_amount','status']};
let derivedCellsChanged=0,fallbackCells=0;
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
     if(DERIVED_6B1[table]?.includes(key)){if(!Object.is(original[key],currentRow[key]))derivedCellsChanged++;continue;}
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
const textCents=(amount:number)=>{const m=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount));if(!m)throw new Error(`Not two decimals: ${amount}`);const c=BigInt(m[2]!)*100n+BigInt((m[3]??'').padEnd(2,'0'));return m[1]?-c:c;};
const centsNumber=(cents:bigint)=>{const a=cents<0n?-cents:cents;return Number(`${cents<0n?'-':''}${a/100n}.${(a%100n).toString().padStart(2,'0')}`);};
// Exact path only while every sum stays a safe integer of cents and the result is below 2^46 COP.
const SAFE=BigInt(Number.MAX_SAFE_INTEGER),LIMIT=BigInt(2**46)*100n;
const exactPath=(plus:bigint,minus:bigint)=>plus<=SAFE&&minus<=SAFE&&(plus-minus<0n?minus-plus:plus-minus)<LIMIT;
/**
 * BigInt oracle of every active card debt and stored statement, from the full candidate history.
 * Beyond the exact range 6B.1 keeps the previous binary result: there the cell must equal the frozen
 * 3A.1 reference bit for bit.
 */
async function expectExactDerived(f:Awaited<ReturnType<typeof setup>>,reference:Awaited<ReturnType<typeof setup>>){
 const referenceCell=(sql:string,values:string[])=>reference.query(sql,values).rows.raw()[0];
 const cards=f.query("SELECT id,debt_balance_amount FROM accounts WHERE type='creditCard' AND status='active'").rows.raw();
 const ids=cards.map(c=>String(c.id));
 const candidates=await readCreditCardReconciliationTransactions(f.transactionRepository,ids);
 const installments=f.query('SELECT transaction_id,installment_count,monthly_amount,status FROM installment_purchases').rows.raw();
 const debts:Record<string,number>={};
 for(const card of cards){
  const id=String(card.id);
  const purchases=candidates.filter(t=>t.accountId===id&&t.status!=='cancelled'&&t.direction==='outflow'&&t.type==='expense');
  const payments=candidates.filter(t=>t.status!=='cancelled'&&t.type==='creditCardPayment'&&(t.targetAccountId===id||t.accountId===id));
  const plus=purchases.reduce((s,t)=>s+textCents(t.amount),0n),minus=payments.reduce((s,t)=>s+textCents(t.amount),0n);
  const debt=plus-minus;
  const expectedDebt=exactPath(plus,minus)?centsNumber(debt<0n?0n:debt)
   :referenceCell('SELECT debt_balance_amount AS v FROM accounts WHERE id=?',[id])!.v;
  if(!exactPath(plus,minus))fallbackCells++;
  expect(Object.is(card.debt_balance_amount,expectedDebt)).toBe(true);
  debts[id]=Number(card.debt_balance_amount);
  for(const st of f.query('SELECT id,statement_start_date AS s,statement_end_date AS e,total_amount,minimum_payment_amount,status FROM credit_card_statements WHERE account_id=?',[id]).rows.raw()){
   const inRange=(t:typeof candidates[number])=>{const d=transactionDateKey(t).slice(0,10);return d>=String(st.s)&&d<=String(st.e);};
   const charges=purchases.filter(inRange).reduce((s,t)=>{const i=installments.find(x=>x.transaction_id===t.id);return s+(i&&Number(i.installment_count)>1&&i.status==='active'?textCents(Number(i.monthly_amount)):textCents(t.amount));},0n);
   const paid=payments.filter(inRange).reduce((s,t)=>s+textCents(t.amount),0n);
   const total=charges-paid;
   if(!exactPath(charges,paid)){
    fallbackCells++;
    expect(referenceCell('SELECT total_amount,minimum_payment_amount,status FROM credit_card_statements WHERE id=?',[String(st.id)]))
     .toEqual({total_amount:st.total_amount,minimum_payment_amount:st.minimum_payment_amount,status:st.status});
    continue;
   }
   const exactTotal=centsNumber(total<0n?0n:total);
   expect([Object.is(st.total_amount,exactTotal),st.minimum_payment_amount,st.status]).toEqual([true,Math.round(exactTotal*0.1),charges>0n?(total>0n?'pending':'paid'):'open']);
  }
 }
 return debts;
}
const withoutDerived=(s:Record<string,unknown>)=>({...s,debt:undefined,wealth:undefined});
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
   derivedCellsChanged=0;fallbackCells=0;
   const oldStart=monotonic.now();const oldPayment=await previous.registerCreditCardPayment({...reference,accountId:'card',sourceAccountId:'bank',amount:100000,currentDate:FINANCIAL_TEST_DATE});const oldMs=monotonic.now()-oldStart;
   const start=monotonic.now();const payment=await current.registerCreditCardPayment({...f,accountId:'card',sourceAccountId:'bank',amount:100000,currentDate:FINANCIAL_TEST_DATE});const optimizedMs=monotonic.now()-start;
   expect(withoutDerived(await f.snapshot())).toEqual(withoutDerived(await reference.snapshot()));
   const comparedRows=compareAllTables(reference,f,oldPayment.transaction.id,payment.transaction.id);
   const debts=await expectExactDerived(f,reference);
   expect((await f.snapshot()).debt).toBe(debts.card);
   expect(Object.is(payment.remainingDebt,debts.card)).toBe(true);
   expect({...payment,previousDebt:undefined,remainingDebt:undefined,transaction:{...payment.transaction,id:'$payment'}}).toEqual({...oldPayment,previousDebt:undefined,remainingDebt:undefined,transaction:{...oldPayment.transaction,id:'$payment'}});
   for(const date of ['2026-09-30T23:59:59.000Z','2026-10-16T05:00:00.000Z','2026-11-01T05:00:00.000Z']){
    jest.setSystemTime(FINANCIAL_TEST_DATE);
    await previous.reconcileCreditCardTransactions({...reference,currentDate:new Date(date)});
    await current.reconcileCreditCardTransactions({...f,currentDate:new Date(date)});
    compareAllTables(reference,f,oldPayment.transaction.id,payment.transaction.id);
    await expectExactDerived(f,reference);
    expect(f.query('PRAGMA integrity_check').rows.raw()).toEqual([{integrity_check:'ok'}]);
    expect(f.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
   }
   evidence.push({rows,shape,candidates:candidates.length,fullRows:all.length,oldMs,optimizedMs,exactTables:true,comparedRows,cycles:4,derivedCellsChanged6B1:derivedCellsChanged,binaryFallbackChecks6B1:fallbackCells});
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
