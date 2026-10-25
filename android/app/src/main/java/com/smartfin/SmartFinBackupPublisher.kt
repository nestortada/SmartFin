package com.smartfin

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.util.AtomicFile
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import org.json.JSONArray
import org.json.JSONObject

/** Append-only generations. A document provider is never a multi-file transaction. */
object SmartFinBackupPublisher {
  private val publication = ReentrantLock()
  private val metadata = Any()
  private val unfinished = setOf("prepared", "snapshotValidated", "publicationPending", "uncertain")
  private fun uuid(id: String): String {
    check(UUID.fromString(id).toString() == id) { "Invalid job identity" }
    return id
  }
  private fun root(context: Context) = File(context.noBackupFilesDir, "smartfin-backup-jobs").apply {
    check(isDirectory || mkdirs())
  }
  private fun jobFile(context: Context, id: String) = File(root(context), "${uuid(id)}.json")
  private fun read(context: Context, id: String): JSONObject = synchronized(metadata) {
    JSONObject(AtomicFile(jobFile(context, id)).openRead().bufferedReader().use { it.readText() }).also {
      check(it.getString("id") == id && it.getInt("jobFormatVersion") == 1) { "Corrupt publication job" }
    }
  }
  private fun save(context: Context, job: JSONObject) = synchronized(metadata) {
    val file = AtomicFile(jobFile(context, job.getString("id")))
    val stream = file.startWrite()
    try { stream.write(job.toString().toByteArray(Charsets.UTF_8)); file.finishWrite(stream) }
    catch (error: Exception) { file.failWrite(stream); throw error }
  }
  fun jobs(context: Context): JSONArray = synchronized(metadata) {
    val ids = root(context).listFiles().orEmpty().map { it.name.removeSuffix(".bak") }
      .filter { it.matches(Regex("[0-9a-f-]{36}\\.json")) }.distinct().sorted()
    JSONArray().apply {
      for (name in ids) {
        val id = name.removeSuffix(".json")
        try {
          val job = read(context, id)
          put(JSONObject().put("id", id).put("state", job.getString("state"))
            .put("revokedByDeletion", job.optString("revokedByDeletion"))
            .put("completedFiles", job.optInt("completedFiles"))
            .put("totalFiles", job.optInt("totalFiles")))
        } catch (_: Exception) { put(JSONObject().put("id", id).put("state", "uncertain")) }
      }
    }
  }
  fun jobIds(context: Context): List<String> = jobs(context).let { all ->
    (0 until all.length()).map { uuid(all.getJSONObject(it).getString("id")) }
  }
  fun revoke(context: Context, id: String, deletionId: String) = synchronized(metadata) {
    val job = read(context, id)
    job.put("revokedByDeletion", uuid(deletionId)); save(context, job)
  }
  fun datasetCurrency(context: Context, id: String, epoch: String): String = try {
    val job = read(context, id)
    if (job.optString("revokedByDeletion").isEmpty() && job.optString("datasetEpoch", "legacy") == epoch) "current" else "historical"
  } catch (_: Exception) { "unknown" }
  fun prepare(context: Context, directory: Uri): JSONObject = SmartFinFinancialDeletion.backup(context) { epoch ->
    check(publication.tryLock()) { "Backup publication busy" }
    try {
      val all = jobs(context)
      check((0 until all.length()).none { all.getJSONObject(it).let { job -> job.optString("revokedByDeletion").isEmpty() && job.getString("state") in unfinished } }) {
        "Hay un respaldo pendiente. Verifica su trabajo antes de crear otro."
      }
      val job = JSONObject().put("jobFormatVersion", 1).put("id", UUID.randomUUID().toString()).put("state", "prepared")
        .put("directory", directory.toString()).put("createdAt", timestamp()).put("datasetEpoch", epoch)
      save(context, job)
      job
    } finally { publication.unlock() }
  }
  private fun snapshotFile(context: Context, id: String) =
    File(File(context.noBackupFilesDir, "smartfin-local-snapshots/${uuid(id)}"), "snapshot.db")

