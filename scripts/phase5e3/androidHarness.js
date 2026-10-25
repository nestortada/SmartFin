/* global performance */
// Phase 5E.3 synthetic APK campaigns: definitive 5E2-001 regression with variable
// created_at, dashboard precision/selectivity and staging/inspection for Android
// recovery paths. Only the isolated test package and its synthetic database.
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {getSQLiteTransactionHistoryPage as current} from './src/modules/transactions/repositories/sqliteTransactionHistory';
import {rowToTransaction,createSqliteTransactionRepository} from './src/modules/transactions/repositories/sqliteTransactionRepository';
import {createSqliteAccountRepository} from './src/modules/accounts/repositories/sqliteAccountRepository';
import {createSqliteSharedExpenseRepository} from './src/modules/transactions/repositories/sqliteSharedExpenseRepository';
import {getDashboardSummaryFromDb} from './src/modules/dashboard/useCases/getDashboardSummary';
import {PERSONAL_AMOUNT_SQL} from './src/modules/transactions/repositories/sharedFinancialProjectionSql';
import {TRANSACTION_DAY_SQL} from './src/shared/utils/transactionDate';
import {formatCurrency} from './src/shared/utils/formatCurrency';
import {deleteFinancialData} from './src/modules/settings/useCases/deleteFinancialData';
import {createSqliteFinancialDataRepository} from './src/modules/settings/repositories/sqliteFinancialDataRepository';
import {recoverFinancialDeletion} from './src/modules/settings/services/financialDeletionLifecycle';
import {createSubscriptionReminderService} from './src/modules/subscriptions/services/androidSubscriptionReminderService';
import {getSubscriptionApi} from './src/modules/subscriptions/services/subscriptionRuntime';
import {getBaselineDashboardSummaryFromDb} from './dashboardBaseline';
import {historySeedStatements} from './historyDistributionSql';
import {createdAtStatement} from './historyCreatedAtVariants';
import {FIFTY_YEAR_SHAPES,fiftyYearStatements} from './historyFiftyYears';
import {captureLocalDatabaseSnapshot} from './src/modules/settings/services/localDatabaseSnapshot';
import {baselineHistory} from './historyBaseline';

const check=(value,message)=>{if(!value)throw Error(message);};
const rowsOf=r=>Array.from({length:r.rows.length},(_,i)=>r.rows.item(i));
const base={month:'all',accountId:'all',categoryId:'all',search:'',sort:'newest'};
const CASES=[
  ['newest',base],
  ['oldest',{...base,sort:'oldest'}],
  ['search49',{...base,search:'merchant 49'}],
  ['unicode',{...base,search:'árbol'}],
  ['unicodeOldest',{...base,search:'İω',sort:'oldest'}],
  ['absent',{...base,search:'not found'}],
  ['monthAccount',{...base,month:'2026-10',accountId:'savings'}],
  ['combined',{...base,month:'2024-02',accountId:'bank',categoryId:'food',search:'%_',sort:'oldest'}],
];
const heap=()=>{try{const s=global.HermesInternal?.getInstrumentedStats?.();return s?s.js_allocatedBytes:undefined;}catch{return undefined;}};
const stats=values=>{
  if(!values.length)return {n:0};
  const s=[...values].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor(p*(s.length-1)))];
  return {n:s.length,min:s[0],median:q(0.5),p90:q(0.9),max:s[s.length-1],total:values.reduce((t,v)=>t+v,0)};
};

// Oracle independent of SQLite ordering (same construction as 5E.2): all rows,
// key/created_at/rowid order in JS (ASCII keys: JS order equals BINARY), then the
// frozen hook semantics with civil keys projected explicitly.
async function oracle(database){
  const [r]=await database.executeSql('SELECT rowid AS history_rowid, * FROM transactions');
  const rows=rowsOf(r);
  const key=row=>row.civil_date?`${row.civil_date}T${row.local_time??'00:00'}:00.000Z`:row.date;
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  rows.sort((a,b)=>cmp(key(b),key(a))||cmp(b.created_at,a.created_at)||b.history_rowid-a.history_rowid);
  const transactions=rows.map(rowToTransaction);
  const byId=new Map(transactions.map(tx=>[tx.id,tx]));
  const normalized=transactions.map(tx=>({...tx,date:tx.civilDate?`${tx.civilDate}T${tx.localTime??'00:00'}:00.000Z`:tx.date}));
  return query=>baselineHistory(normalized,query.month,query.accountId,query.categoryId,query.search,query.sort).map(tx=>byId.get(tx.id));
}

