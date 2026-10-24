const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..'), workspace = path.resolve(process.argv[2] || 'C:/sf-5c-20261024');
execFileSync(process.execPath, [path.join(root, 'scripts/phase5b2/prepare-android.cjs'), workspace], {stdio:'inherit'});
const record = JSON.parse(fs.readFileSync(path.join(workspace, 'source-fingerprints.json'), 'utf8'));
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
function write(file, value, reason) {
  fs.writeFileSync(path.join(workspace, file), value);
  record.hashes[file] = hash(value); record.adaptations[file] = reason;
}
const native = 'android/app/src/main/java/com/smartfin/';
const deletion = native + 'SmartFinFinancialDeletion.kt';
const original = fs.readFileSync(path.join(root, deletion), 'utf8');
record.originalHashes[deletion] = hash(original);
write(deletion, original.replace('val resource = array.getString(index)', 'val resource = array.getString(index); Phase5B2Probe.hit("cleanup.before:" + key)')
  .replace('write(context, id) { remove(it, key, resource) }', 'Phase5B2Probe.hit("cleanup.after:" + key); write(context, id) { remove(it, key, resource) }')
  .replace('write(context, id) { it.put("phase", "completed") }', 'Phase5B2Probe.hit("cleanup.beforeCompleted"); write(context, id) { it.put("phase", "completed") }')
  .replaceAll('return JSONObject().put("status", "completed").put("id", id)', 'Phase5B2Probe.hit("cleanup.response"); return JSONObject().put("status", "completed").put("id", id)'),
  'Test-only fault hooks around native cleanup effects/progress; production protocol unchanged');
const managed = 'src/database/managedSQLite.ts';
let source = fs.readFileSync(path.join(workspace, managed), 'utf8');
source = source.replace('return raw.executeSql(sql, values);', `const fault = (globalThis as unknown as { __deletionFault?: { write: number; count: number; phase: string } }).__deletionFault;
            const selected = fault && /^\\s*(INSERT|UPDATE|DELETE|REPLACE)\\b/i.test(sql) && ++fault.count === fault.write;
            if (selected && fault.phase === 'before') throw new Error('Injected before deletion write');
            const rows = await raw.executeSql(sql, values);
            if (selected && fault.phase === 'after') throw new Error('Injected after deletion write');
            return rows;`);
source = source.replace('const result = await handle.connection.raw.executeSql(sql);', `if (sql.startsWith('COMMIT') && (globalThis as unknown as { __deletionCommitBefore?: boolean }).__deletionCommitBefore) throw new Error('Injected before COMMIT response');
  const result = await handle.connection.raw.executeSql(sql);`);
write(managed, source, 'Synthetic before/after SQL and COMMIT response loss; same installed driver');
const control = native+'Phase5B2Package.kt';
source = fs.readFileSync(path.join(workspace, control), 'utf8').replace('  @ReactMethod fun inspect(', `
  @ReactMethod fun alarmExists(id: String, epoch: String, promise: Promise) = run(promise) {
    val uri = if(epoch == "legacy") "smartfin-reminder:" + android.net.Uri.encode(id) else "smartfin-reminder-epoch:$epoch:" + android.net.Uri.encode(id)
    android.app.PendingIntent.getBroadcast(context,0,Intent(context,SmartFinSubscriptionReminderReceiver::class.java).apply { data=android.net.Uri.parse(uri) },android.app.PendingIntent.FLAG_NO_CREATE or android.app.PendingIntent.FLAG_IMMUTABLE) != null
  }
  @ReactMethod fun isolation(promise: Promise) = run(promise) {
    check(!File("/data/user/0/com.smartfin/databases/smartfin.db").canRead())
    check(!context.getDatabasePath("smartfin.db").exists())
    JSONObject().put("productionDatabaseReadable",false).put("uid",Process.myUid()).toString()
  }
  @ReactMethod fun waitWorkersIdle(promise: Promise) = run(promise) {
    val manager=androidx.work.WorkManager.getInstance(context)
    val deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(30)
    while(true) {
      val infos=manager.getWorkInfosForUniqueWork(SmartFinSubscriptionRemindersModule.MAINTENANCE).get() + manager.getWorkInfosForUniqueWork(SmartFinSubscriptionRemindersModule.RECOVERY).get()
      if(infos.none { SmartFinSubscriptionWorker.isExecuting(it.id) }) break
      check(System.nanoTime()<deadline); Thread.sleep(20)
    }; true
  }
  @ReactMethod fun stagePublication(id: String, state: String, promise: Promise) = run(promise) {
    check(java.util.UUID.fromString(id).toString()==id)
    check(state in setOf("prepared","snapshotValidated","publicationPending","verified","failed","uncertain"))
    val file=android.util.AtomicFile(File(context.noBackupFilesDir,"smartfin-backup-jobs/$id.json"))
    val job=JSONObject(file.openRead().bufferedReader().use { it.readText() });job.put("state",state)
    val stream=file.startWrite();try {stream.write(job.toString().toByteArray());file.finishWrite(stream)} catch(e:Exception) {file.failWrite(stream);throw e};true
  }
  @ReactMethod fun privateResources(promise: Promise) = run(promise) {
    JSONObject().put("snapshots",JSONArray(File(context.noBackupFilesDir,"smartfin-local-snapshots").listFiles().orEmpty().filter{it.isDirectory}.map{it.name}))
      .put("staging",JSONArray(File(context.noBackupFilesDir,"smartfin-backup-jobs").listFiles().orEmpty().filter{it.isDirectory}.map{it.name})).toString()
  }
  @ReactMethod fun inspect(`);
write(control, source, 'Adds isolated AlarmManager PendingIntent and UID access probes; never opens financial production DB');
const harness = 'scripts/phase5c/deletionHarness.js';
source = fs.readFileSync(path.join(root, harness), 'utf8'); record.originalHashes[harness] = hash(source);
write('deletionHarness.js', source, 'Synthetic phase 5C dispatcher');
source = fs.readFileSync(path.join(workspace, 'Harness.jsx'), 'utf8');
source = "import {runDeletion} from './deletionHarness';\n" + source.replace('async function run(campaign) {', `async function run(campaign) {
  if(campaign.startsWith('phase5c-')) { await runDeletion(campaign, {owned,seed,record,control,backup,check}); return; }`);
write('Harness.jsx', source, 'Runs new deletion and existing 5B regressions in same isolated release package');
const encoded = JSON.stringify(record,null,2);
fs.writeFileSync(path.join(workspace,'source-fingerprints.json'),encoded);
fs.writeFileSync(path.join(workspace,'android/app/src/main/assets/phase5b2-source-fingerprints.json'),encoded);
console.log(workspace);
