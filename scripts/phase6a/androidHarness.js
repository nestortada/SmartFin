/* global performance */
// Phase 6A synthetic APK campaigns: exact-cents monthly figures of the dashboard on Hermes.
// Compares production (getDashboardSummaryFromDb) with the frozen pre-6A copy on the same
// synthetic database, against the BigInt decimal reference, and renders the production
// MetricsGrid/NetWorthCard so the visible COP text can be read with uiautomator.
// Only the isolated test package and synthetic data.
import React from 'react';
import {View} from 'react-native';
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {getDashboardSummaryFromDb} from './src/modules/dashboard/useCases/getDashboardSummary';
import {formatCurrency} from './src/shared/utils/formatCurrency';
import {MetricsGrid} from './src/modules/dashboard/ui/components/MetricsGrid';
import {NetWorthCard} from './src/modules/dashboard/ui/components/NetWorthCard';
import {createSqliteSharedExpenseRepository} from './src/modules/transactions/repositories/sqliteSharedExpenseRepository';
import {createSharedExpenseApi} from './src/modules/transactions/useCases/createSharedExpenseApi';
import {PERSONAL_AMOUNT_SQL} from './src/modules/transactions/repositories/sharedFinancialProjectionSql';
import {TRANSACTION_DAY_SQL} from './src/shared/utils/transactionDate';
import {getDashboardSummaryFromDbPre6A} from './phase6aPre6A';
import {phase6AExpectedSummary} from './phase6aExpected';
import {PHASE6A_SCENARIOS,PHASE6A_INSERT_SQL,phase6aRowValues,exactMonthlyReference,centsText} from './phase6aScenarios';
import {representativeSeedStatements,REPRESENTATIVE_REFERENCE_DAY} from './representativeHistory';

const check=(value,message)=>{if(!value)throw Error(message);};
const rowsOf=r=>Array.from({length:r.rows.length},(_,i)=>r.rows.item(i));
const DATE=new Date('2026-10-24T12:00:00.000Z');
const MONTHLY=['monthlyIncome','monthlyExpenses','monthlySavings'];
const UNAFFECTED=['availableBalance','totalDebt','netWorth','recentTransactionCount','monthlyForgivenessLosses','monthlyLossReversals',
  'monthlyLossRecoveries','monthlyRecoveryReversals','monthlyNetLosses'];
const ACCOUNTS=`INSERT OR IGNORE INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES
  ('bank','Banco','bankAccount','active','COP',1000000.1,NULL,'2026-01-01','2026-01-01'),
  ('savings','Ahorro','savingsAccount','active','COP',2000.25,NULL,'2026-01-01','2026-01-01'),
  ('investment','Inversion','investment','active','COP',5000.35,NULL,'2026-01-01','2026-01-01'),
  ('card','Visa','creditCard','active','COP',0,400.15,'2026-01-01','2026-01-01'),
  ('loan','Prestamo','loan','active','COP',0,600.2,'2026-01-01','2026-01-01')`;
const PALETTE={background:'#f8f7fb',border:'rgba(35, 42, 65, 0.12)',card:'rgba(255, 255, 255, 0.78)',cardStrong:'rgba(255, 255, 255, 0.92)',
  danger:'#a93932',muted:'#686678',primary:'#2848ee',primarySoft:'rgba(61, 90, 254, 0.12)',secondary:'#5203d5',tertiary:'#007f3e',text:'#19191d'};

const pick=s=>Object.fromEntries([...MONTHLY,...UNAFFECTED].map(k=>[k,s[k]]));
const display=s=>Object.fromEntries([...MONTHLY,'netWorth','availableBalance','totalDebt'].map(k=>[k,formatCurrency(s[k],'COP')]));
// Shortest round-trip text: equals the decimal for canonical two-decimal doubles.
const text=s=>Object.fromEntries([...MONTHLY,'netWorth','availableBalance','totalDebt'].map(k=>[k,String(s[k])]));

async function insertRows(owned,rows){
  await owned(async db=>{
    await db.executeSql('DELETE FROM transactions');
    await db.executeSql(ACCOUNTS);
    // 50 rows x 8 bindings: below the 999-variable limit of SQLite 3.9.2.
    const head=PHASE6A_INSERT_SQL.split('VALUES')[0];
    for(let i=0;i<rows.length;i+=50){
      const chunk=rows.slice(i,i+50);
      await db.executeSql(`${head} VALUES ${chunk.map(()=>"(?, ?, 'COP', 'Synthetic 6A', ?, 'bank', ?, ?, ?, ?, ?)").join(',')}`,chunk.flatMap(phase6aRowValues));
    }
  });
}

