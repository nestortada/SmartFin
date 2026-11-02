// This component is copied only into the disposable visual-test workspace.
// The original AppNavigator and DashboardScreen remain unchanged.
import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import App from './App';
import {openSmartFinDatabase} from './src/database/sqliteDatabase';
import {runSharedSQLiteTransaction} from './src/database/atomicSQLite';

const KEY='visual-synthetic-fixture-v1';
async function seedSyntheticFixture() {
  const database=await openSmartFinDatabase();
  const result=await runSharedSQLiteTransaction(database,async participant=>{
    const [found]=await participant.executeSql(
      'SELECT setting_value FROM app_settings WHERE setting_key=?',[KEY]);
    if(found.rows.length) return 'existing';
    const date='2026-11-01';
    await participant.executeSql(
      'INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      ['visual-bank','Cuenta sintética','bankAccount','active','COP',1050000,date,date]);
    await participant.executeSql(
      'INSERT INTO categories(id,name,type,macro_category,color) VALUES (?,?,?,?,?)',
      ['visual-food','Alimentación de prueba','expense','Necesidades','#FFBE70']);
    await participant.executeSql(
      'INSERT INTO transactions(id,amount,currency,description,date,account_id,category_id,type,direction,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      ['visual-expense',50000,'COP','Compra sintética',date,'visual-bank','visual-food','expense','outflow','posted',date,date]);
    await participant.executeSql(
      'INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ['visual-income',100000,'COP','Ingreso sintético',date,'visual-bank','income','inflow','posted',date,date]);
    await participant.executeSql(
      'INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES (?,?,?)',
      [KEY,'seeded',date]);
    return 'seeded';
  });
  if(result.status!=='confirmed')
    throw new Error('Synthetic fixture initialization was not confirmed: '+result.status);
}

export default function VisualBootstrap() {
  const [status,setStatus]=useState('loading');
  useEffect(()=>{
    let mounted=true;
    seedSyntheticFixture().then(()=>{
      if(mounted) setStatus('ready');
    }).catch(error=>{
      if(mounted) setStatus('error: '+String(error));
    });
    return ()=>{mounted=false;};
  },[]);
  if(status==='ready') return <App/>;
  return <View style={{flex:1,justifyContent:'center',padding:24}}>
    <Text accessibilityRole="text">
      {status==='loading' ? 'Preparando datos sintéticos…' :
        'Error al iniciar entorno visual sintético: '+status}
    </Text>
  </View>;
}
