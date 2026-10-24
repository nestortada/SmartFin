package com.smartfin

import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.os.Build
import android.os.Process
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

class Phase5B1Package : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(
    SmartFinDatabaseLifecycleModule(context), SmartFinSubscriptionRemindersModule(context),
    SmartFinDriveBackupModule(context), Phase5B1Control(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

object Phase5B1Probe {
  private val events = mutableListOf<JSONObject>()
  @Volatile var stage = ""
  @Volatile var fail = false
  @Volatile var reached = CountDownLatch(1)
  @Volatile var proceed = CountDownLatch(1)
  var snapshotFinished = CountDownLatch(1)
  @Synchronized fun event(name: String) { events.add(JSONObject().put("event", name).put("ns", System.nanoTime()).put("thread", Thread.currentThread().name)) }
  @Synchronized fun takeEvents(): String { val result = JSONArray(events).toString(); events.clear(); return result }
  fun hit(name: String) {
    event(name)
    if (name == stage) {
      reached.countDown()
      if (fail) { stage = ""; throw java.io.IOException("Injected native fault at $name") }
      check(proceed.await(30, TimeUnit.SECONDS)) { "Test barrier timed out without resource release" }
      stage = ""
    }
  }
  fun copy(input: InputStream, output: OutputStream) {
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var first = true
    while (true) {
      val count = input.read(buffer); if (count < 0) break
      output.write(buffer, 0, count)
      if (first) { first = false; hit("snapshot.duringCopy") }
    }
  }
  fun connection(db: SQLiteDatabase) {
    val result = JSONObject().put("thread", Thread.currentThread().name)
    for ((name, sql) in listOf("sqlite" to "SELECT sqlite_version()", "journal" to "PRAGMA journal_mode", "foreignKeys" to "PRAGMA foreign_keys"))
      db.rawQuery(sql, null).use { check(it.moveToFirst()); result.put(name, it.getString(0)) }
    event("connection:$result")
  }
}

class Phase5B1Control(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newCachedThreadPool()
  private var walReadDone = CountDownLatch(1)
  private var walReadStarted = CountDownLatch(1)
  override fun getName() = "Phase5B1Control"
  private fun guard() {
    check(context.packageName == "com.smartfin.snapshot5b1.tests" && !BuildConfig.DEBUG)
    check(context.getDatabasePath("phase5b1_synthetic.db").canonicalPath.startsWith(context.dataDir.canonicalPath + "/"))
  }
  private fun fileHash(): String {
    val file = context.getDatabasePath("phase5b1_synthetic.db")
    if (!file.exists()) return "absent"
    val digest = java.security.MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) } }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
  override fun getConstants(): MutableMap<String, Any> {
    guard()
    return mutableMapOf("packageId" to context.packageName, "uid" to Process.myUid(), "api" to Build.VERSION.SDK_INT,
      "model" to Build.MODEL, "database" to context.getDatabasePath("phase5b1_synthetic.db").absolutePath,
      "databaseBeforeSha256" to fileHash())
  }
  private fun run(promise: Promise, block: () -> Any?) { executor.execute { try { guard(); promise.resolve(block()) } catch (e: Exception) { promise.reject("TEST", e) } } }
  @ReactMethod fun arm(stage: String, fail: Boolean, promise: Promise) = run(promise) {
    Phase5B1Probe.stage = stage; Phase5B1Probe.fail = fail
    Phase5B1Probe.reached = CountDownLatch(1); Phase5B1Probe.proceed = CountDownLatch(1); null
  }
  @ReactMethod fun waitReached(promise: Promise) = run(promise) { check(Phase5B1Probe.reached.await(20, TimeUnit.SECONDS)); true }
  @ReactMethod fun resume(promise: Promise) = run(promise) { Phase5B1Probe.proceed.countDown(); null }
  @ReactMethod fun events(promise: Promise) = run(promise) { Phase5B1Probe.takeEvents() }
  @ReactMethod fun receiver(promise: Promise) = run(promise) {
    context.sendBroadcast(Intent(context, SmartFinSubscriptionReminderReceiver::class.java).putExtra("id", "subscription-reminder:r").putExtra("revision", 1)); null
  }
  @ReactMethod fun inspect(id: String, promise: Promise) = run(promise) {
    check(java.util.UUID.fromString(id).toString() == id)
    val file = File(File(context.noBackupFilesDir, "smartfin-local-snapshots/$id"), "snapshot.db")
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
      db.execSQL("PRAGMA foreign_keys=ON")
      val result = SmartFinLocalSnapshot.describe(db)
      db.rawQuery("SELECT balance_amount FROM accounts WHERE id='bank'", null).use { check(it.moveToFirst()); result.put("balance", it.getDouble(0)) }
      db.rawQuery("SELECT count(*) FROM ai_command_drafts WHERE phase='confirmed'", null).use { check(it.moveToFirst()); result.put("receipts", it.getInt(0)) }
      result.put("bytes", file.length()).toString()
    }
  }
  @ReactMethod fun holdIndependent(ms: Double, promise: Promise) = run(promise) {
    SmartFinDatabaseCoordinator.withParticipant { permit ->
      Phase5B1Probe.hit("independent.active")
      SmartFinSubscriptionRemindersModule.withDatabase(context, permit) { db ->
        Thread.sleep(ms.toLong())
        db.rawQuery("SELECT balance_amount FROM accounts WHERE id='bank'", null).use { check(it.moveToFirst()); it.getDouble(0) }
      }
    }
  }
  // Negative fixture: deliberately unregistered WAL writer, to force real checkpoint BUSY.
  // No production caller can use this test-only API.
  @ReactMethod fun startWalBlocker(promise: Promise) {
    walReadDone = CountDownLatch(1); walReadStarted = CountDownLatch(1)
    run(promise) {
      SQLiteDatabase.openDatabase(context.getDatabasePath("phase5b1_synthetic.db").path, null,
        SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING).use { db ->
        db.setForeignKeyConstraintsEnabled(true)
        db.beginTransactionNonExclusive()
        try {
          Phase5B1Probe.connection(db)
          db.rawQuery("SELECT balance_amount FROM accounts WHERE id='bank'", null).use { check(it.moveToFirst()); Phase5B1Probe.event("wal.blocker:" + it.getDouble(0)) }
          walReadStarted.countDown()
          check(walReadDone.await(30, TimeUnit.SECONDS))
        } finally { db.endTransaction() }
      }; true
    }
  }
  @ReactMethod fun waitWalBlocker(promise: Promise) = run(promise) { check(walReadStarted.await(10, TimeUnit.SECONDS)); true }
  @ReactMethod fun finishWalBlocker(promise: Promise) = run(promise) { walReadDone.countDown(); true }
  @ReactMethod fun runWorker(promise: Promise) = run(promise) {
    SmartFinSubscriptionRemindersModule.enqueueRecovery(context)
    val manager = androidx.work.WorkManager.getInstance(context)
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45)
    var state = ""
    while (System.nanoTime() < deadline) {
      val infos = manager.getWorkInfosForUniqueWork(SmartFinSubscriptionRemindersModule.RECOVERY).get(2, TimeUnit.SECONDS)
      state = infos.firstOrNull()?.state?.name ?: "missing"
      if (state == "SUCCEEDED") break
      check(state != "FAILED" && state != "CANCELLED") { "Worker state: $state" }
      Thread.sleep(50)
    }
    check(state == "SUCCEEDED") { "Actual Headless worker did not finish: $state" }
    state
  }
  @ReactMethod fun acquisitionTimeout(promise: Promise) = run(promise) {
    try { SmartFinDatabaseCoordinator.acquire("test-timeout", 50); error("Unexpected acquisition") }
    catch (e: IllegalStateException) { check(e.message!!.contains("timed out")); true }
  }
  @ReactMethod fun invalidateHost(promise: Promise) = run(promise) { SmartFinDatabaseCoordinator.invalidateHost("test-host-destruction"); true }
  @ReactMethod fun destroyReactHost(promise: Promise) {
    guard()
    // This verifier survives RN destruction and writes its result without JS.
    val savedConfig = JSONObject(getConstants() as Map<*, *>)
    executor.execute {
      var passed = false
      var failure = ""
      try {
        val host = (context.applicationContext as MainApplication).reactHost
        val task = host.destroy("isolated snapshot lifecycle test", null)
        check(task.waitForCompletion(20, TimeUnit.SECONDS) && !task.isFaulted()) { "ReactHost did not destroy" }
        check(SmartFinDatabaseCoordinator.isQuarantined()) { "Native module did not quarantine on invalidate" }
        Phase5B1Probe.proceed.countDown()
        check(Phase5B1Probe.snapshotFinished.await(20, TimeUnit.SECONDS)) { "Copy task did not finish after destruction" }
        try { SmartFinDatabaseCoordinator.acquire("new-host", 50); error("New owner entered destroyed host") }
        catch (e: IllegalStateException) { check(e.message!!.contains("quarantined")) }
        SQLiteDatabase.openDatabase(context.getDatabasePath("phase5b1_synthetic.db").path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
          db.execSQL("PRAGMA foreign_keys=ON"); SmartFinLocalSnapshot.describe(db)
        }
        passed = true
      } catch (error: Exception) { failure = error.toString(); Phase5B1Probe.proceed.countDown() }
      val result = JSONObject().put("config", savedConfig).put("campaign", "host-real")
        .put("passed", passed).put("failure", failure).put("events", JSONArray(Phase5B1Probe.takeEvents()))
        .put("cases", JSONArray().put(JSONObject().put("name", "actual-ReactHost-destruction-during-copy").put("passed", passed)))
      val directory = File(context.getExternalFilesDir(null), "snapshot5b1-results"); directory.mkdirs()
      File(directory, "result.json").writeText(result.toString())
    }
  }
  @ReactMethod fun report(json: String, promise: Promise) = run(promise) {
    val directory = File(context.getExternalFilesDir(null), "snapshot5b1-results"); check(directory.isDirectory || directory.mkdirs())
    File(directory, "result.json").writeText(JSONObject(json).put("databaseAfterSha256", fileHash()).toString()); true
  }
  @ReactMethod fun saveRestart(json: String, promise: Promise) = run(promise) { File(context.filesDir, "snapshot5b1-restart.json").writeText(json); true }
  @ReactMethod fun readRestart(promise: Promise) = run(promise) { File(context.filesDir, "snapshot5b1-restart.json").readText() }
}
