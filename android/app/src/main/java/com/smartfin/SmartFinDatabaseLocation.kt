package com.smartfin

import android.content.Context
import android.system.Os
import android.util.AtomicFile
import java.io.File
import java.io.FileNotFoundException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import org.json.JSONObject

/**
 * Single source of truth for the active SmartFin SQLite file (phase C3A).
 * JavaScript asks this object through SmartFinDatabaseLifecycle; native openers call it directly.
 * It never creates, deletes, renames or writes a database file. It only writes its own metadata
 * (outside SQLite, in noBackupFilesDir) and only selects a file recorded in that metadata, except the
 * one-time adoption of an existing smartfin.db and an explicitly initialized fresh installation.
 */
object SmartFinDatabaseLocation {
  const val LEGACY_FILE = "smartfin.db"
  const val FORMAT_VERSION = 1
  private val GENERATION_FILE = Regex("smartfin-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.db")
  private val lock = Any()
  // Generation of the JavaScript driver connection that is currently open (process memory only).
  private var jsBinding: String? = null

  enum class Policy {
    /** Only the JavaScript open path under the exclusive coordinator owner. */
    RECOVERY_OWNER,
    /** Receivers, Worker, reminder module, financial deletion and capture: never initialize. */
    NO_RECOVERY,
  }

  class Unavailable(val code: String, val retryable: Boolean, val recoveryRequired: Boolean) :
    IllegalStateException("SmartFin database unavailable: $code")

  data class Active(
    val fileName: String,
    val file: File,
    val installationId: String,
    val datasetId: String,
    val generationId: String,
    val locationEpoch: Long,
    val fileIdentity: String?,
    val freshInstall: Boolean,
  ) {
    fun toJson(): JSONObject = JSONObject().put("fileName", fileName).put("installationId", installationId)
      .put("datasetId", datasetId).put("generationId", generationId).put("locationEpoch", locationEpoch)
      .put("fileIdentity", fileIdentity ?: JSONObject.NULL)
  }

  private class Meta(
    val installationId: String,
    val datasetId: String,
    val generationId: String,
    val fileName: String,
    val status: String,
    val fileIdentity: String?,
    val locationEpoch: Long,
  ) {
    fun toActive(file: File, freshInstall: Boolean) =
      Active(fileName, file, installationId, datasetId, generationId, locationEpoch, fileIdentity, freshInstall)
  }

  private fun metadataFile(context: Context) = AtomicFile(File(context.noBackupFilesDir, "smartfin-database-location.json"))
  private fun journalFile(context: Context) = File(context.noBackupFilesDir, "smartfin-restore-journal.json")
  private fun databaseDirectory(context: Context): File = context.getDatabasePath(LEGACY_FILE).parentFile
    ?: throw IllegalStateException("Database directory unavailable")

  private fun timestamp(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).run {
    timeZone = TimeZone.getTimeZone("UTC"); format(Date())
  }

  private fun uuid(value: String): String = value.also { check(UUID.fromString(it).toString() == it) }

  /** Device + inode: SQLite updates the main file in place, so a different value means another file. */
  private fun identity(file: File): String {
    val stat = Os.stat(file.path)
    return "${stat.st_dev}:${stat.st_ino}"
  }

  private fun readMetadata(context: Context): JSONObject? {
    val text = try {
      metadataFile(context).openRead().bufferedReader(Charsets.UTF_8).use { it.readText() }
    } catch (_: FileNotFoundException) {
      return null
    }
    return try { JSONObject(text) } catch (_: Exception) { throw Unavailable("METADATA_CORRUPT", false, true) }
  }

  private fun writeMetadata(context: Context, value: JSONObject) {
    val file = metadataFile(context)
    val stream = file.startWrite()
    try {
      stream.write(value.toString().toByteArray(Charsets.UTF_8))
      file.finishWrite(stream)
    } catch (error: Exception) {
      file.failWrite(stream)
      throw error
    }
  }

  private fun parse(value: JSONObject): Meta {
    if (value.optInt("formatVersion", -1) != FORMAT_VERSION) throw Unavailable("METADATA_UNSUPPORTED", false, true)
    val fileName = try {
      value.getJSONObject("activeGeneration").getString("fileName")
    } catch (_: Exception) {
      throw Unavailable("METADATA_INVALID", false, true)
    }
    if (fileName != LEGACY_FILE && !GENERATION_FILE.matches(fileName)) throw Unavailable("GENERATION_UNRECOGNIZED", false, true)
    try {
      val active = value.getJSONObject("activeGeneration")
      val status = active.getString("status")
      val identity = if (active.isNull("fileIdentity")) null else active.getString("fileIdentity")
      val epoch = value.getLong("locationEpoch")
      check(status == "initializing" || status == "active")
      check((status == "active") == (identity != null))
      check(epoch >= 1)
      return Meta(uuid(value.getString("installationId")), uuid(value.getString("datasetId")),
        uuid(active.getString("generationId")), fileName, status, identity, epoch)
    } catch (_: Exception) {
      throw Unavailable("METADATA_INVALID", false, true)
    }
  }

