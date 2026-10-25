/* global performance */
// Phase 5E.2 synthetic APK campaigns. Only the isolated test package and its
// synthetic database; seeds by SQL and never uses a real financial database.
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {getSQLiteTransactionHistoryPage as current} from './src/modules/transactions/repositories/sqliteTransactionHistory';
import {rowToTransaction,createSqliteTransactionRepository} from './src/modules/transactions/repositories/sqliteTransactionRepository';
import {createSqliteAccountRepository} from './src/modules/accounts/repositories/sqliteAccountRepository';
import {createSqliteSharedExpenseRepository} from './src/modules/transactions/repositories/sqliteSharedExpenseRepository';
import {getDashboardSummaryFromDb} from './src/modules/dashboard/useCases/getDashboardSummary';
import {getSQLiteTransactionHistoryPage as frozen} from './history5E1';
import {getBaselineDashboardSummaryFromDb} from './dashboardBaseline';
import {historySeedStatements} from './historyDistributionSql';
import {baselineHistory} from './historyBaseline';

const check=(value,message)=>{if(!value)throw Error(message);};
// EXPLAIN through some Android drivers fails with SQLITE_ROW: record the error instead.
async function explain(database,sql,values=[]){
  try{const [p]=await database.executeSql('EXPLAIN QUERY PLAN '+sql,values);return Array.from({length:p.rows.length},(_,i)=>p.rows.item(i).detail);}
  catch(e){return ['EXPLAIN unavailable: '+(e?.message??String(e))];}
}
const base={month:'all',accountId:'all',categoryId:'all',search:'',sort:'newest'};
const CASES=[
  ['newest',base],
  ['oldest',{...base,sort:'oldest'}],
  ['search49',{...base,search:'merchant 49'}],
  ['unicode',{...base,search:'árbol'}],
  ['absent',{...base,search:'not found'}],
  ['combined',{...base,month:'2024-02',accountId:'bank',categoryId:'food',search:'%_',sort:'oldest'}],
];
// Distributions whose 5E.1 first page needs minutes at 100k on HONOR.
const SLOW=new Set(['legacyTied','mixed','legacyWithCivil','legacyDay']);
const VERSIONS={'5E.1':frozen,'5E.2':current};
const heap=()=>{try{const s=global.HermesInternal?.getInstrumentedStats?.();return s?{allocated:s.js_allocatedBytes,heap:s.js_heapSize}:undefined;}catch{return undefined;}};

function instrumented(database){
  const m={statements:0,rows:0,sqlAwaitMs:0,queries:[]};
  const proxy=new Proxy(database,{get(target,key){
    if(key!=='executeSql')return Reflect.get(target,key);
    return async(sql,values=[])=>{
      const start=performance.now();
      try{const result=await target.executeSql(sql,values);m.statements++;m.rows+=result[0].rows.length;
        if(m.queries.length<12)m.queries.push({sql,values});return result;}
      finally{m.sqlAwaitMs+=performance.now()-start;}
    };
  }});
  return {proxy,m};
}

async function measurePage(database,version,query){
  // A new proxy is a new connection identity: cold proof and miss caches.
  const {proxy,m}=instrumented(database);
  const before=heap();
  const start=performance.now();
  const first=await VERSIONS[version](proxy,rowToTransaction,query);
  const firstMs=performance.now()-start;
  const after=heap();
  const firstStatements=m.statements,firstRows=m.rows,firstSqlAwaitMs=m.sqlAwaitMs;
  let second,secondMs;
  if(first.nextCursor){const s=performance.now();second=await VERSIONS[version](proxy,rowToTransaction,query,first.nextCursor);secondMs=performance.now()-s;}
  return {pages:[first.transactions,second?.transactions],cursorKind:first.nextCursor?(first.nextCursor.legacyIds?'legacy':'keyset'):'end',
    metrics:{firstMs,firstStatements,firstRows,firstSqlAwaitMs,firstJsAndBridgeRestMs:firstMs-firstSqlAwaitMs,secondMs,
      secondStatements:m.statements-firstStatements,secondRows:m.rows-firstRows,legacyIds:first.nextCursor?.legacyIds?.length??0,
      heapAllocatedDelta:before&&after?after.allocated-before.allocated:undefined,heapSizeAfter:after?.heap},queries:m.queries};
}