// A new proxy is a new connection identity: cold order proof and miss caches.
function cold(database){
  const m={statements:0,rows:0};
  const proxy=new Proxy(database,{get(target,key){
    if(key!=='executeSql')return Reflect.get(target,key);
    return async(sql,values=[])=>{const result=await target.executeSql(sql,values);m.statements++;m.rows+=result[0].rows.length;return result;};
  }});
  return {proxy,m};
}

// Every page until exhaustion: exact objects and order, no duplicates or omissions.
async function traverse(database,query,want){
  const pageMs=[];const seen=new Set();let total=0,pages=0,cursor;
  for(;;){
    const start=performance.now();
    const page=await current(database,rowToTransaction,query,cursor);
    pageMs.push(performance.now()-start);
    check(page.transactions.length<=50,'Page above 50');
    check(JSON.stringify(page.transactions)===JSON.stringify(want.slice(total,total+page.transactions.length)),'Page differs from oracle at '+total+' '+JSON.stringify(query));
    if(page.nextCursor)check(page.transactions.length===50||(page.transactions.length===0&&total===want.length),'Short page with cursor at '+total);
    for(const tx of page.transactions){check(!seen.has(tx.id),'Duplicate '+tx.id);seen.add(tx.id);}
    total+=page.transactions.length;pages++;
    if(!page.nextCursor)break;
    cursor=page.nextCursor;
  }
  check(total===want.length,'Omitted records: '+total+'/'+want.length);
  return {pages,total,expected:want.length,firstPageMs:pageMs[0],laterPages:stats(pageMs.slice(1)),traversalMs:pageMs.reduce((t,v)=>t+v,0)};
}

