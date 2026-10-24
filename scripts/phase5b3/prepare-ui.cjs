const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),workspace=path.resolve(process.argv[2]||'C:/sf-5b3ui-20261023');
execFileSync(process.execPath,[path.join(__dirname,'prepare.cjs'),workspace],{stdio:'inherit'});
const record=JSON.parse(fs.readFileSync(path.join(workspace,'source-fingerprints.json'),'utf8'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function write(file,text,reason){fs.writeFileSync(path.join(workspace,file),text);record.hashes[file]=hash(text);record.adaptations[file]=reason;}
let s=fs.readFileSync(path.join(workspace,'UIHarness.jsx'),'utf8');
s=s.replace("{Linking, NativeModules, Text}","{DeviceEventEmitter, Linking, NativeModules, Pressable, Text, View}");
s=s.replace("    await control.configureSaf();",`    await control.configureSaf();
    const observations=[]; let report=Promise.resolve();
    DeviceEventEmitter.addListener('SmartFinBackupProgress', value=>{
      observations.push(value);
      const json=JSON.stringify({config:control.getConstants(),campaign,observations:[...observations]});
      report=report.then(()=>control.report(json));
    });
    if(campaign==='ui-slow') {
      await control.arm('snapshot.beforeCopy', false);
      await control.fault('pause:create:smartfin-backup.db');
    }
    if(campaign==='ui-recoverinspect') await control.arm('progress:inspectingSnapshot', false);
    if(campaign==='ui-recoverexternal') await control.arm('progress:validatingComponents', false);`);
s=s.replace("    if(campaign==='ui-fail')", "    if(campaign==='ui-finalfail') await control.fault('publication.beforeCommit');\n    if(campaign==='ui-fail')");
s=s.replace("    if(campaign==='ui-recoverinspect')", "    if(campaign==='ui-publishslow') await control.arm('progress:publicationPending', false);\n    if(campaign==='ui-recoverinspect')");
s=s.replace('<SafeAreaProvider><AppNavigator/></SafeAreaProvider>',`<SafeAreaProvider><View style={{flex:1}}>
    <View style={{flexDirection:'row',backgroundColor:'#eeeeee',paddingTop:24}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Liberar captura de prueba" onPress={()=>NativeModules.Phase5B2Control.resume()} style={{padding:12}}><Text>Liberar captura de prueba</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Liberar SAF de prueba" onPress={()=>NativeModules.Phase5B2Control.resumeSaf()} style={{padding:12}}><Text>Liberar SAF de prueba</Text></Pressable>
    </View><AppNavigator/></View></SafeAreaProvider>`);
write('UIHarness.jsx',s,'UI-only: native stage gates, explicit release controls and actual event transcript. Not performance measurements.');
const publisher='android/app/src/main/java/com/smartfin/SmartFinBackupPublisher.kt';
s=fs.readFileSync(path.join(workspace,publisher),'utf8').replace('observer?.invoke(phase, completed, total)','observer?.invoke(phase, completed, total); Phase5B2Probe.hit("progress:" + phase)');
write(publisher,s,'UI-only: gate after emitting actual native phase so visible progress can be inspected; no stages bypassed.');
for(const name of ['Phase5B2Package.kt','SyntheticBackupProvider.kt']) {
  const file='android/app/src/main/java/com/smartfin/'+name;
  const text=fs.readFileSync(path.join(workspace,file),'utf8').replace('proceed.await(30,','proceed.await(180,').replace('proceed.await(60,','proceed.await(180,');
  write(file,text,'UI-only gate timeout extended for visual inspection; these times are excluded from performance.');
}
const encoded=JSON.stringify(record,null,2);
fs.writeFileSync(path.join(workspace,'source-fingerprints.json'),encoded);
fs.writeFileSync(path.join(workspace,'android/app/src/main/assets/phase5b2-source-fingerprints.json'),encoded);
console.log(workspace);
