/* global performance */
import React,{useEffect,useState} from 'react';
import {NativeModules,Text,View} from 'react-native';
import SQLite from 'react-native-sqlite-storage';
import {SQLITE_SCHEMA_STATEMENTS} from './src/database/sqliteSchema';
import {applyVersionedMigrations} from './src/database/migrations';
import {getDashboardSummaryFromDb as before} from './src/modules/dashboard/useCases/getDashboardSummaryBaseline';
import {getDashboardSummaryFromDb as after} from './src/modules/dashboard/useCases/getDashboardSummary';
const native=NativeModules.DashboardBenchmark;
const config=native.getConstants();
if(config.packageId!=='com.smartfin.sharedposition.bench'||!config.release||__DEV__||!global.HermesInternal)throw Error('Isolated release Hermes package required');
SQLite.enablePromise(true);SQLite.DEBUG(false);
const date=new Date('2026-10-10T12:00:00-05:00');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(actual,expected,label)=>{if(JSON.stringify(canonical(actual))!==JSON.stringify(canonical(expected)))throw Error(label+': '+JSON.stringify(actual)+' != '+JSON.stringify(expected));};
const pause=()=>new Promise(resolve=>setTimeout(resolve,100));
async function run(setText){
  const metadata=await native.seed(100000,SQLITE_SCHEMA_STATEMENTS);
  await native.writeFunctional(JSON.stringify({type:'start',config,metadata,clock:'performance.now',warmups:3,samples:7,target:'getDashboardSummaryFromDb; no screen FPS/TTI measurement'}));
  for(const size of [0,100,1000,5000]){
    const dataset=await native.seedShared(size);
    const db=await SQLite.openDatabase({name:dataset.name,location:'default'});
    await db.executeSql('PRAGMA foreign_keys=ON');await applyVersionedMigrations(db);
    const execute=db.executeSql.bind(db);
    const accountsBefore=(await execute('SELECT * FROM accounts ORDER BY id'))[0].rows.raw();
    const expected=await before(db,date);
    let queries=[];
    const measured=new Proxy(db,{get(target,key){if(key!=='executeSql')return Reflect.get(target,key);return async(sql,values=[])=>{const start=performance.now();const results=await execute(sql,values);const rows=results[0].rows.raw();queries.push({sql,values,returnedRows:rows.length,returnedJsonCharacters:JSON.stringify(rows).length,queryRoundtripMs:performance.now()-start,nativeQueryMs:results[0].__nativeQueryMs,sqlCursorMs:results[0].__sqlCursorMs});return results;};}});
    for(const[version,summarize]of[['before',before],['after',after]]){
      setText(`Synthetic 100k ledger / ${size} shared / ${version}`);
      await native.writeFunctional(JSON.stringify({type:'progress',sharedExpenses:size,version}));
      for(let i=0;i<3;i++)equal(await summarize(measured,date),expected,'warmup financial equality');
      for(let i=0;i<7;i++){
        await pause();queries=[];await native.beginSample();
        const start=performance.now();const actual=await summarize(measured,date);const milliseconds=performance.now()-start;
        equal(actual,expected,'sample financial equality');
        await native.finishSample(JSON.stringify({type:'sample',size:100000,sharedExpenses:size,version,iteration:i,milliseconds,queries,summary:actual,queryCount:queries.length,returnedRows:queries.reduce((n,q)=>n+q.returnedRows,0),returnedJsonCharacters:queries.reduce((n,q)=>n+q.returnedJsonCharacters,0)}));
      }
    }
    equal((await execute('SELECT * FROM accounts ORDER BY id'))[0].rows.raw(),accountsBefore,'bank balances/debt unchanged');
    equal((await execute('SELECT COUNT(*) AS n FROM transactions'))[0].rows.item(0).n,100000,'no duplicated transactions');
    equal((await execute('PRAGMA foreign_key_check'))[0].rows.length,0,'foreign keys');
    await db.close();
  }
  await native.writeFunctional(JSON.stringify({type:'complete',financialEquality:true,unchangedBalances:true,bankMovements:100000,volumes:[0,100,1000,5000]}));
  setText('PASS: identical financial indicators for all volumes');
}
export default function App(){const[text,setText]=useState('Synthetic performance audit running');useEffect(()=>{run(setText).catch(async error=>{setText('FAIL: '+error.message);await native.writeFunctional(JSON.stringify({type:'failure',error:error.message,stack:error.stack}));});},[]);return <View style={{padding:30}}><Text>{text}</Text></View>;}
