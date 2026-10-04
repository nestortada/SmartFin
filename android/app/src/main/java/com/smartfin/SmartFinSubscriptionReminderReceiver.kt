package com.smartfin

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

class SmartFinSubscriptionReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context,intent: Intent) {
    val pendingResult = goAsync()
    executor.execute {
      try {
        val id = intent.getStringExtra("id") ?: return@execute
        val revision = intent.getIntExtra("revision",-1)
        SmartFinSubscriptionRemindersModule.withDatabase(context) { db ->
          db.beginTransaction()
          try {
            db.rawQuery("""SELECT r.title,r.message,o.expected_date FROM subscription_reminders r
              JOIN subscription_occurrences o ON o.id=r.occurrence_id
              JOIN recurring_subscriptions s ON s.id=o.subscription_id
              WHERE r.id=? AND r.revision=? AND r.desired='scheduled' AND r.delivery_status!='delivered'
              AND o.status='pending' AND s.status='active'""",arrayOf(id,revision.toString())).use { cursor ->
              if (cursor.moveToFirst() && SimpleDateFormat("yyyy-MM-dd",Locale.US).format(Date()) <= cursor.getString(2)) {
                SmartFinSubscriptionRemindersModule.ensureChannel(context)
                val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                val permitted = Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
                if (permitted && manager.areNotificationsEnabled()) {
                  val open = PendingIntent.getActivity(context,0,Intent(context,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                  val generic = builder(context).setSmallIcon(com.smartfin.R.drawable.ic_subscription_reminder)
                      .setContentTitle("SmartFin").setContentText("Tienes un cobro pr\u00f3ximo.").build()
                  val notification = builder(context).setSmallIcon(com.smartfin.R.drawable.ic_subscription_reminder)
                      .setContentTitle(cursor.getString(0)).setContentText(cursor.getString(1))
                      .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(generic)
                      .setContentIntent(open).setAutoCancel(true).build()
                  manager.notify(id,1,notification)
                  db.execSQL("UPDATE subscription_reminders SET delivery_status='delivered',applied_revision=revision,error=NULL WHERE id=? AND revision=?",arrayOf<Any>(id,revision))
                } else {
                  db.execSQL("UPDATE subscription_reminders SET delivery_status='blocked',error='denied' WHERE id=? AND revision=?",arrayOf<Any>(id,revision))
                }
              }
            }
            db.setTransactionSuccessful()
          } finally { db.endTransaction() }
        }
      } catch (_: Exception) {
        SmartFinSubscriptionRemindersModule.enqueueRecovery(context)
      } finally { pendingResult?.finish() }
    }
  }
  private fun builder(context: Context): Notification.Builder =
    if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context,SmartFinSubscriptionRemindersModule.CHANNEL) else Notification.Builder(context)
  companion object { private val executor = Executors.newSingleThreadExecutor() }
}

class SmartFinSubscriptionRecoveryReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context,intent: Intent) {
    SmartFinSubscriptionRemindersModule.enqueueRecovery(context)
  }
}
