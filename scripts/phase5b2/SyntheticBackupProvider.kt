package com.smartfin

import android.database.Cursor
import android.database.MatrixCursor
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract.Document
import android.provider.DocumentsContract.Root
import android.provider.DocumentsProvider
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

/** Test APK only. Never registered in the product manifest. */
object BackupFaults {
  @Volatile var fault = ""
  @Volatile var reached = CountDownLatch(1)
  @Volatile var proceed = CountDownLatch(1)
  val writes = mutableListOf<String>()
  @Synchronized fun wrote(name: String) { writes.add(name) }
  @Synchronized fun takeWrites(): List<String> = writes.toList().also { writes.clear() }
  fun hit(stage: String) {
    if (fault == stage) { fault = ""; throw java.io.IOException("Injected $stage") }
    if (fault == "pause:$stage") {
      reached.countDown(); check(proceed.await(60, TimeUnit.SECONDS)); fault = ""
    }
  }
}
class SyntheticBackupProvider : DocumentsProvider() {
  override fun onCreate() = true
  private fun directory(): File {
    check(context!!.packageName == "com.smartfin.snapshot5b2.tests")
    return File(context!!.noBackupFilesDir, "saf-synthetic").apply { check(isDirectory || mkdir()) }
  }
  private fun file(id: String): File {
    check(id != "." && id != ".." && !id.contains('/') && !id.contains('\\'))
    return if (id == "root") directory() else File(directory(), id)
  }
  private fun allowed() { if (BackupFaults.fault == "revoked") throw SecurityException("Synthetic revoked permission") }
  override fun queryRoots(projection: Array<out String>?): Cursor = MatrixCursor(arrayOf(Root.COLUMN_ROOT_ID, Root.COLUMN_DOCUMENT_ID, Root.COLUMN_TITLE)).apply {
    addRow(arrayOf("root", "root", "Synthetic SAF"))
  }
  private fun columns(projection: Array<out String>?) = projection ?: arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_SIZE, Document.COLUMN_FLAGS)
  private fun row(cursor: MatrixCursor, file: File, id: String) {
    cursor.addRow(cursor.columnNames.map { key -> when(key) {
      Document.COLUMN_DOCUMENT_ID -> id
      Document.COLUMN_DISPLAY_NAME -> file.name
      Document.COLUMN_MIME_TYPE -> if (file.isDirectory) Document.MIME_TYPE_DIR else "application/octet-stream"
      Document.COLUMN_SIZE -> file.length()
      Document.COLUMN_FLAGS -> if (file.isDirectory) Document.FLAG_DIR_SUPPORTS_CREATE else Document.FLAG_SUPPORTS_WRITE
      else -> null
    } }.toTypedArray())
  }
  override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor {
    allowed(); return MatrixCursor(columns(projection)).apply { row(this, file(documentId), documentId) }
  }
  override fun queryChildDocuments(parentDocumentId: String, projection: Array<out String>?, sortOrder: String?): Cursor {
    allowed(); check(parentDocumentId == "root")
    return MatrixCursor(columns(projection)).apply { directory().listFiles().orEmpty().sortedBy { it.name }.forEach { row(this, it, it.name) } }
  }
  override fun isChildDocument(parentDocumentId: String, documentId: String): Boolean =
    parentDocumentId == "root" && documentId != "root" && file(documentId).isFile
  override fun createDocument(parentDocumentId: String, mimeType: String, displayName: String): String {
    allowed(); check(parentDocumentId == "root")
    if (BackupFaults.fault == "reuse:" + logical(displayName)) { BackupFaults.fault = ""; return "smartfin-backup.db" }
    BackupFaults.hit("create:" + logical(displayName))
    check(file(displayName).createNewFile()) { "Synthetic provider rejects duplicate names" }
    return displayName
  }
  override fun openDocument(documentId: String, mode: String, signal: CancellationSignal?): ParcelFileDescriptor {
    allowed()
    val target = file(documentId)
    val name = logical(documentId)
    if (mode.contains('w')) {
      BackupFaults.wrote(documentId)
      BackupFaults.hit("open:$name")
      if (BackupFaults.fault == "partial:$name") {
        BackupFaults.fault = ""
        val pipe = ParcelFileDescriptor.createReliablePipe()
        Thread {
          try {
            ParcelFileDescriptor.AutoCloseInputStream(pipe[0]).use { input ->
              val buffer = ByteArray(32)
              val count = input.read(buffer)
              target.writeBytes(if (count > 0) buffer.copyOf(count) else byteArrayOf())
              pipe[0].closeWithError("Synthetic partial write")
            }
          } catch (_: Exception) { }
        }.start()
        return pipe[1]
      }
    } else {
      BackupFaults.hit("read:$name")
      if (BackupFaults.fault == "corrupt:$name") {
        BackupFaults.fault = ""; target.appendBytes(byteArrayOf(7))
      }
    }
    return ParcelFileDescriptor.open(target, ParcelFileDescriptor.parseMode(mode))
  }
  // Deletion/rename are intentionally not implemented: a test fails if production calls them.
  companion object {
    fun logical(name: String): String = if (name.startsWith("smartfin-generation-")) "manifest.json" else name.substringAfter("--", name)
  }
}