// Acceptance volume (AGENTS.md): phase5e3-history50-<shape>-<size> spreads the rows over 50 years.
function seedPlan(campaign){
  const fifty=/^phase5e3-history50-([A-Za-z]+)-(\d+)$/.exec(campaign);
  if(fifty){
    check(FIFTY_YEAR_SHAPES.includes(fifty[1]),'Unexpected 50-year shape');
    return {distribution:'fiftyYears',variant:fifty[1],size:Number(fifty[2]),statements:[...historySeedStatements('legacyDay',Number(fifty[2])),...fiftyYearStatements(fifty[1])]};
  }
  const [,distribution,variant,sizeText]=/^phase5e3-history-([A-Za-z]+)-([A-Za-z]+)-(\d+)$/.exec(campaign)??[];
  check(distribution&&variant,'Unexpected campaign');
  return {distribution,variant,size:Number(sizeText),statements:[...historySeedStatements(distribution,Number(sizeText)),createdAtStatement(variant)]};
}
async function history(campaign,{owned,record,control}){
  const {distribution,variant,size,statements}=seedPlan(campaign);
  check([1000,10000,100000].includes(size),'Unexpected campaign size');
  const database=await openSmartFinDatabase();
  await record('seed',async()=>{
    const start=performance.now();
    await owned(async db=>{for(const statement of statements)await db.executeSql(statement);});
    const [r]=await database.executeSql('SELECT count(*) AS n, count(DISTINCT created_at) AS c, sqlite_version() AS v FROM transactions');
    check(r.rows.item(0).n===size,'Seed count');
    return {distribution,variant,size,distinctCreatedAt:r.rows.item(0).c,sqlite:r.rows.item(0).v,seedMs:performance.now()-start};
  });
  const expected=await oracle(database);
  for(const [name,query] of CASES){
    await record(`${distribution}-${variant}-${size}-${name}-first-page-samples`,async()=>{
      // Warmup, then three cold samples of the first and second page.
      const want=expected(query),samples=[];
      for(let sample=-1;sample<3;sample++){
        const {proxy,m}=cold(database);const before=heap();
        let start=performance.now();const first=await current(proxy,rowToTransaction,query);const firstMs=performance.now()-start;
        const firstStatements=m.statements,firstRows=m.rows,allocated=before===undefined?undefined:heap()-before;
        let secondMs;
        if(first.nextCursor){start=performance.now();const second=await current(proxy,rowToTransaction,query,first.nextCursor);secondMs=performance.now()-start;
          check(JSON.stringify(second.transactions)===JSON.stringify(want.slice(50,50+second.transactions.length)),'Second page differs');}
        check(JSON.stringify(first.transactions)===JSON.stringify(want.slice(0,50)),'First page differs from oracle');
        if(sample>=0)samples.push({firstMs,secondMs,firstStatements,firstRows,secondStatements:m.statements-firstStatements,allocated,
          cursorKind:first.nextCursor?(first.nextCursor.legacyIds?'legacy':'keyset'):'end'});
      }
      return {query,matches:want.length,samples};
    });
  }
  for(const [name,query] of CASES){
    await record(`${distribution}-${variant}-${size}-${name}-exhaustive-traversal`,async()=>traverse(database,query,expected(query)));
  }
  if(size<=10000&&['civil','legacyDay','legacyTied','mixed'].includes(distribution)){
    await record('concurrent-mutations-invalidate-cursors',async()=>{
      const out=[];
      // Distinct rows per sort so every mutation really changes the revision.
      const mutations=[
        ['insert',(t)=>`INSERT INTO transactions(id, amount, currency, description, date, account_id, type, direction, status, created_at, updated_at) VALUES ('late-${t}', 7, 'COP', 'late', '2026-10-24', 'bank', 'expense', 'outflow', 'posted', '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z')`],
        ['createdAt',(t,i)=>`UPDATE transactions SET created_at='2030-01-01T00:00:00.000Z' WHERE id='history-${500+i}'`],
        ['date',(t,i)=>`UPDATE transactions SET date='2023-01-01' WHERE id='history-${7+i}'`],
        ['delete',(t,i)=>`DELETE FROM transactions WHERE id='history-${3+i}'`],
        ['invalidDate',(t,i)=>`UPDATE transactions SET date='invalid' WHERE id='history-${11+i}'`],
      ];
      for(const [kind,sql] of mutations)for(const [i,sort] of ['newest','oldest'].entries()){
        const query={...base,sort};
        const first=await current(database,rowToTransaction,query);
        const second=await current(database,rowToTransaction,query,first.nextCursor);
        check(second.nextCursor,'Second page has no cursor');
        await owned(db=>db.executeSql(sql(sort,i)));
        let invalidated=false;try{await current(database,rowToTransaction,query,second.nextCursor);}catch(e){invalidated=String(e).includes('cambió');}
        check(invalidated,'Cursor survived '+kind);
        const fresh=await traverse(database,query,(await oracle(database))(query));
        out.push({kind,sort,invalidated,total:fresh.total});
      }
      let injected=false;
      const concurrent=new Proxy(database,{get(target,key){
        if(key!=='executeSql')return Reflect.get(target,key);
        return async(sql,values=[])=>{const value=await target.executeSql(sql,values);
          if(sql.includes('history_rowid')&&!injected){injected=true;await owned(db=>db.executeSql("UPDATE transactions SET notes='Concurrent' WHERE id='history-2'"));}
          return value;};
      }});
      let mixed=false;try{await current(concurrent,rowToTransaction,{...base,search:'synthetic'});}catch(e){mixed=String(e).includes('cambió');}
      check(injected&&mixed,'Concurrent write published a mixed revision');
      return {mutations:out,intraPageWriteRejected:mixed};
    });
  }
  await record('all-table-integrity-after-history',async()=>JSON.parse(await control.liveEvidence()));
}