  private fun newMetadata(status: String, origin: String): JSONObject = JSONObject()
    .put("formatVersion", FORMAT_VERSION)
    .put("installationId", UUID.randomUUID().toString())
    .put("datasetId", UUID.randomUUID().toString())
    .put("locationEpoch", 1)
    .put("activeGeneration", JSONObject()
      .put("generationId", UUID.randomUUID().toString())
      .put("fileName", LEGACY_FILE)
      .put("status", status)
      .put("origin", origin)
      .put("fileIdentity", JSONObject.NULL)
      .put("recordedAt", timestamp()))

  /** Decision table (C2 §3, adapted to recorded metadata). The result never depends only on which files exist. */
  fun resolve(context: Context, policy: Policy): Active = synchronized(lock) {
    // C3A has no restore recovery: a pending journal blocks every open, including the JS owner.
    if (journalFile(context).exists()) throw Unavailable("RESTORE_PENDING", true, true)
    val directory = databaseDirectory(context)
    val recorded = readMetadata(context)
    if (recorded != null) {
      val meta = parse(recorded)
      val file = File(directory, meta.fileName)
      if (meta.status == "initializing") {
        if (policy != Policy.RECOVERY_OWNER) throw Unavailable("NOT_INITIALIZED", false, false)
        return@synchronized meta.toActive(file, true)
      }
      if (!file.isFile) throw Unavailable("DATABASE_LOST", false, true)
      if (identity(file) != meta.fileIdentity) throw Unavailable("FILE_IDENTITY_MISMATCH", false, true)
      return@synchronized meta.toActive(file, false)
    }
    val names = directory.list()?.toList() ?: emptyList()
    if (names.any { GENERATION_FILE.matches(it) }) throw Unavailable("POINTER_LOST", false, true)
    val legacy = File(directory, LEGACY_FILE)
    if (legacy.isFile) {
      // One atomic metadata write; the database file itself is not touched, copied or renamed.
      val adopted = newMetadata("active", "legacyAdoption")
      adopted.getJSONObject("activeGeneration").put("fileIdentity", identity(legacy))
      writeMetadata(context, adopted)
      return@synchronized parse(adopted).toActive(legacy, false)
    }
    if (policy != Policy.RECOVERY_OWNER) throw Unavailable("NOT_INITIALIZED", false, false)
    val fresh = newMetadata("initializing", "freshInstall")
    writeMetadata(context, fresh)
    parse(fresh).toActive(legacy, true)
  }

  /** Called by JS after the fresh file was created, migrated and verified. Idempotent. */
  fun confirmFreshInstall(context: Context, generationId: String) = synchronized(lock) {
    if (journalFile(context).exists()) throw Unavailable("RESTORE_PENDING", true, true)
    val recorded = readMetadata(context) ?: throw Unavailable("METADATA_MISSING", false, true)
    val meta = parse(recorded)
    check(meta.generationId == generationId) { "Generation changed during initialization" }
    if (meta.status != "active") {
      val file = File(databaseDirectory(context), meta.fileName)
      check(file.isFile) { "Initialized database file missing" }
      recorded.getJSONObject("activeGeneration").put("status", "active")
        .put("fileIdentity", identity(file)).put("recordedAt", timestamp())
      writeMetadata(context, recorded)
    }
  }

  /** Resolution for the JS driver. Refusals are data (status=refused), never a guessed file name. */
  fun resolveForJs(context: Context): String = try {
    val active = resolve(context, Policy.RECOVERY_OWNER)
    synchronized(lock) { jsBinding = active.generationId }
    active.toJson().put("status", if (active.freshInstall) "create" else "open").toString()
  } catch (error: Unavailable) {
    JSONObject().put("status", "refused").put("code", error.code).put("retryable", error.retryable)
      .put("recoveryRequired", error.recoveryRequired).toString()
  }

  fun releaseJsBinding(generationId: String) = synchronized(lock) {
    if (jsBinding == generationId) jsBinding = null
  }

  /** A future activation (C3B) must refuse while the JS connection of another generation is still open. */
  fun openJsBinding(): String? = synchronized(lock) { jsBinding }

  /** Capture reads only the active file, and only if it is the generation JavaScript described. */
  fun activeFile(context: Context, expectedGenerationId: String?): File {
    val active = resolve(context, Policy.NO_RECOVERY)
    if (expectedGenerationId != null) check(active.generationId == expectedGenerationId) { "Active generation changed" }
    return active.file
  }
}
