package com.smartfin

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

class SmartFinDriveBackupModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val preferences =
      reactContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
  private val executor = Executors.newSingleThreadExecutor()
  private var directoryPromise: Promise? = null

  private val activityListener: ActivityEventListener =
      object : BaseActivityEventListener() {
        override fun onActivityResult(
            activity: Activity,
            requestCode: Int,
            resultCode: Int,
            data: Intent?,
        ) {
          if (requestCode != DIRECTORY_REQUEST_CODE) return

          val promise = directoryPromise ?: return
          directoryPromise = null

          if (resultCode != Activity.RESULT_OK) {
            promise.reject("DIRECTORY_CANCELLED", "No se seleccionó una carpeta para el respaldo.")
            return
          }

          val directoryUri = data?.data
          if (directoryUri == null) {
            promise.reject("DIRECTORY_UNAVAILABLE", "Android no devolvió una carpeta válida.")
            return
          }

          val flags =
              data.flags and
                  (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
          var permissionPersistent = false
          try {
            if (flags != 0) {
              reactContext.contentResolver.takePersistableUriPermission(directoryUri, flags)
              permissionPersistent = hasPersistedPermission(directoryUri)
            }
          } catch (_: SecurityException) {
            // Some cloud document providers only grant temporary access. The current export can
            // still continue; SmartFin will ask for the folder again if Android later revokes it.
          }

          try {
            preferences.edit().putString(DIRECTORY_URI_KEY, directoryUri.toString()).apply()
            val result = Arguments.createMap()
            result.putString("locationName", readDisplayName(directoryUri) ?: "Carpeta seleccionada")
            result.putBoolean("permissionPersistent", permissionPersistent)
            promise.resolve(result)
          } catch (error: Exception) {
            promise.reject(
                "DIRECTORY_ACCESS_ERROR",
                "No se pudo acceder a la carpeta seleccionada.",
                error,
            )
          }
        }
      }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

  override fun getName(): String = "SmartFinDriveBackup"

  @ReactMethod
  fun chooseBackupDirectory(promise: Promise) {
    if (directoryPromise != null) {
      promise.reject("DIRECTORY_PICKER_BUSY", "Ya hay un selector de carpeta abierto.")
      return
    }

    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("ACTIVITY_UNAVAILABLE", "No se pudo abrir el selector de carpetas.")
      return
    }

    directoryPromise = promise
    val intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
          addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
          addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
        }
    activity.startActivityForResult(intent, DIRECTORY_REQUEST_CODE)
  }

  @ReactMethod
  fun getBackupStatus(currentRevision: Double, promise: Promise) {
    executor.execute {
      try {
        val directoryUri = storedDirectoryUri()
        if (directoryUri == null) {
          promise.resolve(statusMap(configured = false, outdated = false))
          return@execute
        }

        val manifestUri = findDocument(directoryUri, MANIFEST_FILE_NAME)
        if (manifestUri == null) {
          promise.resolve(
              statusMap(
                  configured = true,
                  outdated = true,
                  locationName = readDisplayName(directoryUri),
              ),
          )
          return@execute
        }

        val manifest = JSONObject(readText(manifestUri))
        val remoteRevision = manifest.optLong("revision", -1L)
        val lastBackupAt = manifest.optString("generatedAt").takeIf { it.isNotBlank() }
        val databaseExists = findDocument(directoryUri, DATABASE_BACKUP_FILE_NAME) != null
        promise.resolve(
            statusMap(
                configured = true,
                outdated = !databaseExists || remoteRevision < currentRevision.toLong(),
                locationName = readDisplayName(directoryUri),
                lastBackupAt = lastBackupAt,
                remoteRevision = remoteRevision.takeIf { it >= 0L },
            ),
        )
      } catch (error: SecurityException) {
        preferences.edit().remove(DIRECTORY_URI_KEY).apply()
        promise.resolve(
            statusMap(
                configured = false,
                outdated = false,
                accessNeedsRenewal = true,
            ),
        )
      } catch (error: Exception) {
        promise.reject("BACKUP_STATUS_ERROR", "No se pudo comprobar el respaldo de Google Drive.", error)
      }
    }
  }

  @ReactMethod
  fun exportBackup(currentRevision: Double, promise: Promise) {
    executor.execute {
      var database: SQLiteDatabase? = null
      try {
        val directoryUri = storedDirectoryUri()
            ?: throw IllegalStateException("Primero selecciona una carpeta de Google Drive.")
        val databaseFile = reactContext.getDatabasePath(DATABASE_NAME)
        if (!databaseFile.exists()) {
          throw IllegalStateException("No se encontró la base de datos local de SmartFin.")
        }

        writeDocument(
            directoryUri,
            DATABASE_BACKUP_FILE_NAME,
            "application/vnd.sqlite3",
        ) { output -> databaseFile.inputStream().use { input -> input.copyTo(output) } }

        database = SQLiteDatabase.openDatabase(databaseFile.path, null, SQLiteDatabase.OPEN_READONLY)
        val generatedFiles = mutableListOf(DATABASE_BACKUP_FILE_NAME)

        EXPORTS.forEach { export ->
          writeCsv(directoryUri, export.fileName, database, export.query)
          generatedFiles.add(export.fileName)
        }

        removePreviousYearFiles(directoryUri)
        val years = queryYears(database)
        years.forEach { year ->
          val fileName = "movimientos-$year.csv"
          writeCsv(
              directoryUri,
              fileName,
              database,
              YEARLY_TRANSACTIONS_QUERY,
              arrayOf(year),
          )
          generatedFiles.add(fileName)
        }

        val generatedAt =
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).run {
              timeZone = TimeZone.getTimeZone("UTC")
              format(Date())
            }
        val manifest =
            JSONObject()
                .put("formatVersion", 1)
                .put("database", DATABASE_BACKUP_FILE_NAME)
                .put("generatedAt", generatedAt)
                .put("revision", currentRevision.toLong())
                .put("encrypted", false)
                .put("files", JSONArray(generatedFiles))
        writeDocument(directoryUri, MANIFEST_FILE_NAME, "application/json") { output ->
          output.write(manifest.toString(2).toByteArray(Charsets.UTF_8))
        }
        generatedFiles.add(MANIFEST_FILE_NAME)

        val result = Arguments.createMap()
        result.putString("lastBackupAt", generatedAt)
        result.putString("locationName", readDisplayName(directoryUri) ?: "Google Drive")
        result.putInt("fileCount", generatedFiles.size)
        result.putBoolean("permissionPersistent", hasPersistedPermission(directoryUri))
        result.putDouble("revision", currentRevision)
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("BACKUP_EXPORT_ERROR", "No se pudo actualizar el respaldo de Google Drive.", error)
      } finally {
        database?.close()
      }
    }
  }

  override fun invalidate() {
    reactContext.removeActivityEventListener(activityListener)
    executor.shutdown()
    super.invalidate()
  }

  private fun storedDirectoryUri(): Uri? =
      preferences.getString(DIRECTORY_URI_KEY, null)?.let(Uri::parse)

  private fun statusMap(
      configured: Boolean,
      outdated: Boolean,
      locationName: String? = null,
      lastBackupAt: String? = null,
      remoteRevision: Long? = null,
      accessNeedsRenewal: Boolean = false,
  ) = Arguments.createMap().apply {
    putBoolean("configured", configured)
    putBoolean("outdated", outdated)
    putBoolean("accessNeedsRenewal", accessNeedsRenewal)
    putBoolean(
        "permissionPersistent",
        storedDirectoryUri()?.let(::hasPersistedPermission) == true,
    )
    locationName?.let { putString("locationName", it) }
    lastBackupAt?.let { putString("lastBackupAt", it) }
    remoteRevision?.let { putDouble("remoteRevision", it.toDouble()) }
  }

  private fun readDisplayName(uri: Uri): String? {
    return try {
      val metadataUri =
          if (DocumentsContract.isTreeUri(uri)) {
            DocumentsContract.buildDocumentUriUsingTree(
                uri,
                DocumentsContract.getTreeDocumentId(uri),
            )
          } else {
            uri
          }
      reactContext.contentResolver.query(
          metadataUri,
          arrayOf(OpenableColumns.DISPLAY_NAME),
          null,
          null,
          null,
      )?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }
    } catch (_: Exception) {
      // A folder name is cosmetic. Some cloud providers allow file operations but reject
      // metadata queries on their tree URI, so this must never block a backup.
      null
    }
  }

  private fun hasPersistedPermission(uri: Uri): Boolean =
      reactContext.contentResolver.persistedUriPermissions.any { permission ->
        permission.uri == uri && permission.isReadPermission && permission.isWritePermission
      }

  private fun findDocument(directoryUri: Uri, fileName: String): Uri? {
    val childrenUri =
        DocumentsContract.buildChildDocumentsUriUsingTree(
            directoryUri,
            DocumentsContract.getTreeDocumentId(directoryUri),
        )
    reactContext.contentResolver.query(
        childrenUri,
        arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME),
        null,
        null,
        null,
    )?.use { cursor ->
      while (cursor.moveToNext()) {
        if (cursor.getString(1) == fileName) {
          return DocumentsContract.buildDocumentUriUsingTree(directoryUri, cursor.getString(0))
        }
      }
    }
    return null
  }

  private fun writeDocument(
      directoryUri: Uri,
      fileName: String,
      mimeType: String,
      writer: (OutputStream) -> Unit,
  ) {
    val documentUri =
        findDocument(directoryUri, fileName)
            ?: DocumentsContract.createDocument(
                reactContext.contentResolver,
                DocumentsContract.buildDocumentUriUsingTree(
                    directoryUri,
                    DocumentsContract.getTreeDocumentId(directoryUri),
                ),
                mimeType,
                fileName,
            )
            ?: throw IllegalStateException("No se pudo crear $fileName.")
    reactContext.contentResolver.openOutputStream(documentUri, "wt")?.use(writer)
        ?: throw IllegalStateException("No se pudo escribir $fileName.")
  }

  private fun readText(uri: Uri): String =
      reactContext.contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
          ?: throw IllegalStateException("No se pudo leer el manifiesto del respaldo.")

  private fun writeCsv(
      directoryUri: Uri,
      fileName: String,
      database: SQLiteDatabase,
      query: String,
      selectionArgs: Array<String>? = null,
  ) {
    database.rawQuery(query, selectionArgs).use { cursor ->
      writeDocument(directoryUri, fileName, "text/csv") { output ->
        output.write(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()))
        output.bufferedWriter(Charsets.UTF_8).use { writer ->
          writer.appendLine(cursor.columnNames.joinToString(",") { csvEscape(it) })
          while (cursor.moveToNext()) {
            writer.appendLine(
                (0 until cursor.columnCount).joinToString(",") { index ->
                  csvEscape(cursorValue(cursor, index))
                },
            )
          }
        }
      }
    }
  }

  private fun cursorValue(cursor: Cursor, index: Int): String =
      if (cursor.isNull(index)) "" else cursor.getString(index)

  private fun csvEscape(value: String): String =
      if (value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r')) {
        "\"${value.replace("\"", "\"\"")}\""
      } else {
        value
      }

  private fun queryYears(database: SQLiteDatabase): List<String> {
    val years = mutableListOf<String>()
    database.rawQuery(
        "SELECT DISTINCT substr(date, 1, 4) AS year FROM transactions " +
            "WHERE date GLOB '[0-9][0-9][0-9][0-9]-*' ORDER BY year;",
        null,
    ).use { cursor ->
      while (cursor.moveToNext()) years.add(cursor.getString(0))
    }
    return years
  }

  private fun removePreviousYearFiles(directoryUri: Uri) {
    val manifestUri = findDocument(directoryUri, MANIFEST_FILE_NAME) ?: return
    try {
      val files = JSONObject(readText(manifestUri)).optJSONArray("files") ?: return
      for (index in 0 until files.length()) {
        val fileName = files.optString(index)
        if (fileName.matches(Regex("movimientos-[0-9]{4}\\.csv"))) {
          findDocument(directoryUri, fileName)?.let { uri ->
            DocumentsContract.deleteDocument(reactContext.contentResolver, uri)
          }
        }
      }
    } catch (_: Exception) {
      // A damaged old manifest must not prevent creating a fresh backup.
    }
  }

  private data class CsvExport(val fileName: String, val query: String)

  companion object {
    private const val DIRECTORY_REQUEST_CODE = 9237
    private const val PREFERENCES_NAME = "smartfin_drive_backup"
    private const val DIRECTORY_URI_KEY = "directory_uri"
    private const val DATABASE_NAME = "smartfin.db"
    private const val DATABASE_BACKUP_FILE_NAME = "smartfin-backup.db"
    private const val MANIFEST_FILE_NAME = "smartfin-manifest.json"

    private val EXPORTS =
        listOf(
            CsvExport("cuentas.csv", "SELECT * FROM accounts ORDER BY name;"),
            CsvExport("categorias.csv", "SELECT * FROM categories ORDER BY name;"),
            CsvExport("subcategorias.csv", "SELECT * FROM subcategories ORDER BY name;"),
            CsvExport(
                "tarjetas-credito.csv",
                "SELECT a.*, p.monthly_interest_rate FROM accounts a " +
                    "LEFT JOIN credit_card_profiles p ON p.account_id = a.id " +
                    "WHERE a.type = 'credit_card' ORDER BY a.name;",
            ),
            CsvExport("compras-cuotas.csv", "SELECT * FROM installment_purchases ORDER BY created_at;"),
        )

    private const val YEARLY_TRANSACTIONS_QUERY =
        "SELECT t.id, t.date AS fecha, t.description AS descripcion, " +
            "t.amount AS monto, t.currency AS moneda, t.type AS tipo, " +
            "t.direction AS direccion, t.status AS estado, " +
            "a.name AS cuenta, ta.name AS cuenta_destino, " +
            "c.name AS categoria, s.name AS subcategoria, " +
            "t.merchant_name AS comercio, t.payment_method AS medio_pago, " +
            "t.credit_card_hint AS tarjeta, t.notes AS notas, " +
            "t.created_at AS creado_en, t.updated_at AS actualizado_en " +
            "FROM transactions t " +
            "LEFT JOIN accounts a ON a.id = t.account_id " +
            "LEFT JOIN accounts ta ON ta.id = t.target_account_id " +
            "LEFT JOIN categories c ON c.id = t.category_id " +
            "LEFT JOIN subcategories s ON s.id = t.subcategory_id " +
            "WHERE substr(t.date, 1, 4) = ? ORDER BY t.date, t.created_at;"
  }
}
