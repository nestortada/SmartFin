private var syntheticMemoryRunning = false
private var syntheticMemoryThread: Thread? = null
private var syntheticMemorySamples = 0
private var syntheticPeakPssKb = 0
private var syntheticPeakJavaBytes = 0L
private var syntheticPeakNativeBytes = 0L
@ReactMethod fun progress(json:String,promise:Promise) {
try { check(context.packageName=="com.smartfin.atomicityphase1.tests");val directory=java.io.File(context.getExternalFilesDir(null),"atomicity-results");directory.mkdirs();java.io.File(directory,"progress.json").writeText(json);promise.resolve(true) }
catch(e:Exception){promise.reject("PROGRESS",e)}
}
@ReactMethod fun startSyntheticMemory(promise:Promise) {
try {
check(context.packageName=="com.smartfin.atomicityphase1.tests")
synchronized(this) { check(!syntheticMemoryRunning); syntheticMemoryRunning=true; syntheticMemorySamples=0; syntheticPeakPssKb=0; syntheticPeakJavaBytes=0; syntheticPeakNativeBytes=0 }
syntheticMemoryThread=Thread({
while(synchronized(this){syntheticMemoryRunning}) {
val info=android.os.Debug.MemoryInfo(); android.os.Debug.getMemoryInfo(info)
val runtime=Runtime.getRuntime(); val javaBytes=runtime.totalMemory()-runtime.freeMemory(); val nativeBytes=android.os.Debug.getNativeHeapAllocatedSize()
synchronized(this){syntheticMemorySamples++;syntheticPeakPssKb=maxOf(syntheticPeakPssKb,info.totalPss);syntheticPeakJavaBytes=maxOf(syntheticPeakJavaBytes,javaBytes);syntheticPeakNativeBytes=maxOf(syntheticPeakNativeBytes,nativeBytes)}
Thread.sleep(100)
}
},"synthetic-memory-sampler");syntheticMemoryThread?.start();promise.resolve(true)
} catch(e:Exception){promise.reject("MEMORY_START",e)}
}
@ReactMethod fun stopSyntheticMemory(promise:Promise) {
try {
synchronized(this){syntheticMemoryRunning=false}
syntheticMemoryThread?.join(2000)
val result=Arguments.createMap();synchronized(this){result.putInt("samples",syntheticMemorySamples);result.putInt("samplePeriodMs",100);result.putInt("peakPssKb",syntheticPeakPssKb);result.putDouble("peakJavaBytes",syntheticPeakJavaBytes.toDouble());result.putDouble("peakNativeAllocatedBytes",syntheticPeakNativeBytes.toDouble())}
promise.resolve(result)
}catch(e:Exception){promise.reject("MEMORY_STOP",e)}
}