// Dashboard decimal decision matrix on Hermes (same scenarios as Node).
const PRECISION={
  fractionalTies1000:Array.from({length:1000},(_,i)=>({id:`load-${i+1}`,amount:(i+1)%3===0?1.1:1,income:(i+1)%4===0,createdAt:'2026-10-24',status:(i+1)%10===9?'pending':'posted'})),
  integerTies1000:Array.from({length:1000},(_,i)=>({id:`int-${i+1}`,amount:((i%7)+1)*1000,income:(i+1)%4===0,createdAt:'2026-10-24'})),
  centavosDisplayFlip:[...[0.05,0.15,0.3].map((amount,i)=>({id:`inc-${i}`,amount,income:true,createdAt:'2026-10-24T10:00:00.000Z'})),
    ...[0.7,0.2,0.3,1.1,0.05,0.15].map((amount,i)=>({id:`exp-${i}`,amount,income:false,createdAt:'2026-10-24T10:00:00.000Z'}))],
  centavosNoTies:[...[0.05,0.15,0.3].map((amount,i)=>({id:`inc-${i}`,amount,income:true,createdAt:`2026-10-24T10:00:0${i}.000Z`})),
    ...[0.7,0.2,0.3,1.1,0.05,0.15].map((amount,i)=>({id:`exp-${i}`,amount,income:false,createdAt:`2026-10-24T11:00:0${i}.000Z`}))],
  largeCentavosTies10000:Array.from({length:10000},(_,i)=>({id:`big-${i+1}`,amount:(100000+((i*7919)%100000))/100,income:i%5===0,createdAt:'2026-10-24'})),
};
const DATE=new Date('2026-10-24T12:00:00.000Z');
const WHERE=`WHERE ${TRANSACTION_DAY_SQL} >= '2026-10' AND ${TRANSACTION_DAY_SQL} < '2026-11' AND status = 'posted'
  AND substr(${TRANSACTION_DAY_SQL}, 1, 7) = '2026-10' AND ((type = 'income' AND direction = 'inflow') OR (type = 'expense' AND direction = 'outflow'))`;
const ORDERS={rowidAsc:'date DESC, created_at DESC, rowid ASC',rowidDesc:'date DESC, created_at DESC, rowid DESC',idAsc:'date DESC, created_at DESC, id ASC'};
const pick=s=>({monthlyIncome:s.monthlyIncome,monthlyExpenses:s.monthlyExpenses,monthlySavings:s.monthlyIncome-s.monthlyExpenses});
const display=s=>Object.fromEntries(Object.entries(s).map(([k,v])=>[k,formatCurrency(v,'COP')]));

async function precision({owned,record}){
  const database=await openSmartFinDatabase();
  for(const [name,rows] of Object.entries(PRECISION)){
    await record(`dashboard-precision-${name}`,async()=>{
      await owned(async db=>{
        await db.executeSql('DELETE FROM transactions');
        await db.executeSql(`INSERT OR IGNORE INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES
          ('bank','bank','bankAccount','active','COP',1000,NULL,'2026-01-01','2026-01-01')`);
        // 100 rows x 7 bindings: below the 999-variable limit of SQLite 3.9.2.
        for(let i=0;i<rows.length;i+=100){
          const chunk=rows.slice(i,i+100);
          await db.executeSql(`INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at) VALUES
            ${chunk.map(()=>"(?,?,'COP','Synthetic','2026-10-24','bank',?,?,?,?,?)").join(',')}`,
            chunk.flatMap(r=>[r.id,r.amount,r.income?'income':'expense',r.income?'inflow':'outflow',r.status??'posted',r.createdAt,r.createdAt]));
        }
      });
      const currentSummary=await getDashboardSummaryFromDb(database,DATE);
      const historical=await getBaselineDashboardSummaryFromDb(database,DATE);
      const explicit={};
      for(const [order,tail] of Object.entries(ORDERS)){
        const [r]=await database.executeSql(`SELECT id, type, ${PERSONAL_AMOUNT_SQL} AS amount FROM transactions ${WHERE} ORDER BY ${tail}`);
        const ordered=rowsOf(r);
        const income=ordered.filter(x=>x.type==='income').reduce((t,x)=>t+x.amount,0),expenses=ordered.filter(x=>x.type==='expense').reduce((t,x)=>t+x.amount,0);
        explicit[order]={summary:{monthlyIncome:income,monthlyExpenses:expenses,monthlySavings:income-expenses},firstIds:ordered.slice(0,3).map(x=>x.id)};
      }
      const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
      const matches=s=>Object.entries(explicit).filter(([,v])=>same(v.summary,s)).map(([k])=>k);
      for(const v of Object.values(explicit))v.display=display(v.summary);
      return {rows:rows.length,current:{summary:pick(currentSummary),display:display(pick(currentSummary)),equalsExplicit:matches(pick(currentSummary))},
        historical:{summary:pick(historical),display:display(pick(historical)),equalsExplicit:matches(pick(historical))},explicit,
        binaryEqual:same(pick(currentSummary),pick(historical)),displayEqual:same(display(pick(currentSummary)),display(pick(historical))),
        unaffectedEqual:['availableBalance','totalDebt','netWorth','recentTransactionCount'].every(k=>currentSummary[k]===historical[k])};
    });
  }
}

