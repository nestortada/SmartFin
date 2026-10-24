package com.smartfin

import android.app.Activity
import android.content.Context
import android.content.Intent
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
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.util.concurrent.Executors

class SmartFinDriveBackupModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val preferences =
      reactContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
  private val executor = Executors.newCachedThreadPool()
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


  private fun submit(promise: Promise, operation: () -> Any?) {
    executor.execute {
      try { promise.resolve(operation()) }
      catch (error: Exception) { promise.reject("BACKUP_PUBLICATION", error.message ?: "No se pudo verificar el respaldo.", error) }
    }
  }

  @ReactMethod fun preparePublication(promise: Promise) = submit(promise) {
    SmartFinBackupPublisher.prepare(reactContext, storedDirectoryUri() ?: error("Selecciona una carpeta.")).toString()
  }
  @ReactMethod fun publishSnapshot(id: String, snapshotId: String?, promise: Promise) = submit(promise) {
    val result = SmartFinBackupPublisher.publish(reactContext, id, snapshotId)
    val target = Uri.parse(result.getString("directory"))
    result.remove("directory")
    result.put("locationName", readDisplayName(target) ?: "Carpeta seleccionada")
      .put("permissionPersistent", hasPersistedPermission(target)).toString()
  }
  @ReactMethod fun getPublicationJobs(promise: Promise) = submit(promise) { SmartFinBackupPublisher.jobs(reactContext).toString() }
  @ReactMethod fun publishSnapshotWithProgress(id: String, snapshotId: String?, attemptId: String, promise: Promise) = submit(promise) {
    var sequence = 0
    val result = SmartFinBackupPublisher.publish(reactContext, id, snapshotId) { phase, completed, total ->
      val event = Arguments.createMap()
      event.putString("jobId", id); event.putString("attemptId", attemptId)
      event.putString("state", phase); event.putInt("sequence", ++sequence)
      event.putInt("completedFiles", completed); event.putInt("totalFiles", total)
      reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("SmartFinBackupProgress", event)
    }
    val target = Uri.parse(result.getString("directory"))
    result.remove("directory")
    result.put("locationName", readDisplayName(target) ?: "Carpeta seleccionada")
      .put("permissionPersistent", hasPersistedPermission(target)).toString()
  }
  @ReactMethod fun failCapture(id: String, promise: Promise) = submit(promise) { SmartFinBackupPublisher.captureFailed(reactContext, id); null }
  @ReactMethod fun retainFailedJob(id: String, promise: Promise) = submit(promise) { SmartFinBackupPublisher.retainFailed(reactContext, id); null }

  @ReactMethod fun getBackupStatus(currentRevision: Double, promise: Promise) = submit(promise) {
    SmartFinFinancialDeletion.backup(reactContext) { epoch ->
    val directory = storedDirectoryUri()
    val result = Arguments.createMap()
    result.putBoolean("configured", directory != null)
    result.putBoolean("outdated", directory != null)
    result.putBoolean("accessNeedsRenewal", false)
    result.putBoolean("permissionPersistent", directory?.let(::hasPersistedPermission) == true)
    result.putString("validation", "unverified")
    result.putString("datasetCurrency", "unknown")
    if (directory != null) {
      readDisplayName(directory)?.let { result.putString("locationName", it) }
      try {
        val manifest = SmartFinBackupPublisher.discover(reactContext, directory)
        if (manifest != null) {
          val revision = manifest.getLong("financialRevision")
          result.putDouble("remoteRevision", revision.toDouble())
          result.putString("lastBackupAt", manifest.getString("generatedAt"))
          result.putString("generationId", manifest.getString("generationId"))
          result.putString("validation", "verified")
          val currency = SmartFinBackupPublisher.datasetCurrency(reactContext, manifest.getString("generationId"), epoch)
          result.putString("datasetCurrency", currency)
          result.putBoolean("outdated", currency != "current" || revision != currentRevision.toLong())
        } else {
          // Historical v1 remains readable, but existence/revision is not file-integrity evidence.
          val legacy = findDocument(directory, "smartfin-manifest.json")
          if (legacy != null) {
            val manifestV1 = JSONObject(readText(legacy))
            result.putString("validation", "legacyUnverified")
            result.putString("lastBackupAt", manifestV1.optString("generatedAt"))
          }
        }
      } catch (_: SecurityException) { result.putBoolean("accessNeedsRenewal", true) }
      catch (_: Exception) { result.putString("validation", "unverified") }
    }
    result
    }
  }

  override fun invalidate() {
    reactContext.removeActivityEventListener(activityListener)
    executor.shutdown()
    super.invalidate()
  }
  private fun storedDirectoryUri(): Uri? = preferences.getString(DIRECTORY_URI_KEY, null)?.let(Uri::parse)
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

  private fun readText(uri: Uri): String =
      reactContext.contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
          ?: throw IllegalStateException("No se pudo leer el manifiesto del respaldo.")

  companion object {
    private const val DIRECTORY_REQUEST_CODE = 9237
    private const val PREFERENCES_NAME = "smartfin_drive_backup"
    private const val DIRECTORY_URI_KEY = "directory_uri"
  }
}
