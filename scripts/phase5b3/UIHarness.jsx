import React, {useEffect, useState} from 'react';
import {Linking, NativeModules, Text} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import Harness from './Harness';
import {AppNavigator} from './src/navigation/AppNavigator';

/** Test-only entry; no personal DB, no production flag change, no real picker. */
export default function UIHarness() {
  const [mode,setMode]=useState();
  useEffect(()=>{ (async()=>{
    const url=await Linking.getInitialURL(); const campaign=url?.split('/').pop();
    if(!campaign?.startsWith('ui-') || campaign === 'ui-prepare') { setMode('campaign'); return; }
    const control=NativeModules.Phase5B2Control;
    await control.configureSaf();
    if(campaign==='ui-fail') await control.fault('create:smartfin-backup.db');
    if(campaign==='ui-uncertain') await control.fault('partial:cuentas.csv');
    if(campaign==='ui-revoked') await control.fault('revoked');
    setMode('ui');
  })().catch(error=>setMode(String(error))); },[]);
  if(mode==='campaign') return <Harness/>;
  if(mode==='ui') return <SafeAreaProvider><AppNavigator/></SafeAreaProvider>;
  return <Text>{mode || 'Preparando interfaz sintética'}</Text>;
}