  /** Binds a private capture receipt; paths supplied by JS are never opened. */
  private fun snapshot(context: Context, job: JSONObject, snapshotId: String?, timings: JSONObject? = null): Pair<File, JSONObject> {
    var id = snapshotId ?: job.optString("snapshotId").takeIf { it.isNotEmpty() }
    if (id == null) {
      val candidates = File(context.noBackupFilesDir, "smartfin-local-snapshots").listFiles().orEmpty()
        .filter { it.isDirectory && it.name.matches(Regex("[0-9a-f-]{36}")) }
        .filter { directory ->
          try { JSONObject(AtomicFile(File(directory, "receipt.json")).openRead().bufferedReader().use { it.readText() })
            .getJSONObject("expected").optString("backupJobId") == job.getString("id") }
          catch (_: Exception) { false }
        }
      check(candidates.size == 1) { "No hay una captura privada recuperable única; requiere revisión explícita." }
      id = candidates.single().name
    }
    val file = snapshotFile(context, id)
    val receipt = JSONObject(AtomicFile(File(file.parentFile, "receipt.json")).openRead().bufferedReader().use { it.readText() })
    check(receipt.getJSONObject("expected").getString("backupJobId") == job.getString("id"))
    val captured = receipt.getJSONObject("snapshot")
    check(captured.getString("id") == id)
    check(file.isFile && file.length() == captured.getLong("bytes")) { "Private snapshot unavailable" }
    val hashStart = System.nanoTime()
    check(digest(file.inputStream()).second == captured.getString("sha256")) { "Private snapshot corrupt" }
    timings?.put("snapshotHashMs", elapsed(hashStart))
    val describe = JSONObject()
    SmartFinBackupCsv.validate(file, receipt.getJSONObject("expected"), describe)
    timings?.put("snapshotDescribe", describe)
    job.put("snapshotId", id).put("snapshot", captured)
    return file to captured
  }
  fun publish(context: Context, id: String, snapshotId: String? = null,
    observer: ((String, Int, Int) -> Unit)? = null): JSONObject = SmartFinFinancialDeletion.backup(context) { epoch ->
    check(publication.tryLock()) { "Backup publication busy" }
    fun progress(phase: String, completed: Int = 0, total: Int = 0) {
      // Presentation is observational; it must never change publication outcomes.
      try { observer?.invoke(phase, completed, total) } catch (_: Exception) { }
    }
    var job: JSONObject? = null
    var admitted = false
    val started = System.nanoTime()
    try {
      job = read(context, uuid(id))
      check(job.optString("revokedByDeletion").isEmpty() && job.optString("datasetEpoch", "legacy") == epoch) {
        "Trabajo de una historia financiera anterior; publicación revocada."
      }
      // This admission lease spans all streams, the final manifest and verified result.
      // Deletion refuses an active lease, so there is no unchecked finalization window.
      admitted = true
      if (snapshotId == null) progress("recovering")
      val directory = Uri.parse(job.getString("directory"))
      val saf = Documents(context, directory)
      // Recovery first checks external evidence, even if staging was subsequently lost.
      val manifestName = manifestName(id)
      saf.find(manifestName)?.let { uri ->
        val manifest = saf.readManifest(uri)
        check(job.has("manifest") && manifest.toString() == job.getJSONObject("manifest").toString()) {
          "External manifest differs from the durable job"
        }
        progress("validatingComponents")
        validate(saf, manifest, id)
        job.put("state", "verified"); save(context, job)
        progress("verified")
        return@backup result(job, manifest)
      }
      progress("inspectingSnapshot")
      // Observation only: stage durations never change publication decisions.
      val stages = JSONObject()
      var jobSaveMs = 0.0
      var jobSaves = 0
      fun persist(value: JSONObject) { val start = System.nanoTime(); save(context, value); jobSaveMs += elapsed(start); jobSaves++ }
      val snapshotStart = System.nanoTime()
      val (database, captured) = snapshot(context, job, snapshotId, stages)
      val snapshotRevalidationMs = elapsed(snapshotStart)
      job.put("state", "snapshotValidated"); persist(job)
      progress(if (snapshotId == null) "continuingPublication" else "snapshotValidated")
      val staging = File(root(context), id).apply { check(isDirectory || mkdir()) }
      val csvStart = System.nanoTime()
      val csvFiles = JSONArray()
      val exports = SmartFinBackupCsv.export(database, staging, csvFiles)
      val csvExportMs = elapsed(csvStart)
      val files = listOf("smartfin-backup.db" to database) + exports
      val hashStart = System.nanoTime()
      val entries = JSONArray()
      for ((logical, file) in files) {
        val (size, hash) = digest(file.inputStream())
        if (logical == "smartfin-backup.db") check(size == captured.getLong("bytes") && hash == captured.getString("sha256"))
        entries.put(JSONObject().put("name", "smartfin-$id--$logical").put("logicalName", logical)
          .put("bytes", size).put("sha256", hash))
      }
      val componentHashMs = elapsed(hashStart)
      val manifest = JSONObject().put("formatVersion", 2).put("generationId", id)
        .put("generatedAt", job.getString("createdAt")).put("revision", captured.getLong("revision"))
        .put("financialRevision", captured.getLong("revision")).put("encrypted", false)
        .put("database", entries.getJSONObject(0).getString("name"))
        .put("files", JSONArray((0 until entries.length()).map { entries.getJSONObject(it).getString("name") }))
        .put("csvFiles", JSONArray((1 until entries.length()).map { entries.getJSONObject(it).getString("name") }))
        .put("components", entries).put("state", "complete").put("validation", "provider-readback-sha256")
        .put("cloudSync", "unconfirmed")
      job.put("state", "publicationPending").put("manifest", manifest)
        .put("totalFiles", files.size + 1).put("completedFiles", 0); persist(job)
      progress("publicationPending", 0, files.size + 1)
      for ((index, pair) in files.withIndex()) {
        val entry = entries.getJSONObject(index)
        saf.writeOnce(entry.getString("name"), if (index == 0) "application/vnd.sqlite3" else "text/csv", pair.second, entry)
        job.put("completedFiles", index + 1); persist(job)
        progress("publicationPending", index + 1, files.size + 1)
      }
      val manifestStart = System.nanoTime()
      // This final immutable document is only a candidate: every reader must verify all components.
      val localManifest = File(staging, "manifest.json")
      localManifest.writeText(manifest.toString(2), Charsets.UTF_8)
      val (size, hash) = digest(localManifest.inputStream())
      val uri = saf.writeOnce(manifestName, "application/json", localManifest,
        JSONObject().put("bytes", size).put("sha256", hash))
      val published = saf.readManifest(uri)
      check(published.toString() == manifest.toString()) { "Published manifest differs" }
      val manifestMs = elapsed(manifestStart)
      progress("validatingComponents", files.size, files.size + 1)
      val validationStart = System.nanoTime()
      validate(saf, published, id)
      val finalValidationMs = elapsed(validationStart)
      job.put("state", "verified").put("completedFiles", files.size + 1)
        .put("timings", stages.put("snapshotRevalidationMs", snapshotRevalidationMs)
          .put("csvExportMs", csvExportMs).put("csvFiles", csvFiles).put("componentHashMs", componentHashMs)
          .put("safWriteMs", saf.writeMs).put("safReadbackMs", saf.readbackMs)
          .put("manifestWriteAndReadMs", manifestMs).put("finalComponentValidationMs", finalValidationMs)
          .put("jobSaveMs", jobSaveMs).put("jobSaves", jobSaves)
          .put("publicationTotalMs", elapsed(started)))
      save(context, job)
      progress("verified", files.size + 1, files.size + 1)
      result(job, published)
    } catch (error: Exception) {
      // An exception, including stream close, does not prove the provider rolled back.
      job?.takeIf { admitted }?.let {
        it.put("state", "uncertain").put("needsExplicitVerification", true)
        try { save(context, it) } catch (_: Exception) { /* Earlier durable state remains recoverable. */ }
      }
      progress("uncertain")
      throw error
    } finally { publication.unlock() }
  }
  fun captureFailed(context: Context, id: String) {
    check(publication.tryLock()) { "Backup publication busy" }
    try {
      val job = read(context, id)
      check(job.getString("state") == "prepared")
      // Retain receipts and evidence; never clean staging automatically after uncertainty.
      job.put("state", "failed"); save(context, job)
    } finally { publication.unlock() }
  }
  /** Explicitly stop retrying a job, preserving every local and external byte. */
  fun retainFailed(context: Context, id: String) {
    check(publication.tryLock()) { "Backup publication busy" }
    try {
      val job = read(context, id)
      check(job.getString("state") != "verified") { "A verified generation cannot be abandoned" }
      job.put("state", "failed").put("evidenceRetained", true); save(context, job)
    } finally { publication.unlock() }
  }
  fun discover(context: Context, directory: Uri): JSONObject? {
    val saf = Documents(context, directory)
    val candidates = saf.children().filter { it.first.matches(Regex("smartfin-generation-[0-9a-f-]{36}\\.json")) }
    val valid = mutableListOf<JSONObject>()
    for ((name, uri) in candidates) {
      try {
        val manifest = saf.readManifest(uri)
        val id = name.removePrefix("smartfin-generation-").removeSuffix(".json")
        val privateJob = jobFile(context, id)
        if (privateJob.exists() || File(privateJob.path + ".bak").exists()) {
          check(read(context, id).optJSONObject("manifest")?.toString() == manifest.toString()) {
            "Manifest differs from original publication plan"
          }
        }
        validate(saf, manifest, id); valid.add(manifest)
      } catch (_: Exception) { /* Never select a missing, unreadable or incomplete generation. */ }
    }
    return valid.maxWithOrNull(compareBy<JSONObject> { it.getString("generatedAt") }.thenBy { it.getString("generationId") })
  }
  private fun validate(saf: Documents, manifest: JSONObject, id: String) {
    uuid(id)
    check(manifest.get("formatVersion") == 2 && manifest.getString("generationId") == id)
    check(manifest.getString("state") == "complete" && manifest.getString("validation") == "provider-readback-sha256")
    check(!manifest.getBoolean("encrypted") && manifest.getString("cloudSync") == "unconfirmed")
    check(manifest.getString("generatedAt").matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z")))
    check(safeLong(manifest, "revision") == safeLong(manifest, "financialRevision"))
    val entries = manifest.getJSONArray("components")
    check(entries.length() >= SmartFinBackupCsv.fixedFileNames.size + 1)
    val names = mutableSetOf<String>()
    val logicalNames = mutableSetOf<String>()
    for (index in 0 until entries.length()) {
      val entry = entries.getJSONObject(index)
      val logical = entry.getString("logicalName")
      check(logical == "smartfin-backup.db" || logical in SmartFinBackupCsv.fixedFileNames || logical.matches(Regex("movimientos-[0-9]{4}\\.csv")))
      val name = entry.getString("name")
      check(name == "smartfin-$id--$logical" && names.add(name) && logicalNames.add(logical))
      check(safeLong(entry, "bytes") > 0 && entry.getString("sha256").matches(Regex("[0-9a-f]{64}")))
      saf.verify(saf.find(name) ?: error("Missing component: $name"), entry)
    }
    check(logicalNames.containsAll(SmartFinBackupCsv.fixedFileNames + "smartfin-backup.db"))
    check(manifest.getString("database") == "smartfin-$id--smartfin-backup.db")
    val listed = manifest.getJSONArray("files")
    check(listed.length() == names.size && (0 until listed.length()).map { listed.getString(it) }.toSet() == names)
    val csv = manifest.getJSONArray("csvFiles")
    check(csv.length() == names.size - 1 && (0 until csv.length()).map { csv.getString(it) }.toSet() == names - manifest.getString("database"))
  }
  private fun result(job: JSONObject, manifest: JSONObject) = JSONObject()
    .put("generationId", job.getString("id")).put("state", "verified")
    .put("revision", manifest.getLong("financialRevision")).put("lastBackupAt", manifest.getString("generatedAt"))
    .put("fileCount", manifest.getJSONArray("components").length() + 1).put("directory", job.getString("directory"))
    .put("timings", job.optJSONObject("timings") ?: JSONObject())
  private fun manifestName(id: String) = "smartfin-generation-${uuid(id)}.json"
  private fun timestamp() = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).run {
    timeZone = TimeZone.getTimeZone("UTC"); format(Date())
  }
  private fun elapsed(start: Long) = (System.nanoTime() - start) / 1_000_000.0
  private fun safeLong(value: JSONObject, key: String): Long {
    val number = value.get(key)
    check(number is Int || number is Long) { "Invalid integer: $key" }
    return (number as Number).toLong().also { check(it in 0..9_007_199_254_740_991L) }
  }
  fun digest(input: InputStream): Pair<Long, String> = input.use {
    val hash = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(64 * 1024)
    var size = 0L
    while (true) { val count = it.read(buffer); if (count < 0) break; hash.update(buffer, 0, count); size += count }
    size to hash.digest().joinToString("") { byte -> "%02x".format(byte) }
  }
  private class Documents(val context: Context, val directory: Uri) {
    var writeMs = 0.0
    var readbackMs = 0.0
    fun children(): List<Pair<String, Uri>> {
      val query = DocumentsContract.buildChildDocumentsUriUsingTree(directory, DocumentsContract.getTreeDocumentId(directory))
      val rows = context.contentResolver.query(query, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null) ?: error("Provider did not enumerate documents")
      return rows.use { cursor -> buildList {
        while (cursor.moveToNext()) add(cursor.getString(1) to DocumentsContract.buildDocumentUriUsingTree(directory, cursor.getString(0)))
      } }
    }
    fun find(name: String): Uri? {
      val matches = children().filter { it.first == name }
      check(matches.size <= 1) { "Ambiguous provider name" }
      return matches.singleOrNull()?.second
    }
    fun verify(uri: Uri, entry: JSONObject) {
      val started = System.nanoTime()
      val (bytes, hash) = digest(context.contentResolver.openInputStream(uri) ?: error("Verification read unavailable"))
      check(bytes == entry.getLong("bytes") && hash == entry.getString("sha256")) { "Provider content verification failed" }
      readbackMs += elapsed(started)
    }
    fun readManifest(uri: Uri): JSONObject {
      val input = context.contentResolver.openInputStream(uri) ?: error("Manifest unreadable")
      return JSONObject(input.bufferedReader(Charsets.UTF_8).use { it.readText() })
    }
    fun writeOnce(name: String, mime: String, file: File, entry: JSONObject): Uri {
      find(name)?.let { verify(it, entry); return it }
      val started = System.nanoTime()
      val previousUris = children().map { it.second }.toSet()
      val parent = DocumentsContract.buildDocumentUriUsingTree(directory, DocumentsContract.getTreeDocumentId(directory))
      val uri = DocumentsContract.createDocument(context.contentResolver, parent, mime, name) ?: error("Cannot create $name")
      check(uri !in previousUris && find(name) == uri) { "Provider did not create a new generation document" }
      // Open only the newly-created document. No previous document is ever truncated or deleted.
      val output = context.contentResolver.openOutputStream(uri, "w") ?: error("Cannot open $name")
      output.use { stream -> file.inputStream().use { it.copyTo(stream) } }
      writeMs += elapsed(started)
      check(find(name) == uri) { "Provider changed generation name" }
      verify(uri, entry)
      return uri
    }
  }
}
