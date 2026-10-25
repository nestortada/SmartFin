/* global performance */
import {integratedFixture, buildIntegratedScenario, inspectIntegrated, check} from './scripts/phase5e/integration';
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {createSubscriptionReminderService} from './src/modules/subscriptions/services/androidSubscriptionReminderService';
import {deleteFinancialData} from './src/modules/settings/useCases/deleteFinancialData';
import {createSqliteFinancialDataRepository} from './src/modules/settings/repositories/sqliteFinancialDataRepository';
import {financialDeletionLifecycle} from './src/modules/settings/services/financialDeletionLifecycle';
import {createSqliteTransactionRepository, rowToTransaction} from './src/modules/transactions/repositories/sqliteTransactionRepository';
import {TRANSACTION_SORT_SQL} from './src/shared/utils/transactionDate';
import {baselineHistory} from './historyBaseline';

const all={month:'all',accountId:'all',categoryId:'all',search:'',sort:'newest'};
export async function runFixes(campaign,{owned,record,control}) {
  await control.recoveryEnabled(false);
  const database=await openSmartFinDatabase();
  await record('isolation',()=>control.isolation());
  if(campaign==='phase5e1-order-probe') {
    await record('oldest-tie-compatibility',async()=>JSON.parse(await control.historyOrderProbe()));return;
  }
  const f=await integratedFixture(database,createSubscriptionReminderService());
  if(campaign==='phase5e1-recovery') {
    await record('combined-financial-baseline',()=>buildIntegratedScenario(f));
    const wipe=()=>deleteFinancialData(createSqliteFinancialDataRepository(database),financialDeletionLifecycle());
    await record('confirmed-delete-pending-before-contention',async()=>{
      await control.arm('cleanup.beforeCompleted',true);
      const result=await wipe(); check(result.status==='confirmed' && result.cleanup==='pending','Expected durable pending');
      return result;
    });
    await control.recoveryEnabled(true);
    await record('unexpected-receiver-failure-preserves-pending-intent',async()=>{
      const before=await inspectIntegrated(database);
      const result=JSON.parse(await control.unexpectedRecovery(false));
      check(result.pidBefore===result.pidAfter,'Unexpected pending error killed process');
      check(JSON.stringify(before)===JSON.stringify(await inspectIntegrated(database)),'Unexpected failure lost durable intent');
      return result;
    });
    await record('real-owner-two-recoveries-receiver-and-worker-no-crash',async()=>{
      const before=await inspectIntegrated(database);
      const result=JSON.parse(await control.recoveryRace());
      check(result.pidBefore===result.pidAfter,'Process changed');
      check(result.owner.status==='completed' && result.subsequent.status==='completed','Cleanup not resumable');
      const after=await inspectIntegrated(database);
      for(const table of Object.keys(before.tables)) if(table!=='app_settings')
        check(JSON.stringify(before.tables[table])===JSON.stringify(after.tables[table]),'Financial replay: '+table);
      return {result,before,after};
    });
    await record('completed-cleanup-unexpected-exception-and-process-still-usable',async()=>{
      const before=await inspectIntegrated(database);
      const unexpected=JSON.parse(await control.unexpectedRecovery(true));
      check(unexpected.pidBefore===unexpected.pidAfter && unexpected.subsequent.status==='completed','Unexpected error killed process');
      const race=JSON.parse(await control.recoveryRace());
      check(race.owner.status==='completed','Completed receipt lost');
      check(JSON.stringify(before)===JSON.stringify(await inspectIntegrated(database)),'Completed recovery changed data');
      return {unexpected,race};
    });
    return;
  }
  await record('native-original-and-compatible-sql',async()=>JSON.parse(await control.historyCompatibility()));
  const count=Number(campaign.split('-').at(-1));
  check([1000,10000,100000].includes(count),'Unexpected synthetic volume');
  const mode=campaign.includes('-legacy-')?'legacy':campaign.includes('-mixed-')?'mixed':'civil';
  await owned(async db=>{
    const date=mode==='legacy' ? "'2026-10-24'" : mode==='mixed'
      ? "CASE n%5 WHEN 0 THEN '2026-10-24' WHEN 1 THEN '2026-10-24T04:00:00-05:00' WHEN 2 THEN 'invalid' WHEN 3 THEN '2026-02-31' ELSE '2026-10-24T00:00:00.000Z' END"
      : "printf('2026-%02d-%02dT%02d:00:00.000Z',9+n%2,1+n%28,5+n%18)";
    const civil=mode!=='civil'?'NULL':"printf('2026-%02d-%02d',9+n%2,1+n%28)";
    const time=mode!=='civil'?'NULL':"printf('%02d:00',n%18)";
    await db.executeSql(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${count})
      INSERT INTO transactions(id,amount,currency,description,date,civil_date,local_time,time_zone,date_precision,account_id,category_id,type,direction,status,target_account_id,notes,created_at,updated_at)
      SELECT 'history-'||n,n*0.25,'COP',CASE WHEN n%7=0 THEN 'ÁRBOL Σ café %_' ELSE 'Synthetic merchant '||(n%50) END,
      ${date},${civil},${time},${mode!=='civil'?'NULL':"'America/Bogota'"},${mode!=='civil'?'NULL':"'dateTime'"},
      CASE WHEN n%2=0 THEN 'bank' ELSE 'cash' END,CASE WHEN n%3=0 THEN 'food' ELSE NULL END,
      CASE WHEN n%5=0 THEN 'internalTransfer' ELSE 'expense' END,'outflow','posted',
      CASE WHEN n%5=0 THEN 'target' ELSE NULL END,'Literal %_ Unicode İΩ','2026-10-24','2026-10-24' FROM seq`);
  });
  // Reference hook with civil keys projected explicitly, preserving original objects.
  const [result]=await database.executeSql(`SELECT * FROM transactions ORDER BY ${TRANSACTION_SORT_SQL} DESC,created_at DESC,rowid DESC`);
  const reference=Array.from({length:result.rows.length},(_,i)=>rowToTransaction(result.rows.item(i)));
  const byId=new Map(reference.map(tx=>[tx.id,tx]));
  const normalized=reference.map(tx=>({...tx,date:tx.civilDate?`${tx.civilDate}T${tx.localTime??'00:00'}:00.000Z`:tx.date}));
  const expected=query=>baselineHistory(normalized,query.month,query.accountId,query.categoryId,query.search,query.sort).map(tx=>byId.get(tx.id));
  await record('original-production-page-sql-reproduction',async()=>{
    const original=new Proxy(database,{get(target,key){
      if(key!=='executeSql')return Reflect.get(target,key);
      return (sql,values=[])=>target.executeSql((!sql.includes('DISTINCT') && sql.includes(' AS date FROM transactions WHERE')
        ?sql.replace('FROM transactions WHERE','FROM transactions INDEXED BY idx_transactions_civil_sort WHERE'):sql)
        .replace(`ORDER BY CAST(${TRANSACTION_SORT_SQL} AS TEXT) ASC`,`ORDER BY ${TRANSACTION_SORT_SQL} ASC`),values);
    }});
    const start=performance.now();let outcome;
    try { const page=await createSqliteTransactionRepository(original).getTransactionPage(all);outcome={status:'delivered',rows:page.transactions.length}; }
    catch(e){const message=e?.message??String(e);check(message.includes('no query solution'),'Unexpected original error: '+message);outcome={status:'failed',error:message};}
    return {outcome,totalMs:performance.now()-start,scope:'original first hint and original ordering; other production logic identical'};
  });
  const measured=async(query,cursor,repo)=>{
    const metrics={initialCheckMs:0,rowMaterializationMs:0,connectionWaitMs:0,sqlAwaitMs:0};
    const queries=[];
    const proxy=new Proxy(database,{get(target,key){
      if(key!=='executeSql')return Reflect.get(target,key);
      return async(sql,values=[])=>{
        queries.push({sql,values});const start=performance.now();
        try{return await target.executeSql(sql,values);}finally{metrics.sqlAwaitMs+=performance.now()-start;}
      };
    }});
    // A fresh proxy makes the first check cold, subsequent pages use the cursor.
    const repository=repo??createSqliteTransactionRepository(proxy);
    global.__phase5e1Metrics=metrics;
    const start=performance.now();
    let page;
    try{page=await repository.getTransactionPage(query,cursor);}finally{delete global.__phase5e1Metrics;}
    metrics.totalMs=performance.now()-start;
    metrics.pageConstructionAndJsMs=metrics.totalMs-metrics.sqlAwaitMs-metrics.rowMaterializationMs;
    // Independent read-only native replay: diagnostic timings, never subtracted from the delivered page.
    const native=queries.length?JSON.parse(await control.historySqlTiming(JSON.stringify(queries))):null;
    return {page,metrics,native};
  };
  for(const sort of ['newest','oldest']) {
    const query={...all,sort};
    await record(`${mode}-${count}-exact-complete-traversal-${sort}`,async()=>{
      const want=expected(query); const first=await measured(query);
      check(first.page.transactions.length===50,'Initial page size');
      if(first.page.nextCursor?.legacyIds) {
        check(JSON.stringify(first.page.nextCursor.legacyIds)===JSON.stringify(want.map(tx=>tx.id)),'Legacy cursor exact ID order');
        check(first.page.nextCursor.legacyOffset===50,'Legacy cursor offset');
      }
      let page=first.page,offset=0,pages=0,cursor;
      const repo=createSqliteTransactionRepository(database);
      do {
        check(JSON.stringify(page.transactions)===JSON.stringify(want.slice(offset,offset+50)),
          'Exact page/reference mismatch at '+offset+' '+JSON.stringify({actual:page.transactions.slice(0,2),expected:want.slice(offset,offset+2),cursor:page.nextCursor}));
        offset+=page.transactions.length;pages++;cursor=page.nextCursor;
        if(cursor)page=await repo.getTransactionPage(query,cursor);
      } while(cursor);
      check(offset===count,'Omitted/duplicated records');
      return {count,pages,exactObjects:true,firstPage:first.metrics,nativeReplay:first.native,firstCursor:first.page.nextCursor};
    });
  }
  for(const filter of [{search:'merchant 49'},{search:'árbol'},{search:'not found'},
    {month:mode!=='civil'?'2026-10':'2026-09',accountId:'bank',categoryId:'food',search:'%_',sort:'oldest'}]) {
    const query={...all,...filter};
    await record(`${mode}-${count}-search-${JSON.stringify(filter)}`,async()=>{
      const want=expected(query);const value=await measured(query);
      let page=value.page,cursor,offset=0;
      const repo=createSqliteTransactionRepository(database);
      do {
        check(JSON.stringify(page.transactions)===JSON.stringify(want.slice(offset,offset+50)),'Filtered exact mismatch');
        offset+=page.transactions.length;cursor=page.nextCursor;
        if(cursor)page=await repo.getTransactionPage(query,cursor);
      }while(cursor);
      check(offset===want.length,'Filtered omission');
      return {query,matched:offset,firstPage:value.metrics,nativeReplay:value.native};
    });
  }
  await record('revision-cancellation-and-empty-history',async()=>{
    const repo=createSqliteTransactionRepository(database);
    const page=await repo.getTransactionPage(all);
    let cancelled=false;try{await repo.getTransactionPage(all,page.nextCursor,()=>true);}catch(e){cancelled=String(e).includes('cancelada');}
    check(cancelled,'Cancellation not preserved');
    let injected=false;
    const concurrent=new Proxy(database,{get(target,key){
      if(key!=='executeSql')return Reflect.get(target,key);
      return async(sql,values=[])=>{
        const value=await target.executeSql(sql,values);
        if(sql.includes('history_rowid')&&!injected){injected=true;await owned(db=>db.executeSql("UPDATE transactions SET notes='Concurrent' WHERE id='history-2'"));}
        return value;
      };
    }});
    let mixedRevision=false;try{await createSqliteTransactionRepository(concurrent).getTransactionPage(all);}catch(e){mixedRevision=String(e).includes('cambió');}
    check(mixedRevision,'Concurrent page published mixed revision');
    await owned(db=>db.executeSql("UPDATE transactions SET notes='Edited' WHERE id='history-1'"));
    let invalid=false;try{await repo.getTransactionPage(all,page.nextCursor);}catch(e){invalid=String(e).includes('cambió');}
    check(invalid,'Cursor revision not invalidated');
    await owned(db=>db.executeSql('DELETE FROM transactions'));
    const empty=await repo.getTransactionPage(all);
    check(!empty.transactions.length && !empty.nextCursor,'Empty history');
    return {cancelled,invalid,mixedRevision,empty};
  });
  await record('all-table-integrity-after-history',async()=>JSON.parse(await control.liveEvidence()));
}