function compareScenario(scenario,previous,next){
  const exact=scenario.path==='exact'?exactMonthlyReference(scenario):undefined;
  for(const key of UNAFFECTED)check(Object.is(next[key],previous[key]),`${scenario.name}: ${key} changed`);
  if(exact){
    for(const [field,cents] of [['monthlyIncome',exact.income],['monthlyExpenses',exact.expenses],['monthlySavings',exact.savings]])
      check(next[field]===Number(centsText(cents)),`${scenario.name}: ${field} ${next[field]} is not ${centsText(cents)}`);
  }else for(const field of MONTHLY)check(Object.is(next[field],previous[field]),`${scenario.name}: legacy ${field} changed`);
  return {path:scenario.path,rows:scenario.rows.length,
    expectedDecimal:exact&&{monthlyIncome:centsText(exact.income),monthlyExpenses:centsText(exact.expenses),monthlySavings:centsText(exact.savings)},
    previous:text(previous),next:text(next),previousDisplay:display(previous),nextDisplay:display(next),
    visibleChanges:[...MONTHLY,'netWorth','availableBalance','totalDebt'].filter(k=>formatCurrency(previous[k],'COP')!==formatCurrency(next[k],'COP'))};
}

async function precision({owned,record}){
  const database=await openSmartFinDatabase();
  const results={};
  for(const scenario of PHASE6A_SCENARIOS)
    await record(`precision-${scenario.name}`,async()=>{
      await insertRows(owned,scenario.rows);
      const previous=await getDashboardSummaryFromDbPre6A(database,DATE);
      const next=await getDashboardSummaryFromDb(database,DATE);
      return results[scenario.name]=compareScenario(scenario,previous,next);
    });
  await record('shared-expense-forgiveness-centavos',async()=>{
    await owned(async db=>{
      await db.executeSql('DELETE FROM transactions');
      await db.executeSql(ACCOUNTS);
      await db.executeSql("INSERT OR IGNORE INTO categories(id,name,type,macro_category,color) VALUES('food','Alimentacion','expense','food','#ffffff')");
    });
    const api=createSharedExpenseApi(createSqliteSharedExpenseRepository(database));
    const contactId=(await api.saveContact('person','Amiga 6A')).entityId;
    const created=await api.createPurchase('phase6a-purchase',{
      purchase:{accountId:'bank',amount:30000.15,categoryId:'food',merchantName:'Restaurante',operationType:'Débito',occurrence:{kind:'date',date:'2026-10-05'}},
      distribution:{mode:'amounts',personalAmount:15000.07,participants:[{contactId,amount:15000.08}]}});
    const overview=await api.getExpense(created.entityId);
    await api.forgiveParticipation('phase6a-forgive',{participationId:overview.participants[0].participationId,amount:1000.01,date:'2026-10-06'});
    await owned(async db=>{
      const rows=[['sh-inc-1','0.05'],['sh-inc-2','0.15'],['sh-inc-3','0.3']];
      for(const [id,amount] of rows)await db.executeSql(`INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at)
        VALUES (?,?,'COP','Ingreso 6A','2026-10-07','bank','income','inflow','posted','2026-10-07T12:00:00.000Z','2026-10-07T12:00:00.000Z')`,[id,Number(amount)]);
      await db.executeSql(`INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at)
        VALUES ('sh-exp',2250.33,'COP','Gasto 6A','2026-10-08','bank','expense','outflow','posted','2026-10-08T12:00:00.000Z','2026-10-08T12:00:00.000Z')`);
    });
    const previous=await getDashboardSummaryFromDbPre6A(database,DATE);
    const next=await getDashboardSummaryFromDb(database,DATE);
    for(const key of UNAFFECTED)check(Object.is(next[key],previous[key]),`shared: ${key} changed`);
    check(next.monthlyIncome===0.5&&next.monthlyExpenses===17250.4&&next.monthlyNetLosses===1000.01&&next.monthlySavings===Number(centsText(50n-1725040n-100001n)),'shared exact figures');
    const [fk]=await database.executeSql('PRAGMA foreign_key_check');
    check(fk.rows.length===0,'Foreign keys');
    return results.shared={previous:text(previous),next:text(next),previousDisplay:display(previous),nextDisplay:display(next)};
  });
}

async function centavos(size,{owned,record}){
  await record(`centavos-${size}`,async()=>{
    await owned(async db=>{
      for(const s of representativeSeedStatements(size))await db.executeSql(s);
      await db.executeSql("UPDATE transactions SET amount = amount + ((rowid * 7919) % 100) / 100.0 WHERE id LIKE 'rep-%'");
    });
    const database=await openSmartFinDatabase();
    const [m]=await database.executeSql(`SELECT DISTINCT substr(${TRANSACTION_DAY_SQL},1,7) AS m FROM transactions ORDER BY m`);
    const months=rowsOf(m).map(r=>r.m);
    const totals={months:months.length,identical:0,internalChange:0,visibleChange:0},visible=[];
    for(const month of months){
      const date=new Date(`${month}-15T17:00:00.000Z`);
      const previous=await getDashboardSummaryFromDbPre6A(database,date);
      const next=await getDashboardSummaryFromDb(database,date);
      const [r]=await database.executeSql(`SELECT type, ${PERSONAL_AMOUNT_SQL} AS amount FROM transactions WHERE status = 'posted' AND substr(${TRANSACTION_DAY_SQL}, 1, 7) = ?
        AND ((type = 'income' AND direction = 'inflow') OR (type = 'expense' AND direction = 'outflow'))`,[month]);
      const expected=phase6AExpectedSummary(previous,rowsOf(r));
      for(const key of [...MONTHLY,...UNAFFECTED])check(Object.is(next[key],expected[key]),`${month}: ${key} ${next[key]} != ${expected[key]}`);
      const changed=MONTHLY.filter(k=>!Object.is(next[k],previous[k]));
      if(!changed.length)totals.identical++;else totals.internalChange++;
      const shown=changed.filter(k=>formatCurrency(next[k],'COP')!==formatCurrency(previous[k],'COP'));
      if(shown.length){totals.visibleChange++;visible.push({month,previous:text(previous),next:text(next),previousDisplay:display(previous),nextDisplay:display(next)});}
    }
    return {...totals,visible};
  });
}

