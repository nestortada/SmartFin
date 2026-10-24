package com.smartfin

import android.content.Context
import android.app.NotificationManager
import android.database.sqlite.SQLiteDatabase
import android.util.AtomicFile
import androidx.work.WorkManager
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

/** Process admission plus a durable fail-closed marker. SQLite is authoritative for commit/epoch.
 * Never waits for SAF, JS or WorkManager with a database participant or this monitor held. */
object SmartFinFinancialDeletion {
  const val KEY = "__smartfin_financial_lifecycle_v1"
  private val admission = Any()
  private var backups = 0
  private val cleanup = java.util.concurrent.locks.ReentrantLock()
  private fun marker(context: Context) = AtomicFile(File(context.noBackupFilesDir, "smartfin-deletion-admission-v1.json"))
  private fun markerId(context: Context): String? {
    val file = marker(context)
    if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) return null
    val value = JSONObject(file.openRead().bufferedReader().use { it.readText() })
    check(value.getInt("version") == 1)
    return uuid(value.getString("id"))
  }
  private fun saveMarker(context: Context, id: String) {
    val file = marker(context)
    val stream = file.startWrite()
    try {
      stream.write(JSONObject().put("version", 1).put("id", uuid(id)).toString().toByteArray(Charsets.UTF_8))
      file.finishWrite(stream)
    } catch (error: Exception) { file.failWrite(stream); throw error }
  }
  fun uuid(id: String): String = id.also { check(UUID.fromString(it).toString() == it) }
  fun state(db: SQLiteDatabase): JSONObject? = db.rawQuery(
    "SELECT setting_value FROM app_settings WHERE setting_key=?", arrayOf(KEY)).use {
    if (!it.moveToFirst()) null else JSONObject(it.getString(0)).also { value ->
      check(value.getInt("version") == 1 && value.getString("epoch") == uuid(value.getString("id")))
      check(value.getString("phase") in setOf("cleanupPending", "completed"))
      check(value.getString("previousEpoch") == "legacy" || uuid(value.getString("previousEpoch")).isNotEmpty())
      for (key in listOf("reminderIds", "workIds", "backupJobIds", "snapshotIds")) value.getJSONArray(key)
    }
  }
  fun epoch(db: SQLiteDatabase): String = state(db)?.getString("epoch") ?: "legacy"
  fun resourcesAllowed(context: Context, db: SQLiteDatabase): Boolean = synchronized(admission) {
    markerId(context) == null && (state(db)?.getString("phase") ?: "completed") == "completed"
  }
  fun resourceEpoch(context: Context, token: String?): String =
    SmartFinDatabaseCoordinator.withParticipant(token) { permit ->
      SmartFinSubscriptionRemindersModule.withDatabase(context, permit) { db ->
        check(resourcesAllowed(context, db)) { "Financial deletion pending; resource admission closed" }
        epoch(db)
      } ?: error("Database unavailable")
    }
  fun <T> backup(context: Context, operation: (String) -> T): T {
    synchronized(admission) {
      check(markerId(context) == null) { "Financial deletion pending; backup admission closed" }
      backups++
    }
    try { return operation(resourceEpoch(context, null)) }
    finally { synchronized(admission) { backups-- } }
  }
  /** Refuse instead of waiting for an unbounded provider. No transaction is opened here. */
  fun begin(context: Context): JSONObject = synchronized(admission) {
    if (backups != 0) return@synchronized JSONObject().put("status", "rejected")
    markerId(context)?.let { return@synchronized JSONObject().put("status", "unknown").put("id", it) }
    val id = UUID.randomUUID().toString()
    saveMarker(context, id)
    JSONObject().put("status", "admitted").put("id", id)
  }
  fun assertCaptureAdmitted(context: Context) = synchronized(admission) {
    check(markerId(context) == null) { "Deletion admission closed" }
  }
  fun rollbackConfirmed(context: Context, id: String, token: String) {
    SmartFinDatabaseCoordinator.withParticipant(token) { permit ->
      SmartFinSubscriptionRemindersModule.withDatabase(context, permit) { db ->
        check(state(db)?.getString("id") != id) { "Deletion commit already exists" }
        synchronized(admission) { check(markerId(context) == id); marker(context).delete(); check(markerId(context) == null) }
      } ?: error("Database unavailable")
    }
  }
  private fun directories(context: Context, name: String): List<String> =
    File(context.noBackupFilesDir, name).listFiles().orEmpty().filter { it.isDirectory }
      .map { it.name }.filter { runCatching { uuid(it) }.isSuccess }.sorted()

  fun inventory(context: Context, id: String, token: String): JSONObject =
    SmartFinDatabaseCoordinator.withParticipant(token) { permit ->
      synchronized(admission) { check(markerId(context) == id && backups == 0) }
      val epoch = SmartFinSubscriptionRemindersModule.withDatabase(context, permit) { db ->
        check((state(db)?.getString("phase") ?: "completed") == "completed")
        epoch(db)
      } ?: error("Database unavailable")
      val manager = WorkManager.getInstance(context)
      val work = (manager.getWorkInfosForUniqueWork(SmartFinSubscriptionRemindersModule.MAINTENANCE).get(5, TimeUnit.SECONDS) +
        manager.getWorkInfosForUniqueWork(SmartFinSubscriptionRemindersModule.RECOVERY).get(5, TimeUnit.SECONDS))
        .filter { !it.state.isFinished }.map { it.id.toString() }.distinct().sorted()
      val prefix = if (epoch == "legacy") "" else "$epoch:"
      val reminders = (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).activeNotifications
        .filter { it.id == 1 && it.tag?.startsWith(prefix + "subscription-reminder:") == true }
        .map { it.tag!!.removePrefix(prefix) }.distinct().sorted()
      JSONObject().put("workIds", JSONArray(work)).put("reminderIds", JSONArray(reminders))
        .put("backupJobIds", JSONArray(SmartFinBackupPublisher.jobIds(context)))
        .put("snapshotIds", JSONArray(directories(context, "smartfin-local-snapshots")))
    }
  private fun read(context: Context): JSONObject? = SmartFinSubscriptionRemindersModule.withDatabase(context) { state(it) }
  private fun write(context: Context, id: String, change: (JSONObject) -> Unit) {
    SmartFinSubscriptionRemindersModule.withDatabase(context) { db ->
      db.beginTransaction()
      try {
        val value = state(db) ?: error("Missing deletion receipt")
        check(value.getString("id") == id)
        change(value)
        db.execSQL("UPDATE app_settings SET setting_value=?, updated_at=? WHERE setting_key=?",
          arrayOf(value.toString(), java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date()), KEY))
        db.setTransactionSuccessful()
      } finally { db.endTransaction() }
    } ?: error("Database unavailable")
  }
  private fun remove(value: JSONObject, key: String, id: String) {
    val array = value.getJSONArray(key)
    value.put(key, JSONArray((0 until array.length()).map { array.getString(it) }.filter { it != id }))
  }
  /** Only UUID-owned private paths; never follows a provider URI or deletes an external backup. */
  private fun deletePrivate(context: Context, rootName: String, id: String) {
    val root = File(context.noBackupFilesDir, rootName).canonicalFile
    val target = File(root, uuid(id))
    check(target.canonicalFile == target.absoluteFile && target.parentFile == root)
    check(!target.exists() || target.deleteRecursively()) { "Private resource cleanup pending" }
  }
  fun recover(context: Context): JSONObject {
    check(cleanup.tryLock()) { "Cleanup already running" }
    try {
      val pending = read(context)
      val admissionId = synchronized(admission) { markerId(context) }
      if (admissionId != null && pending?.optString("id") != admissionId)
        return JSONObject().put("status", "unknown").put("id", admissionId)
      if (pending == null) return JSONObject().put("status", "none")
      val id = pending.getString("id")
      if (pending.getString("phase") == "completed") {
        synchronized(admission) { if (markerId(context) == id) { marker(context).delete(); check(markerId(context) == null) } }
        return JSONObject().put("status", "completed").put("id", id)
      }
      synchronized(admission) { check(backups == 0); if (markerId(context) == null) saveMarker(context, id) }
      try {
        for (key in listOf("workIds", "reminderIds", "backupJobIds", "snapshotIds")) {
          val array = pending.getJSONArray(key)
          for (index in 0 until array.length()) {
            val resource = array.getString(index)
            when (key) {
              "workIds" -> {
                val manager = WorkManager.getInstance(context)
                val workId = UUID.fromString(resource)
                manager.cancelWorkById(workId).result.get(5, TimeUnit.SECONDS)
                val info = manager.getWorkInfoById(workId).get(5, TimeUnit.SECONDS)
                check(info == null || info.state.isFinished) { "Worker has not terminated" }
                check(!SmartFinSubscriptionWorker.isExecuting(workId)) { "Worker/Headless execution has not drained" }
              }
              "reminderIds" -> SmartFinSubscriptionRemindersModule.withDatabase(context) { db ->
                check(state(db)?.getString("id") == id)
                SmartFinSubscriptionRemindersModule.cancelAlarm(context, resource, pending.getString("previousEpoch"))
              } ?: error("Database unavailable")
              "backupJobIds" -> {
                SmartFinBackupPublisher.revoke(context, resource, id)
                deletePrivate(context, "smartfin-backup-jobs", resource)
              }
              "snapshotIds" -> deletePrivate(context, "smartfin-local-snapshots", resource)
            }
            // If this response/write is lost only the idempotent OS/file effect repeats.
            write(context, id) { remove(it, key, resource) }
          }
        }
        write(context, id) { it.put("phase", "completed") }
        synchronized(admission) { check(markerId(context) == id); marker(context).delete(); check(markerId(context) == null) }
        return JSONObject().put("status", "completed").put("id", id)
      } catch (_: Exception) { return JSONObject().put("status", "cleanupPending").put("id", id) }
    } finally { cleanup.unlock() }
  }
}
