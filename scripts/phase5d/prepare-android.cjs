// Real native receiver, same installed driver; adaptations only in an isolated APK.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..'), workspace = path.resolve(process.argv[2] || 'C:/sf-5d-20261024');
execFileSync(process.execPath, [path.join(root, 'scripts/phase5c/prepare-android.cjs'), workspace], {stdio:'inherit'});
const record = JSON.parse(fs.readFileSync(path.join(workspace,'source-fingerprints.json'),'utf8'));
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
function write(file, source, reason) {
  fs.writeFileSync(path.join(workspace,file),source); record.hashes[file]=hash(source); record.adaptations[file]=reason;
}
const native='android/app/src/main/java/com/smartfin/';
// 5B preparer historically omitted this new 5C object from a fresh workspace.
write(native+'SmartFinFinancialDeletion.kt',fs.readFileSync(path.join(root,native+'SmartFinFinancialDeletion.kt'),'utf8').replaceAll('"smartfin.db"','"phase5b2_synthetic.db"'),'Current 5C cleanup protocol, synthetic database only');
function instrument(source) {
  return source.replace('val id = intent.getStringExtra', 'Phase5DProbe.hit(context,"entered"); val id = intent.getStringExtra')
    .replace('if (!SmartFinFinancialDeletion.resourcesAllowed', 'Phase5B2Probe.hit("receiver.active"); if (!SmartFinFinancialDeletion.resourcesAllowed')
    .replace('val content = db.rawQuery', 'Phase5DProbe.event("query.start"); val content = db.rawQuery')
    .replace('SmartFinSubscriptionRemindersModule.ensureChannel(context)', 'Phase5DProbe.hit(context,"validated"); SmartFinSubscriptionRemindersModule.ensureChannel(context)')
    .replace('manager.notify(', 'Phase5DProbe.hit(context,"beforeNotify",db.inTransaction()); manager.notify(')
    .replace('1,notification)', '1,notification); Phase5DProbe.notified(context); Phase5DProbe.hit(context,"afterNotify",db.inTransaction())')
    .replace('db.execSQL("UPDATE subscription_reminders SET delivery_status=\'delivered\'', 'Phase5DProbe.hit(context,"beforeAck"); db.execSQL("UPDATE subscription_reminders SET delivery_status=\'delivered\'')
    .replace(/arrayOf<Any>\(id,revision\)\)\r?\n(\s*)} else/, 'arrayOf<Any>(id,revision)); Phase5DProbe.hit(context,"afterAck")\n$1} else')
    .replace('} finally { db.endTransaction() }','} finally { db.endTransaction() }; Phase5DProbe.hit(context,"afterCommit")')
    .replace('} catch (_: Exception) {\n        SmartFinSubscriptionRemindersModule.enqueueRecovery', '} catch (e: Exception) {\n        Phase5DProbe.event("caught:"+e.javaClass.simpleName); SmartFinSubscriptionRemindersModule.enqueueRecovery')
    .replace('pendingResult?.finish()', 'pendingResult?.finish(); Phase5DProbe.finished.countDown()');
}
let file=native+'SmartFinSubscriptionReminderReceiver.kt';
write(file,instrument(fs.readFileSync(path.join(root,file),'utf8')).replace('pending.finish()', 'pending?.finish()'),'Test-only barriers/faults/timing around real receiver and notify; nullable PendingResult permits explicit injected recovery callbacks; no replacement OS service');
const baseline='docs/atomicidad-fase5d/baseline-sources/SmartFinSubscriptionReminderReceiver.kt';
const original=fs.readFileSync(path.join(root,baseline),'utf8'); record.originalHashes[baseline]=hash(original);
write(native+'Phase5DBaselineReceiver.kt',instrument(original.split('class SmartFinSubscriptionRecoveryReceiver')[0].replace('class SmartFinSubscriptionReminderReceiver','class Phase5DBaselineReceiver')),'Frozen pre-5D receiver; class rename and same probe hooks only');
file=native+'SmartFinSubscriptionRemindersModule.kt';
let source=fs.readFileSync(path.join(workspace,file),'utf8').replace('fun enqueueRecovery(context: Context) {','fun enqueueRecovery(context: Context) {\n      if (Phase5DProbe.suppressRecovery || java.io.File(context.filesDir,"phase5d-suppress-recovery").exists()) { Phase5DProbe.event("recovery.deferredByTest"); return }');
write(file,source,'Test-only deterministic deferral of automatic recovery during fault inspection, explicitly disabled for WorkManager/Headless campaigns');
file=native+'SmartFinSubscriptionWorker.kt'; source=fs.readFileSync(path.join(workspace,file),'utf8')
  .replace('executing.add(id)', 'if (java.io.File(applicationContext.filesDir,"phase5d-suppress-recovery").exists()) return Result.retry(); executing.add(id)');
