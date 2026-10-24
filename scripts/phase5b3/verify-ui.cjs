const fs=require('node:fs');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const summaries=[];
for(const api of [24,35]) {
  const dir=`docs/estabilizacion-fase5b3/ui/api${api}`;
  const screen=name=>read(`${dir}/${name}.json`);
  const event=name=>read(`${dir}/${name}-events.json`);
  const contains=(name,text)=>screen(name).nodes.some(n=>n.text.includes(text));
  const check=(yes,message)=>{if(!yes)throw Error(`API${api}: ${message}`);};
  const cases=[];
  check(contains('slow-capturing','Capturando SQLite'),'Capture state missing');
  check(screen('slow-capturing').nodes.some(n=>n.label==='Cambiar carpeta'&&n.enabled==='false'),'Incompatible directory action enabled');
  check(contains('slow-returned','Capturando SQLite'),'Owner lost on navigation');
  check(contains('slow-result','Generación verificada mediante SAF'),'Manual result missing');
  check(contains('slow-result','Sincronización remota sin confirmar'),'Remote status confused');
  const slow=event('slow');
  check(new Set(slow.observations.map(v=>v.jobId)).size===1&&slow.observations.at(-1).state==='verified','Duplicate or unverified manual job');
  cases.push({case:'manual-double-navigation',passed:true,jobId:slow.observations[0].jobId});
  check(contains('publishslow-active','Publicando y verificando archivos'),'Publication state missing');
  check(event('publishslow').observations.at(-1).state==='verified','Publication did not finish');
  cases.push({case:'publication-progress',passed:true});
  check(contains('fail-result','Cannot create smartfin-'),'Publication failure not visible');
  const failure=event('fail'),recovery=event('recoverinspect');
  check(contains('recoverinspect-active','Inspeccionando el snapshot original'),'Original inspection not visible');
  check(contains('recoverinspect-result','Generación verificada mediante SAF'),'Recovery not verified');
  check(failure.observations[0].jobId===recovery.observations[0].jobId,'Original identity changed');
  check(recovery.observations.some(v=>v.state==='continuingPublication'),'Safe continuation missing');
  cases.push({case:'failure-restart-original-snapshot',passed:true,jobId:recovery.observations[0].jobId});
  const external=event('recoverexternal');
  check(contains('recoverexternal-active','Validando componentes externos mediante SAF'),'External phase not visible');
  check(event('finalfail').observations[0].jobId===external.observations[0].jobId,'External identity changed');
  check(external.observations.at(-1).state==='verified'&&!external.observations.some(v=>v.state==='inspectingSnapshot'),'External recovery path changed');
  cases.push({case:'external-manifest-recovery',passed:true,jobId:external.observations[0].jobId});
  check(contains('revoked-result','Android perdió el acceso'),'Lost access not reported');
  cases.push({case:'revoked-provider-access',passed:true});
  check(contains('uncertain-result','Provider content verification failed'),'Partial bytes not rejected visibly');
  check(contains('uncertain-retained','Trabajo sin verificar'),'Uncertain work not preserved');
  const uncertain=event('retained-uncertain');
  check(uncertain.campaign==='ui-recover','Wrong recovery evidence');
  check(event('uncertain').observations[0].jobId===uncertain.observations[0].jobId&&uncertain.observations.at(-1).state==='uncertain','Partial generation promoted or recaptured');
  cases.push({case:'partial-bytes-restart-remain-uncertain',passed:true,jobId:uncertain.observations[0].jobId});
  for(const name of ['slow','publishslow','fail','recoverinspect','finalfail','recoverexternal','uncertain','retained-uncertain'])
    check(event(name).config.packageId==='com.smartfin.snapshot5b2.tests','Non-synthetic evidence');
  const result={api,passed:true,cases,proof:'Validated actual XML/screenshots and native event transcripts; final API24 last-case read resumed after a transport-only failure',
    limits:'Synthetic provider faults and test-only stage gates; process restart, not OS reboot. Basic labels/disabled states, no TalkBack certification or FPS measurement.'};
  fs.writeFileSync(`${dir}/ui-results.json`,JSON.stringify(result,null,2));
  summaries.push({api,cases:cases.length,passed:true});
}
console.log(JSON.stringify(summaries));
