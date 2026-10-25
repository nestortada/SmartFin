// Deterministic test-only reproduction of the observed HONOR recovery crash.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const workspace = path.resolve(process.argv[2] || 'C:/sf-5e-race-20261024');
execFileSync(process.execPath, [path.join(__dirname, 'prepare-android.cjs'), workspace], {stdio: 'inherit'});
const fingerprint = path.join(workspace, 'source-fingerprints.json');
const record = JSON.parse(fs.readFileSync(fingerprint, 'utf8'));
function adapt(file, transform, reason) {
  const target = path.join(workspace, file);
  const source = transform(fs.readFileSync(target, 'utf8'));
  fs.writeFileSync(target, source);
  record.hashes[file] = crypto.createHash('sha256').update(source).digest('hex');
  record.adaptations[file] = reason;
}
adapt('android/app/src/main/java/com/smartfin/Phase5B2Package.kt', source => source.replace('  @ReactMethod fun inspect(', `
  @ReactMethod fun cleanupContention(promise: Promise) = run(promise) {
    // Hold the actual existing production mutex. Reflection is confined to this
    // synthetic module; no production lock or receiver behavior is patched.
    val field = SmartFinFinancialDeletion::class.java.getDeclaredField("cleanup")
    field.isAccessible = true
    val lock = field.get(null) as java.util.concurrent.locks.ReentrantLock
    val prior = Thread.getDefaultUncaughtExceptionHandler()
    val failure = java.util.concurrent.atomic.AtomicReference<Throwable>()
    val reached = CountDownLatch(1)
    val events = JSONObject()
    lock.lock()
    try {
      val direct = java.util.concurrent.CompletableFuture<String>()
      Thread {
        try { SmartFinFinancialDeletion.recover(context); direct.complete("unexpected success") }
        catch(error: Exception) { direct.complete(error.toString()) }
      }.start()
      events.put("contendingRecover", direct.get(5, TimeUnit.SECONDS))
      // Observe the actual receiver's uncaught exception without killing this
      // diagnostic process. The original unhandled physical crash is retained.
      Thread.setDefaultUncaughtExceptionHandler { thread, error ->
        if(error.message == "Cleanup already running" && error.stackTrace.any { it.className.contains("SmartFinSubscriptionRecoveryReceiver") }) {
          failure.set(error); reached.countDown()
        } else { prior?.uncaughtException(thread,error) }
      }
      SmartFinSubscriptionRecoveryReceiver().onReceive(context,Intent().setAction("android.intent.action.BOOT_COMPLETED"))
      check(reached.await(5,TimeUnit.SECONDS)) { "Receiver did not expose the expected uncaught exception" }
      events.put("receiverUncaught",failure.get().toString())
        .put("receiverStack",failure.get().stackTraceToString())
        .put("interceptedOnlyByHarness",true)
        .put("receiverInvocation","explicit harness; not automatic BOOT delivery")
    } finally { Thread.setDefaultUncaughtExceptionHandler(prior); lock.unlock() }
    events.toString()
  }
  @ReactMethod fun inspect(`), 'Diagnostic only: hold real cleanup mutex and observe actual receiver uncaught exception; preserve production logic');
adapt('reminderHarness.js', source => source.replace("  if(campaign==='phase5d-reboot-verify') {", `
  if(campaign==='phase5d-contention') {
    await openSmartFinDatabase();
    await record('actual-recovery-receiver-exposes-unhandled-cleanup-contention', async()=>{
      const before=JSON.parse(await control.liveEvidence());
      const probe=JSON.parse(await control.cleanupContention());
      const after=JSON.parse(await control.liveEvidence());
      check(probe.contendingRecover.includes('Cleanup already running'),'Wrong contending failure');
      check(probe.receiverUncaught.includes('Cleanup already running'),'Receiver did not expose failure');
      check(JSON.stringify(before.allTables)===JSON.stringify(after.allTables),'Diagnostic changed tables');
      return {expectedProductionDefect:'5E-002',probe,before,after};
    });return;
  }
  if(campaign==='phase5d-reboot-verify') {`), 'Deterministic diagnostic for 5E-002; table fingerprints before/after; no financial replay');
record.diagnosticOnly = '5E-002 actual recovery mutex/receiver contention; interception is evidence, not a production fix';
fs.writeFileSync(fingerprint, JSON.stringify(record, null, 2));
const assets = path.join(workspace, 'android/app/src/main/assets');
fs.mkdirSync(assets, {recursive: true});
fs.copyFileSync(fingerprint, path.join(assets, 'phase5b2-source-fingerprints.json'));
console.log('Prepared recovery contention diagnostic at ' + workspace);
