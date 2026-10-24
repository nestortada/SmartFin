package com.smartfin

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.AtomicFile
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.security.DigestInputStream
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/** Private local capture only. Never uses SAF or exports from a live connection. */
object SmartFinLocalSnapshot {
  private inline fun <T> usingDatabase(db: SQLiteDatabase, operation: (SQLiteDatabase) -> T): T {
    try { return operation(db) }
    finally {
      try { db.close() }
      catch (error: Exception) { SmartFinDatabaseCoordinator.quarantine(); throw error }
    }
  }
  private val requiredTables = setOf(
    "accounts", "transactions", "ai_command_drafts", "shared_commands",
    "shared_expenses", "shared_loss_events", "installment_purchases",
    "subscription_occurrences", "subscription_reminders", "recurring_subscriptions",
    "financial_data_revision", "schema_migrations", "app_settings",
  )

  private fun scalar(db: SQLiteDatabase, sql: String): String =
    db.rawQuery(sql, null).use { check(it.moveToFirst()); it.getString(0) }

  fun describe(db: SQLiteDatabase): JSONObject {
    check(!db.inTransaction()) { "Active SQLite transaction" }
    check(scalar(db, "PRAGMA foreign_keys") == "1") { "Foreign keys disabled" }
    db.rawQuery("PRAGMA foreign_key_check", null).use { check(!it.moveToFirst()) { "Foreign key check failed" } }
    db.rawQuery("PRAGMA integrity_check", null).use {
      check(it.moveToFirst() && it.getString(0) == "ok" && !it.moveToNext()) { "SQLite integrity check failed" }
    }
    val schema = JSONArray()
    val tables = JSONArray()
    val names = mutableSetOf<String>()
    db.rawQuery("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name", null).use { cursor ->
      while (cursor.moveToNext()) {
        val row = JSONArray()
        for (column in 0..3) row.put(if (cursor.isNull(column)) JSONObject.NULL else cursor.getString(column))
        schema.put(row)
        if (cursor.getString(0) == "table") {
          val name = cursor.getString(1)
          names.add(name)
          val quoted = name.replace("\"", "\"\"")
          tables.put(JSONArray().put(name).put(scalar(db, "SELECT count(*) FROM \"$quoted\"").toLong()))
        }
      }
    }
    check(names.containsAll(requiredTables)) { "Expected SmartFin tables missing" }
    val revision = scalar(db, "SELECT revision FROM financial_data_revision WHERE id=1").toLong()
    check(revision in 0..9_007_199_254_740_991L)
    return JSONObject().put("schema", schema).put("tables", tables)
      .put("revision", revision).put("userVersion", scalar(db, "PRAGMA user_version").toLong())
      .put("schemaVersion", scalar(db, "PRAGMA schema_version").toLong())
  }

  private fun verify(actual: JSONObject, expected: JSONObject) {
    for (key in listOf("schema", "tables", "revision", "userVersion", "schemaVersion")) {
      check(actual.get(key).toString() == expected.get(key).toString()) { "Snapshot metadata mismatch: $key" }
    }
  }