// Exact oracle independent of SQLite ordering: all rows, the SQL key/created_at/rowid
// order computed in JS (ASCII fixtures: JS order equals BINARY), then the frozen
// hook semantics with civil keys projected explicitly (as in the 5E.1 harness).
async function oracle(database){
  const [r]=await database.executeSql('SELECT rowid AS history_rowid, * FROM transactions');
  const rows=Array.from({length:r.rows.length},(_,i)=>r.rows.item(i));
  const key=row=>row.civil_date?`${row.civil_date}T${row.local_time??'00:00'}:00.000Z`:row.date;
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  rows.sort((a,b)=>cmp(key(b),key(a))||cmp(b.created_at,a.created_at)||b.history_rowid-a.history_rowid);
  const transactions=rows.map(rowToTransaction);
  const byId=new Map(transactions.map(tx=>[tx.id,tx]));
  const normalized=transactions.map(tx=>({...tx,date:tx.civilDate?`${tx.civilDate}T${tx.localTime??'00:00'}:00.000Z`:tx.date}));
  return query=>baselineHistory(normalized,query.month,query.accountId,query.categoryId,query.search,query.sort).map(tx=>byId.get(tx.id));
}

// 5E.2 must equal the oracle on every page without duplicates or omissions. 5E.1 is
// walked in lockstep and its agreement recorded: on SQLite 3.9.2 it can misorder ties.
async function traverse(database,query,expected,{maxPages=0,withFrozen=true}={}){
  const want=expected(query);
  let b=await current(database,rowToTransaction,query);
  let a=withFrozen?await frozen(database,rowToTransaction,query):undefined;
  let pages=0,total=0,frozenAgrees=withFrozen?true:undefined;const seen=new Set();
  for(;;){
    check(JSON.stringify(b.transactions)===JSON.stringify(want.slice(total,total+50)),'5E.2 page differs from oracle at '+total+' '+JSON.stringify(query));
    if(a&&JSON.stringify(a.transactions)!==JSON.stringify(b.transactions))frozenAgrees=false;
    for(const tx of b.transactions){check(!seen.has(tx.id),'Duplicate '+tx.id);seen.add(tx.id);}
    total+=b.transactions.length;pages++;
    if(!b.nextCursor||(maxPages&&pages>=maxPages))break;
    b=await current(database,rowToTransaction,query,b.nextCursor);
    if(a)a=a.nextCursor?await frozen(database,rowToTransaction,query,a.nextCursor):{transactions:[]};
  }
  const complete=!b.nextCursor;
  // A keyset search may end with one empty page after the last match (5E.1 behaviour).
  if(complete)check(total===want.length,'Omitted records: '+total+'/'+want.length);
  if(a&&complete&&a.nextCursor)frozenAgrees=false;
  return {pages,total,expected:want.length,complete,frozenAgrees};
}

