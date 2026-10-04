package com.smartfin

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.interfaces.TaskInterface
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class SmartFinSubscriptionWorker(context: Context,params: WorkerParameters) : Worker(context,params) {
  override fun doWork(): Result {
    val runId = UUID.randomUUID().toString()
    val result = CompletableFuture<Boolean>()
    runs[runId] = result
    var taskId: Int? = null
    var taskContext: HeadlessJsTaskContext? = null
    try {
      val host = (applicationContext as MainApplication).reactHost
      val started = CompletableFuture<TaskInterface<Void>>()
      UiThreadUtil.runOnUiThread {
        try { started.complete(host.start()) } catch (error: Exception) { started.completeExceptionally(error) }
      }
      // start() is idempotent; wait on the worker thread, never on the UI thread.
      val startup = started.get(10,TimeUnit.SECONDS)
      if (!startup.waitForCompletion(20,TimeUnit.SECONDS) || startup.isFaulted() || startup.isCancelled()) return Result.retry()
      UiThreadUtil.runOnUiThread {
        try {
          val context = host.currentReactContext ?: throw IllegalStateException("ReactContext unavailable")
          taskContext = HeadlessJsTaskContext.getInstance(context)
          taskId = taskContext!!.startTask(HeadlessJsTaskConfig("SmartFinSubscriptionMaintenance",Arguments.createMap().apply { putString("runId",runId) },60_000,true))
        } catch (_: Exception) { result.complete(false) }
      }
      return if (result.get(60,TimeUnit.SECONDS)) Result.success() else Result.retry()
    } catch (_: Exception) { return Result.retry() }
    finally {
      runs.remove(runId)
      UiThreadUtil.runOnUiThread { taskId?.let { taskContext?.finishTask(it) } }
    }
  }
  companion object {
    private val runs = ConcurrentHashMap<String,CompletableFuture<Boolean>>()
    fun complete(runId: String,success: Boolean) { runs[runId]?.complete(success) }
  }
}
