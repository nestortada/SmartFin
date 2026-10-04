package com.smartfin

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.BridgeReactContext
import java.io.File
import java.lang.reflect.Proxy
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SubscriptionReminderTest {
  private val target = InstrumentationRegistry.getInstrumentation().targetContext
  private fun isolatedContext(): Context {
    val file = File(target.cacheDir,"subscription-test-${System.nanoTime()}.db")
    return object : ContextWrapper(target) {
      override fun getDatabasePath(name: String): File = file
      override fun getApplicationContext(): Context = this
    }
  }
  private fun promise(): Pair<Promise,CompletableFuture<Any?>> {
    val future = CompletableFuture<Any?>()
    val proxy = Proxy.newProxyInstance(Promise::class.java.classLoader,arrayOf(Promise::class.java)) { _,method,args ->
      if (method.name == "resolve") future.complete(args?.get(0))
      if (method.name == "reject") future.completeExceptionally(IllegalStateException(args?.joinToString()))
      null
    } as Promise
    return Pair(proxy,future)
  }
  private fun seed(context: Context,id: String) {
    SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath("smartfin.db"),null).use { db ->
      db.execSQL("CREATE TABLE recurring_subscriptions (id TEXT PRIMARY KEY,status TEXT)")
      db.execSQL("CREATE TABLE subscription_occurrences (id TEXT PRIMARY KEY,subscription_id TEXT,expected_date TEXT,status TEXT)")
      db.execSQL("CREATE TABLE subscription_reminders (id TEXT PRIMARY KEY,occurrence_id TEXT,revision INTEGER,desired TEXT,delivery_status TEXT,title TEXT,message TEXT,applied_revision INTEGER,error TEXT)")
      db.execSQL("INSERT INTO recurring_subscriptions VALUES ('s','active')")
      db.execSQL("INSERT INTO subscription_occurrences VALUES ('o','s','9999-12-31','pending')")
      db.execSQL("INSERT INTO subscription_reminders VALUES (?,'o',1,'scheduled','pending','Netflix','38900 COP',NULL,NULL)",arrayOf(id))
    }
  }
  @Test fun scheduleUpdateAndCancelUseStableAlarmIdentity() {
    val context = isolatedContext()
    val id = "subscription-reminder:test-${System.nanoTime()}"
    seed(context,id)
    val module = SmartFinSubscriptionRemindersModule(BridgeReactContext(context))
    try {
      val date = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US).apply { timeZone=TimeZone.getTimeZone("UTC") }.format(Date(System.currentTimeMillis()+3_600_000))
      val payload = JSONObject().put("id",id).put("revision",1).put("fireAt",date).toString()
      repeat(2) { val (callback,result) = promise(); module.schedule(payload,callback); result.get(5,TimeUnit.SECONDS) }
      val intent = Intent(context,SmartFinSubscriptionReminderReceiver::class.java).apply { data=Uri.parse("smartfin-reminder:"+Uri.encode(id)) }
      assertNotNull(PendingIntent.getBroadcast(context,0,intent,PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE))
      SmartFinSubscriptionRemindersModule.withDatabase(context) { it.execSQL("UPDATE subscription_reminders SET desired='cancelled'") }
      val (callback,result) = promise(); module.cancel(id,callback); result.get(5,TimeUnit.SECONDS)
      assertNull(PendingIntent.getBroadcast(context,0,intent,PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE))
    } finally { SmartFinSubscriptionRemindersModule.cancelAlarm(context,id); context.getDatabasePath("smartfin.db").delete() }
  }
  @Test fun receiverRejectsStaleRevisionAndPublishesOnlyOnePrivateNotification() {
    val context = isolatedContext()
    val id = "subscription-reminder:test-${System.nanoTime()}"
    seed(context,id)
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    instrumentation.uiAutomation.executeShellCommand("pm grant ${target.packageName} android.permission.POST_NOTIFICATIONS").close()
    val manager = target.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    try {
      val receiver = SmartFinSubscriptionReminderReceiver()
      receiver.onReceive(context,Intent().putExtra("id",id).putExtra("revision",0))
      Thread.sleep(300)
      assertFalse(manager.activeNotifications.any { it.tag == id })
      receiver.onReceive(context,Intent().putExtra("id",id).putExtra("revision",1))
      repeat(50) { if (!manager.activeNotifications.any { it.tag == id }) Thread.sleep(100) }
      val notification = manager.activeNotifications.single { it.tag == id }.notification
      assertEquals(android.app.Notification.VISIBILITY_PRIVATE,notification.visibility)
      assertEquals("Tienes un cobro pr\u00f3ximo.",notification.publicVersion.extras.getString(android.app.Notification.EXTRA_TEXT))
      receiver.onReceive(context,Intent().putExtra("id",id).putExtra("revision",1))
      Thread.sleep(300)
      assertEquals(1,manager.activeNotifications.count { it.tag == id })
      assertEquals("delivered",SmartFinSubscriptionRemindersModule.withDatabase(context) { db -> db.rawQuery("SELECT delivery_status FROM subscription_reminders",null).use { it.moveToFirst(); it.getString(0) } })
    } finally { manager.cancel(id,1); context.getDatabasePath("smartfin.db").delete() }
  }
  @Test fun maintenanceRunsThroughHeadlessJsWithoutMountingAScreen() {
    SmartFinSubscriptionRemindersModule.enqueueRecovery(target)
    val manager = WorkManager.getInstance(target)
    val deadline = System.currentTimeMillis()+90_000
    var state: WorkInfo.State? = null
    while (System.currentTimeMillis()<deadline) {
      state = manager.getWorkInfosForUniqueWork(SmartFinSubscriptionRemindersModule.RECOVERY).get(5,TimeUnit.SECONDS).firstOrNull()?.state
      if (state == WorkInfo.State.SUCCEEDED || state == WorkInfo.State.FAILED) break
      Thread.sleep(500)
    }
    assertEquals(WorkInfo.State.SUCCEEDED,state)
  }
  @Test fun deniedPermissionRetainsReminderAndDoesNotPublish() {
    // Revoke before instrumentation: Android kills the process when a runtime permission is revoked.
    org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("permissionDenied") == "true")
    val context = isolatedContext()
    val id = "subscription-reminder:denied-${System.nanoTime()}"
    seed(context,id)
    try {
      SmartFinSubscriptionReminderReceiver().onReceive(context,Intent().putExtra("id",id).putExtra("revision",1))
      var status: String? = null
      repeat(50) {
        status = SmartFinSubscriptionRemindersModule.withDatabase(context) { db -> db.rawQuery("SELECT delivery_status FROM subscription_reminders",null).use { it.moveToFirst(); it.getString(0) } }
        if (status != "blocked") Thread.sleep(100)
      }
      assertEquals("blocked",status)
      assertFalse((target.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).activeNotifications.any { it.tag == id })
    } finally {
      context.getDatabasePath("smartfin.db").delete()
    }
  }
  @Test fun recoveryReceiverEnqueuesMaintenanceForClockAndBootChanges() {
    SmartFinSubscriptionRecoveryReceiver().onReceive(target,Intent(Intent.ACTION_TIMEZONE_CHANGED))
    assertTrue(WorkManager.getInstance(target).getWorkInfosForUniqueWork(SmartFinSubscriptionRemindersModule.RECOVERY).get(5,TimeUnit.SECONDS).isNotEmpty())
  }
}