const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
async function performanceCampaign(size,{owned,record}){
  await record(`performance-${size}`,async()=>{
    await owned(async db=>{for(const s of representativeSeedStatements(size))await db.executeSql(s);});
    const database=await openSmartFinDatabase();
    const date=new Date(`${REPRESENTATIVE_REFERENCE_DAY}T17:00:00.000Z`);
    const runs={next:[],previous:[]};
    let next,previous;
    previous=await getDashboardSummaryFromDbPre6A(database,date);next=await getDashboardSummaryFromDb(database,date);
    for(let i=0;i<9;i++){
      for(const [name,fn] of i%2?[['previous',getDashboardSummaryFromDbPre6A],['next',getDashboardSummaryFromDb]]:[['next',getDashboardSummaryFromDb],['previous',getDashboardSummaryFromDbPre6A]]){
        const start=performance.now();const s=await fn(database,date);runs[name].push(performance.now()-start);
        if(name==='next')next=s;else previous=s;
      }
    }
    for(const key of [...MONTHLY,...UNAFFECTED])check(Object.is(next[key],previous[key]),`representative ${size}: ${key} changed`);
    const [c]=await database.executeSql('SELECT count(*) AS n, min(date) AS first, max(date) AS last FROM transactions');
    return {rows:c.rows.item(0),medianMs:{next:median(runs.next),previous:median(runs.previous)},runs,summary:pick(next),display:display(next)};
  });
}

function Phase6AMetrics({summary}){
  return <View style={{padding:16}}>
    <NetWorthCard availableBalance={summary.availableBalance} currency="COP" netWorth={summary.netWorth} palette={PALETTE}/>
    <MetricsGrid currency="COP" monthlyExpenses={summary.monthlyExpenses} monthlyIncome={summary.monthlyIncome}
      monthlySavings={summary.monthlySavings} palette={PALETTE} totalDebt={summary.totalDebt}/>
  </View>;
}

async function ui(name,{owned,record}){
  const scenario=PHASE6A_SCENARIOS.find(s=>s.name===name);
  check(scenario,'Unknown UI scenario');
  await record(`ui-${name}`,async()=>{
    await insertRows(owned,scenario.rows);
    const database=await openSmartFinDatabase();
    const previous=await getDashboardSummaryFromDbPre6A(database,DATE);
    const next=await getDashboardSummaryFromDb(database,DATE);
    const result=compareScenario(scenario,previous,next);
    // Rendered by Harness after the report; read with uiautomator by scripts/phase6a/ui.cjs.
    global.__phase6aUi=()=> <Phase6AMetrics summary={next}/>;
    console.log('SMARTFIN_6A_UI:'+JSON.stringify({scenario:name,next:text(next),display:display(next)}));
    return result;
  });
}

export async function runPhase6A(campaign,deps){
  const baseRecord=deps.record;
  const record=(name,operation)=>baseRecord(name,async()=>{
    try{return await operation();}catch(e){throw e instanceof Error?e:Error('Driver error: '+JSON.stringify(e));}
  });
  deps={...deps,record};
  await deps.control.recoveryEnabled(false);
  await record('isolation',()=>deps.control.isolation());
  await record('runtime',async()=>({api:deps.control.getConstants().api,hermes:!!global.HermesInternal,
    intl:formatCurrency(0.5,'COP')+'|'+formatCurrency(2.5,'COP')+'|'+formatCurrency(-0.5,'COP')+'|'+formatCurrency(0.49999999999999994,'COP')+'|'+formatCurrency(-0.49999999999999994,'COP')}));
  if(campaign==='phase6a-precision')return precision(deps);
  if(campaign.startsWith('phase6a-centavos-'))return centavos(Number(campaign.split('-').pop()),deps);
  if(campaign.startsWith('phase6a-performance-'))return performanceCampaign(Number(campaign.split('-').pop()),deps);
  if(campaign.startsWith('phase6a-ui-'))return ui(campaign.slice('phase6a-ui-'.length),deps);
  throw Error('Unknown 6A campaign');
}
