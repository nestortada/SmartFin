package com.smartfin

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.os.Build
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors
import org.json.JSONObject

class SmartFinSubscriptionRemindersModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
  override fun getName(): String = "SmartFinSubscriptionReminders"
  private val executor = Executors.newCachedThreadPool()

  private fun protectedOperation(token: String?, promise: Promise, code: String,
      operation: (SmartFinDatabaseCoordinator.Participant) -> Unit) {
    executor.execute {
      try {
        SmartFinDatabaseCoordinator.withParticipant(token, operation)
        promise.resolve(null)
      } catch (error: Exception) { promise.reject(code, "No se pudo completar el recordatorio local.", error) }
    }
  }

  override fun invalidate() {
    executor.shutdown() // Drain resources; never release an active permit by timeout.
    super.invalidate()
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    ensureChannel(context)
    val permission = Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    val channelEnabled = Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(CHANNEL).importance != NotificationManager.IMPORTANCE_NONE
    promise.resolve(Arguments.createMap().apply { putBoolean("granted", permission && manager.areNotificationsEnabled() && channelEnabled) })
  }

  @ReactMethod
  fun schedule(json: String, token: String?, promise: Promise) {
    protectedOperation(token, promise, "REMINDER_SCHEDULE") { permit ->
      val input = JSONObject(json)
      val id = input.getString("id")
      val revision = input.getInt("revision")
      var epoch = "legacy"
      val valid = withDatabase(context, permit) { db ->
        check(SmartFinFinancialDeletion.resourcesAllowed(context, db)) { "Deletion cleanup pending" }
        epoch = SmartFinFinancialDeletion.epoch(db)
        db.rawQuery("SELECT revision, desired, delivery_status FROM subscription_reminders WHERE id = ?", arrayOf(id)).use { cursor ->
          cursor.moveToFirst() && cursor.getInt(0) == revision && cursor.getString(1) == "scheduled" && cursor.getString(2) != "delivered"
        }
      } ?: false
      if (valid) {
        val pending = reminderIntent(context,id,revision,PendingIntent.FLAG_UPDATE_CURRENT,epoch)
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val timestamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(input.getString("fireAt"))!!.time
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,timestamp,pending)
      }
    }
  }

  @ReactMethod
  fun cancel(id: String, token: String?, promise: Promise) {
    protectedOperation(token, promise, "REMINDER_CANCEL") { permit ->
      var epoch = "legacy"
      val shouldCancel = withDatabase(context, permit) { db ->
        check(SmartFinFinancialDeletion.resourcesAllowed(context, db)) { "Deletion cleanup pending" }
        epoch = SmartFinFinancialDeletion.epoch(db)
        db.rawQuery("SELECT desired FROM subscription_reminders WHERE id = ?",arrayOf(id)).use { !it.moveToFirst() || it.getString(0) == "cancelled" }
      } ?: true
      if (shouldCancel) cancelAlarm(context,id,epoch)
    }
  }

  @ReactMethod
  fun cancelAll(token: String?, promise: Promise) {
    protectedOperation(token, promise, "REMINDER_CANCEL_ALL") { permit ->
      withDatabase(context, permit) { db ->
        check(SmartFinFinancialDeletion.resourcesAllowed(context, db)) { "Deletion cleanup pending" }
        val epoch = SmartFinFinancialDeletion.epoch(db)
        db.rawQuery("SELECT id FROM subscription_reminders",null).use { cursor -> while(cursor.moveToNext()) cancelAlarm(context,cursor.getString(0),epoch) }
      }
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).activeNotifications
          .filter { it.tag?.startsWith("subscription-reminder:") == true }
          .forEach { (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(it.tag,it.id) }
      WorkManager.getInstance(context).cancelUniqueWork(MAINTENANCE)
      WorkManager.getInstance(context).cancelUniqueWork(RECOVERY)
    }
  }

  @ReactMethod
  fun ensureMaintenance(token: String?, promise: Promise) {
    protectedOperation(token, promise, "REMINDER_MAINTENANCE") { permit ->
      val epoch = withDatabase(context, permit) { db ->
        check(SmartFinFinancialDeletion.resourcesAllowed(context, db)) { "Deletion cleanup pending" }
        SmartFinFinancialDeletion.epoch(db)
      }
        ?: error("Database unavailable")
      ensureChannel(context)
      val request = PeriodicWorkRequestBuilder<SmartFinSubscriptionWorker>(24,TimeUnit.HOURS)
        .setInputData(androidx.work.Data.Builder().putString("datasetEpoch",epoch).build()).build()
      WorkManager.getInstance(context).enqueueUniquePeriodicWork(MAINTENANCE,ExistingPeriodicWorkPolicy.KEEP,request)
    }
  }

  @ReactMethod
  fun completeMaintenance(runId: String, success: Boolean) {
    SmartFinSubscriptionWorker.complete(runId,success)
  }

  companion object {
    const val CHANNEL = "smartfin_subscription_reminders"
    const val MAINTENANCE = "smartfin-subscription-maintenance"
    const val RECOVERY = "smartfin-subscription-recovery"
    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT >= 26) {
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(
          NotificationChannel(CHANNEL,"Recordatorios de suscripciones",NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Cobros esperados registrados localmente"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
          },
        )
      }
    }
    fun enqueueRecovery(context: Context) {
      // Receive/boot callbacks only enqueue under the gate; never wait for Headless JS here.
      try {
        withDatabase(context) { db ->
          if (SmartFinFinancialDeletion.resourcesAllowed(context, db))
            WorkManager.getInstance(context).enqueueUniqueWork(RECOVERY,ExistingWorkPolicy.KEEP,
              OneTimeWorkRequestBuilder<SmartFinSubscriptionWorker>().setInputData(
                androidx.work.Data.Builder().putString("datasetEpoch",SmartFinFinancialDeletion.epoch(db)).build()).build())
        }
      } catch (_: Exception) { /* Startup/foreground also recovers pending cleanup. */ }
    }
    private fun reminderUri(id: String, epoch: String): Uri = Uri.parse(
      if (epoch == "legacy") "smartfin-reminder:" + Uri.encode(id)
      else "smartfin-reminder-epoch:$epoch:" + Uri.encode(id))
    fun reminderIntent(context: Context,id: String,revision: Int,flags: Int,epoch: String = "legacy"): PendingIntent =
      PendingIntent.getBroadcast(context,0,Intent(context,SmartFinSubscriptionReminderReceiver::class.java).apply {
        data = reminderUri(id,epoch)
        putExtra("id",id); putExtra("revision",revision); putExtra("datasetEpoch",epoch)
      },flags or PendingIntent.FLAG_IMMUTABLE)
    fun notificationTag(id: String, epoch: String) = if (epoch == "legacy") id else "$epoch:$id"
    fun cancelAlarm(context: Context,id: String,epoch: String = "legacy") {
      val pending = PendingIntent.getBroadcast(context,0,Intent(context,SmartFinSubscriptionReminderReceiver::class.java).apply {
        data = reminderUri(id,epoch)
      },PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
      if (pending != null) { (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending); pending.cancel() }
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(notificationTag(id,epoch),1)
    }
    fun <T> withDatabase(context: Context, block: (SQLiteDatabase) -> T): T? =
      SmartFinDatabaseCoordinator.withParticipant { permit -> withDatabase(context, permit, block) }

    fun <T> withDatabase(context: Context, permit: SmartFinDatabaseCoordinator.Participant,
        block: (SQLiteDatabase) -> T): T? {
      SmartFinDatabaseCoordinator.assertParticipant(permit)
      val file = context.getDatabasePath("smartfin.db")
      if (!file.exists()) return null
      val db = SQLiteDatabase.openDatabase(file.path,null,SQLiteDatabase.OPEN_READWRITE)
      try {
        db.setForeignKeyConstraintsEnabled(true)
        db.rawQuery("PRAGMA foreign_keys", null).use { check(it.moveToFirst() && it.getInt(0) == 1) }
        return block(db)
      } finally {
        try { db.close() }
        catch (error: Exception) { SmartFinDatabaseCoordinator.quarantine(); throw error }
      }
    }
  }
}
