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
        // Exclude managed writers across validation, OS effect and acknowledgement,
        // without holding a SQLite transaction across a NotificationManager call.
        // This owner never calls/waits for JS. Recovery is enqueued after release.
        val token = SmartFinDatabaseCoordinator.acquire(OWNER)
        try {
          SmartFinDatabaseCoordinator.withParticipant(token) { permit ->
            SmartFinSubscriptionRemindersModule.withDatabase(context, permit) { db ->
              if (!SmartFinFinancialDeletion.resourcesAllowed(context, db)) return@withDatabase
              val epoch = SmartFinFinancialDeletion.epoch(db)
              if ((intent.getStringExtra("datasetEpoch") ?: "legacy") != epoch) return@withDatabase
              val content = db.rawQuery("""SELECT r.title,r.message,o.expected_date,r.fire_at FROM subscription_reminders r
                JOIN subscription_occurrences o ON o.id=r.occurrence_id
                JOIN recurring_subscriptions s ON s.id=o.subscription_id
                WHERE r.id=? AND r.revision=? AND r.desired='scheduled' AND r.delivery_status!='delivered'
                AND o.status='pending' AND s.status='active'""",arrayOf(id,revision.toString())).use { cursor ->
                val now = Date()
                if (!cursor.moveToFirst() || SimpleDateFormat("yyyy-MM-dd",Locale.US).format(now) > cursor.getString(2)) null
                else {
                  val fireAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US).apply {
                    timeZone = java.util.TimeZone.getTimeZone("UTC"); isLenient = false
                  }.parse(cursor.getString(3)) ?: return@use null
                  if (fireAt.after(now)) null else Pair(cursor.getString(0), cursor.getString(1))
                }
              } ?: return@withDatabase
              // The cursor is closed before any Android effect. An uncertain notify/SQL
              // outcome remains retryable; active-notification absence is not a receipt.
              SmartFinSubscriptionRemindersModule.ensureChannel(context)
              val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
              val permitted = Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
              val channelEnabled = Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(SmartFinSubscriptionRemindersModule.CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
              if (permitted && manager.areNotificationsEnabled() && channelEnabled) {
                val open = PendingIntent.getActivity(context,0,Intent(context,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                val generic = builder(context).setSmallIcon(com.smartfin.R.drawable.ic_subscription_reminder)
                  .setContentTitle("SmartFin").setContentText("Tienes un cobro pr\u00f3ximo.").build()
                val notification = builder(context).setSmallIcon(com.smartfin.R.drawable.ic_subscription_reminder)
                  .setContentTitle(content.first).setContentText(content.second)
                  .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(generic)
                  .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).build()
                manager.notify(SmartFinSubscriptionRemindersModule.notificationTag(id,epoch),1,notification)
                db.execSQL("UPDATE subscription_reminders SET delivery_status='delivered',applied_revision=revision,error=NULL WHERE id=? AND revision=? AND desired='scheduled' AND delivery_status!='delivered'",arrayOf<Any>(id,revision))
              } else {
                db.execSQL("UPDATE subscription_reminders SET delivery_status='blocked',error='denied' WHERE id=? AND revision=?",arrayOf<Any>(id,revision))
              }
            }
          }
        } finally {
          SmartFinDatabaseCoordinator.release(OWNER, token)
        }
      } catch (_: Exception) {
        SmartFinSubscriptionRemindersModule.enqueueRecovery(context)
      } finally { pendingResult?.finish() }
    }
  }
  private fun builder(context: Context): Notification.Builder =
    if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context,SmartFinSubscriptionRemindersModule.CHANNEL) else Notification.Builder(context)
  companion object {
    private const val OWNER = "subscription-reminder-delivery"
    private val executor = Executors.newSingleThreadExecutor()
  }
}

class SmartFinSubscriptionRecoveryReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context,intent: Intent) {
    val pending = goAsync()
    java.util.concurrent.Executors.newSingleThreadExecutor().also { executor -> executor.execute {
      try {
        try { SmartFinFinancialDeletion.recover(context) }
        catch (_: SmartFinFinancialDeletion.CleanupAlreadyRunningException) {
          // The active owner retains its permit and durable cleanup intent.
          android.util.Log.i("SmartFinRecovery", "Cleanup already active; recovery deferred")
        } catch (error: Exception) {
          // Log only the type: exception messages/stacks can contain private data.
          android.util.Log.e("SmartFinRecovery", "Cleanup recovery failed: " + error.javaClass.simpleName)
        }
        // Admission/epoch checks remain authoritative. If still pending, startup,
        // foreground or an existing retrying Worker can resume the durable intent.
        SmartFinSubscriptionRemindersModule.enqueueRecovery(context)
      } finally {
        try { pending.finish() } finally { executor.shutdown() }
      }
    } }
  }
}
