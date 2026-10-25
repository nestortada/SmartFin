package com.smartfin

import android.app.NotificationManager
import android.content.Context
import java.io.File
import java.util.concurrent.CountDownLatch
import org.json.JSONArray
import org.json.JSONObject

/** Never included in the financial application. Counts successful notify calls, not perceived alerts. */
object Phase5DProbe {
  @Volatile var suppressRecovery = false
  @Volatile var stage = ""
  @Volatile var mode = ""
  @Volatile var finished = CountDownLatch(1)
  val events = java.util.Collections.synchronizedList(mutableListOf<JSONObject>())
  fun event(name: String) { events.add(JSONObject().put("name",name).put("ns",System.nanoTime()).put("thread",Thread.currentThread().name)) }
  fun hit(context: Context, name: String, transaction: Boolean = false) {
    event(name+":transaction="+transaction)
    if (stage == name) {
      stage=""
      if (mode == "kill") {
        File(context.filesDir,"phase5d-killed").writeText(name)
        val directory=File(context.getExternalFilesDir(null),"snapshot5b2-results"); directory.mkdirs()
        File(directory,"result.json").writeText(JSONObject().put("campaign","phase5d-kill-"+name).put("passed",true)
          .put("config",JSONObject().put("uid",android.os.Process.myUid()).put("pid",android.os.Process.myPid())
            .put("database",context.getDatabasePath("phase5b2_synthetic.db").absolutePath))
          .put("cases",JSONArray().put(JSONObject().put("name","native-process-kill-at-"+name).put("passed",true)))
          .put("evidence",JSONObject(evidence(context))).toString())
        android.os.Process.killProcess(android.os.Process.myPid())
      }
      if (mode == "fail") throw java.io.IOException("Injected delivery failure at $name")
    }
  }
  @Synchronized fun notified(context: Context) {
    val file=File(context.filesDir,"phase5d-notify-count")
    file.writeText(((if(file.exists()) file.readText().toInt() else 0)+1).toString())
    event("notify.returned")
  }
  fun evidence(context: Context): String {
    val manager=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val active=manager.activeNotifications.map { notification ->
      JSONObject().put("tag",notification.tag).put("id",notification.id).put("key",notification.key)
        .put("flags",notification.notification.flags).put("postTime",notification.postTime)
    }
    val count=File(context.filesDir,"phase5d-notify-count")
    return JSONObject().put("notifyCalls",if(count.exists()) count.readText().toInt() else 0)
      .put("active",JSONArray(active)).put("events",synchronized(events) { JSONArray(events.toList()) }).toString()
  }
}