// monthlyAmounts cost against the number of selected rows, with 100k rows total.
async function selectivity({owned,record,control}){
  const database=await openSmartFinDatabase();
  const accounts=createSqliteAccountRepository(database),transactions=createSqliteTransactionRepository(database),shared=createSqliteSharedExpenseRepository(database);
  const steps={
    accounts:()=>accounts.getAccounts(),
    monthlyAmounts:()=>transactions.getTransactionAmounts({startDate:'2026-10',endDateExclusive:'2026-11',datePrefix:'2026-10',status:'posted',
      operations:[{type:'income',direction:'inflow'},{type:'expense',direction:'outflow'}]}),
    recentDayCounts:()=>transactions.getTransactionCountsByDay({startDate:'2026-09-21',endDateExclusive:'2026-10-25',status:'posted'}),
    sharedPosition:()=>shared.getFinancialTotals(),
    lossPeriod:()=>shared.getLossPeriodTotals('2026-10-01','2026-11-01'),
  };
  for(const selected of [0,1000,10000,50000,90000]){
    await record(`dashboard-selectivity-100000-selected-${selected}`,async()=>{
      await owned(async db=>{
        await db.executeSql('DELETE FROM transactions');
        await db.executeSql(`INSERT OR IGNORE INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES
          ('bank','bank','bankAccount','active','COP',1000,NULL,'2026-01-01','2026-01-01')`);
        // Selected rows on 2026-10-05; the rest spread over 2023-10..2026-09 (outside the month and the recent window).
        await db.executeSql(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 100000)
          INSERT INTO transactions(id, amount, currency, description, date, account_id, type, direction, status, created_at, updated_at)
          SELECT 'sel-' || n, CASE WHEN n % 3 = 0 THEN 1.1 ELSE 1 END, 'COP', 'Synthetic selectivity',
            CASE WHEN n <= ${selected} THEN '2026-10-05' ELSE date('2023-10-01', '+' || ((n * 37) % 1050) || ' days') END, 'bank',
            CASE WHEN n % 4 = 0 THEN 'income' ELSE 'expense' END, CASE WHEN n % 4 = 0 THEN 'inflow' ELSE 'outflow' END,
            'posted', '2026-10-05', '2026-10-05' FROM seq`);
      });
      const [r]=await database.executeSql("SELECT count(*) AS n, sum(substr(date,1,7)='2026-10') AS month FROM transactions");
      check(r.rows.item(0).n===100000&&r.rows.item(0).month===selected,'Selectivity seed');
      const samples=[];
      for(let sample=-1;sample<3;sample++){
        const row={sample};
        for(const [name,step] of Object.entries(steps)){
          const start=performance.now();const value=await step();
          row[name]={ms:performance.now()-start,rows:Array.isArray(value)?value.length:1};
        }
        const start=performance.now();const summary=await getDashboardSummaryFromDb(database,DATE);row.dashboardMs=performance.now()-start;
        row.monthlyIncome=summary.monthlyIncome;row.monthlyExpenses=summary.monthlyExpenses;
        if(sample>=0)samples.push(row);
      }
      check(new Set(samples.map(s=>JSON.stringify([s.monthlyIncome,s.monthlyExpenses]))).size===1,'Dashboard unstable');
      return {selected,samples};
    });
  }
  await record('all-table-integrity-after-selectivity',async()=>JSON.parse(await control.liveEvidence()));
}

// Acceptance volume: dashboard and manual backup with 100k movements over 50 years.
async function fiftyYears(campaign,{owned,record,control,backup}){
  const shape=campaign.slice('phase5e3-fifty-'.length);
  check(FIFTY_YEAR_SHAPES.includes(shape),'Unexpected 50-year shape');
  const database=await openSmartFinDatabase();
  await record('seed-100000-over-50-years',async()=>{
    await owned(async db=>{for(const s of [...historySeedStatements('legacyDay',100000),...fiftyYearStatements(shape)])await db.executeSql(s);});
    const [r]=await database.executeSql(`SELECT count(*) AS n, count(DISTINCT ${TRANSACTION_DAY_SQL}) AS days,
      sum(substr(${TRANSACTION_DAY_SQL},1,7)='2026-10') AS october, count(DISTINCT substr(${TRANSACTION_DAY_SQL},1,4)) AS years, sqlite_version() AS v FROM transactions`);
    check(r.rows.item(0).n===100000,'Seed count');
    return r.rows.item(0);
  });
  await record(`dashboard-fifty-${shape}-samples`,async()=>{
    const accounts=createSqliteAccountRepository(database),transactions=createSqliteTransactionRepository(database),shared=createSqliteSharedExpenseRepository(database);
    const steps={
      accounts:()=>accounts.getAccounts(),
      monthlyAmounts:()=>transactions.getTransactionAmounts({startDate:'2026-10',endDateExclusive:'2026-11',datePrefix:'2026-10',status:'posted',
        operations:[{type:'income',direction:'inflow'},{type:'expense',direction:'outflow'}]}),
      recentDayCounts:()=>transactions.getTransactionCountsByDay({startDate:'2026-09-21',endDateExclusive:'2026-10-25',status:'posted'}),
      sharedPosition:()=>shared.getFinancialTotals(),
      lossPeriod:()=>shared.getLossPeriodTotals('2026-10-01','2026-11-01'),
    };
    const samples=[];let expected;
    for(let sample=-1;sample<5;sample++){
      const start=performance.now();const summary=await getDashboardSummaryFromDb(database,DATE);const totalMs=performance.now()-start;
      const core=JSON.stringify([summary.monthlyIncome,summary.monthlyExpenses,summary.monthlySavings,summary.availableBalance,summary.netWorth,summary.recentTransactionCount]);
      expected??=core;check(core===expected,'Dashboard unstable');
      const row={sample,totalMs};
      for(const [name,step] of Object.entries(steps)){const s=performance.now();const v=await step();row[name]={ms:performance.now()-s,rows:Array.isArray(v)?v.length:1};}
      if(sample>=0)samples.push(row);
    }
    const historical=await getBaselineDashboardSummaryFromDb(database,DATE),summary=await getDashboardSummaryFromDb(database,DATE);
    const differences=['monthlyIncome','monthlyExpenses','availableBalance','totalDebt','netWorth','recentTransactionCount']
      .filter(k=>summary[k]!==historical[k]).map(k=>({key:k,current:summary[k],baseline:historical[k]}));
    return {samples,summary:JSON.parse(expected),differencesFromPreCivilBaseline:differences};
  });
  await record(`backup-fifty-${shape}-capture-publication`,async()=>{
    await control.configureSaf();
    const job=JSON.parse(await backup.preparePublication());
    const start=performance.now();const times={};
    const capturing=captureLocalDatabaseSnapshot(job.id);
    // A financial write requested during capture waits for admission (provisional budget ≤6 s).
    const writer=owned(db=>db.executeSql("UPDATE accounts SET updated_at=updated_at WHERE id='bank'")).then(()=>performance.now()-start);
    const captured=await capturing;times.captureMs=performance.now()-start;
    times.financialAdmissionWaitMs=await writer;
    const p=performance.now();const published=JSON.parse(await backup.publishSnapshot(job.id,captured.snapshot.id));times.publicationMs=performance.now()-p;
    const status=await backup.getBackupStatus(0);
    check(published.state==='verified'&&status.generationId===job.id&&status.validation==='verified','Publication not verified');
    const csv=JSON.parse(await control.csvEvidence(job.id));
    return {times,fileCount:published.fileCount,status:{validation:status.validation,datasetCurrency:status.datasetCurrency,cloudSync:'unconfirmed'},
      captureTimings:captured.timings,csvFiles:csv.csv.length,annualCsv:csv.csv.filter(f=>f.name.startsWith('movimientos-')).length,
      csvTransactionRows:csv.transactionRows,publishedTimings:published.timings};
  });
  await record('all-table-integrity-after-fifty-years',async()=>JSON.parse(await control.liveEvidence()));
}

// Recovery staging. Each stage leaves the process running with the test barrier
// lifted, so only Android (boot, package replacement) or the app can recover.
const KEY='__smartfin_financial_lifecycle_v1';
const reminder={id:'subscription-reminder:r',revision:1,fireAt:'2099-10-18T15:00:00.000Z'};
async function recovery(campaign,{owned,seed,record,control}){
  await openSmartFinDatabase();
  // Deletion may reopen the managed connection: every read borrows the current owner.
  const rows=async sql=>rowsOf((await owned(db=>db.executeSql(sql)))[0]);
  const intent=async()=>{const [r]=await rows(`SELECT setting_value FROM app_settings WHERE setting_key='${KEY}'`);return r?JSON.parse(r.setting_value):null;};
  const epoch=async()=>(await intent())?.epoch??'legacy';
  const wipe=async lifecycle=>deleteFinancialData(createSqliteFinancialDataRepository(await openSmartFinDatabase()),lifecycle);
  const financial=async()=>({transactions:await rows('SELECT * FROM transactions ORDER BY id'),accounts:await rows('SELECT * FROM accounts ORDER BY id'),
    occurrences:await rows('SELECT * FROM subscription_occurrences ORDER BY id'),revision:await rows('SELECT * FROM financial_data_revision')});
  if(campaign==='phase5e3-auto-stage-alarm'||campaign==='phase5e3-auto-stage-alarm-lost'){
    await record('stage-new-epoch-subscription-alarm',async()=>{
      await seed();
      const wiped=await wipe();check(wiped.status==='confirmed'&&wiped.cleanup!=='pending','Initial deletion did not complete');
      const api=await getSubscriptionApi(),date=new Date();date.setDate(date.getDate()+2);
      const anchor=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
      await api.createSubscription({name:'Recovery synthetic',amount:1000,anchorDate:anchor,recurrence:{periodicity:'monthly'},reminders:{enabled:true,offsets:[0],hour:9,minute:0}});
      const [r]=await rows("SELECT * FROM subscription_reminders WHERE desired='scheduled' LIMIT 1");
      const current=await epoch();
      check(r&&current!=='legacy'&&await control.alarmExists(r.id,current),'No new-epoch alarm');
      // The pre-deletion identity must not be resurrected by any recovery path.
      check(!await control.alarmExists(reminder.id,'legacy'),'Old-epoch alarm present');
      const lost=campaign.endsWith('-lost');
      if(lost){await control.removeAlarm(r.id,current);check(!await control.alarmExists(r.id,current),'Alarm not removed');}
      const saved={kind:'alarm',lost,reminder:r,epoch:current,previousEpoch:(await intent()).previousEpoch,expectedDate:anchor,financial:await financial(),stagedAt:Date.now()};
      await control.saveRestart(JSON.stringify(saved));await control.recoveryEnabled(true);
      return saved;
    });return;
  }
  if(campaign==='phase5e3-auto-stage-cleanup'){
    await record('stage-confirmed-deletion-with-pending-cleanup',async()=>{
      await seed();
      await owned(async(db,permit)=>{
        await db.executeSql("UPDATE subscription_reminders SET desired='scheduled',revision=1,delivery_status='pending' WHERE id=?",[reminder.id]);
        await createSubscriptionReminderService(permit).schedule(reminder);
      });
      check(await control.alarmExists(reminder.id,'legacy'),'Old alarm not scheduled');
      await control.arm('cleanup.before:reminderIds',true);
      const result=await wipe();
      check(result.status==='confirmed'&&result.cleanup==='pending','Cleanup did not remain pending: '+JSON.stringify(result));
      check(await control.alarmExists(reminder.id,'legacy'),'Fault canceled old alarm');
      const saved={kind:'cleanup',result,intent:await intent(),oldAlarm:reminder.id,financial:await financial(),stagedAt:Date.now()};
      await control.saveRestart(JSON.stringify(saved));await control.recoveryEnabled(true);
      return saved;
    });return;
  }
  if(campaign==='phase5e3-ui-seed'){
    // Synthetic fixture for the UI walkthrough: base entities, 1000 legacy-day
    // movements with scrambled created_at and a real legacy-epoch reminder alarm.
    await record('seed-ui-fixture',async()=>{
      await seed();
      await owned(async(db,permit)=>{
        for(const statement of [...historySeedStatements('legacyDay',1000),createdAtStatement('scrambled')])await db.executeSql(statement);
        await db.executeSql("UPDATE subscription_reminders SET desired='scheduled',revision=1,delivery_status='pending' WHERE id=?",[reminder.id]);
        await createSubscriptionReminderService(permit).schedule(reminder);
      });
      check(await control.alarmExists(reminder.id,'legacy'),'UI fixture alarm missing');
      await control.recoveryEnabled(true);
      const [r]=await rows("SELECT count(*) AS n, sum(substr(date,1,7)='2026-10') AS october FROM transactions");
      return {transactions:r.n,october:r.october,financial:await financial()};
    });return;
  }
  if(campaign==='phase5e3-auto-inspect'){
    // Launched after the trigger without force-stop. Reads state before any
    // harness recovery; only then repairs explicitly, labelled as such.
    const saved=JSON.parse(await control.readRestart());
    await record('state-before-any-harness-recovery',async()=>{
      const state=await intent();
      const observed={intentStatus:state?.status??null,epoch:state?.epoch??'legacy',observe:await control.observeLog()};
      if(saved.kind==='alarm'){
        observed.automaticAlarm=await control.alarmExists(saved.reminder.id,saved.epoch);
        observed.oldEpochAlarm=await control.alarmExists(reminder.id,'legacy');
      } else observed.oldAlarmPresent=await control.alarmExists(saved.oldAlarm,'legacy');
      const now=await financial();
      check(JSON.stringify(now.transactions)===JSON.stringify(saved.financial.transactions)&&JSON.stringify(now.accounts)===JSON.stringify(saved.financial.accounts),'Financial tables changed');
      check(JSON.stringify(now.occurrences.map(o=>[o.id,o.expected_date]))===JSON.stringify(saved.financial.occurrences.map(o=>[o.id,o.expected_date])),'Obligation dates changed');
      return {saved:{kind:saved.kind,lost:saved.lost,stagedAt:saved.stagedAt,epoch:saved.epoch},observed};
    });
    await record('harness-explicit-recovery-after-observation',async()=>{
      // Explicit call by the harness: not evidence of automatic recovery.
      await control.recoveryEnabled(true);
      const recovered=await recoverFinancialDeletion();
      await control.runWorker();
      const result={recovered};
      if(saved.kind==='alarm')result.alarm=await control.alarmExists(saved.reminder.id,saved.epoch);
      else result.oldAlarmPresent=await control.alarmExists(saved.oldAlarm,'legacy');
      result.intentStatus=(await intent())?.status??null;
      check(saved.kind==='alarm'?result.alarm:!result.oldAlarmPresent&&recovered.status!=='unknown','Explicit recovery did not converge');
      const now=await financial();
      check(JSON.stringify(now.transactions)===JSON.stringify(saved.financial.transactions),'Explicit recovery replayed financial commands');
      return result;
    });
    await record('all-table-integrity-after-recovery',async()=>JSON.parse(await control.liveEvidence()));
    return;
  }
  throw Error('Unknown recovery campaign');
}

export async function runPhase5E3(campaign,deps){
  const original=deps.record;
  const record=(name,operation)=>original(name,async()=>{
    try{return await operation();}catch(e){throw e instanceof Error?e:Error('Driver error: '+JSON.stringify(e));}
  });
  deps={...deps,record};
  // Recovery campaigns manage the barrier themselves; inspection freezes it first.
  await deps.control.recoveryEnabled(false);
  await record('isolation',()=>deps.control.isolation());
  if(campaign.startsWith('phase5e3-history-')||campaign.startsWith('phase5e3-history50-'))return history(campaign,deps);
  if(campaign.startsWith('phase5e3-fifty-'))return fiftyYears(campaign,deps);
  if(campaign==='phase5e3-dashboard-precision')return precision(deps);
  if(campaign==='phase5e3-dashboard-selectivity')return selectivity(deps);
  if(campaign.startsWith('phase5e3-auto-'))return recovery(campaign,deps);
  throw Error('Unknown 5E.3 campaign');
}
