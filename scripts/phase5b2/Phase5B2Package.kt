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

class Phase5B2Package : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(
    SmartFinDatabaseLifecycleModule(context), SmartFinSubscriptionRemindersModule(context),
    SmartFinDriveBackupModule(context), Phase5B2Control(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

object Phase5B2Probe {
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

class Phase5B2Control(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newCachedThreadPool()
  private var walReadDone = CountDownLatch(1)
  private var walReadStarted = CountDownLatch(1)
  override fun getName() = "Phase5B2Control"
  private fun guard() {
    check(context.packageName == "com.smartfin.snapshot5b2.tests" && !BuildConfig.DEBUG)
    check(context.getDatabasePath("phase5b2_synthetic.db").canonicalPath.startsWith(context.dataDir.canonicalPath + "/"))
  }
  private fun fileHash(): String {
    val file = context.getDatabasePath("phase5b2_synthetic.db")
    if (!file.exists()) return "absent"
    val digest = java.security.MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) } }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
  override fun getConstants(): MutableMap<String, Any> {
    guard()
    return mutableMapOf("packageId" to context.packageName, "uid" to Process.myUid(), "api" to Build.VERSION.SDK_INT,
      "model" to Build.MODEL, "database" to context.getDatabasePath("phase5b2_synthetic.db").absolutePath,
      "databaseBeforeSha256" to fileHash())
  }
  private fun run(promise: Promise, block: () -> Any?) { executor.execute { try { guard(); promise.resolve(block()) } catch (e: Exception) { promise.reject("TEST", e) } } }
  @ReactMethod fun arm(stage: String, fail: Boolean, promise: Promise) = run(promise) {
    Phase5B2Probe.stage = stage; Phase5B2Probe.fail = fail
    Phase5B2Probe.reached = CountDownLatch(1); Phase5B2Probe.proceed = CountDownLatch(1); null
  }
  @ReactMethod fun waitReached(promise: Promise) = run(promise) { check(Phase5B2Probe.reached.await(20, TimeUnit.SECONDS)); true }
  @ReactMethod fun resume(promise: Promise) = run(promise) { Phase5B2Probe.proceed.countDown(); null }
  @ReactMethod fun events(promise: Promise) = run(promise) { Phase5B2Probe.takeEvents() }
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
      Phase5B2Probe.hit("independent.active")
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
      SQLiteDatabase.openDatabase(context.getDatabasePath("phase5b2_synthetic.db").path, null,
        SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING).use { db ->
        db.setForeignKeyConstraintsEnabled(true)
        db.beginTransactionNonExclusive()
        try {
          Phase5B2Probe.connection(db)
          db.rawQuery("SELECT balance_amount FROM accounts WHERE id='bank'", null).use { check(it.moveToFirst()); Phase5B2Probe.event("wal.blocker:" + it.getDouble(0)) }
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
        Phase5B2Probe.proceed.countDown()
        check(Phase5B2Probe.snapshotFinished.await(20, TimeUnit.SECONDS)) { "Copy task did not finish after destruction" }
        try { SmartFinDatabaseCoordinator.acquire("new-host", 50); error("New owner entered destroyed host") }
        catch (e: IllegalStateException) { check(e.message!!.contains("quarantined")) }
        SQLiteDatabase.openDatabase(context.getDatabasePath("phase5b2_synthetic.db").path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
          db.execSQL("PRAGMA foreign_keys=ON"); SmartFinLocalSnapshot.describe(db)
        }
        passed = true
      } catch (error: Exception) { failure = error.toString(); Phase5B2Probe.proceed.countDown() }
      val result = JSONObject().put("config", savedConfig).put("campaign", "host-real")
        .put("passed", passed).put("failure", failure).put("events", JSONArray(Phase5B2Probe.takeEvents()))
        .put("cases", JSONArray().put(JSONObject().put("name", "actual-ReactHost-destruction-during-copy").put("passed", passed)))
      val directory = File(context.getExternalFilesDir(null), "snapshot5b2-results"); directory.mkdirs()
      File(directory, "result.json").writeText(result.toString())
    }
  }
  @ReactMethod fun report(json: String, promise: Promise) = run(promise) {
    val directory = File(context.getExternalFilesDir(null), "snapshot5b2-results"); check(directory.isDirectory || directory.mkdirs())
    File(directory, "result.json").writeText(JSONObject(json).put("databaseAfterSha256", fileHash()).toString()); true
  }
  @ReactMethod fun saveRestart(json: String, promise: Promise) = run(promise) { File(context.filesDir, "snapshot5b2-restart.json").writeText(json); true }
  @ReactMethod fun readRestart(promise: Promise) = run(promise) { File(context.filesDir, "snapshot5b2-restart.json").readText() }
  @ReactMethod fun configureSaf(promise: Promise) = run(promise) {
    val uri = android.provider.DocumentsContract.buildTreeDocumentUri("com.smartfin.snapshot5b2.tests.documents", "root")
    check(context.getSharedPreferences("smartfin_drive_backup", 0).edit().putString("directory_uri", uri.toString()).commit())
    val directory = File(context.noBackupFilesDir, "saf-synthetic"); check(directory.isDirectory || directory.mkdir())
    // Root-only legacy reader fixture and unrelated document: production must never touch these.
    for ((name, value) in listOf("smartfin-manifest.json" to "{\"formatVersion\":1,\"revision\":0,\"generatedAt\":\"2026-01-01T00:00:00.000Z\"}",
      "smartfin-backup.db" to "synthetic legacy database", "movimientos-2020.csv" to "synthetic legacy csv", "foreign.txt" to "unrelated synthetic document")) {
      val file = File(directory, name); if (!file.exists()) file.writeText(value)
    }
    uri.toString()
  }
  @ReactMethod fun fault(value: String, promise: Promise) = run(promise) {
    BackupFaults.fault = value; BackupFaults.reached = CountDownLatch(1); BackupFaults.proceed = CountDownLatch(1); null
  }
  @ReactMethod fun waitSaf(promise: Promise) = run(promise) { check(BackupFaults.reached.await(30, TimeUnit.SECONDS)); true }
  @ReactMethod fun resumeSaf(promise: Promise) = run(promise) { BackupFaults.proceed.countDown(); null }
  @ReactMethod fun documents(promise: Promise) = run(promise) {
    val result = JSONObject()
    File(context.noBackupFilesDir, "saf-synthetic").listFiles().orEmpty().sortedBy { it.name }.forEach { file ->
      val (size, hash) = SmartFinBackupPublisher.digest(file.inputStream())
      result.put(file.name, JSONObject().put("bytes", size).put("sha256", hash))
    }
    result.toString()
  }

  private fun csvRows(text: String): List<List<String>> {
    val rows = mutableListOf<List<String>>()
    var row = mutableListOf<String>()
    val field = StringBuilder()
    var quoted = false
    var index = if (text.startsWith("\uFEFF")) 1 else 0
    while (index < text.length) {
      val c = text[index++]
      when {
        c == '"' && quoted && index < text.length && text[index] == '"' -> { field.append('"'); index++ }
        c == '"' -> quoted = !quoted
        c == ',' && !quoted -> { row.add(field.toString()); field.setLength(0) }
        c == '\n' && !quoted -> { row.add(field.toString().removeSuffix("\r")); field.setLength(0); rows.add(row); row = mutableListOf() }
        else -> field.append(c)
      }
    }
    check(!quoted && field.isEmpty() && row.isEmpty()) { "Malformed CSV" }
    return rows
  }
  private fun compareRaw(db: SQLiteDatabase, file: File, sql: String): Int {
    val actual = csvRows(file.readText())
    db.rawQuery(sql, null).use { cursor ->
      check(actual.first() == cursor.columnNames.toList()) { "CSV headers changed" }
      var index = 1
      while (cursor.moveToNext()) {
        val expected = (0 until cursor.columnCount).map { if (cursor.isNull(it)) "" else cursor.getString(it) }
        check(index < actual.size && actual[index++] == expected) { "CSV cells differ from snapshot" }
      }
      check(index == actual.size) { "CSV has extra rows" }
      return index - 1
    }
  }
  @ReactMethod fun csvEvidence(id: String, promise: Promise) = run(promise) {
    val directory = File(context.noBackupFilesDir, "saf-synthetic")
    val prefix = "smartfin-$id--"
    val database = File(directory, prefix + "smartfin-backup.db")
    val result = JSONObject()
    SQLiteDatabase.openDatabase(database.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
      db.execSQL("PRAGMA foreign_keys=ON")
      result.put("metadata", SmartFinLocalSnapshot.describe(db))
      db.rawQuery("SELECT count(*) FROM accounts WHERE type='credit_card'", null).use { it.moveToFirst(); result.put("legacyCardCount", it.getInt(0)) }
      db.rawQuery("SELECT count(*) FROM accounts WHERE type='creditCard'", null).use { it.moveToFirst(); result.put("cardCount", it.getInt(0)) }
      db.rawQuery("SELECT count(*) FROM ai_command_drafts WHERE phase='confirmed'", null).use { it.moveToFirst(); result.put("receipts", it.getInt(0)) }
      db.rawQuery("SELECT balance_amount FROM accounts WHERE id='bank'", null).use { it.moveToFirst(); result.put("balance", it.getDouble(0)) }
      result.put("cardCsv", File(directory, prefix + "tarjetas-credito.csv").readText())
      result.put("accountsCsv", File(directory, prefix + "cuentas.csv").readText())
      result.put("accountRows", compareRaw(db, File(directory, prefix + "cuentas.csv"), "SELECT * FROM accounts ORDER BY name"))
      result.put("cardRows", compareRaw(db, File(directory, prefix + "tarjetas-credito.csv"), "SELECT a.*,p.monthly_interest_rate FROM accounts a LEFT JOIN credit_card_profiles p ON p.account_id=a.id WHERE a.type='creditCard' ORDER BY a.name"))
      val transactionIds = mutableSetOf<String>()
      directory.listFiles().orEmpty().filter { it.name.startsWith(prefix + "movimientos-") && it.name.endsWith(".csv") }.forEach { csv ->
        val rows = csvRows(csv.readText())
        for (row in rows.drop(1)) check(transactionIds.add(row[0])) { "Duplicate transaction CSV row" }
      }
      val expectedIds = mutableSetOf<String>()
      db.rawQuery("SELECT id FROM transactions", null).use { cursor -> while (cursor.moveToNext()) expectedIds.add(cursor.getString(0)) }
      check(transactionIds == expectedIds) { "Historical transactions omitted from annual CSV" }
      result.put("transactionRows", transactionIds.size)
      val rebuilt = File(context.noBackupFilesDir, "csv-evidence-$id"); check(rebuilt.isDirectory || rebuilt.mkdir())
      val csv = JSONArray()
      for ((name, file) in SmartFinBackupCsv.export(database, rebuilt)) {
        val expected = SmartFinBackupPublisher.digest(file.inputStream())
        val actual = SmartFinBackupPublisher.digest(File(directory, prefix + name).inputStream())
        check(expected == actual) { "CSV differs from published SQLite: $name" }
        csv.put(JSONObject().put("name", name).put("bytes", actual.first).put("sha256", actual.second))
      }
      result.put("csv", csv)
    }
    result.toString()
  }
  @ReactMethod fun removePrivateSnapshot(id: String, promise: Promise) = run(promise) {
    check(java.util.UUID.fromString(id).toString() == id)
    val file = File(context.noBackupFilesDir, "smartfin-local-snapshots/$id/snapshot.db")
    check(file.delete()); null
  }
  @ReactMethod fun removeSyntheticManifest(id: String, promise: Promise) = run(promise) {
    check(java.util.UUID.fromString(id).toString() == id)
    val file = File(context.noBackupFilesDir, "saf-synthetic/smartfin-generation-$id.json")
    check(file.delete()); null
  }
  @ReactMethod fun damageManifest(id: String, promise: Promise) = run(promise) {
    check(java.util.UUID.fromString(id).toString() == id)
    File(context.noBackupFilesDir, "saf-synthetic/smartfin-generation-$id.json").writeText("{\"state\":\"complete\"}"); null
  }
  @ReactMethod fun damageManifestRevision(id: String, promise: Promise) = run(promise) {
    check(java.util.UUID.fromString(id).toString() == id)
    val file = File(context.noBackupFilesDir, "saf-synthetic/smartfin-generation-$id.json")
    val manifest = JSONObject(file.readText())
    val revision = manifest.getLong("revision") + 1
    file.writeText(manifest.put("revision", revision).put("financialRevision", revision).toString())
    null
  }
  @ReactMethod fun written(promise: Promise) = run(promise) { JSONArray(BackupFaults.takeWrites()).toString() }
  @ReactMethod fun killAtSaf(json: String, promise: Promise) = run(promise) {
    val saved = JSONObject(json)
    if (saved.getString("campaign") != "publication-kill-captured")
      check(BackupFaults.reached.await(30, TimeUnit.SECONDS)) { "Publication did not reach process-death point" }
    val job = SmartFinBackupPublisher.jobs(context).let { rows ->
      (0 until rows.length()).map { rows.getJSONObject(it) }.single { it.getString("id") == saved.getString("id") }
    }
    check(job.getString("state") == if (saved.getString("campaign") == "publication-kill-captured") "prepared" else "publicationPending")
    val restart = android.util.AtomicFile(File(context.filesDir, "snapshot5b2-restart.json"))
    val stream = restart.startWrite()
    try { stream.write(saved.toString().toByteArray()); restart.finishWrite(stream) }
    catch (error: Exception) { restart.failWrite(stream); throw error }
    val result = JSONObject().put("config", JSONObject(getConstants() as Map<*, *>).put("pid", Process.myPid()))
      .put("campaign", saved.getString("campaign")).put("passed", true)
      .put("cases", JSONArray().put(JSONObject().put("name", "actual-process-kill-at-durable-stage").put("passed", true).put("evidence", job)))
    val directory = File(context.getExternalFilesDir(null), "snapshot5b2-results"); check(directory.isDirectory || directory.mkdirs())
    java.io.FileOutputStream(File(directory, "result.json")).use { it.write(result.toString().toByteArray()); it.fd.sync() }
    Process.killProcess(Process.myPid())
    null
  }

}
