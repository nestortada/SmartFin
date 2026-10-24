package com.smartfin

import android.content.Context
import android.os.Debug
import android.database.sqlite.SQLiteDatabase
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** Only synthetic APK. Paired exports of the SAME immutable file, alternated order. */
object CsvDiagnostics {
  fun run(context: Context, id: String): JSONObject {
    check(context.packageName == "com.smartfin.snapshot5b2.tests")
    check(java.util.UUID.fromString(id).toString() == id)
    val snapshot = File(context.noBackupFilesDir, "smartfin-local-snapshots/$id/snapshot.db")
    val before = SmartFinBackupPublisher.digest(snapshot.inputStream())
    val evidence = JSONArray()
    for (index in 0..5) {
      val pair = JSONObject().put("repetition", index).put("measured", index > 0)
      var expected: Map<String, Pair<Long, String>>? = null
      for (variant in if (index % 2 == 0) listOf("baseline", "candidate") else listOf("candidate", "baseline")) {
        val directory = File(context.cacheDir, "csv-diagnostic-$id-$index-$variant").apply { check(mkdirs()) }
        val start = System.nanoTime(); val cpu = Debug.threadCpuTimeNanos()
        val files = if (variant == "baseline") CsvBaseline.export(snapshot, directory) else CsvCandidate.export(snapshot, directory)
        val elapsed = (System.nanoTime() - start) / 1_000_000.0
        val cpuMs = (Debug.threadCpuTimeNanos() - cpu) / 1_000_000.0
        val hashes = files.associate { (name, file) -> name to SmartFinBackupPublisher.digest(file.inputStream()) }
        if (expected == null) expected = hashes else check(hashes == expected) { "CSV bytes differ" }
        pair.put(variant, JSONObject().put("wallMs", elapsed).put("threadCpuMs", cpuMs)
          .put("components", JSONObject(hashes.mapValues { (_, v) -> JSONObject().put("bytes", v.first).put("sha256", v.second) })))
      }
      evidence.put(pair)
    }
    // Escaping/null/Unicode edge cases live only in a working clone, never the snapshot.
    val edge = File(context.cacheDir, "csv-edge-$id.db")
    snapshot.copyTo(edge); check(edge.setWritable(true, true))
    SQLiteDatabase.openDatabase(edge.path, null, SQLiteDatabase.OPEN_READWRITE).use { db ->
      db.execSQL("UPDATE transactions SET description=?,notes=? WHERE id=(SELECT id FROM transactions LIMIT 1)",
        arrayOf("comma, quote \" and ñ😀", "line 1\nline 2\r\n"))
      db.execSQL("UPDATE transactions SET notes=NULL WHERE id=(SELECT id FROM transactions ORDER BY id DESC LIMIT 1)")
    }
    val edgeBaseline = File(context.cacheDir, "csv-edge-baseline-$id").apply { check(mkdirs()) }
    val edgeCandidate = File(context.cacheDir, "csv-edge-candidate-$id").apply { check(mkdirs()) }
    val expected = CsvBaseline.export(edge, edgeBaseline).associate { (name, file) -> name to SmartFinBackupPublisher.digest(file.inputStream()) }
    val actual = CsvCandidate.export(edge, edgeCandidate).associate { (name, file) -> name to SmartFinBackupPublisher.digest(file.inputStream()) }
    check(expected == actual) { "Edge CSV bytes differ" }
    check(before == SmartFinBackupPublisher.digest(snapshot.inputStream())) { "Snapshot mutated" }
    return JSONObject().put("snapshotId", id).put("snapshotSha256", before.second).put("pairs", evidence).put("edgeCasesEqual", true)
  }
}