  fun capture(context: Context, token: String, expected: JSONObject): JSONObject =
    SmartFinDatabaseCoordinator.withParticipant(token) { permit ->
      SmartFinFinancialDeletion.assertCaptureAdmitted(context)
      val started = System.nanoTime()
      val source = context.getDatabasePath("smartfin.db")
      check(source.isFile) { "Database file unavailable" }
      val root = File(context.noBackupFilesDir, "smartfin-local-snapshots")
      check(root.isDirectory || root.mkdirs())
      val id = UUID.randomUUID().toString()
      val directory = File(root, id)
      check(directory.mkdir()) { "Snapshot directory must be new" }
      val destination = File(directory, "snapshot.db")
      try {
        val sourceValidationStart = System.nanoTime()
        var journal = ""
        // Driver checkpoint and close have already been acknowledged. Use RO:
        // Android RW open may reset the journal mode from platform defaults.
        usingDatabase(SQLiteDatabase.openDatabase(source.path, null, SQLiteDatabase.OPEN_READONLY)) { db ->
          // Android skips configuration FK PRAGMA on a read-only connection.
          // SQLite itself permits this connection-local setting without writes.
          db.execSQL("PRAGMA foreign_keys=ON")
          journal = scalar(db, "PRAGMA journal_mode").lowercase()
          check(journal in setOf("wal", "delete", "truncate", "persist")) { "Unsafe journal mode for capture" }
          // Rollback modes are connection-local and a new RO connection may
          // report DELETE after PERSIST/TRUNCATE close. WAL persists in header.
          check((journal == "wal") == (expected.getString("journal") == "wal")) { "Journal family changed during capture" }
          verify(describe(db), expected)
        }
        val sourceValidationMs = elapsed(sourceValidationStart)
        SmartFinDatabaseCoordinator.assertParticipant(permit)
        val copyStart = System.nanoTime()
        val sourceDigest = MessageDigest.getInstance("SHA-256")
        check(destination.createNewFile())
        FileOutputStream(destination).use { output ->
          DigestInputStream(source.inputStream(), sourceDigest).use { input -> input.copyTo(output) }
          output.fd.sync()
        }
        check(destination.length() > 0 && destination.length() == source.length()) { "Incomplete private copy" }
        val copyMs = elapsed(copyStart)
        val validationStart = System.nanoTime()
        usingDatabase(SQLiteDatabase.openDatabase(destination.path, null, SQLiteDatabase.OPEN_READONLY)) { snapshot ->
          snapshot.execSQL("PRAGMA foreign_keys=ON")
          verify(describe(snapshot), expected)
        }
        val snapshotVerificationMs = elapsed(validationStart)
        val hashStart = System.nanoTime()
        val digest = MessageDigest.getInstance("SHA-256")
        destination.inputStream().use { input ->
          val buffer = ByteArray(64 * 1024)
          while (true) { val length = input.read(buffer); if (length < 0) break; digest.update(buffer, 0, length) }
        }
        val copiedHash = digest.digest()
        check(MessageDigest.isEqual(sourceDigest.digest(), copiedHash)) { "Private snapshot byte verification failed" }
        SmartFinDatabaseCoordinator.assertParticipant(permit)
        val result = JSONObject().put("id", id).put("path", destination.absolutePath)
          .put("bytes", destination.length()).put("revision", expected.getLong("revision"))
          .put("sha256", copiedHash.joinToString("") { "%02x".format(it) })
          .put("journal", journal).put("journalBeforeClose", expected.getString("journal"))
          .put("sourceValidationMs", sourceValidationMs)
          .put("copyMs", copyMs).put("validationAndHashMs", elapsed(validationStart))
          .put("snapshotVerificationMs", snapshotVerificationMs).put("hashMs", elapsed(hashStart))
          .put("nativeTotalMs", elapsed(started))
        // A capture receipt is private evidence, never an external publication or a
        // financial commit receipt. Recovery must still verify the bytes and metadata.
        val receipt = AtomicFile(File(directory, "receipt.json"))
        val stream = receipt.startWrite()
        try {
          stream.write(JSONObject().put("snapshot", result).put("expected", expected).toString().toByteArray(Charsets.UTF_8))
          receipt.finishWrite(stream)
        } catch (error: Exception) { receipt.failWrite(stream); throw error }
        result
      } catch (error: Exception) {
        // Only the new private main file is ours. Never remove WAL/journal files.
        if (!SmartFinDatabaseCoordinator.isQuarantined()) {
          destination.delete()
          directory.delete()
        }
        throw error
      }
    }

  fun discard(context: Context, token: String, id: String) =
    SmartFinDatabaseCoordinator.withParticipant(token) {
      check(UUID.fromString(id).toString() == id) { "Invalid private snapshot identity" }
      val directory = File(File(context.noBackupFilesDir, "smartfin-local-snapshots"), id)
      val snapshot = File(directory, "snapshot.db")
      val receipt = AtomicFile(File(directory, "receipt.json"))
      if (receipt.baseFile.exists() || File(directory, "receipt.json.bak").exists()) {
        val expected = JSONObject(receipt.openRead().bufferedReader().use { reader -> reader.readText() }).getJSONObject("expected")
        check(!expected.has("backupJobId")) { "Publication job retains this snapshot; explicit evidence review required" }
      }
      if (snapshot.exists()) {
        // A RO WAL validation may leave SQLite-owned zero-length WAL/SHM files.
        // Let SQLite clean its own resources on last RW close, never unlink them.
        check(snapshot.setWritable(true, true))
        usingDatabase(SQLiteDatabase.openDatabase(snapshot.path, null, SQLiteDatabase.OPEN_READWRITE)) { db ->
          db.rawQuery("PRAGMA journal_mode=DELETE", null).use { row ->
            check(row.moveToFirst() && row.getString(0).lowercase() == "delete")
          }
        }
      }
      check(!snapshot.exists() || snapshot.delete()) { "Cannot remove private snapshot" }
      AtomicFile(File(directory, "receipt.json")).delete()
      check(!directory.exists() || directory.delete()) { "Private snapshot still has resources" }
    }

  private fun elapsed(start: Long): Double = (System.nanoTime() - start) / 1_000_000.0
}
