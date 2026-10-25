/* global __filename */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const workspace=path.resolve(process.argv[2]||'C:/sf-5e1-receiver-worker-20261024');
execFileSync(process.execPath,[path.join(__dirname,'prepare-android.cjs'),workspace],{stdio:'inherit'});
const fingerprint=path.join(workspace,'source-fingerprints.json');
const record=JSON.parse(fs.readFileSync(fingerprint,'utf8'));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function adapt(file,transform,reason){
  const value=transform(fs.readFileSync(path.join(workspace,file),'utf8'));
  fs.writeFileSync(path.join(workspace,file),value);record.hashes[file]=hash(value);record.adaptations[file]=reason;
}
record.originalHashes['scripts/phase5e1/prepare-receiver-worker.cjs']=hash(fs.readFileSync(__filename));
adapt('android/app/src/main/java/com/smartfin/Phase5B2Package.kt',source=>source.replace('  @ReactMethod fun inspect(',`
  @ReactMethod fun receiverWorkerRace(promise: Promise) = run(promise) {
    Phase5B2Probe.stage="cleanup.acquired"; Phase5B2Probe.fail=false
    Phase5B2Probe.reached=CountDownLatch(1); Phase5B2Probe.proceed=CountDownLatch(1)
    Phase5E1RecoveryProbe.finished=CountDownLatch(1)
    val before=Process.myPid()
    context.sendBroadcast(Intent(context,SmartFinSubscriptionRecoveryReceiver::class.java).setAction("com.smartfin.tests.OWNER_RECOVERY"))
    check(Phase5B2Probe.reached.await(5,TimeUnit.SECONDS)) { "Receiver did not acquire actual cleanup mutex" }
    val manager=androidx.work.WorkManager.getInstance(context)
    val request=androidx.work.OneTimeWorkRequestBuilder<SmartFinSubscriptionWorker>().build()
    val result=JSONObject().put("owner","actual broadcast receiver executor").put("pidBefore",before)
    try {
      check(Phase5E1RecoveryProbe.finished.count==1L)
      manager.enqueue(request).result.get(5,TimeUnit.SECONDS)
      val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10)
      var info=manager.getWorkInfoById(request.id).get(2,TimeUnit.SECONDS)
      while(System.nanoTime()<deadline && !((info?.runAttemptCount ?: 0)>0 && info?.state==androidx.work.WorkInfo.State.ENQUEUED)) {
        Thread.sleep(30); info=manager.getWorkInfoById(request.id).get(2,TimeUnit.SECONDS)
      }
      check((info?.runAttemptCount ?: 0)>0 && info?.state==androidx.work.WorkInfo.State.ENQUEUED) { "Worker did not retry under receiver ownership: $info" }
      check(Phase5E1RecoveryProbe.finished.count==1L) { "Receiver prematurely released ownership" }
      var rejected=false
      try { SmartFinFinancialDeletion.recover(context) }
      catch(_:SmartFinFinancialDeletion.CleanupAlreadyRunningException){rejected=true}
      check(rejected) { "Worker released receiver mutex" }
      result.put("workerState",info!!.state.name).put("workerAttempt",info!!.runAttemptCount)
        .put("receiverStillActive",true).put("thirdContenderRejected",rejected)
    } finally {
      manager.cancelWorkById(request.id).result.get(5,TimeUnit.SECONDS)
      Phase5B2Probe.proceed.countDown()
    }
    check(Phase5E1RecoveryProbe.finished.await(10,TimeUnit.SECONDS)) { "Receiver did not finish after resume" }
    result.put("pidAfter",Process.myPid()).put("subsequent",SmartFinFinancialDeletion.recover(context))
      .put("uncaughtHandlerInstalled",false).toString()
  }
  @ReactMethod fun inspect(`),'Supplemental actual receiver owns cleanup while actual Worker retries; no exception interception');
adapt('fixHarness.js',source=>source.replace("  const f=await integratedFixture(database,createSubscriptionReminderService());",`
  if(campaign==='phase5e1-receiver-worker') {
    await control.recoveryEnabled(true);
    await record('actual-receiver-owner-and-worker-simultaneous',async()=>{
      const before=JSON.parse(await control.liveEvidence());
      const result=JSON.parse(await control.receiverWorkerRace());
      check(result.pidBefore===result.pidAfter && result.receiverStillActive && result.thirdContenderRejected,'Ownership/process regression');
      const after=JSON.parse(await control.liveEvidence());
      check(JSON.stringify(before.allTables)===JSON.stringify(after.allTables),'Concurrent recovery changed finances');
      return {result,before,after};
    });
    await record('worker-headless-after-receiver-release',async()=>{
      const before=JSON.parse(await control.liveEvidence());
      const worker=await control.runWorker();
      const after=JSON.parse(await control.liveEvidence());
      check(JSON.stringify(before.allTables)===JSON.stringify(after.allTables),'Headless replayed finances');
      return {worker,after};
    });return;
  }
  const f=await integratedFixture(database,createSubscriptionReminderService());`),'Supplemental strict simultaneous receiver/Worker ownership plus subsequent real Headless completion');
const encoded=JSON.stringify(record,null,2);
fs.writeFileSync(fingerprint,encoded);
fs.writeFileSync(path.join(workspace,'android/app/src/main/assets/phase5b2-source-fingerprints.json'),encoded);
console.log(workspace);
