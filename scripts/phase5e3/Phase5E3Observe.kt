package com.smartfin

import android.content.Context
import java.io.File

/** Observation only: who started recovery and when. No decision changes. */
object Phase5E3Observe {
  @Synchronized fun log(context: Context, message: String) {
    android.util.Log.i("SmartFin5E3", message)
    try { File(context.filesDir, "phase5e3-observe.log").appendText(System.currentTimeMillis().toString() + " " + message + "\n") }
    catch (_: Exception) { /* Observation must never affect recovery. */ }
  }
  fun read(context: Context): String = File(context.filesDir, "phase5e3-observe.log").let { if (it.exists()) it.readText() else "" }
}
