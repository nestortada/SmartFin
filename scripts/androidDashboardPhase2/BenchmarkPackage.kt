package com.smartfin

import android.database.sqlite.SQLiteDatabase
import android.os.Build
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.FrameMetrics
import android.view.Window
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.time.LocalDate
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

class BenchmarkPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(BenchmarkModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class BenchmarkModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val expectedPackage = "com.smartfin.dashboardphase2.bench"
  private val executor = Executors.newSingleThreadScheduledExecutor()
  private var sampling: ScheduledFuture<*>? = null
  private val pss = Collections.synchronizedList(mutableListOf<Int>())
  private val frames = Collections.synchronizedList(mutableListOf<Double>())
  private var frameListener: Window.OnFrameMetricsAvailableListener? = null
  override fun getName() = "DashboardBenchmark"
  private fun guard() { check(context.packageName == expectedPackage) { "Synthetic package guard failed" } }
  private fun config(name: String, fallback: String): String = context.currentActivity?.intent?.getStringExtra(name) ?: fallback
  override fun getConstants(): MutableMap<String, Any> {
    guard()
    return mutableMapOf(
      "version" to config("version", "after"), "size" to config("size", "1000"),
      "runId" to config("runId", "manual"), "date" to config("date", "2026-10-10T12:00:00-05:00"),
      "packageId" to context.packageName, "release" to !BuildConfig.DEBUG,
      "model" to Build.MODEL, "manufacturer" to Build.MANUFACTURER,
      "android" to Build.VERSION.RELEASE, "abi" to Build.SUPPORTED_ABIS[0],
      "timezone" to java.util.TimeZone.getDefault().id,
    )
  }
  private fun memoryPss(): Int { val info=Debug.MemoryInfo(); Debug.getMemoryInfo(info); return info.totalPss }

  @ReactMethod fun seed(size: Int, schema: ReadableArray, promise: Promise) {
    guard()
    if (size !in setOf(0, 80, 1000, 10000, 50000, 100000)) { promise.reject("SIZE", "Invalid synthetic size"); return }
    executor.execute {
      try {
        val file=context.getDatabasePath("dashboard_phase2_v3_${size}.db")
        file.parentFile?.mkdirs()
        val existed=file.exists()
        val db=SQLiteDatabase.openOrCreateDatabase(file, null)
        if (!existed) {
          for (index in 0 until schema.size()) db.execSQL(schema.getString(index))
          db.beginTransaction()
          try {
            val account=db.compileStatement("INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
            val accountRows=listOf(
              listOf("cash","cash","active",100.0,null), listOf("bank","bankAccount","active",1000.0,null),
              listOf("savings","savingsAccount","active",2000.0,null), listOf("investment","investment","active",5000.0,null),
              listOf("card","creditCard","active",900.0,400.0), listOf("loan","loan","active",800.0,600.0),
              listOf("closed","bankAccount","closed",9999.0,null), listOf("inactive","creditCard","inactive",9999.0,9999.0)
            )
            for (row in accountRows) {
              account.clearBindings(); account.bindString(1,row[0] as String);account.bindString(2,row[0] as String)
              account.bindString(3,row[1] as String);account.bindString(4,row[2] as String);account.bindString(5,"COP")
              account.bindDouble(6,row[3] as Double);if(row[4]!=null)account.bindDouble(7,row[4] as Double)
              account.bindString(8,"2026-01-01");account.bindString(9,"2026-01-01");account.executeInsert()
            }
            for ((id,type) in listOf("income" to "income","expense" to "expense","transfer" to "transfer","other" to "adjustment")) {
              db.execSQL("INSERT INTO categories VALUES (?,?,?,?,?)", arrayOf("cat_$id", "Synthetic $id", type, "general", "#000000"))
            }
            val insert=db.compileStatement("INSERT INTO transactions (id,amount,currency,description,date,account_id,category_id,type,direction,status,target_account_id,merchant_name,payment_method,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            val types=arrayOf("income","expense","expense","internalTransfer","internalTransfer","creditCardPayment","refund","investment","manualAdjustment","loanPayment","income","expense","expense","income","expense","income","expense","refund","investment","manualAdjustment")
            val edges=arrayOf("2025-12-31T23:59:59-05:00","2026-01-01T00:00:00+14:00","2026-09-09T23:59:59Z","2026-09-10T00:00:00Z","2026-09-30T23:59:59Z","2026-10-01T00:00:00-05:00","2026-10-10T23:59:59-05:00","2026-10-11T00:00:00+14:00","2026-10-31T23:59:59Z","2026-11-01T00:00:00Z","2024-02-29","2024-03-01","2026-12-31","2027-01-01","2026-02-30","2026-02-31")
            for (index in 0 until size) {
              val slot=index%20; val cycle=index/20; val type=types[slot]
              val date=if(size==80) edges[(if(slot==3 || slot==4) cycle else index)%edges.size] else if(cycle==0) "2026-10-05T12:00:00Z" else LocalDate.of(2023,10,11).plusDays(((cycle*37+slot/2)%1096).toLong()).toString()+"T12:00:00Z"
              val amount=if(slot==3 || slot==4) (cycle%1000)+0.1 else (index%10000)+if(index%3==0)0.1 else 0.2
              val direction=if(type=="income" || type=="refund" || slot==4)"inflow" else if(type=="manualAdjustment")"neutral" else "outflow"
              val status=if(slot==12)"cancelled" else if(slot==13)"pending" else if(cycle%10<7)"posted" else if(cycle%10<9)"pending" else "cancelled"
              val accountId=if(slot==2)"card" else if(slot==4 || slot==10)"savings" else if(slot==11)"cash" else "bank"
              val target=when(slot){3->"savings";4->"bank";5->"card";7->"investment";9->"loan";else->null}
              val category=if(type=="income")"cat_income" else if(type=="expense")"cat_expense" else if(type=="internalTransfer")"cat_transfer" else "cat_other"
              insert.clearBindings();insert.bindString(1,"synthetic-$index");insert.bindDouble(2,amount);insert.bindString(3,"COP")
              insert.bindString(4,"Synthetic merchant ${index%50}");insert.bindString(5,date);insert.bindString(6,accountId);insert.bindString(7,category)
              insert.bindString(8,type);insert.bindString(9,direction);insert.bindString(10,status);if(target!=null)insert.bindString(11,target)
              insert.bindString(12,"Synthetic merchant ${index%50}");insert.bindString(13,if(slot==2)"credit" else "debit")
              insert.bindString(14,"Synthetic validation only. No production financial data. ".repeat(3))
              insert.bindString(15,"2026-10-10T12:${String.format("%02d",index%60)}:${String.format("%02d",index/60%60)}Z")
              insert.bindString(16,"2026-10-10T12:00:00Z");insert.executeInsert()
            }
            db.setTransactionSuccessful()
          } finally { db.endTransaction() }
        }
        val count=db.rawQuery("SELECT COUNT(*) FROM transactions",null).use{it.moveToFirst();it.getInt(0)}
        check(count==size){"Synthetic dataset mismatch"}
        val sqliteVersion=db.rawQuery("SELECT sqlite_version()",null).use{it.moveToFirst();it.getString(0)}
        db.close()
        val response=Arguments.createMap();response.putString("name",file.name);response.putInt("rows",count)
        response.putString("sqlite",sqliteVersion);response.putBoolean("reused",existed)
        promise.resolve(response)
      } catch(error:Exception){promise.reject("SEED",error)}
    }
  }

  @ReactMethod fun beginSample(promise: Promise) {
    guard(); pss.clear(); frames.clear(); pss.add(memoryPss())
    sampling=executor.scheduleAtFixedRate({pss.add(memoryPss())},100,100,TimeUnit.MILLISECONDS)
    Handler(Looper.getMainLooper()).post {
      val window=context.currentActivity?.window
      frameListener=Window.OnFrameMetricsAvailableListener { _, metrics, _ ->
        frames.add(metrics.getMetric(FrameMetrics.TOTAL_DURATION)/1000000.0)
      }
      if(window!=null)window.addOnFrameMetricsAvailableListener(frameListener!!,Handler(Looper.getMainLooper()))
      promise.resolve(null)
    }
  }
  private fun output(record: JSONObject) {
    val runId=config("runId","manual")
    require(runId.matches(Regex("[a-zA-Z0-9-]{1,80}")))
    val directory=File(context.getExternalFilesDir(null),"phase2-results");directory.mkdirs()
    File(directory,"$runId.jsonl").appendText(record.toString()+"\n")
    Log.i("SFPhase2", "RECORD run=$runId type=${record.optString("type")} iteration=${record.optInt("iteration",-1)}")
  }
  @ReactMethod fun finishSample(json: String, promise: Promise) {
    guard();sampling?.cancel(false);pss.add(memoryPss())
    Handler(Looper.getMainLooper()).post {
      frameListener?.let{context.currentActivity?.window?.removeOnFrameMetricsAvailableListener(it)}
      val result=JSONObject(json)
      val db=SQLiteDatabase.openDatabase(context.getDatabasePath("dashboard_phase2_v3_${result.getInt("size")}.db").path,null,SQLiteDatabase.OPEN_READONLY)
      try {
        val queries=result.getJSONArray("queries")
        for(index in 0 until queries.length()) {
          val query=queries.getJSONObject(index);val sql=query.getString("sql");val values=query.getJSONArray("values")
          val from=sql.indexOf("FROM transactions",ignoreCase=true)
          if(from>=0) {
            val hasRange=sql.contains("date >= ?")
            val candidates=if(hasRange)db.rawQuery("SELECT COUNT(*) FROM transactions WHERE date>=? AND date<?",arrayOf(values.getString(0),values.getString(1))) else db.rawQuery("SELECT COUNT(*) FROM transactions",null)
            query.put("indexRangeCandidateRows",candidates.use{it.moveToFirst();it.getInt(0)})
            var clause=sql.substring(from).substringBefore("GROUP BY").substringBefore("ORDER BY").trim().trimEnd(';')
            val arguments=Array(values.length()){position->values.get(position).toString()}
            val matching=db.rawQuery("SELECT COUNT(*) $clause",arguments).use{it.moveToFirst();it.getInt(0)}
            query.put("matchingTransactionRows",matching)
          }
        }
      } finally {db.close()}
      synchronized(pss){result.put("pssStartKb",pss.firstOrNull());result.put("pssEndKb",pss.lastOrNull());result.put("pssPeakSampledKb",pss.maxOrNull());result.put("pssSamplesKb",JSONArray(pss.toList()))}
      synchronized(frames){result.put("nativeFrameDurationsMs",JSONArray(frames.toList()))}
      result.put("release",!BuildConfig.DEBUG);result.put("packageId",context.packageName)
      result.put("windowFocused",context.currentActivity?.hasWindowFocus() == true)
      result.put("screenInteractive",(context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager).isInteractive)
      result.put("keyguardLocked",(context.getSystemService(android.content.Context.KEYGUARD_SERVICE) as android.app.KeyguardManager).isKeyguardLocked)
      result.put("displayRefreshHz",context.currentActivity?.display?.refreshRate)
      output(result);promise.resolve(null)
    }
  }
  @ReactMethod fun writeFunctional(json: String,promise: Promise){guard();output(JSONObject(json));promise.resolve(null)}
}