async function history(campaign,{owned,record,control}){
  const [,distribution,sizeText]=/^phase5e2-history-([A-Za-z]+)-(\d+)$/.exec(campaign)??[];
  const size=Number(sizeText);
  check(distribution&&[1000,10000,100000].includes(size),'Unexpected campaign');
  const database=await openSmartFinDatabase();
  await record('seed',async()=>{
    const start=performance.now();
    await owned(async db=>{for(const statement of historySeedStatements(distribution,size))await db.executeSql(statement);});
    const [r]=await database.executeSql('SELECT count(*) AS n, sqlite_version() AS v FROM transactions');
    check(r.rows.item(0).n===size,'Seed count');
    return {distribution,size,sqlite:r.rows.item(0).v,seedMs:performance.now()-start};
  });
  const slowOld=size>=100000&&SLOW.has(distribution);
  const expected=await oracle(database);
  for(const [name,query] of CASES){
    await record(`${distribution}-${size}-${name}-samples`,async()=>{
      const samples=[];let plans;
      // Warmup round, then alternate the order. Slow 5E.1 cases: one cold sample in the middle.
      const schedule=slowOld?[['5E.2','w'],['5E.2',0],['5E.1',0],['5E.2',1],['5E.2',2]]
        :[['5E.1','w'],['5E.2','w'],['5E.1',0],['5E.2',0],['5E.2',1],['5E.1',1],['5E.1',2],['5E.2',2]];
      const want=expected(query);
      let frozenAgrees=true;
      for(const [version,sample] of schedule){
        const result=await measurePage(database,version,query);
        // 5E.2 is exact against the oracle; 5E.1 agreement is recorded (3.9.2 tie defect).
        const exact=JSON.stringify(result.pages[0])===JSON.stringify(want.slice(0,50))
          &&(result.pages[1]===undefined||JSON.stringify(result.pages[1])===JSON.stringify(want.slice(50,100)));
        if(version==='5E.2')check(exact,'5E.2 sample differs from oracle: '+name);
        else if(!exact)frozenAgrees=false;
        if(!plans&&version==='5E.2'&&sample==='w'){
          plans=[];
          for(const q of result.queries){
            plans.push({sql:q.sql.replace(/\s+/g,' ').slice(0,240),plan:await explain(database,q.sql,q.values)});
          }
        }
        samples.push({version,sample,cursorKind:result.cursorKind,warmup:sample==='w',...result.metrics});
      }
      const oldPlans=[];
      if(!slowOld){
        const r=await measurePage(database,'5E.1',query);
        for(const q of r.queries.slice(0,4)){
          oldPlans.push({sql:q.sql.replace(/\s+/g,' ').slice(0,240),plan:await explain(database,q.sql,q.values)});
        }
      }
      return {query,samples,plans5E2:plans,plans5E1:oldPlans,slowOld,matches:want.length,frozenFirstPageAgrees:frozenAgrees};
    });
  }
  for(const [name,query] of CASES){
    await record(`${distribution}-${size}-${name}-exact-traversal`,async()=>{
      // 100k: complete 5E.2 traversals where pages are cheap; slow 5E.1 compatibility only
      // in lockstep for its first pages. Large tie groups sort the group on every page.
      if(size<=10000)return traverse(database,query,expected);
      if(!slowOld)return traverse(database,query,expected,{withFrozen:true});
      const tied=distribution==='legacyTied';
      return {lockstep:await traverse(database,query,expected,{maxPages:3}),
        complete:await traverse(database,query,expected,{maxPages:tied?40:0,withFrozen:false})};
    });
  }
  if(size===1000&&distribution==='legacyDay'){
    await record('legacy-keyset-revision-cancellation-concurrency-empty',async()=>{
      const first=await current(database,rowToTransaction,base);
      check(first.nextCursor&&!first.nextCursor.legacyIds,'Date-only history did not use keyset path');
      let cancelled=false;try{await current(database,rowToTransaction,base,first.nextCursor,()=>true);}catch(e){cancelled=String(e).includes('cancelada');}
      check(cancelled,'Cancellation');
      let injected=false;
      const concurrent=new Proxy(database,{get(target,key){
        if(key!=='executeSql')return Reflect.get(target,key);
        return async(sql,values=[])=>{const value=await target.executeSql(sql,values);
          if(sql.includes('history_rowid')&&!injected){injected=true;await owned(db=>db.executeSql("UPDATE transactions SET notes='Concurrent' WHERE id='history-2'"));}
          return value;};
      }});
      let mixed=false;try{await current(concurrent,rowToTransaction,base);}catch(e){mixed=String(e).includes('cambió');}
      check(mixed,'Concurrent write published mixed revision');
      let invalid=false;try{await current(database,rowToTransaction,base,first.nextCursor);}catch(e){invalid=String(e).includes('cambió');}
      check(invalid,'Revision invalidation');
      await owned(db=>db.executeSql("UPDATE transactions SET date='invalid' WHERE id='history-3'"));
      const legacy=await current(database,rowToTransaction,base);
      check(legacy.nextCursor?.legacyIds,'Invalid date did not return to compatibility path');
      const exact=await traverse(database,base,await oracle(database));
      await owned(db=>db.executeSql('DELETE FROM transactions'));
      const empty=await current(database,rowToTransaction,base);
      check(!empty.transactions.length&&!empty.nextCursor,'Empty history');
      return {cancelled,mixed,invalid,exact};
    });
  }
  await record('all-table-integrity-after-history',async()=>JSON.parse(await control.liveEvidence()));
}

