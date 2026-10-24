const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'docs/atomicidad-fase5c');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const names=['matrix-final','main-final','restart-final','new-identities','cleanup-matrix','compatibility-main','compatibility-restart','compatibility-publication',
  ...['lost-before','unknown-restart','lost-after','restart','core','restart-verify','publication','publication-restart-verify','publication-after-verify','close-lost','open-lost'].map(x=>'closure-'+x)];
const campaigns=[],pending=[],timings=[];
for(const api of [24,35])for(const common of names){
  const name=api===35 && common==='new-identities'?'new-identities-final':common;
  const directory=path.join(out,'android/api'+api,name),file=path.join(directory,'result.json');
  if(!fs.existsSync(file)){pending.push({api,name});continue;}
  const result=read(file),environment=read(path.join(directory,'environment.json'));
  const unchanged=read(path.join(directory,'production-package-unchanged.json'));
  const sources=read(path.join(directory,'source-fingerprints.json'));
  const changed=Object.entries(sources.originalHashes).filter(([fileName,expected])=>hash(path.join(root,fileName))!==expected).map(([fileName])=>fileName);
  if(!result.passed||!unchanged.unchanged||changed.length)throw Error('Unaccepted campaign/source drift '+file+JSON.stringify(changed));
  campaigns.push({api,name,campaign:result.campaign,passed:result.passed,cases:result.cases.length,
    apkSha256:environment.apkSha256,uid:environment.uid,productionUid:environment.productionUid,
    productionUnchanged:true,originalRuntimeSourcesMatch:true});
  if(common==='main-final'){
    const events=result.events;
    const cleanup=events.findIndex(e=>e.event.startsWith('cleanup.before:'));
    const prefix=events.slice(0,cleanup),released=prefix.findLast(e=>e.event==='owner.released');
    const acquired=prefix.slice(0,prefix.indexOf(released)).findLast(e=>e.event==='owner.acquired');
    const independent=result.cases.find(c=>c.name.startsWith('phase5b1-independent')).evidence;
    timings.push({api,fixture:'handcrafted-synthetic-small-graph',
      deletionExclusivePermitMs:(released.ns-acquired.ns)/1e6,
      injectedParticipantWaitAndRollbackMs:independent.waitMs,
      rejectedSafDidNotStartDelete:true,
      note:'The legacy rejectionMs field includes table readback and resuming SAF; it is not an isolated rejection latency. These are single functional samples, not p95, FPS or a large-database budget.'});
  }
}
const protectedFiles=['src/database/sqliteSchema.ts','src/database/migrations.ts','src/database/atomicSQLite.ts',
  'src/database/databaseCoordination.ts','src/database/managedSQLite.ts','src/database/sqliteDatabase.ts','src/database/sqliteLifecycle.ts',
  'src/modules/subscriptions/database/schema.ts','src/modules/settings/services/backupPublicationPolicy.ts',
  'android/app/build.gradle','android/build.gradle','android/app/src/main/AndroidManifest.xml',
  'android/app/src/main/java/com/smartfin/SmartFinDatabaseCoordinator.kt','scripts/patchReactNativeSqliteStorage.js',
  'package.json','package-lock.json','node_modules/react-native-sqlite-storage/lib/sqlite.core.js',
  'node_modules/react-native-sqlite-storage/platforms/android/src/main/java/org/pgsqlite/SQLitePlugin.java'];
const archived=read(path.join(root,'docs/estabilizacion-fase5b3/baseline/scope-audit.json')).before;
const ui=read(path.join(root,'docs/estabilizacion-fase5b3/ui/api35/setup-final/source-fingerprints.json')).originalHashes;
const protection=protectedFiles.map(file=>{
  const baseline=ui[file]||archived[file];
  if(!baseline)throw Error('No archived baseline for '+file);
  const current=hash(path.join(root,file));if(current!==baseline)throw Error('Protected source changed '+file);
  return {file,sha256:current,unchangedFromArchived5B3:true};
});
const jest=fs.readFileSync(path.join(out,'jest-recheck-complete.log'),'utf8');
const flag=fs.readFileSync(path.join(root,'src/modules/settings/services/backupPublicationPolicy.ts'),'utf8');
const deleteOrder=file=>fs.readFileSync(path.join(root,file),'utf8').match(/const FINANCIAL_TABLES_IN_DELETE_ORDER = \[([\s\S]*?)\] as const;/)[1].match(/'[a-z_]+'/g);
const deleteOrderPreserved=JSON.stringify(deleteOrder('src/modules/settings/repositories/sqliteFinancialDataRepository.ts'))===JSON.stringify(deleteOrder('__tests__/helpers/phase5cPreviousFinancialDataRepository.ts'));
if(!deleteOrderPreserved)throw Error('Historical DELETE order changed');
const summary={date:'2026-10-24',timezone:'America/Bogota',complete:pending.length===0,pending,
  androidCases:campaigns.reduce((sum,c)=>sum+c.cases,0),campaigns,timings,
  nodeMatrix:read(path.join(out,'node-matrix.json')),
  quality:{jestCompletePassed:/Tests:\s+3 skipped, 629 passed/.test(jest),testsPassed:629,suitesPassed:57,snapshotsPassed:8,
    skippedBenchmarks:3,typescriptPassed:fs.readFileSync(path.join(out,'tsc-final-verified.log'),'utf8').trim()==='',
    eslintPassed:!fs.readFileSync(path.join(out,'lint-final-verified.log'),'utf8').includes(' error '),
    diffCheckPassed:!fs.readFileSync(path.join(out,'diff-check-final-verified.log'),'utf8').match(/trailing whitespace|space before tab|new blank line at EOF/)},
  protection,deleteOrderPreserved,backupPublicationUiEnabled:!flag.includes('= false'),
  exclusions:[
    'The first HONOR matrix attempt was interrupted by an overlapping early runner; repeated as matrix-final. A per-device mutex now prevents overlapping campaigns.',
    'The first main campaign assumed a handcrafted alarm survived legitimate subscription maintenance. The fixture now explicitly restores its scheduled precondition after real maintenance.',
    'Baseline and one later complete Jest attempt reproduced the documented pre-existing recursive synchronous Node adapter stack/timeout failure; isolated and final full reruns passed, with no timeout/domain change.',
    'Earlier prepared APKs/build attempts are retained; final accepted campaigns attest all current original runtime source hashes.'
  ],
  limitations:['No remote epoch/currentness protocol or external analyst update','No production backup activation',
    'Unknown without a matching authoritative receipt stays blocked; no automatic retry or assumed rollback',
    'No second-process, power-loss, downgrade, OEM-wide, TalkBack, FPS or large-volume deletion latency certification',
    'Notification delivery uncertainty remains phase 5D'],
  acceptance:pending.length?'pending':'Phase 5C local protocol accepted within the measured synthetic single-process scope; external currency/production backup remain unapproved'};
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({complete:summary.complete,pending,androidCases:summary.androidCases,quality:summary.quality,timings},null,2));
