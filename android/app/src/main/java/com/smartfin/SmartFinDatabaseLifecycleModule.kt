package com.smartfin

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.UUID
import java.util.concurrent.Executors
import org.json.JSONObject

class SmartFinDatabaseLifecycleModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {
  private val host = UUID.randomUUID().toString()
  // Acquisition must not occupy the RN executor needed by driver close/SQL.
  private val executor = Executors.newCachedThreadPool()
  override fun getName() = "SmartFinDatabaseLifecycle"

  private fun submit(promise: Promise, operation: () -> Any?) {
    executor.execute {
      try { promise.resolve(operation()) }
      catch (error: Exception) { promise.reject("DATABASE_LIFECYCLE", "No se pudo confirmar el ciclo de vida SQLite.", error) }
    }
  }

  @ReactMethod fun acquire(promise: Promise) = submit(promise) { SmartFinDatabaseCoordinator.acquire(host) }
  @ReactMethod fun checkOwner(token: String, promise: Promise) = submit(promise) {
    SmartFinDatabaseCoordinator.withParticipant(token) { }; null
  }
  @ReactMethod fun release(token: String, promise: Promise) = submit(promise) {
    SmartFinDatabaseCoordinator.release(host, token); null
  }
  @ReactMethod fun quarantine(promise: Promise) = submit(promise) {
    SmartFinDatabaseCoordinator.quarantine(); null
  }
  @ReactMethod fun capture(token: String, expected: String, promise: Promise) = submit(promise) {
    SmartFinLocalSnapshot.capture(context, token, JSONObject(expected)).toString()
  }
  @ReactMethod fun beginFinancialDeletion(promise: Promise) = submit(promise) { SmartFinFinancialDeletion.begin(context).toString() }
  @ReactMethod fun financialDeletionInventory(id: String, token: String, promise: Promise) = submit(promise) {
    SmartFinFinancialDeletion.inventory(context, id, token).toString()
  }
  @ReactMethod fun rollbackFinancialDeletion(id: String, token: String, promise: Promise) = submit(promise) {
    SmartFinFinancialDeletion.rollbackConfirmed(context, id, token); null
  }
  @ReactMethod fun recoverFinancialDeletion(promise: Promise) = submit(promise) {
    // Another owner (receiver, Worker) holds the cleanup mutex: recover() refused before
    // touching any state. Report it as in progress; every other failure still rejects.
    try { SmartFinFinancialDeletion.recover(context).toString() }
    catch (_: SmartFinFinancialDeletion.CleanupAlreadyRunningException) { JSONObject().put("status", "running").toString() }
  }
  @ReactMethod fun resourceEpoch(token: String, promise: Promise) = submit(promise) { SmartFinFinancialDeletion.resourceEpoch(context, token) }
  @ReactMethod fun discard(token: String, id: String, promise: Promise) = submit(promise) {
    SmartFinLocalSnapshot.discard(context, token, id); null
  }
  override fun invalidate() {
    SmartFinDatabaseCoordinator.invalidateHost(host)
    executor.shutdown() // Never interrupt a copy and release its protection early.
    super.invalidate()
  }
}
