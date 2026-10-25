import React, {useEffect, useState} from 'react';
import {AppState, Linking, NativeModules, Pressable, Text, View} from 'react-native';
import Harness from './Harness';
import App from './src/app/App';
import {deleteFinancialData} from './src/modules/settings/useCases/deleteFinancialData';
import {createSqliteFinancialDataRepository} from './src/modules/settings/repositories/sqliteFinancialDataRepository';
import {openSmartFinDatabase} from './src/database/sqliteDatabase';

/** Phase 5E.3 test-only entry: mounts the complete production App (maintenance,
 * navigator and its open/foreground recovery). No personal DB, no real picker. */
const control = NativeModules.Phase5B2Control;
const note = message => { console.log('SMARTFIN_5E3_UI:' + message); return control.observeAppend ? control.observeAppend(message) : undefined; };

export default function UIHarness() {
  const [mode, setMode] = useState();
  useEffect(() => { (async () => {
    const url = await Linking.getInitialURL(); const campaign = url?.split('/').pop();
    if (!campaign?.startsWith('ui-')) { setMode('campaign'); return; }
    await control.configureSaf();
    if (campaign === 'ui-backup-slow') {
      // Same gates as 5B.3: visible native stages; released by explicit test buttons.
      await control.arm('snapshot.beforeCopy', false);
      await control.fault('pause:create:smartfin-backup.db');
    }
    if (campaign === 'ui-foreground') {
      // Stage a confirmed deletion with pending cleanup while the app is in the
      // background, so only the production foreground listener can resume it.
      let staged = false;
      const listener = AppState.addEventListener('change', state => {
        if (state !== 'background' || staged) return;
        staged = true;
        (async () => {
          await control.arm('cleanup.before:reminderIds', true);
          const result = await deleteFinancialData(createSqliteFinancialDataRepository(await openSmartFinDatabase()));
          note('staged:' + result.status + ':' + result.cleanup);
          listener.remove();
        })().catch(error => note('stage-error:' + String(error)));
      });
    }
    note('mount:' + campaign);
    setMode(campaign);
  })().catch(error => setMode(String(error))); }, []);
  if (mode === 'campaign') return <Harness />;
  if (mode?.startsWith('ui-')) return <View style={{flex: 1}}>
    {mode === 'ui-backup-slow' ? <View style={{flexDirection: 'row', backgroundColor: '#eeeeee', paddingTop: 24}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Liberar captura de prueba" onPress={() => control.resume()} style={{padding: 12}}><Text>Liberar captura de prueba</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Liberar SAF de prueba" onPress={() => control.resumeSaf()} style={{padding: 12}}><Text>Liberar SAF de prueba</Text></Pressable>
    </View> : null}
    <App />
  </View>;
  return <Text>{mode || 'Preparando interfaz sintética'}</Text>;
}
