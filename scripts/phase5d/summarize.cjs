const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'docs/atomicidad-fase5d');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const names=['matrix','permission','recovery',...['beforeNotify','afterNotify','afterAck'].flatMap(stage=>['kill-'+stage,'restart-'+stage]),'normal-stage','normal-restart','epoch',
  ...['core','restart-verify','publication','publication-restart-verify','publication-after-verify','close-lost','open-lost'].map(x=>'regression-'+x),'reboot-stage','reboot-verify','replacement-stage','replacement-verify'];
const campaigns=[],pending=[],timings=[],protectedHashes={};
for(const api of [24,35])for(const name of names) {
  const directory=path.join(output,'android/api'+api,'accepted-'+name),file=path.join(directory,'result.json');
  if(!fs.existsSync(file)){pending.push({api,name});continue;}
  const result=read(file),environment=read(path.join(directory,'environment.json')),unchanged=read(path.join(directory,'production-package-unchanged.json'));
  const sources=read(path.join(directory,'source-fingerprints.json'));
  const changed=Object.entries(sources.originalHashes).filter(([fileName,expected])=>hash(path.join(root,fileName))!==expected).map(([fileName])=>fileName);
  if(!result.passed||!unchanged.unchanged||changed.length||result.config.uid===+environment.productionUid)throw Error('Unaccepted result/source drift '+file+' '+JSON.stringify(changed));
  Object.assign(protectedHashes,sources.originalHashes);
  campaigns.push({api,name,campaign:result.campaign,cases:result.cases.length,apkSha256:environment.apkSha256,uid:environment.uid,productionUid:environment.productionUid,productionUnchanged:true,allOriginalSourcesMatch:true});
  if(name==='matrix') {
    const sample=result.cases.find(c=>c.name==='after-failure-afterAck').evidence.first.native.events;
    const ns=name=>sample.find(e=>e.name===name||e.name.startsWith(name+':'))?.ns;
    const interval=(start,end)=>(ns(end)-ns(start))/1e6;
    const baseline=result.cases.find(c=>c.name==='before-failure-afterNotify').evidence;
    const improved=result.cases.find(c=>c.name==='after-failure-afterNotify').evidence;
    if(!baseline.first.native.events.some(e=>e.name==='beforeNotify:transaction=true')||!improved.first.native.events.some(e=>e.name==='beforeNotify:transaction=false'))throw Error('Missing actual transaction-boundary proof');
    timings.push({api,fixture:'single-synthetic-reminder',validationIncludingGateAndOpenMs:interval('entered','query.start'),queryAndEligibilityMs:interval('query.start','validated'),publicationIncludingTestCounterMs:interval('beforeNotify','afterNotify'),acknowledgementAutocommitMs:interval('beforeAck','afterAck'),
      oldNotifyCalls:baseline.retry.native.notifyCalls,newNotifyCalls:improved.retry.native.notifyCalls,activeCount:improved.retry.native.active.length,
      warning:'Functional single sample; publication includes test-only counter file I/O. Does not measure perceived alerts, p95, FPS or exact scheduling.'});
  }
  if(name==='recovery')timings.push({api,firstWorkManagerHeadlessRecoveryMs:result.cases[1].evidence.recoveryMs});
}
const quality=read(path.join(output,'quality/quality-results.json')),jest=read(path.join(output,'quality/jest-results.json'));
if(quality.results.some(r=>r.exitCode!==0)||quality.changed.length||!jest.success)throw Error('Quality checks failed');
const beforeBoot=read(path.join(output,'boot-before.json')),afterBoot=read(path.join(output,'boot-after.json'));
for(const api of [24,35])if(beforeBoot['api'+api].bootId===afterBoot['api'+api].bootId)throw Error('Actual device reboot not established');
const bootRecovery=[24,35].map(api=>{const result=read(path.join(output,'android/api'+api,'accepted-reboot-verify/result.json'));return {api,...result.cases[1].evidence};});
const summary={complete:!pending.length,pending,campaigns,totalCases:campaigns.reduce((n,c)=>n+c.cases,0),timings,
  bootRecovery:bootRecovery.map(({api,automaticAlarm,recoveryMs})=>({api,automaticAlarm,recoveryMs,note:'Automatic alarm observed before explicit recovery call; false does not identify an OEM cause. Verifier temporarily defers background maintenance until that explicit call.'})),
  quality:{testsPassed:jest.numPassedTests,suitesPassed:jest.numPassedTestSuites,snapshotsPassed:jest.snapshot.matched,results:quality.results},
  productionScope:['SmartFinSubscriptionReminderReceiver.kt'],schemaDriverDependenciesAndFinancialRulesUnchanged:true,
  limitations:['No atomic transaction between NotificationManager and SQLite','Uncertain publication may be retried; dismissal or reboot can allow another perceived alert','OnlyAlertOnce flags and stable active identity were checked on both APIs; sound/vibration/banner perception was not instrumented','TIME/TIMEZONE callbacks injected; no controlled real clock or timezone mutation campaign','No power-loss, full disk, other-process writer or OEM-wide guarantee','Synthetic durable test barriers are disabled during actual WorkManager/Headless/reboot campaigns'],
  phase5E:'Not started or authorized; acceptance decision remains explicit'};
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));
fs.writeFileSync(path.join(output,'runtime-source-hashes.json'),JSON.stringify(protectedHashes,null,2));
console.log(JSON.stringify({complete:summary.complete,pending,campaigns:campaigns.length,totalCases:summary.totalCases,timings}));
