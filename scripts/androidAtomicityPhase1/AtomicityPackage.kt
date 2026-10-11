package com.smartfin
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File
import android.database.sqlite.SQLiteDatabase
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
class AtomicityPackage: ReactPackage {
override fun createNativeModules(context:ReactApplicationContext):List<NativeModule> = listOf(AtomicityReport(context))
override fun createViewManagers(context:ReactApplicationContext):List<ViewManager<*,*>> = emptyList()
}
class AtomicityReport(private val context:ReactApplicationContext):ReactContextBaseJavaModule(context){
override fun getName()="AtomicityReport"
override fun getConstants():MutableMap<String,Any>{
check(context.packageName=="com.smartfin.atomicityphase1.tests")
return mutableMapOf("packageId" to context.packageName,"api" to Build.VERSION.SDK_INT,"android" to Build.VERSION.RELEASE,"model" to Build.MODEL,"release" to !BuildConfig.DEBUG)
}
@ReactMethod fun report(json:String,promise:Promise){
try{check(context.packageName=="com.smartfin.atomicityphase1.tests");val directory=File(context.getExternalFilesDir(null),"atomicity-results");directory.mkdirs();File(directory,"result.json").writeText(json);promise.resolve(true)}catch(e:Exception){promise.reject("REPORT",e)}
}
@ReactMethod fun nativeStacks(promise:Promise){
try{check(context.packageName=="com.smartfin.atomicityphase1.tests")
val result=Arguments.createArray()
Thread.getAllStackTraces().forEach{(thread,frames)->
if(frames.any{it.className.startsWith("org.pgsqlite.")||it.className.startsWith("android.database.sqlite.")}){
val entry=Arguments.createMap();entry.putString("thread",thread.name);entry.putString("state",thread.state.name)
val stack=Arguments.createArray();frames.forEach{stack.pushString(it.toString())};entry.putArray("stack",stack);result.pushMap(entry)
}}
promise.resolve(result)
}catch(e:Exception){promise.reject("STACKS",e)}
}
// A/B lifecycle experiment, independent of the RN driver and JS coordinator.
@ReactMethod fun probeAbandonedSession(cleanup:Boolean,markSuccessful:Boolean,promise:Promise){
check(context.packageName=="com.smartfin.atomicityphase1.tests")
Thread({
try{
val filename="atomicity_native_probe_${System.nanoTime()}.db"
val file=context.getDatabasePath(filename);file.parentFile?.mkdirs()
val db=SQLiteDatabase.openOrCreateDatabase(file,null)
db.execSQL("CREATE TABLE synthetic_balance(amount INTEGER NOT NULL)")
db.execSQL("INSERT INTO synthetic_balance VALUES(1000000)")
db.beginTransaction();db.execSQL("UPDATE synthetic_balance SET amount=900000")
if(markSuccessful)db.setTransactionSuccessful()
val result=Arguments.createMap();result.putString("name",filename);result.putBoolean("transactionBeforeClose",db.inTransaction())
if(cleanup)db.endTransaction()
result.putBoolean("transactionAfterCleanup",db.inTransaction());db.close();result.putBoolean("oldIsOpenAfterClose",db.isOpen)
val done=CountDownLatch(1)
val reader=Thread({
try{val next=SQLiteDatabase.openDatabase(file.path,null,SQLiteDatabase.OPEN_READWRITE)
synchronized(result){result.putBoolean("openResponded",true)}
next.execSQL("PRAGMA foreign_keys=ON")
next.rawQuery("SELECT amount FROM synthetic_balance",null).use{cursor->cursor.moveToFirst();synchronized(result){result.putInt("persistedAmount",cursor.getInt(0));result.putBoolean("queryResponded",true)}}
next.close()
}catch(e:Exception){synchronized(result){result.putString("readerError",e.toString())}}finally{done.countDown()}
},"atomicity-probe-reader");reader.start()
val completed=done.await(5,TimeUnit.SECONDS)
synchronized(result){result.putBoolean("cleanup",cleanup);result.putBoolean("completedWithinFiveSeconds",completed)
result.putBoolean("markedSuccessful",markSuccessful)
if(!completed){val stack=Arguments.createArray();reader.stackTrace.forEach{stack.pushString(it.toString())};result.putArray("readerStack",stack)}}
promise.resolve(result)
}catch(e:Exception){promise.reject("NATIVE_PROBE",e)}
},"atomicity-probe-owner").start()
}
}