write(file,source,'Durable test-only maintenance deferral across killed-process fixture inspection; explicitly removed for real recovery campaigns');
file=native+'Phase5B2Package.kt';
source=fs.readFileSync(path.join(workspace,file),'utf8').replace('  @ReactMethod fun inspect(', `
  @ReactMethod fun delivery(stage: String, mode: String, baseline: Boolean, revision: Double, epoch: String, promise: Promise) = run(promise) {
    Phase5DProbe.stage=stage; Phase5DProbe.mode=mode; Phase5DProbe.finished=CountDownLatch(1)
    context.sendBroadcast(Intent(context,if(baseline) Phase5DBaselineReceiver::class.java else SmartFinSubscriptionReminderReceiver::class.java)
      .putExtra("id","subscription-reminder:r").putExtra("revision",revision.toInt()).putExtra("datasetEpoch",epoch))
    check(Phase5DProbe.finished.await(25,TimeUnit.SECONDS)) { "Receiver did not finish" }
    Thread.sleep(150) // Allow asynchronous NotificationManager binder processing before active inspection.
    Phase5DProbe.evidence(context)
  }
  @ReactMethod fun deliveryEvidence(promise: Promise) = run(promise) { Phase5DProbe.evidence(context) }
  @ReactMethod fun deliveryReset(promise: Promise) = run(promise) {
    (context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).cancelAll()
    File(context.filesDir,"phase5d-notify-count").writeText("0"); Phase5DProbe.events.clear(); true
  }
  @ReactMethod fun recoveryEnabled(enabled: Boolean, promise: Promise) = run(promise) {
    Phase5DProbe.suppressRecovery = !enabled
    val file=File(context.filesDir,"phase5d-suppress-recovery"); if(enabled) file.delete() else file.writeText("synthetic fixture barrier")
    true
  }
  @ReactMethod fun removeAlarm(id: String, epoch: String, promise: Promise) = run(promise) { SmartFinSubscriptionRemindersModule.cancelAlarm(context,id,epoch); true }
  @ReactMethod fun dismissReminder(epoch: String, promise: Promise) = run(promise) {
    (context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager)
      .cancel(SmartFinSubscriptionRemindersModule.notificationTag("subscription-reminder:r",epoch),1); true
  }
  @ReactMethod fun recoveryBroadcast(action: String, promise: Promise) = run(promise) {
    check(action in setOf("android.intent.action.BOOT_COMPLETED","android.intent.action.TIME_SET","android.intent.action.TIMEZONE_CHANGED","android.intent.action.MY_PACKAGE_REPLACED"))
    SmartFinSubscriptionRecoveryReceiver().onReceive(context,Intent().setAction(action)); true
  }
  @ReactMethod fun inspect(`);
write(file,source,'Adds explicit receiver and active-notification probes, durable test call count and recovery controls');
file='scripts/phase5d/Phase5DProbe.kt'; source=fs.readFileSync(path.join(root,file),'utf8');record.originalHashes[file]=hash(source);
write(native+'Phase5DProbe.kt',source,'Isolated fault and observation code only');
file='scripts/phase5d/reminderHarness.js'; source=fs.readFileSync(path.join(root,file),'utf8');record.originalHashes[file]=hash(source);
write('reminderHarness.js',source,'Synthetic delivery and recovery scenarios');
file='Harness.jsx';source=fs.readFileSync(path.join(workspace,file),'utf8');
source="import {runReminders} from './reminderHarness';\n"+source.replace('async function run(campaign) {',`async function run(campaign) {\n  if(campaign.startsWith('phase5d-')) { await runReminders(campaign,{owned,seed,record,control,backup,check}); return; }`);
write(file,source,'Adds phase 5D dispatcher and preserves previous campaigns');
file='android/app/src/main/AndroidManifest.xml';source=fs.readFileSync(path.join(workspace,file),'utf8')
  .replace('<application','<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/><application')
  .replace('<receiver android:name="com.smartfin.SmartFinSubscriptionReminderReceiver"','<receiver android:name="com.smartfin.Phase5DBaselineReceiver" android:exported="false"/><receiver android:name="com.smartfin.SmartFinSubscriptionReminderReceiver"')
  .replace('<receiver android:name="com.smartfin.SmartFinSubscriptionRecoveryReceiver" android:exported="false"/>','<receiver android:name="com.smartfin.SmartFinSubscriptionRecoveryReceiver" android:exported="false"><intent-filter><action android:name="android.intent.action.BOOT_COMPLETED"/><action android:name="android.intent.action.MY_PACKAGE_REPLACED"/><action android:name="android.intent.action.TIME_SET"/><action android:name="android.intent.action.TIMEZONE_CHANGED"/></intent-filter></receiver>');
write(file,source,'Synthetic receiver registration including production recovery actions');
const encoded=JSON.stringify(record,null,2);
fs.writeFileSync(path.join(workspace,'source-fingerprints.json'),encoded);
fs.writeFileSync(path.join(workspace,'android/app/src/main/assets/phase5b2-source-fingerprints.json'),encoded);
console.log(workspace);