const LOADS={
  integratedToday:"'2026-10-24'",
  legacySpread:"date('2023-10-25', '+' || ((n * 37) % 1096) || ' days')",
  canonicalSpread:"strftime('%Y-%m-%dT%H:%M:%f', date('2023-10-25', '+' || ((n * 37) % 1096) || ' days'), '+' || (n % 86400) || ' seconds') || 'Z'",
};
const DATE=new Date('2026-10-24T12:00:00.000Z');
async function dashboard(campaign,{owned,record,control}){
  const [,load,sizeText]=/^phase5e2-dashboard-([A-Za-z]+)-(\d+)$/.exec(campaign)??[];
  const size=Number(sizeText);
  check(LOADS[load]&&[1000,10000,100000].includes(size),'Unexpected campaign');
  const database=await openSmartFinDatabase();
  await record('seed',async()=>{
    await owned(async db=>{
      await db.executeSql(`INSERT OR IGNORE INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES
        ('bank','bank','bankAccount','active','COP',1000,NULL,'2026-01-01','2026-01-01'),('cash','cash','cash','active','COP',100,NULL,'2026-01-01','2026-01-01'),
        ('card','card','creditCard','active','COP',900,400,'2026-01-01','2026-01-01'),('closed','closed','bankAccount','closed','COP',9999,NULL,'2026-01-01','2026-01-01')`);
      await db.executeSql(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${size})
        INSERT INTO transactions(id, amount, currency, description, date, account_id, type, direction, status, created_at, updated_at)
        SELECT 'load-' || n, CASE WHEN n % 3 = 0 THEN 1.1 ELSE 1 END, 'COP', 'Synthetic historical load', ${LOADS[load]}, 'bank',
          CASE WHEN n % 4 = 0 THEN 'income' ELSE 'expense' END, CASE WHEN n % 4 = 0 THEN 'inflow' ELSE 'outflow' END,
          CASE WHEN n % 10 = 9 THEN 'pending' ELSE 'posted' END, '2026-10-24', '2026-10-24' FROM seq`);
    });
    const [r]=await database.executeSql('SELECT count(*) AS n, sqlite_version() AS v FROM transactions');
    check(r.rows.item(0).n===size,'Seed count');return {load,size,sqlite:r.rows.item(0).v};
  });
  await record(`dashboard-${load}-${size}-samples`,async()=>{
    // Each version must be exactly stable across samples. Cross-version differences
    // (unspecified SQL tie order before JS summation) are recorded, never tolerated.
    const samples=[];const expected={};
    const schedule=[['current','cold'],['baseline','w'],['current','w'],['baseline',0],['current',0],['current',1],['baseline',1],['baseline',2],['current',2],['current',3],['baseline',3]];
    for(const [version,sample] of schedule){
      // The managed handle itself: a proxy would be re-managed by the shared
      // repository and request the maintenance permit twice (harness deadlock).
      const start=performance.now();
      const summary=version==='current'?await getDashboardSummaryFromDb(database,DATE):await getBaselineDashboardSummaryFromDb(database,DATE);
      const totalMs=performance.now()-start;
      const core={availableBalance:summary.availableBalance,totalDebt:summary.totalDebt,netWorth:summary.netWorth,monthlyIncome:summary.monthlyIncome,
        monthlyExpenses:summary.monthlyExpenses,monthlySavings:summary.monthlySavings,recentTransactionCount:summary.recentTransactionCount};
      expected[version]??=core;
      check(JSON.stringify(core)===JSON.stringify(expected[version]),'Dashboard unstable '+version+' '+JSON.stringify({core,expected}));
      if(version==='current')check(summary.monthlyNetLosses===0&&summary.monthlyForgivenessLosses===0,'Unexpected shared losses');
      samples.push({version,sample,totalMs,heap:heap()});
    }
    const differences=Object.keys(expected.current).filter(k=>expected.current[k]!==expected.baseline[k])
      .map(key=>({key,current:expected.current[key],baseline:expected.baseline[key]}));
    return {samples,summary:expected,exactEqual:differences.length===0,differences};
  });
  await record(`dashboard-${load}-${size}-decomposition`,async()=>{
    // Same reads as getDashboardSummaryFromDb for 2026-10-24, run sequentially here
    // (production uses Promise.all), so each await is attributable.
    const accounts=createSqliteAccountRepository(database),transactions=createSqliteTransactionRepository(database),shared=createSqliteSharedExpenseRepository(database);
    const steps={
      accounts:()=>accounts.getAccounts(),
      monthlyAmounts:()=>transactions.getTransactionAmounts({startDate:'2026-10',endDateExclusive:'2026-11',datePrefix:'2026-10',status:'posted',
        operations:[{type:'income',direction:'inflow'},{type:'expense',direction:'outflow'}]}),
      recentDayCounts:()=>transactions.getTransactionCountsByDay({startDate:'2026-09-21',endDateExclusive:'2026-10-25',status:'posted'}),
      sharedPosition:()=>shared.getFinancialTotals(),
      lossPeriod:()=>shared.getLossPeriodTotals('2026-10-01','2026-11-01'),
    };
    const out=[];
    for(let sample=-1;sample<3;sample++){
      const row={sample};
      for(const [name,step] of Object.entries(steps)){
        const start=performance.now();const value=await step();
        row[name]={ms:performance.now()-start,rows:Array.isArray(value)?value.length:1};
      }
      const amounts=await steps.monthlyAmounts();
      const start=performance.now();let total=0;for(const a of amounts)total+=a.amount;
      row.jsSumMs=performance.now()-start;row.sumIsFinite=Number.isFinite(total);
      if(sample>=0)out.push(row);
    }
    return out;
  });
  await record('all-table-integrity-after-dashboard',async()=>JSON.parse(await control.liveEvidence()));
}

// Real-device ORDER BY probe: each variant, as a full listing and as 51-row keyset
// pages, against the order computed in JS from the same rows (BINARY text order).
const K="COALESCE(civil_date || 'T' || COALESCE(local_time, '00:00') || ':00.000Z', date)";
const ORDER_VARIANTS={
  newestCurrent:['DESC',`${K} DESC, created_at DESC, rowid DESC`],
  newestPlusCreated:['DESC',`${K} DESC, +created_at DESC, rowid DESC`],
  newestCastKey:['DESC',`CAST(${K} AS TEXT) DESC, created_at DESC, rowid DESC`],
  oldestCurrent:['ASC',`CAST(${K} AS TEXT) ASC, created_at DESC, rowid DESC`],
  oldestPlusCreated:['ASC',`${K} ASC, +created_at DESC, rowid DESC`],
  oldestOriginal5E:['ASC',`${K} ASC, created_at DESC, rowid DESC`],
  newestCoalesce:['DESC',`${K} DESC, COALESCE(created_at, created_at) DESC, rowid DESC`],
  oldestCoalesce:['ASC',`${K} ASC, COALESCE(created_at, created_at) DESC, rowid DESC`],
};
async function orderProbe({owned,record}){
  const database=await openSmartFinDatabase();
  const rows=async(sql,values=[])=>{const [r]=await database.executeSql(sql,values);return Array.from({length:r.rows.length},(_,i)=>r.rows.item(i));};
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  for(const [distribution,size] of [['civil',1000],['legacyDay',3000],['legacyTied',1000]]){
    await owned(async db=>{await db.executeSql('DELETE FROM transactions');for(const s of historySeedStatements(distribution,size))await db.executeSql(s);});
    const all=await rows(`SELECT rowid AS r, ${K} AS k, created_at AS c FROM transactions`);
    for(const [name,[direction,order]] of Object.entries(ORDER_VARIANTS)){
      await record(`order-${distribution}-${size}-${name}`,async()=>{
        const expected=[...all].sort((a,b)=>(direction==='DESC'?cmp(b.k,a.k):cmp(a.k,b.k))||cmp(b.c,a.c)||b.r-a.r).map(x=>x.r);
        const sql=`SELECT rowid AS r, ${K} AS k, created_at AS c FROM transactions INDEXED BY idx_transactions_civil_sort`;
        const listing=(await rows(`${sql} WHERE 1 = 1 ORDER BY ${order};`)).map(x=>x.r);
        const op=direction==='DESC'?'<':'>';
        const paged=[];let after;
        for(;;){
          const boundary=after?`AND ${K} ${op}= ? AND (${K} ${op} ? OR (${K} = ? AND created_at < ?) OR (${K} = ? AND created_at = ? AND rowid < ?))`:'';
          const page=await rows(`${sql} WHERE 1 = 1 ${boundary} ORDER BY ${order} LIMIT 51;`,after?[after.k,after.k,after.k,after.c,after.k,after.c,after.r]:[]);
          paged.push(...page.map(x=>x.r));
          if(page.length<51||paged.length>size*2)break;
          after=page[page.length-1];
        }
        const plan=await explain(database,`${sql} WHERE 1 = 1 ORDER BY ${order} LIMIT 51;`);
        const firstDiff=v=>v.findIndex((x,i)=>x!==expected[i]);
        return {direction,order,plan,listingExact:JSON.stringify(listing)===JSON.stringify(expected),
          pagedExact:JSON.stringify(paged)===JSON.stringify(expected),listingFirstDiff:firstDiff(listing),pagedFirstDiff:firstDiff(paged),
          pagedRows:paged.length,distinctPaged:new Set(paged).size,expectedRows:expected.length};
      });
    }
  }
}

export async function runPhase5E2(campaign,deps){
  // The driver may reject with plain objects; keep their fields in the report.
  const original=deps.record;
  const record=(name,operation)=>original(name,async()=>{
    try{return await operation();}catch(e){throw e instanceof Error?e:Error('Driver error: '+JSON.stringify(e));}
  });
  deps={...deps,record};
  await deps.control.recoveryEnabled(false);
  await record('isolation',()=>deps.control.isolation());
  if(campaign==='phase5e2-order-probe')return orderProbe(deps);
  if(campaign.startsWith('phase5e2-history-'))return history(campaign,deps);
  if(campaign.startsWith('phase5e2-dashboard-'))return dashboard(campaign,deps);
  throw Error('Unknown 5E.2 campaign');
}
