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
import org.json.JSONObject

class SmartFinSubscriptionRemindersModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
  override fun getName(): String = "SmartFinSubscriptionReminders"

  @ReactMethod
  fun getStatus(promise: Promise) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    ensureChannel(context)
    val permission = Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    val channelEnabled = Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(CHANNEL).importance != NotificationManager.IMPORTANCE_NONE
    promise.resolve(Arguments.createMap().apply { putBoolean("granted", permission && manager.areNotificationsEnabled() && channelEnabled) })
  }

  @ReactMethod
  fun schedule(json: String, promise: Promise) {
    try {
      val input = JSONObject(json)
      val id = input.getString("id")
      val revision = input.getInt("revision")
      val valid = withDatabase(context) { db ->
        db.rawQuery("SELECT revision, desired, delivery_status FROM subscription_reminders WHERE id = ?", arrayOf(id)).use { cursor ->
          cursor.moveToFirst() && cursor.getInt(0) == revision && cursor.getString(1) == "scheduled" && cursor.getString(2) != "delivered"
        }
      } ?: false
      if (valid) {
        val pending = reminderIntent(context,id,revision,PendingIntent.FLAG_UPDATE_CURRENT)
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val timestamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(input.getString("fireAt"))!!.time
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,timestamp,pending)
      }
      promise.resolve(null)
    } catch (error: Exception) { promise.reject("REMINDER_SCHEDULE", "No se pudo programar el recordatorio local.", error) }
  }

  @ReactMethod
  fun cancel(id: String, promise: Promise) {
    try {
      val shouldCancel = withDatabase(context) { db ->
        db.rawQuery("SELECT desired FROM subscription_reminders WHERE id = ?",arrayOf(id)).use { !it.moveToFirst() || it.getString(0) == "cancelled" }
      } ?: true
      if (shouldCancel) cancelAlarm(context,id)
      promise.resolve(null)
    } catch (error: Exception) { promise.reject("REMINDER_CANCEL", "No se pudo cancelar el recordatorio.", error) }
  }

  @ReactMethod
  fun cancelAll(promise: Promise) {
    try {
      withDatabase(context) { db ->
        db.rawQuery("SELECT id FROM subscription_reminders",null).use { cursor -> while(cursor.moveToNext()) cancelAlarm(context,cursor.getString(0)) }
      }
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).activeNotifications
          .filter { it.tag?.startsWith("subscription-reminder:") == true }
          .forEach { (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(it.tag,it.id) }
      WorkManager.getInstance(context).cancelUniqueWork(MAINTENANCE)
      WorkManager.getInstance(context).cancelUniqueWork(RECOVERY)
      promise.resolve(null)
    } catch (error: Exception) { promise.reject("REMINDER_CANCEL_ALL", "No se pudieron cancelar los recordatorios.", error) }
  }

  @ReactMethod
  fun ensureMaintenance(promise: Promise) {
    try {
      ensureChannel(context)
      val request = PeriodicWorkRequestBuilder<SmartFinSubscriptionWorker>(24,TimeUnit.HOURS).build()
      WorkManager.getInstance(context).enqueueUniquePeriodicWork(MAINTENANCE,ExistingPeriodicWorkPolicy.KEEP,request)
      promise.resolve(null)
    } catch (error: Exception) { promise.reject("REMINDER_MAINTENANCE", "No se pudo programar el mantenimiento local.", error) }
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
      WorkManager.getInstance(context).enqueueUniqueWork(RECOVERY,ExistingWorkPolicy.KEEP,OneTimeWorkRequestBuilder<SmartFinSubscriptionWorker>().build())
    }
    fun reminderIntent(context: Context,id: String,revision: Int,flags: Int): PendingIntent =
      PendingIntent.getBroadcast(context,0,Intent(context,SmartFinSubscriptionReminderReceiver::class.java).apply {
        data = Uri.parse("smartfin-reminder:" + Uri.encode(id))
        putExtra("id",id); putExtra("revision",revision)
      },flags or PendingIntent.FLAG_IMMUTABLE)
    fun cancelAlarm(context: Context,id: String) {
      val pending = PendingIntent.getBroadcast(context,0,Intent(context,SmartFinSubscriptionReminderReceiver::class.java).apply {
        data = Uri.parse("smartfin-reminder:" + Uri.encode(id))
      },PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
      if (pending != null) { (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending); pending.cancel() }
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(id,1)
    }
    fun <T> withDatabase(context: Context, block: (SQLiteDatabase) -> T): T? {
      val file = context.getDatabasePath("smartfin.db")
      if (!file.exists()) return null
      return SQLiteDatabase.openDatabase(file.path,null,SQLiteDatabase.OPEN_READWRITE).use(block)
    }
  }
}
